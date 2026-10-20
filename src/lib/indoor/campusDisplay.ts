import { indoorModelVersion, venueBuildingKey } from "./catalog";
import { segmentDistance } from "./route";
import type { IndoorRoute, LocalIndoorModel } from "./types";

/** One published venue revision is one geographic scene. */
export function campusModels(
  models: LocalIndoorModel[],
  active: LocalIndoorModel,
) {
  return models.filter(
    (model) =>
      model.venueId === active.venueId &&
      indoorModelVersion(model) === indoorModelVersion(active),
  );
}

export function campusLevels(models: LocalIndoorModel[]) {
  const levels = new Map<
    string,
    LocalIndoorModel["building"]["levels"][number]
  >();
  for (const model of models)
    for (const level of model.building.levels)
      if (!levels.has(level.ref)) levels.set(level.ref, level);
  return [...levels.values()].sort((a, b) => a.ordinal - b.ordinal);
}

export function defaultIndoorLevel(model: LocalIndoorModel) {
  return (
    model.building.levels.find(
      (level) =>
        level.ref === "1F" && level.coverage?.hasDisplayGeometry !== false,
    ) ??
    model.building.levels.find(
      (level) => level.coverage?.hasDisplayGeometry !== false,
    ) ??
    model.building.levels[0]
  );
}

/** Browsing synchronizes floor names. A tour crossing a bridge preserves each
 * authored endpoint's floor; a 3F→2F bridge must not become a fictitious 3F→3F.
 * This only selects display slices. Source coordinates/heights stay untouched. */
export function campusBuildingViews(
  models: LocalIndoorModel[],
  levelRef: string,
  tour?: { route: IndoorRoute; progress: number; direction: 1 | -1 },
) {
  const overrides = new Map<string, string>();
  const route = tour?.route;
  if (
    tour &&
    route?.context &&
    route.context.buildingIds.length === route.points.length &&
    route.context.levelRefs.length === route.points.length
  ) {
    const lengths = route.points
      .slice(1)
      .map((p, i) => segmentDistance(route.points[i], p));
    const total = lengths.reduce((sum, length) => sum + length, 0);
    const distance = Math.max(0, Math.min(1, tour.progress)) * total;
    let start = 0;
    for (let i = 0; i < lengths.length; i++) {
      const end = start + lengths[i];
      const inside =
        tour.direction === 1
          ? distance >= start && distance < end
          : distance > start && distance <= end;
      if (
        inside &&
        route.context.buildingIds[i] !== route.context.buildingIds[i + 1]
      ) {
        for (const index of [i, i + 1]) {
          const building = route.context.buildingIds[index],
            floor = route.context.levelRefs[index];
          if (building && floor) overrides.set(building, floor);
        }
        break;
      }
      start = end;
    }
  }
  return models.map((model) => {
    const ref = overrides.get(model.building.id) ?? levelRef;
    const level = model.building.levels.find(
      (candidate) => candidate.ref === ref,
    );
    return {
      key: venueBuildingKey(model),
      model,
      levelOrdinal:
        level && level.coverage?.hasDisplayGeometry !== false
          ? level.ordinal
          : null,
      // Route context can exist without a floor plan; never invent its rooms.
      levelRef: level?.ref ?? null,
    };
  });
}
