import { describe, expect, it, vi } from "vitest";
import {
  buildingSceneProps,
  indoorBuildingViews,
  indoorSceneModelsKey,
} from "../mapSceneViews";
import type { IndoorSceneProps } from "../sceneTypes";
import type { IndoorRoute, LocalIndoorModel } from "../types";

function model(id: string): LocalIndoorModel {
  return {
    schemaVersion: 1,
    venueId: "synthetic-campus",
    name: "Synthetic campus",
    origin: [120, 24],
    source: { sha256: "synthetic-version", generatedAt: "test", warnings: [] },
    building: {
      id,
      name: id,
      footprint: [
        [
          [0, 0],
          [8, 0],
          [8, 8],
          [0, 8],
          [0, 0],
        ],
      ],
      levels: [
        { ordinal: 0, ref: "1F", elevationM: 0 },
        { ordinal: 2, ref: "3F", elevationM: 8 },
      ],
      floorHeightM: 4,
      heightStatus: "estimated",
      geometryStatus: "schematic",
    },
    features: [],
    connections: [],
    places: [],
    walls: [],
    nodes: [],
    edges: [],
  };
}
const route: IndoorRoute = {
  ok: true,
  fromPlaceId: "start",
  toPlaceId: "finish",
  points: [
    [1, 1, 0],
    [7, 1, 0],
  ],
  context: { buildingIds: ["a", "b"], levelRefs: ["1F", "1F"] },
  kinds: ["corridor"],
  steps: [],
  distanceM: 6,
  edgeIds: [],
  warnings: [],
  animationSafe: false,
};
function props(): IndoorSceneProps {
  const a = model("a"),
    b = model("b");
  return {
    model: a,
    buildingViews: [
      { key: "a", model: a, levelOrdinal: 0 },
      { key: "b", model: b, levelOrdinal: 2 },
    ],
    activeBuildingKey: "b",
    visibleLevels: [2],
    selectedId: "same-source-id",
    focusId: "same-source-id",
    onSelect: vi.fn(),
    view: "perspective",
    route,
    progress: 0.4,
    routeDirection: 1,
    grounded: true,
    exploded: false,
    cameraAction: { type: "reset", nonce: 0 },
    showLabels: true,
    theme: "dark",
  };
}

describe("multi-building scene views", () => {
  it("keeps the source frame and route shared while selecting only the addressed building", () => {
    const p = props(),
      source = JSON.stringify(p);
    const [a, b] = indoorBuildingViews(p);
    expect(buildingSceneProps(p, a)).toMatchObject({
      visibleLevels: [0],
      selectedId: null,
      focusId: null,
      theme: "dark",
    });
    expect(buildingSceneProps(p, b)).toMatchObject({
      visibleLevels: [2],
      selectedId: "same-source-id",
      focusId: "same-source-id",
    });
    expect(buildingSceneProps(p, a).route).toBe(route);
    expect(buildingSceneProps(p, b).route).toBe(route);
    expect(buildingSceneProps(p, b).model).toBe(b.model);
    expect(JSON.stringify(p)).toBe(source);
  });

  it("does not fabricate a first floor for missing, null or unknown floor selections", () => {
    const p = props(),
      view = indoorBuildingViews(p)[0];
    expect(
      buildingSceneProps(p, { ...view, levelOrdinal: null }).visibleLevels,
    ).toEqual([]);
    expect(
      buildingSceneProps(p, { ...view, levelOrdinal: 99 }).visibleLevels,
    ).toEqual([]);
    expect(buildingSceneProps(p, view).visibleLevels).toEqual([0]);
    expect(
      indoorBuildingViews({
        ...p,
        buildingViews: undefined,
        visibleLevels: [],
      })[0].levelOrdinal,
    ).toBeNull();
  });

  it("keeps layer identity through focus, floor, tour progress and theme changes", () => {
    const p = props();
    const key = indoorSceneModelsKey(p);
    expect(
      indoorSceneModelsKey({
        ...p,
        model: indoorBuildingViews(p)[1].model,
        activeBuildingKey: "a",
        selectedId: null,
        progress: 0.9,
        theme: "light",
        routePlaying: true,
        buildingViews: indoorBuildingViews(p).map((view) => ({
          ...view,
          levelOrdinal: null,
        })),
      }),
    ).toBe(key);
    const changed = structuredClone(indoorBuildingViews(p)[1].model);
    changed.source.sha256 = "new-source";
    expect(
      indoorSceneModelsKey({
        ...p,
        buildingViews: [{ key: "b", model: changed, levelOrdinal: 0 }],
      }),
    ).not.toBe(key);
  });

  it("retains independently positioned geometry but suppresses routes in another coordinate frame or revision", () => {
    const p = props(),
      view = indoorBuildingViews(p)[1];
    for (const foreign of [
      { ...view.model, origin: [121, 24] as [number, number] },
      { ...view.model, venueId: "another-campus" },
      {
        ...view.model,
        source: { ...view.model.source, sha256: "old-version" },
      },
    ]) {
      const result = buildingSceneProps(p, { ...view, model: foreign });
      expect(result.model).toBe(foreign);
      expect(result.route).toBeNull();
      expect(result.visibleLevels).toEqual([2]);
    }
  });
});
