import type { TFunction } from "i18next";
import {
  A11yEnum,
  type AiResultMarker,
  type IBathroom,
  type LatLng,
  type Marker,
  type metroA11yData,
  type PlaceResult,
} from "@/types";
import { formatBathroom, formatMetroA11y } from "./utils";

// biome-ignore lint/suspicious/noExplicitAny: 後端工具回傳形狀不固定，這裡刻意用 any 做防禦式存取
type AnyRec = Record<string, any>; // pi-lens-ignore: no-unsafe-dictionary-any -- Existing dynamic tool DTO boundary.

/**
 * 防禦式座標偵測：依序嘗試多種常見欄位命名，回傳 LatLng 或 null。
 * 座標數值僅供地圖定位/開詳情使用，不會渲染給使用者看。
 */
export function getLatLng(item: AnyRec | null | undefined): LatLng | null {
  if (!item || typeof item !== "object") return null;

  const toNum = (v: unknown): number | null => {
    if (typeof v === "number") return Number.isNaN(v) ? null : v;
    if (typeof v === "string") {
      const n = parseFloat(v);
      return Number.isNaN(n) ? null : n;
    }
    return null;
  };
  const pair = (lat: unknown, lng: unknown): LatLng | null => {
    const la = toNum(lat);
    const ln = toNum(lng);
    return la !== null && ln !== null ? { lat: la, lng: ln } : null;
  };
  // GeoJSON 座標陣列為 [lng, lat]
  const coords = (c: unknown): LatLng | null =>
    Array.isArray(c) && c.length >= 2 ? pair(c[1], c[0]) : null;

  return (
    pair(item.geometry?.location?.lat, item.geometry?.location?.lng) ??
    pair(
      item.geometry?.location?.latitude,
      item.geometry?.location?.longitude,
    ) ??
    pair(item.location?.lat, item.location?.lng) ??
    pair(item.location?.latitude, item.location?.longitude) ??
    pair(item.position?.lat, item.position?.lng) ??
    pair(item.position?.latitude, item.position?.longitude) ??
    pair(item.lat, item.lng) ??
    pair(item.latitude, item.longitude) ??
    pair(item.lat, item.lon) ??
    pair(item.緯度, item.經度) ??
    pair(item.PositionLat, item.PositionLon) ??
    pair(item.StopPosition?.PositionLat, item.StopPosition?.PositionLon) ??
    pair(item.BusPosition?.PositionLat, item.BusPosition?.PositionLon) ??
    coords(item.location?.coordinates) ??
    coords(item.position?.coordinates) ??
    coords(item.reportedLocation?.coordinates) ??
    coords(item.geometry?.coordinates) ??
    coords(item.coordinates) ??
    null
  );
}

function isOk(res: AnyRec | null | undefined): res is AnyRec {
  if (!res || typeof res !== "object") return false;
  if (res.ok === false) return false;
  if (res.status && res.status !== "OK") return false;
  return true;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

function dedupe(markers: AiResultMarker[]): AiResultMarker[] {
  const seen = new Map<string, AiResultMarker>();
  for (const m of markers) if (!seen.has(m.id)) seen.set(m.id, m);
  return Array.from(seen.values());
}

/** findGooglePlaces 結果 → 可點標記（開 PlaceContent）。 */
export function googlePlacesToMarkers(
  res: unknown,
  t?: TFunction,
): AiResultMarker[] {
  const r = res as AnyRec;
  if (!isOk(r) || !Array.isArray(r.places)) return [];

  const markers: AiResultMarker[] = [];
  r.places.forEach((place: AnyRec, i: number) => {
    const pos = getLatLng(place);
    if (!pos) return;
    const name: string =
      place.name ||
      place.formatted_address ||
      (t ? t("toolResults.place") : "地點");
    const googlePlaceId =
      typeof place.place_id === "string" && place.place_id
        ? place.place_id
        : null;
    const fullAddress =
      typeof place.formatted_address === "string"
        ? place.formatted_address
        : name;
    const placeType =
      typeof place.types?.[0] === "string"
        ? place.types[0]
        : typeof place.type === "string"
          ? place.type
          : null;
    const synthetic: PlaceResult = {
      id: googlePlaceId
        ? `google:${googlePlaceId}`
        : `coord:${pos.lat},${pos.lng}`,
      source: "google",
      name,
      fullAddress,
      addressComponents: {
        road: null,
        district: null,
        city: null,
        postcode: null,
      },
      location: { type: "Point", coordinates: [pos.lng, pos.lat] },
      placeClass: null,
      placeType,
      typeLabel: null,
      distanceMeters: null,
      rating: typeof place.rating === "number" ? place.rating : null,
      accessibility: {
        status: "unknown",
        wheelchair: null,
        nearbyFacilityCount: 0,
        source: "none",
      },
      nearbyFacilities: { toilets: [], metro: [] },
      reviewKey: googlePlaceId
        ? { placeId: googlePlaceId, placeType: "google" }
        : null,
      externalLinks: {
        osm: null,
        google: googlePlaceId
          ? `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(googlePlaceId)}`
          : null,
      },
      attribution: "Powered by Google",
    };

    markers.push({
      id: `g_${googlePlaceId ?? i}`,
      position: pos,
      title: name,
      desc: fullAddress,
      target: { panel: "place", place: synthetic },
    });
  });

  return dedupe(markers);
}

/** findA11yPlaces 結果 → 可點標記（開 StationDetailContent，依座標載入周邊設施）。 */
export function a11yPlacesToMarkers(
  res: unknown,
  t?: TFunction,
  useDisplay = true,
): AiResultMarker[] {
  const r = res as AnyRec;
  if (!isOk(r)) return [];
  const places = (r.places || {}) as AnyRec;
  const nearbyBathroom = (places.nearbyBathroom ?? []) as AnyRec[];
  const nearbyOsm = (places.nearbyOsm ?? []) as AnyRec[];
  const nearbyMetroA11y = (places.nearbyMetroA11y ?? []) as AnyRec[];
  const nearbyParking = (places.nearbyParking ?? []) as AnyRec[];

  const markers: AiResultMarker[] = [];
  const pushFromMarker = (m: Marker, display?: AnyRec) => {
    if (Number.isNaN(m.position.lat) || Number.isNaN(m.position.lng)) return;
    markers.push({
      id: String(m.id),
      position: m.position,
      title:
        (useDisplay ? text(display?.displayName) : undefined) ||
        text(m.content?.title) ||
        (t ? t("toolResults.a11yFacilities") : "無障礙設施"),
      desc:
        (useDisplay ? text(display?.displayAddress) : undefined) ||
        m.content?.desc,
      target: { panel: "station", marker: m },
    });
  };

  // 已知形狀 → 重用既有 formatter（formatter 內部會過濾無座標項目）
  nearbyMetroA11y.forEach((item) => {
    formatMetroA11y([item as metroA11yData]).forEach((marker) => {
      pushFromMarker(marker, item);
    });
  });

  const bathItems = nearbyBathroom;
  bathItems.forEach((bathroom) => {
    formatBathroom([bathroom as IBathroom]).forEach((marker) => {
      if (t && marker.content) {
        marker.content = {
          ...marker.content,
          desc: t(
            bathroom.diaper
              ? "toolResults.diaperTableAvailable"
              : "toolResults.diaperTableUnavailable",
          ),
        };
      }
      pushFromMarker(marker, bathroom);
    });
  });

  // 未知形狀（osm / parking）→ 防禦式建 Marker
  [...nearbyOsm, ...nearbyParking].forEach((item, i) => {
    const pos = getLatLng(item);
    if (!pos) return;
    const title: string =
      text(item.name) ||
      text(item.placeName) ||
      text(item.tags?.name) ||
      (t ? t("toolResults.a11yFacilities") : "無障礙設施");
    const marker: Marker = {
      id: item.id ?? item._id ?? item.osmId ?? `a_${i}`,
      position: pos,
      type: "pin",
      content: {
        title,
        desc:
          text(item.address) ||
          text(item.spaceLabel) ||
          text(item.tags?.amenity) ||
          text(item.type) ||
          "",
      },
      zIndex: 1,
      a11yType: A11yEnum.NONE,
    };
    pushFromMarker(marker, item);
  });

  return dedupe(markers);
}
