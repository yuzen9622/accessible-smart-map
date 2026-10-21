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
