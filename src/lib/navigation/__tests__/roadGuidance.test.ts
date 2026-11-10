import { describe, expect, it } from "vitest";
import { stripStepDistance } from "@/lib/navigation/maneuverAnnouncement";
import type { NavigationProgress } from "@/lib/navigation/navigationProgress";
import {
  currentDrivingPosition,
  DRIVING_PROGRESS_MAX_AGE_MS,
  laneGuidanceAt,
  laneNumbers,
  speedLimitAt,
} from "@/lib/navigation/roadGuidance";
import type {
  AccessibleRoute,
  DriveLeg,
  NavInstruction,
  RoadLane,
} from "@/types/route";

const NOW = 1_000_000;

const line = (count: number, lng = 121.5): [number, number][] =>
  Array.from({ length: count }, (_, i) => [lng, 25 + i * 0.001]);

// Measured Taipei sample: unknown, 50, unknown, 50 over a 114-vertex leg.
const drive: DriveLeg = {
  type: "DRIVE",
  from: { lat: 25, lng: 121.5 },
  to: { lat: 25.113, lng: 121.5 },
  distanceM: 12_000,
  durationMin: 20,
  polyline: line(114),
  speedLimits: {
    status: "available",
    direction: "along_leg",
    segments: [
      {
        fromIndex: 0,
        toIndex: 72,
        kind: "unknown",
        limitKph: null,
        source: null,
      },
      {
        fromIndex: 72,
        toIndex: 83,
        kind: "known",
        limitKph: 50,
        source: "valhalla",
      },
      {
        fromIndex: 83,
        toIndex: 88,
        kind: "unknown",
        limitKph: null,
        source: null,
      },
      {
        fromIndex: 88,
        toIndex: 113,
        kind: "known",
        limitKph: 50,
        source: "valhalla",
      },
    ],
  },
};

const walkLeg = {
  type: "WALK",
  polyline: line(5, 121.4),
} as unknown as AccessibleRoute["legs"][number];

const route: AccessibleRoute = {
  routeId: "r",
  routeToken: "tok",
  navigationId: "nav",
  routeVersion: 2,
  routeName: "r",
  totalMinutes: 25,
  transferCount: 0,
  accessibilityHighlights: [],
  legs: [walkLeg, drive],
} as unknown as AccessibleRoute;

/** Progress at a leg-local segment of leg 1 (the walk leg has 5 vertices). */
const progressAt = (
  legSegment: number,
  overrides: Partial<NavigationProgress> = {},
): NavigationProgress => ({
  routeToken: "tok",
  navigationId: "nav",
  routeVersion: 2,
  legIndex: 1,
  segmentIndex: 5 + legSegment,
  alongM: 0,
  observedAt: NOW,
  source: "gps",
  ...overrides,
});

const position = (legSegment: number, overrides = {}) =>
  currentDrivingPosition({
    route,
    progress: progressAt(legSegment, overrides),
    navigationId: "nav",
    routeVersion: 2,
    now: NOW,
  });

const limitAt = (legSegment: number) => {
  const at = position(legSegment);
  return at ? speedLimitAt(at.leg, at.segmentIndex) : null;
};

describe("speed limit from route progress", () => {
  it("converts concatenated progress to the leg's own segment index", () => {
    expect(position(0)).toMatchObject({ legIndex: 1, segmentIndex: 0 });
    expect(position(112)).toMatchObject({ segmentIndex: 112 });
  });

  it("uses half-open ranges: the boundary vertex belongs to the next segment", () => {
    expect(limitAt(71)).toEqual({ kind: "unknown", limitKph: null });
    expect(limitAt(72)).toEqual({ kind: "known", limitKph: 50 });
    expect(limitAt(82)).toEqual({ kind: "known", limitKph: 50 });
    expect(limitAt(83)).toEqual({ kind: "unknown", limitKph: null });
    expect(limitAt(88)).toEqual({ kind: "known", limitKph: 50 });
  });

  it("never carries a known limit into an unknown segment", () => {
    // Coming from 50 km/h at segment 82 does not affect segment 85.
    expect(limitAt(82)).toEqual({ kind: "known", limitKph: 50 });
    expect(limitAt(85)).toEqual({ kind: "unknown", limitKph: null });
  });

  it("reports unlimited as its own kind, never as 0", () => {
    const leg: Pick<DriveLeg, "speedLimits"> = {
      speedLimits: {
        status: "available",
        direction: "along_leg",
        segments: [
          {
            fromIndex: 0,
            toIndex: 4,
            kind: "unlimited",
            limitKph: null,
            source: "valhalla",
          },
        ],
      },
    };
    expect(speedLimitAt(leg, 2)).toEqual({ kind: "unlimited", limitKph: null });
  });

  it("treats unavailable, missing, uncovered or malformed data as unknown", () => {
    const unknown = { kind: "unknown", limitKph: null };
    expect(
      speedLimitAt(
        {
          speedLimits: {
            status: "unavailable",
            direction: "along_leg",
            segments: [],
            reason: "upstream_error",
          },
        },
        3,
      ),
    ).toEqual(unknown);
    expect(speedLimitAt({}, 3)).toEqual(unknown);
    expect(speedLimitAt(drive, 113)).toEqual(unknown);
    expect(
      speedLimitAt(
        {
          speedLimits: {
            status: "available",
            direction: "along_leg",
            segments: [
              {
                fromIndex: 0,
                toIndex: 4,
                kind: "known",
                limitKph: 47.5,
                source: "valhalla",
              },
            ],
          },
        },
        1,
      ),
    ).toEqual(unknown);
  });

  it("has no current segment without valid, fresh progress on a vehicle leg", () => {
    const base = { route, navigationId: "nav", routeVersion: 2, now: NOW };
    expect(currentDrivingPosition({ ...base, progress: null })).toBeNull();
    // Out of the leg: past its last segment, or before its first vertex.
    expect(position(113)).toBeNull();
    expect(position(-1)).toBeNull();
    // Stale fix.
    expect(
      position(80, { observedAt: NOW - DRIVING_PROGRESS_MAX_AGE_MS - 1 }),
    ).toBeNull();
    expect(
      position(80, { observedAt: NOW - DRIVING_PROGRESS_MAX_AGE_MS }),
    ).not.toBeNull();
    // A previous route version or another navigation.
    expect(position(80, { routeVersion: 1 })).toBeNull();
    expect(position(80, { routeToken: "other" })).toBeNull();
    // Walking leg.
    expect(
      currentDrivingPosition({
        ...base,
        progress: progressAt(0, { legIndex: 0, segmentIndex: 1 }),
      }),
    ).toBeNull();
  });
});

const lanes: RoadLane[] = [
  {
    directions: ["straight"],
    recommendation: "not_recommended",
    maneuverDirection: null,
  },
  {
    directions: ["straight"],
    recommendation: "not_recommended",
    maneuverDirection: null,
  },
  {
    directions: ["right"],
    recommendation: "usable",
    maneuverDirection: "right",
  },
  {
    directions: ["right"],
    recommendation: "preferred",
    maneuverDirection: "right",
  },
];

const turn: Pick<NavInstruction, "legIndex" | "legType" | "roadGuidance"> = {
  legIndex: 1,
  legType: "DRIVE",
  roadGuidance: {
    maneuverIndex: 4,
    maneuver: "right",
    endPolylineIndex: 60,
    streetNames: ["民生東路"],
    lanes,
    laneApproachRange: { fromIndex: 40, toIndex: 50 },
    laneHint: "靠右側兩個車道",
  },
};

describe("lane guidance in the approach range", () => {
  it("shows lanes only inside [fromIndex, toIndex) of the upcoming maneuver", () => {
    expect(laneGuidanceAt(turn, position(39))).toBeNull();
    expect(laneGuidanceAt(turn, position(40))).toEqual({
      lanes,
      laneHint: "靠右側兩個車道",
    });
    expect(laneGuidanceAt(turn, position(49))).not.toBeNull();
    // Reaching the turn point clears them.
    expect(laneGuidanceAt(turn, position(50))).toBeNull();
  });

  it("draws nothing without lanes, a range, progress, or on another leg", () => {
    const guidance = turn.roadGuidance;
    if (!guidance) throw new Error("fixture");
    expect(
      laneGuidanceAt(
        { ...turn, roadGuidance: { ...guidance, lanes: undefined } },
        position(45),
      ),
    ).toBeNull();
    expect(
      laneGuidanceAt(
        {
          ...turn,
          roadGuidance: { ...guidance, laneApproachRange: undefined },
        },
        position(45),
      ),
    ).toBeNull();
    expect(
      laneGuidanceAt({ ...turn, roadGuidance: undefined }, position(45)),
    ).toBeNull();
    expect(laneGuidanceAt(turn, null)).toBeNull();
    expect(laneGuidanceAt({ ...turn, legIndex: 0 }, position(45))).toBeNull();
  });

  it("numbers lanes from the left", () => {
    expect(laneNumbers(lanes, "preferred")).toEqual([4]);
    expect(laneNumbers(lanes, "usable")).toEqual([3]);
  });

  it("keeps the lane advice when the turn is pre-announced with a distance", () => {
    expect(
      stripStepDistance("向左轉進入「忠孝西路二段」，請走左邊數來第二車道"),
    ).toBe("向左轉進入「忠孝西路二段」，請走左邊數來第二車道");
    expect(stripStepDistance("右轉進入「民生東路」，請靠右側兩個車道")).toBe(
      "右轉進入「民生東路」，請靠右側兩個車道",
    );
  });
});
