import { samplePath, segmentDistance } from "./route";
import type {
  IndoorFeature,
  IndoorPlace,
  IndoorRoute,
  IndoorRoutePresentation,
  LocalIndoorModel,
} from "./types";

/**
 * Progress is the original path's absolute fraction in both directions.
 * Direction changes floor/step semantics only, never the displayed position.
 */
export function sampleRoutePresentation(
  model: LocalIndoorModel,
  route: IndoorRoute,
  progress: number,
  direction: 1 | -1,
): IndoorRoutePresentation {
  const position = samplePath(route.points, progress);
  const fraction = Math.min(1, Math.max(0, progress));
  const from = model.places.find((place) => place.id === route.fromPlaceId);
  const to = model.places.find((place) => place.id === route.toPlaceId);
  const endpointLevel = (atEnd: boolean) => {
    const place = atEnd ? to : from;
    // An explicit outdoor/null place must not inherit its graph node's floor.
    if (place) return place.levelRef;
    return atEnd
      ? (route.steps[route.steps.length - 1]?.toLevel ?? null)
      : (route.steps[0]?.fromLevel ?? null);
  };
  const contextAt = (index: number) => ({
    currentBuildingId: route.context?.buildingIds[index] ?? null,
    currentLevelRef: route.context?.levelRefs[index] ?? null,
  });
  const complete = direction === 1 ? fraction === 1 : fraction === 0;
  if (complete) {
    const currentLevelRef = endpointLevel(direction === 1);
    return {
      position,
      currentLevelRef,
      currentBuildingId: currentLevelRef === null ? null : model.building.id,
      ...(route.context
        ? contextAt(direction === 1 ? route.points.length - 1 : 0)
        : {}),
      activeConnectionId: null,
      transition: null,
    };
  }

  const distances = [0];
  for (let i = 1; i < route.points.length; i += 1)
    distances.push(
      distances[i - 1] + segmentDistance(route.points[i - 1], route.points[i]),
    );
  const total = distances[distances.length - 1];
  const distance = total * fraction;
  // Only absorb floating-point arithmetic at exact shared endpoints, not a
  // physical arrival radius that would switch floors before reaching them.
  const epsilon = Number.EPSILON * Math.max(1, total) * 16;
  const step = route.steps.find((candidate) => {
    const start = distances[candidate.startIndex];
    const end = distances[candidate.endIndex];
    if (start === undefined || end === undefined || end <= start) return false;
    return direction === 1
      ? distance >= start - epsilon && distance < end - epsilon
      : distance > start + epsilon && distance <= end + epsilon;
  });
  const atDeparture = direction === 1 ? fraction === 0 : fraction === 1;
  const departureLevel = step
    ? direction === 1
      ? step.fromLevel
      : step.toLevel
    : null;
  const currentLevelRef =
    atDeparture || total === 0
      ? endpointLevel(direction === -1)
      : departureLevel;
  const activeConnectionId = step?.connectionId ?? null;
  const arrivalLevel = step
    ? direction === 1
      ? step.toLevel
      : step.fromLevel
    : null;
  const transition =
    step &&
    (step.kind === "steps" || step.kind === "elevator") &&
    departureLevel !== null &&
    arrivalLevel !== null &&
    departureLevel !== arrivalLevel
      ? {
          kind: step.kind,
          name:
            model.connections.find((c) => c.id === activeConnectionId)?.name ??
            step.name,
          fromLevel: departureLevel,
          toLevel: arrivalLevel,
          connectionId: activeConnectionId,
        }
      : null;
  let context = {
    currentLevelRef,
    currentBuildingId: currentLevelRef === null ? null : model.building.id,
  };
  if (route.context) {
    // Use the source point context. An API instruction can announce entry
    // before the path actually crosses the building boundary.
    let index = direction === 1 ? 0 : route.points.length - 1;
    for (let i = 0; i < distances.length - 1; i += 1) {
      const start = distances[i],
        end = distances[i + 1];
      const active =
        direction === 1
          ? distance >= start - epsilon && distance < end - epsilon
          : distance > start + epsilon && distance <= end + epsilon;
      if (active) {
        index = direction === 1 ? i : i + 1;
        break;
      }
    }
    context = contextAt(index);
    if (
      context.currentBuildingId !== null &&
      context.currentLevelRef === null &&
      step &&
      ["steps", "elevator", "escalator"].includes(step.kind)
    )
      context.currentLevelRef = departureLevel;
  }
  return { position, ...context, activeConnectionId, transition };
}

function endpointFeatureId(
  model: LocalIndoorModel,
  place: IndoorPlace | undefined,
): string | null {
  if (
    !place ||
    place.levelRef === null ||
    (place.buildingId !== undefined && place.buildingId !== model.building.id)
  )
    return null;
  const sameFloor = model.features.filter(
    (feature) =>
      feature.levelRef === place.levelRef &&
      (feature.buildingId === undefined ||
        feature.buildingId === model.building.id),
  );
  const uniqueId = (features: IndoorFeature[]) =>
    features.length === 1 ? features[0].id : null;
  if (place.featureId)
    return uniqueId(
      sameFloor.filter((feature) => feature.id === place.featureId),
    );
  const identity = sameFloor.filter(
    (feature) =>
      feature.id === place.id || feature.tags["a11ymap:id"] === place.id,
  );
  if (identity.length) return uniqueId(identity);

  const connections = new Set([
    ...(place.connectionIds ?? []),
    ...(place.connectionId ? [place.connectionId] : []),
  ]);
  if (connections.size)
    return uniqueId(
      sameFloor.filter(
        (feature) =>
          feature.connectionId && connections.has(feature.connectionId),
      ),
    );

  // Room arrival POIs may use a different source ID from the room polygon.
  // Resolve only exact, unique labels on this floor; never proximity/centroids.
  const rooms = sameFloor.filter((feature) => feature.kind === "room");
  if (place.ref)
    return uniqueId(rooms.filter((feature) => feature.ref === place.ref));
  const normalize = (value: string) => value.trim().replace(/\s+/g, " ");
  const name = normalize(place.name);
  if (!name) return null;
  return uniqueId(
    rooms.filter((feature) => {
      const labels = [feature.name, [feature.ref, feature.name].join(" ")];
      return labels.some((label) => label && normalize(label) === name);
    }),
  );
}

/** Display identities only: no doorway or route extension is implied. */
export function routeEndpointFeatureIds(
  model: LocalIndoorModel,
  route: Pick<IndoorRoute, "fromPlaceId" | "toPlaceId">,
): { fromFeatureId: string | null; toFeatureId: string | null } {
  return {
    fromFeatureId: endpointFeatureId(
      model,
      model.places.find((place) => place.id === route.fromPlaceId),
    ),
    toFeatureId: endpointFeatureId(
      model,
      model.places.find((place) => place.id === route.toPlaceId),
    ),
  };
}
