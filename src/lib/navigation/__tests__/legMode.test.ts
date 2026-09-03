import { describe, expect, it } from "vitest";
import { buildCumulativePath, resolveWaypoints } from "@/lib/geo";
import {
  findLegHandoffIndex,
  isLegHandoff,
  isVehicleLegType,
  navThresholdsFor,
  resolveActiveBusLegOrdinal,
  resolveActiveLegType,
  resolveCurrentLegType,
  resolveNavHeading,
  selectNextStepIndex,
  VEHICLE_THRESHOLDS,
  WALK_THRESHOLDS,
} from "@/lib/navigation/legMode";
import type { NavInstruction, RouteLeg } from "@/types/route";

function instruction(
  legType: NavInstruction["legType"],
  overrides: Partial<NavInstruction> = {},
): NavInstruction {
  return {
    text: `${legType} step`,
    type: "turn",
    bearing: null,
    relativeDirection: null,
    distanceM: 100,
    streetName: null,
    legType,
    polylineIndex: 0,
    ...overrides,
  };
}

/** Drive to an accessible parking space, then walk the last stretch. */
const compositeRoute: NavInstruction[] = [
  instruction("DRIVE", { type: "depart" }),
  instruction("DRIVE"),
  instruction("WALK"),
  instruction("WALK", { type: "arrive" }),
];

describe("isVehicleLegType", () => {
  it("treats DRIVE and MOTORCYCLE as vehicle legs", () => {
    expect(isVehicleLegType("DRIVE")).toBe(true);
    expect(isVehicleLegType("MOTORCYCLE")).toBe(true);
  });

  it("treats walking and transit legs as non-vehicle", () => {
    for (const legType of ["WALK", "BUS", "METRO", "THSR", "TRA"] as const) {
      expect(isVehicleLegType(legType)).toBe(false);
    }
    expect(isVehicleLegType(null)).toBe(false);
    expect(isVehicleLegType(undefined)).toBe(false);
  });
});

describe("resolveActiveLegType", () => {
  it("reads the leg type of the current step", () => {
    expect(resolveActiveLegType(compositeRoute, 1)).toBe("DRIVE");
    expect(resolveActiveLegType(compositeRoute, 2)).toBe("WALK");
  });

  it("returns null for an out-of-range or negative index", () => {
    expect(resolveActiveLegType(compositeRoute, 99)).toBeNull();
    expect(resolveActiveLegType(compositeRoute, -1)).toBeNull();
    expect(resolveActiveLegType([], 0)).toBeNull();
  });
});

describe("navThresholdsFor", () => {
  it("widens the maneuver and off-route radii for vehicle legs", () => {
    expect(navThresholdsFor("DRIVE")).toEqual(VEHICLE_THRESHOLDS);
    expect(navThresholdsFor("MOTORCYCLE")).toEqual(VEHICLE_THRESHOLDS);
    expect(VEHICLE_THRESHOLDS.offRouteM).toBe(80);
    expect(VEHICLE_THRESHOLDS.arriveM).toBe(60);
  });

  it("keeps pedestrian precision everywhere else", () => {
    expect(navThresholdsFor("WALK")).toEqual(WALK_THRESHOLDS);
    expect(navThresholdsFor("BUS")).toEqual(WALK_THRESHOLDS);
    expect(navThresholdsFor(null)).toEqual(WALK_THRESHOLDS);
  });
});

describe("selectNextStepIndex", () => {
  // Maneuvers at 100 m (drive), 300 m (drive), 340 m (walk), 400 m (walk).
  const waypoints = [
    { alongM: 100 },
    { alongM: 300 },
    { alongM: 340 },
    { alongM: 400 },
  ];

  it("advances past a driving maneuver at the 60 m radius", () => {
    // 45 m short of the maneuver: inside the driving radius, so it is done.
    expect(selectNextStepIndex(compositeRoute, waypoints, 255)).toBe(2);
    // 70 m short: still ahead.
    expect(selectNextStepIndex(compositeRoute, waypoints, 230)).toBe(1);
  });

  it("uses the walking radius once the leg is on foot", () => {
    // 30 m short of the 340 m walking maneuver — beyond the 18 m radius, so
    // it is still the target even though a driving radius would have passed it.
    expect(selectNextStepIndex(compositeRoute, waypoints, 310)).toBe(2);
    expect(selectNextStepIndex(compositeRoute, waypoints, 330)).toBe(3);
  });

  it("clamps to the final step past the end of the route", () => {
    expect(selectNextStepIndex(compositeRoute, waypoints, 5000)).toBe(3);
  });

  it("returns 0 with no instructions", () => {
    expect(selectNextStepIndex([], [], 0)).toBe(0);
  });
});

describe("resolveNavHeading", () => {
  const base = {
    compassHeading: 10,
    compassAgeMs: 100,
    compassFreshMs: 1500,
    gpsHeading: 90,
    userHeading: 200,
    headingSource: "compass" as const,
  };

  it("prefers GPS course-over-ground while driving, even with a fresh compass", () => {
    expect(resolveNavHeading({ ...base, isVehicle: true })).toEqual({
      heading: 90,
      source: "gps",
    });
  });

  it("falls back to the last written heading when the GPS has no course", () => {
    expect(
      resolveNavHeading({ ...base, isVehicle: true, gpsHeading: null }),
    ).toEqual({ heading: 200, source: "compass" });
  });

  it("falls back to a fresh compass when driving with no other source", () => {
    expect(
      resolveNavHeading({
        ...base,
        isVehicle: true,
        gpsHeading: null,
        userHeading: null,
      }),
    ).toEqual({ heading: 10, source: "compass" });
  });

  it("prefers a fresh compass while walking", () => {
    expect(resolveNavHeading({ ...base, isVehicle: false })).toEqual({
      heading: 10,
      source: "compass",
    });
  });

  it("falls back to GPS while walking once the compass goes stale", () => {
    expect(
      resolveNavHeading({ ...base, isVehicle: false, compassAgeMs: 5000 }),
    ).toEqual({ heading: 90, source: "gps" });
  });

  it("returns null when no source is available", () => {
    expect(
      resolveNavHeading({
        ...base,
        isVehicle: false,
        compassHeading: null,
        gpsHeading: null,
        userHeading: null,
      }),
    ).toBeNull();
  });
});

describe("findLegHandoffIndex", () => {
  it("points at the first walking step after the driving leg", () => {
    expect(findLegHandoffIndex(compositeRoute, 0)).toBe(2);
    expect(findLegHandoffIndex(compositeRoute, 1)).toBe(2);
  });

  it("is null once the user is already walking", () => {
    expect(findLegHandoffIndex(compositeRoute, 2)).toBeNull();
  });

  it("is null for a drive-only route", () => {
    const driveOnly = [instruction("DRIVE"), instruction("DRIVE")];
    expect(findLegHandoffIndex(driveOnly, 0)).toBeNull();
  });
});

describe("isLegHandoff", () => {
  it("flags the drive → walk boundary", () => {
    expect(isLegHandoff(compositeRoute, 1, 2)).toBe(true);
  });

  it("does not flag a step change inside the same mode", () => {
    expect(isLegHandoff(compositeRoute, 0, 1)).toBe(false);
    expect(isLegHandoff(compositeRoute, 2, 3)).toBe(false);
  });

  it("does not flag when either step is missing", () => {
    expect(isLegHandoff(compositeRoute, 1, 99)).toBe(false);
    expect(isLegHandoff([], 0, 1)).toBe(false);
  });
});

describe("resolveCurrentLegType", () => {
  const waypoints = [
    { alongM: 0 }, // DRIVE depart
    { alongM: 500 }, // DRIVE turn
    { alongM: 1000 }, // WALK depart (parking space)
    { alongM: 1200 }, // WALK arrive
  ];

  it("keeps vehicle mode active throughout the driving leg", () => {
    // Just departed
    expect(resolveCurrentLegType(compositeRoute, waypoints, 50)).toBe("DRIVE");
    // Mid-drive
    expect(resolveCurrentLegType(compositeRoute, waypoints, 450)).toBe("DRIVE");
    expect(resolveCurrentLegType(compositeRoute, waypoints, 600)).toBe("DRIVE");
    // Approaching parking space before 60m threshold (at 930m, 1000 - 60 = 940m)
    expect(resolveCurrentLegType(compositeRoute, waypoints, 930)).toBe("DRIVE");
  });

  it("switches to walking mode once within arrive threshold of the parking space", () => {
    // Within 60m arrival radius of parking space (1000m)
    expect(resolveCurrentLegType(compositeRoute, waypoints, 945)).toBe("WALK");
    // Walking leg
    expect(resolveCurrentLegType(compositeRoute, waypoints, 1100)).toBe("WALK");
  });
});

describe("resolveWaypoints with multi-leg fallback steps", () => {
  it("resolves global waypoints along the cumulative path", () => {
    const driveLeg: RouteLeg = {
      type: "DRIVE",
      from: "A",
      to: "B",
      distanceM: 1000,
      durationMin: 2,
      polyline: [
        [121.5, 25.0],
        [121.51, 25.0],
      ],
    };
    const walkLeg: RouteLeg = {
      type: "WALK",
      from: "B",
      to: "C",
      distanceM: 200,
      minutesEst: 3,
      polyline: [
        [121.51, 25.0],
        [121.512, 25.0],
      ],
      a11yFacilities: [],
    };
    const legs = [driveLeg, walkLeg];
    const path = buildCumulativePath(legs);

    // Global concatenated path indices: drive at 0, walk at 1 (leg 1 start)
    const instructions = [
      instruction("DRIVE", { polylineIndex: 0 }),
      instruction("WALK", { polylineIndex: 1 }),
    ];

    const wps = resolveWaypoints(instructions, path);
    expect(wps[0].alongM).toBe(0);
    expect(wps[1].alongM).toBeGreaterThan(900);
  });
});

describe("resolveActiveBusLegOrdinal", () => {
  it("returns null when the route has no bus steps", () => {
    expect(resolveActiveBusLegOrdinal(compositeRoute, 0)).toBeNull();
    expect(resolveActiveBusLegOrdinal([], 0)).toBeNull();
  });

  const twoBusRuns: NavInstruction[] = [
    instruction("WALK", { type: "depart" }), // 0
    instruction("BUS"), // 1
    instruction("BUS"), // 2
    instruction("WALK"), // 3
    instruction("BUS"), // 4
    instruction("WALK", { type: "arrive" }), // 5
  ];

  it("returns the run the current step sits inside", () => {
    expect(resolveActiveBusLegOrdinal(twoBusRuns, 1)).toBe(0);
    expect(resolveActiveBusLegOrdinal(twoBusRuns, 2)).toBe(0);
    expect(resolveActiveBusLegOrdinal(twoBusRuns, 4)).toBe(1);
  });

  it("looks ahead to the next bus run while still walking", () => {
    expect(resolveActiveBusLegOrdinal(twoBusRuns, 0)).toBe(0);
    expect(resolveActiveBusLegOrdinal(twoBusRuns, 3)).toBe(1);
  });

  it("returns null once every bus run is behind the user", () => {
    expect(resolveActiveBusLegOrdinal(twoBusRuns, 5)).toBeNull();
  });

  it("treats a trailing bus run as trackable", () => {
    const endsOnBus = [instruction("WALK"), instruction("BUS")];
    expect(resolveActiveBusLegOrdinal(endsOnBus, 0)).toBe(0);
    expect(resolveActiveBusLegOrdinal(endsOnBus, 1)).toBe(0);
  });
});
