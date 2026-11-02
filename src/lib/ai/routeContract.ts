import type { VenueRouteResponse } from "@/lib/indoor/venueApi";
import type {
  AiIndoorRoutePlan,
  AiRoutePlan,
  AiVenueHandover,
  AiVenueLeg,
  EffectiveRoutePreferences,
} from "@/types/route";

export const AI_ROUTE_UNAVAILABLE =
  "目前無法將這份 AI 路線載入地圖，請到路線規劃頁手動規劃新行程。";
export const isRouteTool = (name: string) =>
  name === "planAccessibleRoute" ||
  name === "plan_route" ||
  name === "planIndoorRoute";
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const strings = (value: unknown) =>
  Array.isArray(value) && value.every((v) => typeof v === "string");
const geographicPoint = (value: unknown) =>
  record(value) &&
  finite(value.lat) &&
  Math.abs(value.lat) <= 90 &&
  finite(value.lng) &&
  Math.abs(value.lng) <= 180;
const point = (value: unknown) =>
  record(value) && geographicPoint(value) && typeof value.name === "string";
const roadPoint = (value: unknown) =>
  typeof value === "string" || geographicPoint(value);
const MODES = ["normal", "wheelchair", "elderly", "visual_impaired"];
const mode = (value: unknown): value is EffectiveRoutePreferences["mode"] =>
  MODES.includes(String(value));
const optionalToken = (value: unknown) =>
  value === undefined || (nonempty(value) && (value as string).length <= 256);
const coordinate = (value: unknown) =>
  Array.isArray(value) &&
  value.length === 2 &&
  finite(value[0]) &&
  Math.abs(value[0]) <= 180 &&
  finite(value[1]) &&
  Math.abs(value[1]) <= 90;

/** Validate every candidate before a single store write. Missing transit geometry
 * is represented by an empty array, never by another planning request. */
export function parseAiRoutePlan(value: unknown): AiRoutePlan {
  const fail = (): never => {
    throw new Error(AI_ROUTE_UNAVAILABLE);
  };
  if (
    !record(value) ||
    value.ok !== true ||
    value.routeContractVersion !== 1 ||
    !nonempty(value.planId) ||
    !nonempty(value.selectedRouteId) ||
    !point(value.origin) ||
    !point(value.destination) ||
    !Array.isArray(value.routes) ||
    value.routes.length === 0 ||
    !record(value.effectivePreferences)
  )
    return fail();
  const p = value.effectivePreferences;
  if (
    !mode(p.mode) ||
    !["walk", "transit", "drive", "motorcycle"].includes(
      String(p.travelMode),
    ) ||
    !["none", "bus", "rail", "metro"].includes(String(p.transitPreference)) ||
    !Number.isInteger(p.maxTransfers) ||
    (p.maxTransfers as number) < 0 ||
    typeof p.avoidStairs !== "boolean" ||
    typeof p.requireElevator !== "boolean" ||
    (p.departureTime !== undefined &&
      (typeof p.departureTime !== "string" ||
        !/(Z|[+-]\d{2}:\d{2})$/.test(p.departureTime) ||
        !Number.isFinite(Date.parse(p.departureTime))))
  )
    return fail();
  const ids = new Set<string>();
  const routes = value.routes.map((route) => {
    if (
      !record(route) ||
      !nonempty(route.routeId) ||
      ids.has(route.routeId) ||
      typeof route.routeName !== "string" ||
      !finite(route.totalMinutes) ||
      route.totalMinutes < 0 ||
      !Number.isInteger(route.transferCount) ||
      (route.transferCount as number) < 0 ||
      (route.navigationId !== undefined && !nonempty(route.navigationId)) ||
      (route.routeVersion !== undefined &&
        (!Number.isSafeInteger(route.routeVersion) ||
          (route.routeVersion as number) < 1)) ||
      !strings(route.accessibilityHighlights) ||
      !Array.isArray(route.legs) ||
      route.legs.length === 0 ||
      (route.warnings !== undefined && !strings(route.warnings)) ||
      !optionalToken(route.routeToken)
    )
      return fail();
    ids.add(route.routeId);
    const legs = route.legs.map((leg) => {
      if (
        !record(leg) ||
        ![
          "WALK",
          "BUS",
          "METRO",
          "TRA",
          "THSR",
          "DRIVE",
          "MOTORCYCLE",
        ].includes(String(leg.type))
      )
        return fail();
      if (
        leg.polyline !== undefined &&
        (!Array.isArray(leg.polyline) || !leg.polyline.every(coordinate))
      )
        return fail();
      if (leg.type === "WALK") {
        if (
          typeof leg.from !== "string" ||
          typeof leg.to !== "string" ||
          !finite(leg.distanceM)
        )
          return fail();
      } else if (leg.type === "DRIVE" || leg.type === "MOTORCYCLE") {
        if (
          !roadPoint(leg.from) ||
          !roadPoint(leg.to) ||
          !finite(leg.distanceM)
        )
          return fail();
      } else if (leg.type === "BUS") {
        if (
          !nonempty(leg.routeName) ||
          !nonempty(leg.departureStop) ||
          !nonempty(leg.arrivalStop)
        )
          return fail();
      } else if (
        !nonempty(leg.departureStation) ||
        !nonempty(leg.arrivalStation)
      )
        return fail();
      if (leg.steps !== undefined) {
        if (
          !Array.isArray(leg.steps) ||
          !leg.steps.every((step) => {
            if (!record(step) || !finite(step.distanceM) || step.distanceM < 0)
              return false;
            if (leg.type === "WALK")
              return (
                nonempty(step.relativeDirection) &&
                typeof step.streetName === "string" &&
                coordinate(step.location) &&
                typeof step.stairs === "boolean"
              );
            return (
              typeof step.instruction === "string" &&
              (step.polyline === undefined ||
                (Array.isArray(step.polyline) &&
                  step.polyline.every(coordinate)))
            );
          })
        )
          return fail();
      }
      return { ...leg, polyline: leg.polyline ?? [] };
    });
    return { ...route, legs };
  });
  if (!ids.has(value.selectedRouteId)) return fail();
  const venue = parsePlanVenue(value);
  if (venue === null) return fail();
  return {
    ...value,
    routes,
    ...(venue ? { venue } : {}),
  } as unknown as AiRoutePlan;
}

/** Wire shape only; officialRoute validates the path against the venue. */
function venueRoute(value: unknown): value is VenueRouteResponse {
  return (
    record(value) &&
    nonempty(value.venueId) &&
    Number.isSafeInteger(value.venueVersion) &&
    mode(value.mode) &&
    nonempty(value.fromPlaceId) &&
    nonempty(value.toPlaceId) &&
    finite(value.distanceM) &&
    finite(value.durationS) &&
    record(value.path) &&
    Array.isArray(value.path.coordinates) &&
    Array.isArray(value.segments) &&
    Array.isArray(value.steps) &&
    value.steps.length > 0
  );
}

function venueHandover(value: unknown): value is AiVenueHandover {
  return (
    record(value) &&
    nonempty(value.venueId) &&
    nonempty(value.placeId) &&
    nonempty(value.gateId) &&
    geographicPoint(value.gateLocation) &&
    mode(value.mode) &&
    Number.isSafeInteger(value.venueVersion)
  );
}

/** `undefined` = an outdoor-only plan; `null` = malformed venue fields. The
 * backend sends at most one hand-over, and its leg must join that gate. */
function parsePlanVenue(
  value: Record<string, unknown>,
): AiVenueLeg | undefined | null {
  const arrival =
    value.venueArrival !== undefined || value.venueLeg !== undefined;
  const departure =
    value.venueDeparture !== undefined || value.venueDepartureLeg !== undefined;
  if (!arrival && !departure) return undefined;
  if (arrival && departure) return null;
  const handover = arrival ? value.venueArrival : value.venueDeparture;
  const route = arrival ? value.venueLeg : value.venueDepartureLeg;
  if (
    !venueHandover(handover) ||
    !venueRoute(route) ||
    route.venueId !== handover.venueId ||
    route.venueVersion !== handover.venueVersion ||
    route.mode !== handover.mode ||
    (arrival
      ? route.fromPlaceId !== handover.gateId ||
        route.toPlaceId !== handover.placeId
      : route.fromPlaceId !== handover.placeId ||
        route.toPlaceId !== handover.gateId)
  )
    return null;
  return { direction: arrival ? "arrival" : "departure", handover, route };
}

/** `planIndoorRoute`: exactly one navigable route with no outdoor legs. */
export function parseAiIndoorRoutePlan(value: unknown): AiIndoorRoutePlan {
  const fail = (): never => {
    throw new Error(AI_ROUTE_UNAVAILABLE);
  };
  if (
    !record(value) ||
    value.ok !== true ||
    !nonempty(value.venueId) ||
    !mode(value.mode) ||
    !nonempty(value.selectedRouteId) ||
    !venueRoute(value.venueLeg) ||
    value.venueLeg.venueId !== value.venueId ||
    value.venueLeg.mode !== value.mode ||
    !Array.isArray(value.routes) ||
    value.routes.length !== 1
  )
    return fail();
  const route = value.routes[0];
  if (
    !record(route) ||
    route.routeId !== value.selectedRouteId ||
    typeof route.routeName !== "string" ||
    !finite(route.totalMinutes) ||
    route.totalMinutes < 0 ||
    route.transferCount !== 0 ||
    !Array.isArray(route.legs) ||
    route.legs.length !== 0 ||
    !strings(route.accessibilityHighlights) ||
    !optionalToken(route.routeToken) ||
    (route.navigationId !== undefined && !nonempty(route.navigationId)) ||
    (route.routeVersion !== undefined &&
      (!Number.isSafeInteger(route.routeVersion) ||
        (route.routeVersion as number) < 1))
  )
    return fail();
  return {
    venueId: value.venueId,
    mode: value.mode,
    selectedRouteId: value.selectedRouteId,
    route: route as unknown as AiIndoorRoutePlan["route"],
    venue: { direction: "indoor", route: value.venueLeg },
  };
}
