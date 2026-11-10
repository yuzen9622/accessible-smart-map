import type { VoiceSpeedLimit } from "@/lib/voice/voiceSession";
import type {
  AccessibleRoute,
  DriveLeg,
  NavInstruction,
  RoadLane,
} from "@/types/route";
import { isVehicleLegType } from "./legMode";
import {
  matchesProgressIdentity,
  type NavigationProgress,
} from "./navigationProgress";

/** Progress older than this no longer places the vehicle on a segment. */
export const DRIVING_PROGRESS_MAX_AGE_MS = 30_000;

/** What the HUD and `nav.state.speedLimit` report for the current segment. */
export type CurrentSpeedLimit = VoiceSpeedLimit;

export interface DrivingPosition {
  legIndex: number;
  leg: DriveLeg;
  /** Segment index in the leg's own polyline (segment i joins vertex i, i+1). */
  segmentIndex: number;
}

/**
 * Where the selected route's progress places the vehicle, in leg-local
 * segment terms. Null without fresh progress for this route identity, on a
 * non-vehicle leg, or when the index falls outside the leg polyline.
 */
export function currentDrivingPosition(input: {
  route: AccessibleRoute | null | undefined;
  progress: NavigationProgress | null;
  navigationId: string | null;
  routeVersion: number;
  now: number;
}): DrivingPosition | null {
  const { route, progress, now } = input;
  if (!route || !progress) return null;
  if (
    !matchesProgressIdentity(progress, {
      routeToken: route.routeToken ?? route.routeId,
      navigationId: input.navigationId,
      routeVersion: input.routeVersion,
    })
  )
    return null;
  if (
    !Number.isFinite(progress.observedAt) ||
    now - progress.observedAt > DRIVING_PROGRESS_MAX_AGE_MS
  )
    return null;
  const leg = route.legs[progress.legIndex];
  if (!leg || !isVehicleLegType(leg.type)) return null;
  const driveLeg = leg as DriveLeg;
  // Progress indexes the concatenated path; leg polylines are appended verbatim.
  let legStart = 0;
  for (let i = 0; i < progress.legIndex; i++)
    legStart += route.legs[i].polyline?.length ?? 0;
  const segmentIndex = progress.segmentIndex - legStart;
  const segmentCount = (driveLeg.polyline?.length ?? 0) - 1;
  if (
    !Number.isInteger(segmentIndex) ||
    segmentIndex < 0 ||
    segmentIndex >= segmentCount
  )
    return null;
  return { legIndex: progress.legIndex, leg: driveLeg, segmentIndex };
}

/** The leg's speed limit on `segmentIndex`; gaps and bad data read as unknown. */
export function speedLimitAt(
  leg: Pick<DriveLeg, "speedLimits">,
  segmentIndex: number,
): CurrentSpeedLimit {
  const limits = leg.speedLimits;
  if (limits?.status !== "available")
    return { kind: "unknown", limitKph: null };
  const segment = limits.segments.find(
    (candidate) =>
      candidate.fromIndex <= segmentIndex && segmentIndex < candidate.toIndex,
  );
  if (segment?.kind === "unlimited")
    return { kind: "unlimited", limitKph: null };
  if (
    segment?.kind === "known" &&
    Number.isInteger(segment.limitKph) &&
    segment.limitKph > 0 &&
    segment.limitKph <= 200
  )
    return { kind: "known", limitKph: segment.limitKph };
  return { kind: "unknown", limitKph: null };
}

/** Lane guidance to draw for the upcoming maneuver, or null to draw none. */
export interface LaneGuidance {
  lanes: RoadLane[];
  laneHint: string | null;
}

/**
 * Lanes are drawn only while progress sits on the same leg inside the upcoming
 * maneuver's approach range [fromIndex, toIndex); passing the turn clears them.
 */
export function laneGuidanceAt(
  step:
    | Pick<NavInstruction, "legIndex" | "legType" | "roadGuidance">
    | undefined,
  position: DrivingPosition | null,
): LaneGuidance | null {
  const guidance = step?.roadGuidance;
  const range = guidance?.laneApproachRange;
  if (
    !position ||
    !step ||
    !guidance?.lanes?.length ||
    !range ||
    !isVehicleLegType(step.legType) ||
    step.legIndex !== position.legIndex ||
    position.segmentIndex < range.fromIndex ||
    position.segmentIndex >= range.toIndex
  )
    return null;
  return { lanes: guidance.lanes, laneHint: guidance.laneHint ?? null };
}

/** 1-based lane numbers, counted from the left, with this recommendation. */
export function laneNumbers(
  lanes: readonly RoadLane[],
  recommendation: RoadLane["recommendation"],
): number[] {
  const numbers: number[] = [];
  lanes.forEach((lane, index) => {
    if (lane.recommendation === recommendation) numbers.push(index + 1);
  });
  return numbers;
}
