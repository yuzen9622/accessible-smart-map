import { routeReachesArrival } from "@/lib/indoor/arrival";
import { atomicStoreUpdates } from "@/stores/atomicNotifications";
import useMapStore from "@/stores/useMapStore";
import useNavStore, { type NavRerouteReason } from "@/stores/useNavStore";
import type {
  AccessibleRoute,
  AccessibleRouteRerouteData,
  NavInstruction,
  RouteMessageDetail,
} from "@/types/route";

export interface RouteReplacement {
  navigationId: string;
  previousRouteVersion: number;
  routeVersion: number;
  routeToken: string;
  route: AccessibleRoute;
  instructions: NavInstruction[];
  warnings: string[];
  warningDetails?: RouteMessageDetail[];
  currentStepIndex: 0;
  reason?: NavRerouteReason;
}

export type VoiceRerouteCoordinatorEvent =
  | {
      type: "nav.rerouting";
      navigationId: string;
      previousRouteVersion: number;
      reason?: NavRerouteReason;
    }
  | { type: "nav.route_replaced"; replacement: RouteReplacement }
  | {
      type: "nav.reroute_failed";
      navigationId: string;
      previousRouteVersion: number;
      message: string;
      retryable: boolean;
    };

export function normalizeRerouteReplacement(
  data: AccessibleRouteRerouteData,
): RouteReplacement {
  return {
    navigationId: data.navigationId,
    previousRouteVersion: data.previousRouteVersion,
    routeVersion: data.routeVersion,
    routeToken: data.routeToken,
    route: data.route,
    instructions: data.instructions ?? data.steps,
    warnings: data.warnings,
    warningDetails: data.warningDetails,
    currentStepIndex: data.currentStepIndex,
  };
}

/**
 * Applies a complete replacement synchronously at one seam. A stale response
 * changes neither the selected route nor the navigation runtime.
 */
export function applyRouteReplacement(replacement: RouteReplacement): boolean {
  const map = useMapStore.getState();
  const nav = useNavStore.getState();
  const currentRoute = map.activeNavigationRoute ?? map.selectRoute?.route;
  const currentNavigationId = currentRoute?.navigationId ?? null;
  const currentVersion = currentRoute?.routeVersion ?? 0;
  if (
    nav.arrived ||
    !currentNavigationId ||
    replacement.navigationId !== currentNavigationId ||
    replacement.previousRouteVersion !== currentVersion ||
    replacement.routeVersion !== currentVersion + 1 ||
    nav.navigationId !== currentNavigationId ||
    nav.routeVersion !== currentVersion
  ) {
    return false;
  }

  const route: AccessibleRoute = {
    ...replacement.route,
    navigationId: replacement.navigationId,
    routeVersion: replacement.routeVersion,
    routeToken: replacement.routeToken,
    warnings: replacement.warnings,
    // These warnings come from the envelope. Never retain indices from the
    // nested route's independent warning array (including for legacy payloads).
    warningDetails: replacement.warningDetails,
  };
  const journey = map.venueJourney;
  const outdoor = journey?.outdoor;
  let updatedOutdoor = outdoor;
  let replacingApproach = false;
  if (outdoor && journey) {
    const reject = (target = "原校園入口") => {
      nav.setRerouteError(
        `重新規劃的路線未接到${target}，已保留原路線；請重新規劃完整行程。`,
        false,
      );
      return false;
    };
    if (journey.guidance.status !== "outdoor") return reject();

    if (outdoor.phase === "approach") {
      // A walk token is a separate navigation session; never install it as a
      // primary transport candidate, even while another candidate is previewed.
      const matching = Object.entries(outdoor.approachRoutes ?? {}).filter(
        ([primaryToken, approach]) =>
          outdoor.routes.some((item) => item.routeToken === primaryToken) &&
          approach.navigationId === currentNavigationId &&
          approach.routeVersion === currentVersion &&
          approach.routeToken === currentRoute?.routeToken,
      );
      if (
        matching.length !== 1 ||
        !routeReachesArrival(route, outdoor.arrival.position)
      )
        return reject();
      updatedOutdoor = {
        ...outdoor,
        approachRoutes: {
          ...outdoor.approachRoutes,
          [matching[0][0]]: route,
        },
      };
      replacingApproach = true;
    } else {
      const primary = outdoor.routes.find(
        (item) =>
          item.navigationId === currentNavigationId &&
          item.routeVersion === currentVersion &&
          item.routeToken === currentRoute?.routeToken,
      );
      if (!primary) return reject();
      const approach = primary.routeToken
        ? outdoor.approachRoutes?.[primary.routeToken]
        : undefined;
      const walkStart = approach?.legs.flatMap((leg) => leg.polyline ?? [])[0];
      const target = approach
        ? walkStart && { lng: walkStart[0], lat: walkStart[1] }
        : outdoor.arrival.position;
      const targetName = approach ? "原步行接續點" : "原校園入口";
      if (!target || !routeReachesArrival(route, target))
        return reject(targetName);

      let approachRoutes = outdoor.approachRoutes;
      if (approach && primary.routeToken) {
        if (
          replacement.routeToken !== primary.routeToken &&
          approachRoutes?.[replacement.routeToken]
        )
          return reject(targetName);
        approachRoutes = { ...approachRoutes };
        delete approachRoutes[primary.routeToken];
        approachRoutes[replacement.routeToken] = approach;
      }
      updatedOutdoor = {
        ...outdoor,
        routes: outdoor.routes.map((item) => (item === primary ? route : item)),
        ...(approachRoutes ? { approachRoutes } : {}),
      };
    }
  }
  const viewingReplaced =
    !replacingApproach &&
    map.selectRoute?.route.navigationId === replacement.navigationId;
  const computeRoutes = replacingApproach
    ? map.computeRoutes
    : (map.computeRoutes?.map((item) =>
        item.navigationId === replacement.navigationId ? route : item,
      ) ?? null);
  const selectedIndex = computeRoutes?.indexOf(route) ?? -1;
  const totalM = replacement.instructions.reduce(
    (sum, instruction) => sum + (instruction.distanceM ?? 0),
    0,
  );

  atomicStoreUpdates(() => {
    useMapStore.setState({
      ...(updatedOutdoor && journey
        ? {
            venueJourney: {
              ...journey,
              outdoor: updatedOutdoor,
            },
          }
        : {}),
      activeNavigationRoute: map.activeNavigationRoute ? route : null,
      ...(viewingReplaced
        ? {
            selectRoute: { index: Math.max(0, selectedIndex), route },
            selectedRouteId: route.routeId,
            routeGeneration: map.routeGeneration + 1,
          }
        : {}),
      computeRoutes,
    });
    useNavStore.setState({
      navigationId: replacement.navigationId,
      routeVersion: replacement.routeVersion,
      instructions: replacement.instructions,
      warnings: replacement.warnings,
      currentStepIndex: 0,
      transitRide: null,
      transitGuide: null,
      lastManualTs: 0,
      distanceToNextM: replacement.instructions[0]?.distanceM ?? null,
      remainingM: totalM || null,
      remainingDurationSec: null,
      estimatedArrivalAt: null,
      etaSource: null,
      etaUpdatedAt: null,
      routeTotalM: totalM || null,
      isOffRoute: false,
      arrived: false,
      rerouteStatus: "idle",
      rerouteError: null,
      rerouteRetryable: false,
      lastRerouteReason: replacement.reason ?? null,
      advisories: [],
    });
  });
  return true;
}

export function handleVoiceRerouteEvent(
  event: VoiceRerouteCoordinatorEvent,
): boolean | null {
  const nav = useNavStore.getState();
  const currentRoute =
    useMapStore.getState().activeNavigationRoute ??
    useMapStore.getState().selectRoute?.route;
  const currentNavigationId = currentRoute?.navigationId ?? null;
  const currentVersion = currentRoute?.routeVersion ?? 0;
  const matchesCurrentVoiceRoute =
    !nav.arrived &&
    nav.navigationSource === "voice" &&
    currentNavigationId !== null &&
    nav.navigationId === currentNavigationId &&
    nav.routeVersion === currentVersion;

  switch (event.type) {
    case "nav.rerouting":
      if (
        !matchesCurrentVoiceRoute ||
        event.navigationId !== currentNavigationId ||
        event.previousRouteVersion !== currentVersion
      ) {
        return false;
      }
      nav.setReroutePending();
      nav.setLastRerouteReason(event.reason ?? null);
      return null;
    case "nav.route_replaced":
      if (
        !matchesCurrentVoiceRoute ||
        event.replacement.navigationId !== currentNavigationId ||
        event.replacement.routeVersion !== currentVersion + 1
      ) {
        return false;
      }
      return applyRouteReplacement(event.replacement);
    case "nav.reroute_failed":
      if (
        !matchesCurrentVoiceRoute ||
        event.navigationId !== currentNavigationId ||
        event.previousRouteVersion !== currentVersion
      ) {
        return false;
      }
      nav.setRerouteError(event.message, event.retryable);
      return null;
  }
}
