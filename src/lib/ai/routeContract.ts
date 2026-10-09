import type { AiRoutePlan } from "@/types/route";

export const AI_ROUTE_UNAVAILABLE =
  "目前無法將這份 AI 路線載入地圖，請到路線規劃頁手動規劃新行程。";
export const isRouteTool = (name: string) =>
  name === "planAccessibleRoute" || name === "plan_route";
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const strings = (value: unknown) =>
  Array.isArray(value) && value.every((v) => typeof v === "string");
const point = (value: unknown) =>
  record(value) &&
  finite(value.lat) &&
  Math.abs(value.lat) <= 90 &&
  finite(value.lng) &&
  Math.abs(value.lng) <= 180 &&
  typeof value.name === "string";
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
    !["normal", "wheelchair", "elderly", "visual_impaired"].includes(
      String(p.mode),
    ) ||
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
      (route.routeToken !== undefined &&
        (!nonempty(route.routeToken) || route.routeToken.length > 256))
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
      if (
        leg.type === "WALK" ||
        leg.type === "DRIVE" ||
        leg.type === "MOTORCYCLE"
      ) {
        if (
          typeof leg.from !== "string" ||
          typeof leg.to !== "string" ||
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
  return { ...value, routes } as unknown as AiRoutePlan;
}
