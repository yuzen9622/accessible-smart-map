import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { VenueJourney } from "@/lib/indoor/journey";
import useMapStore from "@/stores/useMapStore";
import useNavStore, { type NavAdvisory } from "@/stores/useNavStore";
import type { AccessibleRoute, NavInstruction } from "@/types/route";
import {
  applyRouteReplacement,
  type RouteReplacement,
} from "../rerouteCoordinator";

const instruction: NavInstruction = {
  text: "沿新路線右轉",
  type: "turn",
  bearing: null,
  relativeDirection: null,
  distanceM: 80,
  streetName: null,
  legType: "WALK",
  polylineIndex: 0,
};

const advisory: NavAdvisory = {
  advisoryId: "facility:station-1",
  category: "facility",
  severity: "critical",
  action: "reroute_applied",
  title: "電梯維修中",
  speech: "前方站體電梯維修中，已為你改道",
  rerouteReason: "FACILITY_OUTAGE",
  issuedAt: "2026-09-04T00:00:00.000Z",
};

function route(version: number): AccessibleRoute {
  return {
    routeId: `route-v${version}`,
    navigationId: "nav-1",
    routeVersion: version,
    routeToken: `token-v${version}`,
    routeName: `route ${version}`,
    totalMinutes: 10,
    transferCount: 0,
    legs: [
      {
        type: "WALK",
        from: "起點",
        to: "終點",
        distanceM: 100,
        minutesEst: 2,
        polyline: [
          [121.56, 25.03],
          [121.561, 25.031],
        ],
        a11yFacilities: [],
      },
    ],
    accessibilityHighlights: [],
  };
}

function replacement(
  overrides: Partial<RouteReplacement> = {},
): RouteReplacement {
  return {
    navigationId: "nav-1",
    previousRouteVersion: 1,
    routeVersion: 2,
    routeToken: "token-v2",
    route: route(2),
    instructions: [instruction],
    warnings: [],
    currentStepIndex: 0,
    ...overrides,
  };
}

beforeEach(() => {
  const current = route(1);
  useMapStore.setState({
    venueJourney: null,
    selectRoute: { index: 0, route: current },
    computeRoutes: [current],
  });
  useNavStore.getState().reset();
  useNavStore.setState({
    navigationSource: "voice",
    navigationId: "nav-1",
    routeVersion: 1,
  });
  useNavStore.getState().pushAdvisories([advisory]);
});

afterEach(() => {
  useNavStore.getState().reset();
  useMapStore.setState({
    selectRoute: null,
    computeRoutes: null,
    venueJourney: null,
    activeNavigationRoute: null,
  });
});

function mixedJourney(
  routes: AccessibleRoute[],
  selectedIndex = 0,
): VenueJourney {
  const arrival = {
    kind: "venue-place" as const,
    address: "Gate",
    name: "Gate",
    venueId: "synthetic-campus",
    buildingId: null,
    buildingName: "Campus",
    levelRef: null,
    placeId: "gate",
    sourceVersion: "v1",
    dataSource: "local" as const,
    arrivalKind: "place" as const,
    position: { lng: 121.561, lat: 25.031 },
  };
  return {
    id: "mixed",
    venueId: arrival.venueId,
    buildingId: "building",
    sourceVersion: "v1",
    from: arrival,
    to: {
      ...arrival,
      placeId: "room",
      buildingId: "building",
      levelRef: "2F",
      name: "Room",
    },
    mode: "wheelchair",
    verticalPreference: "elevator",
    route: {
      ok: true,
      fromPlaceId: "gate",
      toPlaceId: "room",
      points: [
        [0, 0, 0],
        [0, 0, 4],
      ],
      kinds: ["elevator"],
      steps: [],
      distanceM: 4,
      animationSafe: true,
      warnings: [],
      edgeIds: ["source-lift"],
    },
    preview: { progress: 0, playing: false, direction: 1 },
    guidance: { status: "outdoor", stepIndex: 0 },
    outdoor: {
      origin: {
        kind: "coordinate",
        address: "Original start",
        position: { lat: 25, lng: 121 },
      },
      routes,
      selectedIndex,
      arrival,
    },
  };
}

describe("mixed route arrival continuity", () => {
  it("atomically refreshes the outdoor route and token without changing the indoor path or original endpoints", () => {
    const current = route(1),
      journey = mixedJourney([current]);
    useMapStore.setState({
      venueJourney: journey,
      activeNavigationRoute: current,
    });
    expect(applyRouteReplacement(replacement())).toBe(true);
    const state = useMapStore.getState();
    expect(state.venueJourney?.outdoor?.routes[0]).toBe(
      state.activeNavigationRoute,
    );
    expect(state.venueJourney?.outdoor?.routes[0]).toBe(
      state.selectRoute?.route,
    );
    expect(state.venueJourney?.outdoor?.routes[0].routeToken).toBe("token-v2");
    expect(state.venueJourney?.route).toBe(journey.route);
    expect(state.venueJourney?.from).toBe(journey.from);
    expect(state.venueJourney?.to).toBe(journey.to);
    expect(state.venueJourney?.outdoor?.origin).toBe(journey.outdoor?.origin);
  });
  it("updates the active candidate while preserving a different preview selection", () => {
    const current = route(1),
      other = { ...route(1), routeId: "other", navigationId: "other-nav" };
    const journey = mixedJourney([current, other], 1);
    useMapStore.setState({
      venueJourney: journey,
      activeNavigationRoute: current,
      computeRoutes: [current, other],
      selectRoute: { index: 1, route: other },
    });
    expect(applyRouteReplacement(replacement())).toBe(true);
    const state = useMapStore.getState();
    expect(state.venueJourney?.outdoor?.routes[0].routeToken).toBe("token-v2");
    expect(state.venueJourney?.outdoor?.selectedIndex).toBe(1);
    expect(state.selectRoute?.route).toBe(other);
  });
  it.each(["gap", "missing"])(
    "rejects %s arrival geometry while retaining the previous route and instructions",
    (kind) => {
      const current = route(1),
        journey = mixedJourney([current]);
      useMapStore.setState({
        venueJourney: journey,
        activeNavigationRoute: current,
      });
      const before = useMapStore.getState();
      const instructions = useNavStore.getState().instructions;
      const next = route(2);
      next.legs[0].polyline =
        kind === "gap"
          ? [
              [121.56, 25.03],
              [121.6, 25.1],
            ]
          : [];
      expect(applyRouteReplacement(replacement({ route: next }))).toBe(false);
      const after = useMapStore.getState();
      expect(after.venueJourney).toBe(journey);
      expect(after.selectRoute).toBe(before.selectRoute);
      expect(after.activeNavigationRoute).toBe(current);
      expect(after.computeRoutes).toBe(before.computeRoutes);
      expect(useNavStore.getState().instructions).toBe(instructions);
      expect(useNavStore.getState()).toMatchObject({
        routeVersion: 1,
        rerouteStatus: "error",
        rerouteRetryable: false,
      });
      expect(useNavStore.getState().rerouteError).toContain("原校園入口");
    },
  );
});

describe("applyRouteReplacement advisory state", () => {
  it("records the reroute reason and clears advisories on success", () => {
    const applied = applyRouteReplacement(
      replacement({ reason: "FACILITY_OUTAGE" }),
    );

    expect(applied).toBe(true);
    expect(useNavStore.getState()).toMatchObject({
      lastRerouteReason: "FACILITY_OUTAGE",
      advisories: [],
    });
  });

  it("falls back to a null reason when the replacement carries none", () => {
    useNavStore.getState().setLastRerouteReason("CONFIRMED_HAZARD");

    expect(applyRouteReplacement(replacement())).toBe(true);
    expect(useNavStore.getState().lastRerouteReason).toBeNull();
  });

  it("writes no state for a stale replacement", () => {
    useNavStore.getState().setLastRerouteReason("OFF_ROUTE");

    const applied = applyRouteReplacement(
      replacement({
        previousRouteVersion: 5,
        routeVersion: 6,
        reason: "TRANSIT_DISRUPTION",
      }),
    );

    expect(applied).toBe(false);
    expect(useNavStore.getState()).toMatchObject({
      lastRerouteReason: "OFF_ROUTE",
      routeVersion: 1,
    });
    expect(useNavStore.getState().advisories).toHaveLength(1);
  });
});

describe("mixed journey reroutes with an independent final walk token", () => {
  const parking: [number, number] = [121.5607, 25.0307];

  function setupApproach(phase: "travel" | "approach") {
    const primary = route(1);
    primary.legs[0].polyline = [[121.56, 25.03], parking];
    const approach: AccessibleRoute = {
      ...route(1),
      routeId: "approach-v1",
      navigationId: "approach-navigation",
      routeToken: "approach-token-v1",
      legs: [{ ...route(1).legs[0], polyline: [parking, [121.561, 25.031]] }],
    };
    const journey = mixedJourney([primary]);
    if (!journey.outdoor) throw new Error("Expected outdoor journey");
    journey.outdoor.phase = phase;
    journey.outdoor.approachRoutes = { "token-v1": approach };
    const active = phase === "approach" ? approach : primary;
    useMapStore.setState({
      venueJourney: journey,
      activeNavigationRoute: active,
      computeRoutes: [primary],
      selectRoute: { index: 0, route: primary },
    });
    useNavStore.setState({
      navigationId: active.navigationId,
      routeVersion: 1,
      arrived: false,
    });
    return { primary, approach, journey };
  }

  it("reroutes travel to the real walk's start and migrates the tail key to the new primary token", () => {
    const { journey, approach } = setupApproach("travel");
    const next = route(2);
    next.legs[0].polyline = [[121.56, 25.03], parking];
    expect(applyRouteReplacement(replacement({ route: next }))).toBe(true);
    const state = useMapStore.getState();
    expect(state.venueJourney?.outdoor?.approachRoutes).toEqual({
      "token-v2": approach,
    });
    expect(state.venueJourney?.outdoor?.routes[0]).toBe(
      state.activeNavigationRoute,
    );
    expect(state.selectRoute?.route).toBe(state.activeNavigationRoute);
    expect(state.venueJourney?.outdoor?.phase).toBe("travel");
    expect(state.venueJourney?.route).toBe(journey.route);
    expect(journey.outdoor?.approachRoutes).toEqual({ "token-v1": approach });
  });

  it("rejects a travel reroute that skips the authored final walk and instead targets the gate", () => {
    const { primary, journey } = setupApproach("travel");
    expect(applyRouteReplacement(replacement())).toBe(false);
    expect(useMapStore.getState().activeNavigationRoute).toBe(primary);
    expect(useMapStore.getState().venueJourney).toBe(journey);
    expect(useNavStore.getState().routeVersion).toBe(1);
    expect(useNavStore.getState().rerouteStatus).toBe("error");
  });

  it("rejects a missing walk start instead of falling back to the gate", () => {
    const { approach } = setupApproach("travel");
    approach.legs[0].polyline = [];
    expect(applyRouteReplacement(replacement())).toBe(false);
  });

  it("replaces only the active approach while preserving the primary candidate, selection and token", () => {
    const { primary, approach, journey } = setupApproach("approach");
    const before = useMapStore.getState();
    const next: AccessibleRoute = { ...approach, routeId: "approach-v2" };
    expect(
      applyRouteReplacement(
        replacement({
          navigationId: "approach-navigation",
          routeToken: "approach-token-v2",
          route: next,
        }),
      ),
    ).toBe(true);
    const state = useMapStore.getState();
    expect(state.venueJourney?.outdoor?.routes).toBe(journey.outdoor?.routes);
    expect(state.selectRoute).toBe(before.selectRoute);
    expect(state.selectRoute?.route).toBe(primary);
    expect(state.computeRoutes).toBe(before.computeRoutes);
    expect(state.venueJourney?.outdoor?.approachRoutes?.["token-v1"]).toBe(
      state.activeNavigationRoute,
    );
    expect(state.activeNavigationRoute).toMatchObject({
      navigationId: "approach-navigation",
      routeVersion: 2,
      routeToken: "approach-token-v2",
    });
    expect(journey.outdoor?.approachRoutes?.["token-v1"]).toBe(approach);
  });

  it.each(["wrong-endpoint", "wrong-navigation", "late-version"] as const)(
    "rejects an approach replacement with %s without changing either stage",
    (kind) => {
      const { approach, journey } = setupApproach("approach");
      const next = {
        ...approach,
        legs: approach.legs.map((leg) => ({ ...leg })),
      };
      if (kind === "wrong-endpoint")
        next.legs[0].polyline = [[121.56, 25.03], parking];
      expect(
        applyRouteReplacement(
          replacement({
            navigationId:
              kind === "wrong-navigation" ? "nav-1" : "approach-navigation",
            previousRouteVersion: kind === "late-version" ? 0 : 1,
            routeToken: "approach-token-v2",
            route: next,
          }),
        ),
      ).toBe(false);
      expect(useMapStore.getState().venueJourney).toBe(journey);
      expect(useMapStore.getState().activeNavigationRoute).toBe(approach);
      expect(useNavStore.getState().routeVersion).toBe(1);
    },
  );
});
