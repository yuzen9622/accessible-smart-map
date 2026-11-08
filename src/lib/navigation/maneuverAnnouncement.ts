import type { NavInstruction } from "@/types/route";
import { isVehicleLegType, type NavLegType } from "./legMode";

/**
 * Staged turn announcements, as in Google/Apple Maps (ported from the mobile
 * app): a maneuver is announced at most three times —
 * 1. `advance` when its step becomes current: "In X m, turn left";
 * 2. `prepare` once more when close (skipped if `advance` was already close);
 * 3. `now` at the maneuver point: "Turn left…".
 * CONTINUE/STRAIGHT steps are not turns and are only announced at `now`.
 */
export type ManeuverStage = "advance" | "prepare" | "now";

export interface AnnouncementThresholds {
  /** Remind once more within this distance. */
  prepareM: number;
  /** Announce the maneuver itself within this distance. */
  nowM: number;
}

export const WALK_ANNOUNCE: AnnouncementThresholds = { prepareM: 50, nowM: 12 };
export const VEHICLE_ANNOUNCE: AnnouncementThresholds = {
  prepareM: 300,
  nowM: 50,
};

export function announceThresholdsFor(
  legType: NavLegType | null | undefined,
): AnnouncementThresholds {
  return isVehicleLegType(legType) ? VEHICLE_ANNOUNCE : WALK_ANNOUNCE;
}

/** The routing engine explicitly marked the step as going straight on. */
export function isStraightManeuver(
  step: Pick<NavInstruction, "maneuver">,
): boolean {
  return step.maneuver === "CONTINUE" || step.maneuver === "STRAIGHT";
}

/**
 * The stage to announce at this distance, or null.
 * @param spoken Stages already announced for this step.
 * @param advanceDistanceM Distance when `advance` was spoken; too close to `prepareM` skips `prepare`.
 * @param straight Straight steps are never pre-announced, only at `now`.
 */
export function selectManeuverStage(
  distanceM: number,
  legType: NavLegType | null | undefined,
  spoken: ReadonlySet<ManeuverStage>,
  advanceDistanceM: number | null,
  straight = false,
): ManeuverStage | null {
  if (spoken.has("now")) return null;
  const { prepareM, nowM } = announceThresholdsFor(legType);
  if (distanceM <= nowM) return "now";
  if (straight) return null;
  if (spoken.size === 0) return "advance";
  if (
    !spoken.has("prepare") &&
    distanceM <= prepareM &&
    advanceDistanceM != null &&
    advanceDistanceM > prepareM * 1.5
  )
    return "prepare";
  return null;
}

// "約 110 公尺" / "for about 110 m": the announcement already says how far the
// maneuver is, so the step text's own segment length would contradict it.
const ZH_NUM = String.raw`約?\s*[\d.,]+\s*(?:公尺|公里|米)`;
const EN_NUM = String.raw`(?:for\s+)?(?:about\s+|approximately\s+|approx\.\s+)?[\d.,]+\s*(?:m|meters?|metres?|km|kilometers?|kilometres?)\b`;
// A clause that is only "verb + distance" ("，續行約 130 公尺", ", then continue for 40 m") goes with its comma.
const ZH_CLAUSE = new RegExp(
  String.raw`[，,]\s*(?:繼續直行|[^，,。]{0,3}?)${ZH_NUM}\s*(?=[，,。]|$)`,
  "g",
);
const EN_CLAUSE = new RegExp(
  String.raw`,\s*(?:then\s+)?(?:continue|walk|go|keep going)\s+${EN_NUM}\s*(?=[,.]|$)`,
  "gi",
);
const ZH_DISTANCE = new RegExp(ZH_NUM, "g");
const EN_DISTANCE = new RegExp(String.raw`\s*\b${EN_NUM}`, "gi");

/** Step text without its own segment length, for "In X m, …" announcements. */
export function stripStepDistance(text: string): string {
  const stripped = text
    .replace(ZH_CLAUSE, "")
    .replace(EN_CLAUSE, "")
    .replace(ZH_DISTANCE, "")
    .replace(EN_DISTANCE, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return stripped || text;
}
