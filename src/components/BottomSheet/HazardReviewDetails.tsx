"use client";

import {
  Camera,
  ChevronDown,
  Clock3,
  Info,
  MapPin,
  ScanEye,
} from "lucide-react";
import { useAppTranslation } from "@/i18n/client";
import { reportDate } from "@/lib/report-presentation";
import type { HazardReport } from "@/types/route";

export default function HazardReviewDetails({
  report,
}: {
  report: HazardReport;
}) {
  const { t, i18n } = useAppTranslation();
  const review = report.aiReview;
  const observations = [...new Set(review?.observations ?? [])];
  const limitations = [...new Set(review?.limitations ?? [])];
  const evidence = [...new Set(review?.requiredEvidence ?? [])];
  const exif = report.exifValidation;
  const gps =
    exif?.gpsPresent === false
      ? "reportGpsAbsent"
      : (exif?.gpsMatchesClaimed ?? exif?.gpsMatch) === true
        ? "reportGpsMatches"
        : exif?.gpsPresent === true
          ? "reportGpsUnconfirmed"
          : "reportUnknown";
  const fresh = exif?.timestampFresh ?? exif?.timeRecent;
  const times = [
    ["reportSubmitted", report.createdAt],
    ["reportQueued", review?.queuedAt],
    ["reportReviewStarted", review?.startedAt],
    ["reportReviewFinished", review?.completedAt],
  ].filter(([, value]) => value && Number.isFinite(Date.parse(value)));
  return (
    <div className="space-y-5">
      {(evidence.length > 0 || review?.reasonCode === "NON_STREET_IMAGE") && (
        <section className="rounded-2xl bg-muted/50 p-4">
          <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Camera className="size-4" />
            {t("reportNextPhoto")}
          </h4>
          {review?.reasonCode === "NON_STREET_IMAGE" && (
            <p className="text-sm leading-6">{t("reportStreetPhotoHint")}</p>
          )}
          {evidence.length > 0 && (
            <ul className="mt-2 space-y-2 text-sm leading-6">
              {evidence.map((item) => (
                <li key={item} className="flex gap-2">
                  <span aria-hidden="true">•</span>
                  {t(`hazardEvidence_${item}`)}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {observations.length > 0 && (
        <section>
          <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <ScanEye className="size-4" />
            {t("reportObservations")}
          </h4>
          <ul className="space-y-2 text-sm leading-6">
            {observations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      )}
      <details className="group rounded-2xl border border-border/70">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2">
            <Info className="size-4 text-muted-foreground" />
            {t("reportEvidenceDetails")}
          </span>
          <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" />
        </summary>
        <div className="space-y-4 border-t border-border/60 p-4">
          {exif && (
            <dl className="space-y-3 text-sm">
              <div className="flex items-start justify-between gap-4">
                <dt className="flex items-center gap-2 text-muted-foreground">
                  <MapPin className="size-4" />
                  {t("reportPhotoGps")}
                </dt>
                <dd className="text-right">{t(gps)}</dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="flex items-center gap-2 text-muted-foreground">
                  <Clock3 className="size-4" />
                  {t("reportPhotoTime")}
                </dt>
                <dd className="text-right">
                  {t(
                    fresh === true
                      ? "reportTimeFresh"
                      : fresh === false
                        ? "reportTimeUnconfirmed"
                        : "reportUnknown",
                  )}
                </dd>
              </div>
            </dl>
          )}
          {exif?.gpsPresent === false && (
            <p className="text-xs leading-5 text-muted-foreground">
              {t("reportGpsHint")}
            </p>
          )}
          {limitations.length > 0 && (
            <section>
              <h4 className="mb-2 text-sm font-medium">
                {t("reportLimitations")}
              </h4>
              <ul className="space-y-2 text-sm leading-6 text-muted-foreground">
                {limitations.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span aria-hidden="true">•</span>
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {(review?.visibleHazards?.length ?? 0) > 0 && (
            <p className="text-sm leading-6">
              <span className="font-medium">{t("reportVisibleHazards")}: </span>
              {review?.visibleHazards
                ?.map((value) =>
                  t(`reportVisible_${value}`, { defaultValue: value }),
                )
                .join("、")}
            </p>
          )}
          {!exif && !limitations.length && !review?.visibleHazards?.length && (
            <p className="text-sm text-muted-foreground">
              {t("reportNoEvidence")}
            </p>
          )}
        </div>
      </details>
      {times.length > 0 && (
        <details className="group rounded-2xl border border-border/70">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-2">
              <Clock3 className="size-4 text-muted-foreground" />
              {t("reportTimeline")}
            </span>
            <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" />
          </summary>
          <ol className="space-y-0 border-t border-border/60 px-4 py-4">
            {times.map(([label, time]) => (
              <li
                key={label}
                className="relative ml-1 border-l border-border py-2 pl-5 last:border-transparent"
              >
                <span className="absolute -left-1 top-4 size-2 rounded-full bg-primary/70" />
                <p className="text-sm font-medium">{t(label as string)}</p>
                <time
                  dateTime={time}
                  className="text-xs tabular-nums text-muted-foreground"
                >
                  {reportDate(time, i18n?.language)}
                </time>
              </li>
            ))}
          </ol>
          <p className="px-4 pb-4 text-xs text-muted-foreground">
            {t("reportTaipeiTime")}
          </p>
        </details>
      )}
    </div>
  );
}
