import { describe, expect, it } from "vitest";
import { samplePath } from "../route";
import {
  advanceVenueTourProgress,
  isVenueTourAllowed,
  sampleVenueTour,
} from "../tour";
import type { IndoorRoute, LocalIndoorModel } from "../types";

const route: IndoorRoute = {
  ok: true,
  fromPlaceId: "start",
  toPlaceId: "end",
  points: [
    [0, 0, 0],
    [3, 0, 0],
    [3, 0, 8],
    [3, 4, 8],
  ],
  context: {
    buildingIds: ["a", "a", "a", "b"],
    levelRefs: ["1F", "1F", "3F", "3F"],
  },
  kinds: ["corridor", "elevator", "corridor"],
  steps: [
    {
      kind: "corridor",
      name: "Lower hall",
      instruction: "Follow the source hall",
      fromLevel: "1F",
      toLevel: "1F",
      startIndex: 0,
      endIndex: 1,
      distanceM: 3,
      heightPending: false,
    },
    {
      kind: "elevator",
      name: "Lift",
      instruction: "Take Lift to 3F",
      connectionId: "lift",
      fromLevel: "1F",
      toLevel: "3F",
      startIndex: 1,
      endIndex: 2,
      distanceM: 8,
      heightPending: false,
    },
    {
      kind: "corridor",
      name: "Bridge",
      fromLevel: "3F",
      toLevel: "3F",
      startIndex: 2,
      endIndex: 3,
      distanceM: 4,
      heightPending: false,
    },
  ],
  distanceM: 900,
  animationSafe: false,
  warnings: [],
  edgeIds: [],
};
const model = {
  building: { id: "a" },
  places: [],
  connections: [],
} as unknown as LocalIndoorModel;

describe("schematic route tours", () => {
  it("allows validated source geometry without certifying physical animation or height", () => {
    const pending = structuredClone(route);
    pending.steps[0].heightPending = true;
    const before = JSON.stringify(pending);
    expect(isVenueTourAllowed(pending)).toBe(true);
    const sample = sampleVenueTour(model, pending, 0.1, 1);
    expect(sample?.heightPending).toBe(true);
    expect(sample?.step?.instruction).toBe("Follow the source hall");
    expect(pending.animationSafe).toBe(false);
    expect(JSON.stringify(pending)).toBe(before);
  });
  it.each([
    "nan",
    "context-length",
    "unknown-context",
    "step-index",
    "step-gap",
    "distance",
    "empty",
  ])("rejects malformed presentation data: %s", (kind) => {
    const invalid = structuredClone(route);
    if (kind === "nan") invalid.points[1][0] = Number.NaN;
    if (kind === "context-length") invalid.context?.buildingIds.pop();
    if (kind === "unknown-context" && invalid.context)
      invalid.context.buildingIds[0] = "";
    if (kind === "step-index") invalid.steps[0].endIndex = 99;
    if (kind === "step-gap") invalid.steps.splice(1, 1);
    if (kind === "distance") invalid.distanceM = Number.POSITIVE_INFINITY;
    if (kind === "empty") invalid.points = [];
    expect(isVenueTourAllowed(invalid)).toBe(false);
    expect(sampleVenueTour(model, invalid, 0.5, 1)).toBeNull();
  });
  it("uses cumulative source distance rather than API display distance, and caps a suspended frame", () => {
    expect(advanceVenueTourProgress(route, 0, 1, 0.1, 15)).toEqual({
      progress: 0.1,
      playing: true,
    });
    expect(advanceVenueTourProgress(route, 0, 1, 3600, 15)).toEqual({
      progress: 0.1,
      playing: true,
    });
    expect(advanceVenueTourProgress(route, 0.9, 1, 0.1, 15)).toEqual({
      progress: 1,
      playing: false,
    });
    expect(advanceVenueTourProgress(route, 0.1, -1, 0.1, 15)).toEqual({
      progress: 0,
      playing: false,
    });
  });
  it("keeps absolute XYZ on reversal and retains departure floor until the real stop", () => {
    const forward = sampleVenueTour(model, route, 0.5, 1);
    const reverse = sampleVenueTour(model, route, 0.5, -1);
    expect(forward?.position).toEqual(samplePath(route.points, 0.5));
    expect(reverse?.position).toEqual(forward?.position);
    expect(forward).toMatchObject({
      stepIndex: 1,
      currentLevelRef: "1F",
      finished: false,
    });
    expect(reverse).toMatchObject({
      stepIndex: 1,
      currentLevelRef: "3F",
      finished: false,
    });
    expect(sampleVenueTour(model, route, 11 / 15, 1)).toMatchObject({
      stepIndex: 2,
      currentLevelRef: "3F",
    });
    expect(sampleVenueTour(model, route, 3 / 15, -1)).toMatchObject({
      stepIndex: 0,
      currentLevelRef: "1F",
    });
    expect(sampleVenueTour(model, route, 1, 1)).toMatchObject({
      finished: true,
      currentBuildingId: "b",
    });
  });
  it("retains outdoor/null context instead of guessing a floor from Z", () => {
    const outside = structuredClone(route);
    if (!outside.context) throw new Error("fixture");
    outside.context.buildingIds[0] = null;
    outside.context.levelRefs[0] = null;
    expect(sampleVenueTour(model, outside, 0.1, 1)).toMatchObject({
      currentBuildingId: null,
      currentLevelRef: null,
    });
  });
});
