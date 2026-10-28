import { sourceName } from "@/lib/route/sourceNames";
import type { AccessibleRoute } from "@/types/route";
import type { VoiceNavigationEvent, VoiceNavStep } from "./voiceSession";

export interface VoiceTransitState {
  onVehicle: boolean;
  leg: Extract<VoiceNavigationEvent, { type: "nav.transit" }>["leg"] | null;
}

export function resumedTransit(
  route: AccessibleRoute | null | undefined,
  steps: VoiceNavStep[],
  currentStepIndex: number,
  onVehicle: boolean,
): VoiceTransitState | null {
  if (!onVehicle) return null;
  const transitLegs =
    route?.legs.filter((leg) =>
      ["BUS", "METRO", "THSR", "TRA"].includes(leg.type),
    ) ?? [];
  const boardCount = steps
    .slice(0, currentStepIndex + 1)
    .filter((step) => step.type === "transit_board").length;
  const mode = steps[currentStepIndex]?.legType;
  const matching = transitLegs.filter((leg) => leg.type === mode);
  const leg =
    boardCount > 0
      ? transitLegs[boardCount - 1]
      : matching.length === 1
        ? matching[0]
        : null;
  if (!leg || leg.type !== mode) return { onVehicle: true, leg: null };
  if (leg.type === "BUS")
    return {
      onVehicle: true,
      leg: {
        mode: leg.type,
        from: leg.departureStop,
        to: leg.arrivalStop,
        routeName: leg.routeName,
      },
    };
  if (leg.type === "METRO")
    return {
      onVehicle: true,
      leg: {
        mode: leg.type,
        from: leg.departureStation,
        to: leg.arrivalStation,
        routeName: leg.lineName,
        ...(leg.terminalStation
          ? { terminalStation: leg.terminalStation }
          : {}),
        ...Object.fromEntries(
          (
            [
              ["lineKey", leg.lineKey],
              ["fromNameEn", leg.fromNameEn],
              ["toNameEn", leg.toNameEn],
              [
                "terminalNameEn",
                leg.terminalStation ? leg.terminalNameEn : undefined,
              ],
            ] as const
          ).filter(([, value]) => value?.trim()),
        ),
      },
    };
  if (leg.type === "TRA" || leg.type === "THSR")
    return {
      onVehicle: true,
      leg: {
        mode: leg.type,
        from: leg.departureStation,
        to: leg.arrivalStation,
        routeName: leg.trainNo,
      },
    };
  return { onVehicle: true, leg: null };
}

type VoiceTransitLeg = NonNullable<VoiceTransitState["leg"]>;

/**
 * HUD names for the voice transit leg in the current UI language: the line from
 * its label, stations from canonical + source English, never stale display text.
 */
export function voiceTransitNames(
  leg: VoiceTransitLeg,
  language: "en" | "zh-TW",
  t: (key: string, options?: Record<string, unknown>) => string,
): { route: string; from: string; to: string } {
  const line = leg.lineKey
    ? t(`metroLines.${leg.lineKey}`, { defaultValue: leg.routeName ?? "" })
    : (leg.routeName ?? "");
  const terminal = leg.terminalStation?.trim()
    ? sourceName(leg.terminalStation, leg.terminalNameEn, undefined, language)
    : "";
  return {
    route: terminal ? t("metroLineToward", { line, terminal }) : line,
    from: sourceName(leg.from, leg.fromNameEn, undefined, language),
    to: sourceName(leg.to, leg.toNameEn, undefined, language),
  };
}
