import { ApiError, fetchRequest } from "@/lib/fetch";
import { lngLatToLocal } from "./coordinates";
import { effectiveVerticalPreference } from "./profilePolicy";
import type {
  IndoorConnection,
  IndoorEdge,
  IndoorFeature,
  IndoorMode,
  IndoorNode,
  IndoorRoute,
  IndoorRouteStep,
  IndoorVerticalPreference,
  LocalIndoorModel,
  XY,
  XYZ,
} from "./types";

interface Annotations {
  geometryStatus: "surveyed" | "traced" | "schematic";
  heightStatus: "measured" | "drawing" | "estimated";
  source?: string;
  heightPending?: boolean;
  tags?: Record<string, string>;
  note?: string;
  fixme?: string;
}
export interface VenueWalkway extends Annotations {
  id: string;
  kind: "corridor" | "footway" | "path" | "pedestrian" | "service" | "crossing";
  indoor: boolean;
  coordinates: [XYZ, XYZ];
  nodeIds?: [string, string];
  buildingId: string | null;
  levelRef: string | null;
  buildingIds: [string | null, string | null];
  levelRefs: [string | null, string | null];
  wheelchair: "yes" | "no" | "limited" | "unknown";
  osmRef: string;
}
export interface VenueDetail {
  venueId: string;
  name: string;
  version: number;
  importedAt: string;
  center: XY;
  sourceSha256: string | null;
  buildings: (Annotations & {
    id: string;
    name: string;
    aliases: string[];
    footprint: XY[][];
    floorHeightM: number;
    groundOffsetM: number;
    levels: {
      ordinal: number;
      ref: string;
      elevationM: number;
      coverage: {
        hasAnchor: boolean;
        hasRouteData: boolean;
        hasDisplayGeometry: boolean;
      };
    }[];
  })[];
  places: {
    id: string;
    name: string;
    ref?: string;
    kind: string;
    buildingId: string | null;
    levelRef: string | null;
    nodeId: string;
    /** Exact, same-context source nodes; includes the primary nodeId. */
    arrivalNodeIds?: string[];
    location: XY;
    wheelchair?: string;
    arrivalKind?: "door" | "corridor" | "place" | null;
    doorKnown?: boolean | null;
    featureId?: string | null;
    connectionId?: string | null;
    connectionIds?: string[];
  }[];
  features: (Annotations &
    Omit<IndoorFeature, "geometry" | "tags" | "connectionId"> & {
      connectionId?: string | null;
      osmRef?: string;
      semantic?: { areaType?: string; amenity?: string; indoor?: string };
      geometry:
        | { type: "Polygon"; coordinates: XY[][] }
        | { type: "Point"; coordinates: XY };
    })[];
  walls?: (Annotations & {
    id: string;
    osmRef?: string;
    buildingId: string | null;
    ordinal?: number | null;
    levelRef: string | null;
    thicknessM?: number | null;
    geometry: { type: "LineString"; coordinates: XY[] };
  })[];
  walkways: VenueWalkway[];
  connections: (Annotations & {
    id: string;
    kind: "stairs" | "steps" | "ramp" | "escalator" | "elevator";
    buildingId: string | null;
    coordinates: XYZ[];
    nodeIds?: string[];
    levelRefs: (string | null)[];
    wheelchair: "yes" | "no" | "limited" | "unknown";
    osmRef: string;
    slopeRatio?: number;
    stepCount?: number;
    name?: string | null;
    ref?: string | null;
    featureIds?: string[];
  })[];
}
export interface VenueRouteResponse {
  venueId: string;
  venueVersion: number;
  mode: IndoorMode;
  fromPlaceId: string;
  toPlaceId: string;
  distanceM: number;
  durationS: number;
  elevatorRides: number;
  stairFlights: number;
  path: {
    coordinates: XYZ[];
    buildingIds: (string | null)[];
    levelRefs: (string | null)[];
  };
  segments: {
    buildingId: string | null;
    levelRef: string | null;
    pathStart: number;
    pathEnd: number;
  }[];
  steps: {
    type:
      | "depart"
      | "walk"
      | "enter"
      | "exit"
      | "elevator"
      | "escalator"
      | "stairs"
      | "steps"
      | "ramp"
      | "arrive";
    instruction: string;
    maneuver?: "left" | "right" | "uturn";
    distanceM: number;
    durationS: number;
    buildingId: string | null;
    levelRef: string | null;
    fromLevelRef?: string;
    toLevelRef?: string;
    pathStart: number;
    pathEnd: number;
    connectionId?: string | null;
    heightPending?: boolean;
  }[];
}
export const campusVersion = (venueId: string, version: number) =>
  `${venueId}:${version}`;
function requireData(
  condition: unknown,
  message = "場域資料格式不符新版契約，請更新服務後重試。",
): asserts condition {
  if (!condition) throw new ApiError(message, 502, "INVALID_BACKEND_DATA");
}
const finitePoint = (p: unknown, length: number): p is number[] =>
  Array.isArray(p) && p.length === length && p.every(Number.isFinite);
const geoPoint = (p: unknown, length: number) =>
  finitePoint(p, length) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
const contextRef = (value: unknown) =>
  value === null || typeof value === "string";

/** Fail closed on old display contracts. Coverage is data presence, not accessibility. */
export function validateVenueDetail(value: unknown): VenueDetail {
  const d = value as VenueDetail;
  requireData(
    d &&
      typeof d.venueId === "string" &&
      typeof d.name === "string" &&
      Number.isInteger(d.version) &&
      d.version > 0 &&
      typeof d.importedAt === "string" &&
      (d.sourceSha256 === null || typeof d.sourceSha256 === "string") &&
      geoPoint(d.center, 2) &&
      Array.isArray(d.buildings) &&
      d.buildings.length > 0 &&
      Array.isArray(d.places) &&
      Array.isArray(d.features) &&
      Array.isArray(d.walkways) &&
      Array.isArray(d.connections),
  );
  const ids = new Set<string>();
  for (const b of d.buildings) {
    requireData(
      typeof b.id === "string" &&
        !ids.has(b.id) &&
        typeof b.name === "string" &&
        Array.isArray(b.aliases) &&
        b.aliases.every((a) => typeof a === "string") &&
        Number.isFinite(b.floorHeightM) &&
        Number.isFinite(b.groundOffsetM) &&
        Array.isArray(b.footprint) &&
        b.footprint.length > 0 &&
        b.footprint.every(
          (r) =>
            Array.isArray(r) && r.length >= 4 && r.every((p) => geoPoint(p, 2)),
        ) &&
        Array.isArray(b.levels) &&
        b.levels.length > 0,
    );
    ids.add(b.id);
    requireData(
      new Set(b.levels.map((l) => l.ref)).size === b.levels.length &&
        new Set(b.levels.map((l) => l.ordinal)).size === b.levels.length,
    );
    for (const l of b.levels)
      requireData(
        Number.isInteger(l.ordinal) &&
          typeof l.ref === "string" &&
          Number.isFinite(l.elevationM) &&
          l.coverage &&
          [
            l.coverage.hasAnchor,
            l.coverage.hasRouteData,
            l.coverage.hasDisplayGeometry,
          ].every((v) => typeof v === "boolean"),
      );
  }
  const placeIds = new Set<string>();
  for (const p of d.places) {
    requireData(
      typeof p.id === "string" &&
        !placeIds.has(p.id) &&
        typeof p.name === "string" &&
        typeof p.nodeId === "string" &&
        typeof p.kind === "string" &&
        geoPoint(p.location, 2) &&
        contextRef(p.buildingId) &&
        contextRef(p.levelRef) &&
        validContext(d, p.buildingId, p.levelRef) &&
        (p.arrivalNodeIds === undefined ||
          (Array.isArray(p.arrivalNodeIds) &&
            p.arrivalNodeIds.length > 0 &&
            p.arrivalNodeIds.length <= 16 &&
            new Set(p.arrivalNodeIds).size === p.arrivalNodeIds.length &&
            p.arrivalNodeIds.every(
              (id) => typeof id === "string" && id.length > 0,
            ) &&
            p.arrivalNodeIds.includes(p.nodeId))),
    );
    placeIds.add(p.id);
  }
  for (const f of d.features)
    requireData(
      f?.geometry &&
        typeof f.id === "string" &&
        ["room", "area", "corridor", "door", "elevator", "stairs"].includes(
          f.kind,
        ) &&
        validContext(d, f.buildingId ?? null, f.levelRef) &&
        (f.geometry.type === "Point"
          ? geoPoint(f.geometry.coordinates, 2)
          : f.geometry.type === "Polygon" &&
            Array.isArray(f.geometry.coordinates) &&
            f.geometry.coordinates.length > 0 &&
            f.geometry.coordinates.every(
              (r) =>
                Array.isArray(r) &&
                r.length >= 4 &&
                r.every((p) => geoPoint(p, 2)),
            )),
    );
  for (const w of d.walkways)
    requireData(
      Array.isArray(w.coordinates) &&
        w.coordinates.length === 2 &&
        w.coordinates.every((p) => geoPoint(p, 3)) &&
        Array.isArray(w.buildingIds) &&
        w.buildingIds.length === 2 &&
        w.buildingIds.every(contextRef) &&
        Array.isArray(w.levelRefs) &&
        w.levelRefs.length === 2 &&
        w.levelRefs.every(contextRef) &&
        validSourceNodeIds(w.nodeIds, w.coordinates.length),
    );
  for (const c of d.connections)
    requireData(
      Array.isArray(c.coordinates) &&
        c.coordinates.length >= 2 &&
        c.coordinates.every((p) => geoPoint(p, 3)) &&
        Array.isArray(c.levelRefs) &&
        c.levelRefs.length === c.coordinates.length &&
        c.levelRefs.every(contextRef) &&
        validSourceNodeIds(c.nodeIds, c.coordinates.length),
    );
  for (const collection of [d.features, d.walkways, d.connections]) {
    requireData(
      new Set(collection.map((item) => item.id)).size === collection.length,
    );
    for (const item of collection)
      requireData(
        typeof item.id === "string" &&
          ["surveyed", "traced", "schematic"].includes(item.geometryStatus) &&
          ["measured", "drawing", "estimated"].includes(item.heightStatus) &&
          (item.heightPending === undefined ||
            typeof item.heightPending === "boolean") &&
          (item.tags === undefined ||
            (!!item.tags &&
              typeof item.tags === "object" &&
              Object.values(item.tags).every(
                (value) => typeof value === "string",
              ))),
      );
  }
  for (const w of d.walkways)
    requireData(
      w.buildingIds.every((id, i) => validContext(d, id, w.levelRefs[i])),
    );
  for (const c of d.connections)
    requireData(
      ["stairs", "steps", "ramp", "escalator", "elevator"].includes(c.kind) &&
        c.levelRefs.every((ref) => validContext(d, c.buildingId, ref)),
    );
  requireData(d.walls === undefined || Array.isArray(d.walls));
  for (const wall of d.walls ?? [])
    requireData(
      typeof wall.id === "string" &&
        contextRef(wall.buildingId) &&
        contextRef(wall.levelRef) &&
        (wall.buildingId === null ||
          validContext(d, wall.buildingId, wall.levelRef)) &&
        (wall.ordinal == null || Number.isInteger(wall.ordinal)) &&
        (wall.thicknessM == null ||
          (Number.isFinite(wall.thicknessM) && wall.thicknessM > 0)) &&
        (wall.buildingId === null ||
          wall.levelRef === null ||
          wall.ordinal == null ||
          d.buildings
            .find((b) => b.id === wall.buildingId)
            ?.levels.find((l) => l.ref === wall.levelRef)?.ordinal ===
            wall.ordinal) &&
        wall.geometry?.type === "LineString" &&
        Array.isArray(wall.geometry.coordinates) &&
        wall.geometry.coordinates.length >= 2 &&
        wall.geometry.coordinates.every((p) => geoPoint(p, 2)),
    );
  for (const place of d.places)
    if (place.arrivalNodeIds) sourceArrivalPoints(d, place);
  return d;
}
function validSourceNodeIds(value: unknown, length: number) {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length === length &&
      value.every((id) => typeof id === "string" && id.length > 0))
  );
}
function annotationTags(a: Annotations): Record<string, string> {
  return Object.fromEntries(
    Object.entries({
      ...a.tags,
      source: a.source,
      note: a.note,
      fixme: a.fixme,
      "a11ymap:geometry_status": a.geometryStatus,
      "a11ymap:height_status": a.heightStatus,
      "a11ymap:height_pending": a.heightPending ? "yes" : undefined,
    }).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

/** Public topology is used only to identify display approaches. Do not derive
 * navigation edges for vertical connections or infer missing source IDs. */
function displayTopology(d: VenueDetail): {
  nodes: IndoorNode[];
  edges: IndoorEdge[];
} {
  const nodes = new Map<string, IndoorNode>();
  const sourcePoints = new Map<
    string,
    { point: XYZ; levelRef: string | null }
  >();
  const remember = (id: string, point: XYZ, levelRef: string | null) => {
    const previous = sourcePoints.get(id);
    requireData(
      !previous ||
        (samePoint(previous.point, point, d.center) &&
          previous.levelRef === levelRef),
      "同一來源節點的座標或樓層不一致，請重新載入場域資料。",
    );
    sourcePoints.set(id, { point, levelRef });
  };
  const edges: IndoorEdge[] = [];
  for (const walkway of d.walkways) {
    if (!walkway.nodeIds) continue;
    for (const [i, id] of walkway.nodeIds.entries()) {
      const point = walkway.coordinates[i],
        buildingId = walkway.buildingIds[i],
        levelRef = walkway.levelRefs[i];
      remember(id, point, levelRef);
      const previous = nodes.get(id);
      requireData(
        !previous ||
          (previous.buildingId === buildingId &&
            previous.levelRef === levelRef),
        "同一來源節點的建築或樓層不一致，請重新載入場域資料。",
      );
      if (!previous)
        nodes.set(id, {
          id,
          buildingId,
          levelRef,
          ordinal:
            d.buildings
              .find((b) => b.id === buildingId)
              ?.levels.find((l) => l.ref === levelRef)?.ordinal ?? null,
          point: [...lngLatToLocal([point[0], point[1]], d.center), point[2]],
          kind: walkway.kind,
        });
    }
    const a = nodes.get(walkway.nodeIds[0]),
      b = nodes.get(walkway.nodeIds[1]);
    requireData(a && b);
    edges.push({
      id: walkway.id,
      from: walkway.nodeIds[0],
      to: walkway.nodeIds[1],
      kind: walkway.kind,
      lengthM: Math.hypot(
        a.point[0] - b.point[0],
        a.point[1] - b.point[1],
        a.point[2] - b.point[2],
      ),
      wheelchair: walkway.wheelchair,
      ramp: false,
      heightPending: walkway.heightPending === true,
      geometryStatus: walkway.geometryStatus,
      heightStatus: walkway.heightStatus,
      tags: annotationTags(walkway),
      osmRef: walkway.osmRef,
    });
  }
  // A connection's buildingId is aggregate: a boundary ramp may also have
  // outdoor endpoints. Only walkways provide exact per-point building IDs.
  for (const connection of d.connections) {
    if (!connection.nodeIds) continue;
    for (const [i, id] of connection.nodeIds.entries()) {
      remember(id, connection.coordinates[i], connection.levelRefs[i]);
      const node = nodes.get(id);
      if (node && connection.levelRefs[i] !== null)
        requireData(node.buildingId === connection.buildingId);
    }
  }
  for (const place of d.places) {
    const source = sourcePoints.get(place.nodeId),
      node = nodes.get(place.nodeId);
    if (source)
      requireData(
        samePoint(
          source.point,
          [...place.location, source.point[2]],
          d.center,
        ) && source.levelRef === place.levelRef,
        "地點與其來源節點不一致，請重新載入場域資料。",
      );
    if (node)
      requireData(
        node.buildingId === place.buildingId &&
          node.levelRef === place.levelRef,
      );
  }
  return { nodes: [...nodes.values()], edges };
}

/** Display adapter only. It never reconstructs a routing graph or infers doors. */
export function venueModels(detail: VenueDetail): LocalIndoorModel[] {
  const d = validateVenueDetail(detail);
  const buildings = d.buildings;
  const ids = new Set(buildings.map((b) => b.id));
  const allowed = (id: string | null | undefined) =>
    id === null || (id !== undefined && ids.has(id));
  const xy = (p: XY) => lngLatToLocal(p, d.center);
  const xyz = (p: XYZ): XYZ => [...xy([p[0], p[1]]), p[2]];
  const connections: IndoorConnection[] = d.connections.map((c) => ({
    ...c,
    ref: c.ref ?? undefined,
    name:
      c.name ??
      (c.kind === "elevator"
        ? "電梯"
        : c.kind === "ramp"
          ? "坡道"
          : "樓梯／通行設施"),
    heightPending: c.heightPending === true,
    tags: { ...annotationTags(c), ...(c.ref ? { ref: c.ref } : {}) },
    coordinates: c.coordinates.map(xyz),
  }));
  const campus: NonNullable<LocalIndoorModel["campus"]> = {
    walkways: d.walkways.map((w) => ({
      ...w,
      coordinates: [xyz(w.coordinates[0]), xyz(w.coordinates[1])],
    })),
    connections,
  };
  const places = d.places.filter((p) => allowed(p.buildingId));
  const topology = displayTopology(d);
  const displayNodes = new Map(topology.nodes.map((node) => [node.id, node]));
  return buildings.map((b) => ({
    schemaVersion: 1,
    api: {
      version: d.version,
      sourceSha256: d.sourceSha256,
      importedAt: d.importedAt,
    },
    venueId: d.venueId,
    name: d.name,
    source: {
      sha256: d.sourceSha256 ?? "",
      generatedAt: d.importedAt,
      warnings: [],
    },
    origin: d.center,
    building: { ...b, footprint: b.footprint.map((r) => r.map(xy)) },
    features: d.features
      .filter((f) => f.buildingId === b.id)
      .map((f) => ({
        ...f,
        tags: {
          ...annotationTags(f),
          ...(f.semantic?.areaType
            ? { "a11ymap:area_type": f.semantic.areaType }
            : {}),
          ...(f.semantic?.amenity ? { amenity: f.semantic.amenity } : {}),
          ...(f.semantic?.indoor ? { indoor: f.semantic.indoor } : {}),
        },
        connectionId:
          f.connectionId ??
          (f.connectionIds?.length === 1 ? f.connectionIds[0] : undefined),
        geometry:
          f.geometry.type === "Point"
            ? { type: "Point", coordinates: xy(f.geometry.coordinates) }
            : {
                type: "Polygon",
                coordinates: f.geometry.coordinates.map((r) => r.map(xy)),
              },
      })),
    connections: connections.filter((c) => c.buildingId === b.id),
    campus,
    // All official endpoints are available to a venue-level journey. The catalog
    // filters them by building, so no cross-building labels inherit this model's name.
    places: places.map((p) => ({
      ...p,
      featureId: p.featureId ?? undefined,
      connectionId:
        p.connectionId ??
        (p.connectionIds?.length === 1 ? p.connectionIds[0] : undefined),
      point:
        displayNodes.get(p.nodeId)?.point ??
        ([
          ...xy(p.location),
          buildings
            .find((v) => v.id === p.buildingId)
            ?.levels.find((l) => l.ref === p.levelRef)?.elevationM ?? 0,
        ] as XYZ),
      routeEndpoint: p.arrivalKind ?? "place",
      doorKnown: p.doorKnown === true && p.arrivalKind === "door",
      arrivalOnly: p.arrivalKind !== "door" || p.doorKnown !== true,
      tags: Object.fromEntries(
        p.wheelchair ? [["wheelchair", p.wheelchair]] : [],
      ),
    })),
    nodes: topology.nodes,
    edges: topology.edges,
    walls: (d.walls ?? [])
      .filter((w) => w.buildingId === b.id || w.buildingId === null)
      .map((w) => ({
        id: w.id,
        osmRef: w.osmRef,
        buildingId: w.buildingId,
        levelRef: w.levelRef,
        ordinal:
          w.buildingId === b.id && w.levelRef !== null
            ? (b.levels.find((l) => l.ref === w.levelRef)?.ordinal ?? null)
            : null,
        thicknessM: w.thicknessM,
        geometryStatus: w.geometryStatus,
        heightStatus: w.heightStatus,
        heightPending: w.heightPending,
        source: w.source,
        note: w.note,
        fixme: w.fixme,
        points: w.geometry.coordinates.map(xy),
        tags: annotationTags(w),
      })),
    preview: {
      levels: b.levels
        .filter((l) => l.coverage.hasDisplayGeometry || l.coverage.hasRouteData)
        .map((l) => l.ordinal),
      gatePlaceIds: places.filter((p) => p.kind === "gate").map((p) => p.id),
    },
  }));
}

export async function loadVenue(
  baseUrl: string,
  venueId: string,
  signal?: AbortSignal,
): Promise<VenueDetail> {
  const response = await fetchRequest(
    `${baseUrl.replace(/\/$/, "")}/api/v1/a11y/venues/${encodeURIComponent(venueId)}`,
    { signal, cache: "no-store" },
  );
  requireData(response.ok && response.data);
  const detail = validateVenueDetail(response.data);
  requireData(detail.venueId === venueId);
  return detail;
}
/** Discover published venues; no campus identifier is embedded in application code. */
export async function loadVenueCatalog(
  baseUrl: string,
  signal?: AbortSignal,
): Promise<LocalIndoorModel[]> {
  const result = await fetchRequest(
    `${baseUrl.replace(/\/$/, "")}/api/v1/a11y/venues`,
    { signal, cache: "no-store" },
  );
  requireData(result.ok && Array.isArray(result.data));
  const entries = result.data as { venueId: string }[];
  requireData(
    entries.every(
      (entry) => typeof entry.venueId === "string" && entry.venueId.length > 0,
    ),
  );
  requireData(
    new Set(entries.map((entry) => entry.venueId)).size === entries.length,
  );
  const details = await Promise.all(
    entries.map((entry) => loadVenue(baseUrl, entry.venueId, signal)),
  );
  return details.flatMap(venueModels);
}

/** Source point equality uses the public API's decimal precision, never snapping. */
function samePoint(a: XYZ, b: XYZ, origin: XY) {
  const ap = lngLatToLocal([a[0], a[1]], origin);
  const bp = lngLatToLocal([b[0], b[1]], origin);
  return (
    Math.hypot(ap[0] - bp[0], ap[1] - bp[1]) <= 0.002 &&
    Math.abs(a[2] - b[2]) <= 0.011
  );
}

function validContext(
  detail: VenueDetail,
  building: string | null,
  level: string | null,
) {
  if (building === null) return level === null;
  const b = detail.buildings.find((item) => item.id === building);
  return !!b && (level === null || b.levels.some((item) => item.ref === level));
}

/** Match a public source chain without changing either it or the returned route. */
function coversSourceSegment(a: XYZ, b: XYZ, chain: XYZ[], origin: XY) {
  return chain.some((point, index) => {
    const next = chain[index + 1];
    return (
      next &&
      ((samePoint(a, point, origin) && samePoint(b, next, origin)) ||
        (samePoint(b, point, origin) && samePoint(a, next, origin)))
    );
  });
}

/** Resolve only explicitly published node identities, never spatial or label matches. */
function sourceArrivalPoints(
  d: VenueDetail,
  place: VenueDetail["places"][number],
): XYZ[] {
  return (place.arrivalNodeIds ?? [place.nodeId]).map((id) => {
    const sources: {
      point: XYZ;
      buildingId: string | null;
      levelRef: string | null;
    }[] = [];
    for (const walkway of d.walkways)
      walkway.nodeIds?.forEach((nodeId, i) => {
        if (nodeId === id)
          sources.push({
            point: walkway.coordinates[i],
            buildingId: walkway.buildingIds[i],
            levelRef: walkway.levelRefs[i],
          });
      });
    // A connection's building is authoritative for its named indoor landings.
    // Null-level boundary points need the walkway's per-point ownership above.
    for (const connection of d.connections)
      connection.nodeIds?.forEach((nodeId, i) => {
        if (nodeId === id && connection.levelRefs[i] !== null)
          sources.push({
            point: connection.coordinates[i],
            buildingId: connection.buildingId,
            levelRef: connection.levelRefs[i],
          });
      });
    requireData(
      sources.length > 0 &&
        sources.every(
          (source) =>
            source.buildingId === place.buildingId &&
            source.levelRef === place.levelRef &&
            samePoint(source.point, sources[0].point, d.center),
        ),
      "地點到達點的來源節點、建築或樓層不一致，請重新載入場域資料。",
    );
    if (id === place.nodeId)
      requireData(
        samePoint(
          sources[0].point,
          [...place.location, sources[0].point[2]],
          d.center,
        ),
        "地點與其來源節點不一致，請重新載入場域資料。",
      );
    return sources[0].point;
  });
}

/** Keep the official path and inclusive boundaries; no reconstructed routing graph. */
export function officialRoute(
  d: VenueDetail,
  r: VenueRouteResponse,
  from: string,
  to: string,
  mode: IndoorMode,
  language: "zh-TW" | "en" = "zh-TW",
  preference: IndoorVerticalPreference = "auto",
): IndoorRoute {
  requireData(
    r &&
      r.venueId === d.venueId &&
      r.fromPlaceId === from &&
      r.toPlaceId === to &&
      r.mode === mode,
  );
  if (r.venueVersion !== d.version)
    throw new ApiError(
      "圖資版本已更新，請重新規劃。",
      409,
      "VENUE_VERSION_CHANGED",
    );
  const path = r.path;
  requireData(
    path &&
      Array.isArray(path.coordinates) &&
      path.coordinates.length > 0 &&
      path.coordinates.every((p) => geoPoint(p, 3)) &&
      Array.isArray(path.buildingIds) &&
      path.buildingIds.length === path.coordinates.length &&
      Array.isArray(path.levelRefs) &&
      path.levelRefs.length === path.coordinates.length &&
      path.buildingIds.every(
        (id, index) =>
          contextRef(id) &&
          contextRef(path.levelRefs[index]) &&
          validContext(d, id, path.levelRefs[index]),
      ) &&
      Number.isFinite(r.distanceM) &&
      r.distanceM >= 0 &&
      Number.isFinite(r.durationS) &&
      r.durationS >= 0 &&
      Array.isArray(r.steps) &&
      r.steps.length > 0 &&
      Array.isArray(r.segments) &&
      r.segments.length > 0,
  );
  for (const [id, index] of [
    [from, 0],
    [to, path.coordinates.length - 1],
  ] as const) {
    const place = d.places.find((item) => item.id === id);
    requireData(
      place &&
        place.buildingId === path.buildingIds[index] &&
        place.levelRef === path.levelRefs[index],
    );
    const point = path.coordinates[index];
    const expectedZ = d.buildings
      .find((b) => b.id === place.buildingId)
      ?.levels.find((l) => l.ref === place.levelRef)?.elevationM;
    requireData(
      place.arrivalNodeIds
        ? sourceArrivalPoints(d, place).some((source) =>
            samePoint(point, source, d.center),
          )
        : samePoint(
            point,
            [...place.location, expectedZ ?? point[2]],
            d.center,
          ),
      "後端路線端點與選定地點不一致，請重新規劃。",
    );
  }
  const validRange = (s: { pathStart: number; pathEnd: number }) =>
    Number.isInteger(s.pathStart) &&
    Number.isInteger(s.pathEnd) &&
    s.pathStart >= 0 &&
    s.pathEnd >= s.pathStart &&
    s.pathEnd < path.coordinates.length;
  const actions = [
    "depart",
    "walk",
    "enter",
    "exit",
    "elevator",
    "escalator",
    "stairs",
    "steps",
    "ramp",
    "arrive",
  ];
  // Boundary steps can carry an outdoor aggregate buildingId while their level
  // describes the indoor endpoint. Point context remains the rendering truth.
  const validStepLevel = (
    s: VenueRouteResponse["steps"][number],
    ref: string | null,
  ) =>
    ref === null ||
    [
      s.buildingId,
      path.buildingIds[s.pathStart],
      path.buildingIds[s.pathEnd],
    ].some((id) => id !== null && validContext(d, id, ref));
  requireData(
    r.steps.every(
      (s) =>
        validRange(s) &&
        actions.includes(s.type) &&
        typeof s.instruction === "string" &&
        Number.isFinite(s.distanceM) &&
        s.distanceM >= 0 &&
        Number.isFinite(s.durationS) &&
        s.durationS >= 0 &&
        (s.buildingId === null ||
          d.buildings.some((b) => b.id === s.buildingId)) &&
        validStepLevel(s, s.levelRef) &&
        (s.fromLevelRef === undefined || validStepLevel(s, s.fromLevelRef)) &&
        (s.toLevelRef === undefined || validStepLevel(s, s.toLevelRef)),
    ),
  );
  requireData(
    r.steps[0].pathStart === 0 &&
      r.steps.at(-1)?.pathEnd === path.coordinates.length - 1 &&
      r.steps.every(
        (s, i) => i === 0 || s.pathStart === r.steps[i - 1].pathEnd,
      ),
  );
  // Segment labels retain the last known landing during a vertical traversal.
  // Only source-proven interior points may therefore have a null point level.
  // Check every adjacent pair, including its level labels, so a merged stair
  // instruction can span several source connections without inventing a join.
  const verifiedVerticalInteriors = new Map<number, string>();
  for (const step of r.steps) {
    if (
      !["stairs", "steps", "elevator", "escalator", "ramp"].includes(step.type)
    )
      continue;
    const building = path.buildingIds[step.pathStart];
    const fromLevel = path.levelRefs[step.pathStart];
    const toLevel = path.levelRefs[step.pathEnd];
    if (
      building === null ||
      fromLevel === null ||
      toLevel === null ||
      (step.fromLevelRef !== undefined && step.fromLevelRef !== fromLevel) ||
      (step.toLevelRef !== undefined && step.toLevelRef !== toLevel)
    )
      continue;
    const connections = d.connections.filter(
      (c) =>
        c.buildingId === building &&
        (step.connectionId == null || c.id === step.connectionId) &&
        (c.kind === step.type ||
          (["stairs", "steps"].includes(c.kind) &&
            ["stairs", "steps"].includes(step.type))),
    );
    const proven = Array.from(
      { length: step.pathEnd - step.pathStart },
      (_, i) => step.pathStart + i,
    ).every(
      (i) =>
        path.buildingIds[i] === building &&
        path.buildingIds[i + 1] === building &&
        connections.some((c) =>
          c.coordinates.some((point, j) => {
            const next = c.coordinates[j + 1];
            if (!next) return false;
            return (
              (samePoint(path.coordinates[i], point, d.center) &&
                samePoint(path.coordinates[i + 1], next, d.center) &&
                path.levelRefs[i] === c.levelRefs[j] &&
                path.levelRefs[i + 1] === c.levelRefs[j + 1]) ||
              (samePoint(path.coordinates[i], next, d.center) &&
                samePoint(path.coordinates[i + 1], point, d.center) &&
                path.levelRefs[i] === c.levelRefs[j + 1] &&
                path.levelRefs[i + 1] === c.levelRefs[j])
            );
          }),
        ),
    );
    if (!proven) continue;
    let landing = fromLevel;
    for (let i = step.pathStart + 1; i < step.pathEnd; i++) {
      const ref = path.levelRefs[i];
      if (ref === null) verifiedVerticalInteriors.set(i, landing);
      else landing = ref;
    }
  }
  requireData(
    r.segments.every(
      (s) => validRange(s) && validContext(d, s.buildingId, s.levelRef),
    ) &&
      r.segments[0].pathStart === 0 &&
      r.segments.at(-1)?.pathEnd === path.coordinates.length - 1 &&
      r.segments.every(
        (s, i) =>
          (i === 0 || s.pathStart === r.segments[i - 1].pathEnd) &&
          // Inclusive end may belong to the next segment. A zero-length final segment is valid.
          Array.from(
            { length: Math.max(1, s.pathEnd - s.pathStart) },
            (_, j) => s.pathStart + j,
          ).every(
            (j) =>
              path.buildingIds[j] === s.buildingId &&
              (path.levelRefs[j] === s.levelRef ||
                (path.levelRefs[j] === null &&
                  verifiedVerticalInteriors.get(j) === s.levelRef)),
          ),
      ),
  );
  const effective = effectiveVerticalPreference(mode, preference);
  if (
    (effective === "elevator" &&
      r.steps.some((s) => ["stairs", "steps", "escalator"].includes(s.type))) ||
    (effective === "stairs" &&
      r.steps.some((s) => ["elevator", "escalator"].includes(s.type)))
  )
    throw new ApiError(
      "後端路線不符合所選樓層移動條件。",
      422,
      "NO_ACCESSIBLE_ROUTE",
    );
  const warnings = new Set<string>();
  const steps: IndoorRouteStep[] = r.steps.map((s) => {
    const kind =
      s.type === "stairs"
        ? "steps"
        : ["elevator", "escalator", "steps", "ramp"].includes(s.type)
          ? (s.type as "elevator" | "escalator" | "steps" | "ramp")
          : "corridor";
    const indices = Array.from(
      { length: s.pathEnd - s.pathStart },
      (_, i) => i + s.pathStart,
    );
    const matches = d.connections
      .filter(
        (c) =>
          c.kind === s.type ||
          (c.kind === "stairs" && kind === "steps") ||
          (c.kind === "steps" && kind === "steps"),
      )
      .filter(
        (c) =>
          indices.length > 0 &&
          indices.every((i) => {
            if (kind === "elevator")
              return (
                c.levelRefs.includes(path.levelRefs[i]) &&
                c.levelRefs.includes(path.levelRefs[i + 1]) &&
                c.coordinates.some((p) =>
                  samePoint(p, path.coordinates[i], d.center),
                ) &&
                c.coordinates.some((p) =>
                  samePoint(p, path.coordinates[i + 1], d.center),
                )
              );
            return coversSourceSegment(
              path.coordinates[i],
              path.coordinates[i + 1],
              c.coordinates,
              d.center,
            );
          }),
      );
    if (kind === "elevator")
      requireData(
        matches.length === 1,
        "後端電梯路線無法核對來源停靠樓層，請重新載入資料。",
      );
    const connection = matches.length === 1 ? matches[0] : undefined;
    if (s.connectionId != null) requireData(connection?.id === s.connectionId);
    if (mode === "wheelchair" && connection?.wheelchair === "no")
      throw new ApiError(
        "來源設施明確不允許輪椅通行。",
        422,
        "NO_ACCESSIBLE_ROUTE",
      );
    const sourceParts = [...d.walkways, ...d.connections].filter((source) =>
      indices.some((i) =>
        coversSourceSegment(
          path.coordinates[i],
          path.coordinates[i + 1],
          source.coordinates,
          d.center,
        ),
      ),
    );
    const heightPending =
      s.heightPending === true ||
      sourceParts.some((source) => source.heightPending === true) ||
      connection?.heightPending === true;
    for (const source of sourceParts) {
      if (source.note) warnings.add(source.note);
      if (source.fixme) warnings.add(source.fixme);
    }
    if (heightPending) warnings.add("路線包含高差待確認的來源路段。");
    return {
      kind,
      name: connection?.name ?? s.instruction,
      instruction: s.instruction,
      action: s.type,
      maneuver: s.maneuver,
      buildingId: s.buildingId,
      buildingName: d.buildings.find((b) => b.id === s.buildingId)?.name,
      fromBuildingId: path.buildingIds[s.pathStart],
      toBuildingId: path.buildingIds[s.pathEnd],
      fromLevel: path.levelRefs[s.pathStart],
      toLevel: path.levelRefs[s.pathEnd],
      durationS: s.durationS,
      distanceM: s.distanceM,
      startIndex: s.pathStart,
      endIndex: s.pathEnd,
      heightPending,
      ...(connection ? { connectionId: connection.id } : {}),
    };
  });
  const kinds = path.coordinates
    .slice(1)
    .map(
      (_, i) =>
        steps.find((s) => s.startIndex <= i && s.endIndex > i)?.kind ??
        "corridor",
    );
  if (effective === "elevator") {
    let lastBuilding: string | null = null;
    let lastLevel: string | null = null;
    for (let i = 0; i < path.coordinates.length; i++) {
      const building = path.buildingIds[i],
        level = path.levelRefs[i];
      if (building !== lastBuilding || (i > 0 && kinds[i - 1] === "elevator"))
        lastLevel = null;
      if (building && level && lastLevel && level !== lastLevel)
        throw new ApiError(
          "後端路線包含非電梯的跨樓層通路。",
          422,
          "NO_ACCESSIBLE_ROUTE",
        );
      if (level !== null) lastLevel = level;
      lastBuilding = building;
    }
  }
  return {
    ok: true,
    fromPlaceId: from,
    toPlaceId: to,
    points: path.coordinates.map((p) => [
      ...lngLatToLocal([p[0], p[1]], d.center),
      p[2],
    ]),
    context: {
      buildingIds: [...path.buildingIds],
      levelRefs: [...path.levelRefs],
    },
    segments: r.segments.map((s) => ({ ...s })),
    language,
    durationS: r.durationS,
    steps,
    kinds,
    distanceM: r.distanceM,
    // Public centerlines do not certify physical stair/slab clearance.
    animationSafe: false,
    warnings: [...warnings],
    edgeIds: [],
  };
}
