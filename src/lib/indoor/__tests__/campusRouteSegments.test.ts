import { describe, expect, it } from "vitest";
import {
  campusRouteDisplaySegments,
  campusRouteSegments,
} from "../campusRouteSegments";
import type { IndoorRoute, LocalIndoorModel, XYZ } from "../types";

const model = { nodes: [], edges: [] } as unknown as LocalIndoorModel;
function route(): IndoorRoute {
  return {
    points: Array.from({ length: 9 }, (_, i): XYZ => [i * 2, i, i < 4 ? 0 : 8]),
    context: {
      buildingIds: ["a", "a", null, null, "b", "b", "c", "c", "d"],
      levelRefs: ["1F", "1F", null, null, "2F", "2F", "3F", "3F", "4F"],
    },
    edgeIds: [],
  } as unknown as IndoorRoute;
}
const views = [
  { buildingId: "a", levelRef: "1F" },
  { buildingId: "b", levelRef: "2F" },
  { buildingId: "c", levelRef: "3F" },
  { buildingId: "d", levelRef: "4F" },
];

describe("multi-building campus route segments", () => {
  function rampSource() {
    const source = route();
    source.kinds = Array.from(
      { length: source.points.length - 1 },
      () => "footway",
    );
    source.kinds[2] = "ramp";
    source.steps = [
      {
        kind: "ramp",
        connectionId: "campus-ramp",
        name: "Source ramp",
        startIndex: 2,
        endIndex: 3,
        fromLevel: null,
        toLevel: null,
        distanceM: 2,
        heightPending: true,
      },
    ];
    const value = {
      ...model,
      connections: [],
      campus: {
        walkways: [],
        connections: [
          {
            id: "campus-ramp",
            kind: "ramp",
            name: "Source ramp",
            coordinates: [source.points[2], source.points[3]],
            levelRefs: [null, null],
            wheelchair: "yes",
            geometryStatus: "traced",
            heightStatus: "estimated",
            heightPending: true,
            tags: {},
            osmRef: "way/ramp",
          },
        ],
      },
    } satisfies Partial<LocalIndoorModel> as LocalIndoorModel;
    return { source, value };
  }

  it("omits floorless campus links from indoor floor views without joining the remaining bridges", () => {
    const { source, value } = rampSource();
    const snapshot = JSON.stringify({ source, value });
    const result = campusRouteDisplaySegments(source, value, views);
    expect(result.map((segment) => segment.pathStart)).toEqual([5, 7]);
    expect(result.filter((segment) => segment.accessibleRamp)).toHaveLength(0);
    expect(JSON.stringify({ source, value })).toBe(snapshot);
  });

  it("restores outdoor walking, entrance edges and accessible ramps only in an explicit ground-floor view", () => {
    const { source, value } = rampSource();
    // Ground source edges: indoor a -> outdoors -> indoors b; upstairs
    // bridge edges remain separate and must not be borrowed for this floor.
    source.points = source.points.map(([x, y], index) => [
      x,
      y,
      index < 5 ? 0 : 8,
    ]);
    if (!source.context || !value.campus) throw new Error("Missing context");
    source.context.levelRefs[4] = "1F";
    value.campus.connections[0].coordinates = [
      source.points[2],
      source.points[3],
    ];
    const floorViews = [
      { buildingId: "a", levelRef: "1F", groundElevationM: 0 },
      { buildingId: "b", levelRef: "1F", groundElevationM: 0 },
    ];
    const snapshot = JSON.stringify({ source, value });
    const result = campusRouteDisplaySegments(source, value, floorViews);
    expect(result.map((segment) => segment.pathStart)).toEqual([1, 2, 3]);
    expect(result[1]).toMatchObject({
      coordinates: [source.points[2], source.points[3]],
      accessibleRamp: true,
      connectionId: "campus-ramp",
    });
    expect(campusRouteDisplaySegments(source, value, [])).toEqual([]);
    expect(
      campusRouteDisplaySegments(source, value, [
        { buildingId: "a", levelRef: "2F" },
        { buildingId: "b", levelRef: "2F" },
      ]),
    ).toEqual([]);
    expect(JSON.stringify({ source, value })).toBe(snapshot);

    const count = source.points.length - 1;
    source.points.reverse();
    source.kinds.reverse();
    source.context.buildingIds.reverse();
    source.context.levelRefs.reverse();
    source.steps = source.steps.map((step) => ({
      ...step,
      startIndex: count - step.endIndex,
      endIndex: count - step.startIndex,
    }));
    expect(campusRouteSegments(source, value, floorViews)).toEqual(
      result.toReversed().map(({ coordinates: [a, b] }) => [b, a]),
    );
  });

  it("never treats null indoor transition points, elevated outdoor edges or a hidden-floor entrance as ground walking", () => {
    const source = route();
    source.points = source.points.map(([x, y]) => [x, y, 0]);
    const ground = [{ buildingId: "a", levelRef: "1F", groundElevationM: 0 }];
    if (!source.context) throw new Error("Missing context");
    // The first entrance is valid, but its continuation into b's hidden
    // floor is not; no chord is invented to complete the route.
    expect(
      campusRouteDisplaySegments(source, model, ground).map((s) => s.pathStart),
    ).toEqual([1, 2]);
    source.context.buildingIds[2] = "a";
    expect(campusRouteDisplaySegments(source, model, ground)).toEqual([]);
    source.context.buildingIds[2] = null;
    source.points[2][2] = source.points[3][2] = 4;
    expect(campusRouteDisplaySegments(source, model, ground)).toEqual([]);
    expect(
      campusRouteDisplaySegments(source, model, {
        buildingId: "a",
        levelRef: "B1",
      }),
    ).toEqual([]);
  });

  it.each(["no", "limited", "unknown"] as const)(
    "does not label a source ramp with wheelchair=%s as confirmed accessible",
    (wheelchair) => {
      const { source, value } = rampSource();
      if (!value.campus) throw new Error("Missing campus fixture");
      value.campus.connections[0].wheelchair = wheelchair;
      expect(
        campusRouteDisplaySegments(source, value).every(
          (segment) => !segment.accessibleRamp,
        ),
      ).toBe(true);
    },
  );

  it("keeps unmatched slopes, ordinary walking, and a stale facility identity in the normal route color", () => {
    const { source, value } = rampSource();
    delete source.steps[0].connectionId;
    expect(
      campusRouteDisplaySegments(source, value).some(
        (segment) => segment.accessibleRamp,
      ),
    ).toBe(false);
    source.steps[0].connectionId = "campus-ramp";
    source.kinds[2] = "footway";
    expect(
      campusRouteDisplaySegments(source, value).some(
        (segment) => segment.accessibleRamp,
      ),
    ).toBe(false);
    source.kinds[2] = "ramp";
    if (!value.campus) throw new Error("Missing campus fixture");
    value.campus.connections[0].coordinates = [
      [100, 0, 0],
      [101, 0, 0],
    ];
    expect(
      campusRouteDisplaySegments(source, value).some(
        (segment) => segment.accessibleRamp,
      ),
    ).toBe(false);
  });

  it("retains source ramp access when a route traverses the exact connection in reverse", () => {
    const { source, value } = rampSource();
    const count = source.points.length - 1;
    source.points.reverse();
    source.kinds.reverse();
    source.context?.buildingIds.reverse();
    source.context?.levelRefs.reverse();
    source.steps = source.steps.map((step) => ({
      ...step,
      startIndex: count - step.endIndex,
      endIndex: count - step.startIndex,
    }));
    expect(
      campusRouteDisplaySegments(source, value).find(
        (segment) => segment.accessibleRamp,
      ),
    ).toMatchObject({
      pathStart: 5,
      pathEnd: 6,
      coordinates: [source.points[5], source.points[6]],
      connectionId: "campus-ramp",
    });
  });

  it("retains a cross-building ramp only when both endpoint floors are displayed", () => {
    const { source, value } = rampSource();
    source.kinds[2] = "footway";
    source.kinds[5] = "ramp";
    source.steps[0] = { ...source.steps[0], startIndex: 5, endIndex: 6 };
    if (!value.campus) throw new Error("Missing campus fixture");
    value.campus.connections[0].coordinates = [
      source.points[5],
      source.points[6],
    ];
    value.campus.connections[0].levelRefs = ["2F", "3F"];
    expect(
      campusRouteDisplaySegments(source, value, views).find(
        (segment) => segment.accessibleRamp,
      ),
    ).toMatchObject({ pathStart: 5, pathEnd: 6, connectionId: "campus-ramp" });
    expect(
      campusRouteDisplaySegments(source, value, views.slice(0, 2)).some(
        (segment) => segment.accessibleRamp,
      ),
    ).toBe(false);
  });

  it("retains original route order and indices when a legacy graph edge is stored in the opposite direction", () => {
    const { source, value } = rampSource();
    delete source.context;
    source.edgeIds = ["outside"];
    value.nodes = [2, 3].map((index) => ({
      id: `node-${index}`,
      point: source.points[index],
      ordinal: null,
      levelRef: null,
      kind: "path",
    }));
    value.edges = [
      {
        id: "outside",
        from: "node-3",
        to: "node-2",
        kind: "footway",
        lengthM: 2,
        wheelchair: "yes",
        ramp: true,
        heightPending: true,
        geometryStatus: "traced",
        heightStatus: "estimated",
        tags: {},
        osmRef: "way/ramp",
      },
    ];
    expect(campusRouteDisplaySegments(source, value)).toEqual([
      expect.objectContaining({
        coordinates: [source.points[2], source.points[3]],
        pathStart: 2,
        pathEnd: 3,
        accessibleRamp: true,
      }),
    ]);
  });

  it("retains authored campus and bridge edges for four different visible floors without joining gaps", () => {
    const source = route();
    const snapshot = JSON.stringify(source);
    const result = campusRouteSegments(source, model, views);
    expect(result).toEqual(
      [5, 7].map((i) => [source.points[i], source.points[i + 1]]),
    );
    expect(result[0][0]).toBe(source.points[5]);
    expect(result[0][1]).toBe(source.points[6]);
    expect(result[0][1][2]).toBe(8);
    expect(JSON.stringify(source)).toBe(snapshot);
  });

  it("never draws a bridge into another building's hidden floor", () => {
    const source = route();
    expect(
      campusRouteSegments(
        source,
        model,
        views.map((view) =>
          view.buildingId === "c" ? { ...view, levelRef: "1F" } : view,
        ),
      ),
    ).toEqual([]);
    expect(campusRouteSegments(source, model, views.slice(0, 2))).toEqual([]);
  });

  it("omits floorless campus travel when no indoor floor is displayed", () => {
    const source = route();
    expect(campusRouteSegments(source, model, [])).toEqual([]);
  });

  it("retains route direction and exact endpoints when the source path is reversed", () => {
    const source = route();
    const forward = campusRouteSegments(source, model, views);
    if (!source.context) throw new Error("Synthetic context is required");
    source.points.reverse();
    source.context.buildingIds.reverse();
    source.context.levelRefs.reverse();
    expect(campusRouteSegments(source, model, views)).toEqual(
      forward.reverse().map(([a, b]) => [b, a]),
    );
  });

  it("fails closed for missing source context instead of inferring a floor from Z", () => {
    const source = route();
    if (!source.context) throw new Error("Synthetic context is required");
    source.context.levelRefs.pop();
    expect(campusRouteSegments(source, model, views)).toEqual([]);
    delete source.context;
    expect(campusRouteSegments(source, model, views)).toEqual([]);
  });
});
