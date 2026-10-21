import type { NavInstruction } from "@/types/route";

/**
 * The backend keeps a straight stretch as one step, so long walks would be
 * silent between turns. Each time the distance to the next maneuver crosses a
 * multiple of this interval, say "continue straight N" once.
 */
export const WALK_REMINDER_INTERVAL_M = 500;
/** Walk at least this far into a step first, so a mark never repeats the step's own announcement. */
const REMINDER_MIN_WALKED_M = 150;
/** The last metres belong to the turn itself. */
const REMINDER_FLOOR_M = 50;

/**
 * Returns the mark (metres remaining) to announce now, or null.
 * @param spokenMarks Marks already announced for this step.
 * @param startDistanceM Distance to the maneuver when this step became current.
 */
export function selectProgressReminder(
  distanceM: number,
  legType: NavInstruction["legType"] | null | undefined,
  spokenMarks: ReadonlySet<number>,
  startDistanceM: number | null,
): number | null {
  if (
    legType !== "WALK" ||
    startDistanceM == null ||
    distanceM <= REMINDER_FLOOR_M
  )
    return null;
  const mark =
    Math.ceil(distanceM / WALK_REMINDER_INTERVAL_M) * WALK_REMINDER_INTERVAL_M;
  if (spokenMarks.has(mark) || startDistanceM - mark < REMINDER_MIN_WALKED_M)
    return null;
  return mark;
}

/** Spoken distance: 10 m steps (GPS is no finer), 0.1 km from 1 km up. */
export function spokenDistance(
  meters: number,
): { unit: "m"; value: number } | { unit: "km"; value: number } {
  if (meters >= 1000)
    return { unit: "km", value: Math.round(meters / 100) / 10 };
  return { unit: "m", value: Math.max(10, Math.round(meters / 10) * 10) };
}
