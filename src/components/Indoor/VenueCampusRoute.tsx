"use client";

import { useMemo } from "react";
import { Layer, Source } from "react-map-gl/maplibre";
import { localToLngLat } from "@/lib/indoor/coordinates";
import useIndoorCatalog from "@/stores/useIndoorCatalog";
import useMapStore from "@/stores/useMapStore";

/** Only source graph edges outside the building; no arbitrary origin-to-gate line. */
export default function VenueCampusRoute() {
  const journey = useMapStore((s) => s.venueJourney);
  const indoorExploring = useMapStore((s) => s.indoorExploring);
  const models = useIndoorCatalog((s) => s.models);
  const data = useMemo<GeoJSON.FeatureCollection<GeoJSON.LineString>>(() => {
    const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
    const model = models.find(
      (item) =>
        item.venueId === journey?.venueId &&
        item.building.id === journey.buildingId &&
        item.source.sha256 === journey.sourceVersion,
    );
    if (!model || !journey) return { type: "FeatureCollection", features };
    const edges = new Set(journey.route.edgeIds);
    const nodes = new Map(model.nodes.map((node) => [node.id, node]));
    for (const edge of model.edges) {
      if (!edges.has(edge.id)) continue;
      const from = nodes.get(edge.from),
        to = nodes.get(edge.to);
      if (!from || !to || (from.levelRef !== null && to.levelRef !== null))
        continue;
      features.push({
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: [
            localToLngLat([from.point[0], from.point[1]], model.origin),
            localToLngLat([to.point[0], to.point[1]], model.origin),
          ],
        },
      });
    }
    return { type: "FeatureCollection", features };
  }, [journey, models]);
  // The cutaway owns the current-floor route. Campus approach lines return
  // when the user zooms out, without resetting the shared journey.
  if (!journey || indoorExploring || data.features.length === 0) return null;
  return (
    <Source id="venue-campus-route" type="geojson" data={data}>
      <Layer
        id="venue-campus-route-casing"
        type="line"
        layout={{ "line-cap": "round", "line-join": "round" }}
        paint={{ "line-color": "#ffffff", "line-width": 9 }}
      />
      <Layer
        id="venue-campus-route-line"
        type="line"
        layout={{ "line-cap": "round", "line-join": "round" }}
        paint={{ "line-color": "#2563eb", "line-width": 5 }}
      />
    </Source>
  );
}
