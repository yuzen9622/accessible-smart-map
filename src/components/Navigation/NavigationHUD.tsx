"use client";

import {
  Bike,
  Car,
  CheckCircle2,
  Footprints,
  List,
  RefreshCw,
  Square,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import useComputeRoute from "@/hook/useComputeRoute";
import { useAppTranslation } from "@/i18n/client";
import { getNearbyHazardReports } from "@/lib/api/a11y";
import { haversineMeters } from "@/lib/geo";
import {
  findLegHandoffIndex,
  isVehicleLegType,
  resolveActiveLegType,
} from "@/lib/navigation/legMode";
import { localRerouteCoordinator } from "@/lib/navigation/localRerouteCoordinator";
import { stopNavigation } from "@/lib/navigation/navigationLifecycle";
import useMapStore from "@/stores/useMapStore";
import useNavStore, { type NavRerouteReason } from "@/stores/useNavStore";
import type { LatLng } from "@/types";
import {
  formatDistance,
  type HazardReport,
  type SlimOsmA11y,
} from "@/types/route";
import {
  TriangleAlertIcon,
  type TriangleAlertIconHandle,
} from "../ui/triangle-alert-icon";
import { stepIcon } from "./navStepIcon";
import type { RecalculateContext } from "./RecalculateOverlay";
import RecalculateOverlay from "./RecalculateOverlay";

const FACILITY_ALERT_M = 250;
const HAZARD_ALERT_M = 200;
const HAZARD_POLL_MS = 60_000;

/** Plays the alert wiggle once as soon as an amber alert card mounts, instead
 * of waiting for a hover that touch devices never send. Shared by every
 * auto-popping in-nav warning (off-route, hazard, step-unavailable) so they
 * read as one consistent alert language. */
function AlertPulseIcon() {
  const ref = useRef<TriangleAlertIconHandle>(null);
  useEffect(() => {
    ref.current?.startAnimation();
  }, []);
  return (
    <TriangleAlertIcon
      ref={ref}
      size={20}
      className="shrink-0"
      isAnimated={false}
    />
  );
}

const FACILITY_LABEL_KEY: Record<SlimOsmA11y["category"], string> = {
  elevator: "elevator",
  ramp: "ramp",
  toilet: "toilet",
  kerb_cut: "facility",
  wheelchair_accessible: "facility",
};

const REROUTE_REASON_KEY: Record<NavRerouteReason, string> = {
  OFF_ROUTE: "rerouteReasonOffRoute",
  FACILITY_OUTAGE: "rerouteReasonFacilityOutage",
  CONFIRMED_HAZARD: "rerouteReasonHazard",
  TRANSIT_DISRUPTION: "rerouteReasonTransitDisruption",
  MANUAL: "rerouteReasonManual",
};

/**
 * Map-first navigation chrome, per the approved redesign: a Google-Maps-style
 * top instruction banner with a "then" preview, accessibility-aware proximity
 * pills, and a bottom ETA status bar. Mounted only while navigating.
 */
export default function NavigationHUD() {
  const { t, i18n } = useAppTranslation();
  const { selectRoute, userLocation } = useMapStore(
    useShallow((s) => ({
      selectRoute: s.selectRoute,
      userLocation: s.userLocation,
    })),
  );
  const { handleComputeRoute, isLoading } = useComputeRoute();

  const instructions = useNavStore((s) => s.instructions);
  const currentStep = useNavStore((s) => s.currentStepIndex);
  const distanceToNextM = useNavStore((s) => s.distanceToNextM);
  const remainingM = useNavStore((s) => s.remainingM);
  const routeTotalM = useNavStore((s) => s.routeTotalM);
  const remainingDurationSec = useNavStore((s) => s.remainingDurationSec);
  const estimatedArrivalAt = useNavStore((s) => s.estimatedArrivalAt);
  const isOffRoute = useNavStore((s) => s.isOffRoute);
  const arrived = useNavStore((s) => s.arrived);
  const voiceEnabled = useNavStore((s) => s.voiceEnabled);
  const navigationSource = useNavStore((s) => s.navigationSource);
  const rerouteStatus = useNavStore((s) => s.rerouteStatus);
  const rerouteError = useNavStore((s) => s.rerouteError);
  const rerouteRetryable = useNavStore((s) => s.rerouteRetryable);
  const stepListOpen = useNavStore((s) => s.stepListOpen);
  const setStepListOpen = useNavStore((s) => s.setStepListOpen);
  const setVoiceEnabled = useNavStore((s) => s.setVoiceEnabled);
  const warnings = useNavStore((s) => s.warnings);
  const advisories = useNavStore((s) => s.advisories);
  const dismissAdvisory = useNavStore((s) => s.dismissAdvisory);
  const lastRerouteReason = useNavStore((s) => s.lastRerouteReason);

  const route = selectRoute?.route;

  const activeNavWarnings = useMemo(() => {
    const list: string[] = [];
    if (!warnings) return list;
    const walkStepsUnavailable =
      warnings.includes("WALK_STEPS_UNAVAILABLE") ||
      warnings.includes("ORS_STEPS_UNAVAILABLE");
    if (walkStepsUnavailable) {
      list.push(t("walkStepsUnavailable"));
    }
    if (warnings.includes("ROAD_STEPS_UNAVAILABLE")) {
      list.push(t("roadStepsUnavailable"));
    }
    return list;
  }, [warnings, t]);
  const step = instructions[currentStep];
  const nextStep = instructions[currentStep + 1];
  const StepIcon = stepIcon(step);
  const NextIcon = stepIcon(nextStep);

  // ---- Travel-mode chrome: driving legs get their own badge, and a
  // composite route (drive to an accessible parking space, then walk) warns
  // the driver before the mode changes under them. ----
  const activeLegType = resolveActiveLegType(instructions, currentStep);
  const isVehicleLeg = isVehicleLegType(activeLegType);
  const ModeIcon = activeLegType === "MOTORCYCLE" ? Bike : Car;
  const modeLabel =
    activeLegType === "MOTORCYCLE" ? t("motorcycle") : t("drive");
  const handoffIndex = findLegHandoffIndex(instructions, currentStep);
  const handoffStep =
    handoffIndex != null ? instructions[handoffIndex] : undefined;

  // ---- Voice announcements (state lives in the store; UI toggle sits in the
  // right-hand control stack) ----
  const synthRef = useRef<SpeechSynthesis | null>(null);
  useEffect(() => {
    if (typeof window !== "undefined")
      synthRef.current = window.speechSynthesis;
    return () => synthRef.current?.cancel();
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (
        navigationSource === "voice" ||
        !useNavStore.getState().voiceEnabled ||
        !synthRef.current
      )
        return;
      synthRef.current.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = i18n.language === "zh-TW" ? "zh-TW" : "en-US";
      utter.rate = 0.9;
      synthRef.current.speak(utter);
    },
    [i18n.language, navigationSource],
  );

  useEffect(() => {
    const s = instructions[currentStep];
    if (s) speak(s.text);
  }, [currentStep, instructions, speak]);

  useEffect(() => {
    if (arrived) speak(t("arrivedDesc"));
  }, [arrived, speak, t]);

  useEffect(() => {
    if (!voiceEnabled) synthRef.current?.cancel();
  }, [voiceEnabled]);

  // ---- Upcoming accessible facility (from the route's own walk-leg data) ----
  const routeFacilities = useMemo(() => {
    if (!route) return [];
    const seen = new Set<string>();
    const out: { name: string; position: LatLng }[] = [];
    for (const leg of route.legs) {
      if (leg.type !== "WALK") continue;
      for (const f of leg.a11yFacilities ?? []) {
        if (seen.has(f.osmId)) continue;
        seen.add(f.osmId);
        out.push({
          name: t(FACILITY_LABEL_KEY[f.category] ?? "facility"),
          position: {
            lat: f.location.coordinates[1],
            lng: f.location.coordinates[0],
          },
        });
      }
    }
    return out;
  }, [route, t]);

  const facilityAlert = useMemo(() => {
    if (!userLocation || routeFacilities.length === 0) return null;
    let best: { name: string; distance: number } | null = null;
    for (const f of routeFacilities) {
      const d = haversineMeters(userLocation, f.position);
      if (d < FACILITY_ALERT_M && (!best || d < best.distance)) {
        best = { name: f.name, distance: d };
      }
    }
    return best;
  }, [routeFacilities, userLocation]);

  // ---- Nearby hazard reports (polled while navigating) ----
  const [hazards, setHazards] = useState<HazardReport[]>([]);
  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      const loc = useMapStore.getState().userLocation;
      if (!loc) return;
      getNearbyHazardReports(loc.lat, loc.lng, HAZARD_ALERT_M)
        .then((res) => {
          if (!cancelled && res.ok && res.data?.reports)
            setHazards(res.data.reports);
        })
        .catch(() => {});
    };
    poll();
    const timer = setInterval(poll, HAZARD_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const hazardAlert = useMemo(() => {
    if (!userLocation || hazards.length === 0) return null;
    let best: { type: string; distance: number } | null = null;
    for (const h of hazards) {
      const d = haversineMeters(userLocation, {
        lat: h.reportedLocation.coordinates[1],
        lng: h.reportedLocation.coordinates[0],
      });
      if (d < HAZARD_ALERT_M && (!best || d < best.distance)) {
        best = {
          type: t(h.hazardType === "data_error" ? "dataError" : h.hazardType),
          distance: d,
        };
      }
    }
    return best;
  }, [hazards, userLocation, t]);

  // ---- Recalculate (off-route strip + hazard alternate-route button) ----
  const destination = useMapStore((s) => s.destination);
  const [recalcOverlay, setRecalcOverlay] = useState(false);
  const recalcMinTimeRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const recalcContext = useMemo<RecalculateContext>(
    () => ({
      hazardCount: hazards.length,
      facilityCount: routeFacilities.length,
    }),
    [hazards.length, routeFacilities.length],
  );

  const isRecalcBusy = isLoading || recalcOverlay;

  const handleRecalculate = useCallback(() => {
    if (!destination || recalcOverlay) {
      if (!destination) toast.error(t("recalculateFailed"));
      return;
    }
    setRecalcOverlay(true);
    const minTimer = new Promise<void>((resolve) => {
      recalcMinTimeRef.current = setTimeout(resolve, 800);
    });
    const routePromise = handleComputeRoute({
      destination: destination.position,
    });
    void Promise.all([minTimer, routePromise]).then(() =>
      setRecalcOverlay(false),
    );
  }, [destination, handleComputeRoute, t, recalcOverlay]);

  useEffect(() => {
    return () => {
      if (recalcMinTimeRef.current) clearTimeout(recalcMinTimeRef.current);
    };
  }, []);

  // ---- ETA (proportional estimate over the whole route) ----
  const remainMinutes = useMemo(() => {
    if (remainingDurationSec != null)
      return Math.max(1, Math.round(remainingDurationSec / 60));
    if (!route) return null;
    if (remainingM == null || !routeTotalM) return route.totalMinutes;
    return Math.max(
      1,
      Math.round(route.totalMinutes * (remainingM / routeTotalM)),
    );
  }, [remainingDurationSec, route, remainingM, routeTotalM]);

  const etaText = useMemo(() => {
    const target =
      estimatedArrivalAt != null
        ? new Date(estimatedArrivalAt)
        : remainMinutes != null
          ? new Date(Date.now() + remainMinutes * 60_000)
          : null;
    if (!target) return null;
    return target.toLocaleTimeString(
      i18n.language === "zh-TW" ? "zh-TW" : "en",
      {
        hour: "2-digit",
        minute: "2-digit",
      },
    );
  }, [estimatedArrivalAt, remainMinutes, i18n.language]);

  return (
    <>
      {/* ===== Top instruction banner — dark HUD ===== */}
      <div className="absolute top-3 left-3 right-3 lg:left-1/2 lg:right-auto lg:-translate-x-1/2 lg:w-[560px] z-40 space-y-2">
        {arrived ? (
          <motion.div
            role="alert"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-green-600 text-white rounded-2xl shadow-2xl p-5 flex items-center gap-4"
          >
            <div className="h-14 w-14 rounded-full bg-white/20 flex items-center justify-center shrink-0">
              <CheckCircle2 className="h-8 w-8" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xl font-bold leading-tight">{t("arrived")}</p>
              <p className="text-sm text-white/80 mt-0.5">{t("arrivedDesc")}</p>
            </div>
            <button
              type="button"
              onClick={stopNavigation}
              className="shrink-0 bg-white/20 hover:bg-white/30 rounded-full px-5 py-2.5 min-h-[44px] flex items-center text-sm font-semibold transition-colors"
            >
              {t("endNav")}
            </button>
          </motion.div>
        ) : (
          <div className="bg-slate-900 dark:ring-1 dark:ring-white/10 text-white rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center gap-5 px-6 py-6">
              <div className="h-[4.5rem] w-[4.5rem] rounded-2xl bg-white/10 flex items-center justify-center shrink-0">
                <StepIcon className="h-11 w-11" />
              </div>
              <div className="flex-1 min-w-0">
                {distanceToNextM != null && (
                  <p
                    className="text-5xl font-black leading-none mb-2 tabular-nums tracking-tight"
                    aria-hidden="true"
                  >
                    {formatDistance(distanceToNextM)}
                  </p>
                )}
                <p
                  aria-live="assertive"
                  aria-atomic="true"
                  className="text-base font-medium leading-snug text-white/90 line-clamp-2"
                >
                  {step?.text ?? t("preparingNav")}
                </p>
              </div>
              <div className="shrink-0 flex flex-col items-end gap-1.5">
                {isVehicleLeg && (
                  <span className="flex items-center gap-1.5 text-xs bg-white/15 rounded-full px-3 py-1.5 text-white/80 font-semibold">
                    <ModeIcon className="h-3.5 w-3.5 shrink-0" />
                    {modeLabel}
                  </span>
                )}
                {instructions.length > 0 && (
                  <span className="text-xs bg-white/10 rounded-full px-3 py-1.5 text-white/60 tabular-nums">
                    {t("stepOf", {
                      current: currentStep + 1,
                      total: instructions.length,
                    })}
                  </span>
                )}
              </div>
            </div>
            {nextStep && (
              <div className="flex items-center gap-2.5 bg-white/5 border-t border-white/10 px-6 py-3">
                <span className="text-xs text-white/40 shrink-0 font-medium uppercase tracking-wider">
                  {t("then")}
                </span>
                <NextIcon className="h-4.5 w-4.5 shrink-0 text-white/60" />
                <span className="text-sm text-white/70 truncate">
                  {nextStep.text}
                </span>
              </div>
            )}
            {handoffStep && (
              <div className="flex items-center gap-2.5 bg-white/5 border-t border-white/10 px-6 py-3">
                <Footprints className="h-4.5 w-4.5 shrink-0 text-white/60" />
                <span className="text-sm text-white/70 truncate">
                  {t("parkThenWalk")}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Off-route strip */}
        {(isOffRoute || rerouteStatus !== "idle") && !arrived && (
          <div
            role="alert"
            className="flex items-center gap-3 p-3 rounded-2xl bg-amber-500/95 text-white shadow-lg"
          >
            <AlertPulseIcon />
            <p className="flex-1 text-sm font-semibold">
              {rerouteError ??
                (rerouteStatus === "pending"
                  ? lastRerouteReason
                    ? t(REROUTE_REASON_KEY[lastRerouteReason])
                    : t("recalculate")
                  : t("offRoute"))}
            </p>
            {navigationSource === "local" &&
              (rerouteStatus !== "error" || rerouteRetryable) && (
                <button
                  type="button"
                  disabled={rerouteStatus === "pending"}
                  onClick={() => {
                    if (rerouteStatus === "error") {
                      void localRerouteCoordinator.retry(
                        userLocation ?? undefined,
                      );
                    } else {
                      void localRerouteCoordinator.triggerManualReroute(
                        "MANUAL",
                        userLocation ?? undefined,
                      );
                    }
                  }}
                  className="shrink-0 flex items-center gap-1.5 bg-white/25 hover:bg-white/35 rounded-full px-4 py-2.5 min-h-[44px] text-sm font-semibold transition-colors disabled:opacity-60"
                >
                  <RefreshCw
                    className={`h-4 w-4 ${
                      rerouteStatus === "pending" ? "animate-spin" : ""
                    }`}
                  />
                  {rerouteStatus === "error" ? t("retry") : t("recalculate")}
                </button>
              )}
          </div>
        )}

        {/* Recalculate overlay — shows what's being weighed while recalculating */}
        <RecalculateOverlay context={recalcContext} visible={recalcOverlay} />

        {/* Proactive advisories (facility / transit / hazard) */}
        {!arrived &&
          advisories.map((advisory) => (
            <div
              key={advisory.advisoryId}
              role={advisory.severity === "info" ? "status" : "alert"}
              className={`flex items-start gap-3 p-3 rounded-2xl shadow-lg text-white ${
                advisory.severity === "critical"
                  ? "bg-red-600/95"
                  : advisory.severity === "warning"
                    ? "bg-amber-500/95"
                    : "bg-slate-600/95"
              }`}
            >
              <AlertPulseIcon />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">{advisory.title}</p>
                {advisory.detail && (
                  <p className="text-xs opacity-90 mt-0.5">{advisory.detail}</p>
                )}
                <span className="sr-only">{advisory.speech}</span>
                {advisory.action === "reroute_suggested" && (
                  <div className="flex gap-2 mt-2">
                    <button
                      type="button"
                      disabled={isRecalcBusy || rerouteStatus === "pending"}
                      onClick={() => {
                        dismissAdvisory(advisory.advisoryId);
                        if (navigationSource === "local") {
                          void localRerouteCoordinator.triggerManualReroute(
                            advisory.rerouteReason ?? "MANUAL",
                            userLocation ?? undefined,
                          );
                        } else {
                          handleRecalculate();
                        }
                      }}
                      className="bg-white/25 hover:bg-white/35 rounded-full px-4 py-2.5 min-h-[44px] text-sm font-semibold transition-colors disabled:opacity-60"
                    >
                      {t("viewAlternative")}
                    </button>
                    <button
                      type="button"
                      onClick={() => dismissAdvisory(advisory.advisoryId)}
                      className="bg-white/10 hover:bg-white/20 rounded-full px-4 py-2.5 min-h-[44px] text-sm font-semibold transition-colors"
                    >
                      {t("keepRoute")}
                    </button>
                  </div>
                )}
                {advisory.action === "reroute_applied" && (
                  <p className="text-xs font-medium mt-1">
                    {t("rerouteApplied")}
                  </p>
                )}
              </div>
              {advisory.action === "none" && (
                <button
                  type="button"
                  aria-label={t("dismiss")}
                  onClick={() => dismissAdvisory(advisory.advisoryId)}
                  className="shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:bg-white/20 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}

        {/* Step Unavailable Warnings */}
        {!arrived &&
          activeNavWarnings.map((wMsg) => (
            <div
              key={wMsg}
              className="flex items-center gap-3 p-3 rounded-2xl bg-amber-500/95 text-white shadow-lg"
            >
              <AlertPulseIcon />
              <p className="flex-1 text-sm font-semibold">{wMsg}</p>
            </div>
          ))}
      </div>

      {/* ===== Accessibility-aware proximity pills ===== */}
      <div className="absolute left-3 bottom-[130px] lg:bottom-[96px] z-30 flex flex-col items-start gap-2 max-w-[80%]">
        <AnimatePresence>
          {facilityAlert && !arrived && (
            <motion.span
              key="facility"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="inline-flex items-center gap-2 bg-green-100/95 dark:bg-green-900/90 text-green-800 dark:text-green-200 text-sm font-medium px-4 py-2.5 rounded-full shadow-md backdrop-blur-sm"
            >
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              {t("facilityAhead", {
                distance: formatDistance(facilityAlert.distance),
                name: facilityAlert.name,
              })}
            </motion.span>
          )}
          {hazardAlert && !arrived && (
            <motion.div
              key="hazard"
              role="alert"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="flex items-center gap-2.5 bg-amber-100/95 dark:bg-amber-900/90 text-amber-800 dark:text-amber-200 text-sm font-medium px-4 py-3 rounded-2xl shadow-lg backdrop-blur-sm"
            >
              <AlertPulseIcon />
              <span className="flex-1 min-w-0">
                {t("hazardAhead", {
                  distance: formatDistance(hazardAlert.distance),
                  type: hazardAlert.type,
                })}
              </span>
              {navigationSource === "local" && (
                <button
                  type="button"
                  disabled={isRecalcBusy}
                  onClick={handleRecalculate}
                  className="shrink-0 bg-amber-700/20 dark:bg-amber-300/20 hover:bg-amber-700/30 dark:hover:bg-amber-300/30 font-semibold whitespace-nowrap px-4 py-2.5 min-h-[44px] rounded-full transition-colors disabled:opacity-50"
                >
                  {t("viewAlternative")}
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ===== Bottom dashboard — white bar ===== */}
      <div className="absolute bottom-3 left-3 right-3 lg:left-1/2 lg:right-auto lg:-translate-x-1/2 lg:w-[560px] xl:w-[640px] z-40">
        <div className="bg-background/95 backdrop-blur-md border border-border/50 rounded-2xl shadow-2xl px-5 py-4 flex items-center gap-4">
          <div className="flex-1 min-w-0 lg:flex-none">
            <p className="text-3xl font-black leading-tight text-green-600 dark:text-green-400 tabular-nums truncate">
              {remainMinutes != null
                ? t("minutesLeft", { count: remainMinutes })
                : "…"}
            </p>
            <p className="text-sm text-muted-foreground truncate tabular-nums mt-0.5">
              {remainingM != null && `${formatDistance(remainingM)} · `}
              {etaText && t("etaArrive", { time: etaText })}
            </p>
          </div>

          {nextStep && !arrived && (
            <div className="hidden lg:flex flex-1 items-center gap-2 min-w-0 px-3 py-2 rounded-xl bg-muted/50">
              <NextIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="text-sm text-muted-foreground truncate">
                {nextStep.text}
              </span>
            </div>
          )}
          {(!nextStep || arrived) && <div className="hidden lg:block flex-1" />}

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setVoiceEnabled(!voiceEnabled)}
              aria-label={voiceEnabled ? t("voiceOff") : t("voiceOn")}
              aria-pressed={voiceEnabled}
              className={`h-11 w-11 rounded-full flex items-center justify-center transition-colors ${
                voiceEnabled
                  ? "bg-primary/10 text-primary"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted"
              }`}
            >
              {voiceEnabled ? (
                <Volume2 className="h-5 w-5" />
              ) : (
                <VolumeX className="h-5 w-5" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setStepListOpen(!stepListOpen)}
              aria-label={t("stepList")}
              aria-pressed={stepListOpen}
              className={`h-11 w-11 rounded-full flex items-center justify-center transition-colors ${
                stepListOpen
                  ? "bg-primary/10 text-primary"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted"
              }`}
            >
              <List className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={stopNavigation}
              aria-label={t("endNav")}
              className="flex items-center justify-center gap-2 bg-red-500 hover:bg-red-600 text-white rounded-full h-12 w-12 sm:w-auto sm:px-6 text-sm font-bold transition-colors shadow-lg"
            >
              <Square className="h-4 w-4 shrink-0" />
              <span className="hidden sm:inline">{t("endNav")}</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
