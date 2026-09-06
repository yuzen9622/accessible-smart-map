import type {
  MatchedAlert,
  MatchKind,
  MetroAlert,
  TransitAlert,
} from "./transit-alert";

export type { MatchedAlert, MatchKind, MetroAlert, TransitAlert };

// Types aligned with backend OpenAPI spec (POST /a11y/accessible-route)

// --- GeoJSON ---
export interface GeoPoint {
  type: "Point";
  coordinates: [number, number]; // [lng, lat]
}

// --- Unified accessibility facility (GET /a11y/all-facilities, /all-bathrooms) ---
export type A11yFacilityCategory =
  | "elevator"
  | "ramp"
  | "toilet"
  | "parking"
  | "other";

interface A11yFacilityBase {
  _id: string;
  name: string;
  location: GeoPoint;
  category: A11yFacilityCategory;
}

export type A11yFacility =
  | (A11yFacilityBase & {
      source: "metro";
      exitName: string | null;
    })
  | (A11yFacilityBase & {
      source: "osm";
      osmId: string;
      wheelchair: "yes" | "limited" | "no" | null;
    })
  | (A11yFacilityBase & {
      source: "campus";
      schoolName: string;
    })
  | (A11yFacilityBase & {
      source: "bathroom";
    })
  | (A11yFacilityBase & {
      source: "parking";
    });

// --- Slim OSM A11y facility ---
export interface SlimOsmA11y {
  osmId: string;
  name?: string;
  category:
    | "wheelchair_accessible"
    | "kerb_cut"
    | "ramp"
    | "elevator"
    | "toilet";
  wheelchair?: "yes" | "limited" | "no";
  tags?: Record<string, string>;
  location: GeoPoint;
}

// --- Transit operating alerts (from /transit/alerts; optional on route responses) ---
/** Top-level `metroAlerts` on the route response, grouped by ridden rail system. */
export interface MetroAlertResult {
  railSystem: string;
  updatedAt: string;
  alerts: MetroAlert[];
}

// --- Wait info for transit legs ---
export interface WaitInfo {
  time: number | string | null;
  source: "realtime" | "schedule" | "unavailable";
}

// --- Nearest bus info ---
export interface NearestBus {
  plateNumb: string;
  position: [number, number]; // [lng, lat]
  speed?: number;
  stopsAway?: number;
}

// --- Exit info for walk legs ---
export interface ExitInfo {
  exitName: string;
  exitNumber: string;
  type: "elevator" | "ramp";
  coords: [number, number]; // [lng, lat]
}

export interface IntermediateStop {
  name: string;
  stationUid?: string;
  location?: [number, number]; // [lng, lat]
}

// --- Leg types (discriminated union by `type`) ---

export type A11yFeature =
  | "elevator"
  | "escalator"
  | "moving_walkway"
  | "ramp"
  | "curb_ramp_crossing"
  | "crossing"
  | "stairs"
  | "fare_gate"
  | "exit_gate";

/**
 * Index range into the leg's `polyline`, inclusive on both ends. Ranges are
 * sorted and never overlap. `startIndex === endIndex` is a point facility
 * (an elevator's two ends share one ground coordinate), not a zero-length line.
 */
export interface A11ySegment {
  feature: A11yFeature;
  startIndex: number;
  endIndex: number;
  indoor: boolean;
  distanceM: number | null;
  maxSlopePercent: number | null;
  minWidthCm: number | null;
}

export interface WalkLeg {
  type: "WALK";
  from: string;
  to: string;
  distanceM: number;
  minutesEst: number;
  polyline: [number, number][]; // [lng, lat][]
  a11yFacilities: SlimOsmA11y[];
  a11yRefs?: string[];
  exitInfo?: ExitInfo | null;
  steps?: WalkStep[];
  maxSlopePercent?: number | null;
  crossings?: number | null;
  crossingsWithCurbRamp?: number | null;
  minPathWidthCm?: number | null;
  surfaceType?: string;
  /** Curb ramps registered on the government sidewalk segments this leg runs
   * along — a count for the whole leg, not positions on the path. */
  sidewalkRampCount?: number;
  /** Only present on `engine: "pedestrian-a11y"` routes. An empty array means
   * "checked, nothing classifiable"; an absent field means "never checked". */
  a11ySegments?: A11ySegment[];
}

export interface BusLeg {
  type: "BUS";
  routeName: string;
  /**
   * The exact run the planner chose. TDX publishes a line as several
   * sub-routes (99 / 99延, 6268 / 6268F …) that share a name but not a stop
   * list, so this — not `routeName` — identifies the ride when asking for
   * arrivals, positions or stop sequences.
   */
  subRouteUid?: string;
  /** Display name of {@link subRouteUid}, and the name TDX queries expect. */
  subRouteName?: string;
  departureStop: string;
  arrivalStop: string;
  departureStopId?: string;
  arrivalStopId?: string;
  tdxCity?: string;
  cityCode?: string;
  departureTime?: string;
  arrivalTime?: string;
  waitInfo: WaitInfo;
  estimatedWaitMinutes: number;
  direction: 0 | 1;
  polyline: [number, number][];
  departureStopA11y: SlimOsmA11y[];
  arrivalStopA11y: SlimOsmA11y[];
  nearestBus?: NearestBus;
  a11yRefs?: string[];
  intermediateStops?: IntermediateStop[];
  /** Present only when this bus route/stop has active operating alerts. */
  alerts?: MatchedAlert[];
}

export interface MetroLeg {
  type: "METRO";
  railSystem: string;
  lineId: string;
  lineName: string;
  lineUid: string;
  departureStation: string;
  arrivalStation: string;
  departureStationUid: string;
  arrivalStationUid: string;
  direction: 0 | 1;
  stopsCount: number;
  rideMinutes: number;
  departureTime?: string;
  arrivalTime?: string;
  waitInfo: WaitInfo;
  estimatedWaitMinutes: number;
  polyline: [number, number][];
  departureStationA11y: SlimOsmA11y[];
  arrivalStationA11y: SlimOsmA11y[];
  facilityHighlights: string[];
  a11yRefs?: string[];
  intermediateStops?: IntermediateStop[];
  /** Present only when this leg's stations/lines have active operating alerts. */
  alerts?: MetroAlert[];
}

export interface ThsrLeg {
  type: "THSR";
  trainNo: string;
  departureStation: string;
  arrivalStation: string;
  departureStationUID: string;
  arrivalStationUID: string;
  departureTime: string;
  arrivalTime: string;
  rideMinutes: number;
  waitInfo: WaitInfo;
  estimatedWaitMinutes: number;
  polyline: [number, number][];
  departureStationA11y: SlimOsmA11y[];
  arrivalStationA11y: SlimOsmA11y[];
  facilityHighlights: string[];
  a11yRefs?: string[];
  intermediateStops?: IntermediateStop[];
  /** Present only when this THSR train/station has active operating alerts. */
  alerts?: MatchedAlert[];
}

export interface TraLeg {
  type: "TRA";
  trainNo: string;
  trainTypeName: string;
  departureStation: string;
  arrivalStation: string;
  departureStationUID: string;
  arrivalStationUID: string;
  departureTime: string;
  arrivalTime: string;
  rideMinutes: number;
  waitInfo: WaitInfo;
  estimatedWaitMinutes: number;
  polyline: [number, number][];
  departureStationA11y: SlimOsmA11y[];
  arrivalStationA11y: SlimOsmA11y[];
  facilityHighlights: string[];
  a11yRefs?: string[];
  intermediateStops?: IntermediateStop[];
  /** Present only when this TRA train/station has active operating alerts. */
  alerts?: MatchedAlert[];
}

export type TrafficLevel =
  | "light"
  | "moderate"
  | "heavy"
  | "severe"
  | "closed"
  | "unknown";

export interface DriveTrafficSegment {
  fromIndex: number;
  toIndex: number;
  trafficLevel: TrafficLevel;
  congestionLevel: number;
}

export interface DriveIncident {
  incidentId: string;
  title: string;
  description?: string;
  severity: "closure" | "advisory";
  location: { lat: number; lng: number };
}

export interface DriveLeg {
  type: "DRIVE" | "MOTORCYCLE";
  label?: string;
  from: string;
  to: string;
  distanceM: number;
  durationMinutes?: number;
  durationMin: number;
  durationInTrafficMin?: number;
  trafficLevel?: TrafficLevel;
  trafficSegments?: DriveTrafficSegment[];
  incidents?: DriveIncident[];
  summary?: string;
  modeFallback?: "DRIVE";
  departureTime?: string | null;
  arrivalTime?: string | null;
  polyline: [number, number][];
  steps?: DriveStep[];
}

export type RouteLeg =
  | WalkLeg
  | BusLeg
  | MetroLeg
  | ThsrLeg
  | TraLeg
  | DriveLeg;

// --- Score components ---
export interface ScoreComponents {
  facilityScore: number;
  timeScore: number;
  criticalFeatureScore: number;
}

// --- Accessibility labels ---
export type A11yLabel = "excellent" | "good" | "fair" | "poor" | "critical";

// --- Single route ---
export interface AccessibleRoute {
  routeId: string;
  /** Stable navigation identity returned for reroute-capable routes. */
  navigationId?: string;
  /** Monotonic navigation route version. Initial reroute-capable routes use 1. */
  routeVersion?: number;
  /** Which engine picked this walking route. Absent on transit/drive routes.
   * This is the only stable branch key — `warnings` are prose and may be
   * reworded at any time. */
  engine?: "pedestrian-a11y" | "otp-fallback";
  /** Absent when not degraded, so test for `=== true`. */
  degraded?: boolean;
  warnings?: string[];
  /** Short-lived bearer capability used to arm voice navigation (30 min TTL). */
  routeToken?: string;
  routeName: string;
  totalMinutes: number;
  transferCount: number;
  legs: RouteLeg[];
  accessibilityHighlights: string[];
  accessibilityScore?: number;
  accessibilityLabel?: A11yLabel;
  scoreComponents?: ScoreComponents;
  dataConfidence?: "high" | "medium" | "low";
  scoreWarnings?: string[];
  totalWalkDistanceM?: number;
  facilities?: Record<string, SlimOsmA11y>;
  attribution?: string;
  /** Top-level summary of transit alerts affecting this route. */
  transitAlerts?: MatchedAlert[];
}

// --- Route intent (from /ai/intent) ---
export interface RouteIntent {
  from: string;
  to: string;
  mode: "wheelchair" | "elderly" | "visual_impaired" | "normal";
  departureTime: string;
  preferences: {
    minimizeTransfers: boolean;
    preferElevator: boolean;
  };
}

// --- Response envelope ---
export interface AccessibleRouteData {
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  waypoints?: { lat: number; lng: number }[];
  city: string;
  travelMode?: "transit" | "drive" | "motorcycle" | "walk";
  routes: AccessibleRoute[];
  intent?: RouteIntent;
  /** System-level operating alerts for the ridden metro systems (optional, absent when all clear). */
  metroAlerts?: MetroAlertResult[];
  /** Top-level summary of transit operating alerts across all legs/routes (optional). */
  transitAlerts?: MatchedAlert[];
}

// --- Request body ---
export interface AccessibleRouteRequest {
  origin?: string | { latitude: number; longitude: number };
  destination?: string | { latitude: number; longitude: number };
  waypoints?: (string | { latitude: number; longitude: number })[];
  query?: string;
  userLocation?: { latitude: number; longitude: number };
  mode?: "wheelchair" | "elderly" | "visual_impaired" | "normal";
  travelMode?: "transit" | "drive" | "motorcycle" | "walk";
  maxTransfers?: number;
  departureTime?: string;
  format?: "standard" | "compact";
}

// --- Intent request/response ---
export interface IntentRequest {
  query: string;
}

export interface IntentResponse {
  ok: boolean;
  status: string;
  code: number;
  message: string;
  data?: RouteIntent;
}

// --- Route explanation (from /ai/explain) ---
export interface RouteExplanation {
  summary: string;
  accessibilityHighlights: string[];
  warnings: string[];
  alternatives: string | null;
}

// --- Air quality (from /air/air-quality) ---
export type AirQualityLevel =
  | "GOOD"
  | "MODERATE"
  | "UNHEALTHY_SENSITIVE"
  | "UNHEALTHY"
  | "VERY_UNHEALTHY"
  | "HAZARDOUS"
  | "";

export interface AirQualityData {
  description: string;
  quality: AirQualityLevel;
}

// --- AI Chat (from /ai/chat) ---
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface AgentChatRequest {
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  userLocation?: { latitude: number; longitude: number };
}

// --- Navigation Instructions (from /a11y/route/instructions) ---
export type NavInstructionType =
  | "turn"
  | "transit_board"
  | "transit_alight"
  | "facility"
  | "depart"
  | "arrive";
export type RelativeDirection =
  | "正前方"
  | "左前方"
  | "右前方"
  | "左側"
  | "右側"
  | "左後方"
  | "右後方"
  | "正後方"
  | null;

export interface NavInstruction {
  text: string;
  type: NavInstructionType;
  bearing: number | null;
  relativeDirection: RelativeDirection;
  distanceM: number | null;
  streetName: string | null;
  legType: "WALK" | "BUS" | "METRO" | "THSR" | "TRA" | "DRIVE" | "MOTORCYCLE";
  /** Source index in route.legs; absent for legacy and voice instructions. */
  legIndex?: number;
  /** Index in this instruction's own leg.polyline, not the concatenated route path. */
  polylineIndex: number | null;
}

export type NavWarning =
  | "WALK_STEPS_UNAVAILABLE"
  | "ORS_STEPS_UNAVAILABLE"
  | "ROAD_STEPS_UNAVAILABLE";

export interface DriveStep {
  instruction: string;
  maneuver?: string;
  distanceM: number;
  durationMin: number;
  polyline: [number, number][]; // [lng, lat][] (GeoJSON order)
}

export type WalkRelativeDirection =
  | "DEPART"
  | "CONTINUE"
  | "STRAIGHT"
  | "LEFT"
  | "RIGHT"
  | "SLIGHTLY_LEFT"
  | "SLIGHTLY_RIGHT"
  | "HARD_LEFT"
  | "HARD_RIGHT"
  | "UTURN_LEFT"
  | "UTURN_RIGHT"
  | "CIRCLE_CLOCKWISE"
  | "CIRCLE_COUNTERCLOCKWISE"
  | "ELEVATOR"
  | "ESCALATOR"
  | "MOVING_WALKWAY"
  | "FARE_GATE"
  | "ENTER_STATION"
  | "EXIT_STATION";

export type WalkAbsoluteDirection =
  | "NORTH"
  | "NORTHEAST"
  | "EAST"
  | "SOUTHEAST"
  | "SOUTH"
  | "SOUTHWEST"
  | "WEST"
  | "NORTHWEST";

export interface WalkStep {
  relativeDirection: WalkRelativeDirection;
  absoluteDirection: WalkAbsoluteDirection | null;
  streetName: string;
  bogusName: boolean;
  area: boolean;
  stairs: boolean;
  steepSlope: boolean;
  distanceM: number;
  location: [number, number]; // [lng, lat] (GeoJSON order)
}

export interface NavInstructionsData {
  instructions: NavInstruction[];
  initialBearing: number;
  totalSteps: number;
  warnings: NavWarning[];
}

export interface NavInstructionsRequest {
  routeToken: string;
  userHeading?: number;
  language?: string;
}

export type RerouteReason =
  | "OFF_ROUTE"
  | "FACILITY_OUTAGE"
  | "CONFIRMED_HAZARD"
  | "TRANSIT_DISRUPTION"
  | "MANUAL";

export interface AccessibleRouteRerouteRequest {
  routeToken: string;
  currentPosition: {
    latitude: number;
    longitude: number;
    accuracy?: number;
  };
  previousRouteVersion: number;
  reason: RerouteReason;
  clientRequestId: string;
}

/** Reroute responses may name the complete replacement list `instructions`
 * or `steps`; callers normalize either form before applying it. */
export type AccessibleRouteRerouteData = {
  navigationId: string;
  previousRouteVersion: number;
  routeVersion: number;
  routeToken: string;
  route: AccessibleRoute;
  warnings: string[];
  currentStepIndex: 0;
  replayed: boolean;
} & (
  | { instructions: NavInstruction[]; steps?: never }
  | { steps: NavInstruction[]; instructions?: never }
);

// --- Hazard Report (from /a11y/reports) ---
export interface HazardGeoPoint {
  type: "Point";
  coordinates: [number, number];
}

export type HazardSeverity = "blocking" | "difficult" | "minor";

export interface HazardReport {
  _id: string;
  reporterId?: string;
  hazardType: "obstacle" | "construction" | "data_error";
  severity?: HazardSeverity;
  expectedUntil?: string | null;
  reportedLocation: HazardGeoPoint;
  description?: string;
  photoUrl?: string;
  status: "pending" | "verified" | "rejected" | "expired";
  exifValidation?: {
    timestampFresh?: boolean;
    gpsPresent?: boolean;
    gpsMatchesClaimed?: boolean;
    gpsMatch?: boolean;
    timeRecent?: boolean;
    distanceM?: number;
    minutesAgo?: number;
  };
  aiVerification?: {
    verdict: "verified" | "suspicious" | "rejected" | "skipped";
    confidence: number;
    reason: string;
  };
  aiAnalysis?: {
    confidence: number;
    labels: string[];
    summary: string;
  };
  confirmCount?: number;
  denyCount?: number;
  createdAt?: string;
  expiredAt?: string;
  updatedAt?: string;
}

// --- Welfare Institution (from /a11y/welfare) ---
export interface WelfareInstitution {
  _id: string;
  name: string;
  county: string;
  district: string;
  address: string;
  phone: string;
  type: string;
  approvedCapacity: { residential: number; night: number; day: number };
  actualServed: { residential: number; night: number; day: number };
  evaluationTerm: string;
  evaluationGrade: string;
  geocoded: boolean;
  location?: { type: "Point"; coordinates: [number, number] };
  importedAt: string;
}

// --- Environment Info (from /a11y/environment) ---
export interface EnvironmentData {
  location: { lat: number; lng: number };
  weather: {
    status: "ok" | "unavailable";
    temperature?: number;
    precipitationProbability?: number;
    windSpeed?: number;
    windDirection?: string;
    condition?: string;
    forecastTime?: string;
    reason?: string;
  };
  airQuality: {
    status: "ok" | "unavailable";
    description?: string;
    quality?: AirQualityLevel;
    reason?: string;
  };
  cameras?: {
    status: "ok" | "unavailable";
    items?: { name: string; url: string; distance: number }[];
    reason?: string;
  };
}

// --- Disabled Parking (from /a11y/parking/nearby) ---
export interface DisabledParking {
  _id: string;
  city: string;
  district: string;
  areacode?: string;
  quantity: number;
  placeName: string;
  chargeType?: string;
  spaceLabel?: string;
  isMarked: boolean;
  location: GeoPoint;
  importedAt: string;
}

// --- Nearby parking union (GET /a11y/parking/nearby) ---
// The endpoint returns a mix of two shapes, discriminated by `type`:
//  - "disabled"/"standard": on-street parking spaces (DisabledParking shape)
//  - "lot": parking lots imported from TDX (name/address/location, …)
// Both shapes carry coordinates only in GeoJSON `location`.

/** On-street parking space (身障/一般路邊停車格). */
export interface ParkingSpaceNearby extends DisabledParking {
  type: "disabled" | "standard";
  /** 一般停車格所屬路段代碼（僅 standard）。 */
  segmentId?: string;
  /** 一般停車格車格類型代碼（僅 standard）。 */
  spaceType?: number;
  /** 一般停車格是否附充電座（僅 standard）。 */
  hasChargingPoint?: boolean;
}

/** Parking lot imported from TDX (停車場，如城市車旅/捷運轉乘站). */
export interface ParkingLotNearby {
  type: "lot";
  _id: string;
  carParkId: string;
  name: string;
  address?: string;
  city: string;
  district?: string;
  /** 1 平面 / 2 立體 / 3 地下 / 4 停車塔 / 5 機械式。 */
  carParkType?: number;
  /** 收費方式：1 計時 / 2 計次 / 3 月租 / 4 免費（255 未知）。 */
  chargeTypes?: number[];
  wheelchairAccessible?: boolean;
  disabledSpaces?: number;
  totalCarSpaces?: number;
  location: GeoPoint;
  importedAt: string;
}

export type ParkingNearbyItem = ParkingSpaceNearby | ParkingLotNearby;

// --- OSM Place Detail (from /a11y/place) ---
export interface OsmPlaceDetail {
  osmId: string;
  name?: string;
  category?: string;
  wheelchair?: "yes" | "limited" | "no";
  wheelchairDescription?: string;
  tags?: Record<string, string>;
  location?: GeoPoint;
  facilities?: SlimOsmA11y[];
}

// --- Bus Arrival (from /transit/bus/arrival) ---
export interface BilingualName {
  Zh_tw: string;
  En: string;
}

export interface EstimatedTimeOfArrival {
  StopUID: string;
  StopName: BilingualName;
  Direction: 0 | 1;
  EstimateTime: number | null;
  StopStatus: number;
  MessageType?: number;
  PlateNumb?: string;
  RouteName?: BilingualName;
  SubRouteName?: BilingualName;
}

// --- Bus Realtime Positions (from /transit/bus/positions) ---
export interface BusPosition {
  PositionLon: number;
  PositionLat: number;
}

export interface RealTimeByFrequency {
  PlateNumb: string;
  OperatorNo?: string;
  Direction: 0 | 1;
  BusPosition: BusPosition;
  Speed?: number;
  GPSTime?: string;
  UpdateTime?: string;
  RouteName?: BilingualName;
}

// --- Helper functions ---

export function getA11yLabelColor(label: A11yLabel): string {
  switch (label) {
    case "excellent":
      return "#22c55e";
    case "good":
      return "#84cc16";
    case "fair":
      return "#eab308";
    case "poor":
      return "#f97316";
    case "critical":
      return "#ef4444";
  }
}

export function getA11yLabelText(label: A11yLabel, lang: string): string {
  if (lang === "zh-TW") {
    switch (label) {
      case "excellent":
        return "極佳";
      case "good":
        return "良好";
      case "fair":
        return "普通";
      case "poor":
        return "較差";
      case "critical":
        return "困難";
    }
  }
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function scoreToLabel(score: number): A11yLabel {
  if (score >= 80) return "excellent";
  if (score >= 60) return "good";
  if (score >= 40) return "fair";
  if (score >= 20) return "poor";
  return "critical";
}

export function scoreToStars(score: number): number {
  if (score >= 85) return 5;
  if (score >= 70) return 4;
  if (score >= 50) return 3;
  if (score >= 30) return 2;
  return 1;
}

// The backend classifies only, it makes no judgement about good or bad.
// Shared so the map overlay and the route card's legend cannot drift apart —
// the legend is the only thing telling the user what a coloured line means.
export const A11Y_FEATURE_COLOR: Record<A11yFeature, string> = {
  stairs: "#dc2626",
  crossing: "#f59e0b",
  curb_ramp_crossing: "#16a34a",
  ramp: "#16a34a",
  elevator: "#2563eb",
  escalator: "#2563eb",
  moving_walkway: "#2563eb",
  fare_gate: "#7c3aed",
  exit_gate: "#7c3aed",
};

export const TRAFFIC_LEVEL_COLORS: Record<TrafficLevel, string> = {
  light: "#22C55E",
  moderate: "#F59E0B",
  heavy: "#EF4444",
  severe: "#991B1B",
  closed: "#4B5563",
  unknown: "#3B82F6",
};

export const TRAFFIC_BASE_COLOR = "#475569";

// "unknown" carries no traffic information, so a segment claiming it must not
// paint over the base line and imply the road was measured.
const VALID_TRAFFIC_LEVELS = new Set<TrafficLevel>([
  "light",
  "moderate",
  "heavy",
  "severe",
  "closed",
]);

export function visibleTrafficSegments(
  segments: DriveTrafficSegment[] | undefined,
  polylineLength: number,
): DriveTrafficSegment[] {
  if (!Array.isArray(segments) || !segments.length) return [];
  return segments
    .filter(
      (s): s is DriveTrafficSegment =>
        Boolean(s) &&
        VALID_TRAFFIC_LEVELS.has(s.trafficLevel) &&
        Number.isInteger(s.fromIndex) &&
        Number.isInteger(s.toIndex) &&
        s.fromIndex >= 0 &&
        s.toIndex < polylineLength &&
        s.fromIndex < s.toIndex,
    )
    .sort((a, b) => a.fromIndex - b.fromIndex);
}

const LEG_COLORS: Record<string, string> = {
  WALK: "#3b82f6",
  BUS: "#22c55e",
  METRO: "#FF6B35",
  THSR: "#f97316",
  TRA: "#003366",
  DRIVE: "#475569",
  MOTORCYCLE: "#dc2626",
};

export function getLegColor(leg: RouteLeg): string {
  if (leg.type === "BUS") return LEG_COLORS.BUS;
  if (leg.type === "METRO") return LEG_COLORS.METRO;
  return LEG_COLORS[leg.type] || LEG_COLORS.BUS;
}

export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes)) return "";
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (hours > 0) return `${hours}h ${mins}min`;
  return `${mins} min`;
}

// Slope comes from a DEM and carries physically impossible outliers — the
// graph holds edges over 6000%, and the API will happily return 1033.8. Past
// these bounds the number is noise, not a gentler or steeper path.
const SLOPE_PLAUSIBLE_MAX_STAIRS = 100;
const SLOPE_PLAUSIBLE_MAX_PATH = 35;

export function plausibleSlopePercent(
  value: number | null | undefined,
  hasStairs: boolean,
): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const limit = hasStairs
    ? SLOPE_PLAUSIBLE_MAX_STAIRS
    : SLOPE_PLAUSIBLE_MAX_PATH;
  return value > limit ? null : value;
}

export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return "";
  // >=100km: whole km, a decimal place is false precision at that range.
  if (meters >= 100_000) return `${Math.round(meters / 1000)} km`;
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  // Below 10m the round-to-10 rule renders a real 4m step as "0 m", which
  // reads as no movement at all — the CSR engine emits plenty of these.
  if (meters < 10) return `${Math.round(meters)} m`;
  // Round to the nearest 10m — "583 m" implies GPS accuracy this app
  // doesn't have; "580 m" reads as the estimate it actually is.
  return `${Math.round(meters / 10) * 10} m`;
}

export interface LiveBus {
  plateNumb: string;
  direction: number;
  directionLabel?: string;
  lat: number;
  lng: number;
  speed: number;
  statusLabel?: string;
  gpsTime: string;
  isLowFloor: string;
  hasLiftOrRamp: string;
  vehicleClass: string;
  routeName?: string;
  city?: string;
  waitInfo?: WaitInfo;
  stopsAway?: number;
  isTarget?: boolean;
  /** Which sub-route this vehicle is running — a line mixes several. */
  subRouteUid?: string;
  subRouteName?: string;
  /**
   * Minutes until this exact vehicle reaches {@link etaStopName}. Only ever set
   * when the ETA and the plate come from the same arrival record — a number
   * borrowed from another vehicle is worse than no number.
   */
  estimateTime?: number | null;
  /** The stop {@link estimateTime} counts down to (the leg's boarding stop). */
  etaStopName?: string;
}

export interface LiveBusPositionsData {
  routeName: string;
  city: string;
  count: number;
  lowFloorCount: number;
  buses: LiveBus[];
}

export interface LiveBusPositionsResponse {
  ok: boolean;
  status: string;
  code: number;
  message: string;
  data: LiveBusPositionsData;
}
