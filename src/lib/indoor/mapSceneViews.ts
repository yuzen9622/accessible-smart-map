import { indoorModelVersion, venueBuildingKey } from "./catalog";
import type { IndoorBuildingView, IndoorSceneProps } from "./sceneTypes";

export function indoorBuildingViews(p: IndoorSceneProps): IndoorBuildingView[] {
  return (
    p.buildingViews ?? [
      {
        key: venueBuildingKey(p.model),
        model: p.model,
        levelOrdinal: p.visibleLevels[0] ?? null,
      },
    ]
  );
}

/** Geometry keeps each model's origin. A route is displayed only in its own
 * source frame; a future independently surveyed building needs an explicit
 * route frame contract before it can share this path. */
export function buildingSceneProps(
  p: IndoorSceneProps,
  view: IndoorBuildingView,
): IndoorSceneProps {
  const activeKey = p.activeBuildingKey ?? venueBuildingKey(p.model);
  const floor = view.model.building.levels.find(
    (level) => level.ordinal === view.levelOrdinal,
  );
  const route =
    view.model.venueId === p.model.venueId &&
    indoorModelVersion(view.model) === indoorModelVersion(p.model) &&
    view.model.origin[0] === p.model.origin[0] &&
    view.model.origin[1] === p.model.origin[1]
      ? p.route
      : null;
  return {
    ...p,
    model: view.model,
    visibleLevels: floor ? [floor.ordinal] : [],
    selectedId: activeKey === view.key ? p.selectedId : null,
    focusId: activeKey === view.key ? p.focusId : null,
    route,
    grounded: true,
  };
}

/** Focus and floor changes do not recreate the shared custom layer. */
export function indoorSceneModelsKey(p: IndoorSceneProps): string {
  return JSON.stringify(
    indoorBuildingViews(p).map(({ key, model }) => [
      key,
      indoorModelVersion(model),
      model.origin,
    ]),
  );
}
