import { describe, expect, it } from "vitest";
import {
  campusBuildingViews,
  campusLevels,
  campusModels,
  defaultIndoorLevel,
} from "../campusDisplay";
import type { IndoorRoute, LocalIndoorModel } from "../types";

function building(
  id: string,
  floors: [number, string, boolean][],
): LocalIndoorModel {
  return {
    schemaVersion: 1,
    venueId: "synthetic",
    name: "Campus",
    origin: [0, 0],
    source: { sha256: "test", generatedAt: "test", warnings: [] },
    api: { version: 1, sourceSha256: "test", importedAt: "test" },
    building: {
      id,
      name: id,
      footprint: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 0],
        ],
      ],
      levels: floors.map(([ordinal, ref, display]) => ({
        ordinal,
        ref,
        elevationM: ordinal * 3,
        coverage: {
          hasAnchor: display,
          hasRouteData: display,
          hasDisplayGeometry: display,
        },
      })),
      floorHeightM: 3,
      geometryStatus: "schematic",
      heightStatus: "estimated",
    },
    features: [],
    places: [],
    connections: [],
    nodes: [],
    edges: [],
    walls: [],
  };
}
function bridge(): IndoorRoute {
  return {
    ok: true,
    points: [
      [0, 0, 8],
      [10, 0, 8],
      [20, 0, 8],
    ],
    kinds: ["corridor", "corridor"],
    context: { buildingIds: ["a", "b", "b"], levelRefs: ["3F", "2F", "2F"] },
    steps: [],
    edgeIds: [],
    fromPlaceId: "from",
    toPlaceId: "to",
    distanceM: 20,
    animationSafe: false,
    warnings: [],
  };
}

describe("campus floor display policy", () => {
  it("opens all four published buildings on their own floor geometry by ref", () => {
    const models = [
      building("a", [
        [0, "1F", true],
        [1, "2F", true],
      ]),
      building("b", [
        [0, "1F", true],
        [5, "2F", true],
      ]),
      building("c", [
        [0, "1F", true],
        [1, "2F", true],
      ]),
      building("d", [
        [0, "1F", true],
        [1, "2F", true],
      ]),
    ];
    expect(
      campusBuildingViews(models, "2F").map((view) => [
        view.model.building.id,
        view.levelOrdinal,
      ]),
    ).toEqual([
      ["a", 1],
      ["b", 5],
      ["c", 1],
      ["d", 1],
    ]);
  });
  it("does not invent or copy floors when display coverage is absent", () => {
    const models = [
      building("a", [
        [0, "1F", true],
        [4, "5F", true],
      ]),
      building("b", [
        [0, "1F", true],
        [4, "5F", false],
      ]),
      building("c", [[0, "1F", true]]),
    ];
    expect(
      campusBuildingViews(models, "5F").map((view) => [
        view.levelOrdinal,
        view.levelRef,
      ]),
    ).toEqual([
      [4, "5F"],
      [null, "5F"],
      [null, null],
    ]);
  });
  it("starts at a real display floor instead of the first sorted empty basement", () => {
    const model = building("a", [
      [-2, "B2", false],
      [-1, "B1", false],
      [0, "1F", true],
    ]);
    expect(defaultIndoorLevel(model).ref).toBe("1F");
    expect(campusLevels([model, model]).map((level) => level.ref)).toEqual([
      "B2",
      "B1",
      "1F",
    ]);
  });
  it("never combines source versions even if their source hashes match", () => {
    const a = building("a", [[0, "1F", true]]),
      b = building("b", [[0, "1F", true]]);
    if (b.api) b.api.version = 2;
    expect(campusModels([a, b], a)).toEqual([a]);
  });
  it("shows both bridge endpoints on their authored floors in either direction", () => {
    const models = [
      building("a", [
        [1, "2F", true],
        [2, "3F", true],
      ]),
      building("b", [
        [1, "2F", true],
        [2, "3F", true],
      ]),
    ];
    const route = bridge(),
      before = JSON.stringify(route);
    for (const direction of [1, -1] as const) {
      const views = campusBuildingViews(models, "3F", {
        route,
        progress: 0.25,
        direction,
      });
      expect(views.map((view) => view.levelRef)).toEqual(["3F", "2F"]);
    }
    expect(JSON.stringify(route)).toBe(before);
  });
  it("does not create a second floor in the same building for a vertical connection", () => {
    const route = bridge();
    if (route.context) route.context.buildingIds = ["a", "a", "a"];
    const views = campusBuildingViews(
      [
        building("a", [
          [1, "2F", true],
          [2, "3F", true],
        ]),
      ],
      "3F",
      { route, progress: 0.25, direction: 1 },
    );
    expect(views).toHaveLength(1);
    expect(views[0].levelRef).toBe("3F");
  });
});
