"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAppTranslation } from "@/i18n/client";
import { getHazardPhoto } from "@/lib/api/hazard-photo";
import useAuthStore from "@/stores/useAuthStore";

export default function HazardReportPhoto(props: {
  reportId: string;
  retryable?: boolean;
  variant?: "thumbnail" | "detail";
}) {
  const userId = useAuthStore((s) => s.user?._id);
  return (
    <PhotoSession
      key={`${userId ?? "anonymous"}:${props.reportId}`}
      {...props}
    />
  );
}

function PhotoSession({
  reportId,
  retryable,
  variant = "thumbnail",
}: {
  reportId: string;
  retryable?: boolean;
  variant?: "thumbnail" | "detail";
}) {
  const { t } = useAppTranslation();
  const frame =
    variant === "detail"
      ? "aspect-[4/3] w-full rounded-2xl object-contain bg-muted/40"
      : "h-20 w-20 rounded-xl border border-border/50 bg-muted object-cover";
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly retries the request.
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    const timeout = setTimeout(() => {
      controller.abort();
      setFailed(true);
    }, 15_000);
    setFailed(false);
    setUrl(null);
    void getHazardPhoto(reportId, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      controller.abort();
      clearTimeout(timeout);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [reportId, attempt]);
  return (
    <span
      className={`block space-y-2 ${variant === "detail" ? "w-full" : "shrink-0"}`}
    >
      {url && !failed ? (
        // biome-ignore lint/performance/noImgElement: Authenticated backend bytes are rendered as a local object URL.
        <img
          src={url}
          alt={t("hazardPhoto")}
          className={frame}
          onError={() => setFailed(true)}
        />
      ) : (
        <span
          className={`${frame} flex items-center justify-center bg-muted p-3 text-center text-xs text-muted-foreground`}
          role="status"
        >
          {t(failed ? "hazardPhotoUnavailable" : "hazardPhotoLoading")}
        </span>
      )}
      {failed && retryable && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAttempt((value) => value + 1)}
        >
          {t("myReportsRetry")}
        </Button>
      )}
    </span>
  );
}
