import { describe, expect, it } from "vitest";
import { buildCumulativePath } from "@/lib/geo";
import type {
  AccessibleRoute,
  BusDepartureCandidate,
  BusLeg,
} from "@/types/route";
import {
  estimateNavigationEta,
  selectedDepartureLiveMinutes,
} from "../navigationEta";

const now = Date.parse("2026-10-22T10:00:00+08:00");
const route = {
  routeToken: "route",
  totalMinutes: 22,
  legs: [
    {
      type: "WALK",
      minutesEst: 2,
      polyline: [
        [121, 25],
        [121.001, 25],
      ],
    },
    {
      type: "BUS",
      departureTime: "10:05",
      arrivalTime: "10:15",
      estimatedWaitMinutes: 5,
      polyline: [
        [121.001, 25],
        [121.011, 25],
      ],
    },
    {
      type: "WALK",
      minutesEst: 2,
      polyline: [
        [121.011, 25],
        [121.012, 25],
      ],
    },
  ],
} as AccessibleRoute;
const path = buildCumulativePath(route.legs);
const estimate = (
  input: Partial<Parameters<typeof estimateNavigationEta>[0]> = {},
) =>
  estimateNavigationEta({
    route,
    path,
    progress: null,
    currentLegIndex: 1,
    boarded: false,
    now,
    liveBusLegIndex: 1,
    ...input,
  });

describe("stage-based transit ETA", () => {
  it("refreshes while waiting without a new location or progress sample", () => {
    expect(estimate({ liveMinutes: 7 }).remainingDurationSec).toBe(19 * 60);
    expect(estimate({ liveMinutes: 3 }).remainingDurationSec).toBe(15 * 60);
    expect(estimate({ liveMinutes: 3 }).etaSource).toBe("realtime");
  });
  it("uses chosen-vehicle alighting ETA when boarded and keeps the final walk", () => {
    expect(
      estimate({ boarded: true, liveMinutes: 4 }).remainingDurationSec,
    ).toBe(6 * 60);
  });
  it("does not count walking to the boarding stop twice in a live wait", () => {
    expect(
      estimate({ currentLegIndex: 0, liveMinutes: 5 }).remainingDurationSec,
    ).toBe(17 * 60);
  });
  it("adds planned waits after reaching the stop, including later rail transfers", () => {
    const mixed = structuredClone(route);
    if (mixed.legs[0].type !== "WALK") throw new Error("Walk fixture");
    mixed.legs[0].minutesEst = 10;
    expect(
      estimate({ route: mixed, currentLegIndex: 0 }).remainingDurationSec,
    ).toBe(27 * 60);
    mixed.legs.push({
      type: "METRO",
      rideMinutes: 8,
      estimatedWaitMinutes: 4,
      polyline: [],
    } as unknown as AccessibleRoute["legs"][number]);
    expect(
      estimate({ route: mixed, currentLegIndex: 0 }).remainingDurationSec,
    ).toBe(39 * 60);
  });
  it("does not re-add the bus wait when the next walking step appears before another GPS fix", () => {
    const progress = {
      routeToken: "route",
      navigationId: null,
      routeVersion: 0,
      legIndex: 1,
      segmentIndex: 2,
      alongM: path.cumM[3],
      observedAt: now,
      source: "gps" as const,
    };
    expect(
      estimate({ progress, currentLegIndex: 2, boarded: false })
        .remainingDurationSec,
    ).toBe(2 * 60);
  });
  it("labels distance-based riding fallback as estimated", () => {
    const middle = (path.cumM[2] + path.cumM[3]) / 2;
    const progress = {
      routeToken: "route",
      navigationId: null,
      routeVersion: 0,
      legIndex: 1,
      segmentIndex: 2,
      alongM: middle,
      observedAt: now,
      source: "gps" as const,
    };
    expect(estimate({ boarded: true, progress })).toMatchObject({
      remainingDurationSec: 7 * 60,
      etaSource: "estimated",
    });
  });
  it("counts down the selected scheduled departure and uses its exact ride duration", () => {
    const selected = structuredClone(route);
    const bus = selected.legs[1];
    if (bus.type !== "BUS") throw new Error("Bus fixture");
    bus.selectedDeparture = {
      boardingTime: "2026-10-22T10:04:00+08:00",
      alightingTime: "2026-10-22T10:12:00+08:00",
    } as NonNullable<typeof bus.selectedDeparture>;
    expect(estimate({ route: selected }).remainingDurationSec).toBe(14 * 60);
    expect(
      estimate({ route: selected, now: now + 60_000 }).remainingDurationSec,
    ).toBe(13 * 60);
  });
  it("does not invent missing bus ride time from whole-route distance", () => {
    const unknown = structuredClone(route);
    const bus = unknown.legs[1];
    if (bus.type !== "BUS") throw new Error("Bus fixture");
    delete bus.departureTime;
    expect(estimate({ route: unknown })).toMatchObject({
      remainingDurationSec: null,
      estimatedArrivalAt: null,
    });
  });
});

describe("selected service live times", () => {
  const selected = {
    candidateId: "changing-time",
    subRouteUid: "99A",
    direction: 0,
    plateNumb: "AAA-123",
    departureStopId: "A",
    arrivalStopId: "B",
    selected: true,
    boardingTime: "2026-10-22T10:03:00+08:00",
    alightingTime: "2026-10-22T10:12:00+08:00",
    boardingTimeSource: "realtime",
    alightingTimeSource: "realtime",
  } as BusDepartureCandidate;
  const leg = { ...route.legs[1], selectedDeparture: selected } as BusLeg;
  it("reads exact selected waiting and riding ETAs without vehicle coordinates", () => {
    expect(selectedDepartureLiveMinutes(leg, [selected], false, now)).toBe(3);
    expect(selectedDepartureLiveMinutes(leg, [selected], true, now)).toBe(12);
  });
  it.each([
    { plateNumb: "OTHER" },
    { subRouteUid: "99B" },
    { direction: 1 },
    { arrivalStopId: "OTHER" },
    { selected: false },
    { boardingTimeSource: "schedule" },
    { boardingTime: "invalid" },
  ])("rejects mismatched or non-realtime data %j", (change) => {
    expect(
      selectedDepartureLiveMinutes(
        leg,
        [{ ...selected, ...change } as BusDepartureCandidate],
        false,
        now,
      ),
    ).toBeNull();
  });
  it("rejects ambiguous records and a different scheduled trip", () => {
    expect(
      selectedDepartureLiveMinutes(leg, [selected, selected], false, now),
    ).toBeNull();
    const scheduled = {
      ...leg,
      selectedDeparture: {
        ...selected,
        plateNumb: undefined,
        tripId: "trip-A",
      },
    };
    expect(
      selectedDepartureLiveMinutes(
        scheduled,
        [{ ...selected, tripId: "trip-B" }],
        false,
        now,
      ),
    ).toBeNull();
  });
});
