"use client";

import { Marker } from "maplibre-gl";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAppTranslation } from "@/i18n/client";
import { getMyHazardReports } from "@/lib/api/a11y";
import {
  hazardExpired,
  hazardResubmitPreset,
  hazardReviewStatus,
} from "@/lib/hazard-review";
import useAuthStore from "@/stores/useAuthStore";
import useMapStore from "@/stores/useMapStore";
import type { HazardReport } from "@/types/route";
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

  const newReport = (report?: HazardReport) => {
    const state = useMapStore.getState();
    state.setPendingReportContext(
      report ? { ...hazardResubmitPreset(report), description: "" } : null,
    );
    state.setActiveRailPanel("hazard");
  };
  const date = (value?: string) =>
    value && Number.isFinite(Date.parse(value))
      ? new Date(value).toLocaleString(i18n.language)
      : t("myReportsUnknownDate");
  const type = (report: HazardReport) =>
    t(report.hazardType === "data_error" ? "dataError" : report.hazardType);
  const location = (report: HazardReport) =>
    `${report.reportedLocation.coordinates[1].toFixed(5)}, ${report.reportedLocation.coordinates[0].toFixed(5)}`;
  const photo = (report: HazardReport) =>
    report.photoUrl && (
      // biome-ignore lint/performance/noImgElement: Report photos use backend URLs outside Next image optimization.
      <img
        src={report.photoUrl}
        alt={t("hazardPhoto")}
        className="h-24 w-24 rounded-lg object-cover"
        loading="lazy"
      />
    );

  if (selected)
    return (
      <div className="space-y-4 p-4">
        <Button
          variant="outline"
          onClick={() => {
            marker.current?.remove();
            setSelected(null);
          }}
        >
          {t("myReportsBack")}
        </Button>
        <h3 className="font-semibold">{type(selected)}</h3>
        <p className="text-sm">{date(selected.createdAt)}</p>
        {photo(selected)}
        <p className="whitespace-pre-wrap break-words">
          {selected.description}
        </p>
        <p className="text-sm">
          {t("myReportsLocation")}: {location(selected)}
        </p>
        <Button
          variant="outline"
          disabled={!map}
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
        </Button>
        <p className="text-sm text-muted-foreground">
          {t("myReportsStatusHint")}
        </p>
        <HazardReportResult
          initial={{ ...selected, reporterId: userId }}
          reportId={selected._id}
          onResubmit={newReport}
        />
        {hazardExpired(selected, now) && (
          <Button onClick={() => newReport(selected)}>
            {t("hazardReviewResubmit")}
          </Button>
        )}
      </div>
    );

  return (
    <div className="space-y-4 p-4" aria-busy={loading}>
      <p className="text-sm text-muted-foreground">
        {t("myReportsDescription")}
      </p>
      <Button variant="outline" onClick={() => newReport()}>
        {t("myReportsNew")}
      </Button>
      {reports.length > 0 && (
        <ul className="space-y-3">
          {reports.map((report) => (
            <li key={report._id}>
              <button
                type="button"
                className="flex w-full gap-3 rounded-xl border border-border p-3 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary"
                onClick={() => setSelected(report)}
              >
                {photo(report)}
                <span className="min-w-0 space-y-1">
                  <span className="block font-semibold">{type(report)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {date(report.createdAt)}
                  </span>
                  <span className="block text-xs">{location(report)}</span>
                  <span className="block text-sm">
                    {t(hazardReviewStatus(report, now))}
                  </span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {report.description}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {loading && <p role="status">{t("myReportsLoading")}</p>}
      {error && (
        <div role="alert" className="space-y-2">
          <p>{t("myReportsError")}</p>
          <Button onClick={() => void load(cursor ?? undefined)}>
            {t("myReportsRetry")}
          </Button>
        </div>
      )}
      {!loading && !error && reports.length === 0 && (
        <p>{t("myReportsEmpty")}</p>
      )}
      {!error && cursor && (
        <Button
          disabled={loading}
          variant="outline"
          onClick={() => void load(cursor)}
        >
          {t("myReportsMore")}
        </Button>
      )}
    </div>
  );
}
