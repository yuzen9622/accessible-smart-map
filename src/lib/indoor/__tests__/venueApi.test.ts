import { afterEach, describe, expect, it, vi } from "vitest";
import { planBackendVenueRoute } from "../backendRoute";
import { placeForVenueFeature, toVenuePlaceDetail } from "../catalog";
import { localToLngLat } from "../coordinates";
import { planVenueJourney } from "../planJourney";
import type { XYZ } from "../types";
import {
  loadVenueCatalog,
  officialRoute,
  type VenueDetail,
  type VenueRouteResponse,
  validateVenueDetail,
  venueModels,
} from "../venueApi";

const annotation = {
  geometryStatus: "schematic" as const,
  heightStatus: "estimated" as const,
};

it("retains source campus walkways and connections once for all building views", () => {
  const { detail } = fixture();
  const before = JSON.stringify(detail);
  const models = venueModels(detail);
  expect(models[0]).toMatchObject({
    campus: {
      walkways: [
        {
          id: "bridge",
          indoor: true,
          buildingIds: ["east", "west"],
          levelRefs: ["3F", "3F"],
        },
      ],
    },
  });
  expect(models[0].campus).toBe(models[1].campus);
  expect(models[0].campus?.connections).toHaveLength(detail.connections.length);
  expect(JSON.stringify(detail)).toBe(before);
});
function fixture() {
  const coordinates: XYZ[] = [
    [10, 10, 0],
    [10, 10, 8],
    [10.0001, 10, 8],
    [10.0002, 10, 8],
    [10.0003, 10, 8],
  ];
  const detail: VenueDetail = {
    venueId: "synthetic-venue",
    name: "Synthetic venue",
    version: 3,
    importedAt: "2026-01-01T00:00:00Z",
    sourceSha256: "synthetic-sha",
    center: [10, 10],
    buildings: ["east", "west"].map((id, i) => ({
      ...annotation,
      id,
      name: `${id} hall`,
      aliases: [],
      groundOffsetM: 0,
      floorHeightM: 4,
      footprint: [
        [
          [10 + i * 0.0002, 10],
          [10.0001 + i * 0.0002, 10],
          [10.0001 + i * 0.0002, 10.0001],
          [10 + i * 0.0002, 10.0001],
          [10 + i * 0.0002, 10],
        ],
      ],
      levels: [0, 2].map((ordinal) => ({
        ordinal,
        ref: `${ordinal + 1}F`,
        elevationM: ordinal * 4,
        coverage: {
          hasAnchor: true,
          hasRouteData: true,
          hasDisplayGeometry: ordinal === 0,
        },
      })),
    })),
    places: [
      {
        id: "start",
        name: "Start",
        kind: "place",
        nodeId: "source-start",
        buildingId: "east",
        levelRef: "1F",
        location: [10, 10],
      },
      {
        id: "landing",
        name: "Upper landing",
        kind: "place",
        nodeId: "source-upper",
        buildingId: "east",
        levelRef: "3F",
        location: [10, 10],
      },
      {
        id: "end",
        name: "End room",
        kind: "room",
        nodeId: "source-end",
        buildingId: "west",
        levelRef: "3F",
        location: [10.0003, 10],
      },
    ],
    features: [
      {
        ...annotation,
        id: "room-polygon",
        buildingId: "west",
        levelRef: "3F",
        ordinal: 2,
        kind: "room",
        name: "End room",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [10.0002, 10],
              [10.0003, 10],
              [10.0003, 10.0001],
              [10.0002, 10.0001],
              [10.0002, 10],
            ],
          ],
        },
      },
    ],
    walkways: [
      {
        ...annotation,
        id: "bridge",
        kind: "corridor",
        indoor: true,
        coordinates: [coordinates[2], coordinates[3]],
        buildingId: null,
        levelRef: null,
        buildingIds: ["east", "west"],
        levelRefs: ["3F", "3F"],
        wheelchair: "yes",
        osmRef: "way/synthetic-bridge",
        heightPending: true,
      },
    ],
    connections: [
      {
        ...annotation,
        id: "lift",
        kind: "elevator",
        buildingId: "east",
        coordinates: coordinates.slice(0, 2),
        levelRefs: ["1F", "3F"],
        wheelchair: "yes",
        osmRef: "node/synthetic-lift",
        name: "Lift E",
      },
    ],
  };
  const route: VenueRouteResponse = {
    venueId: detail.venueId,
    venueVersion: 3,
    fromPlaceId: "start",
    toPlaceId: "end",
    mode: "wheelchair",
    distanceM: 33,
    durationS: 55,
    elevatorRides: 1,
    stairFlights: 0,
    path: {
      coordinates,
      buildingIds: ["east", "east", "east", "west", "west"],
      levelRefs: ["1F", "3F", "3F", "3F", "3F"],
    },
    segments: [
      { buildingId: "east", levelRef: "1F", pathStart: 0, pathEnd: 1 },
      { buildingId: "east", levelRef: "3F", pathStart: 1, pathEnd: 3 },
      { buildingId: "west", levelRef: "3F", pathStart: 3, pathEnd: 4 },
    ],
    steps: [
      {
        type: "depart",
        instruction: "Start here",
        buildingId: "east",
        levelRef: "1F",
        pathStart: 0,
        pathEnd: 0,
        distanceM: 0,
        durationS: 0,
      },
      {
        type: "elevator",
        instruction: "Take Lift E to 3F",
        buildingId: "east",
        levelRef: "1F",
        fromLevelRef: "1F",
        toLevelRef: "3F",
        pathStart: 0,
        pathEnd: 1,
        distanceM: 0,
        durationS: 12,
      },
      {
        type: "walk",
        instruction: "Walk toward bridge",
        buildingId: "east",
        levelRef: "3F",
        pathStart: 1,
        pathEnd: 2,
        distanceM: 11,
        durationS: 14,
      },
      {
        type: "enter",
        instruction: "Enter west hall",
        buildingId: "west",
        levelRef: "3F",
        pathStart: 2,
        pathEnd: 2,
        distanceM: 0,
        durationS: 0,
      },
      {
        type: "walk",
        instruction: "Follow source bridge",
        buildingId: "west",
        levelRef: "3F",
        pathStart: 2,
        pathEnd: 4,
        distanceM: 22,
        durationS: 29,
      },
      {
        type: "arrive",
        instruction: "Arrive at End room",
        buildingId: "west",
        levelRef: "3F",
        pathStart: 4,
        pathEnd: 4,
        distanceM: 0,
        durationS: 0,
      },
    ],
  };
  return { detail, route };
}
const convert = (detail: VenueDetail, route: VenueRouteResponse) =>
  officialRoute(
    detail,
    route,
    route.fromPlaceId,
    route.toPlaceId,
    route.mode,
    "en",
  );
function stairsFixture(reverse = false) {
  const { detail, route } = fixture();
  const coordinates: XYZ[] = [
    [10, 10, 0],
    [10.00002, 10, 2],
    [10.00002, 10.00002, 5],
    [10, 10, 8],
  ];
  detail.connections = [
    {
      ...annotation,
      id: "source-stairs",
      kind: "stairs",
      buildingId: "east",
      coordinates,
      levelRefs: ["1F", null, null, "3F"],
      wheelchair: "no",
      osmRef: "way/source-stairs",
      heightPending: true,
    },
  ];
  route.mode = "normal";
  route.fromPlaceId = reverse ? "landing" : "start";
  route.toPlaceId = reverse ? "start" : "landing";
  route.path = {
    coordinates: reverse ? [...coordinates].reverse() : [...coordinates],
    buildingIds: Array(4).fill("east"),
    levelRefs: reverse ? ["3F", null, null, "1F"] : ["1F", null, null, "3F"],
  };
  const from = reverse ? "3F" : "1F",
    to = reverse ? "1F" : "3F";
  route.segments = [
    { buildingId: "east", levelRef: from, pathStart: 0, pathEnd: 3 },
    { buildingId: "east", levelRef: to, pathStart: 3, pathEnd: 3 },
  ];
  route.steps = [
    {
      type: "depart",
      instruction: "Depart",
      buildingId: "east",
      levelRef: from,
      pathStart: 0,
      pathEnd: 0,
      distanceM: 0,
      durationS: 0,
    },
    {
      type: "stairs",
      instruction: "Follow these stairs",
      buildingId: "east",
      levelRef: from,
      fromLevelRef: from,
      toLevelRef: to,
      pathStart: 0,
      pathEnd: 3,
      distanceM: 12,
      durationS: 20,
    },
    {
      type: "arrive",
      instruction: "Arrive",
      buildingId: "east",
      levelRef: to,
      pathStart: 3,
      pathEnd: 3,
      distanceM: 0,
      durationS: 0,
    },
  ];
  return { detail, route };
}
afterEach(() => vi.unstubAllGlobals());

function displayTopologyFixture() {
  const { detail, route } = fixture();
  const points = route.path.coordinates;
  detail.connections[0].nodeIds = ["source-start", "source-upper"];
  detail.walkways[0].nodeIds = ["bridge-east", "bridge-west"];
  const edge = (
    id: string,
    nodeIds: [string, string],
    coordinates: [XYZ, XYZ],
    buildingId: string,
    levelRef: string,
  ) => ({
    ...annotation,
    id,
    nodeIds,
    coordinates,
    buildingId,
    levelRef,
    buildingIds: [buildingId, buildingId] as [string, string],
    levelRefs: [levelRef, levelRef] as [string, string],
    kind: "corridor" as const,
    indoor: true,
    wheelchair: "yes" as const,
    osmRef: `way/${id}`,
  });
  detail.walkways.push(
    edge(
      "upper-approach",
      ["source-upper", "bridge-east"],
      [points[1], points[2]],
      "east",
      "3F",
    ),
    edge(
      "lower-approach",
      ["lower-hall", "source-start"],
      [[10.00003, 10, 0], points[0]],
      "east",
      "1F",
    ),
    edge(
      "west-hall",
      ["bridge-west", "source-end"],
      [points[3], points[4]],
      "west",
      "3F",
    ),
  );
  return { detail, route };
}

function multiArrivalFixture() {
  const { detail, route } = displayTopologyFixture();
  const feature = {
    ...detail.features[0],
    id: "way/synthetic-core@2",
    kind: "area" as const,
    buildingId: "east",
    name: "電梯／樓梯核心 C",
    tags: { "a11ymap:area_type": "vertical_core" },
    geometry: {
      type: "Polygon" as const,
      coordinates: [
        [
          [10, 10],
          [10.0001, 10],
          [10.0001, 10.0001],
          [10, 10.0001],
          [10, 10],
        ],
      ] as [number, number][][],
    },
  };
  detail.features.push(feature, {
    ...feature,
    id: "way/nonstop-shaft@2",
    kind: "elevator",
    connectionId: "nonstop-shaft",
  });
  const place = {
    id: "arrival:way/synthetic-core@2",
    name: feature.name,
    kind: "poi",
    buildingId: "east",
    levelRef: "3F",
    nodeId: "source-upper",
    arrivalNodeIds: ["source-upper", "bridge-east"],
    location: [10, 10] as [number, number],
    featureId: feature.id,
    arrivalKind: "corridor" as const,
    doorKnown: false,
  };
  detail.places.push(place);
  route.toPlaceId = place.id;
  route.path.coordinates = route.path.coordinates.slice(0, 3);
  route.path.buildingIds = route.path.buildingIds.slice(0, 3);
  route.path.levelRefs = route.path.levelRefs.slice(0, 3);
  route.segments = route.segments.slice(0, 2);
  route.segments[1].pathEnd = 2;
  route.steps = [
    ...route.steps.slice(0, 3),
    {
      ...route.steps[route.steps.length - 1],
      buildingId: "east",
      pathStart: 2,
      pathEnd: 2,
    },
  ];
  return { detail, route, feature, place };
}

describe("explicit source arrival contract", () => {
  it("binds a generated core place and retains its named source arrivals without assigning a nonstop shaft", () => {
    const { detail, feature, place } = multiArrivalFixture();
    const model = venueModels(detail)[0];
    const core = model.features.find((f) => f.id === feature.id);
    const shaft = model.features.find((f) => f.id === "way/nonstop-shaft@2");
    if (!core || !shaft) throw new Error("Expected synthetic core and shaft");
    const selected = placeForVenueFeature(model, core);
    expect(selected).toMatchObject({
      id: place.id,
      featureId: feature.id,
      arrivalNodeIds: ["source-upper", "bridge-east"],
      nodeId: "source-upper",
      doorKnown: false,
    });
    expect(placeForVenueFeature(model, shaft)).toBeUndefined();
  });
  it.each(["normal", "wheelchair", "elderly", "visual_impaired"] as const)(
    "keeps the backend's nonprimary arrival and sends semantic place IDs in %s mode",
    async (mode) => {
      const { detail, route, feature, place } = multiArrivalFixture();
      route.mode = mode;
      const models = venueModels(detail);
      const model = models[0];
      const core = model.features.find((f) => f.id === feature.id);
      if (!core) throw new Error("Expected synthetic core");
      const selected = placeForVenueFeature(model, core);
      if (!selected) throw new Error("Expected explicit core arrival");
      const requests: unknown[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init: RequestInit) => {
          if (init.method === "POST")
            requests.push(JSON.parse(String(init.body)));
          return Response.json({
            ok: true,
            code: 200,
            data: init.method === "POST" ? route : detail,
          });
        }),
      );
      const result = await planVenueJourney({
        models,
        origin: toVenuePlaceDetail(model, model.places[0]),
        destination: toVenuePlaceDetail(model, selected),
        mode,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.message);
      expect(result.journey.to.placeId).toBe(place.id);
      expect(result.journey.route.points.at(-1)).not.toEqual(selected.point);
      expect(result.journey.route.context?.buildingIds.at(-1)).toBe("east");
      expect(result.journey.route.context?.levelRefs.at(-1)).toBe("3F");
      expect(requests).toEqual([
        { fromPlaceId: "start", toPlaceId: place.id, mode, language: "zh-TW" },
      ]);
    },
  );
  it("keeps an explicit alternate departure under the same semantic place ID", () => {
    const { detail, route, place } = multiArrivalFixture();
    route.fromPlaceId = place.id;
    route.toPlaceId = "start";
    route.path.coordinates.reverse();
    route.path.buildingIds.reverse();
    route.path.levelRefs.reverse();
    route.segments = [
      { buildingId: "east", levelRef: "3F", pathStart: 0, pathEnd: 2 },
      { buildingId: "east", levelRef: "1F", pathStart: 2, pathEnd: 2 },
    ];
    route.steps = [
      { ...route.steps[0], levelRef: "3F" },
      { ...route.steps[2], pathStart: 0, pathEnd: 1 },
      {
        ...route.steps[1],
        levelRef: "3F",
        fromLevelRef: "3F",
        toLevelRef: "1F",
        pathStart: 1,
        pathEnd: 2,
      },
      { ...route.steps[3], levelRef: "1F" },
    ];
    const result = convert(detail, route);
    expect(result.fromPlaceId).toBe(place.id);
    expect(result.points[0][0]).toBeGreaterThan(10);
    expect(result.context?.levelRefs[0]).toBe("3F");
    expect(result.context?.levelRefs.at(-1)).toBe("1F");
  });
  it.each(["source-start", "bridge-west", "missing-source"])(
    "rejects an arrival with wrong floor, building or unknown source: %s",
    (id) => {
      const { detail, place } = multiArrivalFixture();
      place.arrivalNodeIds = [place.nodeId, id];
      expect(() => venueModels(detail)).toThrow();
    },
  );
  it.each(
    [
      [],
      ["bridge-east"],
      ["source-upper", "source-upper"],
      Array(17).fill("source-upper"),
    ].map((ids) => ({ ids })),
  )("rejects invalid candidate lists: $ids", ({ ids }) => {
    const { detail, place } = multiArrivalFixture();
    place.arrivalNodeIds = ids;
    expect(() => validateVenueDetail(detail)).toThrow();
  });
  it("rejects a nonprimary endpoint after explicit candidates are removed", () => {
    const { detail, route, place } = multiArrivalFixture();
    delete (place as { arrivalNodeIds?: string[] }).arrivalNodeIds;
    expect(() => convert(detail, route)).toThrow(/端點/);
  });
});

describe("published venue display adapter", () => {
  it("uses exact public node IDs for all-floor display approaches and retains cross-building contexts", () => {
    const { detail } = displayTopologyFixture();
    const original = structuredClone(detail);
    const models = venueModels(detail);
    const model = models[0];
    expect(model.nodes).toHaveLength(6);
    expect(model.edges).toHaveLength(4);
    expect(model.nodes.find((n) => n.id === "source-upper")).toMatchObject({
      buildingId: "east",
      levelRef: "3F",
      ordinal: 2,
      point: [0, 0, 8],
    });
    expect(model.nodes.find((n) => n.id === "bridge-west")).toMatchObject({
      buildingId: "west",
      levelRef: "3F",
    });
    expect(model.edges.find((e) => e.id === "bridge")).toMatchObject({
      from: "bridge-east",
      to: "bridge-west",
      kind: "corridor",
      heightPending: true,
    });
    expect(model.connections[0].nodeIds).toEqual([
      "source-start",
      "source-upper",
    ]);
    expect(
      model.edges.every((e) => e.kind !== "elevator" && e.kind !== "steps"),
    ).toBe(true);
    expect(models[1].nodes).toEqual(model.nodes);
    expect(detail).toEqual(original);
  });
  it("prefers the exact source walkway height for a place rather than guessing floor height", () => {
    const { detail } = displayTopologyFixture();
    const walkway = detail.walkways.find((w) => w.id === "lower-approach");
    if (!walkway) throw new Error("Missing synthetic walkway");
    walkway.coordinates[1] = [10, 10, 0.35];
    detail.connections[0].coordinates[0] = [10, 10, 0.35];
    expect(
      venueModels(detail)[0].places.find((p) => p.id === "start")?.point[2],
    ).toBe(0.35);
  });
  it.each([
    "coordinate",
    "level",
    "building",
    "connection-coordinate",
    "place-context",
    "tuple-length",
  ])("rejects contradictory source ID data: %s", (bad) => {
    const { detail } = displayTopologyFixture();
    if (bad === "coordinate")
      detail.walkways[1].coordinates[1] = [10.001, 10, 8];
    if (bad === "level") detail.walkways[1].levelRefs[1] = "1F";
    if (bad === "building") detail.walkways[1].buildingIds[1] = "west";
    if (bad === "connection-coordinate")
      detail.connections[0].coordinates[1] = [10.001, 10, 8];
    if (bad === "place-context") detail.places[1].buildingId = "west";
    if (bad === "tuple-length")
      detail.connections[0].nodeIds = ["source-start"];
    expect(() => venueModels(detail)).toThrow();
  });
  it("retains nullable wall context and metadata without assigning an unknown wall to 1F", () => {
    const { detail } = fixture();
    detail.walls = [
      {
        ...annotation,
        id: "unknown-wall",
        osmRef: "way/unknown-wall",
        buildingId: null,
        levelRef: null,
        ordinal: null,
        thicknessM: null,
        heightPending: true,
        note: "Unsurveyed",
        geometry: {
          type: "LineString",
          coordinates: [
            [10, 10],
            [10, 10.0001],
          ],
        },
      },
    ];
    const wall = venueModels(detail)[0].walls[0];
    expect(wall).toMatchObject({
      osmRef: "way/unknown-wall",
      buildingId: null,
      levelRef: null,
      ordinal: null,
      thicknessM: null,
      heightPending: true,
      note: "Unsurveyed",
    });
    expect(wall.points[0]).toEqual([0, 0]);
  });
  it("normalizes nullable public identity and arrival fields without claiming a known door", () => {
    const { detail } = fixture();
    detail.connections[0].name = null;
    detail.connections[0].ref = null;
    detail.features[0].connectionId = null;
    detail.places[2].featureId = null;
    detail.places[2].arrivalKind = null;
    detail.places[2].doorKnown = null;
    detail.places[2].connectionId = null;
    const model = venueModels(detail)[1];
    const place = model.places[2];
    expect(place).toMatchObject({
      routeEndpoint: "place",
      doorKnown: false,
      arrivalOnly: true,
    });
    expect(place.featureId).toBeUndefined();
    expect(place.connectionId).toBeUndefined();
  });
  it("shares one origin without changing source geometry or inventing a graph/door", () => {
    const { detail } = fixture();
    const original = structuredClone(detail);
    const models = venueModels(detail);
    expect(models).toHaveLength(2);
    expect(models[0].origin).toEqual(models[1].origin);
    expect(models[1].building.levels[1].coverage?.hasDisplayGeometry).toBe(
      false,
    );
    expect(models[1].source.sha256).toBe("synthetic-sha");
    expect(models[1].api?.version).toBe(3);
    expect(models[1].nodes).toEqual([]);
    expect(models[1].edges).toEqual([]);
    const feature = models[1].features[0];
    if (feature.geometry.type !== "Polygon") throw Error("fixture");
    expect(
      localToLngLat(feature.geometry.coordinates[0][0], models[1].origin),
    ).toEqual([10.0002, 10]);
    expect(models[1].places.find((p) => p.id === "end")?.doorKnown).toBe(false);
    expect(detail).toEqual(original);
  });
  it("preserves public additive semantics and explicit source walls only", () => {
    const { detail } = fixture();
    detail.features[0].semantic = {
      areaType: "elevator-shaft",
      amenity: "toilets",
    };
    detail.features[0].connectionIds = ["lift"];
    detail.features[0].tags = { ref: "R-1" };
    detail.walls = [
      {
        ...annotation,
        id: "wall",
        buildingId: "west",
        levelRef: "3F",
        geometry: {
          type: "LineString",
          coordinates: [
            [10.0002, 10],
            [10.0002, 10.0001],
          ],
        },
      },
    ];
    const model = venueModels(detail)[1];
    expect(model.features[0].tags).toMatchObject({
      "a11ymap:area_type": "elevator-shaft",
      amenity: "toilets",
      ref: "R-1",
    });
    expect(model.features[0].connectionId).toBe("lift");
    expect(model.walls[0].ordinal).toBe(2);
  });
  it.each(["level", "coordinate", "duplicate", "wall"])(
    "rejects malformed %s without rendering guessed geometry",
    (kind) => {
      const { detail } = fixture();
      if (kind === "level") detail.places[0].levelRef = "nonexistent";
      if (kind === "coordinate")
        detail.features[0].geometry = { type: "Point", coordinates: [NaN, 10] };
      if (kind === "duplicate")
        detail.buildings[0].levels.push(detail.buildings[0].levels[0]);
      if (kind === "wall")
        detail.walls = [
          {
            ...annotation,
            id: "invalid",
            buildingId: "west",
            levelRef: "absent",
            geometry: {
              type: "LineString",
              coordinates: [
                [10, 10],
                [10, 10.1],
              ],
            },
          },
        ];
      expect(() => validateVenueDetail(detail)).toThrow();
    },
  );
  it("discovers all public venue IDs without a campus constant", async () => {
    const { detail } = fixture();
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        return Response.json({
          ok: true,
          code: 200,
          data: url.endsWith("/venues")
            ? [{ venueId: detail.venueId }]
            : detail,
        });
      }),
    );
    expect(await loadVenueCatalog("http://localhost:9000")).toHaveLength(2);
    expect(urls).toEqual([
      "http://localhost:9000/api/v1/a11y/venues",
      "http://localhost:9000/api/v1/a11y/venues/synthetic-venue",
    ]);
  });
});

describe("published route integrity", () => {
  it("accepts a public slope-inferred ramp with null connectionId and preserves heightPending at equal Z", () => {
    const { detail, route } = fixture();
    route.steps[4].type = "ramp";
    route.steps[4].connectionId = null;
    route.steps[4].heightPending = true;
    const result = convert(detail, route);
    expect(result.steps[4]).toMatchObject({
      kind: "ramp",
      heightPending: true,
    });
    expect(result.steps[4].connectionId).toBeUndefined();
    expect(result.animationSafe).toBe(false);
    route.steps[4].connectionId = "not-a-source-connection";
    expect(() => convert(detail, route)).toThrow();
  });
  it("validates each source span when one stair instruction crosses two floors", () => {
    const { detail, route } = stairsFixture();
    detail.buildings[0].levels.push({
      ordinal: 1,
      ref: "2F",
      elevationM: 4,
      coverage: {
        hasAnchor: true,
        hasRouteData: true,
        hasDisplayGeometry: true,
      },
    });
    const points: XYZ[] = [
      [10, 10, 0],
      [10.00002, 10, 1.5],
      [10, 10, 4],
      [10.00002, 10, 6],
      [10, 10, 8],
    ];
    detail.connections = [0, 2].map((start, i) => ({
      ...annotation,
      id: `span-${i}`,
      kind: "stairs",
      buildingId: "east",
      coordinates: points.slice(start, start + 3),
      levelRefs: i === 0 ? ["1F", null, "2F"] : ["2F", null, "3F"],
      wheelchair: "no",
      osmRef: `way/span-${i}`,
      heightPending: true,
    }));
    route.path = {
      coordinates: points,
      buildingIds: Array(5).fill("east"),
      levelRefs: ["1F", null, "2F", null, "3F"],
    };
    route.segments = [
      { buildingId: "east", levelRef: "1F", pathStart: 0, pathEnd: 2 },
      { buildingId: "east", levelRef: "2F", pathStart: 2, pathEnd: 4 },
      { buildingId: "east", levelRef: "3F", pathStart: 4, pathEnd: 4 },
    ];
    route.steps[1].pathEnd = 4;
    route.steps[2].pathStart = 4;
    route.steps[2].pathEnd = 4;
    expect(convert(detail, route).context?.levelRefs).toEqual(
      route.path.levelRefs,
    );
    detail.connections.pop();
    expect(() => convert(detail, route)).toThrow();
  });
  it.each([false, true])(
    "accepts source-proven stair interior null levels, reverse=%s, without rewriting context",
    (reverse) => {
      const { detail, route } = stairsFixture(reverse);
      const original = structuredClone(route);
      const result = convert(detail, route);
      expect(result.context?.levelRefs).toEqual(route.path.levelRefs);
      expect(result.steps[1]).toMatchObject({
        kind: "steps",
        connectionId: "source-stairs",
        heightPending: true,
        fromLevel: reverse ? "3F" : "1F",
        toLevel: reverse ? "1F" : "3F",
      });
      expect(result.points[1][2]).toBe(reverse ? 5 : 2);
      expect(result.animationSafe).toBe(false);
      expect(route).toEqual(original);
    },
  );
  it.each([
    "walk",
    "missing-source",
    "different-source",
    "explicit-floor",
    "false-departure",
  ])(
    "rejects unproven or contradictory intermediate context: %s",
    (failure) => {
      const { detail, route } = stairsFixture();
      if (failure === "walk") route.steps[1].type = "walk";
      if (failure === "missing-source") detail.connections = [];
      if (failure === "different-source")
        detail.connections[0].coordinates =
          detail.connections[0].coordinates.map((p, i) =>
            i === 1 ? [p[0] + 0.001, p[1], p[2]] : p,
          );
      if (failure === "explicit-floor") route.path.levelRefs[1] = "3F";
      if (failure === "false-departure") route.steps[1].fromLevelRef = "3F";
      expect(() => convert(detail, route)).toThrow();
    },
  );
  it("keeps all points, shared boundaries, API language and actual building context", () => {
    const { detail, route } = fixture();
    const source = structuredClone(route);
    const result = convert(detail, route);
    expect(result.context).toEqual({
      buildingIds: route.path.buildingIds,
      levelRefs: route.path.levelRefs,
    });
    expect(result.steps[3]).toMatchObject({
      action: "enter",
      instruction: "Enter west hall",
      buildingId: "west",
      fromBuildingId: "east",
      toBuildingId: "east",
    });
    expect(result.steps[1]).toMatchObject({
      connectionId: "lift",
      name: "Lift E",
      fromLevel: "1F",
      toLevel: "3F",
    });
    expect(result.steps[4].heightPending).toBe(true);
    expect(result.language).toBe("en");
    expect(
      result.points.map((p) => [
        ...localToLngLat([p[0], p[1]], detail.center),
        p[2],
      ]),
    ).toEqual(route.path.coordinates);
    expect(route).toEqual(source);
  });
  it("retains a zero-length arrival-floor segment after skipping nonstops", () => {
    const { detail, route } = fixture();
    route.toPlaceId = "landing";
    route.path.coordinates = route.path.coordinates.slice(0, 2);
    route.path.buildingIds = ["east", "east"];
    route.path.levelRefs = ["1F", "3F"];
    route.steps = route.steps.slice(0, 2);
    route.steps.push({
      ...route.steps[0],
      type: "arrive",
      instruction: "Arrived",
      levelRef: "3F",
      pathStart: 1,
      pathEnd: 1,
    });
    route.segments = [
      route.segments[0],
      { buildingId: "east", levelRef: "3F", pathStart: 1, pathEnd: 1 },
    ];
    expect(convert(detail, route).segments?.at(-1)).toMatchObject({
      pathStart: 1,
      pathEnd: 1,
      levelRef: "3F",
    });
  });
  it.each([
    "wrong-endpoint",
    "wrong-context",
    "version",
    "gap",
    "negative",
    "nonstop",
    "nan",
  ])("fails closed for %s", (kind) => {
    const { detail, route } = fixture();
    if (kind === "wrong-endpoint") route.path.coordinates[4][0] += 0.001;
    if (kind === "wrong-context") route.path.levelRefs[4] = "1F";
    if (kind === "version") route.venueVersion++;
    if (kind === "gap") route.steps[4].pathStart = 3;
    if (kind === "negative") route.steps[4].durationS = -1;
    if (kind === "nonstop") detail.connections[0].levelRefs[1] = "1F";
    if (kind === "nan") route.path.coordinates[3][2] = NaN;
    expect(() => convert(detail, route)).toThrow();
  });
  it.each(["wheelchair", "elderly", "visual_impaired"] as const)(
    "does not publish stairs for %s or change requested profile",
    (mode) => {
      const { detail, route } = fixture();
      route.mode = mode;
      route.steps[1].type = "stairs";
      expect(() => convert(detail, route)).toThrow(/移動條件/);
      expect(route.mode).toBe(mode);
    },
  );
  it("does not let null intermediate levels conceal an unsupported floor change", () => {
    const { detail, route } = fixture();
    route.steps[1].type = "ramp";
    expect(() => convert(detail, route)).toThrow(/非電梯/);
  });
});

describe("API provider integration", () => {
  it("refreshes and retries once with the same scoped places, preserving the original catalog", async () => {
    const { detail, route } = fixture();
    const models = venueModels(detail);
    const origin = toVenuePlaceDetail(models[0], models[0].places[0]);
    const destination = toVenuePlaceDetail(models[1], models[1].places[2]);
    detail.version = 4;
    route.venueVersion = 4;
    const methods: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        methods.push(init.method ?? "GET");
        return Response.json({
          ok: true,
          code: 200,
          data: init.method === "POST" ? route : detail,
        });
      }),
    );
    const result = await planVenueJourney({
      models,
      origin,
      destination,
      mode: "wheelchair",
      language: "en",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw Error(result.message);
    expect(result.journey.from.placeId).toBe(origin.placeId);
    expect(result.journey.to.placeId).toBe(destination.placeId);
    expect(result.journey.sourceVersion).toBe("synthetic-venue:4");
    expect(result.refreshedModels?.map((m) => m.api?.version)).toEqual([4, 4]);
    expect(models[0].api?.version).toBe(3);
    expect(origin.sourceVersion).toBe("synthetic-venue:3");
    expect(methods).toEqual(["GET", "GET", "POST"]);
  });
  it("does not retry a removed endpoint or silently move it to another floor", async () => {
    const { detail } = fixture();
    const models = venueModels(detail);
    const origin = toVenuePlaceDetail(models[0], models[0].places[0]);
    const destination = toVenuePlaceDetail(models[1], models[1].places[2]);
    detail.version++;
    detail.places[2].levelRef = "1F";
    const fetch = vi.fn(async () =>
      Response.json({ ok: true, code: 200, data: detail }),
    );
    vi.stubGlobal("fetch", fetch);
    expect(
      await planVenueJourney({ models, origin, destination, mode: "normal" }),
    ).toMatchObject({
      ok: false,
      reason: "UNSUPPORTED_API_PLACE",
      refreshedModels: expect.any(Array),
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects a changed source hash under an unchanged published version", async () => {
    const { detail } = fixture();
    const model = venueModels(detail)[1];
    detail.sourceSha256 = "different-source";
    const fetch = vi.fn(async () =>
      Response.json({ ok: true, code: 200, data: detail }),
    );
    vi.stubGlobal("fetch", fetch);
    const result = await planBackendVenueRoute({
      baseUrl: "http://localhost:9000",
      model,
      from: toVenuePlaceDetail(model, model.places[0]),
      to: toVenuePlaceDetail(model, model.places[2]),
      mode: "normal",
    });
    expect(result).toMatchObject({ ok: false, reason: "SOURCE_MISMATCH" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("uses the public route with no local graph and preserves real instructions", async () => {
    const { detail, route } = fixture();
    const model = venueModels(detail)[1];
    const requests: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        if (init.method === "POST")
          requests.push(JSON.parse(String(init.body)));
        return Response.json({
          ok: true,
          code: 200,
          data: init.method === "POST" ? route : detail,
        });
      }),
    );
    const result = await planBackendVenueRoute({
      baseUrl: "http://localhost:9000",
      model,
      from: toVenuePlaceDetail(model, model.places[0]),
      to: toVenuePlaceDetail(model, model.places[2]),
      mode: "wheelchair",
      language: "en",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw Error(result.message);
    expect(result.route.steps[1].instruction).toBe("Take Lift E to 3F");
    expect(requests).toEqual([
      {
        fromPlaceId: "start",
        toPlaceId: "end",
        mode: "wheelchair",
        language: "en",
      },
    ]);
  });
  it("returns refreshed models on version drift before sending any stale route POST", async () => {
    const { detail } = fixture();
    const model = venueModels(detail)[1];
    const calls: string[] = [];
    detail.version++;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        calls.push(init.method ?? "GET");
        return Response.json({ ok: true, code: 200, data: detail });
      }),
    );
    const result = await planBackendVenueRoute({
      baseUrl: "http://localhost:9000",
      model,
      from: toVenuePlaceDetail(model, model.places[0]),
      to: toVenuePlaceDetail(model, model.places[2]),
      mode: "normal",
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "VENUE_VERSION_CHANGED",
      refreshedModels: [{ api: { version: 4 } }, { api: { version: 4 } }],
    });
    expect(calls).toEqual(["GET"]);
  });
});
