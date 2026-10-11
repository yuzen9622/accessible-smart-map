import type { NavInstruction } from "@/types/route";
import {
  findBusRuns,
  type TransitGuide,
  type TransitSpeech,
  transitAnnouncement,
} from "./transitRide";

export interface TransitSpeechFrame {
  /** Null invalidates history: preview, reset, reroute or a different speech owner. */
  scope: string | null;
  instructions: NavInstruction[];
  index: number;
  rideKey: string | undefined;
  guide: TransitGuide | null;
}
/** One audio decision per HUD frame, so generic step speech cannot overwrite transit speech. */
export function createTransitSpeechCoordinator() {
  let previous: TransitSpeechFrame | null = null;
  let protectedStep: number | null = null;
  const spoken = new Set<string>();
  return (
    frame: TransitSpeechFrame,
  ): { speech: TransitSpeech | null; generic: boolean } => {
    if (
      !frame.scope ||
      previous?.scope !== frame.scope ||
      previous.instructions !== frame.instructions
    ) {
      previous = null;
      protectedStep = null;
      spoken.clear();
    }
    if (!frame.scope) return { speech: null, generic: false };
    const priorRun =
      previous &&
      findBusRuns(previous.instructions).find(
        (run) =>
          previous !== null &&
          previous.index >= run.boardIndex &&
          previous.index <= run.alightIndex,
      );
    // Only normal forward progress across the same installed run qualifies.
    // A null guide/ride by itself is never an alighting event.
    const exited =
      priorRun &&
      previous?.guide?.phase === "riding" &&
      previous.rideKey !== undefined &&
      frame.index > priorRun.alightIndex;
    if (exited && previous?.guide?.phase === "riding") {
      const speech: TransitSpeech | null = spoken.has("alight")
        ? null
        : { kind: "alight", alightStop: previous.guide.alightStop };
      if (previous.rideKey !== frame.rideKey) spoken.clear();
      else spoken.add("alight");
      protectedStep = frame.index;
      previous = frame;
      return { speech, generic: false };
    }
    if (previous?.rideKey !== frame.rideKey) spoken.clear();
    const result = transitAnnouncement(
      previous?.rideKey === frame.rideKey ? (previous?.guide ?? null) : null,
      frame.guide,
      spoken,
    );
    if (result.reset) spoken.clear();
    for (const key of result.remember) spoken.add(key);
    if (result.speech?.kind === "alight") protectedStep = frame.index;
    const changedStep = !previous || previous.index !== frame.index;
    previous = frame;
    return {
      speech: result.speech,
      generic:
        changedStep &&
        protectedStep !== frame.index &&
        !frame.guide &&
        frame.instructions[frame.index]?.legType !== "BUS",
    };
  };
}
