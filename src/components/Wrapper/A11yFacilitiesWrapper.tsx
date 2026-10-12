import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Marker, useMap } from "react-map-gl/maplibre";
import { toast } from "sonner";
import useSupercluster from "use-supercluster";
import { useShallow } from "zustand/react/shallow";
import A11yFacilityPin from "@/components/A11yFacilityPin";
import { useMapBoundsAndZoom } from "@/hook/useMapBoundsAndZoom";
import { useAppTranslation } from "@/i18n/client";
import { getAllA11yFacilities } from "@/lib/api/a11y";
import { toApiLang } from "@/lib/place/lang";
import { nonemptyName } from "@/lib/route/sourceNames";
import useMapStore from "@/stores/useMapStore";
import { A11yEnum, type Marker as MarkerType } from "@/types";
import type { A11yFacility } from "@/types/route";

// Only elevator/ramp/toilet facilities have a pin category in the current UI
// (see A11yPanel's filter chips); parking/campus-only sources are dropped.
function facilityToMarker(facility: A11yFacility): MarkerType | null {
  let a11yType: A11yEnum;
  switch (facility.category) {
    case "elevator":
      a11yType = A11yEnum.ELEVATOR;
      break;
    case "ramp":
      a11yType = A11yEnum.RAMP;
      break;
    case "toilet":
      a11yType = A11yEnum.RESTROOM;
      break;
    default:
      return null;
  }
  const [lng, lat] = facility.location.coordinates;
  return {
    id: facility._id,
    canonicalTitle: nonemptyName(facility.name) || facility.category,
    position: { lat, lng },
    type: "pin",
    content: {
      title:
        nonemptyName(facility.displayName) ||
        nonemptyName(facility.name) ||
        facility.category,
      desc: facility.source === "metro" ? (facility.exitName ?? "") : "",
    },
    zIndex: 1,
    a11yType,
  };
}

const markerCache = new Map<string, MarkerType[]>();

export default function A11yFacilitiesWrapper() {
  const { t, i18n } = useAppTranslation();
  const lang = toApiLang(i18n.language) ?? "zh-TW";
  const tRef = useRef(t);
  tRef.current = t;
  const { selectedA11yTypes, a11yPlaces, setA11yPlaces, routeA11y } =
    useMapStore(
      useShallow((s) => ({
        selectedA11yTypes: s.selectedA11yTypes,
        a11yPlaces: s.a11yPlaces,
        setA11yPlaces: s.setA11yPlaces,
        routeA11y: s.routeA11y,
      })),
    );
  const { current: map } = useMap();
  const { bounds, zoom } = useMapBoundsAndZoom(map);
  // Successful payloads are cached per effective language, including empty lists.
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const cached = markerCache.get(lang);
    if (cached) {
      setA11yPlaces(cached);
      setIsLoading(false);
      return;
    }
    const controller = new AbortController();
    setA11yPlaces([]);
    setIsLoading(true);
    getAllA11yFacilities(lang)
      .then((facilitiesRes) => {
        if (controller.signal.aborted) return;
        if (!facilitiesRes.ok) throw new Error("Facilities unavailable");
        const markers = (facilitiesRes.data ?? []).flatMap((facility) => {
          const marker = facilityToMarker(facility);
          return marker ? [marker] : [];
        });
        markerCache.set(lang, markers);
        setA11yPlaces(markers);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        toast.error(tRef.current("a11yLoadFailed"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [lang, setA11yPlaces]);

  // Pins appear ONLY for explicitly selected facility types — if user hasn't selected any, do not show.
  const isFilterActive = selectedA11yTypes.size > 0;
  const filteredPlaces = useMemo(
    () =>
      !isFilterActive
        ? []
        : (a11yPlaces?.filter((place) =>
            selectedA11yTypes.has(place.a11yType),
          ) ?? []),
    [isFilterActive, selectedA11yTypes, a11yPlaces],
  );

  // Toggling a filter with zero matching results used to render nothing with
  // no explanation ("looked broken"); confirm the empty result explicitly.
  useEffect(() => {
    if (isLoading) return;
    if (!isFilterActive) return;
    if (filteredPlaces.length === 0) {
      toast(t("noNearbyA11y"));
    }
  }, [isFilterActive, isLoading, filteredPlaces.length, t]);

  const points = useMemo(() => {
    if (!isFilterActive || filteredPlaces.length === 0) return [];
    return filteredPlaces.map((place) => ({
      type: "Feature" as const,
      properties: { cluster: false, placeId: place.id, place },
      geometry: {
        type: "Point" as const,
        coordinates: [place.position.lng, place.position.lat],
      },
    }));
  }, [isFilterActive, filteredPlaces]);

  const { clusters, supercluster } = useSupercluster({
    points,
    bounds: bounds || [-180, -85, 180, 85],
    zoom,
    options: { radius: 75, maxZoom: 16 },
  });

  if (!isFilterActive && routeA11y.length === 0) {
    return null;
  }

  return (
    <>
      {isLoading && selectedA11yTypes.size > 0 && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 rounded-full bg-background/90 backdrop-blur-sm border border-border/50 px-3 py-1.5 text-xs shadow-lg">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t("loadingA11yData")}
        </div>
      )}
      {clusters.map((cluster) => {
        const [longitude, latitude] = cluster.geometry.coordinates;
        const properties = cluster.properties as {
          cluster?: boolean;
          point_count?: number;
          placeId?: string;
          place?: MarkerType;
        };
        const { cluster: isCluster, point_count: pointCount = 0 } = properties;

        if (isCluster) {
          const size = Math.min(30 + (pointCount / points.length) * 40, 60);
          return (
            <Marker
              key={`cluster-${cluster.id}`}
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

        const place = properties.place as MarkerType;
        return <A11yFacilityPin key={`place-${place.id}`} place={place} />;
      })}

      {routeA11y.map((place) => (
        <A11yFacilityPin key={`route-${place.id}`} place={place} />
      ))}
    </>
  );
}
