import type { Map as MapLibreMap } from "maplibre-gl";

// Keep indoor hit testing synchronous with the existing map click dispatcher.
// An empty hit still belongs to the ordinary outdoor map interaction.
const pickers = new WeakMap<
  MapLibreMap,
  (point: { x: number; y: number }) => boolean
>();
export function registerIndoorPicker(
  map: MapLibreMap,
  pick: (point: { x: number; y: number }) => boolean,
) {
  pickers.set(map, pick);
  return () => {
    if (pickers.get(map) === pick) pickers.delete(map);
  };
}
export function selectIndoorAtPoint(
  map: MapLibreMap,
  point: { x: number; y: number },
) {
  return pickers.get(map)?.(point) ?? false;
}
