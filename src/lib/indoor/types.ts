/** One local tangent-plane projection for the entire building, in metres. */
export type XY = [east: number, north: number];
export type XYZ = [east: number, north: number, height: number];
export type IndoorTags = Record<string, string>;
export type HeightStatus = "measured" | "drawing" | "estimated";
export type GeometryStatus = "surveyed" | "traced" | "schematic";
export type WheelchairAccess = "yes" | "no" | "limited" | "unknown";
export type IndoorMode =
  | "normal"
  | "wheelchair"
  | "elderly"
  | "visual_impaired";
export type IndoorVerticalPreference = "auto" | "stairs" | "elevator";
export interface IndoorRouteOptions {
  verticalPreference?: IndoorVerticalPreference;
}

export interface IndoorLevel {
  ordinal: number;
  ref: string;
  elevationM: number;
}

export interface IndoorFeature {
  id: string;
  buildingId?: string | null;
  kind: "room" | "corridor" | "area" | "door" | "elevator" | "stairs";
  levelRef: string | null;
  ordinal: number | null;
  name?: string;
  ref?: string;
  geometry:
    | { type: "Polygon"; coordinates: XY[][] }
    | { type: "Point"; coordinates: XY };
  tags: IndoorTags;
  geometryStatus: GeometryStatus;
  heightStatus: HeightStatus;
  /** Presentation semantic; `kind` remains the unmodified compiled source kind. */
  displayKind?: "elevator" | "stairs";
  connectionId?: string;
}

export interface IndoorConnection {
  id: string;
  buildingId?: string | null;
  kind: "stairs" | "steps" | "ramp" | "escalator" | "elevator";
  name: string;
  coordinates: XYZ[];
  levelRefs: (string | null)[];
  wheelchair: WheelchairAccess;
  geometryStatus: GeometryStatus;
  heightStatus: HeightStatus;
  heightPending: boolean;
  animationPending?: boolean;
  tags: IndoorTags;
  osmRef: string;
}

export interface IndoorNode {
  id: string;
  buildingId?: string | null;
  osmRef?: string;
  tags?: IndoorTags;
  point: XYZ;
  ordinal: number | null;
  levelRef: string | null;
  kind: string;
}

export type IndoorEdgeKind =
  | "corridor"
  | "footway"
  | "path"
  | "pedestrian"
  | "service"
  | "crossing"
  | "steps"
  | "escalator"
  | "elevator";

export interface IndoorEdge {
  id: string;
  from: string;
  to: string;
  kind: IndoorEdgeKind;
  lengthM: number;
  wheelchair: WheelchairAccess;
  ramp: boolean;
  heightPending: boolean;
  animationPending?: boolean;
  geometryStatus: GeometryStatus;
  heightStatus: HeightStatus;
  widthM?: number;
  slopeRatio?: number;
  levelSpan?: number;
  tags: IndoorTags;
  osmRef: string;
}

export interface IndoorPlace {
  id: string;
  buildingId?: string | null;
  name: string;
  ref?: string;
  kind: string;
  nodeId: string;
  point: XYZ;
  levelRef: string | null;
  routeEndpoint: "door" | "corridor" | "place";
  /** No inferred door or segment to a room centroid is created. */
  doorKnown: boolean;
  arrivalOnly: boolean;
  tags: IndoorTags;
  connectionId?: string;
  /** Multiple spans may share this exact compiled graph landing. */
  connectionIds?: string[];
}

export interface IndoorPhoto {
  id: string;
  label: string;
  levelOrdinal?: number;
  url: string;
}

/** Private development data. This is intentionally not a production API contract. */
export interface LocalIndoorModel {
  schemaVersion: 1;
  venueId: string;
  name: string;
  source: { sha256: string; generatedAt: string; warnings: string[] };
  origin: [longitude: number, latitude: number];
  building: {
    id: string;
    name: string;
    footprint: XY[][];
    levels: IndoorLevel[];
    floorHeightM: number;
    heightStatus: HeightStatus;
    geometryStatus: GeometryStatus;
    /** Camera heading only; never rotate individual feature coordinates. */
    photoOrientation?: number;
  };
  features: IndoorFeature[];
  connections: IndoorConnection[];
  nodes: IndoorNode[];
  edges: IndoorEdge[];
  places: IndoorPlace[];
  walls: {
    id: string;
    buildingId?: string | null;
    ordinal: number;
    points: XY[];
    tags: IndoorTags;
  }[];
  photos?: IndoorPhoto[];
  stairDesign?: IndoorStairDesign;
  /** Individually checked local candidates, one per source stair span. */
  stairDesigns?: IndoorStairDesign[];
  preview?: {
    levels: number[];
    demoConnectionId?: string;
    /** Existing source graph endpoint outdoors; no connecting edge is invented. */
    externalApproachPlaceId?: string;
    gatePlaceIds?: string[];
    requirePhysicalStairs?: boolean;
  };
}

export interface IndoorRouteStep {
  kind: IndoorEdgeKind | "ramp";
  name: string;
  fromLevel: string | null;
  toLevel: string | null;
  distanceM: number;
  startIndex: number;
  endIndex: number;
  heightPending: boolean;
  /** Exact source connection/span identity, never inferred from its name. */
  connectionId?: string;
}

export interface IndoorRoutePresentation {
  position: XYZ;
  currentLevelRef: string | null;
  activeConnectionId: string | null;
  transition: {
    kind: "steps" | "elevator";
    name: string;
    fromLevel: string;
    toLevel: string;
    connectionId: string | null;
  } | null;
}

export interface IndoorRoute {
  ok: true;
  fromPlaceId: string;
  toPlaceId: string;
  points: XYZ[];
  /** One kind per segment, i.e. points.length - 1. */
  kinds: (IndoorEdgeKind | "ramp")[];
  steps: IndoorRouteStep[];
  distanceM: number;
  animationSafe: boolean;
  warnings: string[];
  /** Named local research geometry used only for the displayed stair segment. */
  researchCandidateId?: string;
  researchCandidateIds?: string[];
  /** Original compiled graph traversal; candidate display points do not alter it. */
  edgeIds: string[];
}

export type IndoorRouteResult =
  | IndoorRoute
  | {
      ok: false;
      reason: "UNKNOWN_PLACE" | "NO_ROUTE" | "NO_ACCESSIBLE_ROUTE";
    };

/** Explicit, local research candidate; never replaces surveyed/source polygons. */
export interface IndoorStairDesign {
  schemaVersion: 1;
  id: string;
  name: string;
  status: string;
  sourceSha256: string;
  sourceConnectionId: string;
  sourcePath: XYZ[];
  sourceCore: XY[][];
  sourceElevatorPoint?: XYZ;
  dimensions: {
    floorHeightM: number;
    flightTotalWidthM: number;
    flightClearWidthM: number;
    risers: number[];
    riserHeightM: number;
    platformM: number[];
    carInsideM?: { depth: number; width: number };
    shaftInsideM?: { depth: number; width: number };
    shaftOutsideM?: { depth: number; width: number };
    shaftWallAssumptionM?: number;
    carDoorClearM?: number;
  };
  shaft?: {
    polygon: XY[][];
    innerPolygon: XY[][];
    carPolygon: XY[][];
    thresholdPolygons?: XY[][][];
    wallPolygons?: XY[][][];
    doorHeaderPolygons?: XY[][][];
    doorHeightM?: number;
    baseM: number;
    heightM: number;
    door: { segment: XY[]; widthM: number; facing: string; status: string };
  };
  flights: {
    id: string;
    name: string;
    start: XYZ;
    end: XYZ;
    polygon: XY[][];
    risers: number;
    treadDepthM: number;
    riserHeightM: number;
    widthM: number;
  }[];
  platforms: {
    id: string;
    name: string;
    polygon: XY[][];
    elevationM: number;
    thicknessM: number;
  }[];
  approaches?: {
    id: string;
    polygon: XY[][];
    elevationM: number;
    thicknessM: number;
  }[];
  steps: {
    id: string;
    flightId: string;
    index: number;
    polygon: XY[][];
    elevationM: number;
    thicknessM: number;
    riserHeightM: number;
  }[];
  animationPath: XYZ[];
  animationSegments: { kind: string; surfaceId: string }[];
  conflicts: unknown[];
  verification: {
    roomToiletOverlapCount: number;
    shaftOverlapAreaM2: number;
    outsideCoreAreaM2: number;
    sourceEndpointsPreserved: boolean;
    riserSumM: number;
    platformCount: number;
    checkLimits: string;
  };
  assumptions: string[];
  sources: { title: string; url: string; usedFor: string }[];
}
