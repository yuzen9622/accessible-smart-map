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

import { localToLngLat } from "@/lib/indoor/coordinates";
import type { VenueJourney } from "@/lib/indoor/journey";
import {
  newTransitRide,
  sampleBoarding,
} from "@/lib/navigation/transitRideRuntime";
import useMapStore from "@/stores/useMapStore";
import useNavStore from "@/stores/useNavStore";
import type { VenuePlaceDetail } from "@/types";
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
    venueJourney: null,
  });
  useNavStore.getState().setNavigationIdentity("n", 1);
  useNavStore.getState().setInstructions(steps);
  h.reroute.mockClear();
  h.clear.mockClear();
});

describe("mixed venue final walking arrival", () => {
  const origin: [number, number] = [10, 10];
  const coordinates = (
    [
      [0, -6],
      [15, -6],
      [15, 0],
      [0, 0],
    ] as [number, number][]
  ).map((point) => localToLngLat(point, origin));
  const walking: AccessibleRoute = {
    routeId: "tail",
    routeToken: "tail-token",
    navigationId: "tail-nav",
    routeVersion: 1,
    routeName: "Gate walk",
    totalMinutes: 1,
    transferCount: 0,
    accessibilityHighlights: [],
    legs: [
      {
        type: "WALK",
        from: "Parking",
        to: "Gate",
        distanceM: 36,
        minutesEst: 1,
        a11yFacilities: [],
        polyline: coordinates,
      },
    ],
  };
  const gate: VenuePlaceDetail = {
    kind: "venue-place",
    name: "Gate",
    address: "Gate",
    venueId: "campus",
    buildingId: null,
    buildingName: "Campus",
    levelRef: null,
    placeId: "gate",
    sourceVersion: "v1",
    dataSource: "local",
    arrivalKind: "place",
    position: { lat: 10, lng: 10 },
  };
  function install(phase: "travel" | "approach" = "approach", vehicle = false) {
    const active: AccessibleRoute = vehicle
      ? {
          ...walking,
          routeId: "primary",
          routeToken: "primary-token",
          navigationId: "primary-nav",
          legs: [
            {
              type: "DRIVE",
              from: "Street",
              to: "Parking",
              distanceM: 36,
              durationMin: 1,
              polyline: coordinates,
            },
          ],
        }
      : walking;
    const journey: VenueJourney = {
      id: "journey",
      venueId: "campus",
      buildingId: "hall",
      sourceVersion: "v1",
      from: gate,
      to: {
        ...gate,
        name: "Room",
        placeId: "room",
        buildingId: "hall",
        levelRef: "1F",
        arrivalKind: "corridor",
      },
      mode: "normal",
      verticalPreference: "auto",
      route: {
        ok: true,
        fromPlaceId: "gate",
        toPlaceId: "room",
        points: [
          [0, 0, 0],
          [5, 0, 0],
        ],
        kinds: ["footway"],
        steps: [],
        distanceM: 5,
        animationSafe: false,
        warnings: [],
        edgeIds: ["entry"],
      },
      preview: { progress: 0, playing: false, direction: 1 },
      guidance: { status: "outdoor", stepIndex: 0 },
      outdoor: {
        origin: {
          kind: "coordinate",
          address: "Start",
          position: { lat: 10, lng: 9.99 },
        },
        routes: [active],
        selectedIndex: 0,
        arrival: gate,
        phase,
        ...(vehicle ? { approachRoutes: { "primary-token": walking } } : {}),
      },
    };
    useMapStore.setState({
      venueJourney: journey,
      activeNavigationRoute: active,
    });
    useNavStore
      .getState()
      .setNavigationIdentity(active.navigationId ?? null, 1);
    useNavStore.getState().setInstructions(
      coordinates.map((_, index) => ({
        ...steps[0],
        type: index === 0 ? "depart" : index === 3 ? "arrive" : "turn",
        text: index === 3 ? "Gate" : "Continue on the planned path",
        legType: vehicle ? "DRIVE" : "WALK",
        polylineIndex: index,
      })),
    );
    return { active, journey };
  }
  const atStart = () => ({ lng: coordinates[0][0], lat: coordinates[0][1] });
  it.each(["travel", "approach"] as const)(
    "keeps the 36-metre walk active in %s phase despite a six-metre straight-line gate distance",
    (phase) => {
      install(phase);
      frame(atStart());
      expect(useNavStore.getState().arrived).toBe(false);
      expect(useNavStore.getState().remainingM).toBeCloseTo(36, 1);
      expect(
        useNavStore.getState().instructions[
          useNavStore.getState().currentStepIndex
        ].type,
      ).toBe("turn");
    },
  );
  it("marks actual final five-metre walking progress as near the gate", () => {
    install();
    const [lng, lat] = localToLngLat([5, 0], origin);
    frame({ lat, lng });
    expect(useNavStore.getState().arrived).toBe(true);
  });
  it("preserves ordinary outdoor arrival behavior", () => {
    install();
    useMapStore.setState({ venueJourney: null });
    frame(atStart());
    expect(useNavStore.getState().arrived).toBe(true);
  });
  it("preserves vehicle-primary arrival at the drop-off point before its walking tail starts", () => {
    install("travel", true);
    frame(atStart());
    expect(useNavStore.getState().arrived).toBe(true);
  });
  it("does not arrive early on a walking primary that has a separate tail", () => {
    const { active, journey } = install("travel");
    if (!journey.outdoor) throw new Error("Missing outdoor journey");
    journey.outdoor.approachRoutes = {
      "tail-token": {
        ...walking,
        routeToken: "next-walk-token",
      },
    };
    useMapStore.setState({
      venueJourney: { ...journey },
      activeNavigationRoute: active,
    });
    frame(atStart());
    expect(useNavStore.getState().arrived).toBe(false);
    const [lng, lat] = localToLngLat([5, 0], origin);
    frame({ lng, lat });
    expect(useNavStore.getState().arrived).toBe(false);
    frame(gate.position);
    expect(useNavStore.getState().arrived).toBe(true);
  });
  it("keeps the walking navigation candidate's two-metre handoff radius after overview selection changes", () => {
    const { active, journey } = install("travel");
    if (!journey.outdoor) throw new Error("Missing outdoor journey");
    journey.outdoor.routes = [
      active,
      { ...walking, routeToken: "overview-token" },
    ];
    journey.outdoor.navigationIndex = 0;
    journey.outdoor.selectedIndex = 1;
    journey.outdoor.approachRoutes = {
      "tail-token": {
        ...walking,
        routeToken: "next-walk-token",
      },
    };
    useMapStore.setState({ venueJourney: { ...journey } });
    const [lng, lat] = localToLngLat([5, 0], origin);
    frame({ lng, lat });
    expect(useNavStore.getState().arrived).toBe(false);
    frame(gate.position);
    expect(useNavStore.getState().arrived).toBe(true);
  });
  it("keeps the vehicle navigation candidate's drop-off arrival after overview selection changes", () => {
    const { active, journey } = install("travel", true);
    if (!journey.outdoor) throw new Error("Missing outdoor journey");
    journey.outdoor.routes = [active, walking];
    journey.outdoor.navigationIndex = 0;
    journey.outdoor.selectedIndex = 1;
    useMapStore.setState({ venueJourney: { ...journey } });
    frame(atStart());
    expect(useNavStore.getState().arrived).toBe(true);
  });
  it("clears an obsolete early arrival flag when the current walking path still has a detour", () => {
    install();
    useNavStore.getState().setArrived(true);
    frame(atStart());
    expect(useNavStore.getState().arrived).toBe(false);
    expect(useNavStore.getState().remainingM).toBeCloseTo(36, 1);
  });
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
