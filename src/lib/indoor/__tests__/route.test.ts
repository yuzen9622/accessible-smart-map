import { describe, expect, it } from "vitest";
import { pathDistance, planIndoorRoute, samplePath } from "../route";
import type {
  IndoorEdge,
  IndoorNode,
  IndoorStairDesign,
  LocalIndoorModel,
  XYZ,
} from "../types";

function node(id: string, point: XYZ, ordinal: number | null = 0): IndoorNode {
  return {
    id,
    point,
    ordinal,
    levelRef: ordinal === null ? null : `${ordinal + 1}F`,
    kind: "path",
  };
}

function edge(
  id: string,
  from: string,
  to: string,
  overrides: Partial<IndoorEdge> = {},
): IndoorEdge {
  return {
    id,
    from,
    to,
    kind: "corridor",
    lengthM: 1,
    wheelchair: "yes",
    ramp: false,
    heightPending: false,
    geometryStatus: "schematic",
    heightStatus: "estimated",
    tags: {},
    osmRef: `way/${id}`,
    ...overrides,
  };
}

function model(nodes: IndoorNode[], edges: IndoorEdge[]): LocalIndoorModel {
  return {
    schemaVersion: 1,
    venueId: "synthetic",
    name: "Synthetic test geometry",
    origin: [0, 0],
    source: { sha256: "test", generatedAt: "test", warnings: [] },
    building: {
      id: "test",
      name: "Test",
      footprint: [],
      levels: [],
      floorHeightM: 4,
      heightStatus: "estimated",
      geometryStatus: "schematic",
    },
    nodes,
    edges,
    features: [],
    connections: [],
    walls: [],
    places: nodes.map((n) => ({
      id: n.id,
      name: n.id,
      kind: "room",
      nodeId: n.id,
      point: n.point,
      levelRef: n.levelRef,
      routeEndpoint: "corridor",
      doorKnown: false,
      arrivalOnly: true,
      tags: {},
    })),
  };
}

describe("local graph routing", () => {
  it("uses authored corridor nodes as room endpoints without extending into a room", () => {
    const data = model(
      [
        node("start", [0, 0, 0]),
        node("corner", [3, 0, 0]),
        node("arrival", [3, 4, 0]),
      ],
      [edge("a", "start", "corner"), edge("b", "corner", "arrival")],
    );
    // Display-only room center is deliberately far from its arrival graph node.
    data.places[2].point = [20, 20, 0];
    const result = planIndoorRoute(data, "start", "arrival", "normal");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.points).toEqual([
      [0, 0, 0],
      [3, 0, 0],
      [3, 4, 0],
    ]);
    expect(result.distanceM).toBe(7);
    expect(result.kinds).toEqual(["corridor", "corridor"]);
    expect(result.warnings.some((w) => w.includes("走廊到達點"))).toBe(true);
  });

  it("chooses a shortest connected route and traverses it backwards", () => {
    const data = model(
      [
        node("a", [0, 0, 0]),
        node("b", [2, 0, 0]),
        node("c", [4, 0, 0]),
        node("detour", [0, 10, 0]),
      ],
      [
        edge("ab", "a", "b"),
        edge("bc", "b", "c"),
        edge("ad", "a", "detour"),
        edge("dc", "detour", "c"),
      ],
    );
    const forward = planIndoorRoute(data, "a", "c", "normal");
    const reverse = planIndoorRoute(data, "c", "a", "normal");
    expect(forward.ok && forward.edgeIds).toEqual(["ab", "bc"]);
    expect(reverse.ok && reverse.points).toEqual(
      forward.ok && [...forward.points].reverse(),
    );
  });

  it("excludes stairs and escalators for wheelchair routes even if tagged yes", () => {
    const data = model(
      [node("lower", [0, 0, 0]), node("upper", [0, 0, 4], 1)],
      [
        edge("steps", "lower", "upper", { kind: "steps", wheelchair: "yes" }),
        edge("escalator", "lower", "upper", {
          kind: "escalator",
          wheelchair: "yes",
        }),
      ],
    );
    expect(planIndoorRoute(data, "lower", "upper", "wheelchair")).toEqual({
      ok: false,
      reason: "NO_ACCESSIBLE_ROUTE",
    });
    expect(planIndoorRoute(data, "lower", "upper", "normal").ok).toBe(true);
    data.edges.push(
      edge("lift", "lower", "upper", { kind: "elevator", levelSpan: 1 }),
    );
    const result = planIndoorRoute(data, "lower", "upper", "wheelchair");
    expect(result.ok && result.kinds).toEqual(["elevator"]);
    expect(result.ok && result.distanceM).toBe(4);
  });

  it("never adds a stop on an intermediate floor of an elevator shaft", () => {
    const data = model(
      [
        node("floor1", [0, 0, 0]),
        node("floor2", [0, 0, 4], 1),
        node("floor3", [0, 0, 8], 2),
      ],
      [edge("lift13", "floor1", "floor3", { kind: "elevator", levelSpan: 2 })],
    );
    expect(planIndoorRoute(data, "floor1", "floor3", "wheelchair").ok).toBe(
      true,
    );
    expect(planIndoorRoute(data, "floor1", "floor2", "wheelchair").ok).toBe(
      false,
    );
  });

  it("keeps a height-pending connection routable but blocks 3D animation", () => {
    const data = model(
      [node("upper", [0, 0, 0]), node("outdoor", [5, 0, 0])],
      [edge("ramp", "upper", "outdoor", { ramp: true, heightPending: true })],
    );
    const result = planIndoorRoute(data, "upper", "outdoor", "wheelchair");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.animationSafe).toBe(false);
    expect(result.steps[0].heightPending).toBe(true);
    expect(result.warnings.some((w) => w.includes("高差待量測"))).toBe(true);
  });

  it("blocks animation when the ascent side is unconfirmed", () => {
    const data = model(
      [node("a", [0, 0, 0]), node("b", [1, 0, 4], 1)],
      [edge("stairs", "a", "b", { kind: "steps", animationPending: true })],
    );
    const result = planIndoorRoute(data, "a", "b", "normal");
    expect(result.ok && result.animationSafe).toBe(false);
  });

  it("rejects known narrow, steep or prohibited wheelchair routes", () => {
    for (const restriction of [
      { widthM: 0.89 },
      { slopeRatio: 0.121 },
      { wheelchair: "no" as const },
    ]) {
      const data = model(
        [node("a", [0, 0, 0]), node("b", [1, 0, 0])],
        [edge("ab", "a", "b", restriction)],
      );
      expect(planIndoorRoute(data, "a", "b", "wheelchair").ok).toBe(false);
    }
  });

  it("handles same-place, missing-place and disconnected graph cases", () => {
    const data = model([node("a", [1, 2, 0]), node("b", [2, 3, 0])], []);
    expect(planIndoorRoute(data, "a", "missing", "normal")).toEqual({
      ok: false,
      reason: "UNKNOWN_PLACE",
    });
    expect(planIndoorRoute(data, "a", "b", "normal")).toEqual({
      ok: false,
      reason: "NO_ROUTE",
    });
    const same = planIndoorRoute(data, "a", "a", "normal");
    expect(same.ok && same.points).toEqual([[1, 2, 0]]);
    expect(same.ok && same.distanceM).toBe(0);
  });
});

describe("piecewise linear 3D playback", () => {
  const points: XYZ[] = [
    [0, 0, 0],
    [3, 0, 4],
    [3, 2, 4],
    [3, 5, 8],
  ];

  it("rises along flights and stays level while crossing the landing", () => {
    expect(pathDistance(points)).toBe(12);
    expect(samplePath(points, 2.5 / 12)).toEqual([1.5, 0, 2]);
    expect(samplePath(points, 5 / 12)).toEqual([3, 0, 4]);
    expect(samplePath(points, 6 / 12)).toEqual([3, 1, 4]);
    expect(samplePath(points, 7 / 12)).toEqual([3, 2, 4]);
    expect(samplePath(points, 9.5 / 12)).toEqual([3, 3.5, 6]);
  });

  it("reverses the same path without smoothing across the platform corner", () => {
    for (const progress of [0, 0.2, 0.5, 0.8, 1]) {
      expect(samplePath(points, progress, true)).toEqual(
        samplePath(points, 1 - progress),
      );
    }
    expect(samplePath(points, 0, true)).toEqual(points[3]);
    expect(samplePath(points, 1, true)).toEqual(points[0]);
  });

  it("handles duplicate points and bounds while rejecting invalid inputs", () => {
    expect(
      samplePath(
        [
          [1, 2, 3],
          [1, 2, 3],
        ],
        0.5,
      ),
    ).toEqual([1, 2, 3]);
    expect(samplePath(points, -1)).toEqual(points[0]);
    expect(samplePath(points, 2)).toEqual(points[3]);
    expect(() => samplePath([], 0)).toThrow(RangeError);
    expect(() => samplePath(points, Number.NaN)).toThrow(RangeError);
  });
});

function candidateModel() {
  const data = model(
    [
      node("before", [-2, 0, 0]),
      node("lower", [0, 0, 0]),
      node("middle", [0, 2, 1], null),
      node("upper", [0, 4, 2], 1),
      node("after", [2, 4, 2], 1),
    ],
    [
      edge("approach", "before", "lower"),
      edge("flight-a@span", "lower", "middle", {
        kind: "steps",
        osmRef: "way/stair",
      }),
      edge("flight-b@span", "middle", "upper", {
        kind: "steps",
        osmRef: "way/stair",
      }),
      edge("departure", "upper", "after"),
    ],
  );
  const sourcePath: XYZ[] = [
    [0, 0, 0],
    [0, 2, 1],
    [0, 4, 2],
  ];
  data.connections = [
    {
      id: "way/stair@span",
      kind: "stairs",
      name: "Synthetic stair",
      coordinates: sourcePath,
      levelRefs: ["1F", null, "2F"],
      wheelchair: "no",
      geometryStatus: "schematic",
      heightStatus: "estimated",
      heightPending: false,
      tags: {},
      osmRef: "way/stair",
    },
  ];
  const design: IndoorStairDesign = {
    schemaVersion: 1,
    id: "candidate-one",
    name: "Synthetic research candidate",
    status: "schematic",
    sourceSha256: "test",
    sourceConnectionId: "way/stair@span",
    sourcePath: sourcePath.map((point) => [...point]),
    sourceCore: [],
    sourceElevatorPoint: [0, 0, 0],
    dimensions: {
      floorHeightM: 2,
      flightTotalWidthM: 1,
      flightClearWidthM: 1,
      risers: [2, 2],
      riserHeightM: 0.5,
      platformM: [1],
      carInsideM: { depth: 1, width: 1 },
      shaftInsideM: { depth: 1, width: 1 },
      shaftOutsideM: { depth: 1, width: 1 },
      shaftWallAssumptionM: 0.1,
      carDoorClearM: 1,
    },
    shaft: {
      polygon: [],
      innerPolygon: [],
      carPolygon: [],
      baseM: 0,
      heightM: 2,
      door: { segment: [], widthM: 1, facing: "test", status: "schematic" },
    },
    flights: [],
    platforms: [],
    steps: [],
    animationPath: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 2, 1],
      [1, 3, 1],
      [1, 4, 2],
      [0, 4, 2],
    ],
    animationSegments: [],
    conflicts: [],
    verification: {
      roomToiletOverlapCount: 0,
      shaftOverlapAreaM2: 0,
      outsideCoreAreaM2: 0,
      sourceEndpointsPreserved: true,
      riserSumM: 2,
      platformCount: 1,
      checkLimits: "Synthetic route replacement test only",
    },
    assumptions: [],
    sources: [],
  };
  data.stairDesign = design;
  return { data, design };
}

describe("named research stair route geometry", () => {
  it("replaces the complete forward stair run and recomputes segment/step distances", () => {
    const { data, design } = candidateModel();
    const route = planIndoorRoute(data, "before", "after", "normal");
    expect(route.ok).toBe(true);
    if (!route.ok) return;
    expect(route.points).toEqual([
      [-2, 0, 0],
      ...design.animationPath,
      [2, 4, 2],
    ]);
    expect(route.kinds).toEqual([
      "corridor",
      ...Array(5).fill("steps"),
      "corridor",
    ]);
    expect(route.researchCandidateId).toBe(design.id);
    expect(route.animationSafe).toBe(true);
    expect(route.distanceM).toBeCloseTo(4 + pathDistance(design.animationPath));
    expect(
      route.steps.map((step) => [
        step.kind,
        step.startIndex,
        step.endIndex,
        step.fromLevel,
        step.toLevel,
      ]),
    ).toEqual([
      ["corridor", 0, 1, "1F", "1F"],
      ["steps", 1, 6, "1F", "2F"],
      ["corridor", 6, 7, "2F", "2F"],
    ]);
    expect(route.steps[1].distanceM).toBeCloseTo(
      pathDistance(design.animationPath),
    );
    expect(
      route.steps.reduce((sum, step) => sum + step.distanceM, 0),
    ).toBeCloseTo(route.distanceM);
    expect(
      route.warnings.some((warning) => warning.includes("研究假設版")),
    ).toBe(true);
    expect(route.edgeIds).toEqual([
      "approach",
      "flight-a@span",
      "flight-b@span",
      "departure",
    ]);
  });

  it("uses the exact reversed candidate with corridor suffix/prefix preserved", () => {
    const { data } = candidateModel();
    const forward = planIndoorRoute(data, "before", "after", "normal");
    const reverse = planIndoorRoute(data, "after", "before", "normal");
    expect(forward.ok && reverse.ok).toBe(true);
    if (!forward.ok || !reverse.ok) return;
    expect(reverse.points).toEqual([...forward.points].reverse());
    expect(reverse.distanceM).toBeCloseTo(forward.distanceM);
    expect(
      reverse.steps.map((step) => [step.startIndex, step.endIndex]),
    ).toEqual([
      [0, 1],
      [1, 6],
      [6, 7],
    ]);
    expect(reverse.steps[1].fromLevel).toBe("2F");
    expect(reverse.steps[1].toLevel).toBe("1F");
  });

  it("does not mutate source graph, connection or candidate, including through returned points", () => {
    const { data } = candidateModel();
    const original = JSON.stringify(data);
    const route = planIndoorRoute(data, "lower", "upper", "normal");
    expect(route.ok).toBe(true);
    if (route.ok) route.points[1][0] = 999;
    expect(JSON.stringify(data)).toBe(original);
  });

  it("blocks animation for a partial source run without adding a connecting segment", () => {
    const { data } = candidateModel();
    const route = planIndoorRoute(data, "lower", "middle", "normal");
    expect(route.ok).toBe(true);
    if (!route.ok) return;
    expect(route.points).toEqual([
      [0, 0, 0],
      [0, 2, 1],
    ]);
    expect(route.animationSafe).toBe(false);
    expect(route.researchCandidateId).toBeUndefined();
    expect(route.kinds).toEqual(["steps"]);
  });

  it("rejects changed source, mismatched endpoints, malformed candidates and stale SHA", () => {
    const mutations = [
      (d: IndoorStairDesign) => {
        d.sourceSha256 = "stale";
      },
      (d: IndoorStairDesign) => {
        d.sourcePath[1][0] = 99;
      },
      (d: IndoorStairDesign) => {
        d.animationPath[0][0] = 0.5;
      },
      (d: IndoorStairDesign) => {
        d.animationPath[2][2] = Number.NaN;
      },
      (d: IndoorStairDesign) => {
        d.animationPath = [];
      },
      (d: IndoorStairDesign) => {
        d.conflicts.push({ unresolved: true });
      },
    ];
    for (const mutate of mutations) {
      const { data, design } = candidateModel();
      mutate(design);
      const route = planIndoorRoute(data, "lower", "upper", "normal");
      expect(route.ok).toBe(true);
      if (!route.ok) continue;
      expect(route.points).toEqual([
        [0, 0, 0],
        [0, 2, 1],
        [0, 4, 2],
      ]);
      expect(route.animationSafe).toBe(false);
      expect(route.researchCandidateId).toBeUndefined();
    }
  });

  it("does not stitch separated source edge runs through an unrelated corridor", () => {
    const { data } = candidateModel();
    data.nodes.push(node("branch", [1, 2, 1], null));
    const secondFlight = data.edges.find(
      (candidate) => candidate.id === "flight-b@span",
    );
    if (!secondFlight) throw new Error("Synthetic second flight missing");
    secondFlight.from = "branch";
    data.edges.push(edge("detour", "middle", "branch"));
    const route = planIndoorRoute(data, "lower", "upper", "normal");
    expect(route.ok).toBe(true);
    if (!route.ok) return;
    expect(route.points).toEqual([
      [0, 0, 0],
      [0, 2, 1],
      [1, 2, 1],
      [0, 4, 2],
    ]);
    expect(route.animationSafe).toBe(false);
    expect(route.researchCandidateId).toBeUndefined();
  });

  it("leaves wheelchair elevator routes and unrelated walking routes untouched", () => {
    const { data } = candidateModel();
    data.edges.push(edge("lift", "lower", "upper", { kind: "elevator" }));
    const route = planIndoorRoute(data, "lower", "upper", "wheelchair");
    expect(route.ok).toBe(true);
    if (!route.ok) return;
    expect(route.points).toEqual([
      [0, 0, 0],
      [0, 4, 2],
    ]);
    expect(route.kinds).toEqual(["elevator"]);
    expect(route.researchCandidateId).toBeUndefined();
    expect(route.animationSafe).toBe(true);
    const walking = planIndoorRoute(data, "before", "lower", "normal");
    expect(walking.ok && walking.points).toEqual([
      [-2, 0, 0],
      [0, 0, 0],
    ]);
  });

  it("requires a complete physical candidate when the preview gates stair animation", () => {
    const { data, design } = candidateModel();
    data.preview = { levels: [0, 1], requirePhysicalStairs: true };
    data.stairDesign = undefined;
    const sourceOnly = planIndoorRoute(data, "lower", "upper", "normal");
    expect(sourceOnly.ok && sourceOnly.animationSafe).toBe(false);
    expect(sourceOnly.ok && sourceOnly.points).toEqual([
      [0, 0, 0],
      [0, 2, 1],
      [0, 4, 2],
    ]);
    expect(
      sourceOnly.ok &&
        sourceOnly.warnings.some((warning) => warning.includes("實體踏面")),
    ).toBe(true);
    data.stairDesign = design;
    const candidate = planIndoorRoute(data, "lower", "upper", "normal");
    expect(candidate.ok && candidate.animationSafe).toBe(true);
    const unrelated = model(
      [node("a", [10, 0, 0]), node("b", [10, 4, 2], 1)],
      [edge("other-stair", "a", "b", { kind: "steps" })],
    );
    unrelated.stairDesign = design;
    unrelated.connections = data.connections;
    unrelated.preview = data.preview;
    const notModeled = planIndoorRoute(unrelated, "a", "b", "normal");
    expect(notModeled.ok && notModeled.animationSafe).toBe(false);
    expect(notModeled.ok && notModeled.kinds).toEqual(["steps"]);
  });
});

describe("vertical routing preference", () => {
  it.each(["wheelchair", "elderly", "visual_impaired"] as const)(
    "%s requires an elevator even when a caller explicitly asks for stairs",
    (mode) => {
      const data = model(
        [
          node("lower", [0, 0, 0]),
          node("landing", [5, 0, 2]),
          node("upper", [0, 0, 4], 1),
        ],
        [
          edge("first-flight", "lower", "landing", { kind: "steps" }),
          edge("second-flight", "landing", "upper", { kind: "steps" }),
          edge("lift", "lower", "upper", { kind: "elevator" }),
        ],
      );
      const source = structuredClone(data);
      const normal = planIndoorRoute(data, "lower", "upper", "normal");
      expect(normal.ok && normal.kinds).toEqual(["steps", "steps"]);
      for (const preference of [undefined, "auto"] as const) {
        const result = planIndoorRoute(data, "lower", "upper", mode, {
          verticalPreference: preference,
        });
        expect(result.ok && result.kinds).toEqual(["elevator"]);
        expect(result.ok && result.distanceM).toBe(4);
      }
      const explicitStairs = planIndoorRoute(data, "lower", "upper", mode, {
        verticalPreference: "stairs",
      });
      expect(explicitStairs.ok && explicitStairs.kinds).toEqual(["elevator"]);
      expect(data).toEqual(source);
    },
  );

  it.each(["wheelchair", "elderly", "visual_impaired"] as const)(
    "%s refuses a stairs-only route instead of degrading to a warning",
    (mode) => {
      const data = model(
        [node("lower", [0, 0, 0]), node("upper", [0, 0, 4], 1)],
        [edge("stair", "lower", "upper", { kind: "steps" })],
      );
      const result = planIndoorRoute(data, "lower", "upper", mode, {
        verticalPreference: "auto",
      });
      expect(result).toEqual({
        ok: false,
        reason: "NO_ACCESSIBLE_ROUTE",
      });
    },
  );

  it.each(["wheelchair", "elderly", "visual_impaired"] as const)(
    "%s rejects cross-floor ramps with null-level intermediate nodes but allows the outdoor entry ramp",
    (mode) => {
      const data = model(
        [
          node("lower", [0, 0, 0]),
          { ...node("mid", [2, 0, 2], null), buildingId: "test" },
          node("upper", [4, 0, 4], 1),
        ],
        [
          edge("ramp:0@0", "lower", "mid", { ramp: true, osmRef: "way/ramp" }),
          edge("ramp:1@0", "mid", "upper", { ramp: true, osmRef: "way/ramp" }),
        ],
      );
      expect(planIndoorRoute(data, "lower", "upper", mode)).toEqual({
        ok: false,
        reason: "NO_ACCESSIBLE_ROUTE",
      });
      expect(planIndoorRoute(data, "mid", "upper", mode).ok).toBe(false);
      expect(planIndoorRoute(data, "lower", "upper", "normal").ok).toBe(true);
      const entry = model(
        [node("outdoor", [0, 0, -0.6], null), node("entry", [4, 0, 0])],
        [
          edge("entry-ramp", "outdoor", "entry", {
            ramp: true,
            heightPending: true,
          }),
        ],
      );
      const route = planIndoorRoute(entry, "outdoor", "entry", mode);
      expect(route.ok).toBe(true);
      expect(route.ok && route.animationSafe).toBe(false);
    },
  );

  it("keeps auto compatible while stairs and elevator exclude the other vertical mode", () => {
    const data = model(
      [node("lower", [0, 0, 0]), node("upper", [0, 0, 4], 1)],
      [
        edge("stair", "lower", "upper", { kind: "steps" }),
        edge("lift", "lower", "upper", { kind: "elevator" }),
      ],
    );
    for (const preference of [undefined, "auto", "stairs"] as const) {
      const result = planIndoorRoute(data, "lower", "upper", "normal", {
        verticalPreference: preference,
      });
      expect(result.ok && result.kinds).toEqual(["steps"]);
    }
    const lift = planIndoorRoute(data, "lower", "upper", "normal", {
      verticalPreference: "elevator",
    });
    expect(lift.ok && lift.kinds).toEqual(["elevator"]);
    // A caller cannot re-enable stairs by passing a preference in wheelchair mode.
    const chair = planIndoorRoute(data, "lower", "upper", "wheelchair", {
      verticalPreference: "stairs",
    });
    expect(chair.ok && chair.kinds).toEqual(["elevator"]);
  });

  it.each(["wheelchair", "elderly", "visual_impaired"] as const)(
    "%s does not reset the known floor at a same-Z null-level node across separate source ways",
    (mode) => {
      const data = model(
        [
          node("lower", [0, 0, 0]),
          { ...node("unknown", [2, 0, 0], null), buildingId: "test" },
          node("upper", [4, 0, 0], 1),
        ],
        [
          edge("a", "lower", "unknown", { ramp: true, heightPending: true }),
          edge("b", "unknown", "upper", { ramp: true, heightPending: true }),
        ],
      );
      expect(planIndoorRoute(data, "lower", "upper", mode)).toEqual({
        ok: false,
        reason: "NO_ACCESSIBLE_ROUTE",
      });
      expect(planIndoorRoute(data, "lower", "upper", "normal").ok).toBe(true);
    },
  );

  it("fails closed when the preferred vertical connection does not exist", () => {
    const data = model(
      [node("lower", [0, 0, 0]), node("upper", [0, 0, 4], 1)],
      [edge("lift", "lower", "upper", { kind: "elevator" })],
    );
    expect(
      planIndoorRoute(data, "lower", "upper", "normal", {
        verticalPreference: "stairs",
      }),
    ).toEqual({ ok: false, reason: "NO_ROUTE" });
    data.edges = [edge("escalator", "lower", "upper", { kind: "escalator" })];
    expect(
      planIndoorRoute(data, "lower", "upper", "normal", {
        verticalPreference: "elevator",
      }),
    ).toEqual({ ok: false, reason: "NO_ROUTE" });
  });
});

function multiCandidateModel() {
  const { data, design } = candidateModel();
  const second = structuredClone(design);
  second.id = "candidate-two";
  second.name = "Second synthetic candidate";
  // Same OSM source, different compiled floor span exercises full-span matching.
  second.sourceConnectionId = "way/stair@upper-span";
  second.sourcePath = [
    [0, 4, 2],
    [0, 6, 3],
    [0, 8, 4],
  ];
  second.animationPath = design.animationPath.map(([x, y, z]) => [
    x,
    y + 4,
    z + 2,
  ]);
  data.nodes.push(
    node("middle2", [0, 6, 3], null),
    node("top", [0, 8, 4], 2),
    node("exit", [2, 8, 4], 2),
  );
  data.places.push(
    ...data.nodes.slice(-3).map((n) => ({
      ...data.places[0],
      id: n.id,
      name: n.id,
      nodeId: n.id,
      point: n.point,
      levelRef: n.levelRef,
    })),
  );
  data.edges.push(
    edge("flight-c@upper-span", "upper", "middle2", {
      kind: "steps",
      osmRef: "way/stair",
      animationPending: true,
    }),
    edge("flight-d@upper-span", "middle2", "top", {
      kind: "steps",
      osmRef: "way/stair",
      animationPending: true,
    }),
    edge("exit-walk", "top", "exit"),
  );
  data.connections.push({
    ...data.connections[0],
    id: second.sourceConnectionId,
    coordinates: second.sourcePath,
    levelRefs: ["2F", null, "3F"],
  });
  data.stairDesigns = [design, second];
  data.preview = { levels: [0, 1, 2], requirePhysicalStairs: true };
  return { data, design, second };
}

describe("multiple source stair spans", () => {
  it("maps consecutive candidates independently with precise steps, reverse and provenance", () => {
    const { data, design, second } = multiCandidateModel();
    const original = JSON.stringify(data);
    const forward = planIndoorRoute(data, "before", "exit", "normal");
    const reverse = planIndoorRoute(data, "exit", "before", "normal");
    expect(forward.ok && reverse.ok).toBe(true);
    if (!forward.ok || !reverse.ok) return;
    expect(forward.points).toEqual([
      [-2, 0, 0],
      ...design.animationPath,
      ...second.animationPath.slice(1),
      [2, 8, 4],
    ]);
    expect(reverse.points).toEqual([...forward.points].reverse());
    expect(forward.researchCandidateIds).toEqual([design.id, second.id]);
    expect(reverse.researchCandidateIds).toEqual([second.id, design.id]);
    expect(forward.researchCandidateId).toBe(design.id);
    expect(forward.animationSafe).toBe(true);
    expect(forward.edgeIds).toEqual([
      "approach",
      "flight-a@span",
      "flight-b@span",
      "flight-c@upper-span",
      "flight-d@upper-span",
      "exit-walk",
    ]);
    expect(forward.kinds).toHaveLength(forward.points.length - 1);
    expect(
      forward.steps.map((s) => [
        s.startIndex,
        s.endIndex,
        s.fromLevel,
        s.toLevel,
      ]),
    ).toEqual([
      [0, 1, "1F", "1F"],
      [1, 6, "1F", "2F"],
      [6, 11, "2F", "3F"],
      [11, 12, "3F", "3F"],
    ]);
    expect(
      forward.steps.reduce((sum, step) => sum + step.distanceM, 0),
    ).toBeCloseTo(forward.distanceM);
    forward.points[2][0] = 999;
    expect(JSON.stringify(data)).toBe(original);
  });

  it("preserves a valid span but blocks a partial, stale or mismatched second span", () => {
    for (const problem of [
      "partial",
      "stale",
      "endpoint",
      "missing",
    ] as const) {
      const { data, design, second } = multiCandidateModel();
      if (problem === "stale") second.sourceSha256 = "old";
      if (problem === "endpoint") second.animationPath[0][0] = 99;
      if (problem === "missing") data.stairDesigns = [design];
      const result = planIndoorRoute(
        data,
        "lower",
        problem === "partial" ? "middle2" : "top",
        "normal",
      );
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.animationSafe).toBe(false);
      expect(result.researchCandidateIds).toEqual([design.id]);
      expect(result.points.slice(0, design.animationPath.length)).toEqual(
        design.animationPath,
      );
      expect(result.points.at(-1)).toEqual(
        problem === "partial" ? [0, 6, 3] : [0, 8, 4],
      );
    }
  });

  it("never overrides height-pending source edges and reports restrictions on any edge", () => {
    const { data } = multiCandidateModel();
    const source = data.edges.find(
      (candidate) => candidate.id === "flight-d@upper-span",
    );
    if (!source) throw new Error("Missing synthetic edge");
    source.heightPending = true;
    const result = planIndoorRoute(data, "lower", "top", "normal");
    expect(result.ok && result.animationSafe).toBe(false);
    expect(
      result.ok && result.warnings.some((w) => w.includes("高差待量測")),
    ).toBe(true);
  });

  it("does not choose arbitrarily between conflicting candidates for the same span", () => {
    const { data, design } = multiCandidateModel();
    data.stairDesigns?.push({ ...design, id: "ambiguous-candidate" });
    const result = planIndoorRoute(data, "lower", "upper", "normal");
    expect(result.ok && result.animationSafe).toBe(false);
    expect(result.ok && result.researchCandidateIds).toBeUndefined();
  });

  it("does not override an unmodeled approach when the candidate itself is complete", () => {
    const { data } = multiCandidateModel();
    data.edges[0].animationPending = true;
    const result = planIndoorRoute(data, "before", "top", "normal");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.researchCandidateIds).toHaveLength(2);
    expect(result.animationSafe).toBe(false);
    expect(result.warnings.some((warning) => warning.includes("樓板"))).toBe(
      true,
    );
  });
});
