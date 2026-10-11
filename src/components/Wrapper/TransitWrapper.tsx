"use client";

import { useEffect, useMemo } from "react";
import { Marker, useMap } from "react-map-gl/maplibre";
import useSupercluster from "use-supercluster";
import { useShallow } from "zustand/react/shallow";
import BusStopPin from "@/components/BusStopPin";
import Polyline from "@/components/Polyline";
import { useMapBoundsAndZoom } from "@/hook/useMapBoundsAndZoom";
import { getNearbyBusStops, type RouteDetailStop } from "@/lib/api/transit";
import useMapStore from "@/stores/useMapStore";
import type { BusStopSearchResult } from "@/types/transit";

type BusPointProperties = {
  cluster: boolean;
  stopId: string;
  stop: (BusStopSearchResult & { distance?: number }) | RouteDetailStop;
};

export default function TransitWrapper() {
  const { current: map } = useMap();
  const {
    activeRailPanel,
    userLocation,
    nearbyBusStops,
    setNearbyBusStops,
    busRouteStops,
    busRoutePolyline,
  } = useMapStore(
    useShallow((s) => ({
      activeRailPanel: s.activeRailPanel,
      userLocation: s.userLocation,
      nearbyBusStops: s.nearbyBusStops,
      setNearbyBusStops: s.setNearbyBusStops,
      busRouteStops: s.busRouteStops,
      busRoutePolyline: s.busRoutePolyline,
    })),
  );

  const { bounds, zoom } = useMapBoundsAndZoom(map);

  // Auto-fetch nearby stops if on bus panel and store has no stops yet
  useEffect(() => {
    if (activeRailPanel !== "bus") return;
    if (nearbyBusStops.length > 0 || busRouteStops.length > 0) return;
    if (!userLocation) return;

    let active = true;
    getNearbyBusStops(userLocation.lat, userLocation.lng)
      .then((res) => {
        if (active && res.ok && res.data?.stops) {
          setNearbyBusStops(res.data.stops);
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [
    activeRailPanel,
    nearbyBusStops.length,
    busRouteStops.length,
    userLocation,
    setNearbyBusStops,
  ]);

  const shouldShow = activeRailPanel === "bus";

  const points = useMemo(() => {
    if (!shouldShow) return [];

    if (busRouteStops.length > 0) {
      const routePoints: {
        type: "Feature";
        properties: BusPointProperties;
        geometry: { type: "Point"; coordinates: [number, number] };
      }[] = busRouteStops.flatMap((stop) => {
        if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lng)) return [];
        return [
          {
            type: "Feature" as const,
            properties: {
              cluster: false,
              stopId: `route-${stop.seq}-${stop.name}`,
              stop,
            },
            geometry: {
              type: "Point" as const,
              coordinates: [stop.lng, stop.lat],
            },
          },
        ];
      });
      return routePoints;
    }

    const stopPoints: {
      type: "Feature";
      properties: BusPointProperties;
      geometry: { type: "Point"; coordinates: [number, number] };
    }[] = nearbyBusStops.flatMap((stop) => {
      const [lng, lat] = stop.coordinates;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
      return [
        {
          type: "Feature" as const,
          properties: {
            cluster: false,
            stopId: `stop-${stop.stopUid}`,
            stop,
          },
          geometry: {
            type: "Point" as const,
            coordinates: [lng, lat],
          },
        },
      ];
    });
    return stopPoints;
  }, [shouldShow, busRouteStops, nearbyBusStops]);

  const { clusters, supercluster } = useSupercluster({
    points,
    bounds: bounds || [-180, -85, 180, 85],
    zoom,
    options: { radius: 60, maxZoom: 16 },
  });

  if (!shouldShow || (points.length === 0 && busRoutePolyline.length < 2))
    return null;

  return (
    <>
      {busRoutePolyline.length >= 2 && (
        <Polyline
          id="selected-bus-route"
          path={busRoutePolyline.map(([lng, lat]) => ({ lng, lat }))}
          strokeColor="#10b981"
          strokeWeight={4}
        />
      )}
      {clusters.map((cluster) => {
        const [longitude, latitude] = cluster.geometry.coordinates;
        const properties = cluster.properties as {
          cluster?: boolean;
          point_count?: number;
          stopId?: string;
          stop?:
            | (BusStopSearchResult & { distance?: number })
            | RouteDetailStop;
        };
        const { cluster: isCluster, point_count: pointCount = 0 } = properties;

        if (isCluster) {
          const size = Math.min(32 + (pointCount / points.length) * 32, 56);
          return (
            <Marker
              key={`bus-cluster-${cluster.id}`}
              latitude={latitude}
              longitude={longitude}
              anchor="center"
              onClick={(e) => {
                e.originalEvent.stopPropagation();
                if (!supercluster || !map) return;
                const expansionZoom = Math.min(
                  supercluster.getClusterExpansionZoom(cluster.id as number),
                  20,
                );
                map.flyTo({
                  center: [longitude, latitude],
                  zoom: expansionZoom,
                  duration: 500,
                });
              }}
            >
              <div
                className="flex items-center justify-center rounded-full bg-primary text-primary-foreground font-bold shadow-md cursor-pointer border-2 border-background transition-transform hover:scale-110"
                style={{
                  width: `${size}px`,
                  height: `${size}px`,
                  fontSize: `${Math.max(12, size / 3)}px`,
                }}
              >
                {pointCount}
              </div>
            </Marker>
          );
        }

        const stop = properties.stop;
        if (!stop) return null;
        const key =
          "stopUid" in stop
            ? `bus-stop-${stop.stopUid}`
            : `bus-route-stop-${stop.seq}-${stop.name}`;
        return <BusStopPin key={key} stop={stop} />;
      })}
    </>
  );
}
