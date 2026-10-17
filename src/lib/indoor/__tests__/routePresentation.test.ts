import { describe, expect, it } from "vitest";
import { pathDistance, planIndoorRoute, samplePath } from "../route";
import {
  routeEndpointFeatureIds,
  sampleRoutePresentation,
} from "../routePresentation";
import type {
  IndoorEdge,
  IndoorFeature,
  IndoorRoute,
  LocalIndoorModel,
  XYZ,
} from "../types";

function model(points: XYZ[], levels: (string | null)[]): LocalIndoorModel {
  return {
    schemaVersion: 1,
    venueId: "synthetic",
    name: "Synthetic route presentation",
    source: { sha256: "test", generatedAt: "test", warnings: [] },
    origin: [0, 0],
    building: {
      id: "building",
      name: "Building",
      footprint: [],
      levels: Array.from({ length: 5 }, (_, i) => ({
        ordinal: i,
        ref: `L${i}`,
        elevationM: i * 4,
      })),
      floorHeightM: 4,
      heightStatus: "estimated",
      geometryStatus: "schematic",
    },
    features: [],
    connections: [],
    edges: [],
    walls: [],
    nodes: points.map((point, i) => ({
      id: `n${i}`,
      point,
      ordinal: null,
      levelRef: levels[i],
      kind: "path",
    })),
    places: points.map((point, i) => ({
      id: `p${i}`,
      name: `Place ${i}`,
      kind: "poi",
      point,
      nodeId: `n${i}`,
      levelRef: levels[i],
      routeEndpoint: "corridor",
      doorKnown: false,
      arrivalOnly: true,
      tags: {},
    })),
  };
}

function edge(from: number, overrides: Partial<IndoorEdge> = {}): IndoorEdge {
  return {
    id: `walk:${from}@0`,
    from: `n${from}`,
    to: `n${from + 1}`,
    osmRef: "way/walk",
    kind: "corridor",
    lengthM: 1,
    wheelchair: "yes",
    ramp: false,
    heightPending: false,
    geometryStatus: "schematic",
    heightStatus: "estimated",
    tags: {},
    ...overrides,
  };
}

function plan(
  data: LocalIndoorModel,
  to = data.places.length - 1,
): IndoorRoute {
  const result = planIndoorRoute(data, "p0", `p${to}`, "normal");
  if (!result.ok) throw new Error(result.reason);
  return result;
}

function stairsFixture() {
  const points: XYZ[] = [
    [0, 0, 0],
    [2, 0, 0],
    [4, 0, 2],
    [4, 3, 2],
    [6, 3, 4],
    [9, 3, 4],
  ];
  const data = model(points, ["L0", "L0", null, null, "L1", "L1"]);
  data.edges = points.slice(1).map((_, i) =>
    edge(
      i,
      i >= 1 && i <= 3
        ? {
            id: `rise:${i - 1}@span`,
            osmRef: "way/rise",
            kind: "steps",
            tags: { name: "Same display name" },
          }
        : {},
    ),
  );
  data.connections = [
    {
      id: "way/rise@span",
      osmRef: "way/rise",
      kind: "stairs",
      name: "Source stair connection",
      coordinates: points.slice(1, 5),
      levelRefs: ["L0", null, null, "L1"],
      tags: {},
      wheelchair: "no",
      geometryStatus: "schematic",
      heightStatus: "estimated",
      heightPending: false,
    },
  ];
  return { data, route: plan(data) };
}

function fractionAt(route: IndoorRoute, index: number): number {
  return pathDistance(route.points.slice(0, index + 1)) / route.distanceM;
}

describe("single-floor route presentation", () => {
  it("keeps the departure floor across flights and a horizontal landing in either direction", () => {
    const { data, route } = stairsFixture();
    expect(route.steps[1]).toMatchObject({
      connectionId: "way/rise@span",
      startIndex: 1,
      endIndex: 4,
      fromLevel: "L0",
      toLevel: "L1",
    });
    const landingProgress =
      (pathDistance(route.points.slice(0, 3)) + 1.5) / route.distanceM;
    for (const progress of [
      0.2,
      landingProgress,
      fractionAt(route, 4) - 1e-8,
    ]) {
      const forward = sampleRoutePresentation(data, route, progress, 1);
      const reverse = sampleRoutePresentation(data, route, progress, -1);
      expect(forward.position).toEqual(samplePath(route.points, progress));
      expect(reverse.position).toEqual(forward.position);
      expect(forward.currentLevelRef).toBe("L0");
      expect(reverse.currentLevelRef).toBe("L1");
      expect(forward.transition).toEqual({
        kind: "steps",
        name: "Source stair connection",
        fromLevel: "L0",
        toLevel: "L1",
        connectionId: "way/rise@span",
      });
      expect(reverse.transition).toMatchObject({
        fromLevel: "L1",
        toLevel: "L0",
      });
    }
    const landing = sampleRoutePresentation(
      data,
      route,
      landingProgress,
      1,
    ).position;
    expect(landing[0]).toBe(4);
    expect(landing[1]).toBeCloseTo(1.5, 12);
    expect(landing[2]).toBe(2);
  });

  it("chooses the next step in travel direction at the precise stair boundaries", () => {
    const { data, route } = stairsFixture();
    const lower = fractionAt(route, 1);
    const upper = fractionAt(route, 4);
    expect(
      sampleRoutePresentation(data, route, lower, 1).transition?.toLevel,
    ).toBe("L1");
    expect(sampleRoutePresentation(data, route, lower, -1)).toMatchObject({
      currentLevelRef: "L0",
      activeConnectionId: null,
      transition: null,
    });
    expect(sampleRoutePresentation(data, route, upper, 1)).toMatchObject({
      currentLevelRef: "L1",
      activeConnectionId: null,
      transition: null,
    });
    expect(
      sampleRoutePresentation(data, route, upper, -1).transition,
    ).toMatchObject({
      fromLevel: "L1",
      toLevel: "L0",
    });
  });

  it("has correct departure and completion semantics for vertical-only routes", () => {
    const { data } = stairsFixture();
    const result = planIndoorRoute(data, "p1", "p4", "normal");
    if (!result.ok) throw new Error(result.reason);
    expect(
      sampleRoutePresentation(data, result, 0, 1).transition?.fromLevel,
    ).toBe("L0");
    expect(
      sampleRoutePresentation(data, result, 1, -1).transition?.fromLevel,
    ).toBe("L1");
    expect(sampleRoutePresentation(data, result, 1, 1)).toMatchObject({
      currentLevelRef: "L1",
      activeConnectionId: null,
      transition: null,
    });
    expect(sampleRoutePresentation(data, result, 0, -1)).toMatchObject({
      currentLevelRef: "L0",
      activeConnectionId: null,
      transition: null,
    });
    expect(sampleRoutePresentation(data, result, -5, -1).position).toEqual(
      result.points[0],
    );
    expect(sampleRoutePresentation(data, result, 5, 1).position).toEqual(
      result.points.at(-1),
    );
  });

  it("never invents elevator stops from crossed floor heights or display names", () => {
    const data = model(
      [
        [0, 0, 0],
        [0, 0, 16],
      ],
      ["L0", "L4"],
    );
    data.edges = [
      edge(0, {
        id: "elevator/lift:0-4",
        osmRef: "node/lift",
        kind: "elevator",
        levelSpan: 4,
        tags: { name: "Shared elevator name" },
      }),
    ];
    data.connections = ["wrong", "lift"].map((id) => ({
      id: `node/${id}`,
      osmRef: `node/${id}`,
      kind: "elevator",
      name: "Shared elevator name",
      coordinates: data.nodes.map((n) => n.point),
      levelRefs: ["L0", "L4"],
      tags: {},
      wheelchair: "yes",
      geometryStatus: "schematic",
      heightStatus: "estimated",
      heightPending: false,
    }));
    const route = plan(data);
    expect(route.steps[0].connectionId).toBe("node/lift");
    for (const progress of [0.25, 0.5, 0.75, 0.999999]) {
      const forward = sampleRoutePresentation(data, route, progress, 1);
      const reverse = sampleRoutePresentation(data, route, progress, -1);
      expect(forward.currentLevelRef).toBe("L0");
      expect(reverse.currentLevelRef).toBe("L4");
      expect(forward.transition).toMatchObject({
        kind: "elevator",
        fromLevel: "L0",
        toLevel: "L4",
      });
      expect(reverse.transition).toMatchObject({
        fromLevel: "L4",
        toLevel: "L0",
      });
      expect(reverse.position).toEqual(forward.position);
    }
  });

  it("keeps adjacent source spans distinct even with the same name and OSM reference", () => {
    const data = model(
      [
        [0, 0, 0],
        [1, 0, 4],
        [2, 0, 8],
      ],
      ["L0", "L1", "L2"],
    );
    data.edges = [0, 1].map((i) =>
      edge(i, {
        id: `repeated:0@${i}`,
        osmRef: "way/repeated",
        kind: "steps",
        tags: { name: "One name" },
      }),
    );
    data.connections = [0, 1].map((i) => ({
      id: `way/repeated@${i}`,
      osmRef: "way/repeated",
      kind: "stairs",
      name: "One name",
      coordinates: data.nodes.slice(i, i + 2).map((n) => n.point),
      levelRefs: [`L${i}`, `L${i + 1}`],
      tags: {},
      wheelchair: "no",
      geometryStatus: "schematic",
      heightStatus: "estimated",
      heightPending: false,
    }));
    const route = plan(data);
    expect(route.steps.map((s) => s.connectionId)).toEqual([
      "way/repeated@0",
      "way/repeated@1",
    ]);
    expect(sampleRoutePresentation(data, route, 0.5, 1)).toMatchObject({
      currentLevelRef: "L1",
      activeConnectionId: "way/repeated@1",
      transition: { fromLevel: "L1", toLevel: "L2" },
    });
    expect(sampleRoutePresentation(data, route, 0.5, -1)).toMatchObject({
      currentLevelRef: "L1",
      activeConnectionId: "way/repeated@0",
      transition: { fromLevel: "L1", toLevel: "L0" },
    });
  });

  it("does not infer unknown levels from Z and preserves an outdoor endpoint's null floor", () => {
    const data = model(
      [
        [0, 0, 0],
        [0, 0, 4],
      ],
      [null, "L1"],
    );
    data.edges = [edge(0, { kind: "steps" })];
    const route = plan(data);
    expect(sampleRoutePresentation(data, route, 0.75, 1)).toMatchObject({
      currentLevelRef: null,
      transition: null,
    });
    expect(sampleRoutePresentation(data, route, 0.25, -1)).toMatchObject({
      currentLevelRef: "L1",
      transition: null,
    });
    expect(
      sampleRoutePresentation(data, route, 0, -1).currentLevelRef,
    ).toBeNull();
    data.nodes[0].levelRef = "L0";
    const graphFloorRoute = plan(data);
    expect(
      sampleRoutePresentation(data, graphFloorRoute, 0, 1).currentLevelRef,
    ).toBeNull();
  });

  it("handles one-point routes and does not mutate route geometry or source data", () => {
    const data = model([[1, 2, 4]], ["L1"]);
    const route = plan(data, 0);
    const original = JSON.stringify({ data, route });
    for (const direction of [1, -1] as const) {
      const result = sampleRoutePresentation(data, route, 0.5, direction);
      expect(result).toEqual({
        position: [1, 2, 4],
        currentLevelRef: "L1",
        activeConnectionId: null,
        transition: null,
      });
      result.position[0] = 999;
    }
    expect(JSON.stringify({ data, route })).toBe(original);
    expect(() => sampleRoutePresentation(data, route, Number.NaN, 1)).toThrow(
      RangeError,
    );
  });
});

function room(
  id: string,
  levelRef: string | null,
  overrides: Partial<IndoorFeature> = {},
): IndoorFeature {
  return {
    id,
    levelRef,
    ordinal: null,
    kind: "room",
    tags: {},
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [20, 20],
          [21, 20],
          [21, 21],
          [20, 20],
        ],
      ],
    },
    geometryStatus: "schematic",
    heightStatus: "estimated",
    ...overrides,
  };
}

describe("canonical route endpoint features", () => {
  it("maps room refs only on the same floor without moving corridor arrival points", () => {
    const data = model(
      [
        [0, 0, 0],
        [2, 0, 0],
      ],
      ["L0", "L0"],
    );
    data.places[0].ref = "R1";
    data.places[1].ref = "R2";
    data.features = [
      room("room1", "L0", { ref: "R1" }),
      room("room2", "L0", { ref: "R2" }),
      room("upstairs", "L1", { ref: "R1" }),
    ];
    data.edges = [edge(0)];
    const route = plan(data);
    const before = JSON.stringify({ data, route });
    expect(routeEndpointFeatureIds(data, route)).toEqual({
      fromFeatureId: "room1",
      toFeatureId: "room2",
    });
    expect(JSON.stringify({ data, route })).toBe(before);
  });

  it("supports exact source identity, exact names and shared landing connection refs", () => {
    const data = model(
      [
        [0, 0, 0],
        [2, 0, 4],
      ],
      ["L0", "L1"],
    );
    data.features = [
      room("p0", "L0"),
      room("core", "L1", {
        kind: "area",
        displayKind: "stairs",
        connectionId: "span-up",
      }),
    ];
    data.places[1].connectionId = "span-down";
    data.places[1].connectionIds = ["span-down", "span-up"];
    const ends = { fromPlaceId: "p0", toPlaceId: "p1" };
    expect(routeEndpointFeatureIds(data, ends)).toEqual({
      fromFeatureId: "p0",
      toFeatureId: "core",
    });
    data.features[0].id = "room-source";
    data.features[0].name = "Quiet room";
    data.places[0].name = " Quiet   room ";
    expect(routeEndpointFeatureIds(data, ends).fromFeatureId).toBe(
      "room-source",
    );
    data.places[0].name = "Quiet";
    expect(routeEndpointFeatureIds(data, ends).fromFeatureId).toBeNull();
  });

  it("fails closed for ambiguous, missing and unknown-floor endpoint matches", () => {
    const data = model(
      [
        [0, 0, 0],
        [2, 0, 0],
      ],
      ["L0", null],
    );
    data.places[0].ref = "duplicate";
    data.features = [
      room("first", "L0", { ref: "duplicate" }),
      room("second", "L0", { ref: "duplicate" }),
      room("p1", null),
    ];
    expect(
      routeEndpointFeatureIds(data, { fromPlaceId: "p0", toPlaceId: "p1" }),
    ).toEqual({ fromFeatureId: null, toFeatureId: null });
    expect(
      routeEndpointFeatureIds(data, { fromPlaceId: "missing", toPlaceId: "p1" })
        .fromFeatureId,
    ).toBeNull();
  });
});
