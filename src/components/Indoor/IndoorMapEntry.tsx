"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef } from "react";
import { Layer, Source, useMap } from "react-map-gl/maplibre";
import { isLocalIndoorModel, venueBuildingKey } from "@/lib/indoor/catalog";
import { localToLngLat } from "@/lib/indoor/coordinates";
import useIndoorCatalog from "@/stores/useIndoorCatalog";
import VenueCampusRoute from "./VenueCampusRoute";
import VenueJourneyMapSync from "./VenueJourneyMapSync";
import VenueJourneyPlayback from "./VenueJourneyPlayback";

const IndoorProductView = dynamic(() => import("./IndoorProductView"), {
  ssr: false,
});
export const INDOOR_BUILDING_LAYER_ID = "local-indoor-building";

/** The provider, original map and route session remain mounted outside cutaway mode. */
export default function IndoorMapEntry({
  open,
  onOpenChange,
  is3D,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  is3D: boolean;
}) {
  const { current: map } = useMap();
  const models = useIndoorCatalog((s) => s.models);
  const activeKey = useIndoorCatalog((s) => s.activeBuildingKey);
  const located = useRef(false);
  const model =
    models.find((item) => venueBuildingKey(item) === activeKey) ?? models[0];
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_INDOOR_PREVIEW !== "1") return;
    const controller = new AbortController();
    fetch("/api/local-indoor/", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return;
        const data: unknown = await response.json();
        if (controller.signal.aborted) return;
        if (isLocalIndoorModel(data))
          useIndoorCatalog.getState().setModels([data]);
      })
      .catch(() => {
        /* A local provider is optional; outdoor search stays usable. */
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (open && !is3D) onOpenChange(false);
  }, [open, is3D, onOpenChange]);
  useEffect(() => {
    if (
      !model ||
      !map ||
      located.current ||
      new URLSearchParams(location.search).get("indoor") !== "1"
    )
      return;
    const locate = () => {
      if (located.current) return;
      located.current = true;
      map.flyTo({
        center: model.origin,
        zoom: 18.3,
        duration: document.hidden ? 0 : 1200,
      });
    };
    if (map.getMap().getStyle()?.layers) locate();
    else map.once("load", locate);
    return () => {
      map.off("load", locate);
    };
  }, [map, model]);
  const buildings = useMemo<GeoJSON.FeatureCollection<GeoJSON.Polygon>>(
    () => ({
      type: "FeatureCollection",
      features: models.map((item) => ({
        type: "Feature",
        properties: {
          buildingKey: venueBuildingKey(item),
          height:
            Math.max(...item.building.levels.map((level) => level.elevationM)) +
            item.building.floorHeightM,
        },
        geometry: {
          type: "Polygon",
          coordinates: item.building.footprint.map((ring) =>
            ring.map((point) => localToLngLat(point, item.origin)),
          ),
        },
      })),
    }),
    [models],
  );
  if (!model) return null;
  return (
    <>
      <VenueJourneyPlayback />
      <VenueJourneyMapSync />
      <VenueCampusRoute />
      {open ? (
        <IndoorProductView
          key={venueBuildingKey(model)}
          model={model}
          onClose={() => onOpenChange(false)}
        />
      ) : (
        <Source
          id="local-indoor-building-source"
          type="geojson"
          data={buildings}
        >
          <Layer
            id={INDOOR_BUILDING_LAYER_ID}
            type="fill-extrusion"
            minzoom={14}
            paint={{
              "fill-extrusion-color": "#ffffff",
              "fill-extrusion-height": is3D ? ["get", "height"] : 0,
              "fill-extrusion-base": 0,
              "fill-extrusion-opacity": 0,
            }}
          />
        </Source>
      )}
    </>
  );
}
