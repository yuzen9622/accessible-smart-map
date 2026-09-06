import type maplibregl from "maplibre-gl";
import type { StateCreator } from "zustand";
import type { RouteDetailStop } from "@/lib/api/transit";
import type {
  AiResultMarker,
  InfoShow,
  LatLng,
  Marker,
  PlaceDetail,
} from "@/types";
import type { A11yEnum } from "@/types/index";
import type {
  AccessibleRoute,
  BusLeg,
  LiveBus,
  MatchedAlert,
  MetroAlertResult,
  ParkingNearbyItem,
} from "@/types/route";
import type { BusStopSearchResult } from "@/types/transit";

// 無障礙設施 used to be a sheetMode of its own; it's a rail panel now
// (RailPanel below), so nothing sets a "a11y" sheet mode any more.
export type SheetMode =
  | "home"
  | "place"
  | "plan"
  | "route"
  | "navigation"
  | "station";
export type MobileSheetSnap = "peek" | "half" | "full";
export type RailPanel =
  | "none"
  | "search"
  | "route"
  | "a11y"
  | "bus"
  | "parking"
  | "environment"
  | "hazard"
  | "welfare"
  | "saved"
  // Route-results-only sub-panel (AI 路線說明). Only ever set/read while
  // sheetMode === "route" (see RouteContent); not reachable from the home
  // rail, so it's absent from RAIL_ITEMS/RAIL_MORE_ITEMS/RAIL_CONTENT_PANELS.
  | "explanation";

export interface HazardReportContext {
  description: string;
  location: LatLng | null;
}

export interface MapInstanceSlice {
  map: maplibregl.Map | null;
  setMap: (map: maplibregl.Map) => void;
  userLocation: LatLng | null;
  setUserLocation: (location: LatLng | null) => void;
  infoShow: InfoShow;
  setInfoShow: (infoShow: Partial<InfoShow>) => void;
  is3D: boolean;
  setIs3D: (v: boolean) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean) => void;
}

export interface RouteSlice {
  origin: PlaceDetail | null;
  setOrigin: (origin: PlaceDetail | null) => void;
  destination: PlaceDetail | null;
  setDestination: (destination: PlaceDetail | null) => void;
  originName: string;
  setOriginName: (name: string) => void;
  destinationName: string;
  setDestinationName: (name: string) => void;
  computeRoutes: AccessibleRoute[] | null;
  setComputeRoutes: (routes: AccessibleRoute[] | null) => void;
  selectRoute: {
    index: number;
    route: AccessibleRoute;
  } | null;
  setRouteSelect: (
    route: Partial<{
      index: number;
      route: AccessibleRoute;
    }> | null,
  ) => void;
  routeWaypoints: LatLng[];
  setRouteWaypoints: (waypoints: LatLng[]) => void;
  routeInfoShow: boolean;
  setRouteInfoShow: (show: boolean) => void;
  /** System-level metro operating alerts that came with the current route response (absent when all clear). */
  metroAlerts: MetroAlertResult[] | null;
  setMetroAlerts: (alerts: MetroAlertResult[] | null) => void;
  /** Transit operating alerts across routes/legs from the current route response. */
  transitAlerts: MatchedAlert[] | null;
  setTransitAlerts: (alerts: MatchedAlert[] | null) => void;
  /** True when the active route targets a live SOS requester (hides the static destination pin in favor of the pulsing SOS marker). */
  sosNavActive: boolean;
  setSosNavActive: (active: boolean) => void;
}

export interface SearchSlice {
  searchPlace: PlaceDetail | null;
  setSearchPlace: (place: PlaceDetail | null) => void;
  searchHistory: PlaceDetail[];
  initSearchHistory: (history: PlaceDetail[]) => void;
  addSearchHistory: (searchTerm: PlaceDetail) => void;
  clearSearchHistory: () => void;
  savedPlaces: PlaceDetail[];
  savedPlaceKeys: Set<string>;
  savedPlaceCategories: Record<string, SavedPlaceCategory>;
  initSavedPlaces: (places: PlaceDetail[]) => void;
  initSavedPlaceCategories: (cats: Record<string, SavedPlaceCategory>) => void;
  addSavedPlace: (place: PlaceDetail) => void;
  removeSavedPlace: (place: PlaceDetail) => void;
  clearSavedPlaces: () => void;
  isSavedPlace: (place: PlaceDetail) => boolean;
  setSavedPlaceCategory: (
    place: PlaceDetail,
    category: SavedPlaceCategory | null,
  ) => void;
  pendingSearchQuery: string;
  setPendingSearchQuery: (query: string) => void;
  /** Set by the unified home-screen input when a query reads as a question rather than a place; `AIChatBot` consumes and sends it once the panel opens. */
  pendingAiQuery: string;
  setPendingAiQuery: (query: string) => void;
  chatOpen: boolean;
  setChatOpen: (v: boolean) => void;
  aiResultMarkers: AiResultMarker[];
  setAiResultMarkers: (markers: AiResultMarker[]) => void;
}

/**
 * The one bus segment the user has expanded and is therefore tracking live.
 * `null` means no tracking at all: no vehicle drawn, no polling in flight.
 */
export interface ActiveBusLeg {
  /** `${routeIndex}:${legIndex}:${routeName}:${direction}:${departureStop}` */
  key: string;
  leg: BusLeg;
}

export interface TransitSlice {
  liveBusPositions: LiveBus[];
  setLiveBusPositions: (positions: LiveBus[]) => void;
  activeBusLeg: ActiveBusLeg | null;
  setActiveBusLeg: (active: ActiveBusLeg | null) => void;
  nearbyBusStops: (BusStopSearchResult & { distance?: number })[];
  setNearbyBusStops: (
    stops: (BusStopSearchResult & { distance?: number })[],
  ) => void;
  busRouteStops: RouteDetailStop[];
  setBusRouteStops: (stops: RouteDetailStop[]) => void;
  selectedBusStop:
    | (BusStopSearchResult & { distance?: number })
    | RouteDetailStop
    | null;
  setSelectedBusStop: (
    stop:
      | (BusStopSearchResult & { distance?: number })
      | RouteDetailStop
      | null,
  ) => void;
}

export interface A11ySlice {
  routeA11y: Marker[];
  setRouteA11y: (a11y: Marker[]) => void;
  addRouteA11y: (a11y: Marker[]) => void;
  selectedA11yTypes: Set<A11yEnum>;
  toggleA11yType: (type: A11yEnum) => void;
  setSelectedA11yTypes: (types: Set<A11yEnum>) => void;
  /** §6.1 of the UX audit: "無障礙" used to be simultaneously a rail item, a
   * quick-action chip, a route mode, and a place-detail section — none of
   * which agreed on what state they were reading, so there was no single
   * answer to "is accessibility filtering on right now". This is that
   * answer — a global mode, not a per-category detail (that's still
   * `selectedA11yTypes`) — synced to the `?a11y=1` URL query so it survives
   * a reload and is shareable. Read by the AI system prompt (see
   * `useAIChat.ts`) so far; wiring it into search results and route
   * planning needs backend support this app doesn't have yet (see
   * PROJECTS.md's 給後端的需求清單). */
  a11yFilterEnabled: boolean;
  setA11yFilterEnabled: (enabled: boolean) => void;
  a11yDrawerOpen: boolean;
  setA11yDrawerOpen: (open: boolean) => void;
  selectA11yPlace: Marker | null;
  setSelectA11yPlace: (place: Marker | null) => void;
  a11yPlaces: Marker[] | null;
  setA11yPlaces: (places: Marker[] | null) => void;
  nearbyParking: ParkingNearbyItem[];
  setNearbyParking: (items: ParkingNearbyItem[]) => void;
  selectedParking: ParkingNearbyItem | null;
  setSelectedParking: (item: ParkingNearbyItem | null) => void;
  /** Set when an unconfirmed a11y checklist item's "我知道 → 回報" link opens
   * the hazard report panel; `HazardReportPanel` consumes it once so both the
   * pre-filled description and selected place survive the panel handoff. */
  pendingReportContext: HazardReportContext | null;
  setPendingReportContext: (context: HazardReportContext | null) => void;
}

export interface SheetSlice {
  sheetMode: SheetMode;
  /**
   * The panel slot only ever shows one thing at a time (see
   * visual-design-spec.md §5.2): switching to any mode — regardless of
   * whether an AI tool call or a manual rail click triggered it — always
   * closes the AI assistant too. No `fromAI` exception on either platform.
   */
  setSheetMode: (mode: SheetMode) => void;
  mobileSheetSnap: MobileSheetSnap;
  setMobileSheetSnap: (snap: MobileSheetSnap) => void;
  isNavigating: boolean;
  setIsNavigating: (v: boolean) => void;
  pendingNavExit: { target: RailPanel | "plan" | "home" } | null;
  requestNavExit: (target: RailPanel | "plan" | "home") => void;
  confirmNavExit: () => void;
  cancelNavExit: () => void;
  activeRailPanel: RailPanel;
  setActiveRailPanel: (panel: RailPanel) => void;
}

export const SAVED_PLACE_CATEGORIES = [
  "favorite",
  "food",
  "transport",
  "medical",
  "other",
] as const;
export type SavedPlaceCategory = (typeof SAVED_PLACE_CATEGORIES)[number];

export function placeKey(p: PlaceDetail): string {
  return p.kind === "place"
    ? `p_${p.place.id}`
    : `c_${p.position.lat}_${p.position.lng}`;
}

export type MapStore = MapInstanceSlice &
  RouteSlice &
  SearchSlice &
  TransitSlice &
  A11ySlice &
  SheetSlice;

/** Zustand slice factory bound to the whole `MapStore`, so a slice can read
 * and write fields owned by sibling slices via `get()`/`set()`. */
export type MapSliceCreator<T> = StateCreator<MapStore, [], [], T>;
