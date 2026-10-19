import type { VenuePlaceDetail } from "@/types";
import type { VenueJourney } from "../../journey";
import type { IndoorRouteStep, LocalIndoorModel } from "../../types";

const place = (
  placeId: string,
  buildingId: string,
  buildingName: string,
  levelRef: string,
): VenuePlaceDetail => ({
  kind: "venue-place",
  venueId: "campus",
  buildingId,
  buildingName,
  levelRef,
  placeId,
  sourceVersion: "v1",
  dataSource: "api",
  arrivalKind: "place",
  name: placeId,
  address: placeId,
  position: { lat: 0, lng: 0 },
});

let cursor = 0;
function step(
  partial: Partial<IndoorRouteStep> &
    Pick<IndoorRouteStep, "kind" | "fromLevel" | "toLevel" | "distanceM">,
): IndoorRouteStep {
  const startIndex = cursor;
  cursor += 1;
  return {
    name: partial.kind,
    startIndex,
    endIndex: cursor,
    heightPending: false,
    ...partial,
  };
}

export function crossCampusJourney(): VenueJourney {
  cursor = 0;
  const steps = [
    step({
      kind: "corridor",
      action: "depart",
      fromLevel: "3F",
      toLevel: "3F",
      distanceM: 0,
      buildingId: "east",
    }),
    step({
      kind: "corridor",
      fromLevel: "3F",
      toLevel: "3F",
      distanceM: 16,
      buildingId: "east",
    }),
    step({
      kind: "corridor",
      maneuver: "left",
      fromLevel: "3F",
      toLevel: "3F",
      distanceM: 40,
      buildingId: "east",
    }),
    step({
      kind: "steps",
      fromLevel: "3F",
      toLevel: "2F",
      distanceM: 18,
      buildingId: "east",
    }),
    step({
      kind: "steps",
      fromLevel: "2F",
      toLevel: "1F",
      distanceM: 18,
      buildingId: "east",
    }),
    step({
      kind: "corridor",
      fromLevel: "1F",
      toLevel: "1F",
      distanceM: 22,
      buildingId: "east",
    }),
    step({
      kind: "corridor",
      action: "exit",
      fromLevel: "1F",
      toLevel: null,
      distanceM: 0,
      buildingId: "east",
    }),
    step({
      kind: "corridor",
      fromLevel: null,
      toLevel: null,
      distanceM: 79,
      buildingId: null,
    }),
    step({
      kind: "corridor",
      action: "enter",
      fromLevel: null,
      toLevel: "1F",
      distanceM: 0,
      toBuildingId: "west",
    }),
    step({
      kind: "corridor",
      fromLevel: "1F",
      toLevel: "1F",
      distanceM: 10,
      buildingId: "west",
    }),
  ];
  const from = place("east-301", "east", "East Hall", "3F");
  const to = place("west-101", "west", "West Hall", "1F");
  return {
    id: "journey",
    venueId: "campus",
    buildingId: "east",
    sourceVersion: "v1",
    from,
    to,
    mode: "normal",
    verticalPreference: "auto",
    preview: { progress: 0, playing: false, direction: 1 },
    guidance: { status: "touring", stepIndex: 0 },
    route: {
      ok: true,
      fromPlaceId: from.placeId,
      toPlaceId: to.placeId,
      points: Array.from({ length: cursor + 1 }, (_, i) => [0, i, 0]),
      kinds: steps.map((item) => item.kind),
      steps,
      distanceM: steps.reduce((sum, item) => sum + item.distanceM, 0),
      animationSafe: false,
      warnings: [],
      edgeIds: [],
    },
  };
}

export function campusModel(id: string, levels: string[]): LocalIndoorModel {
  return {
    schemaVersion: 1,
    venueId: "campus",
    name: "Campus",
    source: { sha256: "v1", generatedAt: "test", warnings: [] },
    origin: [0, 0],
    building: {
      id,
      name: id,
      footprint: [],
      levels: levels.map((ref, ordinal) => ({ ordinal, ref, elevationM: 0 })),
      floorHeightM: 4,
      heightStatus: "estimated",
      geometryStatus: "schematic",
    },
    features: [],
    connections: [],
    places: [],
    nodes: [],
    edges: [],
    walls: [],
  };
}
