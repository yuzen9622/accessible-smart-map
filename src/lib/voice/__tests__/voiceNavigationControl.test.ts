import { beforeEach, describe, expect, it, vi } from "vitest";
import useMapStore from "@/stores/useMapStore";
import useNavStore from "@/stores/useNavStore";
import type { AccessibleRoute } from "@/types/route";

// The button's own start/stop commands, reduced to what they do to the stores.
const start = vi.fn(() => {
  const map = useMapStore.getState();
  useMapStore.setState({
    activeNavigationRoute: map.selectRoute?.route ?? null,
    isNavigating: true,
  });
});
const stop = vi.fn(() => useMapStore.setState({ isNavigating: false }));
vi.mock("@/lib/navigation/navigationLifecycle", () => ({
  startNavigation: () => start(),
  stopNavigation: () => stop(),
}));

import { trackAiVenueLoad } from "@/lib/ai/aiVenueLoad";
import {
  busWaitOf,
  currentNavigationState,
  handleVoiceUiCommand,
  runNavigationControl,
  setVoiceCueSink,
} from "../voiceNavigationControl";

// A road route running north along 121.52 in Taipei.
const route = (routeId: string): AccessibleRoute =>
  ({
    routeId,
    routeToken: `tok-${routeId}`,
    navigationId: `nav-${routeId}`,
    routeVersion: 1,
    legs: [
      {
        type: "MOTORCYCLE",
        polyline: [
          [121.52, 25.04],
          [121.52, 25.05],
        ],
      },
    ],
  }) as unknown as AccessibleRoute;
const walk = route("walk");
const ride = route("ride");

beforeEach(() => {
  trackAiVenueLoad(Promise.resolve(true));
  start.mockClear();
  stop.mockClear();
  useNavStore.getState().reset();
  useMapStore.setState({
    isNavigating: false,
    activeNavigationRoute: null,
    venueJourney: null,
    computeRoutes: [walk, ride],
    selectRoute: { index: 0, route: walk },
    userLocation: { lat: 25.045, lng: 121.52 },
  });
});

describe("voice ui.command runs the page's own navigation", () => {
  it("starts the requested route with the start button's command and reports live guidance on the route", async () => {
    expect(
      await handleVoiceUiCommand({ action: "start", routeToken: "tok-ride" }),
    ).toEqual({
      ok: true,
      guidance: "live",
    });
    expect(start).toHaveBeenCalledOnce();
    expect(useMapStore.getState().selectRoute?.route.routeId).toBe("ride");
  });

  it("reports preview when the user is away from the route", async () => {
    useMapStore.setState({ userLocation: { lat: 24.14, lng: 120.68 } });
    expect(
      await handleVoiceUiCommand({ action: "start", routeToken: "tok-walk" }),
    ).toEqual({
      ok: true,
      guidance: "preview",
    });
  });

  it("refuses a route the page does not show", async () => {
    expect(
      await handleVoiceUiCommand({ action: "start", routeToken: "tok-gone" }),
    ).toEqual({
      ok: false,
      reason: "ROUTE_NOT_FOUND",
    });
    expect(start).not.toHaveBeenCalled();
  });

  it("after exiting, a newly planned route starts again", async () => {
    await handleVoiceUiCommand({ action: "start", routeToken: "tok-walk" });
    expect(await handleVoiceUiCommand({ action: "stop" })).toEqual({
      ok: true,
    });
    useMapStore.setState({ computeRoutes: [route("new")] });
    expect(
      await handleVoiceUiCommand({ action: "start", routeToken: "tok-new" }),
    ).toMatchObject({ ok: true });
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("switching routes ends the current navigation first", async () => {
    await handleVoiceUiCommand({ action: "start", routeToken: "tok-walk" });
    await handleVoiceUiCommand({ action: "start", routeToken: "tok-ride" });
    expect(stop).toHaveBeenCalledOnce();
    expect(useMapStore.getState().activeNavigationRoute?.routeId).toBe("ride");
  });

  it("text chat starts a named candidate or the selected route", async () => {
    expect(
      await runNavigationControl({ action: "start", routeId: "ride" }),
    ).toMatchObject({ ok: true });
    expect(useMapStore.getState().activeNavigationRoute?.routeId).toBe("ride");
    await runNavigationControl({ action: "stop" });
    useMapStore.setState({ selectRoute: { index: 0, route: walk } });
    expect(await runNavigationControl({ action: "start" })).toMatchObject({
      ok: true,
    });
    expect(useMapStore.getState().activeNavigationRoute?.routeId).toBe("walk");
  });

  it("starts an indoor-only venue journey with the same start command", async () => {
    // An AI indoor plan registers its route (and token) like any other plan.
    const indoor = route("indoor");
    useMapStore.setState({
      computeRoutes: [indoor],
      selectRoute: { index: 0, route: indoor },
      venueJourney: {
        guidance: { status: "idle", stepIndex: 0 },
      } as never,
    });
    expect(
      await handleVoiceUiCommand({ action: "start", routeToken: "tok-indoor" }),
    ).toEqual({
      ok: true,
      guidance: "indoor",
    });
    expect(start).toHaveBeenCalledOnce();
  });

  it("starts the backend's chosen outdoor candidate of an arrival journey", async () => {
    useMapStore.setState({
      venueJourney: {
        guidance: { status: "outdoor", stepIndex: 0 },
        outdoor: { routes: [walk, ride], selectedIndex: 0 },
      } as never,
    });
    expect(
      await handleVoiceUiCommand({ action: "start", routeToken: "tok-ride" }),
    ).toMatchObject({ ok: true });
    expect(useMapStore.getState().venueJourney?.outdoor?.selectedIndex).toBe(1);
    expect(useMapStore.getState().selectRoute?.route.routeId).toBe("ride");
  });

  it("acks only after a start that settles later, like a bus departure adoption", async () => {
    start.mockImplementationOnce(() => {
      setTimeout(() => {
        useMapStore.setState({
          activeNavigationRoute: walk,
          isNavigating: true,
        });
      }, 20);
    });
    expect(
      await handleVoiceUiCommand({ action: "start", routeToken: "tok-walk" }),
    ).toEqual({
      ok: true,
      guidance: "live",
    });
  });

  it("refuses to start when the plan's indoor leg failed to load", async () => {
    trackAiVenueLoad(Promise.resolve(false));
    expect(
      await handleVoiceUiCommand({ action: "start", routeToken: "tok-walk" }),
    ).toEqual({
      ok: false,
      reason: "VENUE_UNAVAILABLE",
    });
    expect(start).not.toHaveBeenCalled();
  });

  it("waits only for the latest plan: an outdoor re-plan supersedes a pending indoor load", async () => {
    trackAiVenueLoad(new Promise(() => {}));
    trackAiVenueLoad(Promise.resolve(true));
    expect(
      await handleVoiceUiCommand({ action: "start", routeToken: "tok-walk" }),
    ).toMatchObject({ ok: true });
  });

  it("only advances indoor steps", async () => {
    expect(await handleVoiceUiCommand({ action: "advance" })).toEqual({
      ok: false,
      reason: "NOT_AN_INDOOR_STEP",
    });
  });
});

describe("engine state the assistant answers from", () => {
  it("reports the current step, distances and the full step list; repeat re-sends the step", async () => {
    await handleVoiceUiCommand({ action: "start", routeToken: "tok-ride" });
    useNavStore.setState({
      currentStepIndex: 0,
      distanceToNextM: 120,
      instructions: [
        {
          text: "沿三民路直行",
          type: "depart",
          bearing: null,
          relativeDirection: null,
          distanceM: 300,
          streetName: "三民路",
          legType: "MOTORCYCLE",
          polylineIndex: 0,
        },
        {
          text: "左轉進入民生路",
          type: "turn",
          bearing: null,
          relativeDirection: null,
          distanceM: 200,
          streetName: "民生路",
          legType: "MOTORCYCLE",
          polylineIndex: 1,
        },
      ] as never,
    });
    expect(currentNavigationState()).toMatchObject({
      active: true,
      currentStepIndex: 0,
      distanceToNextM: 120,
      steps: [
        { instruction: "沿三民路直行" },
        { instruction: "左轉進入民生路", streetName: "民生路" },
      ],
    });
    const cue = vi.fn();
    setVoiceCueSink(cue);
    expect(await handleVoiceUiCommand({ action: "repeat" })).toEqual({
      ok: true,
    });
    expect(cue).toHaveBeenCalledWith("沿三民路直行");
    setVoiceCueSink(null);
  });

  it("tells the assistant what the waiting card shows, and nothing once riding", () => {
    expect(
      busWaitOf({
        phase: "waiting",
        routeName: "26",
        boardStop: "黎明文心南五路口",
        waitMinutes: null,
        scheduledAt: "10:30",
      }),
    ).toEqual({
      busWait: {
        routeName: "26",
        stop: "黎明文心南五路口",
        waitMinutes: null,
        expectedAt: "10:30",
      },
    });
    expect(
      busWaitOf({
        phase: "approaching",
        routeName: "26",
        boardStop: "A",
        waitMinutes: 4,
        scheduledAt: "10:30",
      }),
    ).toEqual({ busWait: { routeName: "26", stop: "A", waitMinutes: 4 } });
    expect(
      busWaitOf({
        phase: "riding",
        routeName: "26",
        alightStop: "B",
        stopsLeft: 2,
        minutes: 5,
        minutesSource: "realtime",
      }),
    ).toEqual({});
    expect(busWaitOf(null)).toEqual({});
  });

  it("reports an indoor arrival as finished", async () => {
    useMapStore.setState({
      isNavigating: true,
      venueJourney: { guidance: { status: "arrived", stepIndex: 3 } } as never,
    });
    expect(currentNavigationState()).toEqual({
      active: false,
      arrived: true,
      guidance: "indoor",
    });
  });

  it("is inactive when not navigating", async () => {
    expect(currentNavigationState()).toEqual({ active: false });
  });
});
