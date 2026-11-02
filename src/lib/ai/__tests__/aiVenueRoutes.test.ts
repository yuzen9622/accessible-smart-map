import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ loadVenue: vi.fn() }));
vi.mock("@/lib/indoor/venueApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/indoor/venueApi")>()),
  loadVenue: h.loadVenue,
}));

import {
  aiVenueDetail,
  arrivalLeg,
  departureLeg,
  handover,
} from "@/lib/indoor/__tests__/fixtures/aiVenue";
import { startNavigation } from "@/lib/navigation/navigationLifecycle";
import useIndoorCatalog from "@/stores/useIndoorCatalog";
import useMapStore from "@/stores/useMapStore";
import useNavStore from "@/stores/useNavStore";
import { executeAction } from "../actionExecutor";
import { AI_ROUTE_UNAVAILABLE, parseAiRoutePlan } from "../routeContract";
import { mapToolToActions } from "../toolActionMapper";

const walkRoute = (routeId: string) => ({
  routeId,
  routeName: routeId,
  routeToken: `token-${routeId}`,
  navigationId: `nav-${routeId}`,
  routeVersion: 1,
  totalMinutes: 12,
  transferCount: 0,
  accessibilityHighlights: [],
  legs: [
    {
      type: "WALK",
      from: "台中車站",
      to: "北門",
      distanceM: 800,
      polyline: [
        [9.99, 10],
        [9.9999, 10],
      ],
    },
  ],
});

function plan(venue: Record<string, unknown> = {}) {
  return {
    routeContractVersion: 1,
    ok: true,
    planId: "plan-venue",
    selectedRouteId: "b",
    routes: [walkRoute("a"), walkRoute("b")],
    origin: { name: "台中車站", lat: 10, lng: 9.99 },
    destination: { name: "北門", lat: 10, lng: 9.9999 },
    effectivePreferences: {
      mode: "wheelchair",
      travelMode: "walk",
      transitPreference: "none",
      maxTransfers: 0,
      avoidStairs: true,
      requireElevator: true,
    },
    ...venue,
  };
}

const arrivalPlan = () => {
  const leg = arrivalLeg();
  return plan({ venueArrival: handover(leg, "room-2301"), venueLeg: leg });
};
const departurePlan = () => {
  const leg = departureLeg();
  return plan({
    venueDeparture: handover(leg, "room-2301"),
    venueDepartureLeg: leg,
  });
};
const indoorResult = () => ({
  ok: true,
  venueId: "synthetic-campus",
  mode: "wheelchair",
  venueLeg: arrivalLeg(),
  selectedRouteId: "indoor:gate>room-2301",
  routes: [
    {
      routeId: "indoor:gate>room-2301",
      routeName: "室內路線",
      totalMinutes: 1,
      transferCount: 0,
      legs: [],
      accessibilityHighlights: [],
      routeToken: "token-indoor",
      navigationId: "nav-indoor",
      routeVersion: 1,
    },
  ],
});

function run(toolName: string, result: unknown) {
  for (const action of mapToolToActions(toolName, result, {}, "zh-TW"))
    expect(executeAction(action).ok).toBe(true);
}
const attached = () =>
  vi.waitFor(() => expect(useMapStore.getState().venueJourney).not.toBeNull());

beforeEach(() => {
  h.loadVenue.mockReset();
  h.loadVenue.mockResolvedValue(aiVenueDetail());
  useMapStore.getState().endRouteSession();
  useMapStore.setState({ activeNavigationRoute: null, isNavigating: false });
  useNavStore.getState().reset();
  useIndoorCatalog.setState({ models: [] });
});

describe("AI route contract venue fields", () => {
  it("normalizes an arrival and a departure leg", () => {
    expect(parseAiRoutePlan(arrivalPlan()).venue).toMatchObject({
      direction: "arrival",
      handover: { gateId: "gate", placeId: "room-2301" },
      route: { fromPlaceId: "gate", toPlaceId: "room-2301" },
    });
    expect(parseAiRoutePlan(departurePlan()).venue).toMatchObject({
      direction: "departure",
      route: { fromPlaceId: "room-2301", toPlaceId: "gate" },
    });
  });

  it("keeps plans without venue fields unchanged", () => {
    expect(parseAiRoutePlan(plan()).venue).toBeUndefined();
  });

  it.each([
    ["a leg without its hand-over", { venueLeg: arrivalLeg() }],
    [
      "a leg that does not start at the hand-over gate",
      {
        venueArrival: { ...handover(arrivalLeg(), "room-2301"), gateId: "x" },
        venueLeg: arrivalLeg(),
      },
    ],
    [
      "both an arrival and a departure",
      {
        venueArrival: handover(arrivalLeg(), "room-2301"),
        venueLeg: arrivalLeg(),
        venueDeparture: handover(departureLeg(), "room-2301"),
        venueDepartureLeg: departureLeg(),
      },
    ],
  ])("rejects %s", (_, venue) => {
    expect(() => parseAiRoutePlan(plan(venue))).toThrow(AI_ROUTE_UNAVAILABLE);
  });
});

describe("planAccessibleRoute with a venue leg", () => {
  it("shows the outdoor routes and attaches the indoor arrival journey", async () => {
    run("planAccessibleRoute", arrivalPlan());
    const routes = useMapStore.getState().computeRoutes;
    expect(routes?.map((route) => route.routeId)).toEqual(["a", "b"]);
    expect(useMapStore.getState().selectRoute?.route.routeId).toBe("b");
    await attached();
    const state = useMapStore.getState();
    expect(h.loadVenue).toHaveBeenCalledWith(
      expect.any(String),
      "synthetic-campus",
    );
    expect(state.computeRoutes).toBe(routes);
    expect(state.venueJourney?.outdoor?.routes).toBe(routes);
    expect(state.venueJourney?.outdoor).toMatchObject({
      selectedIndex: 1,
      phase: "travel",
      arrival: { placeId: "gate" },
    });
    expect(state.venueJourney?.to.placeId).toBe("room-2301");
    expect(state.destinationName).toBe("2301");
    expect(state.planId).toBe("plan-venue");
    expect(useIndoorCatalog.getState().models).toHaveLength(1);
  });

  it("keeps a departure leg across route selection and navigates outdoors", async () => {
    run("planAccessibleRoute", departurePlan());
    await attached();
    const state = useMapStore.getState();
    expect(state.venueJourney).toMatchObject({
      departure: true,
      from: { placeId: "room-2301" },
    });
    expect(state.venueJourney?.outdoor).toBeUndefined();
    expect(state.originName).toBe("2301");
    state.setRouteSelect({ index: 0, route: state.computeRoutes?.[0] });
    expect(useMapStore.getState().venueJourney?.departure).toBe(true);
    startNavigation();
    expect(useMapStore.getState()).toMatchObject({
      isNavigating: true,
      activeNavigationRoute: { routeToken: "token-a" },
      venueJourney: { guidance: { status: "idle" } },
    });
  });

  it("starts the selected outdoor route of an arrival journey like a manual plan", async () => {
    run("planAccessibleRoute", arrivalPlan());
    await attached();
    startNavigation();
    const state = useMapStore.getState();
    expect(state.isNavigating).toBe(true);
    expect(state.activeNavigationRoute?.routeToken).toBe("token-b");
    expect(state.venueJourney?.guidance.status).toBe("outdoor");
    expect(state.venueJourney?.outdoor?.navigationIndex).toBe(1);
    expect(useNavStore.getState().navigationId).toBe("nav-b");
  });

  it("does not attach a venue leg after a newer plan replaced its routes", async () => {
    let resolve: (value: unknown) => void = () => {};
    h.loadVenue.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    run("planAccessibleRoute", arrivalPlan());
    run("planAccessibleRoute", plan());
    resolve(aiVenueDetail());
    await new Promise((r) => setTimeout(r, 0));
    expect(useMapStore.getState().venueJourney).toBeNull();
    expect(h.loadVenue).toHaveBeenCalledOnce();
  });

  it("keeps the outdoor routes when the venue cannot be validated", async () => {
    h.loadVenue.mockResolvedValueOnce(aiVenueDetail(5));
    run("planAccessibleRoute", arrivalPlan());
    await new Promise((r) => setTimeout(r, 0));
    expect(useMapStore.getState().venueJourney).toBeNull();
    expect(useMapStore.getState().computeRoutes).toHaveLength(2);
  });

  it("leaves old results without venue fields as before", () => {
    run("planAccessibleRoute", plan());
    expect(h.loadVenue).not.toHaveBeenCalled();
    expect(useMapStore.getState().venueJourney).toBeNull();
    expect(useMapStore.getState().computeRoutes).toHaveLength(2);
  });
});

describe("planIndoorRoute", () => {
  it("registers the indoor route token and shows the indoor journey", async () => {
    run("planIndoorRoute", indoorResult());
    const before = useMapStore.getState();
    expect(before.selectRoute?.route.routeToken).toBe("token-indoor");
    expect(before.computeRoutes).toHaveLength(1);
    expect(before.sheetMode).toBe("route");
    await attached();
    const state = useMapStore.getState();
    expect(state.computeRoutes).toBe(before.computeRoutes);
    expect(state.venueJourney).toMatchObject({
      from: { placeId: "gate" },
      to: { placeId: "room-2301" },
      guidance: { status: "idle" },
    });
    expect(state.venueJourney?.outdoor).toBeUndefined();
    expect(state.venueJourney?.departure).toBeUndefined();
    expect(state.destinationName).toBe("2301");
  });

  it("starts the same indoor tour as a hand-planned indoor route", async () => {
    run("planIndoorRoute", indoorResult());
    await attached();
    startNavigation();
    const state = useMapStore.getState();
    expect(state.isNavigating).toBe(true);
    expect(state.sheetMode).toBe("navigation");
    expect(state.activeNavigationRoute).toBeNull();
    expect(state.venueJourney?.guidance).toEqual({
      status: "touring",
      stepIndex: 0,
    });
    expect(useNavStore.getState().navigationId).toBeNull();
  });

  it("lets the assistant explain a failed indoor plan", () => {
    expect(
      mapToolToActions("planIndoorRoute", {
        ok: false,
        reason: "NO_ACCESSIBLE_ROUTE",
        error: "找不到無障礙室內路線",
      }),
    ).toEqual([]);
  });

  it("rejects an indoor result that carries outdoor legs", () => {
    const result = indoorResult();
    result.routes[0].legs = [walkRoute("x").legs[0]] as never[];
    expect(() => mapToolToActions("planIndoorRoute", result)).toThrow(
      AI_ROUTE_UNAVAILABLE,
    );
  });
});
