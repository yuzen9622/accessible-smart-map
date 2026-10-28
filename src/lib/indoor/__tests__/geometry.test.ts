import polygonClipping, { type MultiPolygon } from "polygon-clipping";
import { ExtrudeGeometry, Path, Shape, Vector2 } from "three";
import { describe, expect, it } from "vitest";
import {
  area,
  centroid,
  clipSegmentHeight,
  floorGeometry,
  guardSegments,
  inside,
  labelAnchor,
  roomWalls,
  segmentRectangle,
  unionWalls,
  wallGeometry,
} from "../geometry";
import type { IndoorFeature, LocalIndoorModel, XY } from "../types";

describe("route cutaway", () => {
  it("clips ascending and descending segments to the same view without shifting XY", () => {
    expect(clipSegmentHeight([0, 2, 0], [8, 2, 8], 2, 4)).toEqual([
      [2, 2, 2],
      [4, 2, 4],
    ]);
    expect(clipSegmentHeight([8, 2, 8], [0, 2, 0], 2, 4)).toEqual([
      [4, 2, 4],
      [2, 2, 2],
    ]);
  });
  it("keeps horizontal platform travel only within the selected cut", () => {
    expect(clipSegmentHeight([0, 0, 4], [2, 0, 4], 3, 5)).toEqual([
      [0, 0, 4],
      [2, 0, 4],
    ]);
    expect(clipSegmentHeight([0, 0, 8], [2, 0, 8], 3, 5)).toBeNull();
    expect(clipSegmentHeight([0, 0, 0], [2, 0, 2], 3, 5)).toBeNull();
  });
});

describe("platform guard openings", () => {
  it("keeps both offset flight entrances clear on one long edge", () => {
    expect(
      guardSegments(
        [0, 0],
        [3, 0],
        [
          { point: [0.5, 0], width: 1 },
          { point: [2.5, 0], width: 1 },
        ],
      ),
    ).toEqual([{ a: [1, 0], b: [2, 0] }]);
  });
  it("does not remove an edge for a flight on the opposite side of the platform", () => {
    expect(
      guardSegments([0, 0], [2, 0], [{ point: [1, 1], width: 1 }]),
    ).toEqual([{ a: [0, 0], b: [2, 0] }]);
  });
});

// Deliberately synthetic: no campus geometry or private source coordinates.
const rectangle = (x1: number, y1: number, x2: number, y2: number): XY[] => [
  [x1, y1],
  [x2, y1],
  [x2, y2],
  [x1, y2],
  [x1, y1],
];

function feature(
  id: string,
  ring: XY[],
  overrides: Partial<IndoorFeature> = {},
): IndoorFeature {
  return {
    id,
    kind: "room",
    ordinal: 0,
    levelRef: "1F",
    geometry: { type: "Polygon", coordinates: [ring] },
    tags: {},
    geometryStatus: "schematic",
    heightStatus: "estimated",
    ...overrides,
  };
}

function model(features: IndoorFeature[]): LocalIndoorModel {
  return {
    schemaVersion: 1,
    venueId: "synthetic",
    name: "Synthetic geometry",
    source: { sha256: "test", generatedAt: "test", warnings: [] },
    origin: [0, 0],
    building: {
      id: "synthetic",
      name: "Synthetic building",
      footprint: [rectangle(-20, -20, 20, 20)],
      levels: [
        { ordinal: 0, ref: "1F", elevationM: 0 },
        { ordinal: 1, ref: "2F", elevationM: 4 },
      ],
      floorHeightM: 4,
      heightStatus: "estimated",
      geometryStatus: "schematic",
    },
    features,
    connections: [],
    nodes: [],
    edges: [],
    places: [],
    walls: [],
  };
}

function surfaceArea(polygons: MultiPolygon): number {
  return polygons.reduce(
    (sum, rings) =>
      sum +
      Math.abs(area(rings[0])) -
      rings.slice(1).reduce((holes, ring) => holes + Math.abs(area(ring)), 0),
    0,
  );
}

describe("indoor floor geometry", () => {
  it("joins touching room and corridor patches while retaining an L-shaped recess", () => {
    const data = model([
      feature("room", rectangle(0, 0, 4, 4)),
      feature("corridor", rectangle(4, 0, 6, 2), { kind: "corridor" }),
    ]);
    const floor = floorGeometry(data, 0);
    expect(floor).toHaveLength(1);
    expect(surfaceArea(floor)).toBeCloseTo(20);
    expect(
      polygonClipping.intersection(floor, [rectangle(4, 2, 6, 4)]),
    ).toEqual([]);
  });

  it("cuts an authored void out of floor coverage", () => {
    const atrium = rectangle(2, 2, 4, 4);
    const data = model([
      feature("display-floor", rectangle(0, 0, 6, 6), {
        kind: "area",
        tags: { "a11ymap:area_type": "indoor-floor-base" },
      }),
      feature("atrium", atrium, {
        kind: "area",
        tags: { "a11ymap:area_type": "void" },
      }),
    ]);
    const floor = floorGeometry(data, 0);
    expect(surfaceArea(floor)).toBeCloseTo(32);
    expect(polygonClipping.intersection(floor, [atrium])).toEqual([]);
  });

  it("keeps core, shaft and stair openings in the floor slab", () => {
    const data = model([
      feature("corridor", rectangle(0, 0, 12, 5), { kind: "corridor" }),
      ...["vertical-core", "elevator-shaft", "stairwell"].map((type, index) =>
        feature(
          `opening-${index}`,
          rectangle(1 + index * 3, 1, 3 + index * 3, 3),
          {
            kind: "area",
            tags: { "a11ymap:area_type": type },
          },
        ),
      ),
    ]);
    const floor = floorGeometry(data, 0);
    expect(surfaceArea(floor)).toBeCloseTo(60);
    for (let index = 0; index < 3; index++) {
      expect(
        surfaceArea(
          polygonClipping.intersection(floor, [
            rectangle(1 + index * 3, 1, 3 + index * 3, 3),
          ]),
        ),
      ).toBeCloseTo(4);
    }
  });

  it("fills explicit floor coverage and shafts without closing authored holes or recesses", () => {
    const outline: XY[] = [
      [0, 0],
      [8, 0],
      [8, 4],
      [5, 4],
      [5, 6],
      [0, 6],
      [0, 0],
    ];
    const courtyard = rectangle(1, 1, 2, 2);
    const shaft = rectangle(6, 1, 7, 2);
    const base = feature("display-floor", outline, {
      kind: "area",
      tags: { "a11ymap:area_type": "indoor-floor-base" },
      geometry: { type: "Polygon", coordinates: [outline, courtyard] },
    });
    const data = model([
      base,
      feature("known-room", rectangle(3, 0, 4, 2)),
      feature("shaft", shaft, {
        kind: "area",
        tags: { "a11ymap:area_type": "elevator-shaft" },
      }),
    ]);
    const source = JSON.stringify(data);
    const floor = floorGeometry(data, 0);
    expect(surfaceArea(floor)).toBeCloseTo(41);
    expect(
      surfaceArea(polygonClipping.intersection(floor, [rectangle(0, 3, 4, 4)])),
    ).toBeCloseTo(4);
    expect(
      surfaceArea(polygonClipping.intersection(floor, [shaft])),
    ).toBeCloseTo(1);
    for (const empty of [courtyard, rectangle(5, 4, 8, 6)])
      expect(polygonClipping.intersection(floor, [empty])).toEqual([]);
    expect(roomWalls([base])).toEqual([]);
    expect(floorGeometry(data, 1)).toEqual([]);
    expect(JSON.stringify(data)).toBe(source);
  });

  it("preserves each floor and excludes unknown areas and the bounding footprint", () => {
    const data = model([
      feature("ground-room", rectangle(0, 0, 4, 4)),
      feature("upper-room", rectangle(0, 0, 2, 3), {
        ordinal: 1,
        levelRef: "2F",
      }),
      feature("unknown", rectangle(10, 10, 15, 15), { kind: "area" }),
      feature("toilet", rectangle(5, 0, 6, 2), {
        kind: "area",
        tags: { amenity: "toilets" },
      }),
    ]);
    expect(surfaceArea(floorGeometry(data, 0))).toBeCloseTo(18);
    expect(surfaceArea(floorGeometry(data, 1))).toBeCloseTo(6);
    expect(floorGeometry(data, 2)).toEqual([]);
  });
});

describe("shared room walls", () => {
  it("closes rotated walls without rounding their shared source endpoints", () => {
    // Independently generated room: a nearly collinear subdivision on one
    // side exposes cancellation in a + (b - a), even at t = 1.
    const angle = 11 * 0.173;
    const ring: XY[] = [
      [0, 0],
      [7.3, 0],
      [10.9, 0.0001],
      [10.9, 6.1],
      [0, 6.1],
      [0, 0],
    ].map(([x, y]) => [
      9.841 + x * Math.cos(angle) - y * Math.sin(angle),
      4.341 + x * Math.sin(angle) + y * Math.cos(angle),
    ]);
    const room = feature("rotated-room", ring);
    const corridorRing: XY[] = [
      [10.9, 0.0001],
      [12.9, 0.0001],
      [12.9, 6.1],
      [10.9, 6.1],
      [10.9, 0.0001],
    ].map(([x, y]) => [
      9.841 + x * Math.cos(angle) - y * Math.sin(angle),
      4.341 + x * Math.sin(angle) + y * Math.cos(angle),
    ]);
    const data = model([
      room,
      feature("corridor", corridorRing, { kind: "corridor" }),
    ]);
    const before = JSON.stringify(data);
    const solid = wallGeometry(data, 0).polygons;
    expect(surfaceArea(solid)).toBeGreaterThan(3);
    expect(surfaceArea(solid)).toBeLessThan(5);
    // Sub-nanometre display-overlay rounding must not change usable space.
    expect(surfaceArea(polygonClipping.difference(solid, [ring]))).toBeLessThan(
      1e-8,
    );
    expect(
      surfaceArea(polygonClipping.intersection(solid, [corridorRing])),
    ).toBeLessThan(1e-8);
    for (const [outline, ...holes] of solid) {
      const shape = new Shape(outline.map((point) => new Vector2(...point)));
      shape.holes = holes.map(
        (hole) => new Path(hole.map((point) => new Vector2(...point))),
      );
      const mesh = new ExtrudeGeometry(shape, {
        depth: 0.85,
        bevelEnabled: false,
        curveSegments: 1,
      });
      expect(mesh.attributes.position.count).toBeGreaterThan(0);
      expect([...mesh.attributes.position.array].every(Number.isFinite)).toBe(
        true,
      );
      mesh.dispose();
    }
    const walls = roomWalls([room]);
    for (let index = 0; index < ring.length - 1; index++) {
      expect(walls[index].a).toEqual(ring[index]);
      expect(walls[index].b).toEqual(ring[index + 1]);
    }
    expect(JSON.stringify(data)).toBe(before);
  });

  it("deduplicates a shared wall even when only one room subdivides the boundary", () => {
    const walls = roomWalls(
      [
        feature("left", rectangle(0, 0, 4, 4)),
        feature("right", [
          [4, 0],
          [8, 0],
          [8, 4],
          [4, 4],
          [4, 2],
          [4, 0],
        ]),
      ],
      0.2,
    );
    const shared = walls.filter((wall) => wall.owners.length === 2);
    expect(shared).toHaveLength(2);
    expect(shared.map((wall) => [...wall.owners].sort())).toEqual([
      ["left", "right"],
      ["left", "right"],
    ]);
    expect(
      shared.reduce(
        (sum, wall) =>
          sum + Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]),
        0,
      ),
    ).toBeCloseTo(4);
    for (const wall of shared) {
      const xs = wall.polygon[0].map((point) => point[0]);
      expect(Math.min(...xs)).toBeCloseTo(3.9);
      expect(Math.max(...xs)).toBeCloseTo(4.1);
    }
    expect(surfaceArea(unionWalls(shared))).toBeCloseTo(0.8);
  });

  it("keeps unshared walls inside rooms without consuming adjacent corridors", () => {
    const room = feature("room", rectangle(0, 0, 4, 4));
    const before = JSON.stringify(room);
    const walls = unionWalls(roomWalls([room], 0.2));
    expect(
      polygonClipping.intersection(walls, [rectangle(4, 0, 6, 4)]),
    ).toEqual([]);
    expect(surfaceArea(walls)).toBeCloseTo(16 - 3.6 * 3.6);
    expect(JSON.stringify(room)).toBe(before);
  });

  it("preserves public-floor recesses for either polygon winding", () => {
    const lShape: XY[] = [
      [0, 0],
      [4, 0],
      [4, 2],
      [2, 2],
      [2, 4],
      [0, 4],
      [0, 0],
    ];
    const recess = [rectangle(2, 2, 4, 4)];
    for (const ring of [lShape, [...lShape].reverse()]) {
      const walls = unionWalls(roomWalls([feature("concave-room", ring)], 0.2));
      expect(polygonClipping.intersection(walls, recess)).toEqual([]);
      // Two inward wall strips must meet at their concave corner, rather than
      // touching at one point and leaving a square hole inside the room.
      const innerJoin = [rectangle(1.8, 1.8, 2, 2)];
      expect(
        surfaceArea(polygonClipping.intersection(walls, innerJoin)),
      ).toBeCloseTo(0.04);
      expect(surfaceArea(walls)).toBeCloseTo(3.04);
    }
  });

  it("places hole boundary walls on the room side without filling the opening", () => {
    const opening = rectangle(2, 2, 4, 4);
    const enclosed = feature("room-with-opening", rectangle(0, 0, 6, 6), {
      geometry: {
        type: "Polygon",
        coordinates: [rectangle(0, 0, 6, 6), [...opening].reverse()],
      },
    });
    const walls = unionWalls(roomWalls([enclosed], 0.2));
    expect(polygonClipping.intersection(walls, [opening])).toEqual([]);
  });

  it("does not turn corridor boundaries into walls or fill an existing gap", () => {
    const walls = roomWalls([
      feature("left", rectangle(0, 0, 4, 4)),
      feature("right", rectangle(6, 0, 10, 4)),
      feature("hall", rectangle(4, 0, 6, 4), { kind: "corridor" }),
    ]);
    expect(walls.every((wall) => !wall.owners.includes("hall"))).toBe(true);
    expect(
      polygonClipping.intersection(unionWalls(walls), [rectangle(4, 0, 6, 4)]),
    ).toEqual([]);
  });
});

describe("constant-width flight footprints", () => {
  it("preserves a rotated flight length, width, and original endpoint centers", () => {
    const ring = segmentRectangle([1, 2], [4, 6], 2);
    expect(Math.abs(area(ring))).toBeCloseTo(10);
    expect([
      (ring[0][0] + ring[3][0]) / 2,
      (ring[0][1] + ring[3][1]) / 2,
    ]).toEqual([1, 2]);
    expect([
      (ring[1][0] + ring[2][0]) / 2,
      (ring[1][1] + ring[2][1]) / 2,
    ]).toEqual([4, 6]);
    expect(
      Math.hypot(ring[0][0] - ring[3][0], ring[0][1] - ring[3][1]),
    ).toBeCloseTo(2);
    expect(segmentRectangle([1, 2], [1, 2], 2)).toEqual([]);
  });
});

describe("authored walls and public corridors", () => {
  function shafts() {
    const data = model([
      ...[0, 1].flatMap((ordinal) =>
        [0, 1].map((index) =>
          feature(
            `shaft-${index}-${ordinal}`,
            rectangle(index * 3, 0, index * 3 + 3, 3),
            {
              kind: "area",
              ordinal,
              levelRef: `${ordinal + 1}F`,
              connectionId: `lift-${index}`,
              tags: { "a11ymap:area_type": "elevator-shaft" },
            },
          ),
        ),
      ),
      feature("hall", rectangle(-1, -2, 7, 0), { kind: "corridor" }),
    ]);
    for (const index of [0, 1]) {
      const x = index * 3 + 1.5;
      data.nodes.push(
        {
          id: `approach-${index}`,
          point: [x, -1, 0],
          ordinal: 0,
          levelRef: "1F",
          kind: "path",
        },
        {
          id: `stop-${index}`,
          point: [x, 1, 0],
          ordinal: 0,
          levelRef: "1F",
          kind: "elevator",
        },
      );
      data.places.push({
        id: `place-${index}`,
        name: "Synthetic lift",
        kind: "elevator",
        nodeId: `stop-${index}`,
        point: [x, 1, 0],
        levelRef: "1F",
        connectionId: `lift-${index}`,
        routeEndpoint: "corridor",
        doorKnown: false,
        arrivalOnly: false,
        tags: {},
      });
      data.edges.push({
        id: `approach-${index}`,
        from: `approach-${index}`,
        to: `stop-${index}`,
        kind: "corridor",
        lengthM: 2,
        wheelchair: "yes",
        ramp: false,
        geometryStatus: "schematic",
        heightStatus: "estimated",
        osmRef: "synthetic",
        tags: {},
        heightPending: false,
      });
    }
    return data;
  }

  it("renders shaft backs and shared sides without closing the source approach side", () => {
    const data = shafts();
    const before = JSON.stringify(data);
    const { polygons } = wallGeometry(data, 0);
    expect(
      surfaceArea(
        polygonClipping.intersection(polygons, [rectangle(0, 2.88, 6, 3)]),
      ),
    ).toBeCloseTo(0.72);
    // A shared side has one 0.12m display wall, not two overlapping strips.
    expect(
      surfaceArea(
        polygonClipping.intersection(polygons, [rectangle(2.8, 0.2, 3.2, 2.8)]),
      ),
    ).toBeCloseTo(0.12 * 2.6);
    for (const x of [1.5, 4.5]) {
      expect(
        polygonClipping.intersection(polygons, [
          rectangle(x - 0.2, -1, x + 0.2, 1),
        ]),
      ).toEqual([]);
    }
    expect(
      polygonClipping.intersection(polygons, [rectangle(-1, -2, 7, 0)]),
    ).toEqual([]);
    expect(JSON.stringify(data)).toBe(before);
  });

  it("keeps the same shaft walls on a non-stopping floor using that shaft's known entry side", () => {
    const data = shafts();
    expect(wallGeometry(data, 1).polygons).toEqual(
      wallGeometry(data, 0).polygons,
    );
  });

  function apiShafts() {
    const data = shafts();
    data.connections = [0, 1].map((index) => ({
      id: `lift-${index}`,
      kind: "elevator",
      name: "Synthetic API lift",
      nodeIds: [`stop-${index}`],
      coordinates: [[index * 3 + 1.5, 1, 0]],
      levelRefs: ["1F"],
      wheelchair: "yes",
      geometryStatus: "schematic",
      heightStatus: "estimated",
      heightPending: false,
      tags: {},
      osmRef: "synthetic",
    }));
    data.places = [];
    return data;
  }

  it("uses source connection stops without requiring searchable elevator places", () => {
    const data = apiShafts();
    const before = JSON.stringify(data);
    const expected = wallGeometry(shafts(), 0).polygons;
    expect(expected.length).toBeGreaterThan(0);
    expect(wallGeometry(data, 0).polygons).toEqual(expected);
    // An upper shaft is visible even where this elevator does not stop. Its
    // entrance-side orientation comes from actual source stops on other floors.
    expect(wallGeometry(data, 1).polygons).toEqual(expected);
    expect(data.places).toEqual([]);
    expect(JSON.stringify(data)).toBe(before);
  });

  it("does not substitute unlinked place nodes for explicit source connection stops", () => {
    const data = shafts();
    data.connections = apiShafts().connections.map((connection) => ({
      ...connection,
      nodeIds: ["unresolved-source-stop"],
    }));
    // Existing place metadata cannot manufacture an approach when the source
    // explicitly points elsewhere. Legacy models without nodeIds still work.
    expect(wallGeometry(data, 0).polygons).toEqual([]);
  });

  it("does not infer a closed enclosure for unknown approaches or combined stair/elevator cores", () => {
    const data = shafts();
    data.edges = [];
    expect(wallGeometry(data, 0).polygons).toEqual([]);
    const core = shafts();
    for (const item of core.features)
      item.tags["a11ymap:area_type"] = "vertical-core";
    expect(wallGeometry(core, 0).polygons).toEqual([]);
  });

  it("retains a zero-thickness boundary between public areas at the exact source endpoints", () => {
    const data = model([
      feature("left-hall", rectangle(0, 0, 4, 4), { kind: "corridor" }),
      feature("right-hall", rectangle(4, 0, 8, 4), { kind: "corridor" }),
    ]);
    const a: XY = [4, 0.123456789],
      b: XY = [4, 3.987654321];
    data.walls = [
      { id: "divider", ordinal: 0, points: [a, b], tags: {} },
      { id: "duplicate", ordinal: 0, points: [b, a], tags: {} },
    ];
    const before = JSON.stringify(data);
    expect(wallGeometry(data, 0)).toEqual({
      polygons: [],
      boundaryWalls: [{ a, b }],
    });
    expect(JSON.stringify(data)).toBe(before);
    expect(wallGeometry(data, 1)).toEqual({ polygons: [], boundaryWalls: [] });
  });

  it("merges a source wall into the known room side without doubling or consuming the corridor", () => {
    const room = feature("room", rectangle(0, 0, 4, 4));
    const corridor = rectangle(4, 0, 6, 4);
    const data = model([room, feature("hall", corridor, { kind: "corridor" })]);
    data.walls = [
      {
        id: "authored-room-edge",
        ordinal: 0,
        points: [
          [4, 0],
          [4, 4],
        ],
        tags: {},
      },
    ];
    const result = wallGeometry(data, 0);
    expect(result.boundaryWalls).toEqual([]);
    expect(surfaceArea(result.polygons)).toBeCloseTo(
      surfaceArea(unionWalls(roomWalls([room]))),
    );
    expect(polygonClipping.intersection(result.polygons, [corridor])).toEqual(
      [],
    );
  });

  it("keeps the unknown continuation of a room boundary instead of dropping the authored wall", () => {
    const corridor = rectangle(4, 0, 6, 6);
    const data = model([
      feature("room", rectangle(0, 0, 4, 4)),
      feature("hall", corridor, { kind: "corridor" }),
    ]);
    data.walls = [
      {
        id: "extended-edge",
        ordinal: 0,
        points: [
          [4, 0],
          [4, 6],
        ],
        tags: {},
      },
    ];
    const result = wallGeometry(data, 0);
    expect(result.boundaryWalls).toEqual([{ a: [4, 4], b: [4, 6] }]);
    expect(polygonClipping.intersection(result.polygons, [corridor])).toEqual(
      [],
    );
  });

  it("retains an explicit interior partition even though it is not a room polygon boundary", () => {
    const room = feature("room", rectangle(0, 0, 6, 6));
    const data = model([room]);
    data.walls = [
      {
        id: "interior",
        ordinal: 0,
        points: [
          [3, 0],
          [3, 6],
        ],
        tags: {},
      },
    ];
    const result = wallGeometry(data, 0);
    expect(result.boundaryWalls).toEqual([]);
    expect(surfaceArea(result.polygons)).toBeGreaterThan(
      surfaceArea(unionWalls(roomWalls([room]))),
    );
    expect(
      surfaceArea(
        polygonClipping.intersection(result.polygons, [
          rectangle(2.9, 2, 3.1, 4),
        ]),
      ),
    ).toBeCloseTo(0.18);
  });
});

describe("labelAnchor", () => {
  it("keeps a label inside an L-shaped room whose centroid falls outside", () => {
    const room: XY[] = [
      [0, 0],
      [10, 0],
      [10, 1],
      [1, 1],
      [1, 10],
      [0, 10],
      [0, 0],
    ];
    const [x, y] = labelAnchor([room]);
    expect(inside(centroid(room), [room])).toBe(false);
    expect(inside([x, y], [room])).toBe(true);
  });

  it("uses the centroid of a plain rectangle", () => {
    const room: XY[] = [
      [0, 0],
      [4, 0],
      [4, 2],
      [0, 2],
      [0, 0],
    ];
    expect(labelAnchor([room])).toEqual([2, 1]);
  });
});
