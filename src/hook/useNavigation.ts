"use client";

import { useEffect, useRef } from "react";
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
import {
  createNavigationGeometryRuntime,
  observeLocalNavigationGeometry,
  replaceNavigationGeometryRuntime,
} from "@/lib/navigation/navigationGeometryRuntime";
import useMapStore from "@/stores/useMapStore";
import useNavStore, { type HeadingSource } from "@/stores/useNavStore";
import type { LatLng } from "@/types";
import useRouteReroute from "./useRouteReroute";

// Tuning constants for the turn-by-turn engine.
const ARRIVE_THRESHOLD_M = 18; // pass within this of a maneuver → advance step
const FINAL_ARRIVE_THRESHOLD_M = 25; // within this of the destination → arrived
const OFF_ROUTE_M = 40; // perpendicular distance from route to flag off-route
const OFF_ROUTE_HITS = 3; // consecutive off-route samples before flagging
const MANUAL_LOCK_MS = 8000; // honor a manual step change for this long
const CAMERA_THROTTLE_MS = 350;
const HEADING_WRITE_MS = 200;
const COMPASS_FRESH_MS = 1500;
const NAV_PITCH = 60;
const NAV_ZOOM = 17.5;
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

  // Heading working state (kept in refs; written to the store throttled).
  const compassRef = useRef<number | null>(null);
  const compassTsRef = useRef(0);
  const smoothRef = useRef<number | null>(null);

  useEffect(() => observeLocalNavigationGeometry(geometryRef.current), []);

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
        zoom: NAV_ZOOM,
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

    // Off-route: require a few consecutive far samples before flagging.
    if (proj.perpDistM > OFF_ROUTE_M) {
      offHitsRef.current += 1;
      if (offHitsRef.current >= OFF_ROUTE_HITS && !nav.isOffRoute) {
        nav.setIsOffRoute(true);
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

    // Next maneuver = first waypoint still ahead of the user along the route.
    let nextIdx = wps.findIndex(
      (w) => w.alongM > proj.alongM + ARRIVE_THRESHOLD_M,
    );
    if (nextIdx === -1) nextIdx = wps.length - 1;

    // Auto-advance forward only; honor a recent manual override briefly.
    const manualActive = Date.now() - nav.lastManualTs < MANUAL_LOCK_MS;
    const displayIdx =
      !manualActive && nextIdx > nav.currentStepIndex
        ? nextIdx
        : nav.currentStepIndex;
    if (displayIdx !== nav.currentStepIndex)
      nav.setCurrentStepIndex(displayIdx);

    const target = wps[Math.min(displayIdx, wps.length - 1)];
    nav.setDistanceToNextM(
      target ? Math.max(0, target.alongM - proj.alongM) : null,
    );

    // Whole-route progress for the ETA status bar.
    const totalM = cp.cumM[cp.cumM.length - 1] ?? 0;
    nav.setRemainingM(Math.max(0, totalM - proj.alongM));

    // Arrival: close to the final maneuver point.
    const finalWp = wps[wps.length - 1];
    if (
      finalWp?.coord &&
      haversineMeters(userLocation, finalWp.coord) < FINAL_ARRIVE_THRESHOLD_M
    ) {
      if (!nav.arrived) nav.setArrived(true);
    }
  }, [
    userLocation,
    navigationSource,
    confirmOffRouteEpisode,
    clearOffRouteEpisode,
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

      // Resolve heading: fresh compass wins, else GPS course-over-ground.
      let raw: number | null = null;
      let source: HeadingSource = null;
      if (
        compassRef.current != null &&
        now - compassTsRef.current < COMPASS_FRESH_MS
      ) {
        raw = compassRef.current;
        source = "compass";
      } else {
        const g = useNavStore.getState().gpsHeading;
        if (g != null) {
          raw = g;
          source = "gps";
        }
      }

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

  // ---- Reset runtime state when navigation ends (controller unmounts) ----
  useEffect(() => {
    return () => {
      useNavStore.getState().reset();
    };
  }, []);
}
