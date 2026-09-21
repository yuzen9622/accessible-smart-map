"use client";

import type maplibregl from "maplibre-gl";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MapLayerMouseEvent } from "react-map-gl/maplibre";
import MapView, { NavigationControl } from "react-map-gl/maplibre";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import RouteSessionPill from "@/components/Route/RouteSessionPill";
import NowPin from "@/components/shared/NowPin";
import A11yFacilitiesWrapper from "@/components/Wrapper/A11yFacilitiesWrapper";
import MapWrapper from "@/components/Wrapper/MapWrapper";
import RoutePreviewHydrator from "@/components/Wrapper/RoutePreviewHydrator";
import RouteLine from "@/components/Wrapper/RouteWrapper";
import { useAppTranslation } from "@/i18n/client";
import { getPlaceDetails, reverseGeocode } from "@/lib/api/placeSearch";
import { applyMapDimension, type MapTheme } from "@/lib/map/basemap3d";
import { createGpsErrorTracker } from "@/lib/map/gpsErrorHandler";
import { nominatimToPlaceResult } from "@/lib/place/adapters";
import { toApiLang } from "@/lib/place/lang";
import useMapStore from "@/stores/useMapStore";
import useNavStore from "@/stores/useNavStore";
import NavigationController from "./NavigationController";
import SearchPin from "./shared/SearchPin";
import AIResultWrapper from "./Wrapper/AIResultWrapper";
import HazardWrapper from "./Wrapper/HazardWrapper";
import LiveBusWrapper from "./Wrapper/LiveBusWrapper";
import MapControlsWrapper from "./Wrapper/MapControlsWrapper";
import ParkingWrapper from "./Wrapper/ParkingWrapper";
import SosTrackerWrapper from "./Wrapper/SosTrackerWrapper";
import TransitWrapper from "./Wrapper/TransitWrapper";

const VoiceSessionHost = dynamic(() => import("./Voice/VoiceSessionHost"), {
  ssr: false,
});

const MAP_STYLES = {
  light: "https://tiles.openfreemap.org/styles/liberty",
  dark: "https://tiles.openfreemap.org/styles/dark",
};

function toPlaceId(value: string | null) {
  if (!value) return null;
  if (/^(google:.+|osm:(node|way|relation):\d+)$/.test(value)) return value;

  const [type, id] = value.split("_");
  if (!id || !/^\d+$/.test(id)) return null;
  const osmType =
    type === "node" || type === "n"
      ? "node"
      : type === "way" || type === "w"
        ? "way"
        : type === "relation" || type === "r"
          ? "relation"
          : null;
  return osmType ? `osm:${osmType}:${id}` : null;
}

// OpenMapTiles carries name:zh / name:en alongside the default bilingual
// "{name:latin}\n{name:nonlatin}" label — rewrite symbol layers so labels
// follow the UI language only.
function applyMapLanguage(map: maplibregl.Map, language: string) {
  const textField =
    language === "zh-TW"
      ? [
          "coalesce",
          ["get", "name:zh-Hant"],
          ["get", "name:zh"],
          ["get", "name"],
        ]
      : [
          "coalesce",
          ["get", "name:en"],
          ["get", "name:latin"],
          ["get", "name"],
        ];
  const style = map.getStyle();
  if (!style?.layers) return;
  for (const layer of style.layers) {
    if (layer.type !== "symbol") continue;
    const current = map.getLayoutProperty(layer.id, "text-field");
    if (!current) continue;
    // Only touch place-name labels; keep refs, house numbers, shields intact.
    const serialized = JSON.stringify(current);
    if (!serialized.includes("name")) continue;
    if (serialized === JSON.stringify(textField)) continue;
    map.setLayoutProperty(layer.id, "text-field", textField);
  }
}

export default function ClientMap() {
  const {
    map,
    setMap,
    setInfoShow,
    userLocation,
    setUserLocation,
    setSearchPlace,
    searchPlace,
    destination,
    setSheetMode,
    isNavigating,
    is3D,
  } = useMapStore(
    useShallow((s) => ({
      map: s.map,
      setMap: s.setMap,
      setInfoShow: s.setInfoShow,
      userLocation: s.userLocation,
      setUserLocation: s.setUserLocation,
      setSearchPlace: s.setSearchPlace,
      searchPlace: s.searchPlace,
      destination: s.destination,
      setSheetMode: s.setSheetMode,
      isNavigating: s.isNavigating,
      is3D: s.is3D,
    })),
  );
  const { resolvedTheme } = useTheme();
  const { i18n, t } = useAppTranslation();
  const [mounted, setMounted] = useState(false);

  // Shared-location links (?loc=lat,lng) start the camera on the shared point.
  // Falls back to the last-known GPS position cached in localStorage so the map
  // opens near the user instead of the hardcoded Taipei center.
  const [initialCenter] = useState<{ lat: number; lng: number } | null>(() => {
    if (typeof window === "undefined") return null;
    const loc = new URLSearchParams(window.location.search).get("loc");
    if (loc) {
      const [lat, lng] = loc.split(",").map(Number);
      if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    }
    try {
      const cached = localStorage.getItem("lastUserLocation");
      if (cached) {
        const { lat, lng } = JSON.parse(cached);
        if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
      }
    } catch (_err) {
      // Ignore corrupted localStorage cache
    }
    return null;
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  const mapTheme: MapTheme = resolvedTheme === "dark" ? "dark" : "light";
  const mapStyle = MAP_STYLES[mapTheme];

  // The style-lifecycle callbacks below must not be re-created on every 3D
  // toggle (that would rebind onStyleData), so they read the current mode from
  // a ref instead of from their closure.
  const dimensionRef = useRef({ is3D, mapTheme });
  dimensionRef.current = { is3D, mapTheme };

  const pointerDownTime = useRef(0);
  const pointerDownPos = useRef<[number, number]>([0, 0]);
  const locationErrorTracker = useRef(createGpsErrorTracker());

  // The OpenFreeMap sprite lacks some POI icons (gate, bollard, …); register
  // a transparent 1×1 stand-in so MapLibre stops warning on every tile
  // render. Attached from onStyleData because styleimagemissing already fires
  // during the initial style/tile parse, before the load event.
  const spriteFixMapRef = useRef<maplibregl.Map | null>(null);
  const attachSpriteFallback = useCallback((target: maplibregl.Map) => {
    if (spriteFixMapRef.current === target) return;
    spriteFixMapRef.current = target;
    target.on("styleimagemissing", (e) => {
      // Only register the stand-in once the style (incl. sprite) has fully
      // loaded — before that, "missing" may just mean "sprite still
      // downloading", and a transparent placeholder would permanently mask
      // the real icon when it arrives.
      if (!target.isStyleLoaded()) return;
      if (target.hasImage(e.id)) return;
      target.addImage(e.id, {
        width: 1,
        height: 1,
        data: new Uint8Array(4),
      });
    });
  }, []);

  // Snap (never fade) the 2D/3D groups into place: on first load there is
  // nothing to fade from, and after a theme swap the new style arrives with the
  // groups reset, so the current mode has to be restored as-is.
  const restoreDimension = useCallback((target: maplibregl.Map) => {
    const { is3D: mode, mapTheme: theme } = dimensionRef.current;
    applyMapDimension(target, mode, theme, { animate: false });
  }, []);

  const handleLoad = useCallback(
    (evt: { target: maplibregl.Map }) => {
      setMap(evt.target);
      applyMapLanguage(evt.target, i18n.language);
      attachSpriteFallback(evt.target);
      restoreDimension(evt.target);
    },
    [setMap, i18n.language, attachSpriteFallback, restoreDimension],
  );

  // Re-apply after theme swaps replace the style; the equality guard inside
  // applyMapLanguage keeps this from looping on its own styledata events, and
  // applyMapDimension has the same kind of guard (needsApply).
  const handleStyleData = useCallback(
    (evt: { target: maplibregl.Map }) => {
      applyMapLanguage(evt.target, i18n.language);
      attachSpriteFallback(evt.target);
      restoreDimension(evt.target);
    },
    [i18n.language, attachSpriteFallback, restoreDimension],
  );

  // Cross-fade whenever the mode changes. Subscribing to the store state (not
  // patching each setter) covers all three writers: the 2D/3D button,
  // setIsNavigating, and confirmNavExit.
  useEffect(() => {
    if (!map) return;
    applyMapDimension(map, is3D, mapTheme, { animate: true });
  }, [map, is3D, mapTheme]);

  useEffect(() => {
    const mock = new URLSearchParams(window.location.search).get("mockgeo");
    if (mock) {
      const [lat, lng] = mock.split(",").map(Number);
      const loc = { lat, lng };
      setUserLocation(loc);
      try {
        localStorage.setItem("lastUserLocation", JSON.stringify(loc));
      } catch (_err) {
        // localStorage write failure is non-fatal.
      }
      const tId = setInterval(() => setUserLocation(loc), 2000);
      return () => clearInterval(tId);
    }

    if (typeof navigator === "undefined" || !navigator.geolocation) return;

    const tracker = locationErrorTracker.current;

    const onPos = (pos: GeolocationPosition) => {
      tracker.recordSuccess();
      const loc = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
      };
      setUserLocation(loc);
      try {
        localStorage.setItem("lastUserLocation", JSON.stringify(loc));
      } catch (_err) {
        // localStorage write failure is non-fatal.
      }
      const h = pos.coords.heading;
      useNavStore
        .getState()
        .setGpsHeading(typeof h === "number" && !Number.isNaN(h) ? h : null);
    };

    const onPosError = () => {
      tracker.recordError(() => {
        toast.error(t("noLocation", "無法取得目前位置"));
      });
    };

    // Fast coarse fix so the map centers on the user immediately, then
    // watchPosition upgrades to high-accuracy tracking.
    navigator.geolocation.getCurrentPosition(onPos, () => {}, {
      enableHighAccuracy: false,
      maximumAge: 60_000,
      timeout: 5_000,
    });

    const watchId = navigator.geolocation.watchPosition(onPos, onPosError, {
      enableHighAccuracy: true,
      maximumAge: 1000,
    });
    return () => navigator.geolocation.clearWatch(watchId);
  }, [setUserLocation, t]);

  // Cold-load with no share link: recenter the camera on the user's first GPS
  // fix instead of leaving it on the hardcoded Taipei fallback. Fires once so
  // it never fights subsequent manual panning.
  const hasAutoLocatedRef = useRef(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hasSpecialParam =
      params.has("sessionId") ||
      params.has("liff.state") ||
      params.has("sos") ||
      params.has("place");
    if (hasSpecialParam) return;

    if (initialCenter) return;
    if (hasAutoLocatedRef.current) return;
    if (!map || !userLocation) return;
    hasAutoLocatedRef.current = true;
    map.flyTo({
      center: [userLocation.lng, userLocation.lat],
      zoom: 17,
      duration: 1000,
    });
  }, [map, userLocation, initialCenter]);

  // Shared-location links (?loc=lat,lng from the share dialog) land on the
  // shared point with the place panel open.
  useEffect(() => {
    const loc = new URLSearchParams(window.location.search).get("loc");

    if (!loc) return;
    const [lat, lng] = loc.split(",").map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const position = { lat, lng };
    const lang = i18n.language === "zh-TW" ? "zh-TW" : "en";
    setSheetMode("place");
    reverseGeocode({ lat, lng, lang, zoom: 18 })
      .then((formatted) => {
        if (!formatted) throw new Error("Reverse geocoding failed");

        const place = nominatimToPlaceResult(formatted);
        const [placeLng, placeLat] = place.location.coordinates;
        setInfoShow({ isOpen: true, kind: "place", place });
        setSearchPlace({
          kind: "place",
          place,
          position: { lat: placeLat, lng: placeLng },
        });
      })
      .catch(() => {
        setInfoShow({
          isOpen: true,
          kind: "coordinate",
          address: `${lat}, ${lng}`,
          position,
        });
        setSearchPlace({
          kind: "coordinate",
          address: `${lat}, ${lng}`,
          position,
        });
      });
  }, [i18n.language, setInfoShow, setSearchPlace, setSheetMode]);

  // Shared-place links accept the current prefixed id and the legacy OSM key.
  useEffect(() => {
    const placeParam = new URLSearchParams(window.location.search).get("place");
    const placeId = toPlaceId(placeParam);

    if (!placeId) return;

    const controller = new AbortController();

    setSheetMode("place");
    getPlaceDetails(
      placeId,
      { lang: toApiLang(i18n.language) },
      controller.signal,
    )
      .then((res) => {
        if (!res.ok || !res.data) return;

        const place = res.data;
        const [lng, lat] = place.location.coordinates;
        const position = { lat, lng };
        setInfoShow({ isOpen: true, kind: "place", place });
        setSearchPlace({ kind: "place", place, position });
        map?.flyTo({
          center: [lng, lat],
          zoom: 18,
          duration: 1000,
        });
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
      });

    return () => controller.abort();
  }, [i18n.language, map, setInfoShow, setSearchPlace, setSheetMode]);

  const handleMouseDown = useCallback((e: MapLayerMouseEvent) => {
    pointerDownTime.current = Date.now();
    pointerDownPos.current = [e.point.x, e.point.y];
  }, []);

  const handleClick = useCallback(
    async (e: MapLayerMouseEvent) => {
      if (isNavigating) return;
      const dt = Date.now() - pointerDownTime.current;
      const [sx, sy] = pointerDownPos.current;
      const dx = Math.abs(e.point.x - sx);
      const dy = Math.abs(e.point.y - sy);
      // Only trigger on deliberate taps: short press + minimal movement
      if (dt > 250 || dx > 4 || dy > 4) return;

      const { lngLat } = e;
      const lat = lngLat.lat;
      const lng = lngLat.lng;
      const lang = i18n.language === "zh-TW" ? "zh-TW" : "en";

      setInfoShow({ isOpen: true, kind: null });
      setSheetMode("place");

      try {
        const formatted = await reverseGeocode({ lat, lng, lang, zoom: 18 });

        if (formatted) {
          const place = nominatimToPlaceResult(formatted);
          const [placeLng, placeLat] = place.location.coordinates;
          setInfoShow({
            isOpen: true,
            place,
            kind: "place",
          });
          setSearchPlace({
            kind: "place",
            place,
            position: { lat: placeLat, lng: placeLng },
          });
        } else {
          setInfoShow({ isOpen: false, kind: null });
        }
      } catch (_err) {
        setInfoShow({ isOpen: false, kind: null });
      }
    },
    [i18n.language, setInfoShow, setSearchPlace, setSheetMode, isNavigating],
  );

  if (!mounted)
    return <div style={{ flex: 1, backgroundColor: "transparent" }} />;

  return (
    <MapView
      key={i18n.language}
      initialViewState={{
        longitude: initialCenter?.lng ?? 121.55,
        latitude: initialCenter?.lat ?? 25.03,
        zoom: initialCenter ? 17 : 15,
      }}
      mapStyle={mapStyle}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      onLoad={handleLoad}
      onStyleData={handleStyleData}
      style={{ position: "relative", flex: 1, overflow: "hidden" }}
      // Explicit `compact: true` (not relying on MapLibre's width-based
      // auto-detect) so the OSM/OpenFreeMap/OpenMapTiles/MapLibre credit
      // links always start collapsed behind a single toggle button instead
      // of sitting in the tab order as four separate stops on every load.
      attributionControl={{ compact: true }}
    >
      <NavigationControl position="top-right" showCompass={false} />
      <MapWrapper />
      <A11yFacilitiesWrapper />
      <NowPin />
      <MapControlsWrapper />
      {searchPlace ? (
        <SearchPin destination={searchPlace} />
      ) : destination ? (
        <SearchPin destination={destination} />
      ) : null}
      <TransitWrapper />
      <ParkingWrapper />
      <LiveBusWrapper />
      <HazardWrapper />
      <VoiceSessionHost />
      <RouteLine />
      <RouteSessionPill />
      <SosTrackerWrapper />
      <RoutePreviewHydrator />
      <AIResultWrapper />
      {isNavigating && <NavigationController />}
    </MapView>
  );
}
