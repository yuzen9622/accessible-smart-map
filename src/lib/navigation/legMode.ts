import type { HeadingSource } from "@/stores/useNavStore";
import type { NavInstruction } from "@/types/route";
import { busStepRuns } from "./transitRide";

export type NavLegType = NavInstruction["legType"];

const VEHICLE_LEG_TYPES: ReadonlySet<NavLegType> = new Set<NavLegType>([
  "DRIVE",
  "MOTORCYCLE",
]);

/** DRIVE / MOTORCYCLE legs move an order of magnitude faster than WALK or
 * TRANSIT, so the engine tunes its heading source, tolerances and camera to
 * them. Everything else keeps the pedestrian behaviour. */
export function isVehicleLegType(
  legType: NavLegType | null | undefined,
): boolean {
  return legType != null && VEHICLE_LEG_TYPES.has(legType);
}

/** Leg type of the step the HUD is currently showing, or null when the
 * instruction list has not loaded (or the index is out of range). */
export function resolveActiveLegType(
  instructions: readonly NavInstruction[],
  index: number,
): NavLegType | null {
  if (index < 0) return null;
  return instructions[index]?.legType ?? null;
}

export interface NavThresholds {
  /** Within this of a maneuver, the leg type it belongs to takes over. */
  arriveM: number;
  /**
   * How far *past* a maneuver the user must be, along the route, before it
   * counts as done. Projection onto the route snaps to the corner while the
   * user has not turned yet, so only someone who actually took the turn gets
   * this far along the next segment.
   */
  passM: number;
  /** Perpendicular distance from the route that counts as off-route. */
  offRouteM: number;
  /** Within this of the final maneuver → arrived. */
  finalArriveM: number;
}

export const WALK_THRESHOLDS: NavThresholds = {
  arriveM: 18,
  passM: 8,
  offRouteM: 40,
  finalArriveM: 25,
};

/** Roads are wider than the GPS error a pedestrian tolerates, and a car
 * covers 18 m in under a second — tight pedestrian radii would flag every lane
 * change as off-route. */
export const VEHICLE_THRESHOLDS: NavThresholds = {
  arriveM: 60,
  passM: 20,
  offRouteM: 80,
  finalArriveM: 60,
};

export function navThresholdsFor(
  legType: NavLegType | null | undefined,
): NavThresholds {
  return isVehicleLegType(legType) ? VEHICLE_THRESHOLDS : WALK_THRESHOLDS;
}

/**
 * How far past maneuver `i` (meters along the route) counts as done.
 *
 * A maneuver is only done once the user is *beyond* it — like Google / Apple
 * Maps, the HUD keeps showing "turn left" until the turn is taken. Advancing
 * inside a radius *before* the maneuver made the HUD and the voice run one
 * step ahead, and a vehicle's 60 m radius skipped the "turn now" announcement.
 *
 * The leg-type distance is capped at half the gap to the next maneuver so two
 * close maneuvers still advance one by one. Depart and alight steps have no
 * turn to confirm: standing at the origin / the stop is enough.
 */
function passedBeyondM(
  instructions: readonly NavInstruction[],
  waypoints: readonly { alongM: number }[],
  i: number,
): number {
  const type = instructions[i]?.type;
  if (type === "depart" || type === "transit_alight") return 0;
  const { passM } = navThresholdsFor(instructions[i]?.legType);
  const next = waypoints[i + 1];
  if (!next) return passM;
  return Math.min(passM, Math.max(0, next.alongM - waypoints[i].alongM) / 2);
}

/**
 * First maneuver the user has not passed yet, using each waypoint's own
 * leg-type distance — a composite route uses the driving distance on the road
 * leg and the walking one after the handoff, within one pass.
 */
export function selectNextStepIndex(
  instructions: readonly NavInstruction[],
  waypoints: readonly { alongM: number }[],
  alongM: number,
): number {
  const count = Math.min(instructions.length, waypoints.length);
  for (let i = 0; i < count; i++) {
    if (
      alongM <
      waypoints[i].alongM + passedBeyondM(instructions, waypoints, i)
    )
      return i;
  }
  return Math.max(0, count - 1);
}

export interface NavHeadingInputs {
  isVehicle: boolean;
  compassHeading: number | null;
  compassAgeMs: number;
  compassFreshMs: number;
  gpsHeading: number | null;
  userHeading: number | null;
  headingSource: HeadingSource;
}

export interface NavHeadingResult {
  heading: number;
  source: HeadingSource;
}

/**
 * Resolve which heading drives the marker and the map bearing.
 *
 * Walking: a fresh compass reading wins — it points where the user faces even
 * while standing still. Driving: it does not. A phone in a cradle points
 * wherever the mount does, so course-over-ground from the GPS fix is the only
 * reading that tracks the vehicle; the last written heading is the fallback,
 * and the compass is a last resort.
 */
export function resolveNavHeading(
  input: NavHeadingInputs,
): NavHeadingResult | null {
  const compass =
    input.compassHeading != null && input.compassAgeMs < input.compassFreshMs
      ? input.compassHeading
      : null;

  if (input.isVehicle) {
    if (input.gpsHeading != null)
      return { heading: input.gpsHeading, source: "gps" };
    if (input.userHeading != null)
      return {
        heading: input.userHeading,
        source: input.headingSource ?? "gps",
      };
    if (compass != null) return { heading: compass, source: "compass" };
    return null;
  }

  if (compass != null) return { heading: compass, source: "compass" };
  if (input.gpsHeading != null)
    return { heading: input.gpsHeading, source: "gps" };
  return null;
}

/**
 * Resolves the leg type the user is actively traversing at position `alongM`.
 * For a composite route (e.g. DRIVE 1000m followed by WALK), the vehicle mode
 * stays active for the entire 0..1000m road segment, and only switches to WALK
 * once within arrival distance of the parking / walk-start waypoint.
 */
export function resolveCurrentLegType(
  instructions: readonly NavInstruction[],
  waypoints: readonly { alongM: number }[],
  alongM: number,
): NavLegType | null {
  if (!instructions.length || !waypoints.length) return null;
  const count = Math.min(instructions.length, waypoints.length);
  let activeIndex = 0;
  for (let i = 0; i < count; i++) {
    const prevLegType =
      i > 0 ? instructions[i - 1]?.legType : instructions[i]?.legType;
    const { arriveM } = navThresholdsFor(prevLegType);
    if (alongM >= waypoints[i].alongM - arriveM) {
      activeIndex = i;
    }
  }
  return instructions[activeIndex]?.legType ?? null;
}

/**
 * For a composite route (drive to an accessible parking space, then walk),
 * the index of the first non-vehicle step after the vehicle leg the user is
 * on. Null while no such handoff is pending — the HUD uses it to warn the
 * driver before the mode changes under them.
 */
export function findLegHandoffIndex(
  instructions: readonly NavInstruction[],
  index: number,
): number | null {
  if (!isVehicleLegType(resolveActiveLegType(instructions, index))) return null;
  for (let i = index + 1; i < instructions.length; i++) {
    if (!isVehicleLegType(instructions[i].legType)) return i;
  }
  return null;
}

/**
 * Which bus segment (0-based, in `route.legs` order) the user is riding or is
 * about to ride, derived from the instruction list alone.
 *
 * A route can board the same line twice, so a run of consecutive BUS steps —
 * not the leg type of one step — identifies a segment. The index inside a run
 * means "riding it"; a run still ahead means "about to board it". Past the
 * last run there is nothing left to track, so the answer is null.
 */
export function resolveActiveBusLegOrdinal(
  instructions: readonly NavInstruction[],
  currentStepIndex: number,
): number | null {
  const runs = busStepRuns(instructions);

  const riding = runs.findIndex(
    (r) => currentStepIndex >= r.start && currentStepIndex <= r.end,
  );
  if (riding !== -1) return riding;

  const ahead = runs.findIndex((r) => r.start > currentStepIndex);
  return ahead === -1 ? null : ahead;
}

/** True when advancing between these two steps crosses the vehicle/on-foot
 * boundary in either direction — the moment the engine re-frames the camera
 * and drops the heading it smoothed for the previous mode. */
export function isLegHandoff(
  instructions: readonly NavInstruction[],
  fromIndex: number,
  toIndex: number,
): boolean {
  const from = resolveActiveLegType(instructions, fromIndex);
  const to = resolveActiveLegType(instructions, toIndex);
  if (from == null || to == null) return false;
  return isVehicleLegType(from) !== isVehicleLegType(to);
}
