"use client";

import {
  AlertTriangle,
  Camera,
  ChevronDown,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Marker, Popup } from "react-map-gl/maplibre";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import PublicHazardReportPhoto from "@/components/BottomSheet/PublicHazardReportPhoto";
import ContentSafetyMenu from "@/components/content-safety/ContentSafetyMenu";
import { Button } from "@/components/ui/button";
import { useAppTranslation } from "@/i18n/client";
import {
  confirmHazardReport,
  getHazardReport,
  getNearbyHazardReports,
} from "@/lib/api/a11y";
import { ApiError } from "@/lib/fetch";
import {
  createHazardReviewPoller,
  hazardCanConfirm,
  hazardExpired,
  hazardReviewStatus,
} from "@/lib/hazard-review";
import useAuthStore from "@/stores/useAuthStore";
import useContentSafetyStore from "@/stores/useContentSafetyStore";
import useMapStore from "@/stores/useMapStore";
import type { HazardReport } from "@/types/route";

const VOTE_ERROR_MESSAGE_KEYS: Record<string, string> = {
  SELF_CONFIRMATION: "hazardVoteSelfConfirmation",
  ALREADY_VOTED: "hazardVoteAlreadyVoted",
  REPORT_NOT_FOUND: "hazardVoteReportNotFound",
  REPORT_EXPIRED: "hazardVoteReportExpired",
};

type PopupBounds = Pick<DOMRect, "top" | "right" | "bottom" | "left">;

/** Camera pan needed to keep a bottom-anchored report card inside the map. */
export function hazardPopupPan(
  card: PopupBounds,
  viewport: PopupBounds,
): [number, number] {
  const desktop = viewport.right - viewport.left >= 768;
  const left = viewport.left + (desktop ? 84 : 16);
  const right = viewport.right - 72; // Keep the map controls/SOS reachable.
  const top = viewport.top + 16;
  const bottom =
    viewport.bottom -
    (desktop ? 16 : (viewport.bottom - viewport.top) * 0.12 + 16);
  const dx =
    card.left < left ? card.left - left : Math.max(0, card.right - right);
  const dy =
    card.top < top ? card.top - top : Math.max(0, card.bottom - bottom);
  return [dx, dy];
}

export default function HazardWrapper() {
  const epoch = useContentSafetyStore((s) => s.accountEpoch);
  const revision = useContentSafetyStore((s) => s.revision);
  return <HazardSession key={`${epoch}:${revision}`} />;
}

function HazardSession() {
  const { t } = useAppTranslation();
  const { userLocation, map } = useMapStore(
    useShallow((s) => ({ userLocation: s.userLocation, map: s.map })),
  );
  const user = useAuthStore((s) => s.user);
  const [hazards, setHazards] = useState<HazardReport[]>([]);
  const [selected, setSelected] = useState<HazardReport | null>(null);
  const [votedIds, setVotedIds] = useState<Set<string>>(new Set());
  const [votingId, setVotingId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const popupContent = useRef<HTMLElement>(null);
  const selectionSnapshot = useRef<HazardReport | null>(null);
  const reportId = selected?._id;
  const selectedId =
    selected && !hazardExpired(selected, now) ? selected._id : undefined;

  useEffect(() => {
    const content = popupContent.current;
    if (!selectedId || !map || !content) return;
    const container = map.getContainer();
    const keepInView = () => {
      const card = content.getBoundingClientRect();
      const viewport = container.getBoundingClientRect();
      const [dx, dy] = hazardPopupPan(card, viewport);
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1)
        map.panBy([dx, dy], { duration: 0 });
    };
    // Re-fit after photo/status content changes and viewport resizes, not
    // every map movement: users must remain free to pan the map themselves.
    let frame = 0;
    const scheduleFit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(keepInView);
    };
    const observer = new ResizeObserver(scheduleFit);
    observer.observe(content);
    observer.observe(container);
    // MapLibre updates marker projection as part of its resize cycle.
    // Fit on the next frame so we don't pan against stale screen positions.
    map.on("resize", scheduleFit);
    scheduleFit();
    return () => {
      observer.disconnect();
      map.off("resize", scheduleFit);
      cancelAnimationFrame(frame);
    };
  }, [selectedId, map]);

  useEffect(() => {
    const nextExpiry = Math.min(
      ...hazards
        .map((hazard) =>
          hazard.expiredAt ? Date.parse(hazard.expiredAt) : Infinity,
        )
        .filter((expires) => expires > now),
    );
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, Math.min(30_000, nextExpiry - Date.now())),
    );
    return () => clearTimeout(timer);
  }, [hazards, now]);

  useEffect(() => {
    if (!userLocation) return;
    const controller = new AbortController();
    getNearbyHazardReports(
      userLocation.lat,
      userLocation.lng,
      1000,
      controller.signal,
    )
      .then((res) => {
        if (!controller.signal.aborted && res.ok && res.data?.reports)
          setHazards(res.data.reports);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [userLocation]);

  useEffect(() => {
    const initial = selectionSnapshot.current;
    if (!reportId || initial?._id !== reportId) return;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    let poller: ReturnType<typeof createHazardReviewPoller> | undefined;
    const armExpiry = (report: HazardReport) => {
      clearTimeout(expiryTimer);
      const expires = report.expiredAt
        ? Date.parse(report.expiredAt)
        : Infinity;
      if (!Number.isFinite(expires) || expires <= Date.now()) return;
      expiryTimer = setTimeout(
        () => {
          setNow(Date.now()); // Remove already-decoded public bytes immediately.
          poller?.refresh();
        },
        Math.min(2_147_483_647, expires - Date.now()),
      );
    };
    poller = createHazardReviewPoller({
      initial,
      visibility: document,
      load: async (signal) => {
        const response = await getHazardReport(reportId, signal);
        const report = response.data?.report;
        if (!(response.ok || response.success) || report?._id !== reportId)
          throw new Error("Invalid report response");
        return report;
      },
      onReport: (report) => {
        // Public DTOs may omit owner identity; preserve locally known identity,
        // but a missing/null public URL must always revoke the displayed photo.
        const next = {
          ...report,
          publicPhotoUrl: report.publicPhotoUrl ?? null,
        };
        setHazards((previous) =>
          previous.map((item) =>
            item._id === reportId ? { ...item, ...next } : item,
          ),
        );
        setSelected((previous) =>
          previous?._id === reportId ? { ...previous, ...next } : previous,
        );
        armExpiry(next);
      },
      onNotice: (notice) => {
        if (notice !== "missing") return;
        setSelected((previous) =>
          previous?._id === reportId ? null : previous,
        );
        setHazards((previous) =>
          previous.filter((item) => item._id !== reportId),
        );
      },
    });
    armExpiry(initial);
    poller.refresh(); // Refresh the DTO on open, including terminal AI results.
    return () => {
      clearTimeout(expiryTimer);
      poller?.dispose();
    };
  }, [reportId]);

  const handleVote = async (
    report: HazardReport,
    action: "confirm" | "deny",
  ) => {
    setVotingId(report._id);
    try {
      const res = await confirmHazardReport(report._id, action);
      if (res.ok && res.data) {
        const { confirmCount, denyCount } = res.data;
        setHazards((prev) =>
          prev.map((h) =>
            h._id === report._id ? { ...h, confirmCount, denyCount } : h,
          ),
        );
        setSelected((prev) =>
          prev && prev._id === report._id
            ? { ...prev, confirmCount, denyCount }
            : prev,
        );
        setVotedIds((prev) => new Set(prev).add(report._id));
        toast.success(
          t(
            action === "confirm"
              ? "hazardVoteConfirmSuccess"
              : "hazardVoteDenySuccess",
          ),
        );
      }
    } catch (err) {
      if (err instanceof ApiError && err.reason) {
        const messageKey = VOTE_ERROR_MESSAGE_KEYS[err.reason];
        if (messageKey) {
          toast.error(t(messageKey));
          if (err.reason === "ALREADY_VOTED") {
            setVotedIds((prev) => new Set(prev).add(report._id));
          }
          return;
        }
      }
      toast.error(t("hazardVoteFailed"));
    } finally {
      setVotingId(null);
    }
  };

  if (hazards.length === 0) return null;

  return (
    <>
      {hazards
        .filter((h) => !hazardExpired(h, now))
        .map((h) => {
          const [lng, lat] = h.reportedLocation.coordinates;
          return (
            <Marker
              key={h._id}
              longitude={lng}
              latitude={lat}
              anchor="center"
              ref={(marker) => {
                // The native button below owns semantics and keyboard input;
                // suppress MapLibre's additional generic "Map marker" role.
                const element = marker?.getElement();
                element?.setAttribute("role", "presentation");
                element?.setAttribute("aria-label", "");
              }}
            >
              <button
                type="button"
                aria-label={t(
                  h.hazardType === "data_error" ? "dataError" : h.hazardType,
                )}
                onClick={(event) => {
                  event.stopPropagation();
                  selectionSnapshot.current = h;
                  setSelected(h);
                }}
                onKeyDown={(event) => event.stopPropagation()}
                className="flex size-11 cursor-pointer items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <span
                  className={`flex size-8 items-center justify-center rounded-full border-2 bg-background text-foreground shadow-md ${h.status === "verified" ? "border-primary" : "border-muted-foreground"}`}
                >
                  <AlertTriangle className="size-4" aria-hidden="true" />
                </span>
              </button>
            </Marker>
          );
        })}

      {selected && !hazardExpired(selected, now) && (
        <Popup
          longitude={selected.reportedLocation.coordinates[0]}
          latitude={selected.reportedLocation.coordinates[1]}
          anchor="bottom"
          offset={22}
          maxWidth="none"
          onClose={() => setSelected(null)}
          closeOnClick={false}
          closeButton={false}
          className="hazard-map-popup"
        >
          <article
            ref={popupContent}
            key={selected._id}
            className="w-[min(336px,calc(100vw-88px))] max-h-[min(640px,calc(88dvh-32px))] overflow-y-auto overscroll-contain break-words font-sans text-popover-foreground md:max-h-[min(640px,calc(100dvh-100px))]"
          >
            <header className="flex items-start gap-3 border-b border-border/60 p-4 pb-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
                <AlertTriangle className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <h2 className="text-base font-semibold leading-snug">
                  {t(
                    selected.hazardType === "data_error"
                      ? "dataError"
                      : selected.hazardType,
                  )}
                </h2>
                {selected.severity && (
                  <p className="text-xs text-muted-foreground">
                    {t(
                      {
                        blocking: "severityBlocking",
                        difficult: "severityDifficult",
                        minor: "severityMinor",
                      }[selected.severity],
                    )}
                  </p>
                )}
              </div>
              <div className="-mr-2 -mt-2 flex shrink-0 items-center">
                <ContentSafetyMenu
                  target={{
                    targetType: "hazard_report",
                    targetId: selected._id,
                  }}
                  canBlock={selected.canBlockAuthor === true}
                  isOwn={Boolean(user?._id && selected.reporterId === user._id)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-lg"
                  className="rounded-full"
                  aria-label={t("hazardReviewClose")}
                  onClick={() => setSelected(null)}
                >
                  <X className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </header>
            <div className="space-y-4 p-4">
              {selected.description && (
                <p className="text-base leading-relaxed">
                  {selected.description}
                </p>
              )}
              {selected.publicPhotoUrl && (
                <figure className="space-y-2">
                  <PublicHazardReportPhoto
                    publicPhotoUrl={selected.publicPhotoUrl}
                    expiredAt={selected.expiredAt}
                  />
                  <figcaption className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Camera className="size-3.5" aria-hidden="true" />
                    {t("hazardPhoto")}
                  </figcaption>
                </figure>
              )}
              <section
                aria-label={t("reportReviewSummary")}
                className="space-y-2 rounded-xl border border-border/60 bg-muted/40 p-3"
              >
                <p className="text-sm font-medium leading-relaxed">
                  {t(hazardReviewStatus(selected, now))}
                </p>
                {selected.aiReview?.reason && (
                  <details className="group text-sm">
                    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-md text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
                      {t("reportReviewSummary")}
                      <ChevronDown
                        className="size-4 shrink-0 group-open:rotate-180"
                        aria-hidden="true"
                      />
                    </summary>
                    <p className="pt-1 text-muted-foreground leading-relaxed">
                      {selected.aiReview.reason}
                    </p>
                  </details>
                )}
              </section>
              <section
                aria-label={t("reportCommunity")}
                className="space-y-3 border-t border-border/60 pt-3"
              >
                <h3 className="text-xs font-medium text-muted-foreground">
                  {t("reportCommunity")}
                </h3>
                <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
                  <p className="flex items-center gap-1.5">
                    <ThumbsUp
                      className="size-3.5 shrink-0"
                      aria-hidden="true"
                    />
                    <span>{t("reportConfirmCount")}</span>
                    <strong className="ml-auto text-sm tabular-nums text-foreground">
                      {selected.confirmCount ?? 0}
                    </strong>
                  </p>
                  <p className="flex items-center gap-1.5">
                    <ThumbsDown
                      className="size-3.5 shrink-0"
                      aria-hidden="true"
                    />
                    <span>{t("reportDenyCount")}</span>
                    <strong className="ml-auto text-sm tabular-nums text-foreground">
                      {selected.denyCount ?? 0}
                    </strong>
                  </p>
                </div>
                {hazardCanConfirm(selected, now) &&
                  selected.reporterId !== user?._id &&
                  (votedIds.has(selected._id) ? (
                    <p
                      role="status"
                      className="rounded-xl bg-muted p-3 text-sm text-muted-foreground"
                    >
                      {t("hazardVoted")}
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        onClick={() => handleVote(selected, "confirm")}
                        disabled={votingId === selected._id}
                        className="min-h-11 h-auto whitespace-normal rounded-xl px-2 py-2"
                      >
                        <ThumbsUp className="size-4" aria-hidden="true" />
                        {t("confirmHazard")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => handleVote(selected, "deny")}
                        disabled={votingId === selected._id}
                        className="min-h-11 h-auto whitespace-normal rounded-xl px-2 py-2"
                      >
                        <ThumbsDown className="size-4" aria-hidden="true" />
                        {t("denyHazard")}
                      </Button>
                    </div>
                  ))}
              </section>
            </div>
          </article>
        </Popup>
      )}
    </>
  );
}
