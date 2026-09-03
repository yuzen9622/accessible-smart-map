import { describe, expect, it } from "vitest";
import type { DriveTrafficSegment, TrafficLevel } from "@/types/route";
import {
  TRAFFIC_BASE_COLOR,
  TRAFFIC_LEVEL_COLORS,
  visibleTrafficSegments,
} from "@/types/route";

function makeSegment(
  overrides: Partial<DriveTrafficSegment> = {},
): DriveTrafficSegment {
  return {
    fromIndex: 0,
    toIndex: 2,
    trafficLevel: "heavy",
    congestionLevel: 3,
    ...overrides,
  };
}

describe("visibleTrafficSegments", () => {
  it("returns an empty array for undefined or empty input", () => {
    expect(visibleTrafficSegments(undefined, 10)).toEqual([]);
    expect(visibleTrafficSegments([], 10)).toEqual([]);
  });

  it("keeps segments whose indices fit inside the polyline", () => {
    const segment = makeSegment({ fromIndex: 1, toIndex: 4 });
    expect(visibleTrafficSegments([segment], 10)).toEqual([segment]);
  });

  it("drops segments whose toIndex is outside the polyline", () => {
    const segment = makeSegment({ fromIndex: 0, toIndex: 10 });
    expect(visibleTrafficSegments([segment], 10)).toEqual([]);
  });

  it("drops segments with a negative fromIndex", () => {
    const segment = makeSegment({ fromIndex: -1, toIndex: 3 });
    expect(visibleTrafficSegments([segment], 10)).toEqual([]);
  });

  it("drops zero-length and reversed segments", () => {
    const zeroLength = makeSegment({ fromIndex: 3, toIndex: 3 });
    const reversed = makeSegment({ fromIndex: 5, toIndex: 2 });
    expect(visibleTrafficSegments([zeroLength, reversed], 10)).toEqual([]);
  });

  it("drops segments with non-integer indices", () => {
    const segment = makeSegment({ fromIndex: 0.5, toIndex: 3 });
    expect(visibleTrafficSegments([segment], 10)).toEqual([]);
  });

  it("handles null or malformed segment elements safely", () => {
    expect(
      visibleTrafficSegments(
        [
          null as unknown as DriveTrafficSegment,
          undefined as unknown as DriveTrafficSegment,
        ],
        10,
      ),
    ).toEqual([]);
  });

  it("drops the unknown level so it never paints over the base line", () => {
    const segment = makeSegment({ trafficLevel: "unknown" });
    expect(visibleTrafficSegments([segment], 10)).toEqual([]);
  });

  it("drops levels outside the contract", () => {
    const segment = makeSegment({
      trafficLevel: "bogus" as TrafficLevel,
    });
    expect(visibleTrafficSegments([segment], 10)).toEqual([]);
  });

  it("keeps every measured level", () => {
    const levels: TrafficLevel[] = [
      "light",
      "moderate",
      "heavy",
      "severe",
      "closed",
    ];
    const segments = levels.map((trafficLevel, i) =>
      makeSegment({ trafficLevel, fromIndex: i * 2, toIndex: i * 2 + 1 }),
    );
    expect(
      visibleTrafficSegments(segments, 20).map((s) => s.trafficLevel),
    ).toEqual(levels);
  });

  it("sorts the kept segments by fromIndex", () => {
    const segments = [
      makeSegment({ fromIndex: 6, toIndex: 8 }),
      makeSegment({ fromIndex: 0, toIndex: 2 }),
      makeSegment({ fromIndex: 3, toIndex: 5 }),
    ];
    expect(
      visibleTrafficSegments(segments, 10).map((s) => s.fromIndex),
    ).toEqual([0, 3, 6]);
  });

  it("does not mutate the caller's array", () => {
    const segments = [
      makeSegment({ fromIndex: 6, toIndex: 8 }),
      makeSegment({ fromIndex: 0, toIndex: 2 }),
    ];
    visibleTrafficSegments(segments, 10);
    expect(segments.map((s) => s.fromIndex)).toEqual([6, 0]);
  });
});

describe("traffic colour tokens", () => {
  it("gives every traffic level a distinct colour", () => {
    const colours = Object.values(TRAFFIC_LEVEL_COLORS);
    expect(new Set(colours).size).toBe(colours.length);
  });

  it("covers the whole TrafficLevel union", () => {
    expect(Object.keys(TRAFFIC_LEVEL_COLORS).sort()).toEqual([
      "closed",
      "heavy",
      "light",
      "moderate",
      "severe",
      "unknown",
    ]);
  });

  it("keeps the dimmed base line distinct from the segment colours", () => {
    expect(Object.values(TRAFFIC_LEVEL_COLORS)).not.toContain(
      TRAFFIC_BASE_COLOR,
    );
  });
});
