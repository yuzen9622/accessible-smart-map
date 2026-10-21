import type { NavInstruction } from "@/types/route";

/** The active maneuver is a target ahead of the user, not proof of arrival. */
export function navigationInstructionText(
  instruction: Pick<NavInstruction, "type" | "text"> | undefined,
  arrived: boolean,
  translate: (key: string) => string,
): string {
  if (instruction?.type === "arrive" && !arrived)
    return translate("navContinueToDestination");
  return instruction?.text ?? translate("preparingNav");
}

/** HUD label: just the road being travelled; the full maneuver is spoken.
 * Steps without a road (arrival, transit, facilities) keep their text. */
const ROADLESS_TYPES = new Set<NavInstruction["type"]>([
  "arrive",
  "facility",
  "transit_board",
  "transit_alight",
]);

export function navigationRoadLabel(
  instruction: Pick<NavInstruction, "type" | "text" | "streetName"> | undefined,
  arrived: boolean,
  translate: (key: string) => string,
): string {
  const street = instruction?.streetName?.trim();
  if (street && instruction && !ROADLESS_TYPES.has(instruction.type))
    return street;
  return navigationInstructionText(instruction, arrived, translate);
}
