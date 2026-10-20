import type { Map as MapLibreMap, RequestTransformFunction } from "maplibre-gl";

const indoorRequests = new WeakMap<MapLibreMap, RequestTransformFunction>();

/** Small bridge: the normal map does not need to load the indoor tile decoder. */
export function indoorBasemapRequest(
  map: MapLibreMap | null | undefined,
  ...args: Parameters<RequestTransformFunction>
): ReturnType<RequestTransformFunction> {
  return (map && indoorRequests.get(map)?.(...args)) || { url: args[0] };
}

export function registerIndoorTileRequest(
  map: MapLibreMap,
  transform: RequestTransformFunction,
): () => void {
  indoorRequests.set(map, transform);
  return () => {
    if (indoorRequests.get(map) === transform) indoorRequests.delete(map);
  };
}
