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
