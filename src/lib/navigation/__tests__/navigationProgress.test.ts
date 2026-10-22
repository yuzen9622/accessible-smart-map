import { describe, expect, it } from "vitest";
import { buildCumulativePath } from "@/lib/geo";
import useNavStore from "@/stores/useNavStore";
import type { AccessibleRoute, RouteLeg } from "@/types/route";
import {
  poseAtAlong,
  projectNavigationProgress,
  splitLegAtProgress,
} from "../navigationProgress";

const makeRoute = (
  lines: [number, number][][],
  type: RouteLeg["type"] = "BUS",
) =>
  ({
    routeToken: "route",
    navigationId: "nav",
    routeVersion: 1,
    legs: lines.map((polyline) => ({ type, polyline })),
  }) as AccessibleRoute;
const corner: [number, number][] = [
  [121, 25],
  [121.001, 25],
  [121.001, 25.001],
];
const route = makeRoute([corner]);
const path = buildCumulativePath(route.legs);
const now = 1_000_000;
const project = (
  lng: number,
  lat: number,
  overrides: Partial<Parameters<typeof projectNavigationProgress>[0]> = {},
) =>
  projectNavigationProgress({
    route,
    path,
    location: { lng, lat },
    fix: { timestamp: now, accuracyM: 5 },
    now,
    previous: null,
    currentLegIndex: 0,
    ...overrides,
  });

describe("navigation route progress", () => {
  it("samples around a corner instead of crossing it and turns with the route", () => {
    const turn = path.cumM[1];
    const before = poseAtAlong(path, 0, turn - 10);
    const after = poseAtAlong(path, 0, turn + 10);
    expect(before?.location.lat).toBe(25);
    expect(before?.bearing).toBeCloseTo(90, 2);
    expect(after?.location.lng).toBe(121.001);
    expect(after?.bearing).toBeCloseTo(0);
    expect(poseAtAlong(path, 0, turn)?.location).toEqual({
      lng: 121.001,
      lat: 25,
    });
  });

  it("does not draw or project across a gap between legs", () => {
    const separated = makeRoute([
      corner,
      [
        [122, 26],
        [122.001, 26],
      ],
    ]);
    const cp = buildCumulativePath(separated.legs);
    const gapMid = (cp.cumM[2] + cp.cumM[3]) / 2;
    expect(poseAtAlong(cp, 0, gapMid)?.location).toEqual({
      lng: 121.001,
      lat: 25.001,
    });
    expect(poseAtAlong(cp, 1, gapMid)?.location).toEqual({ lng: 122, lat: 26 });
    expect(project(121.5, 25.5, { route: separated, path: cp })).toBeNull();
  });

  it("stops at the boarding point until boarding is confirmed", () => {
    const waiting = project(121.0005, 25, { busBoarded: false });
    expect(waiting?.alongM).toBe(0);
    expect(splitLegAtProgress(corner, 0, path, waiting)).toEqual({
      completed: [],
      remaining: corner,
    });
    expect(project(121.0005, 25, { busBoarded: true })?.alongM).toBeGreaterThan(
      40,
    );
  });

  it("rejects stale, imprecise, out-of-order or missing fixes", () => {
    expect(project(121, 25, { fix: null })).toBeNull();
    expect(
      project(121, 25, { fix: { timestamp: now - 16_000, accuracyM: 5 } }),
    ).toBeNull();
    expect(
      project(121, 25, { fix: { timestamp: now, accuracyM: 100 } }),
    ).toBeNull();
    const previous = project(121, 25);
    expect(
      project(121, 25, { previous, fix: { timestamp: now - 1, accuracyM: 5 } }),
    ).toBeNull();
  });

  it("rejects implausible jumps and does not move backward on GPS jitter", () => {
    const previous = project(121.0005, 25);
    expect(
      project(121.001, 25.001, {
        previous,
        now: now + 1000,
        fix: { timestamp: now + 1000, accuracyM: 5 },
      }),
    ).toBeNull();
    expect(
      project(121.00045, 25, {
        previous,
        now: now + 1000,
        fix: { timestamp: now + 1000, accuracyM: 5 },
      })?.alongM,
    ).toBe(previous?.alongM);
  });

  it("prefers the current occurrence when a loop returns along the same street", () => {
    const loop = makeRoute([
      [
        [121, 25],
        [121.001, 25],
        [121.001, 25.001],
        [121, 25.001],
        [121, 25],
        [121.001, 25],
      ],
    ]);
    const cp = buildCumulativePath(loop.legs);
    const previous = project(121.0004, 25, { route: loop, path: cp });
    const next = project(121.0005, 25, {
      route: loop,
      path: cp,
      previous,
      now: now + 5000,
      fix: { timestamp: now + 5000, accuracyM: 5 },
    });
    expect(next?.segmentIndex).toBe(0);
    expect(next?.alongM).toBeLessThan(cp.cumM[1]);
  });

  it("preserves the corner in both gray and remaining paths", () => {
    const progress = project(121.001, 25.0005);
    const split = splitLegAtProgress(corner, 0, path, progress);
    expect(split.completed.slice(0, 2)).toEqual(corner.slice(0, 2));
    expect(split.completed.at(-1)).toEqual(split.remaining[0]);
    expect(split.remaining.at(-1)).toEqual(corner.at(-1));
    expect(corner).toHaveLength(3);
  });

  it("resets continuity for a replaced route or source and advances a transfer only near its boundary", () => {
    const previous = project(121, 25);
    expect(
      project(121.001, 25.001, {
        previous,
        route: { ...route, routeVersion: 2 },
      })?.routeVersion,
    ).toBe(2);
    expect(
      project(121.001, 25.001, { previous, source: "vehicle" })?.source,
    ).toBe("vehicle");
    const transfer = makeRoute([
      corner,
      [
        [121.001, 25.001],
        [121.002, 25.001],
      ],
    ]);
    const cp = buildCumulativePath(transfer.legs);
    expect(
      project(121, 25, {
        route: transfer,
        path: cp,
        previous,
        currentLegIndex: 1,
      })?.legIndex,
    ).toBe(0);
    const atEnd = project(121.001, 25.001, { route: transfer, path: cp });
    expect(
      project(121.001, 25.001, {
        route: transfer,
        path: cp,
        previous: atEnd,
        currentLegIndex: 1,
      })?.legIndex,
    ).toBe(1);
  });

  it("keeps the last valid tangent when a polyline ends with duplicate points", () => {
    const duplicate = makeRoute([[...corner, corner[2]]]);
    const cp = buildCumulativePath(duplicate.legs);
    expect(poseAtAlong(cp, 0, cp.cumM.at(-1) ?? 0)?.location).toEqual({
      lng: 121.001,
      lat: 25.001,
    });
  });

  it("clears shared visual progress on navigation identity, source, instructions and reset", () => {
    const nav = useNavStore.getState();
    nav.reset();
    for (const clear of [
      () => nav.setNavigationIdentity("next", 2),
      () => nav.setNavigationSource("voice"),
      () => nav.setInstructions([]),
      () => nav.reset(),
    ]) {
      nav.setRouteProgress(project(121, 25));
      clear();
      expect(useNavStore.getState().routeProgress).toBeNull();
    }
  });
});
