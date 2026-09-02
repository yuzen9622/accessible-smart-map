import type { HeadingSource } from "@/stores/useNavStore";
import type { NavInstruction } from "@/types/route";

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
  /** Pass within this of a maneuver → advance to it. */
  arriveM: number;
  /** Perpendicular distance from the route that counts as off-route. */
  offRouteM: number;
  /** Within this of the final maneuver → arrived. */
  finalArriveM: number;
}

export const WALK_THRESHOLDS: NavThresholds = {
  arriveM: 18,
  offRouteM: 40,
  finalArriveM: 25,
};

/** Roads are wider than the GPS error a pedestrian tolerates, and a car
 * covers 18 m in under a second — tight pedestrian radii would announce turns
 * too late and flag every lane change as off-route. */
export const VEHICLE_THRESHOLDS: NavThresholds = {
  arriveM: 60,
  offRouteM: 80,
  finalArriveM: 60,
};

export function navThresholdsFor(
  legType: NavLegType | null | undefined,
): NavThresholds {
  return isVehicleLegType(legType) ? VEHICLE_THRESHOLDS : WALK_THRESHOLDS;
}

/**
 * First maneuver still ahead of the user, using each waypoint's own leg-type
 * threshold — a composite route hits the 60 m driving radius while on the road
 * leg and the 18 m walking radius after the handoff, within one pass.
 */
export function selectNextStepIndex(
  instructions: readonly NavInstruction[],
  waypoints: readonly { alongM: number }[],
  alongM: number,
): number {
  const count = Math.min(instructions.length, waypoints.length);
  for (let i = 0; i < count; i++) {
    const { arriveM } = navThresholdsFor(instructions[i]?.legType);
    if (waypoints[i].alongM > alongM + arriveM) return i;
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
