import { bearingDeg, type CumulativePath, projectToPath } from "@/lib/geo";
import type { LatLng } from "@/types";
import type { AccessibleRoute, NavInstruction } from "@/types/route";

export interface NavigationProgress {
  routeToken: string;
  navigationId: string | null;
  routeVersion: number;
  legIndex: number;
  /** Segment start index in CumulativePath.path. */
  segmentIndex: number;
  alongM: number;
  observedAt: number;
  source: "gps" | "vehicle";
}

type ProgressIdentity = Pick<
  NavigationProgress,
  "routeToken" | "navigationId" | "routeVersion"
>;

/** Voice steps omit legIndex; align their ordered mode changes to route legs. */
export function resolveProgressLegIndex(
  route: AccessibleRoute,
  instructions: readonly NavInstruction[],
  currentStepIndex: number,
): number | null {
  const current = instructions[currentStepIndex];
  if (!current) return null;
  if (current.legIndex != null) return current.legIndex;
  let legIndex = -1;
  for (let index = 0; index <= currentStepIndex; index++) {
    const step = instructions[index];
    const previous = instructions[index - 1];
    if (
      index === 0 ||
      step.legType !== previous?.legType ||
      (step.type === "transit_board" && previous?.type === "transit_alight")
    ) {
      legIndex = route.legs.findIndex(
        (leg, next) => next > legIndex && leg.type === step.legType,
      );
      if (legIndex < 0) return null;
    }
  }
  return legIndex < 0 ? null : legIndex;
}

export function matchesProgressIdentity(
  progress: NavigationProgress | null,
  identity: ProgressIdentity,
): boolean {
  return Boolean(
    progress &&
      progress.routeToken === identity.routeToken &&
      progress.navigationId === identity.navigationId &&
      progress.routeVersion === identity.routeVersion,
  );
}

export function poseAtAlong(
  path: CumulativePath,
  legIndex: number,
  alongM: number,
): { location: LatLng; bearing: number; alongM: number } | null {
  const range = path.legRanges[legIndex];
  if (!range || range.count < 2 || !Number.isFinite(alongM)) return null;
  const last = range.start + range.count - 1;
  const clamped = Math.max(
    path.cumM[range.start],
    Math.min(path.cumM[last], alongM),
  );
  for (let i = range.start; i < last; i++) {
    const length = path.cumM[i + 1] - path.cumM[i];
    if (
      length <= 0 ||
      (path.cumM[i + 1] <= clamped && path.cumM[i + 1] < path.cumM[last])
    )
      continue;
    const t = Math.max(0, Math.min(1, (clamped - path.cumM[i]) / length));
    const a = path.path[i];
    const b = path.path[i + 1];
    return {
      location: {
        lng: a.lng + (b.lng - a.lng) * t,
        lat: a.lat + (b.lat - a.lat) * t,
      },
      bearing: bearingDeg(a, b),
      alongM: clamped,
    };
  }
  return null;
}

/** A timestamped fix may advance only the current leg and a plausible distance. */
export function projectNavigationProgress(input: {
  route: AccessibleRoute;
  path: CumulativePath;
  location: LatLng;
  fix: { accuracyM: number; timestamp: number } | null;
  previous: NavigationProgress | null;
  currentLegIndex: number;
  now: number;
  identity?: Pick<ProgressIdentity, "navigationId" | "routeVersion">;
  source?: NavigationProgress["source"];
  busBoarded?: boolean;
}): NavigationProgress | null {
  const { route, path, location, fix, now } = input;
  if (
    !fix ||
    !Number.isFinite(fix.timestamp) ||
    !Number.isFinite(fix.accuracyM) ||
    fix.accuracyM < 0 ||
    fix.accuracyM > 60 ||
    now - fix.timestamp > 15_000 ||
    fix.timestamp - now > 1_000 ||
    !Number.isFinite(location.lat) ||
    !Number.isFinite(location.lng)
  )
    return null;
  const identity: ProgressIdentity = {
    routeToken: route.routeToken ?? route.routeId,
    navigationId: input.identity
      ? input.identity.navigationId
      : (route.navigationId ?? null),
    routeVersion: input.identity?.routeVersion ?? route.routeVersion ?? 0,
  };
  const source = input.source ?? "gps";
  const previous =
    matchesProgressIdentity(input.previous, identity) &&
    input.previous?.source === source
      ? input.previous
      : null;
  if (previous && fix.timestamp < previous.observedAt) return null;
  let legIndex = input.currentLegIndex;
  if (previous && legIndex > previous.legIndex) {
    const oldRange = path.legRanges[previous.legIndex];
    const oldEnd = oldRange && path.cumM[oldRange.start + oldRange.count - 1];
    if (oldEnd !== undefined && oldEnd - previous.alongM > 35)
      legIndex = previous.legIndex;
  }
  if (previous && legIndex < previous.legIndex) legIndex = previous.legIndex;
  const range = path.legRanges[legIndex];
  if (!range || range.count < 2) return null;
  const leg = route.legs[legIndex];
  const sameLeg = previous?.legIndex === legIndex;
  const elapsed = previous
    ? Math.max(0, (fix.timestamp - previous.observedAt) / 1000)
    : 0;
  const speedLimit = leg?.type === "WALK" ? 4 : 35;
  // Limit reacquisition after a long gap; one GPS jump cannot consume a loop.
  const forwardM = Math.min(500, speedLimit * Math.min(elapsed, 15) + 30);
  const minM = sameLeg ? previous.alongM - 20 : path.cumM[range.start];
  const maxM = sameLeg ? previous.alongM + forwardM : Infinity;
  let best: { segmentIndex: number; alongM: number; distance: number } | null =
    null;
  for (let i = range.start; i < range.start + range.count - 1; i++) {
    if (path.cumM[i + 1] <= path.cumM[i]) continue;
    const projected = projectToPath(
      location,
      [path.path[i], path.path[i + 1]],
      [path.cumM[i], path.cumM[i + 1]],
    );
    if (projected.alongM < minM || projected.alongM > maxM) continue;
    // At crossings, equally plausible positions prefer the earlier occurrence.
    if (
      !best ||
      projected.perpDistM < best.distance - 3 ||
      (Math.abs(projected.perpDistM - best.distance) <= 3 &&
        projected.alongM < best.alongM)
    ) {
      best = {
        segmentIndex: i,
        alongM: projected.alongM,
        distance: projected.perpDistM,
      };
    }
  }
  if (!best || best.distance > Math.min(60, Math.max(25, fix.accuracyM * 1.5)))
    return null;
  const alongM =
    leg?.type === "BUS" && input.busBoarded === false
      ? path.cumM[range.start]
      : Math.max(sameLeg ? previous.alongM : -Infinity, best.alongM);
  return {
    ...identity,
    legIndex,
    segmentIndex:
      leg?.type === "BUS" && input.busBoarded === false
        ? range.start
        : sameLeg && best.alongM < previous.alongM
          ? previous.segmentIndex
          : best.segmentIndex,
    alongM,
    observedAt: fix.timestamp,
    source,
  };
}

/** Splits only this leg: gaps between legs never become drawable segments. */
export function splitLegAtProgress(
  polyline: readonly [number, number][],
  legIndex: number,
  path: CumulativePath,
  progress: NavigationProgress | null,
): { completed: [number, number][]; remaining: [number, number][] } {
  if (!progress || legIndex > progress.legIndex)
    return { completed: [], remaining: [...polyline] };
  if (legIndex < progress.legIndex)
    return { completed: [...polyline], remaining: [] };
  const range = path.legRanges[legIndex];
  const pose = poseAtAlong(path, legIndex, progress.alongM);
  if (!range || !pose || polyline.length !== range.count)
    return { completed: [], remaining: [...polyline] };
  if (pose.alongM <= path.cumM[range.start])
    return { completed: [], remaining: [...polyline] };
  if (pose.alongM >= path.cumM[range.start + range.count - 1])
    return { completed: [...polyline], remaining: [] };
  let index = 0;
  while (
    index < polyline.length - 2 &&
    path.cumM[range.start + index + 1] <= pose.alongM
  )
    index++;
  const split: [number, number] = [pose.location.lng, pose.location.lat];
  return {
    completed: [...polyline.slice(0, index + 1), split],
    remaining: [split, ...polyline.slice(index + 1)],
  };
}
