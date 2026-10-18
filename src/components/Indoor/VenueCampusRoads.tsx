"use client";

import { useEffect, useMemo, useState } from "react";
import { Layer, Source, useMap } from "react-map-gl/maplibre";
import {
  CAMPUS_ROAD_SOURCE,
  campusRoadLayers,
} from "@/lib/indoor/campusRoadStyle";
import { campusRoadData } from "@/lib/indoor/campusRoads";
import useIndoorCatalog from "@/stores/useIndoorCatalog";

/** Ordinary ground paths remain visible while browsing and during navigation. */
export default function VenueCampusRoads() {
  const { current: map } = useMap();
  const models = useIndoorCatalog((state) => state.models);
  const data = useMemo(() => campusRoadData(models), [models]);
  const [appearance, setAppearance] = useState<{
    layers: ReturnType<typeof campusRoadLayers>;
    beforeId?: string;
  }>({ layers: [] });
  useEffect(() => {
    if (!map) return;
    let signature = "";
    const sync = () => {
      const style = map.getStyle();
      if (!style?.layers?.length) return;
      const layers = campusRoadLayers(style.layers);
      // Ground roads precede building geometry, labels, and selected routes.
      const beforeId = style.layers.find(
        (layer) =>
          layer.type === "fill-extrusion" ||
          layer.type === "symbol" ||
          layer.id === "local-indoor-cutaway" ||
          layer.id === "venue-campus-route-casing",
      )?.id;
      const next = JSON.stringify({ layers, beforeId });
      if (signature === next) return;
      signature = next;
      setAppearance({ layers, beforeId });
    };
    sync();
    map.on("styledata", sync);
    return () => {
      map.off("styledata", sync);
    };
  }, [map]);
  if (!data.features.length || !appearance.layers.length) return null;
  return (
    <Source id={CAMPUS_ROAD_SOURCE} type="geojson" data={data}>
      {appearance.layers.map((layer) => (
        <Layer key={layer.id} {...layer} beforeId={appearance.beforeId} />
      ))}
    </Source>
  );
}
