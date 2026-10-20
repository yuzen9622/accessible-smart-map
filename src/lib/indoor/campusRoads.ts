import { indoorModelVersion } from "./catalog";
import { localToLngLat } from "./coordinates";
import type { LocalIndoorModel, XY, XYZ } from "./types";

const EPS = 1e-8;
const cross = (a: XY, b: XY) => a[0] * b[1] - a[1] * b[0];

function inRing(point: XY, ring: XY[], includeBoundary = false) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j],
      b = ring[i];
    const dx = b[0] - a[0],
      dy = b[1] - a[1];
    if (
      Math.abs(cross([dx, dy], [point[0] - a[0], point[1] - a[1]])) < EPS &&
      point[0] >= Math.min(a[0], b[0]) - EPS &&
      point[0] <= Math.max(a[0], b[0]) + EPS &&
      point[1] >= Math.min(a[1], b[1]) - EPS &&
      point[1] <= Math.max(a[1], b[1]) + EPS
    )
      return includeBoundary;
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < a[0] + (dx * (point[1] - a[1])) / dy
    )
      inside = !inside;
  }
  return inside;
}

/** Display clipping only; courtyard holes and source endpoints remain intact. */
export function outsideBuildingSegments(
  a: XYZ,
  b: XYZ,
  polygons: XY[][][],
): [XYZ, XYZ][] {
  const delta: XY = [b[0] - a[0], b[1] - a[1]];
  if (Math.hypot(...delta) < EPS) return [];
  const cuts = [0, 1];
  for (const polygon of polygons)
    for (const ring of polygon)
      for (let i = 1; i < ring.length; i++) {
        const c = ring[i - 1],
          d = ring[i];
        const edge: XY = [d[0] - c[0], d[1] - c[1]];
        const relative: XY = [c[0] - a[0], c[1] - a[1]];
        const determinant = cross(delta, edge);
        if (Math.abs(determinant) < EPS) continue;
        const t = cross(relative, edge) / determinant;
        const u = cross(relative, delta) / determinant;
        if (t > EPS && t < 1 - EPS && u >= -EPS && u <= 1 + EPS) cuts.push(t);
      }
  cuts.sort((x, y) => x - y);
  const at = (t: number): XYZ =>
    t === 0
      ? [...a]
      : t === 1
        ? [...b]
        : [a[0] + delta[0] * t, a[1] + delta[1] * t, a[2] + (b[2] - a[2]) * t];
  return cuts.slice(1).flatMap((end, index): [XYZ, XYZ][] => {
    const start = cuts[index];
    if (end - start < EPS) return [];
    const middle = at((start + end) / 2);
    const point: XY = [middle[0], middle[1]];
    const inside = polygons.some(
      (polygon) =>
        inRing(point, polygon[0]) &&
        !polygon.slice(1).some((hole) => inRing(point, hole, true)),
    );
    return inside ? [] : [[at(start), at(end)]];
  });
}

export type CampusRoadProperties = {
  id: string;
  roadClass: "path" | "service";
  class: string;
  subclass: string;
  layer: number;
};

/** Persistent source road network, independent of the selected navigation journey. */
export function campusRoadData(
  models: LocalIndoorModel[],
): GeoJSON.FeatureCollection<GeoJSON.LineString, CampusRoadProperties> {
  const features: GeoJSON.Feature<GeoJSON.LineString, CampusRoadProperties>[] =
    [];
  const groups = new Map<string, LocalIndoorModel[]>();
  for (const model of models) {
    const key = `${model.venueId}:${indoorModelVersion(model)}`;
    const group = groups.get(key) ?? [];
    group.push(model);
    groups.set(key, group);
  }
  for (const [revision, group] of groups) {
    const model = group[0],
      campus = model.campus;
    if (!campus) continue;
    const buildings = new Map(
      group.map((item) => [item.building.id, item.building]),
    );
    const footprints = group.map((item) => item.building.footprint);
    const groundHeights = [
      0,
      ...group.flatMap((item) =>
        item.building.levels
          .filter((level) => level.ordinal === 0)
          .map((level) => level.elevationM),
      ),
    ];
    const ground = (
      point: XYZ,
      buildingId: string | null,
      ref: string | null,
    ) => {
      if (ref !== null)
        return (
          !!buildingId &&
          buildings
            .get(buildingId)
            ?.levels.some(
              (level) => level.ref === ref && level.ordinal === 0,
            ) === true
        );
      // Outdoor nodes use the venue datum. This is combined with source indoor
      // semantics and footprint clipping, never used alone to infer outdoors.
      return groundHeights.some(
        (height) => Math.abs(point[2] - height) <= 0.02,
      );
    };
    const contexts = new Map<
      string,
      { buildingId: string | null; ref: string | null; outdoor: boolean }
    >();
    for (const w of campus.walkways)
      for (const [i, id] of (w.nodeIds ?? []).entries()) {
        const previous = contexts.get(id);
        contexts.set(id, {
          buildingId: w.buildingIds[i],
          ref: w.levelRefs[i],
          outdoor: previous?.outdoor === true || !w.indoor,
        });
      }
    const seen = new Set<string>();
    const append = (id: string, kind: string, points: XYZ[]) => {
      if (seen.has(id)) return;
      seen.add(id);
      for (let index = 1; index < points.length; index++)
        for (const [part, segment] of outsideBuildingSegments(
          points[index - 1],
          points[index],
          footprints,
        ).entries()) {
          const roadClass = kind === "service" ? "service" : "path";
          features.push({
            type: "Feature",
            properties: {
              id: `${revision}:${id}:${index}:${part}`,
              roadClass,
              class: roadClass,
              subclass:
                kind === "steps" || kind === "stairs" ? "steps" : "pedestrian",
              layer: 0,
            },
            geometry: {
              type: "LineString",
              coordinates: segment.map((point) =>
                localToLngLat([point[0], point[1]], model.origin),
              ),
            },
          });
        }
    };
    for (const w of campus.walkways) {
      if (
        w.indoor ||
        !w.coordinates.every((point, index) =>
          ground(point, w.buildingIds[index], w.levelRefs[index]),
        )
      )
        continue;
      append(w.id, w.kind, w.coordinates);
    }
    for (const c of campus.connections) {
      if (
        !["ramp", "steps", "stairs"].includes(c.kind) ||
        c.coordinates.length < 2
      )
        continue;
      const endpoints = [0, c.coordinates.length - 1];
      const evidence = endpoints.map((index) =>
        c.nodeIds?.[index] ? contexts.get(c.nodeIds[index]) : undefined,
      );
      // An indoor stair or an unowned connection cannot become an outdoor road.
      if (!evidence.some((endpoint) => endpoint?.outdoor)) continue;
      if (
        !endpoints.every((index, end) =>
          ground(
            c.coordinates[index],
            evidence[end]?.buildingId ?? c.buildingId ?? null,
            evidence[end]?.ref ?? c.levelRefs[index] ?? null,
          ),
        )
      )
        continue;
      append(c.id, c.kind, c.coordinates);
    }
  }
  return { type: "FeatureCollection", features };
}
