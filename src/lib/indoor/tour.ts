import { pathDistance, segmentDistance } from "./route";
import { sampleRoutePresentation } from "./routePresentation";
import type {
  IndoorRoute,
  IndoorRoutePresentation,
  IndoorRouteStep,
  LocalIndoorModel,
} from "./types";

/** A tour checks presentation data, never physical clearance or live location. */
export function isVenueTourAllowed(route: IndoorRoute): boolean {
  const contextValue = (value: string | null) =>
    value === null || (typeof value === "string" && value.trim().length > 0);
  if (
    route.points.length < 2 ||
    route.points.some(
      (point) => point.length !== 3 || !point.every(Number.isFinite),
    ) ||
    !Number.isFinite(route.distanceM) ||
    route.distanceM < 0 ||
    route.kinds.length !== route.points.length - 1 ||
    !route.steps.length
  )
    return false;
  const length = pathDistance(route.points);
  if (!Number.isFinite(length) || length <= 0) return false;
  if (
    route.context &&
    (route.context.buildingIds.length !== route.points.length ||
      route.context.levelRefs.length !== route.points.length ||
      !route.context.buildingIds.every(contextValue) ||
      !route.context.levelRefs.every(contextValue) ||
      route.context.buildingIds.some(
        (building, index) =>
          building === null && route.context?.levelRefs[index] !== null,
      ))
  )
    return false;
  if (
    route.steps.some(
      (step) =>
        !Number.isInteger(step.startIndex) ||
        !Number.isInteger(step.endIndex) ||
        step.startIndex < 0 ||
        step.endIndex < step.startIndex ||
        step.endIndex >= route.points.length ||
        !Number.isFinite(step.distanceM) ||
        step.distanceM < 0 ||
        !contextValue(step.fromLevel) ||
        !contextValue(step.toLevel),
    )
  )
    return false;
  return route.points
    .slice(1)
    .every((_, index) =>
      route.steps.some(
        (step) => step.startIndex <= index && step.endIndex > index,
      ),
    );
}

export interface VenueTourPresentation extends IndoorRoutePresentation {
  stepIndex: number | null;
  step: IndoorRouteStep | null;
  finished: boolean;
  heightPending: boolean;
}

/** Direction only selects boundary semantics. Progress always addresses the original path. */
export function sampleVenueTour(
  model: LocalIndoorModel,
  route: IndoorRoute,
  progress: number,
  direction: 1 | -1,
): VenueTourPresentation | null {
  if (!isVenueTourAllowed(route) || !Number.isFinite(progress)) return null;
  const fraction = Math.min(1, Math.max(0, progress));
  const distances = [0];
  for (let index = 1; index < route.points.length; index++)
    distances.push(
      distances[index - 1] +
        segmentDistance(route.points[index - 1], route.points[index]),
    );
  const total = distances[distances.length - 1];
  const distance = total * fraction;
  const epsilon = Number.EPSILON * Math.max(1, total) * 16;
  const finished = direction === 1 ? fraction === 1 : fraction === 0;
  let stepIndex = route.steps.findIndex((step) => {
    const start = distances[step.startIndex],
      end = distances[step.endIndex];
    if (end <= start) return false;
    return direction === 1
      ? distance >= start - epsilon && distance < end - epsilon
      : distance > start + epsilon && distance <= end + epsilon;
  });
  if (finished) {
    const ordered = route.steps.map((step, index) => ({ step, index }));
    if (direction === 1) ordered.reverse();
    stepIndex =
      ordered.find(
        ({ step }) => distances[step.endIndex] > distances[step.startIndex],
      )?.index ?? -1;
  }
  const step = route.steps[stepIndex] ?? null;
  return {
    ...sampleRoutePresentation(model, route, fraction, direction),
    stepIndex: stepIndex < 0 ? null : stepIndex,
    step,
    finished,
    heightPending: step?.heightPending === true,
  };
}

/** A resumed/background frame cannot jump over an entire route. */
export function advanceVenueTourProgress(
  route: IndoorRoute,
  progress: number,
  direction: 1 | -1,
  elapsedS: number,
  speedMps = 1.8,
): { progress: number; playing: boolean } {
  const current = Number.isFinite(progress)
    ? Math.max(0, Math.min(1, progress))
    : 0;
  if (
    !isVenueTourAllowed(route) ||
    !Number.isFinite(elapsedS) ||
    !Number.isFinite(speedMps) ||
    speedMps <= 0
  )
    return { progress: current, playing: false };
  const elapsed = Math.max(0, Math.min(0.1, elapsedS));
  const next = Math.max(
    0,
    Math.min(
      1,
      current + (direction * elapsed * speedMps) / pathDistance(route.points),
    ),
  );
  return { progress: next, playing: direction === 1 ? next < 1 : next > 0 };
}
