"use client";
import type { LineLayerSpecification } from "maplibre-gl";
import { Layer, Source } from "react-map-gl/maplibre";

type PolylineProps = {
  id: string;
  path: { lat: number; lng: number }[];
  strokeColor?: string;
  strokeOpacity?: number;
  strokeWeight?: number;
  zIndex?: number;
  dashArray?: number[];
  lineCap?: "butt" | "round" | "square";
  lineJoin?: "bevel" | "round" | "miter";
};

export default function Polyline({
  id,
  path,
  strokeColor = "#000",
  strokeOpacity = 1,
  strokeWeight = 4,
  dashArray,
  lineCap = "round",
  lineJoin = "round",
}: PolylineProps) {
  if (!path.length) return null;

  const geojson: GeoJSON.Feature = {
    type: "Feature",
    properties: {},
    geometry: {
      type: "LineString",
      coordinates: path.map((p) => [p.lng, p.lat]),
    },
  };

  const paint: LineLayerSpecification["paint"] = {
    "line-color": strokeColor,
    "line-opacity": strokeOpacity,
    "line-width": strokeWeight,
  };
  if (dashArray) paint["line-dasharray"] = dashArray;

  const layout: LineLayerSpecification["layout"] = {
    "line-cap": lineCap,
    "line-join": lineJoin,
  };

  return (
    <Source key={id} id={id} type="geojson" data={geojson}>
      <Layer
        key={`${id}-line`}
        id={`${id}-line`}
        type="line"
        paint={paint}
        layout={layout}
      />
    </Source>
  );
}
