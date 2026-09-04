"use client";

import { useCallback, useEffect, useRef } from "react";
import { useAppTranslation } from "@/i18n/client";
import { getRouteInstructions } from "@/lib/api/a11y";
import {
  bearingDeg,
  buildCumulativePath,
  type CumulativePath,
  haversineMeters,
  normalizeDeg,
  projectToPath,
  shortestAngleLerp,
} from "@/lib/geo";
import { requestForegroundLocationFix } from "@/lib/navigation/foregroundLocation";
import {
  isVehicleLegType,
  type NavLegType,
  navThresholdsFor,
  resolveActiveLegType,
  resolveCurrentLegType,
  resolveNavHeading,
  selectNextStepIndex,
} from "@/lib/navigation/legMode";
import {
  createNavigationGeometryRuntime,
  observeLocalNavigationGeometry,
  replaceNavigationGeometryRuntime,
} from "@/lib/navigation/navigationGeometryRuntime";
import useMapStore from "@/stores/useMapStore";
import useNavStore, { type HeadingSource } from "@/stores/useNavStore";
import type { LatLng } from "@/types";
import useRouteReroute from "./useRouteReroute";

// Tuning constants for the turn-by-turn engine. The distance thresholds are
// leg-type dependent (see lib/navigation/legMode) — a car needs a far wider
// maneuver and off-route radius than a pedestrian.
const OFF_ROUTE_HITS = 3; // consecutive off-route samples before flagging
const MANUAL_LOCK_MS = 8000; // honor a manual step change for this long
const CAMERA_THROTTLE_MS = 350;
const HEADING_WRITE_MS = 200;
const COMPASS_FRESH_MS = 1500;
const NAV_PITCH = 60;
const NAV_ZOOM = 17.5;
const NAV_ZOOM_VEHICLE = 16.5; // a car needs more road ahead in frame
const HANDOFF_EASE_MS = 900; // drive → walk camera re-frame
const SMOOTH_FACTOR = 0.25;
const INTRO_EASE_MS = 1200; // nav-start camera animation
const PREVIEW_EASE_MS = 800; // step-preview camera animation
const FOLLOW_GPS_MAX_M = 500; // beyond this from the route, GPS stops driving the camera

/** GPS may anchor the camera only when the fix is reasonably close to the route. */
function gpsNearRoute(loc: LatLng | null, cp: CumulativePath | null): boolean {
  if (!loc || !cp || cp.path.length === 0) return false;
  return projectToPath(loc, cp.path, cp.cumM).perpDistM <= FOLLOW_GPS_MAX_M;
}

/** Camera pitch for the user's 3D/2D view choice. */
function navPitch(): number {
  return useNavStore.getState().viewMode === "2d" ? 0 : NAV_PITCH;
}

/** Camera zoom for the mode the given step belongs to. */
function navZoomForLeg(isVehicle: boolean): number {
  return isVehicle ? NAV_ZOOM_VEHICLE : NAV_ZOOM;
}

/** True on iOS 13+, where DeviceOrientation needs an explicit permission grant. */
function compassNeedsPermission(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (
      DeviceOrientationEvent as unknown as { requestPermission?: unknown }
    )?.requestPermission === "function"
  );
}

/**
 * The single turn-by-turn navigation engine. Mounted (via NavigationController)
 * only while `isNavigating` is true. It loads instructions, auto-advances steps
 * from GPS, tracks heading (compass → GPS fallback), and imperatively drives the
 * map camera to follow + rotate. All high-frequency output goes to useNavStore;
 * the camera is driven via the map instance directly to avoid React re-renders.
 */
export default function useNavigation() {
  const { i18n } = useAppTranslation();
  const lang = i18n.language === "en" ? "en" : "zh-TW";

  const route = useMapStore((s) => s.selectRoute?.route ?? null);
  const userLocation = useMapStore((s) => s.userLocation);
  const compassPermission = useNavStore((s) => s.compassPermission);
  const navigationSource = useNavStore((s) => s.navigationSource);

  const currentStepIndex = useNavStore((s) => s.currentStepIndex);
  const instructions = useNavStore((s) => s.instructions);
  const { confirmOffRouteEpisode, clearOffRouteEpisode } = useRouteReroute();

  const geometryRef = useRef(createNavigationGeometryRuntime());
  const offHitsRef = useRef(0);
  // While the intro animation runs, the follow/preview cameras stay hands-off.
  const introUntilRef = useRef(0);
  // Same, for the drive → walk handoff ease: the 350 ms follow tick would
  // otherwise interrupt it mid-flight and snap the zoom.
  const cameraHoldUntilRef = useRef(0);

  // Heading working state (kept in refs; written to the store throttled).
  const compassRef = useRef<number | null>(null);
  const compassTsRef = useRef(0);
  const smoothRef = useRef<number | null>(null);
  const lastLegTypeRef = useRef<NavLegType | null>(null);

  useEffect(() => observeLocalNavigationGeometry(geometryRef.current), []);

  // ---- Composite-route handoff (e.g. drive to an accessible parking space,
  // then walk): the moment the active step crosses the vehicle/on-foot
  // boundary, drop the heading smoothed for the old mode — a car bearing
  // lerping into a walking bearing spins the marker — clear the off-route
  // streak accumulated at driving tolerances, and ease the camera to the new
  // mode's zoom instead of letting the follow tick jump it. ----
  const applyLegHandoff = useCallback((nextIndex: number) => {
    offHitsRef.current = 0;
    smoothRef.current = null;
    compassRef.current = null;
    compassTsRef.current = 0;

    const nav = useNavStore.getState();
    if (nav.isOffRoute) {
      nav.setIsOffRoute(false);
      nav.setRerouteIdle();
    }

    const { map, userLocation: loc } = useMapStore.getState();
    const target = geometryRef.current.waypoints[nextIndex]?.coord ?? loc;
    if (!map || !target) return;
    cameraHoldUntilRef.current = Date.now() + HANDOFF_EASE_MS;
    map.easeTo({
      center: [target.lng, target.lat],
      zoom: navZoomForLeg(
        isVehicleLegType(resolveActiveLegType(nav.instructions, nextIndex)),
      ),
      pitch: navPitch(),
      duration: HANDOFF_EASE_MS,
    });
  }, []);

  // ---- Nav-start camera: anchor on the user only when they're near the
  // route; otherwise frame the route start so the map never flies off to a
  // distant GPS fix (e.g. previewing a Taipei route from another city).
  // Uses requestAnimationFrame so the mobile bottom-sheet layout settles
  // before we animate, and flyTo for a dramatic zoom-in transition. ----
  useEffect(() => {
    if (!route) return;
    const id = requestAnimationFrame(() => {
      const { map, userLocation } = useMapStore.getState();
      const cp = buildCumulativePath(route.legs);
      geometryRef.current.path = cp;
      const anchor = gpsNearRoute(userLocation, cp)
        ? userLocation
        : (cp.path[0] ?? userLocation);
      if (!map || !anchor) return;
      introUntilRef.current = Date.now() + INTRO_EASE_MS;
      map.flyTo({
        center: [anchor.lng, anchor.lat],
        zoom: navZoomForLeg(isVehicleLegType(route.legs[0]?.type)),
        pitch: navPitch(),
        duration: INTRO_EASE_MS,
      });
    });
    return () => cancelAnimationFrame(id);
  }, [route]);

  // ---- Load instructions when navigation starts (passthrough legs only) ----
  useEffect(() => {
    if (!route || navigationSource === "voice") return;
    let cancelled = false;
    getRouteInstructions({
      route: route,
      userHeading: useNavStore.getState().userHeading ?? undefined,
      language: lang,
    })
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.data?.instructions) {
          replaceNavigationGeometryRuntime(
            geometryRef.current,
            route,
            res.data.instructions,
          );
          const cp = geometryRef.current.path;
          if (!cp) return;
          const nav = useNavStore.getState();
          nav.setNavigationIdentity(
            route.navigationId ?? null,
            route.routeVersion ?? 0,
          );
          nav.setInstructions(res.data.instructions, res.data.warnings ?? []);
          useNavStore
            .getState()
            .setRouteTotalM(cp.cumM[cp.cumM.length - 1] ?? null);
          if (process.env.NODE_ENV !== "production") {
            // Verify polylineIndex → coordinate mapping against real data.
            console.debug(
              "[nav] instructions loaded",
              res.data.instructions.length,
              "pts:",
              cp.path.length,
              "waypoints:",
              geometryRef.current.waypoints.map((w) => w.alongM.toFixed(0)),
            );
          }
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [route, lang, navigationSource]);

  // ---- Progress: project user onto route → advance step, distance, off-route ----
  useEffect(() => {
    if (!userLocation || navigationSource === "voice") return;
    const cp = geometryRef.current.path;
    const wps = geometryRef.current.waypoints;
    if (!cp || cp.path.length === 0 || wps.length === 0) return;

    const nav = useNavStore.getState();
    const proj = projectToPath(userLocation, cp.path, cp.cumM);

    // A fix far from the route can't drive progress — its projection is
    // meaningless (it would auto-advance to whatever segment is "nearest").
    // Leave the prev/next buttons in control instead.
    if (proj.perpDistM > FOLLOW_GPS_MAX_M) return;

    const activeLegType = resolveCurrentLegType(
      nav.instructions,
      wps,
      proj.alongM,
    );
    const thresholds = navThresholdsFor(activeLegType);

    // Off-route: require a few consecutive far samples before flagging.
    if (proj.perpDistM > thresholds.offRouteM) {
      offHitsRef.current += 1;
      if (offHitsRef.current >= OFF_ROUTE_HITS) {
        if (!nav.isOffRoute) nav.setIsOffRoute(true);
        confirmOffRouteEpisode(userLocation);
      }
    } else {
      offHitsRef.current = 0;
      if (nav.isOffRoute) {
        nav.setIsOffRoute(false);
        nav.setRerouteIdle();
      }
      clearOffRouteEpisode();
    }

    // Next maneuver = first waypoint still ahead of the user along the route,
    // each measured against its own leg's arrive radius.
    const nextIdx = selectNextStepIndex(nav.instructions, wps, proj.alongM);

    // Auto-advance forward only; honor a recent manual override briefly.
    const manualActive = Date.now() - nav.lastManualTs < MANUAL_LOCK_MS;
    const displayIdx =
      !manualActive && nextIdx > nav.currentStepIndex
        ? nextIdx
        : nav.currentStepIndex;
    if (displayIdx !== nav.currentStepIndex) {
      nav.setCurrentStepIndex(displayIdx);
    }

    if (
      lastLegTypeRef.current !== null &&
      activeLegType !== null &&
      isVehicleLegType(lastLegTypeRef.current) !==
        isVehicleLegType(activeLegType)
    ) {
      applyLegHandoff(displayIdx);
    }
    lastLegTypeRef.current = activeLegType;

    const totalM = cp.cumM[cp.cumM.length - 1] ?? 0;
    const remainingMeters = Math.max(0, totalM - proj.alongM);
    const totalSec =
      route?.totalMinutes != null ? route.totalMinutes * 60 : null;
    const remainingSec =
      totalSec != null && totalM > 0
        ? Math.round(totalSec * (remainingMeters / totalM))
        : null;
    const target = wps[Math.min(displayIdx, wps.length - 1)];
    nav.setProgress({
      distanceToNextM: target ? Math.max(0, target.alongM - proj.alongM) : null,
      remainingM: remainingMeters,
      remainingDurationSec: remainingSec,
      estimatedArrivalAt:
        remainingSec != null ? Date.now() + remainingSec * 1000 : null,
      etaSource: "local",
    });

    // Arrival: close to the final maneuver point, at the final leg's radius
    // (a drive-only route ends at a parking space, not on a doorstep).
    const finalWp = wps[wps.length - 1];
    const finalThresholds = navThresholdsFor(
      resolveActiveLegType(nav.instructions, nav.instructions.length - 1),
    );
    if (
      finalWp?.coord &&
      haversineMeters(userLocation, finalWp.coord) <
        finalThresholds.finalArriveM
    ) {
      if (!nav.arrived) nav.setArrived(true);
    }
  }, [
    userLocation,
    navigationSource,
    confirmOffRouteEpisode,
    clearOffRouteEpisode,
    applyLegHandoff,
    route?.totalMinutes,
  ]);

  // ---- Step-preview camera: when GPS can't anchor the camera (missing or
  // far from the route), track the active maneuver instead so prev/next and
  // auto-advance pan the map along the route like a route preview. ----
  useEffect(() => {
    if (instructions.length === 0) return;
    const wp = geometryRef.current.waypoints[currentStepIndex];
    useNavStore.getState().setStepCoord(wp?.coord ?? null);
    if (!wp?.coord) return;
    const { map, userLocation } = useMapStore.getState();
    if (!map) return;
    if (gpsNearRoute(userLocation, geometryRef.current.path)) return; // GPS follow owns the camera
    // The intro already frames the route start; skip the duplicate first ease.
    if (currentStepIndex === 0 && Date.now() < introUntilRef.current) return;
    const next = geometryRef.current.waypoints[currentStepIndex + 1];
    map.easeTo({
      center: [wp.coord.lng, wp.coord.lat],
      zoom: NAV_ZOOM,
      pitch: navPitch(),
      bearing: next?.coord
        ? bearingDeg(wp.coord, next.coord)
        : map.getBearing(),
      duration: PREVIEW_EASE_MS,
    });
  }, [currentStepIndex, instructions]);

  // ---- Foreground return: the geolocation watch is suspended while the app
  // is backgrounded, so the stored fix can be minutes old the moment the user
  // looks at the screen again. Ask for one fresh high-accuracy fix; writing it
  // to the map store is what re-runs the progress projection and (in voice
  // navigation) forwards the latest position to the backend. ----
  useEffect(() => {
    if (typeof document === "undefined") return;
    const handleVisibilityChange = () => {
      requestForegroundLocationFix({
        isVisible: () => document.visibilityState === "visible",
        geolocation:
          typeof navigator === "undefined" ? null : navigator.geolocation,
        onPosition: (location, heading) => {
          if (heading != null) useNavStore.getState().setGpsHeading(heading);
          useMapStore.getState().setUserLocation(location);
        },
      });
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  // ---- 3D/2D toggle: re-pitch the camera in place when the mode changes ----
  const viewMode = useNavStore((s) => s.viewMode);
  useEffect(() => {
    // The mount run (and StrictMode's re-run) lands inside the intro window —
    // skipping it keeps this effect from cancelling the intro animation.
    if (Date.now() < introUntilRef.current) return;
    const map = useMapStore.getState().map;
    if (!map) return;
    map.easeTo({ pitch: viewMode === "2d" ? 0 : NAV_PITCH, duration: 500 });
  }, [viewMode]);

  // ---- Compass listener (re-attaches when iOS permission flips to granted) ----
  useEffect(() => {
    if (typeof window === "undefined") return;
    // On iOS we only attach once granted; elsewhere no permission is needed.
    if (compassNeedsPermission() && compassPermission !== "granted") return;

    const handler = (e: DeviceOrientationEvent) => {
      let h: number | null = null;
      const webkit = (e as unknown as { webkitCompassHeading?: number })
        .webkitCompassHeading;
      if (typeof webkit === "number" && !Number.isNaN(webkit)) {
        h = webkit; // iOS: already clockwise from true north
      } else if (e.absolute && typeof e.alpha === "number") {
        h = normalizeDeg(360 - e.alpha); // alpha is counterclockwise from north
      }
      if (h != null) {
        compassRef.current = h;
        compassTsRef.current = Date.now();
      }
    };

    const evt =
      "ondeviceorientationabsolute" in window
        ? "deviceorientationabsolute"
        : "deviceorientation";
    window.addEventListener(evt, handler as EventListener);
    return () => window.removeEventListener(evt, handler as EventListener);
  }, [compassPermission]);

  // ---- Pause camera-follow when the user drags the map; resume via button ----
  useEffect(() => {
    const map = useMapStore.getState().map;
    if (!map) return;
    const pause = () => useNavStore.getState().setFollowPaused(true);
    map.on("dragstart", pause);
    return () => {
      map.off("dragstart", pause);
    };
  }, []);

  // ---- Camera + heading loop: follow user, rotate to heading (throttled) ----
  useEffect(() => {
    if (typeof window === "undefined") return;
    let rafId = 0;
    let lastCamTs = 0;
    let lastHeadingTs = 0;

    const tick = () => {
      rafId = requestAnimationFrame(tick);
      // Stop touching the camera the instant navigation ends (before unmount).
      if (!useMapStore.getState().isNavigating) return;

      const now = Date.now();
      const map = useMapStore.getState().map;
      const loc = useMapStore.getState().userLocation;
      if (!map) return;

      // Resolve heading. Walking: a fresh compass wins. Driving: GPS
      // course-over-ground wins — a cradled phone's compass points wherever
      // the mount does, not where the vehicle is going.
      const nav = useNavStore.getState();
      const currentLeg =
        geometryRef.current.path && geometryRef.current.waypoints.length && loc
          ? resolveCurrentLegType(
              nav.instructions,
              geometryRef.current.waypoints,
              projectToPath(
                loc,
                geometryRef.current.path.path,
                geometryRef.current.path.cumM,
              ).alongM,
            )
          : resolveActiveLegType(nav.instructions, nav.currentStepIndex);
      const isVehicle = isVehicleLegType(currentLeg);
      const resolved = resolveNavHeading({
        isVehicle,
        compassHeading: compassRef.current,
        compassAgeMs: now - compassTsRef.current,
        compassFreshMs: COMPASS_FRESH_MS,
        gpsHeading: nav.gpsHeading,
        userHeading: nav.userHeading,
        headingSource: nav.headingSource,
      });
      const raw: number | null = resolved?.heading ?? null;
      const source: HeadingSource = resolved?.source ?? null;

      let smoothed: number | null = smoothRef.current;
      if (raw != null) {
        smoothed = shortestAngleLerp(
          smoothRef.current ?? raw,
          raw,
          SMOOTH_FACTOR,
        );
        smoothRef.current = smoothed;
        if (now - lastHeadingTs > HEADING_WRITE_MS) {
          useNavStore.getState().setUserHeading(Math.round(smoothed), source);
          lastHeadingTs = now;
        }
      }

      // Let the user inspect the map freely after a drag; the resume
      // button (NavigationController) re-enables follow.
      if (useNavStore.getState().followPaused) return;

      // Don't interrupt the handoff ease mid-flight.
      if (now < cameraHoldUntilRef.current) return;

      if (loc && now - lastCamTs > CAMERA_THROTTLE_MS) {
        // 3D: heading-up tilted follow. 2D: flat north-up plane, still
        // centered on the user.
        const is3D = useMapStore.getState().is3D;
        map.easeTo({
          center: [loc.lng, loc.lat],
          bearing: is3D ? (smoothed != null ? smoothed : map.getBearing()) : 0,
          pitch: is3D ? NAV_PITCH : 0,
          duration: CAMERA_THROTTLE_MS,
        });
        lastCamTs = now;
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);
}
