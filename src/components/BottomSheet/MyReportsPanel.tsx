"use client";

import {
  AlertCircle,
  ArrowLeft,
  ArrowUpRight,
  ChevronRight,
  ClipboardList,
  Clock3,
  Construction,
  MapPin,
  Plus,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { Marker } from "maplibre-gl";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAppTranslation } from "@/i18n/client";
import { getMyHazardReports } from "@/lib/api/a11y";
import { hazardExpired, hazardResubmitPreset } from "@/lib/hazard-review";
import {
  reportDate,
  reportPresentation,
  reportTones,
} from "@/lib/report-presentation";
import useAuthStore from "@/stores/useAuthStore";
import useMapStore from "@/stores/useMapStore";
import type { HazardReport } from "@/types/route";
import HazardReportPhoto from "./HazardReportPhoto";
import HazardReportResult from "./HazardReportResult";

export default function MyReportsPanel() {
  const userId = useAuthStore((s) => s.user?._id);
  const { t } = useAppTranslation();
  if (!userId)
    return (
      <div className="space-y-4 p-4">
        <p>{t("myReportsLogin")}</p>
        <Button onClick={() => useAuthStore.getState().requestAuthDialog()}>
          {t("goToLoginRegister")}
        </Button>
      </div>
    );
  // Account changes discard both list and detail synchronously.
  return <MyReportsSession key={userId} userId={userId} />;
}

export function MyReportsSession({ userId }: { userId: string }) {
  const { t, i18n } = useAppTranslation();
  const map = useMapStore((s) => s.map);
  const [reports, setReports] = useState<HazardReport[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<HazardReport | null>(null);
  const request = useRef<AbortController | null>(null);
  const marker = useRef<Marker | null>(null);
  const [now, setNow] = useState(Date.now());
  const load = useCallback(
    async (after?: string) => {
      if (request.current) return;
      const controller = new AbortController();
      request.current = controller;
      setLoading(true);
      setError(false);
      try {
        const response = await getMyHazardReports(after, controller.signal);
        if (
          controller.signal.aborted ||
          useAuthStore.getState().user?._id !== userId
        )
          return;
        if (
          !(response.ok || response.success) ||
          !Array.isArray(response.data?.reports)
        )
          throw new Error("Invalid reports response");
        const page = response.data.reports;
        setReports((previous) => [
          ...new Map(
            [...(after ? previous : []), ...page].map((report) => [
              report._id,
              report,
            ]),
          ).values(),
        ]);
        setCursor(response.data.nextCursor ?? null);
      } catch {
        if (
          !controller.signal.aborted &&
          useAuthStore.getState().user?._id === userId
        )
          setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
        if (request.current === controller) request.current = null;
      }
    },
    [userId],
  );
  useEffect(() => {
    void load();
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      request.current?.abort();
      request.current = null;
      clearInterval(timer);
      marker.current?.remove();
    };
  }, [load]);

  const updateReport = useCallback((next: HazardReport) => {
    setReports((previous) =>
      previous.map((item) =>
        item._id === next._id ? { ...item, ...next } : item,
      ),
    );
    setSelected((previous) =>
      previous?._id === next._id ? { ...previous, ...next } : previous,
    );
  }, []);

  const newReport = (report?: HazardReport) => {
    const state = useMapStore.getState();
    state.setActiveRailPanel(
      "hazard",
      report ? { ...hazardResubmitPreset(report), description: "" } : undefined,
    );
  };
  const type = (report: HazardReport) =>
    t(report.hazardType === "data_error" ? "dataError" : report.hazardType);
  const severity = (report: HazardReport) =>
    report.severity
      ? t(
          {
            blocking: "severityBlocking",
            difficult: "severityDifficult",
            minor: "severityMinor",
          }[report.severity],
        )
      : null;
  const location = (report: HazardReport) =>
    `${report.reportedLocation.coordinates[1].toFixed(5)}, ${report.reportedLocation.coordinates[0].toFixed(5)}`;
  const photo = (report: HazardReport, detail = false) =>
    (report.hasPhoto ?? Boolean(report.photoUrl)) ? (
      <HazardReportPhoto
        reportId={report._id}
        retryable={detail}
        variant={detail ? "detail" : "thumbnail"}
      />
    ) : (
      <span className="flex size-20 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Construction className="size-7" aria-hidden="true" />
      </span>
    );

  if (selected)
    return (
      <article className="space-y-6 px-1 py-2 sm:px-2">
        <Button
          variant="ghost"
          className="-ml-2 min-h-11 rounded-full text-muted-foreground"
          onClick={() => {
            marker.current?.remove();
            setSelected(null);
          }}
        >
          <ArrowLeft className="size-4" />
          {t("myReportsBack")}
        </Button>
        <header className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium tracking-wide text-muted-foreground">
              {t("reportDetailEyebrow")}
            </span>
            {severity(selected) && (
              <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">
                {severity(selected)}
              </span>
            )}
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">
            {type(selected)}
          </h2>
          <p className="text-sm text-muted-foreground">
            {reportDate(selected.createdAt, i18n.language)} ·{" "}
            {t("reportSubmitted")}
          </p>
        </header>
        <HazardReportResult
          initial={{ ...selected, reporterId: userId }}
          reportId={selected._id}
          onResubmit={newReport}
          onReportUpdate={updateReport}
        />
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">{t("reportYourSubmission")}</h3>
          {(selected.hasPhoto ?? Boolean(selected.photoUrl)) &&
            photo(selected, true)}
          <p className="whitespace-pre-wrap break-words text-base leading-7">
            {selected.description || t("reportNoDescription")}
          </p>
        </section>
        <section className="overflow-hidden rounded-2xl border border-border/70">
          <div className="flex items-start gap-3 p-4">
            <span className="rounded-xl bg-muted p-2.5">
              <MapPin className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold">
                {t("myReportsLocation")}
              </h3>
              <p className="mt-1 font-mono text-xs tabular-nums text-muted-foreground">
                {location(selected)}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={!map}
            className="flex min-h-11 w-full cursor-pointer items-center justify-between border-t border-border/60 bg-muted/30 px-4 text-sm font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-primary"
            onClick={() => {
              const state = useMapStore.getState();
              marker.current?.remove();
              if (state.map)
                marker.current = new Marker({ color: "#d97706" })
                  .setLngLat(selected.reportedLocation.coordinates)
                  .addTo(state.map);
              state.map?.flyTo({
                center: selected.reportedLocation.coordinates,
                zoom: 17,
              });
              state.setMobileSheetSnap("peek");
            }}
          >
            {t("myReportsMap")}
            <ArrowUpRight className="size-4" />
          </button>
        </section>
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">{t("reportCommunity")}</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-3 rounded-xl bg-muted/40 p-3">
              <ThumbsUp className="size-4 text-muted-foreground" />
              <div>
                <p className="text-lg font-semibold tabular-nums">
                  {selected.confirmCount ?? 0}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("reportConfirmCount")}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-xl bg-muted/40 p-3">
              <ThumbsDown className="size-4 text-muted-foreground" />
              <div>
                <p className="text-lg font-semibold tabular-nums">
                  {selected.denyCount ?? 0}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("reportDenyCount")}
                </p>
              </div>
            </div>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            {t("myReportsStatusHint")}
          </p>
        </section>
        <dl className="space-y-3 border-t border-border/70 pt-4 text-sm">
          {[
            ["reportUpdated", selected.updatedAt],
            ["reportExpires", selected.expiredAt],
            ["reportExpectedUntil", selected.expectedUntil],
          ].map(([label, value]) => (
            <div key={label} className="flex flex-wrap justify-between gap-2">
              <dt className="text-muted-foreground">{t(label as string)}</dt>
              <dd className="tabular-nums">
                {value
                  ? reportDate(value, i18n.language)
                  : t("reportNotProvided")}
              </dd>
            </div>
          ))}
        </dl>
        {hazardExpired(selected, now) && (
          <Button
            className="min-h-11 w-full rounded-xl"
            onClick={() => newReport(selected)}
          >
            {t("hazardReviewResubmit")}
          </Button>
        )}
      </article>
    );

  return (
    <div className="space-y-5 px-1 py-2 sm:px-2" aria-busy={loading}>
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">
            {t("reportListHeading")}
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            {t("reportListSubtitle")}
          </p>
        </div>
        <Button
          size="icon"
          className="size-11 shrink-0 rounded-full"
          aria-label={t("myReportsNew")}
          onClick={() => newReport()}
        >
          <Plus className="size-5" />
        </Button>
      </header>
      {reports.length > 0 && (
        <ul className="space-y-3">
          {reports.map((report) => {
            const presentation = reportPresentation(report, now);
            const reason =
              report.aiReview?.reason || report.aiVerification?.reason;
            return (
              <li key={report._id}>
                <button
                  type="button"
                  className="group w-full cursor-pointer overflow-hidden rounded-2xl border border-border/70 bg-background text-left shadow-xs transition-colors hover:border-primary/40 hover:bg-muted/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  onClick={(event) => {
                    event.currentTarget
                      .closest<HTMLElement>(
                        "[data-radix-scroll-area-viewport], .overflow-y-auto",
                      )
                      ?.scrollTo({ top: 0 });
                    useMapStore.getState().setMobileSheetSnap("full");
                    setSelected(report);
                  }}
                >
                  <span className="flex items-center justify-between gap-2 border-b border-border/50 px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${reportTones[presentation.tone]}`}
                    >
                      <span
                        className="size-1.5 rounded-full bg-current"
                        aria-hidden="true"
                      />
                      {t(presentation.label)}
                    </span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {reportDate(report.createdAt, i18n.language, true)}
                    </span>
                  </span>
                  <span className="flex gap-3 p-4">
                    {photo(report)}
                    <span className="min-w-0 flex-1">
                      <span className="block text-base font-semibold">
                        {type(report)}
                      </span>
                      {severity(report) && (
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {severity(report)}
                        </span>
                      )}
                      <span className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">
                        {report.description || t("reportNoDescription")}
                      </span>
                    </span>
                    <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
                  </span>
                  {reason && (
                    <span className="mx-4 mb-4 block rounded-xl bg-muted/50 px-3 py-2.5 text-sm leading-6">
                      <span className="mb-0.5 block text-xs font-medium text-muted-foreground">
                        {t("reportReviewSummary")}
                      </span>
                      <span className="line-clamp-2">{reason}</span>
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {loading && (
        <div role="status" className="space-y-3">
          <span className="sr-only">{t("myReportsLoading")}</span>
          {[0, 1].map((index) => (
            <div
              key={index}
              className="h-40 rounded-2xl border border-border/60 bg-muted/40 motion-safe:animate-pulse"
            />
          ))}
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="space-y-3 rounded-2xl border border-border bg-muted/30 p-5"
        >
          <AlertCircle className="size-5 text-muted-foreground" />
          <p className="text-sm leading-6">{t("myReportsError")}</p>
          <Button
            variant="outline"
            className="min-h-11 rounded-xl"
            onClick={() => void load(cursor ?? undefined)}
          >
            {t("myReportsRetry")}
          </Button>
        </div>
      )}
      {!loading && !error && reports.length === 0 && (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border px-5 py-12 text-center">
          <span className="rounded-2xl bg-muted p-4">
            <ClipboardList className="size-8 text-muted-foreground" />
          </span>
          <p className="font-medium">{t("myReportsEmpty")}</p>
          <p className="text-sm leading-6 text-muted-foreground">
            {t("reportEmptyHint")}
          </p>
          <Button className="min-h-11 rounded-xl" onClick={() => newReport()}>
            {t("myReportsNew")}
          </Button>
        </div>
      )}
      {!error && cursor && (
        <Button
          disabled={loading}
          variant="outline"
          className="min-h-11 w-full rounded-xl"
          onClick={() => void load(cursor)}
        >
          {t("myReportsMore")}
        </Button>
      )}
      {reports.length > 0 && (
        <p className="flex items-center justify-center gap-1.5 pb-2 text-xs text-muted-foreground">
          <Clock3 className="size-3.5" />
          {t("reportListFooter")}
        </p>
      )}
    </div>
  );
}
