import type { RouteMessageDetail } from "@/types/route";

export type RouteMessageTone = "caution" | "positive" | "neutral";

const CAUTION_CODES = new Set([
  "ROUTE_DATA_SPARSE",
  "ROUTE_LONG_WALK",
  "ROUTE_MANY_TRANSFERS",
  "ROUTE_ADVERSE_ENVIRONMENT",
  "ROUTE_NO_ACCESSIBLE_TOILET",
  "ROUTE_STAIRS_HANDRAIL_UNKNOWN",
  "ROUTE_SLOPE_CSR",
  "ROUTE_SLOPE_NO_ELEVATION",
  "ROUTE_SLOPE_SERVER_DEFAULT",
  "ROUTE_SLOPE_WHEELCHAIR_DISABLED",
  "ROUTE_SLOPE_SERVER_LIMIT",
  "ROUTE_STAIRS_CONSTRAINT_UNSATISFIED",
  "ROUTE_HAZARD_DATA_UNAVAILABLE",
  "ROUTE_HAZARD_ON_ROUTE",
  "ROUTE_CLOSURE_BYPASS_FAILED",
  "ROUTE_HAZARD_ALL_ROUTES_BLOCKED",
  "ROUTE_CSR_APPROXIMATE_INDOOR",
  "ROUTE_PARK_NO_QUALIFYING_ENTRANCE",
  "ROUTE_HIGH_FLOOR_ALTERNATIVE",
  "ROUTE_HIGH_FLOOR_NO_ALTERNATIVE",
  "ROUTE_WALK_CONNECTOR_UNAVAILABLE",
]);

// Presentation only: nearby facilities do not verify accessibility of the
// entire route. Never use these codes/params to change routing constraints.
const POSITIVE_CODES = new Set([
  "ROUTE_TOILET_AVAILABLE",
  "ROUTE_NEARBY_PARKING",
  "ROUTE_NEARBY_ACCESS_FEATURES",
  "ROUTE_WALK_NEARBY_FEATURES",
  "ROUTE_BOARD_ELEVATOR_NEARBY",
  "ROUTE_ALIGHT_ELEVATOR_NEARBY",
  "ROUTE_BOARD_RAMP_NEARBY",
  "ROUTE_ALIGHT_RAMP_NEARBY",
  "ROUTE_ACCESSIBLE_TOILET_NEARBY",
  "ROUTE_TACTILE_PAVING_NEARBY",
  "ROUTE_AUDIO_SIGNAL_NEARBY",
  "ROUTE_BOARD_FACILITIES",
  "ROUTE_ALIGHT_FACILITIES",
  "ROUTE_LOW_FLOOR_DIRECT",
  "ROUTE_LOW_FLOOR_ALL",
  "ROUTE_LOW_FLOOR_EVIDENCE",
]);

/** Pair before any sorting/truncation; always retain every original string.
 * Missing, ambiguous, stale or future details must never imply success. */
export function pairRouteMessages(
  messages: string[] | undefined,
  details: RouteMessageDetail[] | undefined,
): { index: number; text: string; tone: RouteMessageTone }[] {
  return (messages ?? []).map((text, index) => {
    const matches = details?.filter((detail) => detail.index === index);
    const detail =
      matches?.length === 1 && matches[0].message === text
        ? matches[0]
        : undefined;
    const tone: RouteMessageTone =
      detail && CAUTION_CODES.has(detail.code)
        ? "caution"
        : detail && POSITIVE_CODES.has(detail.code)
          ? "positive"
          : "neutral";
    return { index, text, tone };
  });
}
