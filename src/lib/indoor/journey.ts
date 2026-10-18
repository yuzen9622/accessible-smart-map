import type { TFunction } from "i18next";
import zhTW from "@/i18n/locale/zh-TW/translation.json";
import type { PlaceDetail, VenuePlaceDetail } from "@/types";
import type { AccessibleRoute } from "@/types/route";
import type { BackendRouteProvenance } from "./backendRoute";
import { indoorModelVersion } from "./catalog";
import { effectiveVerticalPreference } from "./profilePolicy";
import { pathDistance, planIndoorRoute, segmentDistance } from "./route";
import type {
  IndoorMode,
  IndoorRoute,
  IndoorRouteStep,
  IndoorVerticalPreference,
  LocalIndoorModel,
} from "./types";

/** One route session; the catalog owns only the map's current building/view. */
export interface VenueJourney {
  id: string;
  venueId: string;
  buildingId: string;
  sourceVersion: string;
  backendRoute?: BackendRouteProvenance;
  from: VenuePlaceDetail;
  to: VenuePlaceDetail;
  mode: IndoorMode;
  verticalPreference: IndoorVerticalPreference;
  route: IndoorRoute;
  preview: {
    progress: number;
    playing: boolean;
    direction: 1 | -1;
    following?: boolean;
  };
  guidance: {
    status: "idle" | "outdoor" | "touring" | "guiding" | "arrived";
    stepIndex: number;
  };
  /** Real outdoor results only. The venue path begins at this known arrival. */
  outdoor?: {
    origin: PlaceDetail;
    travelMode?: "walk" | "transit" | "drive" | "motorcycle";
    /** Separate provider tokens: finish the vehicle route, then walk to the gate. */
    approachRoutes?: Record<string, AccessibleRoute>;
    phase?: "travel" | "approach";
    routes: AccessibleRoute[];
    selectedIndex: number;
    /** The primary actually started; preview selection must not replace its tail. */
    navigationIndex?: number;
    arrival: VenuePlaceDetail;
  };
}

export type VenueJourneyResult =
  | { ok: true; journey: VenueJourney }
  | {
      ok: false;
      reason:
        | "UNSUPPORTED_CONTEXT"
        | "STALE_SOURCE"
        | "UNKNOWN_PLACE"
        | "NO_ROUTE"
        | "NO_ACCESSIBLE_ROUTE";
      message: string;
    };

export function buildVenueJourney(
  model: LocalIndoorModel,
  from: VenuePlaceDetail,
  to: VenuePlaceDetail,
  mode: IndoorMode,
  verticalPreference: IndoorVerticalPreference = "auto",
): VenueJourneyResult {
  const endpoints = [from, to];
  if (
    endpoints.some(
      (p) =>
        p.dataSource !== "local" ||
        p.venueId !== model.venueId ||
        (p.buildingId !== null && p.buildingId !== model.building.id),
    )
  )
    return {
      ok: false,
      reason: "UNSUPPORTED_CONTEXT",
      message:
        "目前資料尚未提供這兩個地點之間的完整接續路線，請選擇已載入的同一場域地點。",
    };
  if (endpoints.some((p) => p.sourceVersion !== model.source.sha256))
    return {
      ok: false,
      reason: "STALE_SOURCE",
      message: "場域資料已更新，請重新選擇起點與終點。",
    };
  if (
    endpoints.some((endpoint) => {
      const place = model.places.find((p) => p.id === endpoint.placeId);
      return (
        !place ||
        place.levelRef !== endpoint.levelRef ||
        (endpoint.buildingId === null && place.levelRef !== null)
      );
    })
  )
    return {
      ok: false,
      reason: "UNKNOWN_PLACE",
      message: "找不到這個樓層上的來源到達點，請重新選擇地點。",
    };
  const preference = effectiveVerticalPreference(mode, verticalPreference);
  const result = planIndoorRoute(model, from.placeId, to.placeId, mode, {
    verticalPreference: preference,
  });
  if (!result.ok)
    return {
      ...result,
      message:
        result.reason === "NO_ACCESSIBLE_ROUTE"
          ? "找不到符合此模式的電梯與通路；不會改用樓梯。"
          : "來源路網尚未連通這兩個地點，無法提供完整路線。",
    };
  return {
    ok: true,
    journey: assembleVenueJourney(model, from, to, mode, preference, result),
  };
}

/** Assemble the UI session from the selected provider's validated route. */
export function assembleVenueJourney(
  model: LocalIndoorModel,
  from: VenuePlaceDetail,
  to: VenuePlaceDetail,
  mode: IndoorMode,
  preference: IndoorVerticalPreference,
  route: IndoorRoute,
  backendRoute?: BackendRouteProvenance,
): VenueJourney {
  return {
    id: JSON.stringify([
      model.venueId,
      model.building.id,
      indoorModelVersion(model),
      from.placeId,
      to.placeId,
      mode,
      preference,
      ...(backendRoute
        ? [
            backendRoute.provider,
            backendRoute.baseUrl,
            backendRoute.venueVersion,
          ]
        : []),
    ]),
    venueId: model.venueId,
    buildingId: model.building.id,
    sourceVersion: indoorModelVersion(model),
    from: { ...from },
    to: { ...to },
    mode,
    verticalPreference: preference,
    route,
    ...(backendRoute ? { backendRoute } : {}),
    preview: { progress: 0, playing: false, direction: 1, following: true },
    guidance: { status: "idle", stepIndex: 0 },
  };
}

/** Manual confirmations never depend on selected floors or preview animation. */
export function advanceVenueJourney(journey: VenueJourney): VenueJourney {
  if (journey.guidance.status !== "guiding") return journey;
  const next = journey.guidance.stepIndex + 1;
  return {
    ...journey,
    guidance:
      next >= journey.route.steps.length
        ? { status: "arrived", stepIndex: journey.route.steps.length }
        : { status: "guiding", stepIndex: next },
  };
}

export function venueJourneyPresentation(journey: VenueJourney): {
  progress: number;
  direction: 1 | -1;
} {
  const { status, stepIndex } = journey.guidance;
  if (status === "idle" || status === "outdoor" || status === "touring")
    return journey.preview;
  if (status === "arrived") return { progress: 1, direction: 1 };
  const index = journey.route.steps[stepIndex]?.startIndex ?? 0;
  const total = pathDistance(journey.route.points);
  const travelled = journey.route.points
    .slice(1, index + 1)
    .reduce(
      (sum, point, i) => sum + segmentDistance(journey.route.points[i], point),
      0,
    );
  return { progress: total ? travelled / total : 0, direction: 1 };
}

type JourneyTextKey = Extract<keyof typeof zhTW, `venue${string}`>;

/** Standalone callers retain Chinese without initializing client i18n or React. */
function journeyText(
  key: JourneyTextKey,
  t?: TFunction,
  values: Record<string, string | number> = {},
): string {
  if (t) return t(key, values);
  return zhTW[key].replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    values[name] === undefined ? match : String(values[name]),
  );
}

// Only generic router defaults are translated. Authored names and floor refs
// remain source text; this does not invent English names for campus facilities.
const genericStepNames = new Map<string, JourneyTextKey>([
  ["電梯", "venueGenericElevator"],
  ["搭乘電梯", "venueGenericElevator"],
  ["樓梯", "venueGenericStairs"],
  ["沿樓梯行進", "venueGenericStairs"],
  ["電扶梯", "venueGenericEscalator"],
  ["坡道", "venueGenericRamp"],
  ["沿坡道行進", "venueGenericRamp"],
  ["公共通路", "venueGenericPassage"],
  ["公共走廊", "venueGenericCorridor"],
  ["沿公共走廊行進", "venueGenericCorridor"],
]);

export function venueJourneyStepLabel(
  step: IndoorRouteStep,
  t?: TFunction,
): string {
  if (step.instruction) return step.instruction;
  const genericName = genericStepNames.get(step.name);
  const name = genericName ? journeyText(genericName, t) : step.name;
  if (step.kind === "elevator")
    return journeyText("venueStepElevator", t, {
      name,
      floor: step.toLevel ?? journeyText("venueDestinationFloor", t),
    });
  if (step.kind === "steps" || step.kind === "escalator") {
    const ordinal = (ref: string | null): number | null => {
      const above = ref?.match(/^(-?\d+)F$/i);
      if (above) return Number(above[1]);
      const basement = ref?.match(/^B(\d+)F?$/i);
      return basement ? -Number(basement[1]) : null;
    };
    const from = ordinal(step.fromLevel),
      to = ordinal(step.toLevel);
    if (from !== null && to !== null && from !== to)
      return journeyText(to > from ? "venueStepUp" : "venueStepDown", t, {
        name,
        floor: step.toLevel as string,
      });
    return journeyText("venueStepVia", t, {
      name,
      floor: step.toLevel ?? journeyText("venueNextSection", t),
    });
  }
  if (step.kind === "ramp") return journeyText("venueStepRamp", t, { name });
  return step.fromLevel
    ? journeyText("venueStepOnFloor", t, { floor: step.fromLevel, name })
    : name;
}

export function venueJourneyConfirmLabel(
  journey: VenueJourney,
  t?: TFunction,
): string {
  const step = journey.route.steps[journey.guidance.stepIndex];
  if (step?.fromLevel === null && step.toLevel !== null)
    return journeyText("venueConfirmEntry", t, {
      building: step.buildingName ?? journey.to.buildingName,
      floor: step.toLevel,
    });
  if (
    step?.toLevel &&
    step.fromLevel !== step.toLevel &&
    ["steps", "elevator", "escalator", "ramp"].includes(step.kind)
  )
    return journeyText("venueConfirmFloor", t, { floor: step.toLevel });
  if (journey.guidance.stepIndex >= journey.route.steps.length - 1)
    return journey.to.arrivalKind === "corridor"
      ? journeyText("venueConfirmCorridor", t)
      : journeyText("venueConfirmDestination", t);
  if (journey.guidance.stepIndex === 0 && journey.from.buildingId === null)
    return journeyText("venueConfirmEntranceSection", t);
  return journeyText("venueConfirmSection", t);
}
