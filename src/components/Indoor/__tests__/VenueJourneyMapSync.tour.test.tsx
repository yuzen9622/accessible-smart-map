import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type HookSlot = {
  current?: unknown;
  deps?: readonly unknown[];
  cleanup?: () => void;
};
const hooks = vi.hoisted(() => ({
  slots: [] as HookSlot[],
  cursor: 0,
  effects: [] as (() => void)[],
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useRef: (initial: unknown) => {
    const index = hooks.cursor++;
    hooks.slots[index] ??= { current: initial };
    return hooks.slots[index];
  },
  useEffect: (
    effect: () => undefined | (() => void),
    deps?: readonly unknown[],
  ) => {
    const index = hooks.cursor++;
    const previous = hooks.slots[index];
    const unchanged =
      deps &&
      previous?.deps &&
      deps.length === previous.deps.length &&
      deps.every((value, i) => Object.is(value, previous.deps?.[i]));
    if (unchanged) return;
    hooks.effects.push(() => {
      previous?.cleanup?.();
      hooks.slots[index] = { deps, cleanup: effect() };
    });
  },
}));
vi.mock("@/stores/useMapStore", async (original) => {
  const actual = await original<typeof import("@/stores/useMapStore")>();
  return {
    ...actual,
    default: Object.assign(
      (
        select: (state: ReturnType<typeof actual.default.getState>) => unknown,
      ) => select(actual.default.getState()),
      actual.default,
    ),
  };
});
vi.mock("@/stores/useIndoorCatalog", async (original) => {
  const actual = await original<typeof import("@/stores/useIndoorCatalog")>();
  return {
    ...actual,
    default: Object.assign(
      (
        select: (state: ReturnType<typeof actual.default.getState>) => unknown,
      ) => select(actual.default.getState()),
      actual.default,
    ),
  };
});

import type { VenueJourney } from "@/lib/indoor/journey";
import type { LocalIndoorModel } from "@/lib/indoor/types";
import useIndoorCatalog from "@/stores/useIndoorCatalog";
import useMapStore from "@/stores/useMapStore";
import useNavStore from "@/stores/useNavStore";
import type { VenuePlaceDetail } from "@/types";
import VenueJourneyMapSync from "../VenueJourneyMapSync";

const source: LocalIndoorModel = {
  schemaVersion: 1,
  venueId: "synthetic",
  name: "Synthetic campus",
  source: { sha256: "synthetic-sha", generatedAt: "test", warnings: [] },
  api: { version: 2, importedAt: "test", sourceSha256: "synthetic-sha" },
  origin: [0, 0],
  building: {
    id: "a",
    name: "Building A",
    footprint: [
      [
        [0, 0],
        [30, 0],
        [30, 10],
        [0, 10],
        [0, 0],
      ],
    ],
    levels: [{ ordinal: 0, ref: "1F", elevationM: 0 }],
    floorHeightM: 4,
    heightStatus: "estimated",
    geometryStatus: "schematic",
  },
  features: [],
  connections: [],
  places: [],
  nodes: [],
  edges: [],
  walls: [],
};
function journey(): VenueJourney {
  const from: VenuePlaceDetail = {
    kind: "venue-place",
    venueId: "synthetic",
    buildingId: "a",
    buildingName: "Building A",
    levelRef: "1F",
    placeId: "from",
    sourceVersion: "synthetic:2",
    dataSource: "api",
    arrivalKind: "corridor",
    name: "From",
    address: "Synthetic",
    position: { lat: 0, lng: 0 },
  };
  return {
    id: "synthetic-tour",
    venueId: "synthetic",
    buildingId: "a",
    sourceVersion: "synthetic:2",
    from,
    to: { ...from, placeId: "to", name: "To" },
    mode: "normal",
    verticalPreference: "auto",
    preview: { progress: 0, playing: false, direction: 1, following: true },
    guidance: { status: "touring", stepIndex: 0 },
    route: {
      ok: true,
      fromPlaceId: "from",
      toPlaceId: "to",
      points: [
        [0, 0, 0],
        [10, 0, 0],
        [10, 10, 0],
      ],
      context: { buildingIds: ["a", "a", "a"], levelRefs: ["1F", "1F", "1F"] },
      kinds: ["corridor", "corridor"],
      steps: [
        {
          kind: "corridor",
          name: "Source walkway",
          fromLevel: "1F",
          toLevel: "1F",
          startIndex: 0,
          endIndex: 2,
          distanceM: 20,
          heightPending: true,
        },
      ],
      distanceM: 20,
      animationSafe: false,
      warnings: [],
      edgeIds: [],
    },
  };
}
function mapFixture() {
  return {
    easeTo: vi.fn(),
    fitBounds: vi.fn(),
    flyTo: vi.fn(),
    jumpTo: vi.fn(),
    stop: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    setMaxZoom: vi.fn(),
    setMaxPitch: vi.fn(),
    setCenterElevation: vi.fn(),
    setLayoutProperty: vi.fn(),
  };
}
function render() {
  hooks.cursor = 0;
  hooks.effects = [];
  VenueJourneyMapSync();
  for (const effect of hooks.effects) effect();
}
function preview(patch: Partial<VenueJourney["preview"]>) {
  useMapStore.getState().setVenueJourneyPreview(patch);
  render();
}
beforeEach(() => {
  hooks.slots = [];
  hooks.cursor = 0;
  hooks.effects = [];
  vi.stubGlobal("document", { hidden: false });
  vi.stubGlobal("window", {
    innerWidth: 1200,
    innerHeight: 800,
    matchMedia: () => ({ matches: false }),
  });
  useIndoorCatalog.setState({
    models: [source],
    activeBuildingKey: null,
    activeLevel: 0,
    selectedFeatureId: null,
    focusVersion: 0,
  });
  useMapStore.setState({
    map: null,
    venueJourney: journey(),
    indoorExploring: false,
    isNavigating: true,
  });
  useNavStore.getState().reset();
});
afterEach(() => {
  for (const slot of hooks.slots) slot.cleanup?.();
  hooks.slots = [];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function mount() {
  const map = mapFixture();
  useMapStore.setState({
    map: map as unknown as NonNullable<
      ReturnType<typeof useMapStore.getState>["map"]
    >,
  });
  render();
  return map;
}
function expectFreeCamera(map: ReturnType<typeof mapFixture>) {
  for (const operation of Object.values(map))
    expect(operation).not.toHaveBeenCalled();
}

describe("route animation without camera following", () => {
  it("opens the starting building/floor once and leaves camera configuration and gestures alone", () => {
    const value = journey();
    value.preview.progress = 0.75;
    value.route.context = {
      buildingIds: ["a", "a", "a"],
      levelRefs: ["2F", "2F", "2F"],
    };
    value.route.steps = [
      { ...value.route.steps[0], fromLevel: "2F", toLevel: "2F" },
    ];
    useMapStore.setState({ venueJourney: value });
    useIndoorCatalog.setState({
      models: [
        {
          ...source,
          building: {
            ...source.building,
            levels: [
              ...source.building.levels,
              { ordinal: 1, ref: "2F", elevationM: 4 },
            ],
          },
        },
      ],
    });
    const map = mount();
    expect(useMapStore.getState().indoorExploring).toBe(true);
    expect(useIndoorCatalog.getState().activeBuildingKey).toBe("synthetic/a");
    expect(useIndoorCatalog.getState().activeLevel).toBe(1);
    const focus = useIndoorCatalog.getState().focusVersion;
    preview({ playing: true });
    preview({ playing: false });
    render();
    expect(useIndoorCatalog.getState().focusVersion).toBe(focus);
    expectFreeCamera(map);
  });

  it("does not move the camera, switch a selected floor, or modify location/arrival when playback changes", () => {
    const map = mount();
    const original = useMapStore.getState();
    const route = original.venueJourney?.route;
    const nav = JSON.stringify(useNavStore.getState());
    useIndoorCatalog.getState().setActiveLevel(7);
    for (const progress of [0, 0.1, 0.5, 1, 0.25])
      preview({ progress, playing: true });
    preview({ playing: false, following: true });
    expect(useIndoorCatalog.getState().activeLevel).toBe(7);
    const after = useMapStore.getState();
    expect(after.venueJourney?.guidance).toEqual({
      status: "touring",
      stepIndex: 0,
    });
    expect(after.venueJourney?.route).toBe(route);
    expect(after.userLocation).toBe(original.userLocation);
    expect(after.userLocationFix).toBe(original.userLocationFix);
    expect(after.routeGeneration).toBe(original.routeGeneration);
    expect(JSON.stringify(useNavStore.getState())).toBe(nav);
    expectFreeCamera(map);
  });

  it("does not reopen the cutaway after zooming out or closing it", () => {
    const map = mount();
    useMapStore.getState().setIndoorExploring(false);
    preview({ playing: true });
    preview({ playing: false });
    useIndoorCatalog.setState({
      models: [...useIndoorCatalog.getState().models],
    });
    render();
    expect(useMapStore.getState().indoorExploring).toBe(false);
    expectFreeCamera(map);
  });

  it("can reopen once for an explicitly restarted or a different journey", () => {
    const map = mount();
    const focus = useIndoorCatalog.getState().focusVersion;
    useMapStore.getState().stopVenueGuidance();
    render();
    useMapStore.setState({ venueJourney: journey(), indoorExploring: false });
    render();
    expect(useIndoorCatalog.getState().focusVersion).toBe(focus + 1);
    useMapStore.setState({
      venueJourney: { ...journey(), id: "another-route" },
    });
    render();
    expect(useIndoorCatalog.getState().focusVersion).toBe(focus + 2);
    expectFreeCamera(map);
  });

  it("waits for the matching published model before opening the route", () => {
    useIndoorCatalog.setState({ models: [] });
    const map = mount();
    expect(useMapStore.getState().indoorExploring).toBe(false);
    useIndoorCatalog.setState({ models: [source] });
    render();
    expect(useMapStore.getState().indoorExploring).toBe(true);
    expectFreeCamera(map);
  });

  it("does not reset the camera or limits on stop/unmount", () => {
    const map = mount();
    useMapStore.getState().stopVenueGuidance();
    render();
    for (const slot of hooks.slots) slot.cleanup?.();
    expectFreeCamera(map);
  });

  it("manual 2D/3D controls keep the route arrows playing", () => {
    const map = mount();
    preview({ playing: true });
    useMapStore.getState().setIs3D(false);
    expect(map.easeTo).toHaveBeenLastCalledWith({
      pitch: 0,
      bearing: 0,
      duration: 600,
    });
    expect(useMapStore.getState().venueJourney?.preview.playing).toBe(true);
    useMapStore.getState().setIs3D(true);
    expect(map.easeTo).toHaveBeenLastCalledWith({ pitch: 60, duration: 600 });
    expect(useMapStore.getState().venueJourney?.preview.playing).toBe(true);
  });

  it("does not take over an active outdoor navigation session", () => {
    const value = journey();
    value.guidance.status = "outdoor";
    useMapStore.setState({ venueJourney: value, indoorExploring: false });
    const nav = JSON.stringify(useNavStore.getState());
    const map = mount();
    expectFreeCamera(map);
    expect(useMapStore.getState().venueJourney).toBe(value);
    expect(useMapStore.getState().indoorExploring).toBe(false);
    expect(JSON.stringify(useNavStore.getState())).toBe(nav);
  });
});
