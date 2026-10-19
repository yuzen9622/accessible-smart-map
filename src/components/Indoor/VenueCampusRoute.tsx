"use client";

import { useTheme } from "next-themes";
import { useMemo } from "react";
import { Layer, Source } from "react-map-gl/maplibre";
import { campusRouteDisplaySegments } from "@/lib/indoor/campusRouteSegments";
import { indoorModelVersion } from "@/lib/indoor/catalog";
import { localToLngLat } from "@/lib/indoor/coordinates";
import { getIndoorPalette } from "@/lib/indoor/indoorTheme";
import useIndoorCatalog from "@/stores/useIndoorCatalog";
import useMapStore from "@/stores/useMapStore";

export {
  campusRouteDisplaySegments,
  campusRouteSegments,
} from "@/lib/indoor/campusRouteSegments";

/** Only source graph edges outside the building; no arbitrary origin-to-gate line. */
export default function VenueCampusRoute() {
  const { resolvedTheme } = useTheme();
  const palette = getIndoorPalette(resolvedTheme === "dark" ? "dark" : "light");
  const journey = useMapStore((s) => s.venueJourney);
  const indoorExploring = useMapStore((s) => s.indoorExploring);
  const models = useIndoorCatalog((s) => s.models);
  const data = useMemo<GeoJSON.FeatureCollection<GeoJSON.LineString>>(() => {
    const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
    const model = models.find(
      (item) =>
        item.venueId === journey?.venueId &&
        item.building.id === journey.buildingId &&
        indoorModelVersion(item) === journey.sourceVersion,
    );
    if (!model || !journey || indoorExploring)
      return { type: "FeatureCollection", features };
    for (const segment of campusRouteDisplaySegments(journey.route, model)) {
      const [from, to] = segment.coordinates;
      features.push({
        type: "Feature",
        properties: {
          pathStart: segment.pathStart,
          pathEnd: segment.pathEnd,
          kind: segment.kind,
          connectionId: segment.connectionId,
          accessibleRamp: segment.accessibleRamp,
        },
        geometry: {
          type: "LineString",
          coordinates: [
            localToLngLat([from[0], from[1]], model.origin),
            localToLngLat([to[0], to[1]], model.origin),
          ],
        },
      });
    }
    return { type: "FeatureCollection", features };
  }, [journey, models, indoorExploring]);
  // Indoors the shared Three overlay draws these source links after all
  // building geometry, so an exterior roof cannot occlude the guidance line.
  if (!journey || data.features.length === 0) return null;
  return (
    <Source id="venue-campus-route" type="geojson" data={data}>
      <Layer
        id="venue-campus-route-casing"
        type="line"
        layout={{ "line-cap": "round", "line-join": "round" }}
        paint={{ "line-color": palette.routeCasingCss, "line-width": 9 }}
      />
      <Layer
        id="venue-campus-route-line"
        type="line"
        layout={{ "line-cap": "round", "line-join": "round" }}
        paint={{
          "line-color": [
            "case",
            ["boolean", ["get", "accessibleRamp"], false],
            palette.accessibleRampCss,
            palette.primaryCss,
          ],
          "line-width": 5,
        }}
      />
    </Source>
  );
}
