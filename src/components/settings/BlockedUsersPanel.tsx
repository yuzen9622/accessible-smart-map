"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAppTranslation } from "@/i18n/client";
import {
  type BlockedUser,
  listBlockedUsers,
  unblockUser,
} from "@/lib/api/content-safety";
import useAuthStore from "@/stores/useAuthStore";
import useContentSafetyStore, {
  captureSafetyAccount,
} from "@/stores/useContentSafetyStore";

export default function BlockedUsersPanel() {
  const epoch = useContentSafetyStore((s) => s.accountEpoch);
  const revision = useContentSafetyStore((s) => s.revision);
  const userId = useAuthStore((s) => s.user?._id);
  return userId ? <BlockedUsersSession key={`${epoch}:${revision}`} /> : null;
}
function BlockedUsersSession() {
  const { t } = useAppTranslation();
  const [items, setItems] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const pending = useRef(false);
  const requestId = useRef(0);
  const alive = useRef(true);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const request = ++requestId.current;
      const account = captureSafetyAccount();
      const current = () =>
        alive.current &&
        account() &&
        request === requestId.current &&
        !signal?.aborted;
      setLoading(true);
      setError("");
      setItems([]);
      try {
        const data = await listBlockedUsers(signal);
        if (current()) setItems(data.items);
      } catch {
        if (current()) setError(t("safetyLoadError"));
      } finally {
        if (current()) setLoading(false);
      }
    },
    [t],
  );
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    void load(controller.signal);
    return () => {
      alive.current = false;
      controller.abort();
    };
  }, [load]);
  async function unblock(blockId: string) {
    if (pending.current) return;
    const account = captureSafetyAccount();
    pending.current = true;
    setBusyId(blockId);
    setError("");
    try {
      await unblockUser(blockId);
      if (!alive.current || !account()) return;
      setItems((previous) =>
        previous.filter((item) => item.blockId !== blockId),
      );
      toast.success(t("safetyUnblocked"));
      useContentSafetyStore.getState().invalidateContent();
    } catch {
      if (alive.current && account()) setError(t("safetyActionError"));
    } finally {
      pending.current = false;
      if (alive.current && account()) setBusyId(null);
    }
  }
  return (
    <section className="space-y-3 border-t pt-4">
      <h3 className="text-sm font-semibold">{t("safetyBlockedUsers")}</h3>
      <p className="text-sm text-muted-foreground">
        {t("safetyBlockedUsersExplanation")}
      </p>
      {loading ? (
        <p role="status" className="text-sm">
          {t("safetyLoading")}
        </p>
      ) : (
        <>
          {error && (
            <div role="alert" className="space-y-2">
              <p className="text-sm text-destructive">{error}</p>
              <Button
                variant="outline"
                disabled={busyId !== null}
                onClick={() => void load()}
              >
                {t("safetyRetry")}
              </Button>
            </div>
          )}
          {!error && items.length === 0 && (
            <p className="rounded-xl bg-muted p-3 text-sm">
              {t("safetyNoBlockedUsers")}
            </p>
          )}
          <ul className="space-y-2">
            {items.map((item) => (
              <li
                key={item.blockId}
                className="flex items-center justify-between gap-3 rounded-xl border p-3"
              >
                <span className="min-w-0 break-words text-sm">
                  {t(
                    item.label === "review"
                      ? "safetyBlockedFromReview"
                      : "safetyBlockedFromHazard",
                  )}{" "}
                  · {item.blockId.slice(-6)}
                </span>
                <Button
                  variant="outline"
                  className="min-h-11 shrink-0"
                  disabled={busyId !== null}
                  onClick={() => void unblock(item.blockId)}
                >
                  {t(
                    busyId === item.blockId
                      ? "safetySubmitting"
                      : "safetyUnblock",
                  )}
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
