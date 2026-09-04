import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
  useMapStore.setState({ selectRoute: null, computeRoutes: null });
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
