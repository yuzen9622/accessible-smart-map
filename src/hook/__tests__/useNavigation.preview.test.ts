import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  effects: [] as (() => undefined | (() => void))[],
  reroute: vi.fn(),
  clear: vi.fn(),
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
    confirmOffRouteEpisode: h.reroute,
    clearOffRouteEpisode: h.clear,
  }),
}));
vi.mock("@/lib/api/a11y", () => ({ getRouteInstructions: vi.fn() }));

import {
  newTransitRide,
  sampleBoarding,
} from "@/lib/navigation/transitRideRuntime";
import useMapStore from "@/stores/useMapStore";
import useNavStore from "@/stores/useNavStore";
import type { AccessibleRoute, NavInstruction } from "@/types/route";
import useNavigation from "../useNavigation";

const route = {
  routeToken: "token",
  navigationId: "n",
  routeVersion: 1,
  totalMinutes: 5,
  legs: [
    {
      type: "WALK",
      polyline: [
        [121, 25],
        [121.002, 25],
      ],
      a11yFacilities: [],
    },
  ],
} as unknown as AccessibleRoute;
const steps = [
  {
    type: "depart",
    text: "start",
    legIndex: 0,
    legType: "WALK",
    polylineIndex: 0,
  },
  {
    type: "arrive",
    text: "arrive",
    legIndex: 0,
    legType: "WALK",
    polylineIndex: 1,
  },
] as NavInstruction[];
let cleanup: (() => void) | undefined;
/** Run the real geometry subscription and real GPS progress effect, excluding network/camera effects. */
function frame(location: { lat: number; lng: number } | null) {
  cleanup?.();
  h.effects.length = 0;
  useMapStore.getState().setUserLocation(location);
  // biome-ignore lint/correctness/useHookAtTopLevel: deterministic mock hook harness, not a React render.
  useNavigation();
  cleanup = h.effects[0]() as () => void;
  h.effects[3]();
}
beforeEach(() => {
  useNavStore.getState().reset();
  useMapStore.setState({
    activeNavigationRoute: route,
    isNavigating: true,
    userLocation: null,
  });
  useNavStore.getState().setNavigationIdentity("n", 1);
  useNavStore.getState().setInstructions(steps);
  h.reroute.mockClear();
  h.clear.mockClear();
});
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.unstubAllGlobals();
});

describe("explicit preview/live GPS engine", () => {
  it("hidden GPS does not promote, arrive or reroute", () => {
    vi.stubGlobal("document", { hidden: true });
    frame({ lat: 25, lng: 121.002 });
    expect(useNavStore.getState().navigationMode).toBe("preview");
    expect(useNavStore.getState().arrived).toBe(false);
    expect(h.reroute).not.toHaveBeenCalled();
  });
  it("ignores a foreground fix after route replacement", () => {
    const getCurrentPosition = vi.fn();
    const addEventListener = vi.fn();
    vi.stubGlobal("document", {
      hidden: false,
      visibilityState: "visible",
      addEventListener,
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });
    frame(null);
    const endForeground = h.effects[7]() as () => void;
    const listener = addEventListener.mock.calls[0][1] as () => void;
    listener();
    expect(getCurrentPosition).toHaveBeenCalledOnce();
    useMapStore.setState({
      activeNavigationRoute: { ...route, routeVersion: 2 },
    });
    getCurrentPosition.mock.calls[0][0]({
      coords: { latitude: 25, longitude: 121.002, heading: 90 },
    });
    expect(useMapStore.getState().userLocation).toBeNull();
    endForeground();
  });
  it("hidden → return far cannot reuse the old station observation", () => {
    const addEventListener = vi.fn();
    const doc = {
      hidden: false,
      visibilityState: "visible",
      addEventListener,
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("document", doc);
    frame(null);
    useNavStore.getState().promoteToLive();
    useNavStore
      .getState()
      .setTransitRide(
        sampleBoarding(newTransitRide("run"), 0, 0, 1000, 0),
        null,
      );
    const endForeground = h.effects[7]() as () => void;
    doc.hidden = true;
    doc.visibilityState = "hidden";
    addEventListener.mock.calls[0][1]();
    let ride = useNavStore.getState().transitRide;
    if (!ride) throw new Error("Expected hidden ride runtime");
    expect(ride.observedAtStop).toBe(false);
    doc.hidden = false;
    ride = sampleBoarding(ride, 200, 0, 2000, 0);
    ride = sampleBoarding(ride, 230, 0, 7000, 0);
    ride = sampleBoarding(ride, 260, 0, 12000, 0);
    expect(ride.boarded).toBe(false);
    ride = sampleBoarding(ride, 0, 0, 17000, 0);
    ride = sampleBoarding(ride, 30, 0, 22000, 0);
    ride = sampleBoarding(ride, 60, 0, 27000, 0);
    expect(ride.boarded).toBe(true);
    endForeground();
  });
  it("missing and far GPS stay preview without arrival, progress or off-route reroute", () => {
    frame(null);
    frame({ lat: 24, lng: 120 });
    frame({ lat: 24, lng: 120 });
    frame({ lat: 24, lng: 120 });
    const nav = useNavStore.getState();
    expect(nav.navigationMode).toBe("preview");
    expect(nav.arrived).toBe(false);
    expect(nav.isOffRoute).toBe(false);
    expect(nav.remainingM).toBeNull();
    expect(h.reroute).not.toHaveBeenCalled();
  });
  it("rejects moderately off-route GPS while preview rather than rerouting", () => {
    for (let i = 0; i < 4; i++) frame({ lat: 25.001, lng: 121 });
    expect(useNavStore.getState().navigationMode).toBe("preview");
    expect(h.reroute).not.toHaveBeenCalled();
  });
  it("near GPS promotes, clears manual preview projection, and live remains monotonic", () => {
    useNavStore.getState().setStepIndex(1);
    frame({ lat: 25, lng: 121 });
    expect(useNavStore.getState().navigationMode).toBe("live");
    expect(useNavStore.getState().currentStepIndex).toBe(1); // first waypoint is passed at route start
    useNavStore.getState().setStepIndex(0);
    expect(useNavStore.getState().currentStepIndex).toBe(1);
    frame(null);
    frame({ lat: 24, lng: 120 });
    expect(useNavStore.getState().navigationMode).toBe("live");
    expect(useNavStore.getState().arrived).toBe(false);
  });
  it("voice takeover owns progress and does not run the local engine", () => {
    useNavStore.getState().setNavigationSource("voice");
    useNavStore.getState().applyVoiceStep(0, "voice", 50);
    frame({ lat: 25, lng: 121.002 });
    expect(useNavStore.getState().currentStepIndex).toBe(0);
    expect(useNavStore.getState().arrived).toBe(false);
    expect(h.reroute).not.toHaveBeenCalled();
  });
  it("boarding GPS holds the board instruction, and a destination jump cannot arrive", () => {
    const busRoute = {
      ...route,
      legs: [
        {
          type: "BUS",
          routeName: "99",
          departureStop: "A",
          arrivalStop: "B",
          polyline: [
            [121, 25],
            [121.002, 25],
          ],
          intermediateStops: [],
          waitInfo: { time: null, source: "unavailable" },
          estimatedWaitMinutes: 0,
          direction: 0,
          departureStopA11y: [],
          arrivalStopA11y: [],
        },
      ],
    } as AccessibleRoute;
    useMapStore.setState({ activeNavigationRoute: busRoute });
    useNavStore.getState().setInstructions([
      { ...steps[0], legType: "BUS", type: "transit_board" },
      { ...steps[1], legType: "BUS", type: "transit_alight" },
    ]);
    frame({ lat: 25, lng: 121 });
    expect(useNavStore.getState().currentStepIndex).toBe(0);
    frame({ lat: 25, lng: 121.002 });
    expect(useNavStore.getState().currentStepIndex).toBe(0);
    expect(useNavStore.getState().arrived).toBe(false);
    expect(useNavStore.getState().transitRide?.boarded).toBe(false);
  });
});
