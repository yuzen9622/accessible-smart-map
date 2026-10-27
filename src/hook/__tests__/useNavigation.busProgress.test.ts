import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  effects: [] as (() => undefined | (() => void))[],
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useEffect: (effect: () => undefined | (() => void)) => h.effects.push(effect),
  useRef: (value: unknown) => ({ current: value }),
  useState: (value: unknown) => [value, vi.fn()],
  useCallback: (value: unknown) => value,
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) =>
    snapshot(),
  useDebugValue: () => {},
}));
vi.mock("@/stores/useMapStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/useMapStore")>();
  return {
    ...actual,
    default: Object.assign(
      (
        selector: (
          state: ReturnType<typeof actual.default.getState>,
        ) => unknown,
      ) => selector(actual.default.getState()),
      actual.default,
    ),
  };
});
vi.mock("@/stores/useNavStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/useNavStore")>();
  return {
    ...actual,
    default: Object.assign(
      (
        selector: (
          state: ReturnType<typeof actual.default.getState>,
        ) => unknown,
      ) => selector(actual.default.getState()),
      actual.default,
    ),
  };
});
vi.mock("@/i18n/client", () => ({
  useAppTranslation: () => ({ i18n: { language: "en" } }),
}));
vi.mock("../useRouteReroute", () => ({
  default: () => ({
    confirmOffRouteEpisode: vi.fn(),
    clearOffRouteEpisode: vi.fn(),
  }),
}));
vi.mock("@/lib/api/a11y", () => ({ getRouteInstructions: vi.fn() }));
vi.mock("@/lib/api/transit", () => ({ getBusRouteDetail: vi.fn() }));

import { getBusRouteDetail } from "@/lib/api/transit";
import { buildCumulativePath } from "@/lib/geo";
import { newTransitRide } from "@/lib/navigation/transitRideRuntime";
import {
  __clearRouteDetailCache,
  fetchRouteDetailSnapshot,
} from "@/lib/transit/busRouteDetailCache";
import useMapStore from "@/stores/useMapStore";
import useNavStore from "@/stores/useNavStore";
import type {
  AccessibleRoute,
  BusDepartureCandidate,
  BusLeg,
  LiveBus,
  NavInstruction,
} from "@/types/route";
import useNavigation from "../useNavigation";

const route = {
  routeId: "route",
  routeToken: "token",
  navigationId: "nav",
  routeVersion: 1,
  totalMinutes: 20,
  legs: [
    {
      type: "BUS",
      routeName: "99",
      tdxCity: "Taipei",
      subRouteUid: "99A",
      direction: 0,
      departureStop: "Board",
      arrivalStop: "Alight",
      departureTime: "10:05",
      arrivalTime: "10:15",
      estimatedWaitMinutes: 5,
      polyline: [
        [121, 25],
        [121.004, 25],
      ],
      intermediateStops: [],
    },
    {
      type: "WALK",
      minutesEst: 2,
      polyline: [
        [121.004, 25],
        [121.005, 25],
      ],
    },
  ],
} as AccessibleRoute;
const instructions = [
  {
    type: "transit_board",
    legType: "BUS",
    legIndex: 0,
    text: "Board",
    polylineIndex: null,
  },
  {
    type: "transit_alight",
    legType: "BUS",
    legIndex: 0,
    text: "Alight",
    polylineIndex: null,
  },
  {
    type: "arrive",
    legType: "WALK",
    legIndex: 1,
    text: "Arrive",
    polylineIndex: 1,
  },
] as NavInstruction[];
let cleanup: (() => void) | undefined;
function renderEffects() {
  cleanup?.();
  h.effects.length = 0;
  // biome-ignore lint/correctness/useHookAtTopLevel: deterministic effect harness.
  useNavigation();
  cleanup = h.effects[0]() as () => void;
}
function fix(lng: number, seconds = 0) {
  vi.advanceTimersByTime(seconds * 1000);
  useMapStore
    .getState()
    .setUserLocation({ lng, lat: 25 }, { accuracyM: 5, timestamp: Date.now() });
  renderEffects();
  h.effects[3]();
  renderEffects();
  h.effects[4]();
}
function liveBus(minutes: number): LiveBus {
  return {
    plateNumb: "AAA-123",
    direction: 0,
    subRouteUid: "99A",
    isTarget: true,
    etaStopName: "Board",
    estimateTime: minutes,
    gpsTime: new Date().toISOString(),
  } as LiveBus;
}
beforeEach(() => {
  __clearRouteDetailCache();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-22T10:00:00+08:00"));
  useNavStore.getState().reset();
  useNavStore.getState().setNavigationIdentity("nav", 1);
  useNavStore.getState().setInstructions(instructions);
  useMapStore.setState({
    activeNavigationRoute: route,
    isNavigating: true,
    userLocation: null,
    userLocationFix: null,
    venueJourney: null,
    liveBusPositions: [],
    activeBusLeg: {
      key: "bus",
      leg: {
        ...route.legs[0],
        planContext: { routeToken: "token", legIndex: 0 },
      } as BusLeg,
    },
  });
});
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("shared bus progress and live ETA", () => {
  it("keeps waiting geometry at the stop, then advances only after boarding evidence", () => {
    fix(121);
    expect(useNavStore.getState().routeProgress?.alongM).toBe(0);
    fix(121.0003, 5);
    expect(useNavStore.getState().transitRide?.boarded).toBe(false);
    expect(useNavStore.getState().routeProgress?.alongM).toBe(0);
    fix(121.0006, 5);
    expect(useNavStore.getState().transitRide?.boarded).toBe(true);
    expect(useNavStore.getState().routeProgress?.alongM).toBeGreaterThan(50);
  });
  it("updates ETA with unchanged GPS without treating the update as a boarding sample", () => {
    fix(121);
    const progress = useNavStore.getState().routeProgress;
    const sample = useNavStore.getState().transitRide?.sample;
    useMapStore.setState({ liveBusPositions: [liveBus(7)] });
    renderEffects();
    h.effects[4]();
    expect(useNavStore.getState().remainingDurationSec).toBe(19 * 60);
    useMapStore.setState({ liveBusPositions: [liveBus(3)] });
    renderEffects();
    h.effects[4]();
    expect(useNavStore.getState().remainingDurationSec).toBe(15 * 60);
    expect(useNavStore.getState().etaSource).toBe("realtime");
    expect(useNavStore.getState().routeProgress).toBe(progress);
    expect(useNavStore.getState().transitRide?.sample).toBe(sample);
    expect(useNavStore.getState().transitRide?.boarded).toBe(false);
  });
  it("uses fresh selected ETA without positions, then removes realtime status at cache expiry", async () => {
    const selected = {
      candidateId: "chosen",
      routeName: "99",
      subRouteUid: "99A",
      direction: 0,
      plateNumb: "AAA-123",
      departureStopId: "A",
      arrivalStopId: "B",
      selected: true,
      boardingTime: "2026-10-22T10:05:00+08:00",
      alightingTime: "2026-10-22T10:15:00+08:00",
      boardingTimeSource: "schedule",
      alightingTimeSource: "schedule",
    } as BusDepartureCandidate;
    const adopted = structuredClone(route);
    if (adopted.legs[0].type !== "BUS") throw new Error("Bus fixture");
    adopted.legs[0].selectedDeparture = selected;
    useMapStore.setState({ activeNavigationRoute: adopted });
    fix(121);
    const progress = useNavStore.getState().routeProgress;
    vi.mocked(getBusRouteDetail).mockResolvedValue({
      ok: true,
      status: "success",
      code: 200,
      message: "OK",
      data: {
        directions: [],
        departureCandidates: [
          {
            ...selected,
            boardingTime: "2026-10-22T10:03:00+08:00",
            boardingTimeSource: "realtime",
          },
        ],
      },
    } as Awaited<ReturnType<typeof getBusRouteDetail>>);
    await fetchRouteDetailSnapshot("99", "Taipei", {
      subRouteUid: "99A",
      planContext: { routeToken: "token", legIndex: 0 },
      lang: "en",
    });
    renderEffects();
    h.effects[4]();
    expect(useMapStore.getState().liveBusPositions).toEqual([]);
    expect(useNavStore.getState()).toMatchObject({
      remainingDurationSec: 15 * 60,
      etaSource: "realtime",
      transitGuide: { waitMinutes: 3 },
    });
    expect(useNavStore.getState().routeProgress).toBe(progress);
    vi.advanceTimersByTime(15_001);
    renderEffects();
    h.effects[4]();
    expect(useNavStore.getState()).toMatchObject({
      etaSource: "estimated",
      transitGuide: { waitMinutes: null },
    });
  });
  it("does not use a realtime candidate snapshot belonging to another route token", async () => {
    const selected = {
      candidateId: "chosen",
      subRouteUid: "99A",
      direction: 0,
      plateNumb: "AAA-123",
      departureStopId: "A",
      arrivalStopId: "B",
      selected: true,
      boardingTime: "2026-10-22T10:03:00+08:00",
      boardingTimeSource: "realtime",
    } as BusDepartureCandidate;
    const adopted = structuredClone(route);
    if (adopted.legs[0].type !== "BUS") throw new Error("Bus fixture");
    adopted.legs[0].selectedDeparture = selected;
    useMapStore.setState({ activeNavigationRoute: adopted });
    fix(121);
    vi.mocked(getBusRouteDetail).mockResolvedValue({
      ok: true,
      status: "success",
      code: 200,
      message: "OK",
      data: { directions: [], departureCandidates: [selected] },
    } as Awaited<ReturnType<typeof getBusRouteDetail>>);
    await fetchRouteDetailSnapshot("99", "Taipei", {
      subRouteUid: "99A",
      planContext: { routeToken: "other", legIndex: 0 },
      lang: "en",
    });
    renderEffects();
    h.effects[4]();
    expect(useNavStore.getState().etaSource).toBe("estimated");
    expect(useNavStore.getState().transitGuide).toMatchObject({
      waitMinutes: null,
    });
  });
  it("does not consume a distant GPS jump or stale fix", () => {
    fix(121);
    const before = useNavStore.getState().routeProgress;
    fix(121.003, 1);
    expect(useNavStore.getState().routeProgress).toBe(before);
    expect(useNavStore.getState().currentStepIndex).toBe(0);
    useMapStore
      .getState()
      .setUserLocation(
        { lat: 25, lng: 121.001 },
        { accuracyM: 5, timestamp: Date.now() - 16_000 },
      );
    renderEffects();
    h.effects[3]();
    expect(useNavStore.getState().routeProgress).toBe(before);
  });
  it("projects voice bus geometry without legIndex while retaining server ETA and step ownership", () => {
    const voiceRoute = {
      ...route,
      legs: [route.legs[1], route.legs[0], route.legs[1]],
    };
    const voiceSteps = [
      { type: "depart", legType: "WALK", text: "Walk" },
      { type: "transit_board", legType: "BUS", text: "Board" },
      { type: "transit_alight", legType: "BUS", text: "Alight" },
    ] as NavInstruction[];
    useMapStore.setState({ activeNavigationRoute: voiceRoute });
    const nav = useNavStore.getState();
    nav.setNavigationSource("voice");
    nav.setInstructions(voiceSteps);
    nav.setCurrentStepIndex(1);
    nav.setProgress({
      remainingDurationSec: 555,
      estimatedArrivalAt: Date.now() + 555000,
      etaSource: "realtime",
    });
    useNavStore.setState({
      voiceTransit: {
        onVehicle: true,
        leg: { mode: "BUS", from: "Board", to: "Alight", routeName: "99" },
      },
    });
    useMapStore
      .getState()
      .setUserLocation(
        { lng: 121.001, lat: 25 },
        { accuracyM: 5, timestamp: Date.now() },
      );
    renderEffects();
    h.effects[3]();
    h.effects.at(-2)?.();
    expect(useNavStore.getState().routeProgress?.legIndex).toBe(1);
    expect(useNavStore.getState().remainingDurationSec).toBe(555);
    expect(useNavStore.getState().currentStepIndex).toBe(1);
    expect(useNavStore.getState().instructions).toBe(voiceSteps);
  });

  it("moves the boarded camera around the route corner without cutting across it", () => {
    const cornerRoute = structuredClone(route);
    cornerRoute.legs[0].polyline = [
      [121, 25],
      [121.001, 25],
      [121.001, 25.001],
    ];
    const path = buildCumulativePath(cornerRoute.legs);
    const jumpTo = vi.fn();
    const map = {
      getCenter: () => ({ lng: 121, lat: 25 }),
      getBearing: () => 0,
      isEasing: () => false,
      jumpTo,
    };
    useMapStore.setState({
      activeNavigationRoute: cornerRoute,
      map: map as unknown as ReturnType<typeof useMapStore.getState>["map"],
    });
    const nav = useNavStore.getState();
    nav.promoteToLive();
    nav.setTransitRide(
      {
        ...newTransitRide(
          JSON.stringify([
            route.routeToken,
            route.navigationId,
            route.routeVersion,
            0,
          ]),
        ),
        boarded: true,
      },
      null,
    );
    const progress = {
      routeToken: "token",
      navigationId: "nav",
      routeVersion: 1,
      legIndex: 0,
      segmentIndex: 0,
      alongM: path.cumM[1] - 20,
      observedAt: Date.now(),
      source: "gps" as const,
    };
    nav.setRouteProgress(progress);
    useMapStore
      .getState()
      .setUserLocation(
        { lng: 121.001, lat: 25.0005 },
        { accuracyM: 5, timestamp: Date.now() },
      );
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    renderEffects();
    const stopCamera = h.effects[11]();
    frame?.(0);
    nav.setRouteProgress({
      ...progress,
      alongM: path.cumM[1] + 50,
      segmentIndex: 1,
    });
    for (let timestamp = 16; timestamp < 800; timestamp += 16)
      frame?.(timestamp);
    expect(jumpTo).toHaveBeenCalled();
    const centers = jumpTo.mock.calls.map(
      ([options]) => options.center as [number, number],
    );
    expect(centers.every(([lng, lat]) => lat === 25 || lng === 121.001)).toBe(
      true,
    );
    expect(centers.some(([, lat]) => lat > 25)).toBe(true);
    stopCamera?.();
  });
});
