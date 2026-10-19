import type { VenuePlaceDetail } from "@/types";
import { localToLngLat } from "./coordinates";
import { routeEndpointFeatureIds } from "./routePresentation";
import type { IndoorFeature, IndoorPlace, LocalIndoorModel } from "./types";

export function venueBuildingKey(model: LocalIndoorModel): string {
  return `${model.venueId}/${model.building.id}`;
}

/** Published revisions are independent of the source file's content hash. */
export function indoorModelVersion(model: LocalIndoorModel): string {
  return model.api
    ? `${model.venueId}:${model.api.version}`
    : model.source.sha256;
}

export function toVenuePlaceDetail(
  model: LocalIndoorModel,
  place: IndoorPlace,
): VenuePlaceDetail {
  const [lng, lat] = localToLngLat(
    [place.point[0], place.point[1]],
    model.origin,
  );
  const buildingId =
    place.buildingId === undefined
      ? place.levelRef === null
        ? null
        : model.building.id
      : place.buildingId;
  const buildingName =
    buildingId === model.building.id ? model.building.name : "校園戶外";
  return {
    kind: "venue-place",
    name: place.name,
    address: [buildingName, place.levelRef, place.name]
      .filter(Boolean)
      .join(" · "),
    position: { lat, lng },
    venueId: model.venueId,
    buildingId,
    buildingName,
    levelRef: place.levelRef,
    placeId: place.id,
    sourceVersion: indoorModelVersion(model),
    dataSource: model.api ? "api" : "local",
    arrivalKind: place.routeEndpoint,
  };
}

export function findVenueModel(
  models: LocalIndoorModel[],
  place: VenuePlaceDetail,
) {
  return models.find(
    (model) =>
      model.venueId === place.venueId &&
      (!place.buildingId || model.building.id === place.buildingId) &&
      model.places.some((candidate) => candidate.id === place.placeId),
  );
}

/** Refresh saved metadata only when the same scoped graph place still exists. */
export function refreshVenuePlace(
  models: LocalIndoorModel[],
  saved: VenuePlaceDetail,
): VenuePlaceDetail | null {
  const model = findVenueModel(models, saved);
  const place = model?.places.find(
    (item) => item.id === saved.placeId && item.levelRef === saved.levelRef,
  );
  if (!model || !place) return null;
  const current = toVenuePlaceDetail(model, place);
  return current.buildingId === saved.buildingId ? current : null;
}

export function featureForVenuePlace(model: LocalIndoorModel, placeId: string) {
  const id = routeEndpointFeatureIds(model, {
    fromPlaceId: placeId,
    toPlaceId: placeId,
  }).fromFeatureId;
  return model.features.find((feature) => feature.id === id);
}

/** Match identity or a unique label on this floor, never proximity to a room. */
export function placeForVenueFeature(
  model: LocalIndoorModel,
  feature: IndoorFeature,
) {
  const candidates = model.places.filter(
    (place) =>
      place.levelRef === feature.levelRef &&
      (place.buildingId === undefined
        ? model.building.id
        : place.buildingId) ===
        (feature.buildingId === undefined
          ? model.building.id
          : feature.buildingId),
  );
  const linked = candidates.filter((place) => place.featureId === feature.id);
  if (linked.length) return linked.length === 1 ? linked[0] : undefined;
  // An explicit source association must not be reassigned by a matching label.
  const unlinked = candidates.filter((place) => !place.featureId);
  const exact = unlinked.filter(
    (place) =>
      place.id === feature.id || feature.tags["a11ymap:id"] === place.id,
  );
  if (exact.length === 1) return exact[0];
  if (feature.connectionId) {
    const connections = unlinked.filter(
      (place) =>
        place.connectionId === feature.connectionId ||
        place.connectionIds?.includes(feature.connectionId as string),
    );
    if (connections.length === 1) return connections[0];
  }
  if (feature.kind !== "room") return undefined;
  const named = unlinked.filter((place) =>
    feature.ref
      ? place.ref === feature.ref
      : feature.name && place.name === feature.name,
  );
  return named.length === 1 ? named[0] : undefined;
}

export function searchVenuePlaces(
  models: LocalIndoorModel[],
  query: string,
): VenuePlaceDetail[] {
  const normalize = (text: string) =>
    text.trim().normalize("NFKC").toLocaleLowerCase();
  const normalized = normalize(query);
  if (!normalized) return [];
  const terms = normalized.split(/\s+/);
  const seen = new Set<string>();
  return models
    .flatMap((model) =>
      model.places
        .filter(
          (place) =>
            !model.api ||
            place.buildingId === null ||
            place.buildingId === model.building.id,
        )
        .map((place) => ({ model, place })),
    )
    .filter(({ model, place }) => {
      const buildingId =
        place.buildingId === undefined ? model.building.id : place.buildingId;
      const identity = `${model.venueId}/${buildingId}/${place.levelRef}/${place.id}`;
      if (seen.has(identity)) return false;
      seen.add(identity);
      const haystack = [
        model.name,
        model.building.name,
        ...(model.building.aliases ?? []),
        place.name,
        place.ref,
        place.levelRef,
      ]
        .filter(Boolean)
        .join(" ")
        .normalize("NFKC")
        .toLocaleLowerCase();
      return terms.every((term) => haystack.includes(term));
    })
    .sort(
      (a, b) =>
        Number(
          normalize(b.place.ref ?? "") === normalized ||
            normalize(b.place.name) === normalized,
        ) -
          Number(
            normalize(a.place.ref ?? "") === normalized ||
              normalize(a.place.name) === normalized,
          ) ||
        (a.place.levelRef ?? "").localeCompare(
          b.place.levelRef ?? "",
          undefined,
          { numeric: true },
        ) ||
        a.place.name.localeCompare(b.place.name, "zh-TW", { numeric: true }),
    )
    .slice(0, 24)
    .map(({ model, place }) => toVenuePlaceDetail(model, place));
}

/** The local companion is a separate provider, not a claim about deployed venue APIs. */
export function isLocalIndoorModel(value: unknown): value is LocalIndoorModel {
  if (!value || typeof value !== "object") return false;
  const model = value as LocalIndoorModel;
  return (
    model.schemaVersion === 1 &&
    typeof model.venueId === "string" &&
    typeof model.source?.sha256 === "string" &&
    typeof model.building?.id === "string" &&
    Array.isArray(model.origin) &&
    model.origin.length === 2 &&
    model.origin.every(Number.isFinite) &&
    Array.isArray(model.building.levels) &&
    model.building.levels.length > 0 &&
    Array.isArray(model.features) &&
    Array.isArray(model.places) &&
    Array.isArray(model.nodes) &&
    Array.isArray(model.edges) &&
    Array.isArray(model.connections)
  );
}
