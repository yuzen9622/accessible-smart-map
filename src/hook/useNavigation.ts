"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAppTranslation } from "@/i18n/client";
import { getRouteInstructions } from "@/lib/api/a11y";
import { ApiError } from "@/lib/fetch";
import {
  bearingDeg,
  buildCumulativePath,
  type CumulativePath,
  haversineMeters,
  normalizeDeg,
  projectToPath,
  shortestAngleLerp,
} from "@/lib/geo";
import { remainingOutdoorDistanceToArrival } from "@/lib/indoor/arrivalTransition";
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
import {
  buildTransitGuide,
  findActiveBusRun,
  legAlongRange,
  rideStops,
} from "@/lib/navigation/transitRide";
import {
  guardBusProgress,
  newTransitRide,
  rememberVehicle,
} from "@/lib/navigation/transitRideRuntime";
import useMapStore from "@/stores/useMapStore";
import useNavStore, { type HeadingSource } from "@/stores/useNavStore";
import type { LatLng } from "@/types";
import type { NavInstruction } from "@/types/route";
import useRouteReroute from "./useRouteReroute";

// Tuning constants for the turn-by-turn engine. The distance thresholds are
// leg-type dependent (see lib/navigation/legMode) — a car needs a far wider
// maneuver and off-route radius than a pedestrian.
const OFF_ROUTE_HITS = 3; // consecutive off-route samples before flagging
const HEADING_WRITE_MS = 80;
const COMPASS_FRESH_MS = 1500;
const COMPASS_MIN_DELTA_DEG = 1;
const NAV_PITCH = 60;
const NAV_ZOOM = 18.3;
const NAV_ZOOM_VEHICLE = 17.3; // a car needs more road ahead in frame
const HANDOFF_EASE_MS = 900; // drive → walk camera re-frame
const INTRO_EASE_MS = 1200; // nav-start camera animation
const PREVIEW_EASE_MS = 800; // step-preview camera animation
const FOLLOW_GPS_MAX_M = 500; // beyond this from the route, GPS stops driving the camera
const HEADING_TAU_MS = 320;
const CENTER_TAU_MS = 260;
const CAMERA_DEAD_ZONE_DEG = 0.15;
const CAMERA_DEAD_ZONE_M = 0.15;

type CameraState = LatLng & { bearing: number };

/**
 * Steps handed over by the voice backend carry no `polylineIndex`, so every
 * waypoint would resolve to the route origin. Spreading them evenly along
 * their own leg keeps next-step selection and arrival detection usable when
 * the instructions endpoint never answers.
 */
export function withSyntheticPolylineIndices(
  instructions: NavInstruction[],
  { path, legRanges }: CumulativePath,
): NavInstruction[] {
  if (instructions.length === 0 || path.length === 0) return instructions;
  if (instructions.some((ins) => ins.polylineIndex != null))
    return instructions;

  const positionsByLeg = new Map<number, number[]>();
  instructions.forEach((ins, index) => {
    const legIndex = ins.legIndex ?? -1;
    const positions = positionsByLeg.get(legIndex);
    if (positions) positions.push(index);
    else positionsByLeg.set(legIndex, [index]);
  });

  const resolved = new Array<number>(instructions.length).fill(0);
  for (const [legIndex, positions] of positionsByLeg) {
    const range = legIndex >= 0 ? legRanges[legIndex] : undefined;
    // A resolvable leg range makes polylineIndex leg-relative; otherwise it is
    // an index into the whole concatenated path.
    const count = range && range.count > 0 ? range.count : path.length;
    positions.forEach((instructionIndex, position) => {
      const fraction =
        positions.length === 1 ? 1 : position / (positions.length - 1);
      resolved[instructionIndex] = Math.round(fraction * (count - 1));
    });
  }

  return instructions.map((ins, index) => ({
    ...ins,
    polylineIndex: resolved[index],
  }));
}

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

function smoothingFactor(dtMs: number, tauMs: number): number {
  return 1 - Math.exp(-dtMs / tauMs);
}

function angularDistanceDeg(a: number, b: number): number {
  return Math.abs(((b - a + 540) % 360) - 180);
}

/** True on iOS 13+, where DeviceOrientation needs an explicit permission grant. */
function compassNeedsPermission(): boolean {
  if (typeof window === "undefined") return false;
  // SAFETY: requestPermission is an iOS-only extension missing from the DOM
  // typings; the typeof check below is what proves it exists at runtime.
  const ctor = DeviceOrientationEvent as unknown as {
    requestPermission?: unknown;
  };
  return typeof ctor?.requestPermission === "function";
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

  const route = useMapStore(
    (s) => s.activeNavigationRoute ?? s.selectRoute?.route ?? null,
  );
  const userLocation = useMapStore((s) => s.userLocation);
  const indoorExploring = useMapStore((s) => s.indoorExploring);
  const compassPermission = useNavStore((s) => s.compassPermission);
  const navigationSource = useNavStore((s) => s.navigationSource);
  const navigationMode = useNavStore((s) => s.navigationMode);
  const boarded = useNavStore((s) => s.transitRide?.boarded ?? false);
  const liveBuses = useMapStore((s) => s.liveBusPositions);

  const currentStepIndex = useNavStore((s) => s.currentStepIndex);
  const instructions = useNavStore((s) => s.instructions);
  const { confirmOffRouteEpisode, clearOffRouteEpisode } = useRouteReroute();

  const geometryRef = useRef(createNavigationGeometryRuntime());
  const offHitsRef = useRef(0);
  // While the intro animation runs, the follow/preview cameras stay hands-off.
  const introUntilRef = useRef(0);
  // Same, for the drive → walk handoff ease: the follow loop would otherwise
  // interrupt it mid-flight and snap the zoom.
  const cameraHoldUntilRef = useRef(0);

  // Heading working state, kept in refs between camera frames.
  const compassRef = useRef<number | null>(null);
  const compassTsRef = useRef(0);
  const smoothRef = useRef<number | null>(null);
  const camRef = useRef<CameraState | null>(null);
  const lastLegTypeRef = useRef<NavLegType | null>(null);
  const previousNavigationSourceRef = useRef(navigationSource);
  // Bumped whenever a takeover swaps the geometry (carried steps first, exact
  // instructions after), so projection re-runs without waiting for a GPS fix.
  const [geometryEpoch, setGeometryEpoch] = useState(0);

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
    camRef.current = null;

    const nav = useNavStore.getState();
    if (nav.isOffRoute) {
      nav.setIsOffRoute(false);
      nav.setRerouteIdle();
    }

    const { map, userLocation: loc, indoorExploring } = useMapStore.getState();
    const target = geometryRef.current.waypoints[nextIndex]?.coord ?? loc;
    if (!map || !target || indoorExploring) return;
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
      const { map, userLocation, indoorExploring } = useMapStore.getState();
      const cp = buildCumulativePath(route.legs);
      geometryRef.current.path = cp;
      const anchor = gpsNearRoute(userLocation, cp)
        ? userLocation
        : (cp.path[0] ?? userLocation);
      if (!map || !anchor || indoorExploring) return;
      introUntilRef.current = Date.now() + INTRO_EASE_MS;
      camRef.current = null;
      map.flyTo({
        center: [anchor.lng, anchor.lat],
        zoom: navZoomForLeg(isVehicleLegType(route.legs[0]?.type)),
        pitch: navPitch(),
        duration: INTRO_EASE_MS,
        essential: true,
      });
    });
    return () => cancelAnimationFrame(id);
  }, [route]);

  // ---- Load instructions when navigation starts (passthrough legs only) ----
  useEffect(() => {
    const tookOverFromVoice = previousNavigationSourceRef.current === "voice";
    previousNavigationSourceRef.current = navigationSource;
    if (!route || navigationSource === "voice") return;
    let cancelled = false;
    const isCurrentRequest = () => {
      const map = useMapStore.getState();
      return (
        !cancelled &&
        map.isNavigating &&
        useNavStore.getState().navigationSource === "local" &&
        (map.activeNavigationRoute ?? map.selectRoute?.route) === route
      );
    };

    /**
     * Steps carried over from the voice backend have no `polylineIndex`, so
     * every waypoint would collapse onto the route origin. Spread them along
     * their own leg *immediately*, before the exact instructions are asked
     * for: turn-by-turn then keeps running on approximate distances instead
     * of freezing for as long as the request takes (or forever, if it never
     * answers).
     */
    const applyCarriedInstructions = () => {
      const nav = useNavStore.getState();
      const cp = buildCumulativePath(route.legs);
      const patched = withSyntheticPolylineIndices(nav.instructions, cp);
      if (patched !== nav.instructions) {
        const carriedAdvisories = nav.advisories;
        const carriedStepIndex = nav.currentStepIndex;
        nav.setNavigationIdentity(
          route.navigationId ?? null,
          route.routeVersion ?? 0,
        );
        nav.setInstructions(patched, nav.warnings);
        const restored = useNavStore.getState();
        restored.setCurrentStepIndex(
          Math.max(0, Math.min(carriedStepIndex, patched.length - 1)),
        );
        if (carriedAdvisories.length > 0) {
          restored.pushAdvisories(carriedAdvisories);
        }
      }
      replaceNavigationGeometryRuntime(
        geometryRef.current,
        route,
        useNavStore.getState().instructions,
      );
      useNavStore.getState().setRouteTotalM(cp.cumM.at(-1) ?? null);
      // The geometry settles outside React state, so projection has to be
      // kicked explicitly instead of waiting for the next GPS fix.
      setGeometryEpoch((epoch) => epoch + 1);
    };

    if (tookOverFromVoice) applyCarriedInstructions();

    // The instructions endpoint is keyed by routeToken only; without it there
    // is nothing to ask for, so a takeover runs on what it carried.
    const routeToken = route.routeToken;
    if (
      !routeToken ||
      useMapStore.getState().invalidRouteTokens.includes(routeToken)
    )
      return;

    getRouteInstructions({
      routeToken,
      userHeading: useNavStore.getState().userHeading ?? undefined,
      language: lang,
    })
      .then((res) => {
        if (!isCurrentRequest()) return;
        if (!res.ok || !res.data?.instructions) return;
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
        // setInstructions clears advisories because a replaced route
        // invalidates them — but taking over a live navigation from the
        // voice backend is not a route change, so the alerts must survive.
        const carriedAdvisories = tookOverFromVoice ? nav.advisories : [];
        nav.setInstructions(res.data.instructions, res.data.warnings ?? []);
        if (carriedAdvisories.length > 0) {
          useNavStore.getState().pushAdvisories(carriedAdvisories);
        }
        useNavStore
          .getState()
          .setRouteTotalM(cp.cumM[cp.cumM.length - 1] ?? null);
        // Upgrading from the synthetic geometry: re-project at once so the
        // approximate distances are corrected without waiting for a fix.
        if (tookOverFromVoice) setGeometryEpoch((epoch) => epoch + 1);
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
      })
      .catch((error: unknown) => {
        if (!isCurrentRequest()) return;
        if (
          error instanceof ApiError &&
          error.reason === "INVALID_ROUTE_TOKEN"
        ) {
          useMapStore.getState().invalidateRouteToken(routeToken);
          useMapStore.getState().setIsNavigating(false);
          useNavStore.getState().reset();
          toast.error("路線已過期，請重新規劃。");
        } else {
          toast.error("無法取得導航指引，請稍後再試。");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [route, lang, navigationSource]);

  // ---- Progress: project user onto route → advance step, distance, off-route ----
  useEffect(() => {
    if (
      !userLocation ||
      navigationSource === "voice" ||
      (typeof document !== "undefined" && document.hidden)
    )
      return;
    const cp = geometryRef.current.path;
    const wps = geometryRef.current.waypoints;
    if (!cp || cp.path.length === 0 || wps.length === 0) return;

    // A re-run trigger only: the takeover's geometry settles outside React
    // state, so projection has to be kicked explicitly when it changes.
    void geometryEpoch;
    void instructions;
    void navigationMode;
    void boarded;

    let nav = useNavStore.getState();
    const proj = projectToPath(userLocation, cp.path, cp.cumM);
    if (!Number.isFinite(proj.alongM) || !Number.isFinite(proj.perpDistM))
      return;
    if (nav.navigationMode === "preview") {
      const type = resolveCurrentLegType(nav.instructions, wps, proj.alongM);
      if (proj.perpDistM > navThresholdsFor(type).offRouteM) return;
      nav.promoteToLive();
      offHitsRef.current = 0;
      clearOffRouteEpisode();
      nav = useNavStore.getState();
    }

    // A fix far from the route can't drive progress — its projection is
    // meaningless (it would auto-advance to whatever segment is "nearest").
    // Leave the prev/next buttons in control instead.
    if (proj.perpDistM > FOLLOW_GPS_MAX_M) {
      if (nav.transitRide && !nav.transitRide.boarded)
        nav.setTransitRide(
          {
            ...nav.transitRide,
            sample: null,
            movingSamples: 0,
            observedAtStop: false,
          },
          nav.transitGuide,
        );
      return;
    }

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
    const projectedIndex = selectNextStepIndex(
      nav.instructions,
      wps,
      proj.alongM,
    );
    const guarded = route
      ? guardBusProgress({
          instructions: nav.instructions,
          route,
          cp,
          currentIndex: nav.currentStepIndex,
          nextIndex: projectedIndex,
          ride: nav.transitRide,
          alongM: proj.alongM,
          perpendicularM: proj.perpDistM,
          at: Date.now(),
        })
      : { nextIndex: projectedIndex, ride: null, waitingGate: false };
    nav.setTransitRide(
      guarded.ride,
      guarded.ride?.key === nav.transitRide?.key ? nav.transitGuide : null,
    );
    const nextIdx = guarded.nextIndex;
    // Live advancement is monotonic; manual controls cannot write here.
    const displayIdx = Math.max(nextIdx, nav.currentStepIndex);
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
    const journey = useMapStore.getState().venueJourney;
    const outdoor =
      journey?.guidance.status === "outdoor" ? journey.outdoor : undefined;
    const primaryToken =
      outdoor?.routes[outdoor.navigationIndex ?? outdoor.selectedIndex]
        ?.routeToken;
    const hasApproach = Boolean(
      primaryToken && outdoor?.approachRoutes?.[primaryToken],
    );
    const finalLeg = route?.legs.filter((leg) => leg.polyline?.length).at(-1);
    const walkingHandoff = Boolean(
      outdoor &&
        outdoor.phase !== "approach" &&
        hasApproach &&
        finalLeg?.type === "WALK",
    );
    const needsGateArrival = Boolean(
      outdoor && (outdoor.phase === "approach" || finalLeg?.type === "WALK"),
    );
    const endpoint = finalLeg?.polyline.at(-1);
    const arrivalTarget = walkingHandoff
      ? endpoint
        ? { lng: endpoint[0], lat: endpoint[1] }
        : null
      : (outdoor?.arrival.position ?? null);
    const arrivalRadius = walkingHandoff ? 2 : 8;
    const gateRemaining = needsGateArrival
      ? remainingOutdoorDistanceToArrival(route, userLocation, arrivalTarget)
      : null;
    // The ordinary radius may reach across a wall or a walking detour. Venue
    // walking arrival requires progress along the actual selected gate route;
    // the vehicle primary still ends at its own drop-off point as before.
    const reached =
      !guarded.waitingGate &&
      (needsGateArrival
        ? Boolean(
            outdoor &&
              arrivalTarget &&
              resolveActiveLegType(nav.instructions, displayIdx) === "WALK" &&
              gateRemaining !== null &&
              gateRemaining <= arrivalRadius &&
              haversineMeters(userLocation, arrivalTarget) <= arrivalRadius,
          )
        : Boolean(
            finalWp?.coord &&
              haversineMeters(userLocation, finalWp.coord) <
                finalThresholds.finalArriveM,
          ));
    if (needsGateArrival) {
      if (nav.arrived !== reached) nav.setArrived(reached);
    } else if (reached && !nav.arrived) nav.setArrived(true);
  }, [
    userLocation,
    navigationSource,
    geometryEpoch,
    confirmOffRouteEpisode,
    clearOffRouteEpisode,
    applyLegHandoff,
    route,
    instructions,
    navigationMode,
    boarded,
  ]);

  // Derive HUD data separately: a new ETA must never count as another GPS sample.
  useEffect(() => {
    void boarded;
    const nav = useNavStore.getState();
    const cp = geometryRef.current.path;
    if (
      !route ||
      !cp ||
      navigationSource !== "local" ||
      navigationMode !== "live"
    ) {
      if (nav.transitRide || nav.transitGuide) nav.setTransitRide(null, null);
      return;
    }
    const run = findActiveBusRun(instructions, currentStepIndex);
    const leg = run ? route.legs[run.legIndex] : null;
    const range = run ? legAlongRange(cp, run.legIndex) : null;
    if (!run || leg?.type !== "BUS" || !range) {
      if (nav.transitRide || nav.transitGuide) nav.setTransitRide(null, null);
      return;
    }
    const key = JSON.stringify([
      route.routeToken,
      route.navigationId,
      route.routeVersion,
      run.legIndex,
    ]);
    const ride =
      nav.transitRide?.key === key ? nav.transitRide : newTransitRide(key);
    const activeContext = useMapStore.getState().activeBusLeg?.leg.planContext;
    const bus =
      activeContext?.routeToken === route.routeToken &&
      activeContext?.legIndex === run.legIndex
        ? liveBuses.find((b) => b.isTarget)
        : undefined;
    const targetStop = ride.boarded ? leg.arrivalStop : leg.departureStop;
    const minutes =
      bus?.etaStopName === targetStop &&
      (!ride.boarded ||
        (ride.vehicle?.plate === bus.plateNumb &&
          ride.vehicle.direction === bus.direction &&
          (!ride.vehicle.branch || ride.vehicle.branch === bus.subRouteUid)))
        ? (bus.estimateTime ?? null)
        : null;
    nav.setTransitRide(
      ride,
      buildTransitGuide(
        {
          run,
          leg,
          boarded: ride.boarded,
          alongM: userLocation
            ? projectToPath(userLocation, cp.path, cp.cumM).alongM
            : null,
          boardAlongM: range.startM,
          stops: rideStops(leg, cp, run.legIndex),
          legEndAlongM: range.endM,
          liveMinutes: minutes,
        },
        currentStepIndex,
      ),
    );
  }, [
    route,
    instructions,
    currentStepIndex,
    navigationSource,
    navigationMode,
    userLocation,
    liveBuses,
    boarded,
  ]);

  useEffect(() => {
    const nav = useNavStore.getState();
    if (
      nav.navigationSource !== "local" ||
      nav.navigationMode !== "live" ||
      !nav.transitRide
    )
      return;
    const map = useMapStore.getState();
    const route = map.activeNavigationRoute ?? map.selectRoute?.route;
    const context = map.activeBusLeg?.leg.planContext;
    if (
      !route ||
      context?.routeToken !== route.routeToken ||
      JSON.stringify([
        route.routeToken,
        route.navigationId,
        route.routeVersion,
        context?.legIndex,
      ]) !== nav.transitRide.key
    )
      return;
    const bus = liveBuses.find((b) => b.isTarget);
    nav.setTransitRide(
      rememberVehicle(nav.transitRide, bus, Date.now()),
      nav.transitGuide,
    );
  }, [liveBuses]);

  // ---- Step-preview camera: when GPS can't anchor the camera (missing or
  // far from the route), track the active maneuver instead so prev/next and
  // auto-advance pan the map along the route like a route preview. ----
  useEffect(() => {
    if (instructions.length === 0) return;
    const wp = geometryRef.current.waypoints[currentStepIndex];
    useNavStore.getState().setStepCoord(wp?.coord ?? null);
    if (!wp?.coord) return;
    const { map, userLocation } = useMapStore.getState();
    if (!map || indoorExploring) return;
    if (
      useNavStore.getState().navigationMode === "live" &&
      gpsNearRoute(userLocation, geometryRef.current.path)
    )
      return; // Live GPS follow owns the camera
    // The intro already frames the route start; skip the duplicate first ease.
    if (currentStepIndex === 0 && Date.now() < introUntilRef.current) return;
    const next = geometryRef.current.waypoints[currentStepIndex + 1];
    map.easeTo({
      center: [wp.coord.lng, wp.coord.lat],
      zoom: navZoomForLeg(
        isVehicleLegType(resolveActiveLegType(instructions, currentStepIndex)),
      ),
      pitch: navPitch(),
      bearing: next?.coord
        ? bearingDeg(wp.coord, next.coord)
        : map.getBearing(),
      duration: PREVIEW_EASE_MS,
    });
  }, [currentStepIndex, instructions, indoorExploring]);

  // ---- Foreground return: the geolocation watch is suspended while the app
  // is backgrounded, so the stored fix can be minutes old the moment the user
  // looks at the screen again. Ask for one fresh high-accuracy fix; writing it
  // to the map store is what re-runs the progress projection and (in voice
  // navigation) forwards the latest position to the backend. ----
  useEffect(() => {
    if (typeof document === "undefined") return;
    let cancelled = false;
    let generation = 0;
    const handleVisibilityChange = () => {
      const mine = ++generation;
      const nav = useNavStore.getState();
      if (document.hidden && nav.transitRide && !nav.transitRide.boarded) {
        nav.setTransitRide(
          {
            ...nav.transitRide,
            sample: null,
            movingSamples: 0,
            observedAtStop: false,
            candidate: null,
            candidateAt: 0,
          },
          nav.transitGuide,
        );
      }
      const current = () =>
        !cancelled &&
        mine === generation &&
        document.visibilityState === "visible" &&
        useMapStore.getState().isNavigating &&
        (useMapStore.getState().activeNavigationRoute ??
          useMapStore.getState().selectRoute?.route) === route &&
        useNavStore.getState().navigationSource === navigationSource;
      requestForegroundLocationFix({
        isVisible: current,
        geolocation:
          typeof navigator === "undefined" ? null : navigator.geolocation,
        onPosition: (location, heading) => {
          if (!current()) return;
          if (heading != null) useNavStore.getState().setGpsHeading(heading);
          useMapStore.getState().setUserLocation(location);
        },
      });
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelled = true;
      generation++;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [route, navigationSource]);

  // ---- 3D/2D toggle: re-pitch the camera in place when the mode changes ----
  const viewMode = useNavStore((s) => s.viewMode);
  useEffect(() => {
    // The mount run (and StrictMode's re-run) lands inside the intro window —
    // skipping it keeps this effect from cancelling the intro animation.
    if (Date.now() < introUntilRef.current) return;
    const { map, indoorExploring } = useMapStore.getState();
    if (!map || indoorExploring) return;
    map.easeTo({ pitch: viewMode === "2d" ? 0 : NAV_PITCH, duration: 500 });
  }, [viewMode]);

  // ---- Compass listener (re-attaches when iOS permission flips to granted) ----
  useEffect(() => {
    if (typeof window === "undefined") return;
    // On iOS we only attach once granted; elsewhere no permission is needed.
    if (compassNeedsPermission() && compassPermission !== "granted") return;

    const handler = (e: DeviceOrientationEvent) => {
      let h: number | null = null;
      // SAFETY: webkitCompassHeading is an iOS-only extension absent from the
      // DOM typings; the runtime check below covers every other browser.
      const webkit = (e as unknown as { webkitCompassHeading?: number })
        .webkitCompassHeading;
      if (typeof webkit === "number" && !Number.isNaN(webkit)) {
        h = webkit; // iOS: already clockwise from true north
      } else if (e.absolute && typeof e.alpha === "number") {
        h = normalizeDeg(360 - e.alpha); // alpha is counterclockwise from north
      }
      if (h != null) {
        if (
          compassRef.current == null ||
          angularDistanceDeg(compassRef.current, h) >= COMPASS_MIN_DELTA_DEG
        ) {
          compassRef.current = h;
        }
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
    const pause = () => {
      if (!useMapStore.getState().indoorExploring)
        useNavStore.getState().setFollowPaused(true);
    };
    map.on("dragstart", pause);
    return () => {
      map.off("dragstart", pause);
    };
  }, []);

  // ---- Camera + heading loop: follow user, rotate to heading continuously ----
  useEffect(() => {
    if (typeof window === "undefined") return;
    let rafId = 0;
    let lastFrameTs: number | null = null;
    let lastHeadingTs = 0;

    const tick = (timestamp: number) => {
      rafId = requestAnimationFrame(tick);
      // Stop touching the camera the instant navigation ends (before unmount).
      if (!useMapStore.getState().isNavigating) {
        lastFrameTs = null;
        camRef.current = null;
        return;
      }

      const dtMs = Math.min(
        Math.max(lastFrameTs == null ? 0 : timestamp - lastFrameTs, 0),
        100,
      );
      lastFrameTs = timestamp;

      const now = Date.now();
      const map = useMapStore.getState().map;
      const loc = useMapStore.getState().userLocation;
      if (!map) {
        camRef.current = null;
        return;
      }

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
          smoothingFactor(dtMs, HEADING_TAU_MS),
        );
        smoothRef.current = smoothed;
      }
      const writeHeading = (immediate = false) => {
        if (
          raw == null ||
          smoothed == null ||
          (!immediate && now - lastHeadingTs <= HEADING_WRITE_MS)
        ) {
          return;
        }
        useNavStore
          .getState()
          .setUserHeading(Math.round(smoothed * 10) / 10, source);
        lastHeadingTs = now;
      };

      // Indoor inspection owns the same map camera. Keep heading and the
      // navigation engine live, without changing the user's follow choice.
      // Read the store every frame so a queued callback cannot steal focus.
      if (useMapStore.getState().indoorExploring) {
        writeHeading();
        camRef.current = null;
        return;
      }

      // Let the user inspect the map freely after a drag; the resume
      // button (NavigationController) re-enables follow.
      if (useNavStore.getState().followPaused) {
        writeHeading();
        camRef.current = null;
        return;
      }

      // Don't interrupt the intro or handoff ease mid-flight. Clearing the
      // smoothed state means follow resumes from the camera's real endpoint.
      if (
        now < introUntilRef.current ||
        now < cameraHoldUntilRef.current ||
        map.isEasing()
      ) {
        writeHeading();
        camRef.current = null;
        return;
      }

      if (!loc || nav.navigationMode === "preview") {
        writeHeading();
        camRef.current = null;
        return;
      }

      // 3D: heading-up tilted follow. 2D: flat north-up plane, still centered
      // on the user. jumpTo receives the already-smoothed state, avoiding a
      // new ease-in-out animation every frame.
      const currentCenter = map.getCenter();
      const currentCamera = camRef.current ?? {
        lng: currentCenter.lng,
        lat: currentCenter.lat,
        bearing: map.getBearing(),
      };
      const is3D = useMapStore.getState().is3D;
      const targetBearing = is3D ? (smoothed ?? currentCamera.bearing) : 0;
      const nextCamera: CameraState = {
        lng:
          currentCamera.lng +
          (loc.lng - currentCamera.lng) * smoothingFactor(dtMs, CENTER_TAU_MS),
        lat:
          currentCamera.lat +
          (loc.lat - currentCamera.lat) * smoothingFactor(dtMs, CENTER_TAU_MS),
        bearing: targetBearing,
      };

      if (
        haversineMeters(currentCamera, loc) < CAMERA_DEAD_ZONE_M &&
        angularDistanceDeg(currentCamera.bearing, targetBearing) <
          CAMERA_DEAD_ZONE_DEG
      ) {
        writeHeading();
        return;
      }

      map.jumpTo({
        center: [nextCamera.lng, nextCamera.lat],
        bearing: targetBearing,
        pitch: is3D ? NAV_PITCH : 0,
      });
      camRef.current = nextCamera;
      writeHeading(true);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);
}
