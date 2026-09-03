// Geo math utilities for turn-by-turn navigation.
// Pure, dependency-free. Works in [lng, lat] tuples (from route polylines)
// and { lat, lng } objects (LatLng) depending on the helper.

import type { LatLng } from "@/types";
import type { NavInstruction, RouteLeg } from "@/types/route";

const EARTH_RADIUS_M = 6_371_000;
const M_PER_DEG_LAT = 111_320;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Great-circle distance in meters between two LatLng points. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial compass bearing (0–360°, 0 = north) from `a` to `b`. */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return normalizeDeg(toDeg(Math.atan2(y, x)));
}

/** Wrap any degree value into [0, 360). */
export function normalizeDeg(d: number): number {
  return ((d % 360) + 360) % 360;
}

/**
 * Interpolate between two angles along the shortest arc.
 * `t` in [0,1]; used to smooth heading/marker rotation between frames.
 */
export function shortestAngleLerp(from: number, to: number, t: number): number {
  const diff = ((to - from + 540) % 360) - 180;
  return normalizeDeg(from + diff * t);
}

export interface CumulativePath {
  /** Concatenated route points, in order, as LatLng. */
  path: LatLng[];
  /** cumM[i] = distance in meters from the path start to point i. */
  cumM: number[];
}

/**
 * Concatenate every leg's polyline (in order) into a single LatLng path and
 * its cumulative-distance array. Points are appended verbatim — this mirrors
 * the backend's global `polylineIndex` (instructions carry no per-leg index).
 */
export function buildCumulativePath(legs: RouteLeg[]): CumulativePath {
  const path: LatLng[] = [];
  for (const leg of legs) {
    if (!leg.polyline?.length) continue;
    for (const [lng, lat] of leg.polyline) {
      path.push({ lat, lng });
    }
  }
  const cumM: number[] = new Array(path.length).fill(0);
  for (let i = 1; i < path.length; i++) {
    cumM[i] = cumM[i - 1] + haversineMeters(path[i - 1], path[i]);
  }
  return { path, cumM };
}

export interface Projection {
  /** Index of the segment start point the user projects onto. */
  segIndex: number;
  /** Perpendicular distance (m) from the user to the route — off-route metric. */
  perpDistM: number;
  /** Distance (m) traveled along the route up to the projected point. */
  alongM: number;
}

interface XY {
  x: number;
  y: number;
}

/** Local equirectangular projection (meters) around a reference latitude. */
function toXY(p: LatLng, refLat: number): XY {
  const mPerLng = M_PER_DEG_LAT * Math.cos(toRad(refLat));
  return { x: p.lng * mPerLng, y: p.lat * M_PER_DEG_LAT };
}

/**
 * Project `point` onto the polyline `path`, returning the nearest segment, the
 * perpendicular distance to the route, and the along-route distance. Uses a
 * local planar approximation — accurate for the short spans of a route segment.
 */
export function projectToPath(
  point: LatLng,
  path: LatLng[],
  cumM: number[],
): Projection {
  if (path.length === 0) {
    return { segIndex: 0, perpDistM: Infinity, alongM: 0 };
  }
  if (path.length === 1) {
    return {
      segIndex: 0,
      perpDistM: haversineMeters(point, path[0]),
      alongM: 0,
    };
  }

  const refLat = point.lat;
  const P = toXY(point, refLat);

  let best: Projection = { segIndex: 0, perpDistM: Infinity, alongM: 0 };

  for (let i = 0; i < path.length - 1; i++) {
    const A = toXY(path[i], refLat);
    const B = toXY(path[i + 1], refLat);
    const abx = B.x - A.x;
    const aby = B.y - A.y;
    const apx = P.x - A.x;
    const apy = P.y - A.y;
    const lenSq = abx * abx + aby * aby;
    const t =
      lenSq > 0 ? Math.max(0, Math.min(1, (apx * abx + apy * aby) / lenSq)) : 0;
    const cx = A.x + t * abx;
    const cy = A.y + t * aby;
    const dx = P.x - cx;
    const dy = P.y - cy;
    const perpDistM = Math.sqrt(dx * dx + dy * dy);

    if (perpDistM < best.perpDistM) {
      const segLen = cumM[i + 1] - cumM[i];
      best = {
        segIndex: i,
        perpDistM,
        alongM: cumM[i] + t * segLen,
      };
    }
  }

  return best;
}

export interface Waypoint {
  coord: LatLng | null;
  /** Along-route distance (m) of this instruction's maneuver point. */
  alongM: number;
}

/**
 * Map each instruction to its maneuver coordinate + along-route distance via
 * `polylineIndex` (a global index into the concatenated path). Out-of-range or
 * null indices are clamped so the engine always has a usable waypoint.
 */
export function resolveWaypoints(
  instructions: NavInstruction[],
  { path, cumM }: CumulativePath,
): Waypoint[] {
  if (path.length === 0) return [];
  const last = path.length - 1;
  return instructions.map((ins) => {
    let idx = ins.polylineIndex;
    if (idx == null) idx = last;
    const ci = Math.max(0, Math.min(last, idx));
    return {
      coord: path[ci] ?? null,
      alongM: cumM[ci] ?? 0,
    };
  });
}

/**
 * Minimum perpendicular distance in meters from a point to a polyline.
 * Uses local planar equirectangular projection for accurate meter metrics.
 */
export function pointToPolylineDistanceM(
  point: LatLng,
  polyline: [number, number][],
): number {
  if (polyline.length === 0) return Infinity;
  if (polyline.length === 1) {
    return haversineMeters(point, {
      lng: polyline[0][0],
      lat: polyline[0][1],
    });
  }

  const refLat = point.lat;
  const P = toXY(point, refLat);
  let minDistance = Infinity;

  for (let i = 0; i < polyline.length - 1; i++) {
    const A = toXY({ lng: polyline[i][0], lat: polyline[i][1] }, refLat);
    const B = toXY(
      { lng: polyline[i + 1][0], lat: polyline[i + 1][1] },
      refLat,
    );
    const abx = B.x - A.x;
    const aby = B.y - A.y;
    const apx = P.x - A.x;
    const apy = P.y - A.y;
    const lenSq = abx * abx + aby * aby;
    const t =
      lenSq > 0 ? Math.max(0, Math.min(1, (apx * abx + apy * aby) / lenSq)) : 0;
    const cx = A.x + t * abx;
    const cy = A.y + t * aby;
    const dx = P.x - cx;
    const dy = P.y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < minDistance) {
      minDistance = dist;
    }
  }

  return minDistance;
}

/**
 * Filter incidents that lie within `maxDistanceM` of the route polyline.
 * Guarantees that incidents far away from the actual route (e.g. different cities)
 * are excluded from both map markers and route detail notices.
 */
export function filterIncidentsAlongRoute<
  T extends { location?: { lat: number; lng: number } },
>(
  incidents: T[] | undefined,
  polyline: [number, number][] | undefined,
  maxDistanceM = 150,
): T[] {
  if (!incidents?.length || !polyline?.length) return [];
  return incidents.filter((incident) => {
    if (
      !incident?.location ||
      !Number.isFinite(incident.location.lat) ||
      !Number.isFinite(incident.location.lng)
    ) {
      return false;
    }
    const dist = pointToPolylineDistanceM(incident.location, polyline);
    return dist <= maxDistanceM;
  });
}
