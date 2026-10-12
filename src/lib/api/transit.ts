import type { LatLng } from "@/types";
import type { ApiResponse } from "@/types/response";
import type { BusPlanContext, LiveBusPositionsData } from "@/types/route";
import type {
  BusDirection,
  BusRealtimeNearbyStop,
  BusSearchResult,
  BusStopSearchResult,
  BusTimetableData,
} from "@/types/transit";
import { END_POINT } from "../config";
import { fetchRequest } from "../fetch";
import {
  parseBusArrivals,
  parseBusRouteDirections,
  parseBusTimetable,
  parseLiveBusPositions,
} from "./busParsers";

export type BusLanguage = "en" | "zh-TW";

async function timedBusRequest(url: string, signal?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    return await fetchRequest(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

export async function getBusRealtimeNearbyStop({
  arrival_stop,
  departure_stop,
  arrival_lat,
  arrival_lng,
  route_name,
  language,
}: {
  arrival_stop: string;
  departure_stop: string;
  arrival_lat: number;
  arrival_lng: number;
  language: string;
  route_name: string;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  const data = (await fetchRequest(`${END_POINT}/api/v1/transit/bus`, {
    method: "POST",
    body: {
      arrival_stop,
      departure_stop,
      arrival_lat,
      arrival_lng,
      route_name,
      language: language === "en" ? "En" : "Zh_tw",
    },
    signal: controller.signal,
  })) as ApiResponse<BusRealtimeNearbyStop[]>;
  clearTimeout(timeout);
  return data;
}

export async function getRealtimeBusPosition(
  plate_number: string,
  arrival_lat: number,
  arrival_lng: number,
  route_name: string,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  const data = (await fetchRequest(
    `${END_POINT}/api/v1/transit/bus/realtime?plate_number=${plate_number}&arrival_lat=${arrival_lat}&arrival_lng=${arrival_lng}&route_name=${route_name}`,
    {
      method: "GET",
      signal: controller.signal,
    },
  )) as ApiResponse<BusRealtimeNearbyStop[]>;

  clearTimeout(timeout);
  return data;
}

export async function getBusArrival(
  routeName?: string,
  stopName?: string,
  direction?: BusDirection | null,
  city?: string,
  signal?: AbortSignal,
  lang?: BusLanguage,
) {
  const params = new URLSearchParams();
  if (lang) params.set("lang", lang);
  if (routeName) params.set("routeName", routeName);
  if (stopName) params.set("stopName", stopName);
  if (direction != null) params.set("direction", String(direction));
  if (city) params.set("city", city);
  const data = (await timedBusRequest(
    `${END_POINT}/api/v1/transit/bus/arrival?${params}`,
    signal,
  )) as ApiResponse<{
    routeDisplayName?: string;
    routeName: string;
    city: string;
    stopDisplayName?: string;
    stopName: string;
    arrivals: BusArrivalItem[];
  }>;
  if (data.data)
    data.data = { ...data.data, arrivals: parseBusArrivals(data.data) };
  return data;
}

export interface BusArrivalItem {
  stopDisplayName?: string;
  subRouteDisplayName?: string;
  stopName: string;
  direction: BusDirection;
  directionLabel: string;
  estimateMinutes: number | null;
  /** Compound display text (status/schedule/headway), not a raw status code. */
  statusLabel: string;
  /**
   * Plate of the vehicle this ETA refers to, when TDX has dispatched one.
   * Absent until a bus is assigned; the backend strips TDX's "-1" sentinel.
   */
  plateNumb?: string;
  /** Which sub-route this arrival belongs to — a line's feed mixes several. */
  subRouteUid?: string;
  subRouteName?: string;
}

/**
 * Live realtime positions of every vehicle running a bus route (optionally
 * scoped to one direction). The backend normalises raw TDX frames into the
 * {@link LiveBusPositionsData} shape (camelCase, lat/lng, low-floor flags).
 *
 * Pass an AbortSignal so callers polling on an interval can cancel the
 * in-flight request when the route changes or the component unmounts.
 */
export async function getLiveBusPositions(
  routeName: string,
  city?: string,
  direction?: BusDirection | null,
  signal?: AbortSignal,
  lang?: BusLanguage,
) {
  const params = new URLSearchParams({ routeName });
  if (lang) params.set("lang", lang);
  if (city) params.set("city", city);
  if (direction != null) params.set("direction", String(direction));
  const data = (await timedBusRequest(
    `${END_POINT}/api/v1/transit/bus/positions?${params}`,
    signal,
  )) as ApiResponse<LiveBusPositionsData>;
  if (data.data) data.data = parseLiveBusPositions(data.data);
  return data;
}

export async function getTrainData() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  const data = await fetchRequest(`${END_POINT}/api/v1/transit/train`, {
    method: "GET",
    signal: controller.signal,
  });
  clearTimeout(timeout);
  return data;
}

export async function searchBusRoutes(
  keyword: string,
  location?: LatLng | { lat: number; lng: number } | null,
  lang?: BusLanguage,
) {
  const params = new URLSearchParams();
  if (lang) params.set("lang", lang);
  params.set("keyword", keyword.trim());
  if (
    location &&
    typeof location.lat === "number" &&
    typeof location.lng === "number"
  ) {
    params.set("location", `${location.lat},${location.lng}`);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  const data = (await fetchRequest(
    `${END_POINT}/api/v1/transit/bus/search-routes?${params.toString()}`,
    { signal: controller.signal },
  )) as ApiResponse<{ routes: BusSearchResult[] }>;
  clearTimeout(timeout);
  return data;
}

export async function searchBusStops(
  keyword: string,
  location?: LatLng | { lat: number; lng: number } | null,
  lang?: BusLanguage,
) {
  const params = new URLSearchParams();
  if (lang) params.set("lang", lang);
  params.set("keyword", keyword.trim());
  if (
    location &&
    typeof location.lat === "number" &&
    typeof location.lng === "number"
  ) {
    params.set("location", `${location.lat},${location.lng}`);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  const data = (await fetchRequest(
    `${END_POINT}/api/v1/transit/bus/search-stops?${params.toString()}`,
    { signal: controller.signal },
  )) as ApiResponse<{ stops: BusStopSearchResult[] }>;
  clearTimeout(timeout);
  return data;
}

export interface RouteDetailStop {
  displayName?: string;
  plateNumb?: string;
  stopUid?: string;
  seq: number;
  name: string;
  lat: number;
  lng: number;
  estimateMinutes: number | null;
  /** Compound display text, just like arrival statusLabel; not raw-code-only. */
  statusLabel: string;
}

export interface RouteDetailDirection {
  subRouteDisplayName?: string;
  from?: string;
  to?: string;
  fromDisplayName?: string;
  toDisplayName?: string;
  direction: BusDirection;
  stops: RouteDetailStop[];
  /** Optional published route geometry, in [lng, lat] order. */
  polyline?: [number, number][];
  /** Identifies which sub-route these stops belong to (99 vs 99延). */
  subRouteUid?: string;
  subRouteName?: string;
}

export async function getBusRouteDetail(
  routeName: string,
  city: string,
  subRouteUid?: string,
  signal?: AbortSignal,
  planContext?: BusPlanContext,
  lang?: BusLanguage,
) {
  const params = new URLSearchParams({ routeName, city });
  if (lang) params.set("lang", lang);
  if (subRouteUid) params.set("subRouteUid", subRouteUid);
  // This capability endpoint has a strict query contract: unlike transit
  // name GETs, it accepts ONLY the token and leg index (no lang).
  const endpoint = planContext
    ? `/api/v1/a11y/accessible-route/bus-arrivals?${new URLSearchParams({ routeToken: planContext.routeToken, legIndex: String(planContext.legIndex) })}`
    : `/api/v1/transit/bus/route-detail?${params}`;
  const data = (await timedBusRequest(
    `${END_POINT}${endpoint}`,
    signal,
  )) as ApiResponse<{
    routeDisplayName?: string;
    directions: RouteDetailDirection[];
  }>;
  if (data.data)
    data.data = {
      ...data.data,
      directions: parseBusRouteDirections(data.data),
    };
  return data;
}

/** Published origin departures/headways, not invented per-stop arrival times. */
export async function getBusTimetable(
  routeName: string,
  city?: string,
  signal?: AbortSignal,
  lang?: BusLanguage,
) {
  const params = new URLSearchParams({ routeName });
  if (lang) params.set("lang", lang);
  if (city) params.set("city", city);
  const data = (await timedBusRequest(
    `${END_POINT}/api/v1/transit/bus/timetable?${params}`,
    signal,
  )) as ApiResponse<BusTimetableData>;
  if (data.data) data.data = parseBusTimetable(data.data);
  return data;
}

export async function getNearbyBusStops(
  lat: number,
  lng: number,
  lang?: BusLanguage,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  const data = (await fetchRequest(
    `${END_POINT}/api/v1/transit/bus/nearby-stops?${new URLSearchParams({ lat: String(lat), lng: String(lng), ...(lang ? { lang } : {}) })}`,
    { signal: controller.signal },
  )) as ApiResponse<{ stops: (BusStopSearchResult & { distance?: number })[] }>;
  clearTimeout(timeout);
  return data;
}
