import type { RouteDetailDirection } from "@/lib/api/transit";
import type { BusDirection } from "@/types/transit";

export interface BusDirectionSelection {
  key: string;
  subRouteUid?: string;
  subRouteName?: string;
}

export interface BusDirectionOption extends BusDirectionSelection {
  detail: RouteDetailDirection;
}

/** Missing IDs are not invented: the published stop sequence identifies the option. */
export function busDirectionOptions(
  directions: RouteDetailDirection[],
): BusDirectionOption[] {
  const options = directions.map((detail) => ({
    detail,
    subRouteUid: detail.subRouteUid,
    subRouteName: detail.subRouteName,
    key: JSON.stringify([
      detail.subRouteUid ?? null,
      detail.direction,
      ...(detail.subRouteUid
        ? []
        : [
            detail.subRouteName ?? null,
            detail.stops.map((s) => [s.seq, s.name, s.lat, s.lng]),
          ]),
    ]),
  }));
  // Byte-identical published options need no duplicate button; never merge
  // station lists of different branches or infer an upstream ID.
  return options.filter(
    (option, index) =>
      options.findIndex((other) => other.key === option.key) === index,
  );
}

export function selectBusDirection(
  options: BusDirectionOption[],
  previous: BusDirectionSelection | null,
): BusDirectionSelection | null {
  const existing = options.find((option) => option.key === previous?.key);
  if (existing)
    return {
      key: existing.key,
      subRouteUid: existing.subRouteUid,
      subRouteName: existing.subRouteName,
    };
  const anchor = previous ?? options[0];
  const branch = options.filter((option) =>
    anchor?.subRouteUid
      ? option.subRouteUid === anchor.subRouteUid
      : !option.subRouteUid && option.subRouteName === anchor?.subRouteName,
  );
  const candidates = branch.length ? branch : options;
  const chosen =
    candidates.find((option) => option.detail.direction === 0) ??
    candidates.find((option) => option.detail.direction !== 255) ??
    candidates[0];
  return chosen
    ? {
        key: chosen.key,
        subRouteUid: chosen.subRouteUid,
        subRouteName: chosen.subRouteName,
      }
    : null;
}

/** Labels are semantic TDX names, never compass or clockwise guesses. */
export function busDirectionLabel(
  direction: BusDirection,
): "outbound" | "inbound" | "busLoop" | "busCircular" | "busDirectionUnknown" {
  switch (direction) {
    case 0:
      return "outbound";
    case 1:
      return "inbound";
    case 2:
      return "busLoop";
    case 10:
      return "busCircular";
    case 255:
      return "busDirectionUnknown";
  }
}
