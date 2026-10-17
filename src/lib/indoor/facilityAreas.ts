import polygonClipping from "polygon-clipping";
import { area, centroid } from "./geometry";
import type {
  IndoorLevel,
  IndoorStairDesign,
  LocalIndoorModel,
  XY,
} from "./types";

export interface IndoorFacilityArea {
  sourceFeatureId: string;
  selectionId: string;
  kind: "stairs" | "elevator" | "core";
  polygons: XY[][][];
  anchor: XY;
  name: string;
  shortCaption: string;
  servesLevel: boolean | null;
  researchBoundary: boolean;
}

/** Rejected or stale research geometry must not define visible facility areas. */
export function isUsableStairCandidate(
  model: LocalIndoorModel,
  design: IndoorStairDesign,
): boolean {
  return (
    design.sourceSha256 === model.source.sha256 &&
    Array.isArray(design.conflicts) &&
    design.conflicts.length === 0
  );
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
function inside(point: XY, polygon: XY[][]) {
  return (
    insideRing(point, polygon[0]) &&
    !polygon.slice(1).some((ring) => insideRing(point, ring))
  );
}
function polygonArea(polygon: XY[][]) {
  return (
    Math.abs(area(polygon[0])) -
    polygon.slice(1).reduce((sum, ring) => sum + Math.abs(area(ring)), 0)
  );
}

/** Label placement only: choose a point inside the largest source piece,
 * including cores whose centroid is in the elevator hole. */
function anchorFor(polygons: XY[][][]): XY {
  const polygon = [...polygons].sort(
    (a, b) => polygonArea(b) - polygonArea(a),
  )[0];
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

/** Flat map symbols use source areas. A shared vertical core can only be
 * divided by an explicitly associated, contained research shaft polygon. */
export function indoorFacilityAreas(
  model: LocalIndoorModel,
  level: IndoorLevel,
): IndoorFacilityArea[] {
  const result: IndoorFacilityArea[] = [];
  const designs = (
    model.stairDesigns?.length
      ? model.stairDesigns
      : model.stairDesign
        ? [model.stairDesign]
        : []
  ).filter((design) => isUsableStairCandidate(model, design));
  const shortName = (name: string) =>
    name.replace(model.building.name, "").trim();
  for (const feature of model.features) {
    if (
      feature.ordinal !== level.ordinal ||
      feature.geometry.type !== "Polygon"
    )
      continue;
    const rings = feature.geometry.coordinates;
    const type = feature.tags["a11ymap:area_type"];
    const connection = model.connections.find(
      (c) => c.id === feature.connectionId,
    );
    const elevatorName = connection?.tags.ref
      ? `電梯 ${connection.tags.ref}`
      : shortName(connection?.name ?? feature.name ?? "電梯");
    const add = (
      entry: Omit<
        IndoorFacilityArea,
        "sourceFeatureId" | "anchor" | "shortCaption"
      >,
    ) => {
      if (!entry.polygons.length) return;
      result.push({
        ...entry,
        sourceFeatureId: feature.id,
        anchor: anchorFor(entry.polygons),
        shortCaption:
          (entry.kind === "elevator" ? connection?.tags.ref : feature.ref) ||
          entry.name.match(
            /(?:電梯|樓梯|梯|elevator|lift|stairs?)\s*([a-z0-9]+)/i,
          )?.[1] ||
          entry.name
            .replace(/[（(].*$/, "")
            .trim()
            .slice(0, 6),
      });
    };
    if (type === "vertical-core") {
      const candidate = designs
        .filter((design) => {
          const stair = model.connections.find(
            (c) => c.id === design.sourceConnectionId,
          );
          const point = design.sourceElevatorPoint;
          if (
            !design.shaft ||
            !point ||
            !stair?.levelRefs.includes(level.ref) ||
            connection?.kind !== "elevator" ||
            !connection.coordinates.some(
              (p) => Math.hypot(p[0] - point[0], p[1] - point[1]) < 0.02,
            ) ||
            !inside([point[0], point[1]], rings)
          )
            return false;
          return polygonClipping
            .difference(design.shaft.polygon, rings)
            .every((polygon) => polygonArea(polygon) < 1e-6);
        })
        .sort(
          (a, b) =>
            Math.abs(
              Math.min(...a.sourcePath.map((p) => p[2])) - level.elevationM,
            ) -
            Math.abs(
              Math.min(...b.sourcePath.map((p) => p[2])) - level.elevationM,
            ),
        )[0];
      if (candidate?.shaft) {
        const stair = model.connections.find(
          (c) => c.id === candidate.sourceConnectionId,
        );
        add({
          selectionId: candidate.sourceConnectionId,
          kind: "stairs",
          polygons: polygonClipping.difference(rings, candidate.shaft.polygon),
          name: shortName(stair?.name ?? "樓梯核心"),
          servesLevel: true,
          researchBoundary: true,
        });
        add({
          selectionId: feature.id,
          kind: "elevator",
          polygons: [candidate.shaft.polygon],
          name: elevatorName,
          servesLevel: connection?.levelRefs.includes(level.ref) ?? null,
          researchBoundary: true,
        });
      } else {
        add({
          selectionId: feature.id,
          kind: "core",
          polygons: [rings],
          name: feature.name ?? "垂直動線核心",
          servesLevel: null,
          researchBoundary: false,
        });
      }
      continue;
    }
    const kind =
      type === "stairwell" || feature.kind === "stairs"
        ? "stairs"
        : type === "elevator-shaft" || feature.kind === "elevator"
          ? "elevator"
          : null;
    if (!kind) continue;
    add({
      selectionId: feature.id,
      kind,
      polygons: [rings],
      name:
        kind === "elevator"
          ? elevatorName
          : shortName(feature.name ?? connection?.name ?? "樓梯"),
      servesLevel:
        kind === "elevator"
          ? (connection?.levelRefs.includes(level.ref) ?? null)
          : connection
            ? true
            : null,
      researchBoundary: false,
    });
  }
  return result;
}

export function facilityIcon(kind: IndoorFacilityArea["kind"], color: string) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "22");
  svg.setAttribute("height", "22");
  svg.setAttribute("aria-hidden", "true");
  svg.style.cssText = `display:inline-block;vertical-align:middle;margin-right:5px;border-radius:6px;background:${color};padding:3px;flex-shrink:0`;
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute(
    "d",
    kind === "stairs"
      ? "M3 20h4v-5h5v-5h5V4h4M4 11V4h7M4 4l6 6"
      : kind === "elevator"
        ? "M3 3h18v18H3zM8 17V7m-3 3 3-3 3 3m5-3v10m-3-3 3 3 3-3"
        : "M4 4h16v16H4zM8 8h8v8H8z",
  );
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "white");
  path.setAttribute("stroke-width", "1.8");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);
  return svg;
}
