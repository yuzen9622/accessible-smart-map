import { createServer, type Server } from "node:http";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  type BackendVenueDetail,
  type BackendVenueRoute,
  type BackendVenueRouteOptions,
  planBackendVenueRoute,
} from "../backendRoute";
import { toVenuePlaceDetail } from "../catalog";
import { localToLngLat } from "../coordinates";
import type { LocalIndoorModel, XYZ } from "../types";

function fixture(): LocalIndoorModel {
  const points: XYZ[] = [
    [0, 0, 0],
    [5, 4, 0],
    [10, 0, 0],
  ];
  return {
    schemaVersion: 1,
    venueId: "test-campus",
    name: "Test campus",
    origin: [10, 10],
    source: { sha256: "local-source-hash", generatedAt: "test", warnings: [] },
    building: {
      id: "hall",
      name: "Test hall",
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
    features: [
      {
        id: "room-shape",
        kind: "room",
        buildingId: "hall",
        levelRef: "1F",
        ordinal: 0,
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [7, 0],
              [10, 0],
              [10, 3],
              [7, 3],
              [7, 0],
            ],
          ],
        },
        tags: {},
        heightStatus: "estimated",
        geometryStatus: "schematic",
      },
    ],
    connections: [],
    walls: [],
    nodes: points.map((point, i) => ({
      id: `n${i}`,
      buildingId: "hall",
      point,
      ordinal: 0,
      levelRef: "1F",
      kind: "path",
    })),
    edges: [
      [0, 1],
      [1, 2],
      [0, 2],
    ].map(([a, b], i) => ({
      id: `e${i}`,
      from: `n${a}`,
      to: `n${b}`,
      kind: "corridor",
      lengthM: Math.hypot(
        points[a][0] - points[b][0],
        points[a][1] - points[b][1],
      ),
      wheelchair: "yes",
      ramp: false,
      heightPending: false,
      heightStatus: "estimated",
      geometryStatus: "schematic",
      tags: { name: `Source path ${i}` },
      osmRef: `way/${i}`,
    })),
    places: [0, 2].map((n, i) => ({
      id: i === 0 ? "entry" : "room",
      buildingId: "hall",
      name: i === 0 ? "Entry" : "Room",
      kind: i === 0 ? "entrance" : "room",
      nodeId: `n${n}`,
      point: points[n],
      levelRef: "1F",
      routeEndpoint: i === 0 ? "place" : "corridor",
      doorKnown: false,
      arrivalOnly: i === 1,
      tags: {},
    })),
  };
}
function geographic(model: LocalIndoorModel, point: XYZ): XYZ {
  return [...localToLngLat([point[0], point[1]], model.origin), point[2]];
}
function detailFor(model: LocalIndoorModel): BackendVenueDetail {
  return {
    venueId: model.venueId,
    version: 7,
    importedAt: "2026-01-01T00:00:00Z",
    buildings: [
      {
        id: model.building.id,
        footprint: model.building.footprint.map((r) =>
          r.map((p) => localToLngLat(p, model.origin)),
        ),
        levels: structuredClone(model.building.levels),
      },
    ],
    places: model.places.map((p) => ({
      id: p.id,
      nodeId: p.nodeId,
      arrivalNodeIds: p.arrivalNodeIds,
      buildingId: p.buildingId ?? null,
      levelRef: p.levelRef,
      location: localToLngLat([p.point[0], p.point[1]], model.origin),
    })),
    features: model.features.map((f) => ({
      ...f,
      geometry:
        f.geometry.type === "Point"
          ? {
              type: "Point",
              coordinates: localToLngLat(f.geometry.coordinates, model.origin),
            }
          : {
              type: "Polygon",
              coordinates: f.geometry.coordinates.map((r) =>
                r.map((p) => localToLngLat(p, model.origin)),
              ),
            },
    })),
    connections: model.connections.map((c) => ({
      ...c,
      buildingId: c.buildingId ?? null,
      coordinates: c.coordinates.map((p) => geographic(model, p)),
    })),
  };
}
function routeFor(model: LocalIndoorModel): BackendVenueRoute {
  return {
    venueId: model.venueId,
    venueVersion: 7,
    mode: "normal",
    fromPlaceId: "entry",
    toPlaceId: "room",
    distanceM: 12.8,
    path: {
      coordinates: model.nodes.map((n) => geographic(model, n.point)),
      buildingIds: model.nodes.map((n) => n.buildingId ?? null),
      levelRefs: model.nodes.map((n) => n.levelRef),
    },
    steps: [{ type: "walk", pathStart: 0, pathEnd: 2 }],
  };
}

describe("backend venue route through real HTTP", () => {
  let server: Server;
  let baseUrl: string;
  let model: LocalIndoorModel;
  let detail: BackendVenueDetail;
  let response: BackendVenueRoute;
  let requests: { method: string; body: unknown }[];
  let scenario: "normal" | "hang" | "html" | "unreachable" | "missing";
  let requestStarted: () => void = () => {};
  beforeAll(async () => {
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const raw = Buffer.concat(chunks).toString();
      requests.push({
        method: req.method ?? "",
        body: raw ? JSON.parse(raw) : null,
      });
      requestStarted();
      if (scenario === "hang") return;
      if (scenario === "html") {
        res.writeHead(500, { "Content-Type": "text/html" });
        res.end("<html>Unavailable</html>");
        return;
      }
      res.setHeader("Content-Type", "application/json");
      if (scenario === "missing") {
        res.statusCode = 404;
        res.end(
          JSON.stringify({ ok: false, code: 404, message: "Unknown venue" }),
        );
        return;
      }
      if (scenario === "unreachable" && req.method === "POST") {
        res.statusCode = 422;
        res.end(
          JSON.stringify({
            ok: false,
            code: 422,
            message: "No route",
            data: { reason: "NO_ACCESSIBLE_ROUTE" },
          }),
        );
        return;
      }
      res.end(
        JSON.stringify({
          ok: true,
          code: 200,
          data: req.method === "GET" ? detail : response,
        }),
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing test server address");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  beforeEach(() => {
    model = fixture();
    detail = detailFor(model);
    response = routeFor(model);
    requests = [];
    scenario = "normal";
    requestStarted = () => {};
  });
  afterEach(() => vi.restoreAllMocks());
  const options = (): BackendVenueRouteOptions => ({
    baseUrl,
    model,
    from: toVenuePlaceDetail(model, model.places[0]),
    to: toVenuePlaceDetail(model, model.places[1]),
    mode: "normal",
    language: "en",
  });

  it("keeps the backend-selected longer traversal and separate numeric/SHA provenance", async () => {
    const result = await planBackendVenueRoute(options());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.route.edgeIds).toEqual(["e0", "e1"]); // e2 is a shorter local path, never replanned.
    expect(result.provenance).toMatchObject({
      venueVersion: 7,
      localSourceSha256: "local-source-hash",
      provider: "api",
    });
    expect(result.route.warnings.join(" ")).toContain("走廊到達點");
    expect(requests).toEqual([
      { method: "GET", body: null },
      {
        method: "POST",
        body: {
          fromPlaceId: "entry",
          toPlaceId: "room",
          mode: "normal",
          language: "en",
        },
      },
    ]);
  });
  it("accepts a backend-selected explicit alternate arrival without replacing its traversal", async () => {
    model.places[1].arrivalNodeIds = ["n2", "n1"];
    detail = detailFor(model);
    response.path.coordinates.pop();
    response.path.buildingIds.pop();
    response.path.levelRefs.pop();
    response.steps[0].pathEnd = 1;
    const result = await planBackendVenueRoute(options());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.route.toPlaceId).toBe("room");
    for (const [axis, value] of model.nodes[1].point.entries())
      expect(result.route.points.at(-1)?.[axis]).toBeCloseTo(value, 8);
    expect(result.route.edgeIds).toEqual(["e0"]);
  });
  it("rejects alternate arrival metadata that differs from the loaded source", async () => {
    model.places[1].arrivalNodeIds = ["n2", "n1"];
    expect(await planBackendVenueRoute(options())).toMatchObject({
      ok: false,
      reason: "SOURCE_MISMATCH",
    });
    expect(requests.map((request) => request.method)).toEqual(["GET"]);
  });
  it("retains pending same-Z ramp semantics instead of the API's inferred descent", async () => {
    model.edges[0].ramp = true;
    model.edges[0].heightPending = true;
    response.steps[0].type = "ramp_down";
    const result = await planBackendVenueRoute(options());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.route.animationSafe).toBe(false);
    expect(result.route.steps[0]).toMatchObject({
      kind: "ramp",
      heightPending: true,
      name: "Source path 0",
    });
    expect(result.route.warnings.join(" ")).toContain(
      "不能從編譯後同高程判斷上下坡",
    );
  });
  it.each(["sourceVersion", "venueId", "levelRef", "buildingId"] as const)(
    "rejects stale %s before making any request",
    async (key) => {
      const input = options();
      input.from[key] = "different";
      expect(await planBackendVenueRoute(input)).toMatchObject({
        ok: false,
        reason: "STALE_SOURCE",
      });
      expect(requests).toHaveLength(0);
    },
  );
  it("does not POST local-only endpoints or reinterpret them as a nearby API place", async () => {
    detail.places.pop();
    expect(await planBackendVenueRoute(options())).toMatchObject({
      ok: false,
      reason: "UNSUPPORTED_API_PLACE",
    });
    expect(requests.map((r) => r.method)).toEqual(["GET"]);
  });
  it("rejects source geometry differences before requesting a route", async () => {
    detail.buildings[0].footprint[0][0][0] += 0.00001;
    expect(await planBackendVenueRoute(options())).toMatchObject({
      ok: false,
      reason: "SOURCE_MISMATCH",
    });
    expect(requests).toHaveLength(1);
  });
  it("rejects a route created against a different numeric import", async () => {
    response.venueVersion = 8;
    expect(await planBackendVenueRoute(options())).toMatchObject({
      ok: false,
      reason: "STALE_BACKEND_ROUTE",
    });
  });
  it.each(["off-node", "duplicate-node", "missing-edge", "parallel-edge"])(
    "fails closed for %s instead of snapping or replanning",
    async (problem) => {
      if (problem === "off-node") response.path.coordinates[1][0] += 0.00001;
      if (problem === "duplicate-node")
        model.nodes.push({ ...model.nodes[1], id: "ambiguous-node" });
      if (problem === "missing-edge") model.edges.splice(0, 1);
      if (problem === "parallel-edge")
        model.edges.push({ ...model.edges[0], id: "ambiguous-edge" });
      expect(await planBackendVenueRoute(options())).toMatchObject({
        ok: false,
        reason: "UNMATCHED_BACKEND_PATH",
      });
    },
  );
  it.each(["wheelchair", "elderly", "visual_impaired"] as const)(
    "rejects source stairs/escalators from a successful %s API response without changing the requested mode",
    async (mode) => {
      response.mode = mode;
      for (const kind of ["steps", "escalator"] as const) {
        model.edges[0].kind = kind;
        expect(
          await planBackendVenueRoute({
            ...options(),
            mode,
            verticalPreference: "stairs",
          }),
        ).toMatchObject({ ok: false, reason: "NO_ACCESSIBLE_ROUTE" });
        expect(requests.at(-1)?.body).toHaveProperty("mode", mode);
      }
    },
  );
  it.each(["wheelchair", "elderly", "visual_impaired"] as const)(
    "rejects a cross-floor ramp for %s while retaining a source-defined entry ramp",
    async (mode) => {
      model.nodes[1].levelRef = null;
      model.nodes[1].ordinal = null;
      model.nodes[1].point[2] = 2;
      model.nodes[2].levelRef = "2F";
      model.nodes[2].ordinal = 1;
      model.nodes[2].point[2] = 4;
      model.places[1].levelRef = "2F";
      model.building.levels.push({ ordinal: 1, ref: "2F", elevationM: 4 });
      model.edges[0].ramp = true;
      model.edges[1].ramp = true;
      model.edges[0].id = "ramp:0@0";
      model.edges[1].id = "ramp:1@0";
      model.edges[0].osmRef = "way/ramp";
      model.edges[1].osmRef = "way/ramp";
      detail = detailFor(model);
      response = routeFor(model);
      response.mode = mode;
      expect(await planBackendVenueRoute({ ...options(), mode })).toMatchObject(
        { ok: false, reason: "NO_ACCESSIBLE_ROUTE" },
      );
      model.nodes[0].buildingId = null;
      model.nodes[0].levelRef = null;
      model.nodes[0].ordinal = null;
      model.places[0].buildingId = null;
      model.places[0].levelRef = null;
      model.nodes[1].levelRef = "1F";
      model.nodes[1].ordinal = 0;
      model.nodes[1].point[2] = 0;
      model.nodes[2].levelRef = "1F";
      model.nodes[2].ordinal = 0;
      model.nodes[2].point[2] = 0;
      model.places[1].levelRef = "1F";
      model.edges[0].heightPending = true;
      detail = detailFor(model);
      response = routeFor(model);
      response.mode = mode;
      const result = await planBackendVenueRoute({ ...options(), mode });
      expect(result.ok).toBe(true);
      expect(result.ok && result.route.animationSafe).toBe(false);
      expect(requests.at(-1)?.body).toHaveProperty("mode", mode);
    },
  );
  it("does not infer an elevator stop from a traversed shaft", async () => {
    model.edges[0].kind = "elevator";
    model.edges[0].osmRef = "lift";
    model.connections.push({
      id: "lift",
      buildingId: "hall",
      kind: "elevator",
      name: "Lift",
      coordinates: [model.nodes[0].point, model.nodes[1].point],
      levelRefs: ["2F"],
      wheelchair: "yes",
      geometryStatus: "schematic",
      heightStatus: "estimated",
      heightPending: false,
      tags: {},
      osmRef: "lift",
    });
    detail = detailFor(model);
    expect(await planBackendVenueRoute(options())).toMatchObject({
      ok: false,
      reason: "INVALID_ELEVATOR_STOP",
    });
  });
  it.each(["stairs", "elevator"] as const)(
    "accepts a flat API path for %s preference without adding an unsupported POST field",
    async (verticalPreference) => {
      expect(
        await planBackendVenueRoute({ ...options(), verticalPreference }),
      ).toMatchObject({ ok: true });
      expect(requests[1].body).not.toHaveProperty("verticalPreference");
      expect(requests[1].body).toHaveProperty("mode", "normal");
    },
  );
  it("accepts API-chosen stairs only when they meet the original preference", async () => {
    model.edges[0].kind = "steps";
    expect(
      await planBackendVenueRoute({
        ...options(),
        verticalPreference: "stairs",
      }),
    ).toMatchObject({ ok: true });
    expect(
      await planBackendVenueRoute({
        ...options(),
        verticalPreference: "elevator",
      }),
    ).toMatchObject({ ok: false, reason: "UNSUPPORTED_PREFERENCE" });
  });
  it.each(["normal", "wheelchair", "elderly", "visual_impaired"] as const)(
    "accepts an actual elevator traversal for %s without changing its API mode",
    async (mode) => {
      model.building.levels.push({ ordinal: 1, ref: "2F", elevationM: 4 });
      model.nodes[1].point = [0, 0, 4];
      model.nodes[1].levelRef = "2F";
      model.nodes[1].ordinal = 1;
      model.nodes[2].point = [10, 0, 4];
      model.nodes[2].levelRef = "2F";
      model.nodes[2].ordinal = 1;
      model.places[1].point = model.nodes[2].point;
      model.places[1].levelRef = "2F";
      model.edges[0].kind = "elevator";
      model.edges[0].osmRef = "lift";
      model.connections.push({
        id: "lift",
        buildingId: "hall",
        kind: "elevator",
        name: "Lift",
        coordinates: [model.nodes[0].point, model.nodes[1].point],
        levelRefs: ["1F", "2F"],
        wheelchair: "yes",
        geometryStatus: "schematic",
        heightStatus: "estimated",
        heightPending: false,
        tags: {},
        osmRef: "lift",
      });
      detail = detailFor(model);
      response = routeFor(model);
      response.mode = mode;
      expect(
        await planBackendVenueRoute({
          ...options(),
          mode,
          verticalPreference: "elevator",
        }),
      ).toMatchObject({ ok: true });
      expect(
        await planBackendVenueRoute({
          ...options(),
          mode,
          verticalPreference: "stairs",
        }),
      ).toMatchObject(
        mode === "normal"
          ? { ok: false, reason: "UNSUPPORTED_PREFERENCE" }
          : { ok: true },
      );
      expect(requests.at(-1)?.body).toHaveProperty("mode", mode);
    },
  );
  it.each(["wheelchair", "elderly", "visual_impaired"] as const)(
    "%s rejects a same-Z cross-floor chain even when null intermediate levels and separate ways hide the transition",
    async (mode) => {
      model.nodes[1].levelRef = null;
      model.nodes[1].ordinal = null;
      model.nodes[2].levelRef = "2F";
      model.nodes[2].ordinal = 1;
      model.places[1].levelRef = "2F";
      model.building.levels.push({ ordinal: 1, ref: "2F", elevationM: 4 });
      model.edges[0].ramp = true;
      model.edges[1].ramp = true;
      model.edges[0].heightPending = true;
      model.edges[1].heightPending = true;
      detail = detailFor(model);
      response = routeFor(model);
      response.mode = mode;
      expect(await planBackendVenueRoute({ ...options(), mode })).toMatchObject(
        { ok: false, reason: "NO_ACCESSIBLE_ROUTE" },
      );
    },
  );
  it.each(["stairs", "elevator"] as const)(
    "rejects an API escalator path for %s preference",
    async (verticalPreference) => {
      model.edges[0].kind = "escalator";
      expect(
        await planBackendVenueRoute({ ...options(), verticalPreference }),
      ).toMatchObject({ ok: false, reason: "UNSUPPORTED_PREFERENCE" });
    },
  );
  it("distinguishes unavailable API places from a network outage", async () => {
    scenario = "missing";
    expect(await planBackendVenueRoute(options())).toMatchObject({
      ok: false,
      reason: "UNSUPPORTED_API_PLACE",
    });
  });
  it("allows only the node-proven mixed indoor/outdoor connection grouping difference", async () => {
    model.nodes[0].buildingId = null;
    model.nodes[0].levelRef = null;
    model.places[0].buildingId = null;
    model.places[0].levelRef = null;
    model.edges[0].id = "boundary:0@0";
    model.edges[0].osmRef = "way/boundary";
    model.connections.push({
      id: "way/boundary@0",
      buildingId: null,
      kind: "ramp",
      name: "Boundary ramp",
      coordinates: [model.nodes[0].point, model.nodes[1].point],
      levelRefs: [null, "1F"],
      wheelchair: "yes",
      geometryStatus: "schematic",
      heightStatus: "estimated",
      heightPending: true,
      tags: {},
      osmRef: "way/boundary",
    });
    detail = detailFor(model);
    response = routeFor(model);
    detail.connections[0].buildingId = "hall";
    expect(await planBackendVenueRoute(options())).toMatchObject({ ok: true });
    detail.connections[0].buildingId = "other-hall";
    expect(await planBackendVenueRoute(options())).toMatchObject({
      ok: false,
      reason: "SOURCE_MISMATCH",
    });
    detail.connections[0].buildingId = "hall";
    response.path.buildingIds[0] = "hall";
    expect(await planBackendVenueRoute(options())).toMatchObject({
      ok: false,
      reason: "UNMATCHED_BACKEND_PATH",
    });
  });
  it("preserves unreachable business errors and handles malformed upstream failures", async () => {
    scenario = "unreachable";
    expect(await planBackendVenueRoute(options())).toMatchObject({
      ok: false,
      reason: "NO_ACCESSIBLE_ROUTE",
    });
    scenario = "html";
    expect(await planBackendVenueRoute(options())).toMatchObject({
      ok: false,
      reason: "BACKEND_UNAVAILABLE",
    });
  });
  it("cancels a real hanging HTTP request without publishing a route", async () => {
    scenario = "hang";
    const controller = new AbortController();
    const started = new Promise<void>((resolve) => {
      requestStarted = resolve;
    });
    const pending = planBackendVenueRoute({
      ...options(),
      signal: controller.signal,
    });
    await started;
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, reason: "ABORTED" });
  });
  it("bounds every backend attempt by its own deadline", async () => {
    scenario = "hang";
    const original = setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      callback: TimerHandler,
      delay?: number,
      ...args: unknown[]
    ) =>
      original(
        callback,
        delay === 15_000 ? 25 : delay,
        ...args,
      )) as typeof setTimeout);
    expect(await planBackendVenueRoute(options())).toMatchObject({
      ok: false,
      reason: "BACKEND_TIMEOUT",
    });
  });
});
