import type { LngLat, Map as MapLibreMap } from "maplibre-gl";

export interface OverviewViewport {
  width: number;
  height: number;
  padding: { left: number; right: number; top: number; bottom: number };
}

/** Zoom constraints may move a detached MapLibre transform's center. Restore
 * the requested center after every probe so earlier zooms cannot contaminate it. */
export function projectIndoorOverviewAtZoom(
  projection: Pick<
    MapLibreMap["transform"],
    "setZoom" | "setCenter" | "locationToScreenPoint"
  >,
  zoom: number,
  center: LngLat,
  points: readonly LngLat[],
) {
  projection.setZoom(zoom);
  projection.setCenter(center);
  return points.map((point) => projection.locationToScreenPoint(point));
}

/** Constrain an initial estimate with the actual perspective projection. The
 * projector must use a detached camera/transform so fitting emits no map events. */
export function fitIndoorOverviewZoom(
  viewport: OverviewViewport,
  minimumZoom: number,
  initialZoom: number,
  projectAtZoom: (zoom: number) => { x: number; y: number }[],
): number | null {
  const margin = 16;
  const left = viewport.padding.left + margin;
  const right = viewport.width - viewport.padding.right - margin;
  const top = viewport.padding.top + margin;
  const bottom = viewport.height - viewport.padding.bottom - margin;
  if (
    right <= left ||
    bottom <= top ||
    !Number.isFinite(initialZoom) ||
    !Number.isFinite(minimumZoom) ||
    minimumZoom > initialZoom
  )
    return null;
  const fits = (zoom: number) => {
    const points = projectAtZoom(zoom);
    return (
      points.length > 0 &&
      points.every(
        (point) =>
          Number.isFinite(point.x) &&
          Number.isFinite(point.y) &&
          point.x >= left &&
          point.x <= right &&
          point.y >= top &&
          point.y <= bottom,
      )
    );
  };
  if (fits(initialZoom)) return initialZoom;
  if (!fits(minimumZoom)) return null;
  let low = minimumZoom,
    high = initialZoom;
  for (let iteration = 0; iteration < 24; iteration++) {
    const middle = (low + high) / 2;
    if (fits(middle)) low = middle;
    else high = middle;
  }
  return low;
}
