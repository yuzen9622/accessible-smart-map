import type { LayerSpecification, LineLayerSpecification } from "maplibre-gl";

export const CAMPUS_ROAD_SOURCE = "venue-campus-roads";

/** Copy the loaded basemap's road appearance, including zoom expressions. */
export function campusRoadLayers(
  layers: LayerSpecification[],
): LineLayerSpecification[] {
  const ids = new Set(layers.map((layer) => layer.id));
  const choices: ["path" | "service", string[]][] = [
    [
      "path",
      ids.has("road_path_pedestrian")
        ? ["road_path_pedestrian"]
        : ["highway_path"],
    ],
    [
      "service",
      ids.has("road_service_track")
        ? ["road_service_track_casing", "road_service_track"]
        : ["highway_minor"],
    ],
  ];
  return choices.flatMap(([kind, candidates]) =>
    candidates.flatMap((id): LineLayerSpecification[] => {
      const source = layers.find(
        (layer): layer is LineLayerSpecification =>
          layer.id === id && layer.type === "line",
      );
      if (!source) return [];
      return [
        {
          id: `${CAMPUS_ROAD_SOURCE}-${id}`,
          type: "line",
          source: CAMPUS_ROAD_SOURCE,
          ...(source.minzoom !== undefined ? { minzoom: source.minzoom } : {}),
          ...(source.maxzoom !== undefined ? { maxzoom: source.maxzoom } : {}),
          filter: ["==", ["get", "roadClass"], kind],
          layout: structuredClone(source.layout ?? {}),
          paint: structuredClone(source.paint ?? {}),
        },
      ];
    }),
  );
}
