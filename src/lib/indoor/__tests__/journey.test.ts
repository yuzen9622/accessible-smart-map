import { createInstance } from "i18next";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locale/en/translation.json";
import zhTW from "@/i18n/locale/zh-TW/translation.json";
import {
  confirmVenueArrival,
  startNavigation,
  startVenueApproach,
  stopNavigation,
} from "@/lib/navigation/navigationLifecycle";
import { hasRouteSession, routeResumeTarget } from "@/lib/route/routeSession";
import useIndoorCatalog from "@/stores/useIndoorCatalog";
import useMapStore, { placeKey } from "@/stores/useMapStore";
import useNavStore from "@/stores/useNavStore";
import type { VenuePlaceDetail } from "@/types";
import type { AccessibleRoute, AiRoutePlan } from "@/types/route";
import { toVenuePlaceDetail } from "../catalog";
import {
  buildVenueJourney,
  type VenueJourney,
  venueJourneyConfirmLabel,
  venueJourneyPresentation,
  venueJourneyStepLabel,
} from "../journey";
import { samplePath } from "../route";
import type { IndoorRouteStep, LocalIndoorModel } from "../types";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

function model(): LocalIndoorModel {
  return {
    schemaVersion: 1,
    venueId: "test-campus",
    name: "Synthetic campus",
    origin: [0, 0],
    source: { sha256: "revision-1", generatedAt: "test", warnings: [] },
    building: {
      id: "building-a",
      name: "Building A",
      footprint: [],
      floorHeightM: 4,
      heightStatus: "estimated",
      geometryStatus: "schematic",
      levels: [
        { ordinal: 0, ref: "1F", elevationM: 0 },
        { ordinal: 1, ref: "2F", elevationM: 4 },
        { ordinal: 2, ref: "3F", elevationM: 8 },
      ],
    },
    nodes: [
      {
        id: "from",
        point: [0, 0, 0],
        ordinal: 0,
        levelRef: "1F",
        kind: "place",
      },
      {
        id: "lift-low",
        point: [3, 0, 0],
        ordinal: 0,
        levelRef: "1F",
        kind: "elevator",
      },
      {
        id: "lift-high",
        point: [3, 0, 8],
        ordinal: 2,
        levelRef: "3F",
        kind: "elevator",
      },
      { id: "to", point: [3, 4, 8], ordinal: 2, levelRef: "3F", kind: "place" },
      {
        id: "nonstop",
        point: [3, 0, 4],
        ordinal: 1,
        levelRef: "2F",
        kind: "place",
      },
    ],
    edges: [
      {
        id: "walk-in",
        from: "from",
        to: "lift-low",
        kind: "corridor",
        lengthM: 3,
        wheelchair: "yes",
        ramp: false,
        heightPending: false,
        geometryStatus: "schematic",
        heightStatus: "estimated",
        tags: { name: "Lower hall" },
        osmRef: "hall-low",
      },
      {
        id: "lift",
        from: "lift-low",
        to: "lift-high",
        kind: "elevator",
        lengthM: 8,
        levelSpan: 2,
        wheelchair: "yes",
        ramp: false,
        heightPending: false,
        geometryStatus: "schematic",
        heightStatus: "estimated",
        tags: { name: "Lift" },
        osmRef: "lift",
      },
      {
        id: "walk-out",
        from: "lift-high",
        to: "to",
        kind: "corridor",
        lengthM: 4,
        wheelchair: "yes",
        ramp: false,
        heightPending: false,
        geometryStatus: "schematic",
        heightStatus: "estimated",
        tags: { name: "Upper hall" },
        osmRef: "hall-high",
      },
    ],
    connections: [
      {
        id: "lift",
        name: "Lift",
        kind: "elevator",
        coordinates: [
          [3, 0, 0],
          [3, 0, 8],
        ],
        levelRefs: ["1F", "3F"],
        wheelchair: "yes",
        geometryStatus: "schematic",
        heightStatus: "estimated",
        heightPending: false,
        tags: {},
        osmRef: "lift",
      },
    ],
    features: [],
    walls: [],
    places: [
      {
        id: "from",
        name: "Room A",
        ref: "101",
        kind: "room",
        nodeId: "from",
        point: [0, 0, 0],
        levelRef: "1F",
        routeEndpoint: "corridor",
        doorKnown: false,
        arrivalOnly: true,
        tags: {},
      },
      {
        id: "to",
        name: "Room B",
        ref: "301",
        kind: "room",
        nodeId: "to",
        point: [3, 4, 8],
        levelRef: "3F",
        routeEndpoint: "corridor",
        doorKnown: false,
        arrivalOnly: true,
        tags: {},
      },
      {
        id: "nonstop",
        name: "Room C",
        ref: "201",
        kind: "room",
        nodeId: "nonstop",
        point: [3, 0, 4],
        levelRef: "2F",
        routeEndpoint: "corridor",
        doorKnown: false,
        arrivalOnly: true,
        tags: {},
      },
    ],
  };
}

function setup() {
  const data = model();
  const from = toVenuePlaceDetail(data, data.places[0]);
  const to = toVenuePlaceDetail(data, data.places[1]);
  const result = buildVenueJourney(data, from, to, "wheelchair", "stairs");
  if (!result.ok) throw new Error(result.message);
  return { data, from, to, journey: result.journey };
}
function outdoor(id = "outdoor-1"): AccessibleRoute {
  return {
    routeId: id,
    routeToken: `token-${id}`,
    navigationId: `nav-${id}`,
    routeVersion: 1,
    routeName: id,
    totalMinutes: 5,
    transferCount: 0,
    legs: [
      {
        type: "WALK",
        from: "Street",
        to: "Gate",
        distanceM: 10,
        minutesEst: 5,
        polyline: [
          [0, 0],
          [0.001, 0],
        ],
        a11yFacilities: [],
      },
    ],
    accessibilityHighlights: [],
  };
}
function startMixedWithApproaches(otherHasApproach = true) {
  const { data, journey } = setup();
  const primary = outdoor("primary-a");
  const other = outdoor("primary-b");
  const approach = outdoor("approach-a");
  const otherApproach = outdoor("approach-b");
  const mixed: VenueJourney = {
    ...journey,
    outdoor: {
      origin: {
        kind: "coordinate",
        address: "Original start",
        position: { lat: 1, lng: 2 },
      },
      arrival: journey.from,
      routes: [primary, other],
      selectedIndex: 0,
      phase: "travel",
      approachRoutes: {
        [primary.routeToken as string]: approach,
        ...(otherHasApproach
          ? { [other.routeToken as string]: otherApproach }
          : {}),
      },
    },
  };
  useIndoorCatalog.getState().setModels([data]);
  useMapStore.getState().setVenueJourney(mixed);
  startNavigation();
  return { primary, other, approach };
}
beforeEach(() => {
  stopNavigation();
  useMapStore.getState().setIndoorExploring(false);
  useMapStore.setState(useMapStore.getInitialState());
  useIndoorCatalog.setState(useIndoorCatalog.getInitialState());
});

describe("unified venue journey", () => {
  it("keeps the active walking approach owner when another candidate is previewed and after resuming", () => {
    const { primary, other, approach } = startMixedWithApproaches();
    useMapStore.getState().setRouteSelect({ index: 1, route: other });
    expect(useMapStore.getState().activeNavigationRoute).toBe(primary);
    useNavStore.getState().setArrived(true);
    startVenueApproach();
    expect(useMapStore.getState().activeNavigationRoute).toBe(approach);
    expect(useMapStore.getState().venueJourney?.outdoor).toMatchObject({
      selectedIndex: 1,
      navigationIndex: 0,
      phase: "approach",
    });
    stopNavigation();
    startNavigation();
    expect(useMapStore.getState().activeNavigationRoute).toBe(approach);
    expect(useMapStore.getState().selectRoute?.route).toBe(other);
    expect(useNavStore.getState().navigationId).toBe(approach.navigationId);
  });
  it("cannot skip the active approach by previewing a primary without one", () => {
    const { primary, other } = startMixedWithApproaches(false);
    useMapStore.getState().setRouteSelect({ index: 1, route: other });
    useNavStore.getState().setArrived(true);
    confirmVenueArrival();
    expect(useMapStore.getState().venueJourney?.guidance.status).toBe(
      "outdoor",
    );
    expect(useMapStore.getState().activeNavigationRoute).toBe(primary);
  });
  it.each(["token", "navigation", "version"] as const)(
    "does not start an approach after the active primary %s loses ownership",
    (field) => {
      const { primary } = startMixedWithApproaches();
      useNavStore.getState().setArrived(true);
      if (field === "token")
        useMapStore.setState({
          activeNavigationRoute: { ...primary, routeToken: "unrelated-token" },
        });
      else if (field === "navigation")
        useNavStore.setState({ navigationId: "unrelated-navigation" });
      else useNavStore.setState({ routeVersion: 99 });
      const before = useMapStore.getState().activeNavigationRoute;
      startVenueApproach();
      expect(useMapStore.getState().activeNavigationRoute).toBe(before);
      expect(useMapStore.getState().venueJourney?.outdoor?.phase).toBe(
        "travel",
      );
    },
  );
  it.each([
    ["1F", "3F", "上樓至 3F · Test stairs"],
    ["3F", "1F", "下樓至 1F · Test stairs"],
    ["B2", "B1", "上樓至 B1 · Test stairs"],
    ["Mezzanine", "Upper", "經 Test stairs 前往 Upper"],
  ])(
    "describes the actual stair direction from %s to %s",
    (fromLevel, toLevel, label) => {
      expect(
        venueJourneyStepLabel({
          kind: "steps",
          name: "Test stairs",
          fromLevel,
          toLevel,
          startIndex: 0,
          endIndex: 1,
          distanceM: 4,
          heightPending: false,
        }),
      ).toBe(label);
    },
  );
  it("names the actual elevator and arrival floor", () => {
    expect(
      venueJourneyStepLabel({
        kind: "elevator",
        name: "Lift 3",
        fromLevel: "1F",
        toLevel: "8F",
        startIndex: 0,
        endIndex: 1,
        distanceM: 28,
        heightPending: false,
      }),
    ).toBe("搭乘 Lift 3 至 8F");
  });
  it("keeps source endpoint and floor identity, with wheelchair overriding stairs preference", () => {
    const { data, from, to, journey } = setup();
    const before = JSON.stringify(data);
    expect(journey.from).toEqual(from);
    expect(journey.to).toEqual(to);
    expect(journey.route.points).toEqual(
      data.nodes.slice(0, 4).map((n) => n.point),
    );
    expect(journey.verticalPreference).toBe("elevator");
    expect(journey.route.steps[1]).toMatchObject({
      kind: "elevator",
      fromLevel: "1F",
      toLevel: "3F",
      connectionId: "lift",
    });
    expect(journey.to.arrivalKind).toBe("corridor");
    expect(
      buildVenueJourney(
        data,
        from,
        toVenuePlaceDetail(data, data.places[2]),
        "wheelchair",
      ),
    ).toMatchObject({ ok: false, reason: "NO_ACCESSIBLE_ROUTE" });
    expect(JSON.stringify(data)).toBe(before);
  });
  it.each([
    [{ venueId: "other" }, "UNSUPPORTED_CONTEXT"],
    [{ buildingId: "other" }, "UNSUPPORTED_CONTEXT"],
    [{ dataSource: "api" }, "UNSUPPORTED_CONTEXT"],
    [{ sourceVersion: "older" }, "STALE_SOURCE"],
    [{ levelRef: "2F" }, "UNKNOWN_PLACE"],
    [{ placeId: "missing" }, "UNKNOWN_PLACE"],
  ] as [Partial<VenuePlaceDetail>, string][])(
    "rejects incompatible endpoint %j without using its coordinates",
    (patch, reason) => {
      const { data, from, to } = setup();
      expect(
        buildVenueJourney(data, from, { ...to, ...patch }, "normal"),
      ).toMatchObject({ ok: false, reason });
    },
  );
  it("keeps favorite identity independent of version and distinguishes floors/buildings at the same coordinate", () => {
    const { to } = setup();
    expect(placeKey(to)).toBe(placeKey({ ...to, sourceVersion: "next" }));
    expect(placeKey(to)).not.toBe(
      placeKey({ ...to, buildingId: "building-b" }),
    );
    expect(placeKey(to)).not.toBe(placeKey({ ...to, levelRef: "4F" }));
  });
  it("owns one session across map exit, panel switches and resumption; ending clears it once", () => {
    const { journey } = setup();
    useMapStore.getState().setVenueJourney(journey);
    const generation = useMapStore.getState().routeGeneration;
    useMapStore.getState().setIndoorExploring(true);
    expect(useMapStore.getState().indoorPanelOpen).toBe(false);
    useMapStore.getState().setIndoorExploring(false);
    useMapStore.getState().setSheetMode("home");
    expect(useMapStore.getState().venueJourney).toBe(journey);
    expect(useMapStore.getState().routeGeneration).toBe(generation);
    expect(
      hasRouteSession({
        computeRoutes: null,
        selectRoute: null,
        destination: null,
        venueJourney: journey,
      }),
    ).toBe(true);
    expect(routeResumeTarget(null, journey)).toBe("route");
    useMapStore.getState().resumeRouteSession();
    expect(useMapStore.getState().sheetMode).toBe("route");
    useMapStore.getState().endRouteSession();
    expect(useMapStore.getState()).toMatchObject({
      venueJourney: null,
      origin: null,
      destination: null,
      computeRoutes: null,
      selectRoute: null,
    });
  });
  it("plays a tour without confirming physical arrival or changing its source route", () => {
    const { data, journey } = setup();
    useIndoorCatalog.getState().setModels([data]);
    useMapStore.getState().setVenueJourney(journey);
    useMapStore
      .getState()
      .setVenueJourneyPreview({ progress: 0.6, playing: true, direction: -1 });
    const source = JSON.stringify(journey.route);
    startNavigation();
    const started = useMapStore.getState().venueJourney as VenueJourney;
    expect(started.guidance).toEqual({ status: "touring", stepIndex: 0 });
    expect(started.preview).toMatchObject({
      progress: 0,
      playing: true,
      direction: 1,
      following: false,
    });
    useMapStore
      .getState()
      .setVenueJourneyPreview({ progress: 0.5, direction: -1, playing: false });
    const reversed = useMapStore.getState().venueJourney as VenueJourney;
    expect(venueJourneyPresentation(reversed)).toMatchObject({
      progress: 0.5,
      direction: -1,
    });
    expect(
      samplePath(
        reversed.route.points,
        venueJourneyPresentation(reversed).progress,
      ),
    ).toEqual([3, 0, 4.5]);
    useIndoorCatalog.getState().setActiveLevel(2);
    useMapStore.getState().advanceVenueGuidance();
    expect(useMapStore.getState().venueJourney?.guidance).toEqual({
      status: "touring",
      stepIndex: 0,
    });
    useMapStore
      .getState()
      .setVenueJourneyPreview({ progress: 1, direction: 1, playing: false });
    expect(useMapStore.getState().venueJourney?.guidance.status).toBe(
      "touring",
    );
    expect(useNavStore.getState().arrived).toBe(false);
    expect(JSON.stringify(useMapStore.getState().venueJourney?.route)).toBe(
      source,
    );
    stopNavigation();
    expect(useMapStore.getState()).toMatchObject({
      isNavigating: false,
      sheetMode: "route",
    });
    expect(useMapStore.getState().venueJourney?.guidance.status).toBe("idle");
    expect(useMapStore.getState().venueJourney?.preview.playing).toBe(false);
  });
  it("allows a schematic tour without declaring uncertain source geometry physically safe, and rejects stale data", () => {
    const { data, journey } = setup();
    useIndoorCatalog.getState().setModels([data]);
    journey.route.animationSafe = false;
    journey.route.steps[0].heightPending = true;
    useMapStore.getState().setVenueJourney(journey);
    useMapStore.getState().setVenueJourneyPreview({ playing: true });
    expect(useMapStore.getState().venueJourney?.preview.playing).toBe(false);
    startNavigation();
    expect(useMapStore.getState().isNavigating).toBe(true);
    expect(useMapStore.getState().venueJourney?.guidance.status).toBe(
      "touring",
    );
    expect(useMapStore.getState().venueJourney?.preview.playing).toBe(true);
    expect(useMapStore.getState().venueJourney?.route.animationSafe).toBe(
      false,
    );
    expect(
      useMapStore.getState().venueJourney?.route.steps[0].heightPending,
    ).toBe(true);
    useMapStore
      .getState()
      .setVenueJourney({ ...journey, sourceVersion: "stale" });
    startNavigation();
    expect(useMapStore.getState().venueJourney?.guidance.status).toBe("idle");
    expect(useMapStore.getState().activeNavigationRoute).toBeNull();
  });
  it("starts reduced-motion tours paused, permits a static seek, and pauses camera following on a 2D request", () => {
    const { data, journey } = setup();
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    try {
      useIndoorCatalog.getState().setModels([data]);
      useMapStore.getState().setVenueJourney(journey);
      startNavigation();
      expect(useMapStore.getState().venueJourney?.preview.playing).toBe(false);
      useMapStore.getState().setVenueJourneyPreview({ progress: 0.6 });
      expect(useMapStore.getState().venueJourney?.preview.progress).toBe(0.6);
      useMapStore.getState().setIs3D(false);
      expect(useMapStore.getState().venueJourney?.preview).toMatchObject({
        playing: false,
        following: false,
        progress: 0.6,
      });
      expect(useMapStore.getState().venueJourney?.guidance.status).toBe(
        "touring",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("does not activate a tour with incomplete source context", () => {
    const { data, journey } = setup();
    journey.route.context = { buildingIds: [], levelRefs: [] };
    useIndoorCatalog.getState().setModels([data]);
    useMapStore.getState().setVenueJourney(journey);
    startNavigation();
    expect(useMapStore.getState().isNavigating).toBe(false);
    expect(useMapStore.getState().venueJourney?.guidance.status).toBe("idle");
    expect(useNavStore.getState().arrived).toBe(false);
  });
  it("replaces the venue session when outdoor or AI planning publishes a different route", () => {
    const { journey } = setup();
    useMapStore.getState().setVenueJourney(journey);
    useMapStore.getState().setComputeRoutes([outdoor()]);
    expect(useMapStore.getState().venueJourney).toBeNull();
    useMapStore.getState().setVenueJourney(journey);
    const plan: AiRoutePlan = {
      routeContractVersion: 1,
      ok: true,
      planId: "ai",
      selectedRouteId: "outdoor-1",
      origin: { name: "Start", lat: 0, lng: 0 },
      destination: { name: "End", lat: 0, lng: 0.001 },
      routes: [outdoor()],
      effectivePreferences: {
        mode: "normal",
        travelMode: "walk",
        transitPreference: "none",
        maxTransfers: 0,
        avoidStairs: false,
        requireElevator: false,
      },
    };
    useMapStore.getState().applyAiRoutePlan(plan);
    expect(useMapStore.getState()).toMatchObject({
      venueJourney: null,
      planId: "ai",
      destinationName: "End",
    });
  });
  it("retains the actual outdoor origin and requires an explicit arrival confirmation before indoor guidance", () => {
    const { data, journey } = setup();
    useIndoorCatalog.getState().setModels([data]);
    const mixed: VenueJourney = {
      ...journey,
      outdoor: {
        origin: {
          kind: "coordinate",
          address: "Original start",
          position: { lat: 1, lng: 2 },
        },
        arrival: journey.from,
        routes: [outdoor(), outdoor("outdoor-2")],
        selectedIndex: 0,
      },
    };
    useMapStore.getState().setVenueJourney(mixed);
    expect(useMapStore.getState().origin).toBe(mixed.outdoor?.origin);
    expect(useMapStore.getState().destination).toBe(journey.to);
    useMapStore
      .getState()
      .setRouteSelect({ index: 1, route: mixed.outdoor?.routes[1] });
    expect(useMapStore.getState().venueJourney?.outdoor?.selectedIndex).toBe(1);
    startNavigation();
    expect(useMapStore.getState().venueJourney?.guidance.status).toBe(
      "outdoor",
    );
    expect(useMapStore.getState().activeNavigationRoute?.routeId).toBe(
      "outdoor-2",
    );
    useMapStore.getState().advanceVenueGuidance();
    expect(useMapStore.getState().venueJourney?.guidance.status).toBe(
      "outdoor",
    );
    confirmVenueArrival();
    expect(useMapStore.getState().venueJourney?.guidance).toEqual({
      status: "touring",
      stepIndex: 0,
    });
    expect(useMapStore.getState().activeNavigationRoute).toBeNull();
    expect(useMapStore.getState().origin).toBe(mixed.outdoor?.origin);
    expect(useMapStore.getState().isNavigating).toBe(true);
  });
});

const translations = createInstance();
beforeAll(async () => {
  await translations.init({
    resources: { en: { translation: en }, "zh-TW": { translation: zhTW } },
    lng: "zh-TW",
    fallbackLng: false,
    interpolation: { escapeValue: false },
  });
});

describe.each(["zh-TW", "en"] as const)(
  "venue instruction dictionary: %s",
  (language) => {
    const translate = () => translations.getFixedT(language);
    const step = (patch: Partial<IndoorRouteStep>): IndoorRouteStep => ({
      kind: "corridor",
      name: "公共通路",
      fromLevel: "1F",
      toLevel: "1F",
      startIndex: 0,
      endIndex: 1,
      distanceM: 4,
      heightPending: false,
      ...patch,
    });
    it.each([
      [
        "upstairs",
        { kind: "steps", name: "Test stairs", toLevel: "3F" },
        "上樓至 3F · Test stairs",
        "Go up to 3F · Test stairs",
      ],
      [
        "downstairs",
        { kind: "steps", name: "Test stairs", fromLevel: "3F" },
        "下樓至 1F · Test stairs",
        "Go down to 1F · Test stairs",
      ],
      [
        "basement",
        { kind: "steps", name: "Test stairs", fromLevel: "B2", toLevel: "B1" },
        "上樓至 B1 · Test stairs",
        "Go up to B1 · Test stairs",
      ],
      [
        "named elevator",
        { kind: "elevator", name: "電梯 A", toLevel: "8F" },
        "搭乘 電梯 A 至 8F",
        "Take 電梯 A to 8F",
      ],
      [
        "generic elevator",
        { kind: "elevator", name: "搭乘電梯", toLevel: null },
        "搭乘 電梯 至 目的樓層",
        "Take the elevator to the destination floor",
      ],
      [
        "named ramp",
        { kind: "ramp", name: "Test ramp" },
        "沿Test ramp通行",
        "Follow Test ramp",
      ],
      [
        "generic ramp",
        { kind: "ramp", name: "沿坡道行進" },
        "沿坡道通行",
        "Follow the ramp",
      ],
      ["generic passage", {}, "1F · 公共通路", "1F · Public passage"],
      [
        "generic corridor",
        { name: "沿公共走廊行進" },
        "1F · 公共走廊",
        "1F · Public corridor",
      ],
      [
        "source name",
        { name: "示例館 & A 區", fromLevel: null },
        "示例館 & A 區",
        "示例館 & A 區",
      ],
      [
        "unnumbered floor",
        {
          kind: "steps",
          name: "Test stairs",
          fromLevel: "Mezzanine",
          toLevel: null,
        },
        "經 Test stairs 前往 下一段",
        "Continue via Test stairs to the next section",
      ],
    ] satisfies [string, Partial<IndoorRouteStep>, string, string][])(
      "translates %s while preserving source names and levels",
      (_name, patch, chinese, english) => {
        const input = step(patch);
        const before = JSON.stringify(input);
        const label = venueJourneyStepLabel(input, translate());
        expect(label).toBe(language === "en" ? english : chinese);
        expect(label).not.toMatch(/venue(?:Step|Generic|Destination|Next)/);
        expect(label).not.toContain("{{");
        expect(JSON.stringify(input)).toBe(before);
      },
    );

    it("translates entrance, floor, section and destination confirmations without changing source identity", () => {
      const { journey } = setup();
      journey.to.buildingName = "示例館";
      journey.from.buildingId = null;
      journey.route.steps = [
        step({ kind: "ramp", fromLevel: null }),
        step({ kind: "elevator", fromLevel: "1F", toLevel: "3F" }),
        step({}),
      ];
      const expected =
        language === "en"
          ? [
              "Entered 示例館 · 1F",
              "Reached 3F",
              "Reached the corridor outside the room",
            ]
          : ["已進入 示例館 · 1F", "已到 3F", "已到教室前走道"];
      for (let i = 0; i < expected.length; i++) {
        journey.guidance.stepIndex = i;
        expect(venueJourneyConfirmLabel(journey, translate())).toBe(
          expected[i],
        );
      }
      journey.to.arrivalKind = "place";
      expect(venueJourneyConfirmLabel(journey, translate())).toBe(
        language === "en" ? "Reached the destination" : "已到目的地",
      );
      journey.route.steps[0] = step({ fromLevel: null, toLevel: null });
      journey.guidance.stepIndex = 0;
      expect(venueJourneyConfirmLabel(journey, translate())).toBe(
        language === "en" ? "Finished the entrance section" : "已走完入口路段",
      );
      journey.route.steps[1] = step({});
      journey.guidance.stepIndex = 1;
      expect(venueJourneyConfirmLabel(journey, translate())).toBe(
        language === "en" ? "Finished this section" : "已走完這段路線",
      );
    });
  },
);
