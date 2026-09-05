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

  // Regression: a stationary user at the origin used to have every maneuver
  // inside one arrive radius counted as reached at once, so navigation opened
  // several steps in. Position alone decided the step, so exiting and
  // navigating another route from the same spot re-derived the same step and
  // looked like the old step index had been remembered.
  it("opens on the first real maneuver when the user is at the route start", () => {
    const walkRoute = [
      instruction("WALK", { type: "depart" }),
      instruction("WALK"),
      instruction("WALK"),
      instruction("WALK"),
    ];
    // Depart at 0, then turns 8 m and 15 m in — all three inside the 18 m
    // walking radius — before the route opens up at 120 m.
    const dense = [
      { alongM: 0 },
      { alongM: 8 },
      { alongM: 15 },
      { alongM: 120 },
    ];
    expect(selectNextStepIndex(walkRoute, dense, 0)).toBe(1);
  });

  it("never swallows a driving maneuver the user has not passed", () => {
    const driveRoute = [
      instruction("DRIVE", { type: "depart" }),
      instruction("DRIVE"),
      instruction("DRIVE"),
      instruction("DRIVE"),
    ];
    // 30 m and 55 m are both well inside the 60 m driving radius.
    const dense = [
      { alongM: 0 },
      { alongM: 30 },
      { alongM: 55 },
      { alongM: 900 },
    ];
    expect(selectNextStepIndex(driveRoute, dense, 0)).toBe(1);
    expect(selectNextStepIndex(driveRoute, dense, 20)).toBe(2);
  });

  it("advances monotonically as the user moves through dense maneuvers", () => {
    const walkRoute = [
      instruction("WALK", { type: "depart" }),
      instruction("WALK"),
      instruction("WALK"),
      instruction("WALK"),
    ];
    const dense = [
      { alongM: 0 },
      { alongM: 8 },
      { alongM: 15 },
      { alongM: 120 },
    ];
    const walked = [0, 2, 4, 6, 8, 10, 12, 15, 40, 80, 119];
    const seen = walked.map((m) => selectNextStepIndex(walkRoute, dense, m));
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    }
    expect(seen[0]).toBe(1);
    expect(seen[seen.length - 1]).toBe(3);
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

describe("resolveWaypoints with per-leg and fallback steps", () => {
  it("resolves per-leg waypoints along the cumulative path", () => {
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

    // Each index is local to its source leg.
    const instructions = [
      instruction("DRIVE", { legIndex: 0, polylineIndex: 0 }),
      instruction("WALK", { legIndex: 1, polylineIndex: 0 }),
    ];

    const wps = resolveWaypoints(instructions, path);
    expect(wps[0].alongM).toBe(0);
    expect(wps[1].alongM).toBeGreaterThan(900);
  });

  // An unanchored instruction used to fall back to the route's last point,
  // which put it past every later maneuver and broke step selection.
  it("inherits the previous maneuver point for an unanchored instruction", () => {
    const leg: RouteLeg = {
      type: "WALK",
      from: "A",
      to: "B",
      distanceM: 200,
      minutesEst: 3,
      polyline: [
        [121.5, 25.0],
        [121.501, 25.0],
        [121.502, 25.0],
      ],
      a11yFacilities: [],
    };
    const path = buildCumulativePath([leg]);
    const instructions = [
      instruction("WALK", { legIndex: 0, polylineIndex: 0 }),
      instruction("WALK", { legIndex: 0, polylineIndex: null }),
      instruction("WALK", { legIndex: 0, polylineIndex: 2 }),
    ];

    const wps = resolveWaypoints(instructions, path);
    expect(wps[1].alongM).toBe(wps[0].alongM);
    expect(wps[1].alongM).toBeLessThan(wps[2].alongM);
  });

  it("keeps the waypoint list non-decreasing when the first index is null", () => {
    const leg: RouteLeg = {
      type: "WALK",
      from: "A",
      to: "B",
      distanceM: 200,
      minutesEst: 3,
      polyline: [
        [121.5, 25.0],
        [121.501, 25.0],
      ],
      a11yFacilities: [],
    };
    const path = buildCumulativePath([leg]);
    const wps = resolveWaypoints(
      [
        instruction("WALK", { legIndex: 0, polylineIndex: null }),
        instruction("WALK", { legIndex: 0, polylineIndex: 1 }),
      ],
      path,
    );
    expect(wps[0].alongM).toBe(0);
    expect(wps[1].alongM).toBeGreaterThan(0);
  });

  it("uses legacy global indices and null inheritance without legIndex", () => {
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
    const path = buildCumulativePath([driveLeg, walkLeg]);
    const wps = resolveWaypoints(
      [
        instruction("WALK", { polylineIndex: null }),
        instruction("WALK", { polylineIndex: 2 }),
        instruction("WALK", { polylineIndex: null }),
      ],
      path,
    );

    expect(wps[0].alongM).toBe(0);
    expect(wps[1].coord).toEqual(path.path[2]);
    expect(wps[2].alongM).toBe(wps[1].alongM);
  });

  it("anchors a final walking arrival to the third leg's true endpoint", () => {
    const firstWalkLeg: RouteLeg = {
      type: "WALK",
      from: "A",
      to: "TRA station",
      distanceM: 200,
      minutesEst: 3,
      polyline: [
        [121.5, 25.0],
        [121.501, 25.0],
        [121.502, 25.0],
      ],
      a11yFacilities: [],
    };
    const traLeg: RouteLeg = {
      type: "TRA",
      trainNo: "3248",
      trainTypeName: "Local",
      departureStation: "TRA station",
      arrivalStation: "Destination station",
      departureStationUID: "TRA-A",
      arrivalStationUID: "TRA-B",
      departureTime: "10:00",
      arrivalTime: "10:10",
      rideMinutes: 10,
      waitInfo: { time: null, source: "unavailable" },
      estimatedWaitMinutes: 0,
      polyline: [
        [121.502, 25.0],
        [121.51, 25.0],
        [121.52, 25.0],
      ],
      departureStationA11y: [],
      arrivalStationA11y: [],
      facilityHighlights: [],
    };
    const finalWalkLeg: RouteLeg = {
      type: "WALK",
      from: "Destination station",
      to: "C",
      distanceM: 200,
      minutesEst: 3,
      polyline: [
        [121.52, 25.0],
        [121.521, 25.0],
        [121.522, 25.0],
      ],
      a11yFacilities: [],
    };
    const path = buildCumulativePath([firstWalkLeg, traLeg, finalWalkLeg]);
    const wps = resolveWaypoints(
      [
        instruction("WALK", {
          type: "depart",
          legIndex: 0,
          polylineIndex: 0,
        }),
        instruction("WALK", { legIndex: 2, polylineIndex: 0 }),
        instruction("WALK", {
          type: "arrive",
          legIndex: 2,
          polylineIndex: null,
        }),
      ],
      path,
    );
    const finalWaypoint = wps[wps.length - 1];
    const firstWalkLength = path.cumM[firstWalkLeg.polyline.length - 1] ?? 0;

    expect(finalWaypoint.coord).toEqual({ lat: 25.0, lng: 121.522 });
    expect(finalWaypoint.alongM).toBeGreaterThan(firstWalkLength);
  });

  it("anchors transit board and alight instructions to their leg endpoints", () => {
    const firstWalkLeg: RouteLeg = {
      type: "WALK",
      from: "A",
      to: "TRA station",
      distanceM: 100,
      minutesEst: 2,
      polyline: [
        [121.5, 25.0],
        [121.501, 25.0],
      ],
      a11yFacilities: [],
    };
    const traLeg: RouteLeg = {
      type: "TRA",
      trainNo: "3248",
      trainTypeName: "Local",
      departureStation: "TRA station",
      arrivalStation: "Destination station",
      departureStationUID: "TRA-A",
      arrivalStationUID: "TRA-B",
      departureTime: "10:00",
      arrivalTime: "10:10",
      rideMinutes: 10,
      waitInfo: { time: null, source: "unavailable" },
      estimatedWaitMinutes: 0,
      polyline: [
        [121.501, 25.0],
        [121.51, 25.0],
        [121.52, 25.0],
      ],
      departureStationA11y: [],
      arrivalStationA11y: [],
      facilityHighlights: [],
    };
    const path = buildCumulativePath([firstWalkLeg, traLeg]);
    const wps = resolveWaypoints(
      [
        instruction("TRA", {
          type: "transit_board",
          legIndex: 1,
          polylineIndex: null,
        }),
        instruction("TRA", {
          type: "transit_alight",
          legIndex: 1,
          polylineIndex: null,
        }),
      ],
      path,
    );

    expect(wps[0].coord).toEqual({ lat: 25.0, lng: 121.501 });
    expect(wps[1].coord).toEqual({ lat: 25.0, lng: 121.52 });
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
