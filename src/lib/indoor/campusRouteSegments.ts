import type { IndoorRoute, LocalIndoorModel, XYZ } from "./types";

export interface CampusFloorView {
  buildingId: string;
  levelRef: string;
  /** Only a source-declared ground floor admits outdoor venue-datum edges. */
  groundElevationM?: number;
}

/** Renderer geometry retains its original inclusive navigation indices even
 * after clipping or projection onto a display floor. */
export interface IndoorRouteDisplaySegment {
  coordinates: [XYZ, XYZ];
  pathStart: number;
  pathEnd: number;
  kind: IndoorRoute["kinds"][number];
  connectionId: string | null;
  accessibleRamp: boolean;
}

/** Coordinate-only inputs remain useful for physical diagnostic scenes. */
export type IndoorSceneRouteSegment = IndoorRouteDisplaySegment | [XYZ, XYZ];

export function routeSegmentCoordinates(
  segment: IndoorSceneRouteSegment,
): [XYZ, XYZ] {
  return Array.isArray(segment) ? segment : segment.coordinates;
}

/** Same tolerance as the public route adapter; this verifies identity without
 * snapping geometry or treating a nearby, unrelated slope as a facility. */
function sameSourcePoint(a: XYZ, b: XYZ) {
  return (
    Math.hypot(a[0] - b[0], a[1] - b[1]) <= 0.002 &&
    Math.abs(a[2] - b[2]) <= 0.011
  );
}

export function routeDisplaySegment(
  route: IndoorRoute,
  model: LocalIndoorModel,
  pathStart: number,
  coordinates: [XYZ, XYZ] = [
    route.points[pathStart],
    route.points[pathStart + 1],
  ],
): IndoorRouteDisplaySegment {
  const step = route.steps?.find(
    (entry) => entry.startIndex <= pathStart && entry.endIndex > pathStart,
  );
  const kind = route.kinds?.[pathStart] ?? step?.kind ?? "corridor";
  const connectionId = step?.connectionId ?? null;
  const connection =
    model.campus?.connections.find((entry) => entry.id === connectionId) ??
    model.connections?.find((entry) => entry.id === connectionId);
  const from = route.points[pathStart],
    to = route.points[pathStart + 1];
  const accessibleRamp = Boolean(
    kind === "ramp" &&
      step?.kind === "ramp" &&
      connection?.kind === "ramp" &&
      connection.wheelchair === "yes" &&
      from &&
      to &&
      connection.coordinates.some((point, index) => {
        const next = connection.coordinates[index + 1];
        return (
          next &&
          ((sameSourcePoint(from, point) && sameSourcePoint(to, next)) ||
            (sameSourcePoint(from, next) && sameSourcePoint(to, point)))
        );
      }),
  );
  return {
    coordinates,
    pathStart,
    pathEnd: pathStart + 1,
    kind,
    connectionId,
    accessibleRamp,
  };
}

/** Authored outdoor and inter-building edges only, in source order and XYZ.
 * Both endpoints must belong to displayed floors or to the ground-level
 * outdoor network while a source-declared ground floor is displayed. */
export function campusRouteDisplaySegments(
  route: IndoorRoute,
  model: LocalIndoorModel,
  view?: CampusFloorView | readonly CampusFloorView[],
): IndoorRouteDisplaySegment[] {
  if (route.context) {
    const { buildingIds, levelRefs } = route.context;
    if (
      buildingIds.length !== route.points.length ||
      levelRefs.length !== route.points.length
    )
      return [];
    const visible = (index: number, floor: CampusFloorView) => {
      if (
        buildingIds[index] === floor.buildingId &&
        levelRefs[index] === floor.levelRef
      )
        return true;
      // Null is not a wildcard for any floor: only outdoor points at the
      // venue datum or this ground floor's elevation are admitted. In
      // particular, intermediate indoor stair/lift points stay excluded.
      return (
        floor.groundElevationM !== undefined &&
        buildingIds[index] === null &&
        levelRefs[index] === null &&
        [0, floor.groundElevationM].some(
          (height) => Math.abs(route.points[index][2] - height) <= 0.02,
        )
      );
    };
    return route.points
      .slice(1)
      .flatMap((_, index): IndoorRouteDisplaySegment[] => {
        const from = buildingIds[index],
          to = buildingIds[index + 1];
        if (from !== null && from === to) return [];
        // Preserve every authored campus edge, including intermediate null/null
        // points. Never connect around an omitted indoor segment.
        if (view) {
          const endpoints = [index, index + 1];
          const allowed =
            "buildingId" in view
              ? endpoints.every((endpoint) => visible(endpoint, view))
              : endpoints.every((endpoint) =>
                  view.some((floor) => visible(endpoint, floor)),
                );
          if (!allowed) return [];
        }
        return [routeDisplaySegment(route, model, index)];
      });
  }
  if (view) return [];
  const edges = new Set(route.edgeIds);
  const nodes = new Map(model.nodes.map((node) => [node.id, node]));
  const outdoorEdges = model.edges.flatMap((edge): [XYZ, XYZ][] => {
    if (!edges.has(edge.id)) return [];
    const from = nodes.get(edge.from),
      to = nodes.get(edge.to);
    return !from || !to || (from.levelRef !== null && to.levelRef !== null)
      ? []
      : [[from.point, to.point]];
  });
  return route.points
    .slice(1)
    .flatMap((to, index): IndoorRouteDisplaySegment[] => {
      const from = route.points[index];
      return outdoorEdges.some(
        ([a, b]) =>
          (sameSourcePoint(from, a) && sameSourcePoint(to, b)) ||
          (sameSourcePoint(from, b) && sameSourcePoint(to, a)),
      )
        ? [routeDisplaySegment(route, model, index)]
        : [];
    });
}

/** Coordinate projection for existing diagnostic consumers. Product renderers
 * use campusRouteDisplaySegments so source semantics survive display changes. */
export function campusRouteSegments(
  route: IndoorRoute,
  model: LocalIndoorModel,
  view?: CampusFloorView | readonly CampusFloorView[],
): [XYZ, XYZ][] {
  return campusRouteDisplaySegments(route, model, view).map(
    (segment) => segment.coordinates,
  );
}
