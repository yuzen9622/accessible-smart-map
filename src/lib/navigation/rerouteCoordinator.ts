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
  const viewingReplaced =
    map.selectRoute?.route.navigationId === replacement.navigationId;
  const computeRoutes =
    map.computeRoutes?.map((item) =>
      item.navigationId === replacement.navigationId ? route : item,
    ) ?? null;
  const selectedIndex = computeRoutes?.indexOf(route) ?? -1;
  const totalM = replacement.instructions.reduce(
    (sum, instruction) => sum + (instruction.distanceM ?? 0),
    0,
  );

  useMapStore.setState({
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
  });
  nav.setLastRerouteReason(replacement.reason ?? null);
  nav.clearAdvisories();
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
