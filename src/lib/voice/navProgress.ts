import type { EtaSource, NavProgressUpdate } from "@/stores/useNavStore";
import type { VoiceNavigationEvent } from "./voiceSession";

const VALID_ETA_SOURCES: Set<string> = new Set([
  "schedule",
  "realtime",
  "free_flow",
  "estimated",
  "local",
]);

function toNonNegativeNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(0, value);
}

export function toNavProgressUpdate(
  event: Extract<VoiceNavigationEvent, { type: "nav.progress" }>,
): NavProgressUpdate {
  const update: NavProgressUpdate = {};

  if ("remainingDistanceM" in event) {
    const remainingM = toNonNegativeNumber(event.remainingDistanceM);
    if (remainingM !== undefined) update.remainingM = remainingM;
  }
  if ("remainingDurationSec" in event) {
    const remainingDurationSec = toNonNegativeNumber(
      event.remainingDurationSec,
    );
    if (remainingDurationSec !== undefined)
      update.remainingDurationSec = remainingDurationSec;
  }
  if ("estimatedArrivalAt" in event) {
    if (event.estimatedArrivalAt === null) {
      update.estimatedArrivalAt = null;
    } else if (typeof event.estimatedArrivalAt === "string") {
      const estimatedArrivalAt = Date.parse(event.estimatedArrivalAt);
      if (!Number.isNaN(estimatedArrivalAt))
        update.estimatedArrivalAt = estimatedArrivalAt;
    }
  }
  if ("etaSource" in event && event.etaSource && VALID_ETA_SOURCES.has(event.etaSource)) {
    update.etaSource = event.etaSource as EtaSource;
  } else if (
    "remainingDurationSec" in update ||
    "estimatedArrivalAt" in update
  ) {
    update.etaSource = "estimated";
  }
  if ("distanceToNextM" in event) {
    const distanceToNextM = toNonNegativeNumber(event.distanceToNextM);
    if (distanceToNextM !== undefined) update.distanceToNextM = distanceToNextM;
  }

  return update;
}
