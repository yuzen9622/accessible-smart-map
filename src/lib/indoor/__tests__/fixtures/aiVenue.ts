import type { AiVenueHandover } from "@/types/route";
import type { XYZ } from "../../types";
import type { VenueDetail, VenueRouteResponse } from "../../venueApi";

const annotation = {
  geometryStatus: "schematic" as const,
  heightStatus: "estimated" as const,
};

/** Synthetic venue: an outdoor gate, a lift in "east" hall and a 3F room. */
export function aiVenueDetail(version = 4): VenueDetail {
  return {
    venueId: "synthetic-campus",
    name: "Synthetic campus",
    version,
    importedAt: "2026-10-01T00:00:00Z",
    sourceSha256: "synthetic-sha",
    center: [10, 10],
    buildings: [
      {
        ...annotation,
        id: "east",
        name: "East hall",
        aliases: [],
        groundOffsetM: 0,
        floorHeightM: 4,
        footprint: [
          [
            [10, 10],
            [10.0002, 10],
            [10.0002, 10.0001],
            [10, 10.0001],
            [10, 10],
          ],
        ],
        levels: [0, 2].map((ordinal) => ({
          ordinal,
          ref: `${ordinal + 1}F`,
          elevationM: ordinal * 4,
          coverage: {
            hasAnchor: true,
            hasRouteData: true,
            hasDisplayGeometry: true,
          },
        })),
      },
    ],
    places: [
      {
        id: "gate",
        name: "North gate",
        kind: "gate",
        nodeId: "n-gate",
        buildingId: null,
        levelRef: null,
        location: [9.9999, 10],
      },
      {
        id: "room-2301",
        name: "2301",
        kind: "room",
        nodeId: "n-room",
        buildingId: "east",
        levelRef: "3F",
        location: [10.0001, 10],
      },
    ],
    features: [],
    walkways: [
      {
        ...annotation,
        id: "gate-path",
        kind: "footway",
        indoor: false,
        coordinates: [
          [9.9999, 10, 0],
          [10, 10, 0],
        ],
        buildingId: null,
        levelRef: null,
        buildingIds: [null, "east"],
        levelRefs: [null, "1F"],
        wheelchair: "yes",
        osmRef: "way/gate-path",
      },
      {
        ...annotation,
        id: "corridor-3f",
        kind: "corridor",
        indoor: true,
        coordinates: [
          [10, 10, 8],
          [10.0001, 10, 8],
        ],
        buildingId: "east",
        levelRef: "3F",
        buildingIds: ["east", "east"],
        levelRefs: ["3F", "3F"],
        wheelchair: "yes",
        osmRef: "way/corridor-3f",
      },
    ],
    connections: [
      {
        ...annotation,
        id: "lift",
        kind: "elevator",
        buildingId: "east",
        coordinates: [
          [10, 10, 0],
          [10, 10, 8],
        ],
        levelRefs: ["1F", "3F"],
        wheelchair: "yes",
        osmRef: "node/lift",
        name: "Lift A",
      },
    ],
  };
}

const gatePoint: XYZ = [9.9999, 10, 0];
const doorPoint: XYZ = [10, 10, 0];
const liftTop: XYZ = [10, 10, 8];
const roomPoint: XYZ = [10.0001, 10, 8];

/** Backend `VenueRoute` from the gate to room 2301 (an AI `venueLeg`). */
export function arrivalLeg(version = 4): VenueRouteResponse {
  return {
    venueId: "synthetic-campus",
    venueVersion: version,
    mode: "wheelchair",
    fromPlaceId: "gate",
    toPlaceId: "room-2301",
    distanceM: 21,
    durationS: 60,
    elevatorRides: 1,
    stairFlights: 0,
    path: {
      coordinates: [gatePoint, doorPoint, liftTop, roomPoint],
      buildingIds: [null, "east", "east", "east"],
      levelRefs: [null, "1F", "3F", "3F"],
    },
    segments: [
      { buildingId: null, levelRef: null, pathStart: 0, pathEnd: 1 },
      { buildingId: "east", levelRef: "1F", pathStart: 1, pathEnd: 2 },
      { buildingId: "east", levelRef: "3F", pathStart: 2, pathEnd: 3 },
    ],
    steps: [
      step("depart", "從北門出發", null, null, 0, 0),
      step("enter", "進入東館", "east", "1F", 0, 1, 10),
      {
        ...step("elevator", "搭乘電梯 A 到 3F", "east", "1F", 1, 2),
        fromLevelRef: "1F",
        toLevelRef: "3F",
        connectionId: "lift",
      },
      step("walk", "沿走廊直行", "east", "3F", 2, 3, 11),
      step("arrive", "抵達 2301", "east", "3F", 3, 3),
    ],
  };
}

/** The same trip reversed: room 2301 to the gate (an AI `venueDepartureLeg`). */
export function departureLeg(version = 4): VenueRouteResponse {
  return {
    ...arrivalLeg(version),
    fromPlaceId: "room-2301",
    toPlaceId: "gate",
    path: {
      coordinates: [roomPoint, liftTop, doorPoint, gatePoint],
      buildingIds: ["east", "east", "east", null],
      levelRefs: ["3F", "3F", "1F", null],
    },
    segments: [
      { buildingId: "east", levelRef: "3F", pathStart: 0, pathEnd: 1 },
      { buildingId: "east", levelRef: "3F", pathStart: 1, pathEnd: 2 },
      { buildingId: "east", levelRef: "1F", pathStart: 2, pathEnd: 3 },
    ],
    steps: [
      step("depart", "從 2301 出發", "east", "3F", 0, 0),
      step("walk", "沿走廊走到電梯", "east", "3F", 0, 1, 11),
      {
        ...step("elevator", "搭乘電梯 A 到 1F", "east", "3F", 1, 2),
        fromLevelRef: "3F",
        toLevelRef: "1F",
        connectionId: "lift",
      },
      step("exit", "走出東館", "east", "1F", 2, 3, 10),
      step("arrive", "抵達北門", null, null, 3, 3),
    ],
  };
}

export function handover(
  leg: VenueRouteResponse,
  placeId: string,
): AiVenueHandover {
  return {
    venueId: leg.venueId,
    placeId,
    gateId: "gate",
    gateLocation: { lat: 10, lng: 9.9999 },
    mode: leg.mode,
    venueVersion: leg.venueVersion,
  };
}

function step(
  type: VenueRouteResponse["steps"][number]["type"],
  instruction: string,
  buildingId: string | null,
  levelRef: string | null,
  pathStart: number,
  pathEnd: number,
  distanceM = 0,
): VenueRouteResponse["steps"][number] {
  return {
    type,
    instruction,
    buildingId,
    levelRef,
    pathStart,
    pathEnd,
    distanceM,
    durationS: distanceM,
  };
}
