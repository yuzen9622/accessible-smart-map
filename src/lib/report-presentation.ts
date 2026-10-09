import { hazardReviewStatus } from "@/lib/hazard-review";
import type { HazardReport } from "@/types/route";

export function reportPresentation(report: HazardReport, now = Date.now()) {
  const status = hazardReviewStatus(report, now);
  if (status === "hazardReviewExpired")
    return { label: "reportStateExpired", tone: "neutral" } as const;
  if (status === "hazardReviewUnsupported")
    return { label: "reportStateRejected", tone: "rose" } as const;
  if (["hazardReviewSupported", "hazardReviewVerified"].includes(status))
    return { label: "reportStateAccepted", tone: "green" } as const;
  if (
    [
      "hazardReviewNeedsEvidence",
      "hazardReviewFailed",
      "hazardReviewLegacyStalled",
      "hazardReviewDelayed",
    ].includes(status)
  )
    return { label: "reportStateAttention", tone: "amber" } as const;
  if (status === "hazardReviewCancelled")
    return { label: "reportStateStopped", tone: "neutral" } as const;
  return { label: "reportStateReviewing", tone: "blue" } as const;
}

export const reportTones = {
  rose: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200",
  green:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
  amber:
    "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  blue: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200",
  neutral: "border-border bg-muted/60 text-muted-foreground",
};

export function reportDate(
  value: string | undefined | null,
  language = "zh-TW",
  compact = false,
) {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return new Intl.DateTimeFormat(language, {
    timeZone: "Asia/Taipei",
    month: "numeric",
    day: "numeric",
    ...(compact
      ? {}
      : { year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }),
  }).format(new Date(value));
}
