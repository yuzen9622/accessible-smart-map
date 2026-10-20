import { getAccessibleRoute } from "@/lib/api/a11y";
import { END_POINT } from "@/lib/config";
import { haversineMeters } from "@/lib/geo";
import type { PlaceDetail, VenuePlaceDetail } from "@/types";
import type { AccessibleRoute } from "@/types/route";
import { routeReachesArrival, routeStartsAtOrigin } from "./arrival";
import {
  findVenueModel,
  indoorModelVersion,
  refreshVenuePlace,
  toVenuePlaceDetail,
} from "./catalog";
import { effectiveVerticalPreference } from "./profilePolicy";

export { routeReachesArrival } from "./arrival";

import { planBackendVenueRoute } from "./backendRoute";
import {
  assembleVenueJourney,
  buildVenueJourney,
  type VenueJourney,
} from "./journey";
import type { IndoorVerticalPreference, LocalIndoorModel } from "./types";

export interface PlanVenueJourneyOptions {
  models: LocalIndoorModel[];
  routeProvider?: "local" | "backend";
  origin: PlaceDetail;
  destination: PlaceDetail;
  mode: "normal" | "wheelchair" | "elderly" | "visual_impaired";
  verticalPreference?: IndoorVerticalPreference;
  travelMode?: "walk" | "transit" | "drive" | "motorcycle";
  language?: "zh-TW" | "en";
  signal?: AbortSignal;
}
export type PlanVenueJourneyResult =
  | { ok: true; journey: VenueJourney; refreshedModels?: LocalIndoorModel[] }
  | {
      ok: false;
      reason: string;
      message: string;
      refreshedModels?: LocalIndoorModel[];
    };

const stairsConstraintWarnings = new Set([
  "ROUTE_STAIRS_CONSTRAINT_UNSATISFIED",
  "STAIRS_CONSTRAINT_UNSATISFIED",
  // Older backend responses only carried the shared, localized warning text.
  "目前候選路線仍包含無坡道樓梯，無法完全滿足避開樓梯條件",
  "The current candidate route still includes stairs without a ramp, so the avoid-stairs constraint is not fully met.",
]);

function outdoorStairEvidence(
  route: AccessibleRoute,
): "stairs" | "unknown" | "clear" {
  if (
    route.warningDetails?.some((warning) =>
      stairsConstraintWarnings.has(warning.code),
    ) ||
    route.warnings?.some((warning) => stairsConstraintWarnings.has(warning)) ||
    route.legs.some(
      (leg) =>
        leg.type === "WALK" && leg.steps?.some((step) => step.stairs === true),
    )
  )
    return "stairs";
  const walking = route.legs
    .filter((leg) => leg.type === "WALK")
    .filter(
      (leg) =>
        leg.distanceM !== 0 || leg.polyline.length > 1 || !!leg.steps?.length,
    );
  if (
    walking.some(
      (leg) =>
        !leg.steps?.length || leg.steps.some((step) => step.stairs !== false),
    )
  )
    return "unknown";
  return "clear";
}

export async function planVenueJourney(
  options: PlanVenueJourneyOptions,
): Promise<PlanVenueJourneyResult> {
  const initial = await planVenueJourneyOnce(options);
  if (
    initial.ok ||
    initial.reason !== "VENUE_VERSION_CHANGED" ||
    !initial.refreshedModels ||
    options.signal?.aborted
  )
    return initial;
  const refreshed = initial.refreshedModels;
  const venueIds = new Set(refreshed.map((model) => model.venueId));
  const models = [
    ...options.models.filter((model) => !venueIds.has(model.venueId)),
    ...refreshed,
  ];
  const origin =
    options.origin.kind === "venue-place"
      ? refreshVenuePlace(models, options.origin)
      : options.origin;
  const destination =
    options.destination.kind === "venue-place"
      ? refreshVenuePlace(models, options.destination)
      : options.destination;
  if (!origin || !destination)
    return {
      ok: false,
      reason: "UNSUPPORTED_API_PLACE",
      message: "更新後的圖資已無原地點或樓層，請重新選擇。",
      refreshedModels: models,
    };
  const result = await planVenueJourneyOnce({
    ...options,
    models,
    origin,
    destination,
  });
  return { ...result, refreshedModels: result.refreshedModels ?? models };
}

async function planVenueJourneyOnce(
  options: PlanVenueJourneyOptions,
): Promise<PlanVenueJourneyResult> {
  const cancelled = (): PlanVenueJourneyResult => ({
    ok: false,
    reason: "ABORTED",
    message: "已取消這次規劃，起終點與選項已保留。",
  });
  if (options.signal?.aborted) return cancelled();
  const {
    models,
    origin,
    destination,
    mode,
    travelMode = "walk",
    language = "zh-TW",
  } = options;
  const verticalPreference = effectiveVerticalPreference(
    mode,
    options.verticalPreference,
  );
  const venueEndpoint =
    destination.kind === "venue-place"
      ? destination
      : origin.kind === "venue-place"
        ? origin
        : null;
  const model = venueEndpoint && findVenueModel(models, venueEndpoint);
  if (!model)
    return {
      ok: false,
      reason: "UNKNOWN_VENUE",
      message: "找不到此地點的場域資料，請重新搜尋選擇。",
    };
  const buildJourney = async (
    from: VenuePlaceDetail,
    to: VenuePlaceDetail,
  ): Promise<PlanVenueJourneyResult> => {
    if (!model.api && options.routeProvider !== "backend")
      return buildVenueJourney(model, from, to, mode, verticalPreference);
    const result = await planBackendVenueRoute({
      baseUrl: END_POINT,
      model,
      from,
      to,
      mode,
      verticalPreference,
      language,
      signal: options.signal,
    });
    if (!result.ok) return result;
    return {
      ok: true,
      journey: assembleVenueJourney(
        model,
        from,
        to,
        mode,
        verticalPreference,
        result.route,
        result.provenance,
      ),
    };
  };
  if (origin.kind === "venue-place" && destination.kind === "venue-place")
    return buildJourney(origin, destination);
  if (destination.kind !== "venue-place")
    return {
      ok: false,
      reason: "UNSUPPORTED_DIRECTION",
      message:
        "目前尚未提供從教室接往校外目的地的完整路線。可先選擇校門為終點，再規劃校外行程。",
    };
  if (!model.api && destination.sourceVersion !== indoorModelVersion(model))
    return {
      ok: false,
      reason: "STALE_SOURCE",
      message: "場域資料已更新，請重新選擇目的地。",
    };
  // The source explicitly nominates its public arrival gates. Never snap a GPS
  // location to the nearest indoor graph node or substitute the user's origin.
  const gateIds = new Set(model.preview?.gatePlaceIds ?? []);
  const gateResults = await Promise.all(
    model.places
      .filter(
        (place) =>
          gateIds.has(place.id) &&
          place.levelRef === null &&
          place.buildingId === null,
      )
      .map(async (place) => {
        const arrival = toVenuePlaceDetail(model, place);
        return { arrival, result: await buildJourney(arrival, destination) };
      }),
  );
  if (options.signal?.aborted) return cancelled();
  const candidates = gateResults
    .flatMap(({ arrival, result }) =>
      result.ok
        ? [
            {
              arrival,
              journey: result.journey,
              score:
                haversineMeters(origin.position, arrival.position) +
                result.journey.route.distanceM,
            },
          ]
        : [],
    )
    .sort((a, b) => a.score - b.score);
  if (!candidates.length) {
    const failure = gateResults.find(({ result }) => !result.ok)?.result;
    // A failed backend call must not silently fall back to locally chosen paths.
    if (
      failure &&
      !failure.ok &&
      (model.api || options.routeProvider === "backend")
    )
      return failure;
    return {
      ok: false,
      reason:
        mode === "wheelchair" ? "NO_ACCESSIBLE_ROUTE" : "NO_GATE_CONNECTION",
      message:
        mode === "wheelchair"
          ? "目前沒有從已確認校門通往目的地的輪椅路線；不會改用樓梯。"
          : "目前來源資料沒有連通校門與目的地。請選擇已知館外接點或室內地點規劃。",
    };
  }
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  if (options.signal?.aborted) abortFromCaller();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 15_000);
  const requestCandidate = async (
    candidate: (typeof candidates)[number],
  ): Promise<PlanVenueJourneyResult> => {
    const response = await getAccessibleRoute(
      {
        origin: {
          latitude: origin.position.lat,
          longitude: origin.position.lng,
        },
        destination: {
          latitude: candidate.arrival.position.lat,
          longitude: candidate.arrival.position.lng,
        },
        mode,
        travelMode,
        language,
      },
      controller.signal,
    );
    if (options.signal?.aborted) return cancelled();
    if (!response.ok || !response.data?.routes?.length)
      return {
        ok: false,
        reason: "OUTDOOR_UNAVAILABLE",
        message:
          "目前無法取得前往校門的室外路線。起終點與交通方式已保留，請稍後重試。",
      };
    const approachRoutes: Record<string, AccessibleRoute> = {};
    const arrivals = await Promise.allSettled(
      response.data.routes.map(async (route) => {
        if (routeReachesArrival(route, candidate.arrival.position))
          return route;
        const lastLeg = route.legs.filter((leg) => leg.polyline?.length).at(-1);
        const end = lastLeg?.polyline.at(-1);
        // Outdoor providers can stop short of the authored gate even when the
        // final leg is WALK. Keep the real connecting path and its own token.
        if (
          !route.routeToken ||
          !end ||
          end.length < 2 ||
          !end?.every(Number.isFinite) ||
          Math.abs(end[0]) > 180 ||
          Math.abs(end[1]) > 90 ||
          (lastLeg?.type !== "DRIVE" &&
            lastLeg?.type !== "MOTORCYCLE" &&
            lastLeg?.type !== "WALK")
        )
          return null;
        const start = { lat: end[1], lng: end[0] };
        const response = await getAccessibleRoute(
          {
            origin: { latitude: start.lat, longitude: start.lng },
            destination: {
              latitude: candidate.arrival.position.lat,
              longitude: candidate.arrival.position.lng,
            },
            mode,
            travelMode: "walk",
            language,
          },
          controller.signal,
        );
        const approach = response.data?.routes?.find(
          (walk) =>
            walk.routeToken &&
            walk.legs.every((leg) => leg.type === "WALK") &&
            routeStartsAtOrigin(walk, start, 2) &&
            routeReachesArrival(walk, candidate.arrival.position) &&
            (mode !== "wheelchair" || outdoorStairEvidence(walk) === "clear"),
        );
        if (!response.ok || !approach) return null;
        approachRoutes[route.routeToken] = approach;
        return route;
      }),
    );
    if (options.signal?.aborted) return cancelled();
    const arrivalRoutes = arrivals.flatMap((result) =>
      result.status === "fulfilled" && result.value ? [result.value] : [],
    );
    if (!arrivalRoutes.length)
      return {
        ok: false,
        reason: "ARRIVAL_GAP",
        message:
          "室外路線尚未接到已確認的校門位置，無法提供連續導航。起終點與交通方式已保留，請稍後重試。",
      };
    const connectedRoutes = arrivalRoutes.filter((route) =>
      // A selected address/GPS point may be off the public road. Allow a nearby
      // road start, disclosed by the result and navigation UI; this is NOT a
      // verified connector. Gate and inter-route continuity stay at 2 metres.
      routeStartsAtOrigin(route, origin.position, 50),
    );
    if (!connectedRoutes.length)
      return {
        ok: false,
        reason: "START_GAP",
        message:
          "室外路線尚未連上你選擇的起點，無法提供連續導航。起終點與選項已保留，請確認起點所在位置後重試。",
      };
    const routes =
      mode === "wheelchair"
        ? connectedRoutes.filter(
            (route) => outdoorStairEvidence(route) === "clear",
          )
        : connectedRoutes;
    if (!routes.length) {
      const allContainStairs = connectedRoutes.every(
        (route) => outdoorStairEvidence(route) === "stairs",
      );
      return {
        ok: false,
        reason: allContainStairs
          ? "WHEELCHAIR_STAIRS"
          : "NO_ACCESSIBLE_OUTDOOR_ROUTE",
        message: allContainStairs
          ? "目前室外候選路線都包含樓梯，無法提供輪椅行程。起終點與選項已保留；請稍後重試。"
          : "室外步行段缺少足夠樓梯資訊，無法確認輪椅通行。起終點與選項已保留，請稍後重試。",
      };
    }
    return {
      ok: true,
      journey: {
        ...candidate.journey,
        outdoor: {
          origin,
          travelMode,
          approachRoutes,
          phase: "travel",
          routes,
          selectedIndex: 0,
          arrival: candidate.arrival,
        },
      },
    };
  };
  try {
    // Check every authored arrival in parallel under one deadline. A gate that
    // cannot be reached must not hide another valid, continuous connection.
    const results = await Promise.allSettled(candidates.map(requestCandidate));
    if (options.signal?.aborted) return cancelled();
    const successes = results.flatMap((result) =>
      result.status === "fulfilled" && result.value.ok ? [result.value] : [],
    );
    successes.sort((a, b) => {
      const duration = (journey: VenueJourney) => {
        const outdoor = journey.outdoor;
        const route = outdoor?.routes[0];
        const approach = route?.routeToken
          ? outdoor?.approachRoutes?.[route.routeToken]
          : undefined;
        return (
          (route?.totalMinutes ?? 0) +
          (approach?.totalMinutes ?? 0) +
          journey.route.distanceM / 60
        );
      };
      return duration(a.journey) - duration(b.journey);
    });
    if (successes.length) return successes[0];
    if (timedOut) throw new Error("Outdoor deadline");
    const failures = results.flatMap((result) =>
      result.status === "fulfilled" && !result.value.ok ? [result.value] : [],
    );
    // Report the most advanced candidate's actual blocker. A different gate's
    // missing connection must not conceal a shared origin/accessibility issue.
    const failure =
      failures.find((result) =>
        ["WHEELCHAIR_STAIRS", "NO_ACCESSIBLE_OUTDOOR_ROUTE"].includes(
          result.reason,
        ),
      ) ??
      failures.find((result) => result.reason === "START_GAP") ??
      failures.find((result) => result.reason === "ARRIVAL_GAP") ??
      failures[0];
    if (failure) return failure;
    throw new Error("Outdoor unavailable");
  } catch {
    if (options.signal?.aborted) return cancelled();
    if (timedOut)
      return {
        ok: false,
        reason: "OUTDOOR_TIMEOUT",
        message:
          "室外路線服務超過 15 秒未回應，起終點與選項已保留。請稍後重試。",
      };
    return {
      ok: false,
      reason: "OUTDOOR_UNAVAILABLE",
      message: "室外路線服務目前無法連線，起終點已保留。請稍後重試。",
    };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}
