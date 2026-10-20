import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Select, SelectTrigger } from "@/components/ui/select";

const hooks = vi.hoisted(() => ({
  refs: [] as { current: unknown }[],
  cursor: 0,
  effects: [] as (() => unknown)[],
  sources: [] as GeoJSON.FeatureCollection<GeoJSON.LineString>[],
}));
vi.mock("react-map-gl/maplibre", () => ({
  Source: ({
    data,
    children,
  }: {
    data: GeoJSON.FeatureCollection<GeoJSON.LineString>;
    children?: ReactNode;
  }) => {
    hooks.sources.push(data);
    return children;
  },
  Layer: () => null,
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: (effect: () => unknown) => hooks.effects.push(effect),
  useMemo: (factory: () => unknown) => factory(),
  useCallback: (callback: unknown) => callback,
  useRef: (initial: unknown) => {
    const index = hooks.cursor++;
    hooks.refs[index] ??= { current: initial };
    return hooks.refs[index];
  },
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    hooks.refs[index] ??= { current: initial };
    return [
      hooks.refs[index].current,
      (next: unknown) => {
        hooks.refs[index].current =
          typeof next === "function" ? next(hooks.refs[index].current) : next;
      },
    ];
  },
}));
vi.mock("@/i18n/client", () => ({
  useAppTranslation: () => ({
    t: (key: string, values?: { floor?: string }) =>
      values?.floor ? `${key}:${values.floor}` : key,
  }),
}));
vi.mock("../IndoorMapScene", () => ({ default: () => null }));
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
vi.mock("@/stores/useNavStore", async (original) => {
  const actual = await original<typeof import("@/stores/useNavStore")>();
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
import type { IndoorSceneProps } from "@/lib/indoor/sceneTypes";
import type { LocalIndoorModel } from "@/lib/indoor/types";
import useIndoorCatalog from "@/stores/useIndoorCatalog";
import useMapStore from "@/stores/useMapStore";
import type { VenuePlaceDetail } from "@/types";
import IndoorMapScene from "../IndoorMapScene";
import IndoorProductView from "../IndoorProductView";
import VenueCampusRoute, { campusRouteSegments } from "../VenueCampusRoute";
import VenueJourneyMapSync from "../VenueJourneyMapSync";

function model(id: string): LocalIndoorModel {
  return {
    schemaVersion: 1,
    venueId: "synthetic-campus",
    name: "Synthetic campus",
    source: { sha256: "source-sha", generatedAt: "test", warnings: [] },
    api: { version: 4, importedAt: "test", sourceSha256: "source-sha" },
    origin: [0, 0],
    building: {
      id,
      name: `Building ${id}`,
      footprint: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
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
}
function journey(): VenueJourney {
  const from: VenuePlaceDetail = {
    kind: "venue-place",
    venueId: "synthetic-campus",
    buildingId: "a",
    buildingName: "Building a",
    levelRef: "1F",
    placeId: "from",
    sourceVersion: "synthetic-campus:4",
    dataSource: "api",
    arrivalKind: "corridor",
    name: "Room",
    address: "Building a 1F",
    position: { lat: 0, lng: 0 },
  };
  return {
    id: "same-floor-cross-building",
    venueId: from.venueId,
    buildingId: "b",
    sourceVersion: from.sourceVersion,
    from,
    to: { ...from, buildingId: "b", buildingName: "Building b", placeId: "to" },
    mode: "normal",
    verticalPreference: "auto",
    preview: { progress: 0, playing: false, direction: 1 },
    guidance: { status: "guiding", stepIndex: 0 },
    route: {
      ok: true,
      fromPlaceId: "from",
      toPlaceId: "to",
      points: [
        [0, 0, 0],
        [10, 0, 0],
        [20, 0, 0],
        [30, 0, 0],
        [40, 0, 0],
      ],
      context: {
        buildingIds: ["a", "a", null, "b", "b"],
        levelRefs: ["1F", "1F", null, "1F", "1F"],
      },
      kinds: ["corridor", "footway", "footway", "corridor"],
      steps: Array.from({ length: 4 }, (_, index) => ({
        kind: "corridor",
        name: "Passage",
        fromLevel: "1F",
        toLevel: "1F",
        startIndex: index,
        endIndex: index + 1,
        distanceM: 10,
        heightPending: false,
      })),
      distanceM: 40,
      animationSafe: true,
      warnings: [],
      edgeIds: [],
    },
  };
}
function flushMapSync() {
  hooks.cursor = 0;
  hooks.effects = [];
  hooks.sources = [];
  VenueJourneyMapSync();
  for (const effect of hooks.effects) effect();
}
type ElementProps = {
  children?: ReactNode;
  "aria-label"?: string;
  onClick?: () => void;
  onValueChange?: (value: string) => void;
  value?: string;
};
function findElement(
  node: ReactNode,
  matches: (element: ReactElement<ElementProps>) => boolean,
): ReactElement<ElementProps> | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<ElementProps>(child)) continue;
    if (matches(child)) return child;
    const found = findElement(child.props.children, matches);
    if (found) return found;
  }
}
function productView(active: LocalIndoorModel) {
  hooks.cursor = 0;
  hooks.effects = [];
  const tree = IndoorProductView({ model: active, onClose: vi.fn() });
  const scene = findElement(tree, (element) => element.type === IndoorMapScene);
  if (!scene) throw new Error("Indoor scene is missing");
  return { tree, scene: scene as ReactElement<IndoorSceneProps> };
}
beforeEach(() => {
  hooks.refs = [];
  hooks.cursor = 0;
  hooks.effects = [];
  hooks.sources = [];
  useMapStore.setState({
    venueJourney: null,
    map: null,
    indoorExploring: false,
  });
  useIndoorCatalog.setState({
    models: [model("a"), model("b")],
    activeBuildingKey: null,
    activeLevel: 0,
    selectedFeatureId: null,
    focusVersion: 0,
  });
});

describe("one-map cross-building display", () => {
  it("keeps the ground-floor route continuous through outdoor entrances, only on the ground floor", () => {
    const a = model("a"),
      b = model("b");
    for (const item of [a, b])
      item.building.levels.push({ ordinal: 1, ref: "2F", elevationM: 4 });
    const value = journey();
    const snapshot = JSON.stringify(value.route);
    useIndoorCatalog.setState({
      models: [a, b],
      activeBuildingKey: "synthetic-campus/a",
      activeLevel: 0,
    });
    useMapStore.setState({ venueJourney: value, indoorExploring: true });
    expect(productView(a).scene.props.campusRouteSegments).toEqual(
      [1, 2].map((index) =>
        expect.objectContaining({
          pathStart: index,
          pathEnd: index + 1,
          coordinates: [
            value.route.points[index],
            value.route.points[index + 1],
          ],
        }),
      ),
    );
    useIndoorCatalog.setState({ activeLevel: 1 });
    expect(productView(a).scene.props.campusRouteSegments).toEqual([]);
    useIndoorCatalog.setState({ activeLevel: 0 });
    expect(productView(a).scene.props.campusRouteSegments).toHaveLength(2);
    expect(JSON.stringify(value.route)).toBe(snapshot);
  });

  it("does not overlay floorless campus links on a selected upper floor", () => {
    const a = model("a"),
      b = model("b");
    for (const item of [a, b])
      item.building.levels.push({ ordinal: 1, ref: "2F", elevationM: 4 });
    useIndoorCatalog.setState({
      models: [a, b],
      activeBuildingKey: "synthetic-campus/a",
      activeLevel: 1,
    });
    useMapStore.setState({ venueJourney: journey(), indoorExploring: true });
    const { scene } = productView(a);
    expect(scene.props.campusRouteSegments).toEqual([]);
  });

  it("lists only the active building's own floors instead of the whole campus", () => {
    const information = model("information"),
      other = model("other");
    information.building.levels = Array.from({ length: 8 }, (_, ordinal) => ({
      ordinal,
      ref: `${ordinal + 1}F`,
      elevationM: ordinal * 4,
    }));
    other.building.levels.push(
      { ordinal: -2, ref: "B2", elevationM: -8 },
      { ordinal: -1, ref: "B1", elevationM: -4 },
      { ordinal: 8, ref: "9F", elevationM: 32 },
    );
    useIndoorCatalog.setState({
      models: [information, other],
      activeBuildingKey: "synthetic-campus/information",
      activeLevel: 0,
    });
    const { tree, scene } = productView(information);
    const floors = findElement(
      tree,
      (element) => element.props["aria-label"] === "venueChooseFloor",
    );
    const buttons = Children.toArray(floors?.props.children).filter(
      isValidElement<ElementProps>,
    );
    expect(
      buttons.flatMap((button) =>
        button.props["aria-label"] ? [button.props["aria-label"]] : [],
      ),
    ).toEqual(
      Array.from({ length: 8 }, (_, index) => `venueShowFloor:${8 - index}F`),
    );
    expect(scene.props.visibleLevels).toEqual([0]);
    expect(scene.props.buildingViews).toHaveLength(2);
    useIndoorCatalog.getState().showBuilding(other);
    const otherFloors = findElement(
      productView(other).tree,
      (element) => element.props["aria-label"] === "venueChooseFloor",
    );
    expect(
      Children.toArray(otherFloors?.props.children).flatMap((child) =>
        isValidElement<ElementProps>(child) && child.props["aria-label"]
          ? [child.props["aria-label"]]
          : [],
      ),
    ).toEqual([
      "venueShowFloor:9F",
      "venueShowFloor:1F",
      "venueShowFloor:B1",
      "venueShowFloor:B2",
    ]);
    expect(information.building.levels).toHaveLength(8);
  });

  it.each([
    { ref: "9F", ordinal: 8, targetOrdinal: 0 },
    { ref: "B1", ordinal: -1, targetOrdinal: 0 },
    { ref: "2F", ordinal: 1, targetOrdinal: 5 },
  ])(
    "switches buildings by floor ref from $ref, with a valid target fallback",
    ({ ref, ordinal, targetOrdinal }) => {
      const from = model("from"),
        to = model("to");
      from.building.levels.push({ ordinal, ref, elevationM: ordinal * 4 });
      to.building.levels.push({ ordinal: 5, ref: "2F", elevationM: 4 });
      useIndoorCatalog.setState({
        models: [from, to],
        activeBuildingKey: "synthetic-campus/from",
        activeLevel: ordinal,
      });
      useMapStore.setState({ indoorExploring: true });
      useIndoorCatalog.getState().showBuilding(to);
      expect(useIndoorCatalog.getState().activeLevel).toBe(targetOrdinal);
      const { scene } = productView(to);
      expect(scene.props.visibleLevels).toEqual([targetOrdinal]);
      expect(
        scene.props.buildingViews?.find((view) => view.model === to),
      ).toMatchObject({ levelOrdinal: targetOrdinal });
    },
  );

  it("keeps the displayed floor ref when focusing another building's feature", () => {
    const from = model("from"),
      to = model("to");
    from.building.levels.push({ ordinal: 1, ref: "2F", elevationM: 4 });
    to.building.levels.push({ ordinal: 5, ref: "2F", elevationM: 4 });
    useIndoorCatalog.setState({
      models: [from, to],
      activeBuildingKey: "synthetic-campus/from",
      activeLevel: 1,
    });
    useIndoorCatalog.getState().setActiveBuilding(to);
    expect(useIndoorCatalog.getState().activeLevel).toBe(5);
    expect(useIndoorCatalog.getState().focusVersion).toBe(0);
  });

  it("uses the existing shadcn Select to change the building without replacing the journey", () => {
    const from = model("from"),
      to = model("to"),
      value = journey();
    useIndoorCatalog.setState({
      models: [from, to],
      activeBuildingKey: "synthetic-campus/from",
    });
    useMapStore.setState({ venueJourney: value, indoorExploring: true });
    const { tree } = productView(from);
    const select = findElement(tree, (element) => element.type === Select);
    const trigger = findElement(
      tree,
      (element) => element.type === SelectTrigger,
    );
    expect(select?.props.value).toBe("synthetic-campus/from");
    expect(trigger?.props["aria-label"]).toBe("venueChooseBuilding");
    const markup = renderToStaticMarkup(tree);
    expect(markup).toContain('data-slot="select-trigger"');
    expect(markup).toContain('role="combobox"');
    expect(select?.props.onValueChange).toBeTypeOf("function");
    select?.props.onValueChange?.("synthetic-campus/to");
    expect(useIndoorCatalog.getState().activeBuildingKey).toBe(
      "synthetic-campus/to",
    );
    expect(useMapStore.getState().venueJourney).toBe(value);
  });

  it("leaves indoor links to the shared Three overlay and retains the outdoor overview layer", () => {
    const a = model("a"),
      b = model("b");
    a.building.levels.push({ ordinal: 2, ref: "3F", elevationM: 8 });
    useIndoorCatalog.setState({
      models: [a, b],
      activeBuildingKey: "synthetic-campus/a",
      activeLevel: 0,
    });
    useMapStore.setState({ venueJourney: journey(), indoorExploring: true });
    renderToStaticMarkup(<VenueCampusRoute />);
    expect(hooks.sources).toHaveLength(0);
    hooks.sources = [];
    useIndoorCatalog.setState({ activeLevel: 2 });
    renderToStaticMarkup(<VenueCampusRoute />);
    expect(hooks.sources).toHaveLength(0);
    useMapStore.setState({ indoorExploring: false });
    renderToStaticMarkup(<VenueCampusRoute />);
    expect(hooks.sources).toHaveLength(1);
    expect(hooks.sources[0].features).toHaveLength(2);
    expect(hooks.sources[0].features[0].geometry.coordinates).toHaveLength(2);
  });

  it("draws only exact outdoor links and does not connect separated indoor segments", () => {
    const route = journey().route;
    const source = JSON.stringify(route);
    expect(campusRouteSegments(route, model("a"))).toEqual([
      [route.points[1], route.points[2]],
      [route.points[2], route.points[3]],
    ]);
    expect(JSON.stringify(route)).toBe(source);
  });

  it("retains a directly authored elevated inter-building bridge without flattening source Z", () => {
    const route = journey().route;
    route.points = [
      [0, 0, 8],
      [10, 0, 8],
      [20, 0, 8],
    ];
    route.context = {
      buildingIds: ["a", "b", "b"],
      levelRefs: ["3F", "3F", "3F"],
    };
    expect(campusRouteSegments(route, model("a"))).toEqual([
      [route.points[0], route.points[1]],
    ]);
  });

  it("omits floorless entrance links from every indoor floor view", () => {
    const route = journey().route;
    for (const view of [
      { buildingId: "a", levelRef: "1F" },
      { buildingId: "b", levelRef: "1F" },
    ])
      expect(campusRouteSegments(route, model("a"), view)).toEqual([]);
  });

  it("shows a bridge only when both connected building floors are displayed", () => {
    const route = journey().route;
    route.points = [
      [0, 0, 8],
      [10, 0, 8],
      [20, 0, 8],
    ];
    route.context = {
      buildingIds: ["a", "b", "b"],
      levelRefs: ["3F", "2F", "2F"],
    };
    expect(
      campusRouteSegments(route, model("a"), [
        { buildingId: "a", levelRef: "3F" },
        { buildingId: "b", levelRef: "2F" },
      ]),
    ).toEqual([[route.points[0], route.points[1]]]);
    for (const view of [
      [{ buildingId: "a", levelRef: "3F" }],
      [{ buildingId: "b", levelRef: "2F" }],
      [
        { buildingId: "a", levelRef: "1F" },
        { buildingId: "b", levelRef: "3F" },
      ],
    ])
      expect(campusRouteSegments(route, model("a"), view)).toEqual([]);
  });

  it("rejects an incomplete context instead of guessing an exterior connection", () => {
    const route = journey().route;
    route.context = { buildingIds: [null], levelRefs: [null] };
    expect(campusRouteSegments(route, model("a"))).toEqual([]);
  });

  it("switches from one building's 1F to the other building's 1F without resetting the journey", () => {
    const value = journey();
    useMapStore.setState({ venueJourney: value });
    flushMapSync();
    expect(useIndoorCatalog.getState().activeBuildingKey).toBe(
      "synthetic-campus/a",
    );
    const next = { ...value, guidance: { ...value.guidance, stepIndex: 3 } };
    useMapStore.setState({ venueJourney: next });
    flushMapSync();
    expect(useIndoorCatalog.getState().activeBuildingKey).toBe(
      "synthetic-campus/b",
    );
    expect(useMapStore.getState().venueJourney).toBe(next);
    expect(useMapStore.getState().venueJourney?.guidance.stepIndex).toBe(3);
  });

  it("does not re-enter the guidance building when only a manual map selection changes", () => {
    useMapStore.setState({ venueJourney: journey() });
    flushMapSync();
    useIndoorCatalog.getState().showBuilding(model("b"));
    flushMapSync();
    expect(useIndoorCatalog.getState().activeBuildingKey).toBe(
      "synthetic-campus/b",
    );
  });

  it("resumes the guidance building after a newly confirmed step on the same floor", () => {
    const value = journey();
    useMapStore.setState({ venueJourney: value });
    flushMapSync();
    useIndoorCatalog.getState().showBuilding(model("b"));
    useMapStore.setState({
      venueJourney: { ...value, guidance: { ...value.guidance, stepIndex: 1 } },
    });
    flushMapSync();
    expect(useIndoorCatalog.getState().activeBuildingKey).toBe(
      "synthetic-campus/a",
    );
    expect(useMapStore.getState().venueJourney?.guidance.stepIndex).toBe(1);
  });

  it("keeps the campus cutaway open across outdoor context without declaring arrival", () => {
    const value = journey();
    value.guidance.stepIndex = 2;
    useMapStore.setState({ venueJourney: value, indoorExploring: true });
    flushMapSync();
    expect(useMapStore.getState().indoorExploring).toBe(true);
    expect(useMapStore.getState().venueJourney?.guidance.status).toBe(
      "guiding",
    );
  });

  it("follows a preview across buildings including its final stopped frame, without advancing guidance", () => {
    const value = journey();
    value.guidance.status = "idle";
    value.preview = { progress: 0.1, playing: true, direction: 1 };
    useMapStore.setState({ venueJourney: value });
    flushMapSync();
    expect(useIndoorCatalog.getState().activeBuildingKey).toBe(
      "synthetic-campus/a",
    );
    const next = {
      ...value,
      preview: { ...value.preview, progress: 1, playing: false },
    };
    useMapStore.setState({ venueJourney: next });
    flushMapSync();
    expect(useIndoorCatalog.getState().activeBuildingKey).toBe(
      "synthetic-campus/b",
    );
    expect(useMapStore.getState().venueJourney?.guidance).toEqual({
      status: "idle",
      stepIndex: 0,
    });
  });

  it("initializes the route origin once, then keeps a manually chosen building and floor through arrow playback changes", () => {
    const value = journey();
    value.guidance = { status: "touring", stepIndex: 0 };
    value.preview = {
      progress: 0.9,
      playing: true,
      direction: 1,
      following: false,
    };
    const b = model("b");
    b.building.levels.push({ ordinal: 2, ref: "3F", elevationM: 8 });
    useIndoorCatalog.setState({ models: [model("a"), b] });
    useMapStore.setState({ venueJourney: value });
    flushMapSync();
    expect(useIndoorCatalog.getState().activeBuildingKey).toBe(
      "synthetic-campus/a",
    );
    expect(useIndoorCatalog.getState().activeLevel).toBe(0);
    useIndoorCatalog.getState().showBuilding(b);
    useIndoorCatalog.getState().setActiveLevel(2);
    const source = value.route;
    for (const preview of [
      { progress: 0.1, playing: true, following: true },
      { progress: 0.6, playing: false, following: false },
      { progress: 1, playing: true, following: true },
    ]) {
      const next = { ...value, preview: { ...value.preview, ...preview } };
      useMapStore.setState({ venueJourney: next });
      flushMapSync();
      expect(useIndoorCatalog.getState().activeBuildingKey).toBe(
        "synthetic-campus/b",
      );
      expect(useIndoorCatalog.getState().activeLevel).toBe(2);
      expect(useMapStore.getState().indoorExploring).toBe(true);
      expect(useMapStore.getState().venueJourney?.route).toBe(source);
    }
    expect(useMapStore.getState().venueJourney?.guidance).toEqual({
      status: "touring",
      stepIndex: 0,
    });
  });

  it("does not reopen a closed cutaway when legacy following or playback fields change", () => {
    const value = journey();
    value.guidance = { status: "touring", stepIndex: 0 };
    value.preview = {
      progress: 0.1,
      playing: false,
      direction: 1,
      following: false,
    };
    useMapStore.setState({ venueJourney: value });
    flushMapSync();
    expect(useIndoorCatalog.getState().activeBuildingKey).toBe(
      "synthetic-campus/a",
    );
    useIndoorCatalog.getState().showBuilding(model("b"));
    useMapStore.getState().setIndoorExploring(false);
    useMapStore.setState({
      venueJourney: {
        ...value,
        preview: {
          ...value.preview,
          progress: 1,
          following: true,
          playing: true,
        },
      },
    });
    flushMapSync();
    expect(useIndoorCatalog.getState().activeBuildingKey).toBe(
      "synthetic-campus/b",
    );
    expect(useMapStore.getState().indoorExploring).toBe(false);
    expect(useMapStore.getState().venueJourney?.guidance.status).toBe(
      "touring",
    );
  });

  it("keeps manual floor and view controls independent of arrow playback and old bridge progress", () => {
    const a = model("a"),
      b = model("b");
    for (const item of [a, b])
      item.building.levels.push(
        { ordinal: 1, ref: "2F", elevationM: 4 },
        { ordinal: 2, ref: "3F", elevationM: 8 },
      );
    const value = journey();
    value.guidance.status = "touring";
    value.preview = {
      progress: 0.25,
      playing: true,
      direction: 1,
      following: true,
    };
    value.route.points = [
      [0, 0, 8],
      [10, 0, 8],
      [20, 0, 8],
    ];
    value.route.context = {
      buildingIds: ["a", "b", "b"],
      levelRefs: ["3F", "2F", "2F"],
    };
    value.route.steps = [
      {
        ...value.route.steps[0],
        fromLevel: "3F",
        toLevel: "2F",
        startIndex: 0,
        endIndex: 2,
        distanceM: 20,
      },
    ];
    value.route.kinds = ["corridor", "corridor"];
    value.route.distanceM = 20;
    useIndoorCatalog.setState({
      models: [a, b],
      activeBuildingKey: "synthetic-campus/a",
      activeLevel: 0,
    });
    useMapStore.setState({ venueJourney: value, indoorExploring: true });
    const original = JSON.stringify(value.route);
    const initial = productView(a);
    expect("cameraFollowing" in initial.scene.props).toBe(false);
    expect(renderToStaticMarkup(initial.tree)).not.toContain(
      "venueResumeTourCamera",
    );
    expect(
      initial.scene.props.buildingViews?.map((view) => view.levelOrdinal),
    ).toEqual([0, 0]);
    const floor = findElement(
      initial.tree,
      (element) => element.props["aria-label"] === "venueShowFloor:2F",
    );
    expect(floor?.props.onClick).toBeTypeOf("function");
    floor?.props.onClick?.();
    expect(useIndoorCatalog.getState().activeLevel).toBe(1);
    expect(useMapStore.getState().venueJourney?.preview.playing).toBe(true);
    const changed = productView(a);
    expect(
      changed.scene.props.buildingViews?.map((view) => view.levelOrdinal),
    ).toEqual([1, 1]);
    const view = findElement(
      changed.tree,
      (element) => element.props["aria-label"] === "切換俯視",
    );
    expect(view?.props.onClick).toBeTypeOf("function");
    view?.props.onClick?.();
    expect(productView(a).scene.props.view).toBe("top");
    expect(useMapStore.getState().venueJourney?.preview.playing).toBe(true);
    expect(useMapStore.getState().venueJourney?.preview.progress).toBe(0.25);
    expect(JSON.stringify(useMapStore.getState().venueJourney?.route)).toBe(
      original,
    );
  });

  it("does not apply an old API revision even when its source SHA still matches", () => {
    const value = journey();
    value.sourceVersion = "synthetic-campus:3";
    useMapStore.setState({ venueJourney: value });
    flushMapSync();
    expect(useIndoorCatalog.getState().activeBuildingKey).toBeNull();
    expect(useMapStore.getState().indoorExploring).toBe(false);
  });
});
