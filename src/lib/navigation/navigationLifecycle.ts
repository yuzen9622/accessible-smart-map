import { toast } from "sonner";
import { haversineMeters } from "@/lib/geo";
import { routeReachesArrival } from "@/lib/indoor/arrival";
import {
  evaluateVenueArrival,
  remainingOutdoorDistanceToArrival,
  type VenueArrivalCandidate,
  type VenueArrivalEvaluation,
} from "@/lib/indoor/arrivalTransition";
import { findVenueModel, indoorModelVersion } from "@/lib/indoor/catalog";
import type { VenueJourney } from "@/lib/indoor/journey";
import { isVenueTourAllowed } from "@/lib/indoor/tour";
import { adoptBusDeparture } from "@/lib/transit/selectDeparture";
import useIndoorCatalog from "@/stores/useIndoorCatalog";
import useMapStore from "@/stores/useMapStore";
import useNavStore from "@/stores/useNavStore";
import type { AccessibleRoute } from "@/types/route";
import { localRerouteCoordinator } from "./localRerouteCoordinator";

export function venueApproachRouteKind(
  primary: AccessibleRoute | undefined,
): "walking" | "vehicle" | null {
  const finalLeg = primary?.legs.filter((leg) => leg.polyline?.length).at(-1);
  if (finalLeg?.type === "WALK") return "walking";
  if (finalLeg?.type === "DRIVE" || finalLeg?.type === "MOTORCYCLE")
    return "vehicle";
  return null;
}

export function venueApproachKind(
  journey: VenueJourney,
  navigating = true,
): "walking" | "vehicle" | null {
  const outdoor = journey.outdoor;
  const index = outdoor
    ? navigating
      ? (outdoor.navigationIndex ?? outdoor.selectedIndex)
      : outdoor.selectedIndex
    : undefined;
  const primary = index === undefined ? undefined : outdoor?.routes[index];
  return primary?.routeToken && outdoor?.approachRoutes?.[primary.routeToken]
    ? venueApproachRouteKind(primary)
    : null;
}

function selectedApproach(journey: VenueJourney) {
  const outdoor = journey.outdoor;
  const primary =
    outdoor?.routes[outdoor.navigationIndex ?? outdoor.selectedIndex];
  return primary?.routeToken
    ? outdoor?.approachRoutes?.[primary.routeToken]
    : undefined;
}

function autoplayVenueTour(): boolean {
  return (
    typeof window === "undefined" ||
    !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Explicit domain command to start navigation.
 * Synchronously starts a fresh coordinator session before activating the UI.
 */
export function startNavigation(): void {
  const map = useMapStore.getState();
  if (
    map.busSelection &&
    map.busSelection.routeToken === map.selectRoute?.route.routeToken
  ) {
    toast.error("請先完成班次選擇，再開始導航。");
    return;
  }
  const journey = map.venueJourney;
  if (journey) {
    const model = findVenueModel(
      useIndoorCatalog.getState().models,
      journey.from,
    );
    if (!model || indoorModelVersion(model) !== journey.sourceVersion) {
      toast.error("場域資料已更新或尚未載入，請重新規劃。");
      return;
    }
    if (!journey.outdoor) {
      if (!isVenueTourAllowed(journey.route)) {
        toast.error("路線資料不完整，請重新規劃。");
        return;
      }
      localRerouteCoordinator.stopSession();
      useNavStore.getState().reset();
      map.startVenueTour(autoplayVenueTour());
      map.setIsNavigating(true);
      useIndoorCatalog.getState().showPlace(journey.from);
      return;
    }
  }
  const outdoor = journey?.outdoor;
  const navigationIndex = outdoor
    ? outdoor.phase === "approach"
      ? (outdoor.navigationIndex ?? outdoor.selectedIndex)
      : outdoor.selectedIndex
    : undefined;
  const route =
    journey && outdoor
      ? outdoor.phase === "approach"
        ? selectedApproach(journey)
        : outdoor.routes[navigationIndex as number]
      : map.selectRoute?.route;
  if (!route?.routeToken || map.invalidRouteTokens.includes(route.routeToken)) {
    toast.error("這份路線目前無法啟用導航，請重新規劃。");
    return;
  }
  // Confirm every displayed default before navigation, just as an explicit
  // selection does. Each adoption preserves earlier locks on transfer legs.
  if (
    useNavStore.getState().navigationSource !== "voice" &&
    route === map.selectRoute?.route
  ) {
    const legIndex = route.legs.findIndex(
      (leg) =>
        leg.type === "BUS" &&
        !leg.selectedDeparture &&
        leg.departureCandidates?.some((candidate) => candidate.selected),
    );
    const leg = route.legs[legIndex];
    const candidate =
      leg?.type === "BUS"
        ? leg.departureCandidates?.find((item) => item.selected)
        : undefined;
    if (candidate) {
      void adoptBusDeparture(
        route.routeToken,
        legIndex,
        candidate.candidateId,
      ).then((adopted) => {
        if (adopted) startNavigation();
      });
      return;
    }
  }
  // VoiceSessionHost installs authoritative steps before invoking this command.
  // Starting its map UI must not reset that owner or its carried instructions.
  if (useNavStore.getState().navigationSource !== "voice") {
    useNavStore.getState().reset();
    useNavStore
      .getState()
      .setNavigationIdentity(
        route.navigationId ?? null,
        route.routeVersion ?? 0,
      );
  }
  useMapStore.setState({
    activeNavigationRoute: route,
    ...(journey && outdoor
      ? {
          venueJourney: {
            ...journey,
            outdoor: { ...outdoor, navigationIndex },
          },
        }
      : {}),
  });
  if (journey?.outdoor) {
    map.beginVenueOutdoorNavigation();
    map.setIndoorExploring(false);
  }
  const navigationId = route.navigationId ?? null;
  localRerouteCoordinator.startSession(navigationId);
  map.setIsNavigating(true);
}

/** Explicit confirmation remains available when location cannot establish arrival. */
export function confirmVenueArrival(): void {
  const map = useMapStore.getState();
  const journey = map.venueJourney;
  if (!journey?.outdoor || journey.guidance.status !== "outdoor") return;
  if (selectedApproach(journey) && journey.outdoor.phase !== "approach") {
    toast.error("請先完成前往校門的步行路段。");
    return;
  }
  const model = findVenueModel(
    useIndoorCatalog.getState().models,
    journey.from,
  );
  if (!model || indoorModelVersion(model) !== journey.sourceVersion) {
    toast.error("室內路線資料已失效，請重新規劃。");
    return;
  }
  if (!isVenueTourAllowed(journey.route)) {
    toast.error("路線資料不完整，請重新規劃。");
    return;
  }
  localRerouteCoordinator.stopSession();
  useNavStore.getState().reset();
  map.startVenueTour(autoplayVenueTour());
  map.setIsNavigating(true);
  useIndoorCatalog.getState().showPlace(journey.from);
}

/** Manual confirmation remains necessary when the primary ends in a vehicle. */
export function startVenueApproach(): void {
  activateVenueApproach(false);
}

function activateVenueApproach(verifiedWalkingArrival: boolean): void {
  const map = useMapStore.getState();
  const journey = map.venueJourney;
  const nav = useNavStore.getState();
  if (
    !map.isNavigating ||
    !journey?.outdoor ||
    journey.guidance.status !== "outdoor" ||
    journey.outdoor.phase === "approach" ||
    (!verifiedWalkingArrival && !nav.arrived)
  )
    return;
  const primary =
    journey.outdoor.routes[
      journey.outdoor.navigationIndex ?? journey.outdoor.selectedIndex
    ];
  const active = map.activeNavigationRoute;
  if (
    !primary?.routeToken ||
    active?.routeToken !== primary.routeToken ||
    active.navigationId !== primary.navigationId ||
    active.routeVersion !== primary.routeVersion ||
    nav.navigationId !== (primary.navigationId ?? null) ||
    nav.routeVersion !== (primary.routeVersion ?? 0)
  )
    return;
  const model = findVenueModel(
    useIndoorCatalog.getState().models,
    journey.from,
  );
  if (!model || indoorModelVersion(model) !== journey.sourceVersion) {
    toast.error("場域資料已更新或尚未載入，請重新規劃。");
    return;
  }
  const route = selectedApproach(journey);
  if (!route?.routeToken || map.invalidRouteTokens.includes(route.routeToken)) {
    toast.error("步行接續路線目前無法啟用，請重新規劃。");
    return;
  }
  localRerouteCoordinator.stopSession();
  nav.reset();
  useNavStore
    .getState()
    .setNavigationIdentity(route.navigationId ?? null, route.routeVersion ?? 0);
  useMapStore.setState({
    venueJourney: {
      ...journey,
      outdoor: { ...journey.outdoor, phase: "approach" },
    },
    activeNavigationRoute: route,
  });
  localRerouteCoordinator.startSession(route.navigationId ?? null);
  map.setIndoorExploring(false);
  map.setIsNavigating(true);
}

/** Read live state on every GPS fix; stale sessions cannot reuse a candidate. */
export function tryAutoConfirmVenueArrival(
  candidate: VenueArrivalCandidate | null,
  now = Date.now(),
): VenueArrivalEvaluation {
  const map = useMapStore.getState();
  const nav = useNavStore.getState();
  const journey = map.venueJourney;
  const outdoor = journey?.outdoor;
  const model = journey
    ? findVenueModel(useIndoorCatalog.getState().models, journey.from)
    : undefined;
  const sourceValid = Boolean(
    model &&
      journey &&
      outdoor &&
      indoorModelVersion(model) === journey.sourceVersion &&
      outdoor.arrival.sourceVersion === indoorModelVersion(model) &&
      outdoor.arrival.venueId === model.venueId &&
      outdoor.arrival.placeId === journey.from.placeId &&
      model.preview?.gatePlaceIds?.includes(outdoor.arrival.placeId),
  );
  const pendingApproach = Boolean(
    journey && selectedApproach(journey) && outdoor?.phase !== "approach",
  );
  const primary =
    outdoor?.routes[outdoor.navigationIndex ?? outdoor.selectedIndex];
  const approach = journey ? selectedApproach(journey) : undefined;
  const expected = outdoor?.phase === "approach" ? approach : primary;
  const active = map.activeNavigationRoute;
  const ownsActiveRoute = Boolean(
    expected?.routeToken &&
      !map.invalidRouteTokens.includes(expected.routeToken) &&
      active?.routeToken === expected.routeToken &&
      active.navigationId === expected.navigationId &&
      active.routeVersion === expected.routeVersion &&
      nav.navigationId === (expected.navigationId ?? null) &&
      nav.routeVersion === (expected.routeVersion ?? 0),
  );
  const walkingApproach = Boolean(
    pendingApproach && journey && venueApproachKind(journey) === "walking",
  );
  const endpoint = primary?.legs
    .filter((leg) => leg.polyline?.length)
    .at(-1)
    ?.polyline.at(-1);
  const primaryArrival = endpoint
    ? { lng: endpoint[0], lat: endpoint[1] }
    : null;
  const target = walkingApproach
    ? primaryArrival
    : (outdoor?.arrival.position ?? null);
  const remaining = remainingOutdoorDistanceToArrival(
    active,
    map.userLocation,
    target,
  );
  const approachStart = approach?.legs.flatMap((leg) => leg.polyline ?? [])[0];
  // A walking-to-walking handoff is an endpoint event, not the wider near-gate
  // cue. Reuse the two-fix policy only after validating both independent routes.
  const walkingEndpointReached = Boolean(
    walkingApproach &&
      primary &&
      primaryArrival &&
      approach?.routeToken &&
      !map.invalidRouteTokens.includes(approach.routeToken) &&
      approach.legs.every(
        (leg) => !leg.polyline?.length || leg.type === "WALK",
      ) &&
      approachStart &&
      routeReachesArrival(primary, {
        lng: approachStart[0],
        lat: approachStart[1],
      }) &&
      outdoor &&
      routeReachesArrival(approach, outdoor.arrival.position) &&
      remaining !== null &&
      remaining <= 2 &&
      map.userLocation &&
      haversineMeters(map.userLocation, primaryArrival) <= 2,
  );
  const evaluation = evaluateVenueArrival(candidate, {
    sessionKey:
      journey && outdoor
        ? JSON.stringify([
            journey.id,
            map.routeGeneration,
            nav.navigationId,
            map.activeNavigationRoute?.routeToken,
            map.activeNavigationRoute?.routeVersion,
            outdoor.navigationIndex ?? outdoor.selectedIndex,
            outdoor.phase,
            walkingApproach ? "walking-approach" : "venue-entrance",
            target,
            outdoor.arrival.placeId,
            outdoor.arrival.sourceVersion,
            outdoor.arrival.position,
          ])
        : null,
    activeOutdoor:
      map.isNavigating &&
      journey?.guidance.status === "outdoor" &&
      Boolean(outdoor) &&
      (!pendingApproach || walkingEndpointReached),
    sourceValid: sourceValid && ownsActiveRoute,
    liveNavigation:
      nav.navigationSource === "local" && nav.navigationMode === "live",
    currentStep: nav.instructions[nav.currentStepIndex] ?? null,
    riding: Boolean(
      nav.transitRide?.boarded || nav.transitGuide?.phase === "riding",
    ),
    remainingOutdoorM: remaining,
    arrival: target,
    location: map.userLocation,
    fix: map.userLocationFix,
    now,
  });
  if (!evaluation.shouldTransition) return evaluation;
  if (walkingApproach) activateVenueApproach(true);
  else confirmVenueArrival();
  const current = useMapStore.getState().venueJourney;
  return {
    candidate: null,
    shouldTransition:
      current?.id === journey?.id &&
      (walkingApproach
        ? current?.outdoor?.phase === "approach"
        : current?.guidance.status === "touring"),
  };
}

/**
 * Explicit domain command to stop navigation.
 * Synchronously aborts in-flight reroute requests and tears down the session.
 */
export function stopNavigation(): void {
  localRerouteCoordinator.stopSession();
  useMapStore.getState().stopVenueGuidance();
  useMapStore.getState().setIsNavigating(false);
  useNavStore.getState().reset();
}
