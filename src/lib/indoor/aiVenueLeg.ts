import { ApiError } from "@/lib/fetch";
import type { AiVenueLeg } from "@/types/route";
import { toVenuePlaceDetail } from "./catalog";
import { assembleVenueJourney, type VenueJourney } from "./journey";
import { effectiveVerticalPreference } from "./profilePolicy";
import type { LocalIndoorModel } from "./types";
import { officialRoute, type VenueDetail, venueModels } from "./venueApi";

export interface AiVenueJourney {
  journey: VenueJourney;
  /** The display models of `detail`, for the catalog when its copy is older. */
  models: LocalIndoorModel[];
}

/**
 * Present an indoor leg the AI assistant already planned. The leg passes the
 * same official-route validation as a manual backend plan (`officialRoute`);
 * nothing is replanned. `detail` is the venue as currently published, so a
 * leg planned against another version is rejected (VENUE_VERSION_CHANGED).
 * The returned journey has no outdoor part: the caller attaches the plan's
 * outdoor routes for an arrival.
 */
export function aiVenueJourney(
  detail: VenueDetail,
  leg: AiVenueLeg,
  baseUrl: string,
  language: "zh-TW" | "en" = "zh-TW",
): AiVenueJourney {
  const { route } = leg;
  const indoor = officialRoute(
    detail,
    route,
    route.fromPlaceId,
    route.toPlaceId,
    route.mode,
    language,
  );
  const models = venueModels(detail);
  // Same building choice as a manual plan: the indoor endpoint's building,
  // the destination's first. Gates are outdoors and belong to every model.
  const buildingId = [route.toPlaceId, route.fromPlaceId]
    .map((id) => detail.places.find((place) => place.id === id)?.buildingId)
    .find((id) => id != null);
  const model =
    models.find((item) => item.building.id === buildingId) ?? models[0];
  const endpoint = (placeId: string) => {
    const place = model?.places.find((item) => item.id === placeId);
    if (!model || !place)
      throw new ApiError(
        "場域資料沒有這段室內路線的起訖地點，請重新規劃。",
        502,
        "INVALID_BACKEND_DATA",
      );
    return toVenuePlaceDetail(model, place);
  };
  const from = endpoint(route.fromPlaceId);
  const to = endpoint(route.toPlaceId);
  const journey = assembleVenueJourney(
    model,
    from,
    to,
    route.mode,
    effectiveVerticalPreference(route.mode),
    indoor,
    {
      provider: "api",
      baseUrl: baseUrl.replace(/\/$/, ""),
      venueId: detail.venueId,
      venueVersion: detail.version,
      importedAt: detail.importedAt,
      localSourceSha256: model.source.sha256,
    },
  );
  return {
    journey:
      leg.direction === "departure" ? { ...journey, departure: true } : journey,
    models,
  };
}
