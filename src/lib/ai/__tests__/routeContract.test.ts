import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyRouteReplacement } from "@/lib/navigation/rerouteCoordinator";
import useChatStore from "@/stores/useChatStore";
import useMapStore from "@/stores/useMapStore";
import useNavStore from "@/stores/useNavStore";
import { executeAction } from "../actionExecutor";
import { parseAiRoutePlan } from "../routeContract";
import {
  getRouteConversationInput,
  getVoiceHistory,
} from "../routeConversation";
import { mapToolToActions } from "../toolActionMapper";

function planFixture() {
  const route = (routeId: string) => ({
    routeId,
    routeName: routeId,
    routeToken: `private-${routeId}`,
    navigationId: `nav-${routeId}`,
    routeVersion: 1,
    totalMinutes: 15,
    transferCount: 0,
    accessibilityHighlights: [],
    warnings: ["此路段含樓梯"],
    degraded: true,
    legs: [
      {
        type: "BUS",
        routeName: "99",
        departureStop: "起站",
        arrivalStop: "終站",
        polyline: [
          [121.5, 25],
          [121.51, 25.01],
        ],
        waitInfo: { source: "unavailable", time: null },
        estimatedWaitMinutes: 0,
        direction: 0,
        departureStopA11y: [],
        arrivalStopA11y: [],
      },
    ],
  });
  return {
    routeContractVersion: 1,
    ok: true,
    planId: "plan-one",
    selectedRouteId: "b",
    routes: [route("a"), route("b")],
    origin: { name: "起點", lat: 25, lng: 121.5 },
    destination: { name: "終點", lat: 25.01, lng: 121.51 },
    effectivePreferences: {
      mode: "wheelchair",
      travelMode: "transit",
      transitPreference: "bus",
      maxTransfers: 2,
      avoidStairs: true,
      requireElevator: true,
      departureTime: "2026-10-10T09:00:00+08:00",
      maxSlopePercent: 6,
    },
    alerts: [{ title: "異常" }],
    arrivalEntrance: { name: "無障礙入口" },
  };
}

beforeEach(() => {
  useMapStore.getState().endRouteSession();
  useMapStore.setState({ activeNavigationRoute: null });
  useNavStore.getState().reset();
  useChatStore.getState().clearAll();
});

describe("AI route contract", () => {
  it("retains source/display sidecars and request provenance without changing WALK9 or token", () => {
    const fixture = planFixture();
    const step = {
      relativeDirection: "CONTINUE",
      absoluteDirection: null,
      streetName: "原路",
      bogusName: false,
      area: false,
      stairs: false,
      steepSlope: false,
      distanceM: 20,
      location: [121.5, 25],
    };
    const sidecar = [
      {
        index: 0,
        streetName: "原路",
        nameEn: "Original Road",
        displayName: "Original Road",
      },
    ];
    const plan = {
      ...fixture,
      routes: fixture.routes.map((route) => ({
        ...route,
        legs: [
          {
            type: "WALK",
            from: "起",
            to: "迄",
            fromNameEn: "Start",
            fromDisplayName: "Start",
            distanceM: 20,
            minutesEst: 1,
            polyline: [
              [121.5, 25],
              [121.51, 25.01],
            ],
            a11yFacilities: [],
            steps: [step],
            stepStreetNames: sidecar,
          },
        ],
      })),
    };
    const action = mapToolToActions(
      "planAccessibleRoute",
      plan,
      undefined,
      "en",
    )[0];
    if (action.type !== "show-route") throw new Error("Expected route action");
    const leg = action.plan.routes[0].legs[0];
    expect(leg).toMatchObject({
      from: "起",
      fromNameEn: "Start",
      fromDisplayName: "Start",
      displayLanguage: "en",
      stepStreetNames: sidecar,
      steps: [step],
    });
    expect(action.plan.routes[0].routeToken).toBe("private-a");
    expect(Object.keys(step)).toHaveLength(9);
    expect(plan.routes[0].legs[0]).not.toHaveProperty("displayLanguage");
  });

  it("applies the selected identity, all candidates and canonical conditions in one notification, without any fetch", () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const notify = vi.fn();
    const unsubscribe = useMapStore.subscribe(notify);
    const actions = mapToolToActions("planAccessibleRoute", planFixture());
    expect(actions).toHaveLength(1);
    expect(executeAction(actions[0]).ok).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
    const state = useMapStore.getState();
    expect(state.selectedRouteId).toBe("b");
    expect(state.selectRoute?.index).toBe(1);
    expect(state.effectivePreferences).toEqual(
      planFixture().effectivePreferences,
    );
    expect(state.aiRouteMetadata?.arrivalEntrance).toEqual({
      name: "無障礙入口",
    });
    expect(state.selectRoute?.route.warnings).toEqual(["此路段含樓梯"]);
    expect(getRouteConversationInput().routeContext).toEqual({
      routeToken: "private-b",
    });
    expect(fetch).not.toHaveBeenCalled();
    unsubscribe();
    fetch.mockRestore();
  });
  it.each([
    (p: ReturnType<typeof planFixture>) => {
      Reflect.deleteProperty(p, "routeContractVersion");
    },
    (p: ReturnType<typeof planFixture>) => {
      p.ok = false;
    },
    (p: ReturnType<typeof planFixture>) => {
      p.routes = [];
    },
    (p: ReturnType<typeof planFixture>) => {
      p.routes[1].routeId = "a";
    },
    (p: ReturnType<typeof planFixture>) => {
      p.selectedRouteId = "missing";
    },
    (p: ReturnType<typeof planFixture>) => {
      Reflect.deleteProperty(p, "origin");
    },
    (p: ReturnType<typeof planFixture>) => {
      p.origin.lat = NaN;
    },
    (p: ReturnType<typeof planFixture>) => {
      p.routes[1].legs[0].polyline = [[999, 25]];
    },
    (p: ReturnType<typeof planFixture>) => {
      p.routes[1].legs[0].type = "PLANE";
    },
    (p: ReturnType<typeof planFixture>) => {
      p.effectivePreferences.departureTime = "09:00";
    },
  ])(
    "rejects incomplete contracts without changing the current selection",
    (mutate) => {
      useMapStore.getState().applyAiRoutePlan(parseAiRoutePlan(planFixture()));
      const previous = useMapStore.getState();
      const value = planFixture();
      mutate(value);
      expect(() => mapToolToActions("planAccessibleRoute", value)).toThrow(
        "無法",
      );
      expect(useMapStore.getState()).toBe(previous);
    },
  );
  it("keeps transit stops when geometry or token is unavailable", () => {
    const value = planFixture();
    Reflect.deleteProperty(value.routes[1], "routeToken");
    Reflect.deleteProperty(value.routes[1].legs[0], "polyline");
    const parsed = parseAiRoutePlan(value);
    useMapStore.getState().applyAiRoutePlan(parsed);
    expect(parsed.routes[1].legs[0].polyline).toEqual([]);
    expect(parsed.routes[1].legs[0]).toMatchObject({
      type: "BUS",
      departureStop: "起站",
    });
    expect(getRouteConversationInput().routeContext).toBeNull();
  });
  it("preserves selection on reorder and clears context explicitly", () => {
    useMapStore.getState().applyAiRoutePlan(parseAiRoutePlan(planFixture()));
    useMapStore
      .getState()
      .setComputeRoutes(
        [...(useMapStore.getState().computeRoutes ?? [])].reverse(),
      );
    expect(useMapStore.getState().selectRoute?.index).toBe(0);
    expect(useMapStore.getState().planId).toBe("plan-one");
    useMapStore.getState().endRouteSession();
    expect(getRouteConversationInput().routeContext).toBeNull();
  });
  it("reroutes active navigation without changing another viewed candidate", () => {
    const plan = parseAiRoutePlan(planFixture());
    useMapStore.getState().applyAiRoutePlan(plan);
    useMapStore.setState({
      activeNavigationRoute: plan.routes[0],
      isNavigating: true,
    });
    useNavStore.setState({ navigationId: "nav-a", routeVersion: 1 });
    const replacement = {
      navigationId: "nav-a",
      previousRouteVersion: 1,
      routeVersion: 2,
      routeToken: "new-token",
      route: plan.routes[0],
      instructions: [],
      warnings: [],
      currentStepIndex: 0 as const,
    };
    expect(applyRouteReplacement(replacement)).toBe(true);
    expect(useMapStore.getState().activeNavigationRoute?.routeToken).toBe(
      "new-token",
    );
    expect(useMapStore.getState().selectedRouteId).toBe("b");
    expect(getRouteConversationInput().routeContext).toEqual({
      routeToken: "private-b",
    });
    expect(applyRouteReplacement(replacement)).toBe(false);
    expect(
      applyRouteReplacement({
        ...replacement,
        navigationId: "other-nav",
        previousRouteVersion: 2,
        routeVersion: 3,
      }),
    ).toBe(false);
  });
  it("shares bounded summaries with voice without route geometry or token", () => {
    useChatStore.getState().setChatHistory([
      {
        role: "assistant",
        content: "搭公車",
        tool_summaries: [
          { name: "planAccessibleRoute", summary: '{"selectedRouteId":"b"}' },
        ],
      },
    ]);
    expect(getVoiceHistory()).toEqual([
      {
        role: "assistant",
        text: "搭公車",
        tools: [
          { name: "planAccessibleRoute", summary: '{"selectedRouteId":"b"}' },
        ],
      },
    ]);
  });
});
