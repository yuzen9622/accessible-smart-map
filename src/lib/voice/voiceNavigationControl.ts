import { aiVenueLoaded } from "@/lib/ai/aiVenueLoad";
import { buildCumulativePath, projectToPath } from "@/lib/geo";
import { isIndoorOnlyJourney } from "@/lib/indoor/journey";
import { navThresholdsFor } from "@/lib/navigation/legMode";
import {
  startNavigation,
  stopNavigation,
} from "@/lib/navigation/navigationLifecycle";
import {
  currentDrivingPosition,
  speedLimitAt,
} from "@/lib/navigation/roadGuidance";
import useMapStore from "@/stores/useMapStore";
import useNavStore from "@/stores/useNavStore";
import type { AccessibleRoute } from "@/types/route";
import type {
  VoiceNavigationState,
  VoiceUiCommand,
  VoiceUiCommandResult,
} from "./voiceSession";

/**
 * The assistant drives the page's one navigation engine through the same
 * functions as the buttons: `startNavigation()` (preview until the user is on
 * the route, then live), `stopNavigation()` and indoor step confirmation.
 */

let cueSink: ((text: string) => void) | null = null;

/** The voice session registers where `repeat` re-sends the current step. */
export function setVoiceCueSink(sink: ((text: string) => void) | null): void {
  cueSink = sink;
}

/** Same rule the engine applies on its next fix: near the route is live. */
function startedGuidance(route: AccessibleRoute): "preview" | "live" {
  const location = useMapStore.getState().userLocation;
  const cp = buildCumulativePath(route.legs);
  if (!location || cp.path.length === 0) return "preview";
  const legType = route.legs.find((leg) => leg.polyline?.length)?.type;
  const projection = projectToPath(location, cp.path, cp.cumM);
  return legType && projection.perpDistM <= navThresholdsFor(legType).offRouteM
    ? "live"
    : "preview";
}

function selectRouteByToken(token: string): AccessibleRoute | null {
  const map = useMapStore.getState();
  if (map.selectRoute?.route.routeToken === token) return map.selectRoute.route;
  const index =
    map.computeRoutes?.findIndex((route) => route.routeToken === token) ?? -1;
  const route = index >= 0 ? map.computeRoutes?.[index] : undefined;
  if (!route) return null;
  map.setRouteSelect({ index, route });
  return route;
}

/** Some starts settle later (a selected bus departure is adopted first). */
const START_SETTLE_MS = 6_000;

function navigationStarted(): Promise<boolean> {
  if (useMapStore.getState().isNavigating) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(false);
    }, START_SETTLE_MS);
    const unsubscribe = useMapStore.subscribe((state) => {
      if (!state.isNavigating) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(true);
    });
  });
}

function indoorActive(): boolean {
  const status = useMapStore.getState().venueJourney?.guidance.status;
  return status === "touring" || status === "guiding";
}

async function startFromAssistant(
  token: string | undefined,
): Promise<VoiceUiCommandResult> {
  // A plan's indoor leg attaches asynchronously after its tool result.
  if (!(await aiVenueLoaded()))
    return { ok: false, reason: "VENUE_UNAVAILABLE" };
  const map = useMapStore.getState();
  // Never start a plan that has replaced the one the assistant meant.
  if (
    token &&
    map.activeNavigationRoute?.routeToken !== token &&
    map.selectRoute?.route.routeToken !== token &&
    !map.computeRoutes?.some((route) => route.routeToken === token) &&
    !map.venueJourney?.outdoor?.routes.some(
      (route) => route.routeToken === token,
    )
  )
    return { ok: false, reason: "ROUTE_NOT_FOUND" };
  const nav = useNavStore.getState();
  if (map.isNavigating && !nav.arrived) {
    const current = map.activeNavigationRoute?.routeToken;
    if (!token || current === token)
      return {
        ok: true,
        guidance: indoorActive() ? "indoor" : nav.navigationMode,
      };
    stopNavigation();
  }
  const journey = useMapStore.getState().venueJourney;
  if (isIndoorOnlyJourney(journey)) {
    startNavigation();
    return (await navigationStarted())
      ? { ok: true, guidance: "indoor" }
      : { ok: false, reason: "NAVIGATION_NOT_STARTED" };
  }
  if (!token) return { ok: false, reason: "NO_ROUTE" };
  const outdoor = journey?.outdoor;
  if (journey && outdoor) {
    // An arrival journey navigates its own outdoor candidate.
    const index = outdoor.routes.findIndex(
      (route) => route.routeToken === token,
    );
    if (index < 0) return { ok: false, reason: "ROUTE_NOT_FOUND" };
    useMapStore.setState({
      venueJourney: {
        ...journey,
        outdoor: { ...outdoor, selectedIndex: index },
      },
    });
    useMapStore
      .getState()
      .setRouteSelect({ index, route: outdoor.routes[index] });
  } else if (!selectRouteByToken(token)) {
    return { ok: false, reason: "ROUTE_NOT_FOUND" };
  }
  startNavigation();
  if (!(await navigationStarted()))
    return { ok: false, reason: "NAVIGATION_NOT_STARTED" };
  const active = useMapStore.getState().activeNavigationRoute;
  return { ok: true, guidance: active ? startedGuidance(active) : "preview" };
}

/** What the waiting card shows while heading to or waiting at a bus stop. */
export function busWaitOf(
  guide: ReturnType<typeof useNavStore.getState>["transitGuide"],
): Pick<VoiceNavigationState, "busWait"> {
  if (!guide || guide.phase === "riding") return {};
  return {
    busWait: {
      routeName: guide.routeName,
      stop: guide.boardStop,
      waitMinutes: guide.waitMinutes,
      ...(guide.waitMinutes === null && guide.scheduledAt
        ? { expectedAt: guide.scheduledAt }
        : {}),
    },
  };
}

/** What the HUD shows as the current segment's speed limit on a vehicle leg. */
export function speedLimitOf(
  map: Pick<
    ReturnType<typeof useMapStore.getState>,
    "isNavigating" | "activeNavigationRoute" | "selectRoute"
  >,
  nav: Pick<
    ReturnType<typeof useNavStore.getState>,
    | "arrived"
    | "navigationMode"
    | "routeProgress"
    | "navigationId"
    | "routeVersion"
  >,
  now: number = Date.now(),
): Pick<VoiceNavigationState, "speedLimit"> {
  if (!map.isNavigating || nav.arrived || nav.navigationMode !== "live")
    return {};
  const position = currentDrivingPosition({
    route: map.activeNavigationRoute ?? map.selectRoute?.route,
    progress: nav.routeProgress,
    navigationId: nav.navigationId,
    routeVersion: nav.routeVersion,
    now,
  });
  return position
    ? { speedLimit: speedLimitAt(position.leg, position.segmentIndex) }
    : {};
}

/** The navigation engine's state, which the assistant answers route questions from. */
export function currentNavigationState(): VoiceNavigationState {
  const map = useMapStore.getState();
  const journey = map.venueJourney;
  if (map.isNavigating && journey?.guidance.status === "arrived")
    return { active: false, arrived: true, guidance: "indoor" };
  if (map.isNavigating && journey && indoorActive()) {
    const steps = journey.route.steps;
    return {
      active: true,
      guidance: "indoor",
      travelMode: "walk",
      destination: journey.to.name,
      currentStepIndex: journey.guidance.stepIndex,
      distanceToNextM: steps[journey.guidance.stepIndex]?.distanceM ?? null,
      steps: steps.map((step, index) => ({
        index,
        instruction: step.instruction ?? step.name,
        legType: "VENUE",
        distanceM: step.distanceM,
      })),
    };
  }
  const nav = useNavStore.getState();
  if (!map.isNavigating) return { active: false };
  return {
    active: !nav.arrived,
    arrived: nav.arrived,
    guidance: nav.navigationMode,
    travelMode: map.routeTravelMode ?? undefined,
    destination: map.destinationName || null,
    currentStepIndex: nav.currentStepIndex,
    distanceToNextM: nav.distanceToNextM,
    remainingDistanceM: nav.remainingM,
    remainingDurationSec: nav.remainingDurationSec,
    ...busWaitOf(nav.transitGuide),
    ...speedLimitOf(map, nav),
    steps: nav.instructions.map((step, index) => ({
      index,
      instruction: step.text,
      legType: step.legType,
      distanceM: step.distanceM,
      streetName: step.streetName,
      maneuver: step.maneuver ?? null,
    })),
  };
}

/** Backend `ui.command`: run the button's function and report what happened. */
export async function handleVoiceUiCommand(
  command: VoiceUiCommand,
): Promise<VoiceUiCommandResult> {
  switch (command.action) {
    case "start":
      return startFromAssistant(command.routeToken);
    case "stop":
      stopNavigation();
      return { ok: true };
    case "advance": {
      const map = useMapStore.getState();
      const status = map.venueJourney?.guidance.status;
      // The indoor tour plays itself; only step-by-step guidance advances.
      if (status === "touring")
        return { ok: false, reason: "INDOOR_TOUR_PLAYING" };
      if (status !== "guiding")
        return { ok: false, reason: "NOT_AN_INDOOR_STEP" };
      map.advanceVenueGuidance();
      return { ok: true };
    }
    case "repeat": {
      const state = currentNavigationState();
      const step = state.active
        ? state.steps?.[state.currentStepIndex ?? 0]
        : undefined;
      if (!step || !cueSink)
        return { ok: false, reason: "NO_ACTIVE_NAVIGATION" };
      cueSink(step.instruction);
      return { ok: true };
    }
  }
}

/** Text chat start/stop: `routeId` omitted means the selected route. */
export function runNavigationControl(
  command: { action: "start"; routeId?: string } | { action: "stop" },
): Promise<VoiceUiCommandResult> {
  if (command.action === "stop") return handleVoiceUiCommand(command);
  const map = useMapStore.getState();
  const route = command.routeId
    ? map.computeRoutes?.find(
        (candidate) => candidate.routeId === command.routeId,
      )
    : map.isNavigating
      ? map.activeNavigationRoute
      : map.selectRoute?.route;
  return startFromAssistant(route?.routeToken);
}
