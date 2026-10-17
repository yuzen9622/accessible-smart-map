import type { PlaceResult } from "./place";

export type {
  AutocompleteItem,
  NearbyFacilityBrief,
  PlaceAccessibility,
  PlaceAddressComponents,
  PlaceGeoPoint,
  PlaceResult,
  PlaceReviewKey,
  PlaceSource,
} from "./place";

export type {
  MatchedAlert,
  MatchKind,
  MetroAlert,
  TransitAlert,
} from "./transit-alert";

export type LatLng = { lat: number; lng: number };

export type NominatimPlace = {
  place_id: number;
  osm_id?: number;
  osm_type?: string;
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
  type?: string;
  category?: string;
  class?: string;
  address?: Record<string, string>;
};

export enum A11yEnum {
  ELEVATOR = "電梯",
  RAMP = "斜坡",
  RESTROOM = "廁所",
  NONE = "無",
}

export type Marker = {
  id: number | string;
  position: LatLng;
  content?: { title: string; desc: string };
  /** Source name retained for selected-facility locale fallback. */
  canonicalTitle?: string;
  type: "pin";
  zIndex: number;
  a11yType: A11yEnum;
};

// --- PlaceDetail: discriminated union ---
type PlaceType = {
  kind: "place";
  place: PlaceResult;
};

type CoordinateType = {
  kind: "coordinate";
  address: string;
  /** Set only for facility pins; never infer identity from translated text. */
  facilityId?: string | number;
  canonicalAddress?: string;
};

type Base = {
  position: LatLng;
};

/** A campus endpoint keeps its graph identity, even when floors overlap on a map. */
export type VenuePlaceDetail = Base & {
  kind: "venue-place";
  address: string;
  name: string;
  venueId: string;
  buildingId: string | null;
  buildingName: string;
  levelRef: string | null;
  placeId: string;
  sourceVersion: string;
  dataSource: "local" | "api";
  arrivalKind: "door" | "corridor" | "place";
};

export type PlaceDetail =
  | ((PlaceType | CoordinateType) & Base)
  | VenuePlaceDetail;

export type VenueFeatureDetail = Base & {
  kind: "venue-feature";
  venueId: string;
  buildingId: string;
  featureId: string;
  name: string;
  address: string;
  levelRef: string | null;
};

// --- AiResultMarker: AI 工具結果在地圖/聊天卡片上的可點標記 ---
export type AiResultMarker = {
  id: string;
  position: LatLng;
  title: string;
  desc?: string;
  target:
    | { panel: "place"; place: PlaceResult }
    | { panel: "station"; marker: Marker };
};

// --- InfoShow ---
export type InfoShow =
  | (PlaceType & { isOpen: boolean })
  | (CoordinateType & { isOpen: boolean; position?: LatLng })
  | (VenuePlaceDetail & { isOpen: boolean })
  | (VenueFeatureDetail & { isOpen: boolean })
  | { isOpen: boolean; kind: null };

export type metroA11yData = {
  displayName?: string;
  _id?: string;
  osmId?: string;
  source?: "metro" | "osm";
  項次: number | string;
  _importdata?: { date: string; timezone: string; timezone_type: number };
  出入口編號?: string;
  "出入口電梯/無障礙坡道名稱": string;
  // Older payloads carried flat 經度/緯度; newer ones only a GeoJSON point.
  經度?: number | string;
  緯度?: number | string;
  location?: { type: "Point"; coordinates: [number, number] };
};

export type metroA11yAPI = {
  result: {
    count: number;
    limit: number;
    offset: number;
    results: metroA11yData[];
  };
};

export interface IBathroom {
  displayName?: string;
  displayAddress?: string;
  _id: string;
  contury: string;
  areacode: string;
  village: string;
  number: string;
  name: string;
  address: string;
  administration: string;
  // Older payloads carried flat latitude/longitude; newer ones only a
  // GeoJSON point.
  latitude?: number;
  longitude?: number;
  location?: { type: "Point"; coordinates: [number, number] };
  grade: string;
  type2: string;
  type: string;
  exec: string;
  diaper: string;
}
