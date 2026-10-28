import polygonClipping, {
  type MultiPolygon,
  type Polygon,
} from "polygon-clipping";
import type { IndoorFeature, LocalIndoorModel, XY, XYZ } from "./types";

export const DISPLAY_WALL_HEIGHT = 0.85;
export const DISPLAY_WALL_THICKNESS = 0.12;
const DISPLAY_SOURCE_WALL_THICKNESS = 0.09;
export const DISPLAY_SLAB_THICKNESS = 0.16;
const EPS = 0.001;

/** Clip only the displayed segment; the navigation path remains immutable. */
export function clipSegmentHeight(
  a: XYZ,
  b: XYZ,
  minimum: number,
  maximum: number,
): [XYZ, XYZ] | null {
  const dz = b[2] - a[2];
  if (Math.abs(dz) < 1e-9)
    return a[2] < minimum || a[2] > maximum ? null : [[...a], [...b]];
  const t1 = (minimum - a[2]) / dz;
  const t2 = (maximum - a[2]) / dz;
  const start = Math.max(0, Math.min(t1, t2));
  const end = Math.min(1, Math.max(t1, t2));
  if (start > end) return null;
  const at = (t: number): XYZ => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + dz * t,
  ];
  return [at(start), at(end)];
}

/** Keep platform guards clear of every entrance, including two flights that
 * enter at different positions on the same long platform edge. */
export function guardSegments(
  a: XY,
  b: XY,
  openings: { point: XY; width: number }[],
): { a: XY; b: XY }[] {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  if (length < 0.001) return [];
  const cuts = openings
    .flatMap(({ point, width }) => {
      const along = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length;
      const normal =
        Math.abs((point[0] - a[0]) * dy - (point[1] - a[1]) * dx) / length;
      if (normal > 0.025 || along < -0.025 || along > length + 0.025) return [];
      return [
        [Math.max(0, along - width / 2), Math.min(length, along + width / 2)],
      ];
    })
    .sort((x, y) => x[0] - y[0]);
  const at = (distance: number): XY => [
    a[0] + (dx * distance) / length,
    a[1] + (dy * distance) / length,
  ];
  const result: { a: XY; b: XY }[] = [];
  let cursor = 0;
  for (const [start, end] of [...cuts, [length, length]]) {
    if (start - cursor > 0.05) result.push({ a: at(cursor), b: at(start) });
    cursor = Math.max(cursor, end);
  }
  return result;
}

export function area(ring: XY[]): number {
  return (
    ring.reduce((sum, p, i) => {
      const q = ring[(i + 1) % ring.length];
      return sum + p[0] * q[1] - q[0] * p[1];
    }, 0) / 2
  );
}

export function centroid(ring: XY[]): XY {
  const a = area(ring);
  if (Math.abs(a) < EPS) return ring[0];
  let x = 0,
    y = 0;
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length];
    const cross = p[0] * q[1] - q[0] * p[1];
    x += (p[0] + q[0]) * cross;
    y += (p[1] + q[1]) * cross;
  });
  return [x / (6 * a), y / (6 * a)];
}

function insideRing(point: XY, ring: XY[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x, y] = ring[i],
      [xx, yy] = ring[j];
    if (
      y > point[1] !== yy > point[1] &&
      point[0] < ((xx - x) * (point[1] - y)) / (yy - y) + x
    )
      inside = !inside;
  }
  return inside;
}
export function inside(point: XY, polygon: XY[][]) {
  return (
    insideRing(point, polygon[0]) &&
    !polygon.slice(1).some((ring) => insideRing(point, ring))
  );
}
/** A label point inside the polygon: its centroid when that lies inside,
 * otherwise the sampled point farthest from every edge. */
export function labelAnchor(polygon: XY[][]): XY {
  const center = centroid(polygon[0]);
  if (inside(center, polygon)) return center;
  const xs = polygon[0].map((p) => p[0]),
    ys = polygon[0].map((p) => p[1]);
  const minX = Math.min(...xs),
    minY = Math.min(...ys);
  const width = Math.max(...xs) - minX,
    height = Math.max(...ys) - minY;
  let best: XY = polygon[0][0],
    clearance = -1;
  for (let x = 1; x < 16; x++)
    for (let y = 1; y < 16; y++) {
      const point: XY = [minX + (width * x) / 16, minY + (height * y) / 16];
      if (!inside(point, polygon)) continue;
      let distance = Infinity;
      for (const ring of polygon)
        for (let i = 1; i < ring.length; i++) {
          const a = ring[i - 1],
            b = ring[i],
            dx = b[0] - a[0],
            dy = b[1] - a[1];
          const length2 = dx * dx + dy * dy;
          const t = length2
            ? Math.max(
                0,
                Math.min(
                  1,
                  ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2,
                ),
              )
            : 0;
          distance = Math.min(
            distance,
            Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy),
          );
        }
      if (distance > clearance) {
        best = point;
        clearance = distance;
      }
    }
  return best;
}

export function isOpening(feature: IndoorFeature) {
  return (
    /stair|elevator|lift|void|vertical-core/.test(
      feature.tags["a11ymap:area_type"] || "",
    ) || feature.kind === "stairs"
  );
}

/** Explicit display-only coverage; this does not imply a walkable surface. */
export function isFloorBase(feature: IndoorFeature) {
  return (
    feature.kind === "area" &&
    feature.tags["a11ymap:area_type"] === "indoor-floor-base"
  );
}

export function isEnclosed(feature: IndoorFeature) {
  return feature.kind === "room" || feature.tags.amenity === "toilets";
}

export function floorGeometry(
  model: LocalIndoorModel,
  ordinal: number,
): MultiPolygon {
  const polygons = model.features.filter(
    (f) => f.ordinal === ordinal && f.geometry.type === "Polygon",
  );
  const rings = (f: IndoorFeature) =>
    (f.geometry as { type: "Polygon"; coordinates: XY[][] }).coordinates;
  const isVoid = (f: IndoorFeature) =>
    /void/.test(f.tags["a11ymap:area_type"] || "");
  // Stair, shaft and core openings stay part of the slab so no floor shows the
  // map through a gap; their outlines and facility markers are drawn on top.
  // Only an authored void (atrium, double-height space) is left open.
  const patches = polygons
    .filter(
      (f) =>
        (isOpening(f) && !isVoid(f)) ||
        isFloorBase(f) ||
        f.kind === "room" ||
        f.kind === "corridor" ||
        f.tags.amenity === "toilets",
    )
    .map(rings);
  const voids = polygons.filter(isVoid).map(rings);
  if (!patches.length) return [];
  const floor = polygonClipping.union(patches[0], ...patches.slice(1));
  return voids.length ? polygonClipping.difference(floor, ...voids) : floor;
}

export interface WallSegment {
  a: XY;
  b: XY;
  owners: string[];
  polygon: Polygon;
}

/** Split partial collinear overlaps before deduplicating shared room boundaries.
 * Exterior-facing strips lie inside the source room; shared walls straddle the
 * one common boundary. Source floor polygons are never scaled or inset.
 */
export function roomWalls(
  features: IndoorFeature[],
  thickness = DISPLAY_WALL_THICKNESS,
  includeEdge: (feature: IndoorFeature, a: XY, b: XY) => boolean = () => true,
): WallSegment[] {
  const edges: { a: XY; b: XY; owner: string; inward: XY }[] = [];
  for (const f of features) {
    if (!isEnclosed(f) || f.geometry.type !== "Polygon") continue;
    f.geometry.coordinates.forEach((ring, ringIndex) => {
      const sign = Math.sign(area(ring)) * (ringIndex ? -1 : 1);
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i],
          b = ring[i + 1];
        if (!includeEdge(f, a, b)) continue;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < EPS) continue;
        edges.push({
          a,
          b,
          owner: f.id,
          inward: [(-(b[1] - a[1]) / len) * sign, ((b[0] - a[0]) / len) * sign],
        });
      }
    });
  }
  const pieces = new Map<
    string,
    { a: XY; b: XY; owners: Set<string>; inward: XY }
  >();
  const key = (p: XY) => `${Math.round(p[0] / EPS)},${Math.round(p[1] / EPS)}`;
  for (const edge of edges) {
    const dx = edge.b[0] - edge.a[0],
      dy = edge.b[1] - edge.a[1],
      len = Math.hypot(dx, dy);
    const cuts = [0, 1];
    for (const other of edges) {
      for (const p of [other.a, other.b]) {
        const cross =
          Math.abs(dx * (p[1] - edge.a[1]) - dy * (p[0] - edge.a[0])) / len;
        const t =
          ((p[0] - edge.a[0]) * dx + (p[1] - edge.a[1]) * dy) / (len * len);
        if (cross < EPS && t > EPS / len && t < 1 - EPS / len) cuts.push(t);
      }
    }
    cuts.sort((a, b) => a - b);
    // Recomputing a + (b - a) can differ from b by one floating-point ULP.
    // Preserve authored endpoints so adjoining wall strips share exactly the
    // same vertex and polygon union can close their boundary rings.
    const pointAt = (t: number): XY =>
      t === 0
        ? [...edge.a]
        : t === 1
          ? [...edge.b]
          : [edge.a[0] + dx * t, edge.a[1] + dy * t];
    for (let i = 1; i < cuts.length; i++) {
      if ((cuts[i] - cuts[i - 1]) * len < EPS) continue;
      const a = pointAt(cuts[i - 1]),
        b = pointAt(cuts[i]);
      const id = [key(a), key(b)].sort().join(":");
      const existing = pieces.get(id);
      if (existing) existing.owners.add(edge.owner);
      else
        pieces.set(id, {
          a,
          b,
          owners: new Set([edge.owner]),
          inward: edge.inward,
        });
    }
  }
  const wallPieces = [...pieces.values()];
  const walls: WallSegment[] = wallPieces.map(({ a, b, inward: n, owners }) => {
    const inner = owners.size > 1 ? thickness / 2 : thickness;
    const outer = owners.size > 1 ? -thickness / 2 : 0;
    const ring: XY[] = [
      [a[0] + n[0] * outer, a[1] + n[1] * outer],
      [b[0] + n[0] * outer, b[1] + n[1] * outer],
      [b[0] + n[0] * inner, b[1] + n[1] * inner],
      [a[0] + n[0] * inner, a[1] + n[1] * inner],
    ];
    ring.push(ring[0]);
    return { a, b, owners: [...owners], polygon: [ring] };
  });

  // Inward strips overlap at convex corners but only touch at a single point
  // at a concave corner. Join the two inward offset lines to close that gap.
  // Clip the join to its source room so a recess or corridor stays untouched.
  const cross = (a: XY, b: XY) => a[0] * b[1] - a[1] * b[0];
  const wallDepth = (owner: string, point: XY, direction: XY) => {
    const piece = wallPieces.find((part) => {
      if (!part.owners.has(owner)) return false;
      const nearA =
        Math.hypot(part.a[0] - point[0], part.a[1] - point[1]) < EPS;
      const nearB =
        Math.hypot(part.b[0] - point[0], part.b[1] - point[1]) < EPS;
      if (!nearA && !nearB) return false;
      const delta: XY = [part.b[0] - part.a[0], part.b[1] - part.a[1]];
      return Math.abs(cross(delta, direction)) < EPS;
    });
    return piece && piece.owners.size > 1 ? thickness / 2 : thickness;
  };
  for (const f of features) {
    if (!isEnclosed(f) || f.geometry.type !== "Polygon") continue;
    const room = f.geometry.coordinates;
    room.forEach((ring, ringIndex) => {
      const vertices = ring
        .slice(0, -1)
        .filter(
          (point, index, all) =>
            index === 0 ||
            Math.hypot(
              point[0] - all[index - 1][0],
              point[1] - all[index - 1][1],
            ) >= EPS,
        );
      const sign = Math.sign(area(ring)) * (ringIndex ? -1 : 1);
      vertices.forEach((point, index) => {
        const prev = vertices[(index + vertices.length - 1) % vertices.length];
        const next = vertices[(index + 1) % vertices.length];
        if (!includeEdge(f, prev, point) || !includeEdge(f, point, next))
          return;
        const lengthA = Math.hypot(point[0] - prev[0], point[1] - prev[1]);
        const lengthB = Math.hypot(next[0] - point[0], next[1] - point[1]);
        if (lengthA < EPS || lengthB < EPS) return;
        const directionA: XY = [
          (point[0] - prev[0]) / lengthA,
          (point[1] - prev[1]) / lengthA,
        ];
        const directionB: XY = [
          (next[0] - point[0]) / lengthB,
          (next[1] - point[1]) / lengthB,
        ];
        const turn = cross(directionA, directionB);
        if (turn * sign >= -EPS) return;
        const depthA = wallDepth(f.id, point, directionA);
        const depthB = wallDepth(f.id, point, directionB);
        const offsetA: XY = [
          point[0] - directionA[1] * sign * depthA,
          point[1] + directionA[0] * sign * depthA,
        ];
        const offsetB: XY = [
          point[0] - directionB[1] * sign * depthB,
          point[1] + directionB[0] * sign * depthB,
        ];
        const delta: XY = [offsetB[0] - offsetA[0], offsetB[1] - offsetA[1]];
        const distance = cross(delta, directionB) / turn;
        const intersection: XY = [
          offsetA[0] + directionA[0] * distance,
          offsetA[1] + directionA[1] * distance,
        ];
        const join: XY[] = [point, offsetA, intersection, offsetB, point];
        for (const polygon of polygonClipping.intersection([join], room)) {
          walls.push({ a: point, b: point, owners: [f.id], polygon });
        }
      });
    });
  }
  return walls;
}

export function unionWalls(walls: WallSegment[]): MultiPolygon {
  return unionWallPolygons(walls.map((wall) => wall.polygon));
}

/** Generated offset strips can differ by a few ULPs at a shared intersection.
 * Use a common nanometre grid only for their Boolean overlay: it is far below
 * both the millimetre topology tolerance and the GPU's Float32 precision.
 * Authored room/corridor coordinates and navigation geometry stay untouched.
 * All wall-overlay operands use this same grid so corridor subtraction cannot
 * create sub-nanometre slivers between two versions of one shared boundary.
 */
function wallOverlayPolygon(polygon: Polygon): Polygon {
  const precision = 1e9;
  return polygon.map((ring) =>
    ring.map(
      ([x, y]): XY => [
        Math.round(x * precision) / precision,
        Math.round(y * precision) / precision,
      ],
    ),
  );
}

function unionWallPolygons(polygons: Polygon[]): MultiPolygon {
  if (!polygons.length) return [];
  const normalized = polygons.map(wallOverlayPolygon);
  return cleanWallOverlay(
    polygonClipping.union(normalized[0], ...normalized.slice(1)),
  );
}

/** Intersections may reintroduce sub-grid triangular holes. Collapse only
 * rings that have no area on the same overlay grid before triangulation. */
function cleanWallOverlay(polygons: MultiPolygon): MultiPolygon {
  return polygons.flatMap((polygon) => {
    const rings = wallOverlayPolygon(polygon).map((ring) => {
      const points = ring.filter(
        (point, index) =>
          index === 0 ||
          point[0] !== ring[index - 1][0] ||
          point[1] !== ring[index - 1][1],
      );
      if (points.length < 3) return [];
      const [originX, originY] = points[0];
      // Compute locally to avoid cancellation of large absolute coordinates.
      const signedArea = area(
        points.map(([x, y]): XY => [x - originX, y - originY]),
      );
      return signedArea === 0 ? [] : points;
    });
    if (!rings[0].length) return [];
    return [[rings[0], ...rings.slice(1).filter((ring) => ring.length)]];
  });
}

export interface IndoorWallGeometry {
  polygons: MultiPolygon;
  /** Authored wall lines with no surveyed room side or thickness. Render these
   * as vertical, double-sided planes at the original coordinates. */
  boundaryWalls: { a: XY; b: XY }[];
}

function segmentsCross(a: XY, b: XY, c: XY, d: XY): boolean {
  const u = [b[0] - a[0], b[1] - a[1]];
  const v = [d[0] - c[0], d[1] - c[1]];
  const delta = [c[0] - a[0], c[1] - a[1]];
  const denominator = u[0] * v[1] - u[1] * v[0];
  if (Math.abs(denominator) < 1e-9) return false;
  const t = (delta[0] * v[1] - delta[1] * v[0]) / denominator;
  const s = (delta[0] * u[1] - delta[1] * u[0]) / denominator;
  return t >= -EPS && t <= 1 + EPS && s >= -EPS && s <= 1 + EPS;
}

/** Source approach links identify an entrance side, never a measured door width.
 * Use all known stops of this same shaft so non-stopping floors retain its walls.
 */
function shaftApproaches(model: LocalIndoorModel, feature: IndoorFeature) {
  if (
    feature.tags["a11ymap:area_type"] !== "elevator-shaft" ||
    !feature.connectionId ||
    feature.geometry.type !== "Polygon"
  )
    return [];
  const sourceStops = model.connections.find(
    (connection) =>
      connection.id === feature.connectionId && connection.kind === "elevator",
  )?.nodeIds;
  // Public connection stops need not be searchable places. Their exact source
  // IDs are authoritative; only legacy models without that field use places.
  const stops = new Set(
    sourceStops ??
      model.places
        .filter(
          (place) =>
            place.connectionId === feature.connectionId ||
            place.connectionIds?.includes(feature.connectionId as string),
        )
        .map((place) => place.nodeId),
  );
  const nodes = new Map(model.nodes.map((node) => [node.id, node.point]));
  const approaches: [XY, XY][] = [];
  for (const edge of model.edges) {
    if (
      edge.kind === "elevator" ||
      (!stops.has(edge.from) && !stops.has(edge.to))
    )
      continue;
    const a = nodes.get(edge.from),
      b = nodes.get(edge.to);
    if (!a || !b || Math.abs(a[2] - b[2]) > EPS) continue;
    const start: XY = [a[0], a[1]],
      end: XY = [b[0], b[1]];
    if (
      feature.geometry.coordinates.some((ring) =>
        ring.slice(1).some((p, i) => segmentsCross(ring[i], p, start, end)),
      )
    )
      approaches.push([start, end]);
  }
  return approaches;
}

/** Merge room walls and explicit source walls without consuming public floor.
 * An explicit wall between two corridor areas is still a real boundary: its
 * unknown thickness must not cause it to disappear when corridors are cut out.
 */
export function wallGeometry(
  model: LocalIndoorModel,
  ordinal: number,
): IndoorWallGeometry {
  const sourceFeatures = model.features.filter((f) => f.ordinal === ordinal);
  const approaches = new Map(
    sourceFeatures.map((feature) => [
      feature.id,
      shaftApproaches(model, feature),
    ]),
  );
  // Source shaft outlines carry real side/back boundaries. Include them in the
  // same wall deduplication as rooms, keeping the entire approach side open.
  // A core containing both stairs and an elevator is not an enclosed shaft.
  const features = sourceFeatures.map((feature) =>
    approaches.get(feature.id)?.length
      ? { ...feature, kind: "room" as const }
      : feature,
  );
  const rooms = features.flatMap((f) =>
    isEnclosed(f) && f.geometry.type === "Polygon"
      ? [f.geometry.coordinates]
      : [],
  );
  const corridors = features.flatMap((f) =>
    f.kind === "corridor" && f.geometry.type === "Polygon"
      ? [f.geometry.coordinates]
      : [],
  );
  const roomSurface = rooms.length
    ? polygonClipping.union(rooms[0], ...rooms.slice(1))
    : [];
  const solids: Polygon[] = roomWalls(
    features,
    DISPLAY_WALL_THICKNESS,
    (feature, a, b) =>
      !approaches.get(feature.id)?.some(([c, d]) => segmentsCross(a, b, c, d)),
  ).map((wall) => wall.polygon);
  const boundaryWalls: IndoorWallGeometry["boundaryWalls"] = [];
  const boundaryKeys = new Set<string>();
  const cross = (a: XY, b: XY) => a[0] * b[1] - a[1] * b[0];
  const insideRoom = (point: XY) =>
    rooms.some((polygon) => {
      let inside = false;
      for (const ring of polygon) {
        for (let i = 1; i < ring.length; i++) {
          const a = ring[i - 1],
            b = ring[i];
          if (
            a[1] > point[1] !== b[1] > point[1] &&
            point[0] <
              ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
          )
            inside = !inside;
        }
      }
      return inside;
    });
  for (const wall of model.walls.filter((w) => w.ordinal === ordinal)) {
    for (let i = 1; i < wall.points.length; i++) {
      const start = wall.points[i - 1],
        end = wall.points[i];
      const delta: XY = [end[0] - start[0], end[1] - start[1]];
      const length = Math.hypot(...delta);
      if (length < EPS) continue;
      const cuts = [0, 1];
      for (const polygon of rooms)
        for (const ring of polygon) {
          for (let j = 1; j < ring.length; j++) {
            const a = ring[j - 1],
              b = ring[j];
            const edge: XY = [b[0] - a[0], b[1] - a[1]];
            const offset: XY = [a[0] - start[0], a[1] - start[1]];
            const denominator = cross(delta, edge);
            if (Math.abs(denominator) > 1e-9) {
              const t = cross(offset, edge) / denominator;
              const u = cross(offset, delta) / denominator;
              if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
            } else if (Math.abs(cross(delta, offset)) / length < EPS) {
              for (const point of [a, b]) {
                const t =
                  ((point[0] - start[0]) * delta[0] +
                    (point[1] - start[1]) * delta[1]) /
                  length ** 2;
                if (t > 0 && t < 1) cuts.push(t);
              }
            }
          }
        }
      cuts.sort((a, b) => a - b);
      const normal: XY = [-delta[1] / length, delta[0] / length];
      for (let j = 1; j < cuts.length; j++) {
        if ((cuts[j] - cuts[j - 1]) * length < EPS) continue;
        const pointAt = (t: number): XY =>
          t === 0
            ? [...start]
            : t === 1
              ? [...end]
              : [start[0] + delta[0] * t, start[1] + delta[1] * t];
        const a = pointAt(cuts[j - 1]),
          b = pointAt(cuts[j]);
        const midpoint: XY = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const left = insideRoom([
          midpoint[0] + normal[0] * EPS * 4,
          midpoint[1] + normal[1] * EPS * 4,
        ]);
        const right = insideRoom([
          midpoint[0] - normal[0] * EPS * 4,
          midpoint[1] - normal[1] * EPS * 4,
        ]);
        if (!left && !right) {
          const key = [a, b]
            .map((p) => p.map((v) => Math.round(v / EPS)).join(","))
            .sort()
            .join(":");
          if (!boundaryKeys.has(key)) {
            boundaryKeys.add(key);
            boundaryWalls.push({ a, b });
          }
          continue;
        }
        const low = right ? -DISPLAY_SOURCE_WALL_THICKNESS / (left ? 2 : 1) : 0;
        const high = left ? DISPLAY_SOURCE_WALL_THICKNESS / (right ? 2 : 1) : 0;
        const ring: XY[] = [
          [a[0] + normal[0] * low, a[1] + normal[1] * low],
          [b[0] + normal[0] * low, b[1] + normal[1] * low],
          [b[0] + normal[0] * high, b[1] + normal[1] * high],
          [a[0] + normal[0] * high, a[1] + normal[1] * high],
          [a[0] + normal[0] * low, a[1] + normal[1] * low],
        ];
        solids.push(...polygonClipping.intersection([ring], roomSurface));
      }
    }
  }
  if (!solids.length) return { polygons: [], boundaryWalls };
  const merged = unionWallPolygons(solids);
  return {
    polygons: corridors.length
      ? cleanWallOverlay(
          polygonClipping.difference(
            merged,
            ...corridors.map(wallOverlayPolygon),
          ),
        )
      : merged,
    boundaryWalls,
  };
}

/** Constant-width rectangle for a measured/explicitly schematic flight only.
 * It is not used to turn arbitrary navigation links into stair geometry.
 */
export function segmentRectangle(a: XY, b: XY, width: number): XY[] {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (l < EPS) return [];
  const nx = ((-(b[1] - a[1]) / l) * width) / 2,
    ny = (((b[0] - a[0]) / l) * width) / 2;
  return [
    [a[0] + nx, a[1] + ny],
    [b[0] + nx, b[1] + ny],
    [b[0] - nx, b[1] - ny],
    [a[0] - nx, a[1] - ny],
    [a[0] + nx, a[1] + ny],
  ];
}

export function pointOnSegment(a: XYZ, b: XYZ, t: number): XYZ {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}
