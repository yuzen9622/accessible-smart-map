"use client";

import { Flag, MoreHorizontal, ShieldBan } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppTranslation } from "@/i18n/client";
import {
  blockContentAuthor,
  CONTENT_REPORT_REASONS,
  type ContentReportReason,
  type ContentReportReceipt,
  type ContentTarget,
  submitContentReport,
} from "@/lib/api/content-safety";
import useAuthStore from "@/stores/useAuthStore";
import useContentSafetyStore, {
  captureSafetyAccount,
} from "@/stores/useContentSafetyStore";

type Props = {
  target: ContentTarget;
  canBlock?: boolean;
  isOwn?: boolean;
  onBlocked?: () => void;
};

export default function ContentSafetyMenu(props: Props) {
  const epoch = useContentSafetyStore((s) => s.accountEpoch);
  if (props.isOwn) return null;
  return (
    <ContentSafetySession
      key={`${epoch}:${props.target.targetType}:${props.target.targetId}`}
      {...props}
    />
  );
}

function ContentSafetySession({ target, canBlock = true, onBlocked }: Props) {
  const { t } = useAppTranslation();
  const id = useId();
  const [mode, setMode] = useState<"report" | "block" | null>(null);
  const [reason, setReason] = useState<ContentReportReason | "">("");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<ContentReportReceipt | null>(null);
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  function open(next: "report" | "block") {
    if (!useAuthStore.getState().user) {
      useAuthStore.getState().requestAuthDialog();
      return;
    }
    setError("");
    setMode(next);
  }
  async function submit() {
    if (
      pending.current ||
      (mode === "report" &&
        (!reason || (reason === "other" && !details.trim())))
    )
      return;
    const currentAccount = captureSafetyAccount();
    const current = () => alive.current && currentAccount();
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      if (mode === "report" && reason) {
        const result = await submitContentReport(target, reason, details);
        if (current()) setReceipt(result);
      } else if (mode === "block") {
        await blockContentAuthor(target);
        if (!current()) return;
        setMode(null);
        toast.success(t("safetyBlocked"));
        useContentSafetyStore.getState().invalidateContent();
        onBlocked?.();
      }
    } catch {
      if (current()) setError(t("safetyActionError"));
    } finally {
      pending.current = false;
      if (current()) setBusy(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="min-h-11 min-w-11 rounded-full"
            aria-label={t("safetyContentMenu")}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => open("report")}>
            <Flag className="size-4" />
            {t("safetyReport")}
          </DropdownMenuItem>
          {canBlock && (
            <DropdownMenuItem onSelect={() => open("block")}>
              <ShieldBan className="size-4" />
              {t("safetyBlock")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog
        open={mode !== null}
        onOpenChange={(openState) => {
          if (!openState && !pending.current) setMode(null);
        }}
      >
        <DialogContent
          className="max-h-[85dvh] overflow-y-auto"
          showCloseButton={false}
        >
          <DialogHeader>
            <DialogTitle>
              {t(
                receipt && mode === "report"
                  ? "safetyReceived"
                  : mode === "block"
                    ? "safetyBlock"
                    : "safetyReport",
              )}
            </DialogTitle>
            <DialogDescription>
              {t(
                mode === "block"
                  ? "safetyBlockExplanation"
                  : receipt
                    ? "safetyReceiptExplanation"
                    : "safetyReportExplanation",
              )}
            </DialogDescription>
          </DialogHeader>
          {mode === "report" && receipt ? (
            <div className="space-y-4" role="status">
              <p className="text-sm">
                {t("safetyCaseNumber")}{" "}
                <span className="font-mono break-all">
                  {receipt.caseNumber}
                </span>
              </p>
              <p className="text-sm text-muted-foreground">
                {t(
                  receipt.confirmationEmail === "queued"
                    ? "safetyEmailQueued"
                    : "safetyEmailUnavailable",
                )}
              </p>
              <Button className="w-full min-h-11" onClick={() => setMode(null)}>
                {t("safetyDone")}
              </Button>
            </div>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              {mode === "report" && (
                <>
                  <div className="space-y-2">
                    <label
                      htmlFor={`${id}-reason`}
                      className="text-sm font-medium"
                    >
                      {t("safetyReason")}
                    </label>
                    <select
                      id={`${id}-reason`}
                      value={reason}
                      required
                      disabled={busy}
                      onChange={(event) =>
                        setReason(event.target.value as ContentReportReason)
                      }
                      className="min-h-11 w-full rounded-lg border bg-background p-2 text-sm"
                    >
                      <option value="">{t("safetySelectReason")}</option>
                      {CONTENT_REPORT_REASONS.map((item) => (
                        <option key={item} value={item}>
                          {t(`safetyReason_${item}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label
                      htmlFor={`${id}-details`}
                      className="text-sm font-medium"
                    >
                      {t(
                        reason === "other"
                          ? "safetyDetailsRequired"
                          : "safetyDetails",
                      )}
                    </label>
                    <textarea
                      id={`${id}-details`}
                      value={details}
                      disabled={busy}
                      required={reason === "other"}
                      maxLength={1000}
                      rows={4}
                      onChange={(event) => setDetails(event.target.value)}
                      className="w-full rounded-lg border bg-background p-3 text-sm"
                    />
                    <p className="text-right text-xs text-muted-foreground">
                      {details.length}/1000
                    </p>
                  </div>
                </>
              )}
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 flex-1"
                  disabled={busy}
                  onClick={() => setMode(null)}
                >
                  {t("safetyCancel")}
                </Button>
                <Button
                  type="submit"
                  className="min-h-11 flex-1"
                  disabled={
                    busy ||
                    (mode === "report" &&
                      (!reason || (reason === "other" && !details.trim())))
                  }
                >
                  {t(
                    busy
                      ? "safetySubmitting"
                      : mode === "block"
                        ? "safetyBlock"
                        : "safetySubmit",
                  )}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
