import { buildCumulativePath, haversineMeters, projectToPath } from "@/lib/geo";
import type { UserLocationFix } from "@/stores/map/types";
import type { LatLng } from "@/types";
import type { AccessibleRoute, NavInstruction } from "@/types/route";
import { routeReachesArrival } from "./arrival";

const ENTRANCE_ARRIVAL_M = 8;

export interface VenueArrivalCandidate {
  sessionKey: string;
  firstTimestamp: number;
  lastTimestamp: number;
}

export interface VenueArrivalSnapshot {
  sessionKey: string | null;
  activeOutdoor: boolean;
  sourceValid: boolean;
  liveNavigation: boolean;
  currentStep: Pick<NavInstruction, "type" | "legType"> | null;
  riding: boolean;
  /** Recomputed from the active route, not the engine's arrival-cleared counter. */
  remainingOutdoorM: number | null;
  arrival: LatLng | null;
  location: LatLng | null;
  fix: UserLocationFix | null;
  now: number;
}

export interface VenueArrivalEvaluation {
  candidate: VenueArrivalCandidate | null;
  shouldTransition: boolean;
}

function validLocation(location: LatLng | null): location is LatLng {
  return Boolean(
    location &&
      Number.isFinite(location.lat) &&
      Number.isFinite(location.lng) &&
      Math.abs(location.lat) <= 90 &&
      Math.abs(location.lng) <= 180,
  );
}

/** A nearby gate does not authorize skipping the provider's walking detour. */
export function remainingOutdoorDistanceToArrival(
  route: AccessibleRoute | null,
  location: LatLng | null,
  arrival: LatLng | null,
): number | null {
  if (
    !route ||
    !validLocation(location) ||
    !validLocation(arrival) ||
    !routeReachesArrival(route, arrival)
  )
    return null;
  const finalLeg = route.legs.filter((leg) => leg.polyline?.length).at(-1);
  if (finalLeg?.type !== "WALK") return null;
  const path = buildCumulativePath(route.legs);
  if (path.path.length < 2 || path.path.some((point) => !validLocation(point)))
    return null;
  const projected = projectToPath(location, path.path, path.cumM);
  const total = path.cumM.at(-1);
  if (
    total === undefined ||
    !Number.isFinite(total) ||
    !Number.isFinite(projected.alongM) ||
    !Number.isFinite(projected.perpDistM) ||
    projected.perpDistM > ENTRANCE_ARRIVAL_M
  )
    return null;
  return Math.max(0, total - projected.alongM);
}

/** GPS can confirm only the selected venue entrance, never an indoor arrival. */
export function evaluateVenueArrival(
  previous: VenueArrivalCandidate | null,
  snapshot: VenueArrivalSnapshot,
): VenueArrivalEvaluation {
  const { sessionKey, fix, now } = snapshot;
  const invalid = { candidate: null, shouldTransition: false } as const;
  if (
    !sessionKey ||
    !snapshot.activeOutdoor ||
    !snapshot.sourceValid ||
    !snapshot.liveNavigation ||
    snapshot.riding ||
    snapshot.currentStep?.legType !== "WALK" ||
    snapshot.remainingOutdoorM === null ||
    !Number.isFinite(snapshot.remainingOutdoorM) ||
    snapshot.remainingOutdoorM < 0 ||
    snapshot.remainingOutdoorM > ENTRANCE_ARRIVAL_M ||
    !validLocation(snapshot.arrival) ||
    !validLocation(snapshot.location) ||
    !fix ||
    !Number.isFinite(now) ||
    !Number.isFinite(fix.timestamp) ||
    !Number.isFinite(fix.accuracyM) ||
    fix.accuracyM < 0 ||
    fix.accuracyM > 30 ||
    fix.timestamp > now ||
    now - fix.timestamp > 15_000 ||
    haversineMeters(snapshot.location, snapshot.arrival) > ENTRANCE_ARRIVAL_M
  )
    return invalid;

  if (
    !previous ||
    previous.sessionKey !== sessionKey ||
    now - previous.firstTimestamp > 15_000
  )
    return {
      candidate: {
        sessionKey,
        firstTimestamp: fix.timestamp,
        lastTimestamp: fix.timestamp,
      },
      shouldTransition: false,
    };
  if (fix.timestamp < previous.lastTimestamp) return invalid;
  if (fix.timestamp === previous.lastTimestamp)
    return { candidate: previous, shouldTransition: false };
  return {
    candidate: { ...previous, lastTimestamp: fix.timestamp },
    shouldTransition: fix.timestamp - previous.firstTimestamp >= 2_000,
  };
}
