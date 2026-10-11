"use client";

import { useEffect, useState } from "react";
import { useAppTranslation } from "@/i18n/client";
import { resolvePublicHazardPhotoUrl } from "@/lib/public-hazard-photo";

/** Anonymous public route only. No auth refresh, private fallback or Blob cache. */
export default function PublicHazardReportPhoto({
  publicPhotoUrl,
  expiredAt,
}: {
  publicPhotoUrl: string | null;
  expiredAt?: string;
}) {
  const { t } = useAppTranslation();
  if (!publicPhotoUrl) return null;
  const url = resolvePublicHazardPhotoUrl(publicPhotoUrl);
  if (!url)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t("hazardPublicPhotoUnavailable")}
      </p>
    );
  return (
    <PublicPhotoSession
      key={`${url}:${expiredAt ?? ""}`}
      url={url}
      expiredAt={expiredAt}
    />
  );
}

function PublicPhotoSession({
  url,
  expiredAt,
}: {
  url: string;
  expiredAt?: string;
}) {
  const { t } = useAppTranslation();
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [now, setNow] = useState(Date.now());
  const expires = expiredAt ? Date.parse(expiredAt) : Infinity;
  useEffect(() => {
    if (!Number.isFinite(expires) || expires <= now) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.min(2_147_483_647, Math.max(0, expires - Date.now())),
    );
    return () => clearTimeout(timer);
  }, [expires, now]);
  if (expires <= now) return null;
  return (
    <span className="relative block aspect-video w-full overflow-hidden rounded-xl bg-muted">
      {state !== "failed" && (
        // biome-ignore lint/performance/noImgElement: Public backend bytes are uncached and never proxied through Next's image cache.
        <img
          src={url}
          alt={t("hazardPhoto")}
          referrerPolicy="no-referrer"
          className="absolute inset-0 size-full object-contain"
          onLoad={() => setState("ready")}
          onError={() => setState("failed")}
        />
      )}
      {state !== "ready" && (
        <span
          role="status"
          className="absolute inset-0 flex items-center justify-center bg-muted p-3 text-center text-sm text-muted-foreground"
        >
          {t(
            state === "failed"
              ? "hazardPublicPhotoUnavailable"
              : "hazardPhotoLoading",
          )}
        </span>
      )}
    </span>
  );
}
