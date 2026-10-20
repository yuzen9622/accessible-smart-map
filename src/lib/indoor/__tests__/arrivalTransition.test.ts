import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  confirmVenueArrival,
  startNavigation,
  startVenueApproach,
  stopNavigation,
  tryAutoConfirmVenueArrival,
} from "@/lib/navigation/navigationLifecycle";
import useIndoorCatalog from "@/stores/useIndoorCatalog";
import useMapStore from "@/stores/useMapStore";
import useNavStore from "@/stores/useNavStore";
import type { AccessibleRoute, NavInstruction } from "@/types/route";
import {
  evaluateVenueArrival,
  remainingOutdoorDistanceToArrival,
  type VenueArrivalSnapshot,
} from "../arrivalTransition";
import { toVenuePlaceDetail } from "../catalog";
import { localToLngLat } from "../coordinates";
import { buildVenueJourney } from "../journey";
import type { LocalIndoorModel } from "../types";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const NOW = 100_000;
const near = { lat: 10, lng: 10 };
function snapshot(): VenueArrivalSnapshot {
  return {
    sessionKey: "session-a",
    activeOutdoor: true,
    sourceValid: true,
    liveNavigation: true,
    currentStep: { type: "arrive", legType: "WALK" },
    riding: false,
    remainingOutdoorM: 0,
    arrival: near,
    location: near,
    fix: { accuracyM: 8, timestamp: NOW },
    now: NOW,
  };
}

describe("near-entrance GPS policy", () => {
  it("requires two different fixes at least two seconds apart, even at an unchanged position", () => {
    const input = snapshot();
    const first = evaluateVenueArrival(null, input);
    expect(first.shouldTransition).toBe(false);
    expect(evaluateVenueArrival(first.candidate, input).shouldTransition).toBe(
      false,
    );
    const early = evaluateVenueArrival(first.candidate, {
      ...input,
      fix: { accuracyM: 8, timestamp: NOW + 1_999 },
      now: NOW + 1_999,
    });
    expect(early.shouldTransition).toBe(false);
    expect(
      evaluateVenueArrival(early.candidate, {
        ...input,
        fix: { accuracyM: 8, timestamp: NOW + 2_000 },
        now: NOW + 2_000,
      }).shouldTransition,
    ).toBe(true);
  });
  it.each([
    ["far", { location: { lat: 10.001, lng: 10 } }],
    ["idle", { activeOutdoor: false }],
    ["preview", { liveNavigation: false }],
    ["stale source", { sourceValid: false }],
    ["cached location", { fix: null }],
    ["stale GPS", { fix: { accuracyM: 8, timestamp: NOW - 15_001 } }],
    ["future GPS", { fix: { accuracyM: 8, timestamp: NOW + 1 } }],
    ["poor accuracy", { fix: { accuracyM: 30.01, timestamp: NOW } }],
    ["invalid accuracy", { fix: { accuracyM: Number.NaN, timestamp: NOW } }],
    ["boarding", { currentStep: { type: "transit_board", legType: "BUS" } }],
    ["driving", { currentStep: { type: "arrive", legType: "DRIVE" } }],
    ["riding", { riding: true }],
    ["unknown step", { currentStep: null }],
    ["unconfirmed remaining route", { remainingOutdoorM: null }],
    ["unfinished walking detour", { remainingOutdoorM: 8.01 }],
    ["nonfinite remaining route", { remainingOutdoorM: Number.NaN }],
    [
      "nearby but outside entrance radius",
      { location: { lat: 10.0001, lng: 10 } },
    ],
  ] satisfies [string, Partial<VenueArrivalSnapshot>][])(
    "clears a candidate on %s instead of triggering",
    (_name, patch) => {
      const input = snapshot();
      const first = evaluateVenueArrival(null, input);
      expect(
        evaluateVenueArrival(first.candidate, { ...input, ...patch }),
      ).toEqual({ candidate: null, shouldTransition: false });
    },
  );
  it("starts a new observation after a changed journey or a gap longer than freshness", () => {
    const input = snapshot();
    const first = evaluateVenueArrival(null, input);
    expect(
      evaluateVenueArrival(first.candidate, {
        ...input,
        sessionKey: "different",
        fix: { accuracyM: 8, timestamp: NOW + 2_000 },
        now: NOW + 2_000,
      }).shouldTransition,
    ).toBe(false);
    expect(
      evaluateVenueArrival(first.candidate, {
        ...input,
        fix: { accuracyM: 8, timestamp: NOW + 16_000 },
        now: NOW + 16_000,
      }).shouldTransition,
    ).toBe(false);
  });
  it("drops out-of-order fixes and does not retain a pre-jump candidate", () => {
    const input = snapshot();
    const first = evaluateVenueArrival(null, input);
    expect(
      evaluateVenueArrival(first.candidate, {
        ...input,
        fix: { accuracyM: 8, timestamp: NOW - 1 },
      }),
    ).toEqual({ candidate: null, shouldTransition: false });
    const far = evaluateVenueArrival(first.candidate, {
      ...input,
      location: { lat: 11, lng: 10 },
    });
    expect(
      evaluateVenueArrival(far.candidate, {
        ...input,
        fix: { accuracyM: 8, timestamp: NOW + 2_000 },
        now: NOW + 2_000,
      }).shouldTransition,
    ).toBe(false);
  });
});

function sourceModel(): LocalIndoorModel {
  return {
    schemaVersion: 1,
    venueId: "test-campus",
    name: "Synthetic",
    origin: [10, 10],
    source: { sha256: "source-v1", generatedAt: "test", warnings: [] },
    building: {
      id: "hall",
      name: "Hall",
      footprint: [],
      levels: [{ ordinal: 0, ref: "1F", elevationM: 0 }],
      floorHeightM: 4,
      heightStatus: "estimated",
      geometryStatus: "schematic",
    },
    preview: { levels: [0], gatePlaceIds: ["gate"] },
    features: [],
    connections: [],
    walls: [],
    nodes: [
      {
        id: "gate-node",
        point: [0, 0, 0],
        buildingId: null,
        levelRef: null,
        ordinal: null,
        kind: "entrance",
      },
      {
        id: "room-node",
        point: [5, 0, 0],
        buildingId: "hall",
        levelRef: "1F",
        ordinal: 0,
        kind: "place",
      },
    ],
    edges: [
      {
        id: "path",
        from: "gate-node",
        to: "room-node",
        kind: "footway",
        lengthM: 5,
        wheelchair: "yes",
        ramp: false,
        heightPending: false,
        heightStatus: "estimated",
        geometryStatus: "schematic",
        tags: {},
        osmRef: "path",
      },
    ],
    places: [
      {
        id: "gate",
        name: "Gate",
        buildingId: null,
        kind: "entrance",
        nodeId: "gate-node",
        point: [0, 0, 0],
        levelRef: null,
        routeEndpoint: "place",
        doorKnown: false,
        arrivalOnly: false,
        tags: {},
      },
      {
        id: "room",
        name: "Room",
        buildingId: "hall",
        kind: "room",
        nodeId: "room-node",
        point: [5, 0, 0],
        levelRef: "1F",
        routeEndpoint: "corridor",
        doorKnown: false,
        arrivalOnly: true,
        tags: {},
      },
    ],
  };
}
function outdoorRoute(id: string): AccessibleRoute {
  return {
    routeId: id,
    routeToken: `token-${id}`,
    navigationId: `nav-${id}`,
    routeVersion: 1,
    routeName: id,
    totalMinutes: 1,
    transferCount: 0,
    accessibilityHighlights: [],
    legs: [
      {
        type: "WALK",
        from: "Street",
        to: "Gate",
        distanceM: 20,
        minutesEst: 1,
        a11yFacilities: [],
        polyline: [
          [9.9998, 10],
          [10, 10],
        ],
      },
    ],
  };
}
function walkingInstruction(): NavInstruction {
  return {
    type: "arrive",
    legType: "WALK",
    text: "Gate",
    bearing: null,
    relativeDirection: null,
    distanceM: 0,
    streetName: null,
    polylineIndex: 1,
  };
}
function setup(withApproach = false) {
  const model = sourceModel();
  const from = toVenuePlaceDetail(model, model.places[0]);
  const to = toVenuePlaceDetail(model, model.places[1]);
  const planned = buildVenueJourney(model, from, to, "normal");
  if (!planned.ok) throw new Error("Synthetic route disconnected");
  const primary = outdoorRoute("primary");
  const tail = outdoorRoute("tail");
  const journey = {
    ...planned.journey,
    outdoor: {
      origin: {
        kind: "coordinate" as const,
        address: "Original origin",
        position: { lat: 10, lng: 9.99 },
      },
      routes: [primary],
      arrival: from,
      selectedIndex: 0,
      phase: "travel" as const,
      ...(withApproach ? { approachRoutes: { "token-primary": tail } } : {}),
    },
  };
  useIndoorCatalog.getState().setModels([model]);
  useMapStore.getState().setVenueJourney(journey);
  startNavigation();
  useNavStore.getState().setInstructions([walkingInstruction()]);
  useNavStore.getState().promoteToLive();
  return { model, journey, primary, tail };
}

beforeEach(() => {
  stopNavigation();
  useMapStore.setState(useMapStore.getInitialState());
  useNavStore.setState(useNavStore.getInitialState());
  useIndoorCatalog.setState(useIndoorCatalog.getInitialState());
});

describe("GPS metadata and the real navigation lifecycle", () => {
  it("updates stationary fix timestamps but never grants credibility to cache-only location writes", () => {
    const state = useMapStore.getState();
    state.setUserLocation(near, { accuracyM: 8, timestamp: NOW });
    const first = useMapStore.getState().userLocation;
    state.setUserLocation(
      { ...near },
      { accuracyM: 8, timestamp: NOW + 2_000 },
    );
    expect(useMapStore.getState().userLocation).toBe(first);
    expect(useMapStore.getState().userLocationFix?.timestamp).toBe(NOW + 2_000);
    state.setUserLocation(near);
    expect(useMapStore.getState().userLocationFix).toBeNull();
  });
  it("uses the latest coordinates for trusted fixes even within the former half-metre dedup window", () => {
    const state = useMapStore.getState();
    state.setUserLocation(near, { accuracyM: 8, timestamp: NOW });
    const next = { lat: near.lat + 0.000001, lng: near.lng };
    state.setUserLocation(next, { accuracyM: 8, timestamp: NOW + 2_000 });
    expect(useMapStore.getState().userLocation).toEqual(next);
  });
  it("automatically starts only step zero at the selected gate, preserving the original origin and classroom destination", () => {
    const { journey } = setup();
    useMapStore
      .getState()
      .setUserLocation(near, { accuracyM: 8, timestamp: NOW });
    const first = tryAutoConfirmVenueArrival(null, NOW);
    expect(first.shouldTransition).toBe(false);
    useMapStore
      .getState()
      .setUserLocation(near, { accuracyM: 8, timestamp: NOW + 2_000 });
    expect(
      tryAutoConfirmVenueArrival(first.candidate, NOW + 2_000).shouldTransition,
    ).toBe(true);
    const state = useMapStore.getState();
    expect(state.venueJourney?.guidance).toEqual({
      status: "touring",
      stepIndex: 0,
    });
    expect(state.origin).toEqual(journey.outdoor.origin);
    expect(state.destination).toEqual(journey.to);
    expect(state.activeNavigationRoute).toBeNull();
    expect(state.isNavigating).toBe(true);
    expect(state.venueJourney?.from.placeId).toBe("gate");
    expect(state.venueJourney?.route.points[0]).toEqual([0, 0, 0]);
  });
  it("rechecks current source versions rather than using the first sample's approval", () => {
    const { model } = setup();
    useMapStore
      .getState()
      .setUserLocation(near, { accuracyM: 8, timestamp: NOW });
    const first = tryAutoConfirmVenueArrival(null, NOW);
    useIndoorCatalog
      .getState()
      .setModels([
        { ...model, source: { ...model.source, sha256: "new-revision" } },
      ]);
    useMapStore
      .getState()
      .setUserLocation(near, { accuracyM: 8, timestamp: NOW + 2_000 });
    expect(tryAutoConfirmVenueArrival(first.candidate, NOW + 2_000)).toEqual({
      candidate: null,
      shouldTransition: false,
    });
    expect(useMapStore.getState().venueJourney?.guidance.status).toBe(
      "outdoor",
    );
  });
  it("does not skip a 36-metre walking detour while six metres from the gate, even if the outdoor engine has already marked arrived", () => {
    const { model, primary } = setup();
    const coordinates = (
      [
        [0, -6],
        [15, -6],
        [15, 0],
        [0, 0],
      ] as [number, number][]
    ).map((point) => localToLngLat(point, model.origin));
    const route = {
      ...primary,
      legs: primary.legs.map((leg) => ({ ...leg, polyline: coordinates })),
    };
    useMapStore.setState({ activeNavigationRoute: route });
    const location = { lng: coordinates[0][0], lat: coordinates[0][1] };
    expect(
      remainingOutdoorDistanceToArrival(route, location, near),
    ).toBeCloseTo(36, 1);
    useNavStore.getState().setProgress({ remainingM: 36 });
    useNavStore.getState().setArrived(true);
    expect(useNavStore.getState().remainingM).toBe(0);
    useMapStore
      .getState()
      .setUserLocation(location, { accuracyM: 8, timestamp: NOW });
    const first = tryAutoConfirmVenueArrival(null, NOW);
    useMapStore
      .getState()
      .setUserLocation(location, { accuracyM: 8, timestamp: NOW + 2_000 });
    expect(
      tryAutoConfirmVenueArrival(first.candidate, NOW + 2_000).shouldTransition,
    ).toBe(false);
    expect(useMapStore.getState().venueJourney?.guidance.status).toBe(
      "outdoor",
    );
  });
  it("allows the final five metres only after two reliable fixes on that walking tail", () => {
    setup();
    const [lng, lat] = localToLngLat([-5, 0], [10, 10]);
    const location = { lng, lat };
    expect(
      remainingOutdoorDistanceToArrival(
        useMapStore.getState().activeNavigationRoute,
        location,
        near,
      ),
    ).toBeCloseTo(5, 1);
    useMapStore
      .getState()
      .setUserLocation(location, { accuracyM: 8, timestamp: NOW });
    const first = tryAutoConfirmVenueArrival(null, NOW);
    expect(first.shouldTransition).toBe(false);
    useMapStore
      .getState()
      .setUserLocation(location, { accuracyM: 8, timestamp: NOW + 2_000 });
    expect(
      tryAutoConfirmVenueArrival(first.candidate, NOW + 2_000).shouldTransition,
    ).toBe(true);
  });
  it("does not treat a route with an endpoint gap or missing active geometry as completed", () => {
    const route = outdoorRoute("wrong-arrival");
    route.legs[0].polyline[1] = [10.001, 10];
    expect(remainingOutdoorDistanceToArrival(route, near, near)).toBeNull();
    expect(remainingOutdoorDistanceToArrival(null, near, near)).toBeNull();
  });
  it("cannot reuse a candidate after navigation stops", () => {
    setup();
    useMapStore
      .getState()
      .setUserLocation(near, { accuracyM: 8, timestamp: NOW });
    const first = tryAutoConfirmVenueArrival(null, NOW);
    stopNavigation();
    useMapStore
      .getState()
      .setUserLocation(near, { accuracyM: 8, timestamp: NOW + 2_000 });
    expect(
      tryAutoConfirmVenueArrival(first.candidate, NOW + 2_000).shouldTransition,
    ).toBe(false);
  });
  it("does not skip the separately routed walking tail and resumes that tail without changing the original selected candidate", () => {
    const { primary, tail } = setup(true);
    useMapStore
      .getState()
      .setUserLocation(near, { accuracyM: 8, timestamp: NOW });
    expect(tryAutoConfirmVenueArrival(null, NOW).candidate).toBeNull();
    confirmVenueArrival();
    expect(useMapStore.getState().venueJourney?.guidance.status).toBe(
      "outdoor",
    );
    startVenueApproach();
    expect(useMapStore.getState().activeNavigationRoute).toEqual(primary);
    useNavStore.getState().setArrived(true);
    startVenueApproach();
    expect(useMapStore.getState().activeNavigationRoute).toEqual(tail);
    expect(useMapStore.getState().selectRoute?.route).toEqual(primary);
    expect(useMapStore.getState().venueJourney?.outdoor?.phase).toBe(
      "approach",
    );
    expect(useNavStore.getState().navigationId).toBe(tail.navigationId);
    stopNavigation();
    startNavigation();
    expect(useMapStore.getState().activeNavigationRoute).toEqual(tail);
    useNavStore.getState().setInstructions([walkingInstruction()]);
    useNavStore.getState().promoteToLive();
    useMapStore
      .getState()
      .setUserLocation(near, { accuracyM: 8, timestamp: NOW + 2_000 });
    const first = tryAutoConfirmVenueArrival(null, NOW + 2_000);
    useMapStore
      .getState()
      .setUserLocation(near, { accuracyM: 8, timestamp: NOW + 4_000 });
    expect(
      tryAutoConfirmVenueArrival(first.candidate, NOW + 4_000).shouldTransition,
    ).toBe(true);
    expect(useMapStore.getState().venueJourney?.guidance).toEqual({
      status: "touring",
      stepIndex: 0,
    });
  });
  it("keeps a failed or invalidated tail inactive", () => {
    const { tail } = setup(true);
    useNavStore.getState().setArrived(true);
    useMapStore.setState({ invalidRouteTokens: [tail.routeToken ?? ""] });
    startVenueApproach();
    expect(useMapStore.getState().venueJourney?.outdoor?.phase).toBe("travel");
    expect(useMapStore.getState().activeNavigationRoute?.routeId).toBe(
      "primary",
    );
  });
});

describe("walking primary to independently routed walking approach", () => {
  function install() {
    const base = setup(true);
    const point = (x: number, y = 0) => localToLngLat([x, y], [10, 10]);
    const primary: AccessibleRoute = {
      ...base.primary,
      legs: base.primary.legs.map((leg) => ({
        ...leg,
        polyline: [point(-30), point(-6)],
      })),
    };
    const tail: AccessibleRoute = {
      ...base.tail,
      legs: base.tail.legs.map((leg) => ({
        ...leg,
        polyline: [point(-6), point(0)],
      })),
    };
    const journey = useMapStore.getState().venueJourney;
    if (!journey?.outdoor) throw new Error("Missing synthetic journey");
    useMapStore.setState({
      venueJourney: {
        ...journey,
        outdoor: {
          ...journey.outdoor,
          routes: [primary],
          navigationIndex: 0,
          approachRoutes: { "token-primary": tail },
        },
      },
      activeNavigationRoute: primary,
    });
    const fix = (timestamp: number, x = -6, y = 0) => {
      const [lng, lat] = point(x, y);
      useMapStore
        .getState()
        .setUserLocation({ lng, lat }, { accuracyM: 5, timestamp });
    };
    return { ...base, primary, tail, point, fix };
  }

  it("automatically switches tokens after two reliable fixes at the actual walking endpoint without requiring an arrived flag", () => {
    const { primary, tail, fix } = install();
    fix(NOW);
    const first = tryAutoConfirmVenueArrival(null, NOW);
    expect(first.candidate).not.toBeNull();
    expect(first.shouldTransition).toBe(false);
    expect(useNavStore.getState().arrived).toBe(false);
    expect(
      tryAutoConfirmVenueArrival(first.candidate, NOW).shouldTransition,
    ).toBe(false);
    fix(NOW + 2_000);
    expect(
      tryAutoConfirmVenueArrival(first.candidate, NOW + 2_000).shouldTransition,
    ).toBe(true);
    expect(useMapStore.getState().activeNavigationRoute).toEqual(tail);
    expect(useMapStore.getState().venueJourney?.outdoor?.routes[0]).toEqual(
      primary,
    );
    expect(useMapStore.getState().venueJourney?.outdoor?.phase).toBe(
      "approach",
    );
    expect(useMapStore.getState().venueJourney?.guidance.status).toBe(
      "outdoor",
    );
    expect(useNavStore.getState().navigationId).toBe(tail.navigationId);
  });

  it("uses the navigation candidate even when a different overview candidate is selected", () => {
    const { primary, tail, fix } = install();
    const journey = useMapStore.getState().venueJourney;
    if (!journey?.outdoor) throw new Error("Missing synthetic journey");
    useMapStore.setState({
      venueJourney: {
        ...journey,
        outdoor: {
          ...journey.outdoor,
          routes: [primary, outdoorRoute("different")],
          selectedIndex: 1,
        },
      },
    });
    fix(NOW);
    const first = tryAutoConfirmVenueArrival(null, NOW);
    fix(NOW + 2_000);
    expect(
      tryAutoConfirmVenueArrival(first.candidate, NOW + 2_000).shouldTransition,
    ).toBe(true);
    expect(useMapStore.getState().activeNavigationRoute).toEqual(tail);
    expect(useMapStore.getState().venueJourney?.outdoor?.selectedIndex).toBe(1);
  });

  it("does not skip the last six metres or a detour merely because the primary endpoint is nearby", () => {
    const { primary, point, fix } = install();
    fix(NOW, -12);
    expect(tryAutoConfirmVenueArrival(null, NOW).candidate).toBeNull();
    const detour = {
      ...primary,
      legs: primary.legs.map((leg) => ({
        ...leg,
        polyline: [point(-6, -1), point(9, -1), point(9), point(-6)],
      })),
    };
    const journey = useMapStore.getState().venueJourney;
    if (!journey?.outdoor) throw new Error("Missing synthetic journey");
    useMapStore.setState({
      activeNavigationRoute: detour,
      venueJourney: {
        ...journey,
        outdoor: { ...journey.outdoor, routes: [detour] },
      },
    });
    useNavStore.getState().setArrived(true);
    fix(NOW + 2_000, -6, -1);
    expect(tryAutoConfirmVenueArrival(null, NOW + 2_000).candidate).toBeNull();
    expect(useMapStore.getState().venueJourney?.outdoor?.phase).toBe("travel");
  });

  it.each([
    "stale",
    "poor accuracy",
    "preview",
    "voice",
    "riding",
    "wrong owner",
    "wrong version",
    "invalid token",
    "invalid tail",
    "source",
    "missing tail start",
    "tail gap",
  ])("does not switch a walking tail with %s", (invalid) => {
    const { model, primary, tail, fix, point } = install();
    fix(NOW);
    const first = tryAutoConfirmVenueArrival(null, NOW);
    fix(NOW + 2_000);
    if (invalid === "stale")
      useMapStore.setState({
        userLocationFix: { accuracyM: 5, timestamp: NOW - 16_000 },
      });
    if (invalid === "poor accuracy")
      useMapStore.setState({
        userLocationFix: { accuracyM: 31, timestamp: NOW + 2_000 },
      });
    if (invalid === "preview")
      useNavStore.setState({ navigationMode: "preview" });
    if (invalid === "voice")
      useNavStore.getState().setNavigationSource("voice");
    if (invalid === "riding")
      useNavStore.setState({
        transitRide: { boarded: true } as NonNullable<
          ReturnType<typeof useNavStore.getState>["transitRide"]
        >,
      });
    if (invalid === "wrong owner")
      useNavStore.getState().setNavigationIdentity("other-owner", 1);
    if (invalid === "wrong version")
      useMapStore.setState({
        activeNavigationRoute: { ...primary, routeVersion: 2 },
      });
    if (invalid === "invalid token")
      useMapStore.setState({ invalidRouteTokens: [primary.routeToken ?? ""] });
    if (invalid === "invalid tail")
      useMapStore.setState({ invalidRouteTokens: [tail.routeToken ?? ""] });
    if (invalid === "source")
      useIndoorCatalog
        .getState()
        .setModels([
          { ...model, source: { ...model.source, sha256: "changed" } },
        ]);
    if (invalid === "missing tail start") tail.legs[0].polyline = [];
    if (invalid === "tail gap") tail.legs[0].polyline[0] = point(-15);
    expect(tryAutoConfirmVenueArrival(first.candidate, NOW + 2_000)).toEqual({
      candidate: null,
      shouldTransition: false,
    });
    expect(useMapStore.getState().venueJourney?.outdoor?.phase).toBe("travel");
  });

  it("does not automatically switch a vehicle primary even with reliable fixes at its endpoint", () => {
    const { primary, fix } = install();
    const driven: AccessibleRoute = {
      ...primary,
      legs: [
        {
          type: "DRIVE",
          from: "Start",
          to: "Drop-off",
          distanceM: 24,
          durationMin: 1,
          polyline: primary.legs[0].polyline,
        },
      ],
    };
    const journey = useMapStore.getState().venueJourney;
    if (!journey?.outdoor) throw new Error("Missing synthetic journey");
    useMapStore.setState({
      activeNavigationRoute: driven,
      venueJourney: {
        ...journey,
        outdoor: { ...journey.outdoor, routes: [driven] },
      },
    });
    useNavStore
      .getState()
      .setInstructions([{ ...walkingInstruction(), legType: "DRIVE" }]);
    fix(NOW);
    const first = tryAutoConfirmVenueArrival(null, NOW);
    fix(NOW + 2_000);
    expect(
      tryAutoConfirmVenueArrival(first.candidate, NOW + 2_000).shouldTransition,
    ).toBe(false);
    expect(useMapStore.getState().venueJourney?.outdoor?.phase).toBe("travel");
  });
});
