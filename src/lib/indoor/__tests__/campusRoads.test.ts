import { describe, expect, it } from "vitest";
import { campusRoadLayers } from "../campusRoadStyle";
import { campusRoadData, outsideBuildingSegments } from "../campusRoads";
import type { IndoorWalkway, LocalIndoorModel, XY, XYZ } from "../types";

const square: XY[][] = [
  [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
    [0, 0],
  ],
];
function walkway(id: string, a: XYZ, b: XYZ): IndoorWalkway {
  return {
    id,
    coordinates: [a, b],
    indoor: false,
    nodeIds: [`${id}-a`, `${id}-b`],
    buildingIds: [null, null],
    levelRefs: [null, null],
    kind: "footway",
    wheelchair: "unknown",
    osmRef: `way/${id}`,
  };
}
function model(walkways: IndoorWalkway[]): LocalIndoorModel {
  return {
    schemaVersion: 1,
    venueId: "test-campus",
    name: "Test campus",
    origin: [0, 0],
    source: { sha256: "test", generatedAt: "test", warnings: [] },
    building: {
      id: "a",
      name: "A",
      footprint: square,
      levels: [
        { ordinal: 0, ref: "1F", elevationM: 0 },
        { ordinal: 2, ref: "3F", elevationM: 8 },
      ],
      floorHeightM: 4,
      geometryStatus: "schematic",
      heightStatus: "estimated",
    },
    features: [],
    connections: [],
    nodes: [],
    edges: [],
    places: [],
    walls: [],
    campus: { walkways, connections: [] },
  };
}

describe("source outdoor ground network", () => {
  it("exists without a navigation route and deduplicates shared campus models", () => {
    const m = model([walkway("outside", [-5, -5, 0], [15, -5, 0])]);
    expect(campusRoadData([m, m]).features).toHaveLength(1);
    expect(campusRoadData([{ ...m, campus: undefined }]).features).toHaveLength(
      0,
    );
  });
  it("excludes indoor, basement, elevated and bridge edges even with null aggregate ownership", () => {
    const m = model([
      { ...walkway("indoor", [-5, -5, 0], [15, -5, 0]), indoor: true },
      {
        ...walkway("basement", [-5, -5, -4], [15, -5, -4]),
        buildingIds: ["a", "a"],
        levelRefs: ["B1", "B1"],
      },
      {
        ...walkway("bridge", [-5, -5, 8], [15, -5, 8]),
        buildingIds: ["a", "a"],
        levelRefs: ["3F", "3F"],
      },
      walkway("unowned-elevated", [-5, -5, 8], [15, -5, 8]),
    ]);
    expect(campusRoadData([m]).features).toHaveLength(0);
  });
  it("clips only building interiors while preserving exact source geometry", () => {
    const a: XYZ = [-5, 5, 0],
      b: XYZ = [15, 5, 0];
    const before = JSON.stringify({ a, b, square });
    expect(outsideBuildingSegments(a, b, [square])).toEqual([
      [a, [0, 5, 0]],
      [[10, 5, 0], b],
    ]);
    expect(outsideBuildingSegments([1, 1, 0], [9, 1, 0], [square])).toEqual([]);
    expect(JSON.stringify({ a, b, square })).toBe(before);
  });
  it("retains courtyard paths, boundary paths and separate source pieces", () => {
    const courtyard: XY[][] = [
      ...square,
      [
        [3, 3],
        [7, 3],
        [7, 7],
        [3, 7],
        [3, 3],
      ],
    ];
    expect(
      outsideBuildingSegments([-5, 5, 0], [15, 5, 0], [courtyard]),
    ).toEqual([
      [
        [-5, 5, 0],
        [0, 5, 0],
      ],
      [
        [3, 5, 0],
        [7, 5, 0],
      ],
      [
        [10, 5, 0],
        [15, 5, 0],
      ],
    ]);
    expect(outsideBuildingSegments([0, 0, 0], [10, 0, 0], [square])).toEqual([
      [
        [0, 0, 0],
        [10, 0, 0],
      ],
    ]);
  });
  it("retains paths along courtyard hole boundaries", () => {
    const courtyard: XY[][] = [
      ...square,
      [
        [3, 3],
        [7, 3],
        [7, 7],
        [3, 7],
        [3, 3],
      ],
    ];
    expect(outsideBuildingSegments([3, 3, 0], [7, 3, 0], [courtyard])).toEqual([
      [
        [3, 3, 0],
        [7, 3, 0],
      ],
    ]);
  });
  it("includes source outdoor ramps and short steps omitted from ordinary walkways", () => {
    const approach = walkway("approach", [-5, -5, 0], [-1, -5, 0]);
    const m = model([approach]);
    m.campus?.connections.push({
      id: "ramp",
      name: "Ramp",
      kind: "ramp",
      buildingId: null,
      nodeIds: ["approach-b", "ramp-b"],
      levelRefs: [null, "1F"],
      coordinates: [
        [-1, -5, 0],
        [-1, -1, 0],
      ],
      wheelchair: "yes",
      heightPending: true,
      geometryStatus: "schematic",
      heightStatus: "estimated",
      tags: {},
      osmRef: "way/ramp",
    });
    // Explicit building/floor identity is needed for the ground-floor endpoint.
    if (m.campus) m.campus.connections[0].buildingId = "a";
    expect(campusRoadData([m]).features).toHaveLength(2);
    if (m.campus) m.campus.connections[0].kind = "steps";
    expect(campusRoadData([m]).features).toHaveLength(2);
    if (m.campus) m.campus.connections[0].levelRefs[1] = "3F";
    expect(campusRoadData([m]).features).toHaveLength(1);
  });
  it("does not turn an unowned or interior connection into an exterior road", () => {
    const m = model([]);
    m.campus?.connections.push({
      id: "unknown",
      name: "Unknown",
      kind: "ramp",
      buildingId: null,
      coordinates: [
        [-1, -5, 0],
        [-1, -1, 0],
      ],
      levelRefs: [null, null],
      wheelchair: "unknown",
      heightPending: true,
      geometryStatus: "schematic",
      heightStatus: "estimated",
      tags: {},
      osmRef: "way/unknown",
    });
    expect(campusRoadData([m]).features).toHaveLength(0);
  });
});

describe("basemap road appearance", () => {
  it("copies the current basemap zoom/style expressions and changes only source/filter identity", () => {
    const original = {
      id: "highway_path",
      type: "line" as const,
      source: "tiles",
      "source-layer": "transportation",
      minzoom: 13,
      paint: { "line-color": "#1b1b1d", "line-width": 3 },
      layout: { "line-cap": "round" as const },
    };
    const result = campusRoadLayers([original]);
    expect(result).toHaveLength(1);
    expect(result[0].paint).toEqual(original.paint);
    expect(result[0].layout).toEqual(original.layout);
    expect(result[0].minzoom).toBe(13);
    expect(result[0]).not.toHaveProperty("source-layer");
    if (result[0].paint) result[0].paint["line-color"] = "red";
    expect(original.paint["line-color"]).toBe("#1b1b1d");
  });
  it("refreshes with the newly loaded theme rather than caching the previous paint", () => {
    expect(
      campusRoadLayers([
        {
          id: "road_path_pedestrian",
          type: "line",
          source: "tiles",
          paint: { "line-color": "white" },
        },
      ])[0].paint?.["line-color"],
    ).toBe("white");
    expect(campusRoadLayers([])).toEqual([]);
  });
});
