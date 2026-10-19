import type { XY } from "./types";

export type LngLat = [longitude: number, latitude: number];

// Must match the local exporter's whole-building tangent plane. Geographic
// placement does not use the camera's photo-orientation rotation.
const EARTH_RADIUS_M = 6_371_000;
const DEGREES_TO_RADIANS = Math.PI / 180;

export function localToLngLat(point: XY, origin: LngLat): LngLat {
  const longitudeScale =
    EARTH_RADIUS_M *
    Math.cos(origin[1] * DEGREES_TO_RADIANS) *
    DEGREES_TO_RADIANS;
  return [
    origin[0] + point[0] / longitudeScale,
    origin[1] + point[1] / (EARTH_RADIUS_M * DEGREES_TO_RADIANS),
  ];
}

export function lngLatToLocal(point: LngLat, origin: LngLat): XY {
  return [
    (point[0] - origin[0]) *
      EARTH_RADIUS_M *
      Math.cos(origin[1] * DEGREES_TO_RADIANS) *
      DEGREES_TO_RADIANS,
    (point[1] - origin[1]) * EARTH_RADIUS_M * DEGREES_TO_RADIANS,
  ];
}
