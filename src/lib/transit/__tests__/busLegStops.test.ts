import { describe, expect, it } from "vitest";
import type { RouteDetailStop } from "@/lib/api/transit";
import {
  buildStopRows,
  busLegKey,
  CURRENT_STOP_RADIUS_M,
  fallbackStopRows,
  normalizeStopName,
  parseStatusLabel,
  pickDirection,
  resolveCurrentStopSeq,
  resolveEtaLabel,
  resolveLegDirection,
  resolveLegRide,
  resolveLegStops,
  sliceLegStops,
  withPlannedStopNames,
} from "@/lib/transit/busLegStops";
import type { BusLeg } from "@/types/route";

function stop(
  seq: number,
  name: string,
  overrides: Partial<RouteDetailStop> = {},
): RouteDetailStop {
  return {
    seq,
    name,
    lat: 25.03 + seq * 0.01,
    lng: 121.5,
    estimateMinutes: null,
    statusLabel: "",
    ...overrides,
  };
}

const line = [
  stop(1, "起點"),
  stop(2, "A站"),
  stop(3, "B站"),
  stop(4, "C站"),
  stop(5, "終點"),
];

describe("planned ETA source names", () => {
  it("uses same-leg sources without sending lang to the strict capability endpoint", () => {
    const leg = {
      departureStop: "起點",
      arrivalStop: "終點",
      fromNameEn: "Start",
      toNameEn: "End",
      intermediateStops: [
        { name: "同名", nameEn: "First" },
        { name: "同名", nameEn: "Second" },
      ],
    } as BusLeg;
    const rows = buildStopRows(
      [stop(1, "起點"), stop(2, "同名"), stop(3, "同名"), stop(4, "終點")],
      2,
    );
    expect(
      withPlannedStopNames(rows, leg, "en").map((r) => r.displayName),
    ).toEqual(["Start", "First", "Second", "End"]);
    expect(
      withPlannedStopNames(rows, leg, "zh-TW").map((r) => r.displayName),
    ).toEqual(["起點", "同名", "同名", "終點"]);
    expect(rows[1].name).toBe("同名");
    expect(rows[1].state).toBe("current");
    const other = rows.map((r, i) => (i === 1 ? { ...r, name: "另一站" } : r));
    expect(withPlannedStopNames(other, leg, "en")).toBe(other);
    const missing = rows.slice(1);
    expect(withPlannedStopNames(missing, leg, "en")).toBe(missing);
  });
});

describe("pickDirection", () => {
  it("returns the stops of the matching direction", () => {
    const stops = pickDirection(
      [
        { direction: 0, stops: line },
        { direction: 1, stops: [...line].reverse() },
      ],
      1,
    );
    expect(stops?.[0].name).toBe("終點");
  });

  it("returns null when the direction is missing or empty", () => {
    expect(pickDirection(undefined, 0)).toBeNull();
    expect(pickDirection([{ direction: 0, stops: [] }], 0)).toBeNull();
    expect(pickDirection([{ direction: 0, stops: line }], 1)).toBeNull();
  });

  it("never treats 255 (direction unknown) as a ride", () => {
    expect(pickDirection([{ direction: 255, stops: line }], 255)).toBeNull();
  });

  it("refuses to guess between branches sharing a direction number", () => {
    const branches = [
      { direction: 0 as const, subRouteUid: "A", stops: line },
      { direction: 0 as const, subRouteUid: "B", stops: [...line].reverse() },
    ];
    expect(pickDirection(branches, 0)).toBeNull();
    expect(pickDirection(branches, 0, "B")?.[0].name).toBe("終點");
    expect(pickDirection(branches, 0, "C")).toBeNull();
  });
});

describe("sliceLegStops", () => {
  it("cuts the inclusive board → alight range", () => {
    const sliced = sliceLegStops(line, "A站", "C站");
    expect(sliced?.map((s) => s.name)).toEqual(["A站", "B站", "C站"]);
  });

  it("trims whitespace on both sides of the comparison", () => {
    const padded = [stop(1, " A站 "), stop(2, "B站")];
    expect(sliceLegStops(padded, "A站", " B站")?.length).toBe(2);
  });

  it("returns null when the board stop is absent", () => {
    expect(sliceLegStops(line, "不存在", "C站")).toBeNull();
  });

  it("returns null when the alight stop is absent", () => {
    expect(sliceLegStops(line, "A站", "不存在")).toBeNull();
  });

  it("returns null when the alight stop only appears before the board stop", () => {
    expect(sliceLegStops(line, "C站", "A站")).toBeNull();
  });

  it("rejects a repeated departure stop instead of taking the first", () => {
    const repeated = [
      stop(1, "A站"),
      stop(2, "B站"),
      stop(3, "A站"),
      stop(4, "C站"),
    ];
    expect(sliceLegStops(repeated, "A站", "C站")).toBeNull();
  });

  it("rejects a loop that reaches both stops on two laps", () => {
    const twoLaps = [
      stop(1, "A站"),
      stop(2, "B站"),
      stop(3, "A站"),
      stop(4, "B站"),
    ];
    expect(sliceLegStops(twoLaps, "A站", "B站")).toBeNull();
  });

  it("does not wrap past the end of the line", () => {
    expect(
      sliceLegStops([stop(1, "A站"), stop(2, "B站")], "B站", "A站"),
    ).toBeNull();
  });

  it("takes the single forward lap on a loop", () => {
    const loop = [
      stop(1, "總站"),
      stop(2, "A站"),
      stop(3, "總站"),
      stop(4, "A站"),
    ];
    expect(sliceLegStops(loop, "A站", "總站")?.map((s) => s.seq)).toEqual([
      2, 3,
    ]);
  });
});

describe("resolveCurrentStopSeq", () => {
  it("returns null without a vehicle", () => {
    expect(resolveCurrentStopSeq(line, null)).toBeNull();
  });

  it("returns the nearest stop when the vehicle is at it", () => {
    const target = line[2];
    expect(
      resolveCurrentStopSeq(line, { lat: target.lat, lng: target.lng }),
    ).toBe(3);
  });

  it("returns null when the vehicle is between stops", () => {
    // 0.01° of latitude is ~1.1 km, comfortably outside the radius.
    expect(
      resolveCurrentStopSeq(line, { lat: line[2].lat + 0.01, lng: 121.6 }),
    ).toBeNull();
  });

  it("honours a widened radius", () => {
    const seq = resolveCurrentStopSeq(
      line,
      { lat: line[0].lat + 0.005, lng: line[0].lng },
      CURRENT_STOP_RADIUS_M * 10,
    );
    expect(seq).toBe(1);
  });
});

describe("buildStopRows", () => {
  it("marks board / intermediate / alight kinds", () => {
    const rows = buildStopRows(line, null);
    expect(rows.map((r) => r.kind)).toEqual([
      "board",
      "intermediate",
      "intermediate",
      "intermediate",
      "alight",
    ]);
    expect(rows.every((r) => r.state === "upcoming")).toBe(true);
  });

  it("splits passed / current / upcoming around the current seq", () => {
    const rows = buildStopRows(line, 3);
    expect(rows.map((r) => r.state)).toEqual([
      "passed",
      "passed",
      "current",
      "upcoming",
      "upcoming",
    ]);
  });

  it("carries the ETA fields through", () => {
    const rows = buildStopRows(
      [stop(1, "A站", { estimateMinutes: 4, statusLabel: "正常" })],
      null,
    );
    expect(rows[0].estimateMinutes).toBe(4);
    expect(rows[0].statusLabel).toBe("正常");
  });
});

describe("fallbackStopRows", () => {
  const leg = {
    type: "BUS",
    routeName: "307",
    departureStop: "板橋",
    arrivalStop: "台北車站",
    direction: 0,
    intermediateStops: [{ name: "中間站", stationUid: "UID-1" }],
  } as BusLeg;

  it("builds name-only rows with no ETA", () => {
    const rows = fallbackStopRows(leg);
    expect(rows.map((r) => r.name)).toEqual(["板橋", "中間站", "台北車站"]);
    expect(rows.map((r) => r.kind)).toEqual([
      "board",
      "intermediate",
      "alight",
    ]);
    expect(rows.every((r) => r.estimateMinutes === null)).toBe(true);
    expect(rows.every((r) => r.state === "upcoming")).toBe(true);
    expect(rows[1].stationUid).toBe("UID-1");
  });

  it("still yields board and alight without intermediate stops", () => {
    const rows = fallbackStopRows({ ...leg, intermediateStops: undefined });
    expect(rows).toHaveLength(2);
  });
});

describe("parseStatusLabel", () => {
  it("returns nothing for an absent label", () => {
    expect(parseStatusLabel("")).toBeNull();
    expect(parseStatusLabel("   ")).toBeNull();
  });

  it("reads the next departure time the backend wrote into the label", () => {
    expect(parseStatusLabel("18:15")).toEqual({
      key: "busScheduledAt",
      params: { time: "18:15" },
      tone: "normal",
      kind: "scheduled",
    });
  });

  it("flags a departure timed from the line's origin", () => {
    expect(parseStatusLabel("18:15 起點發車")).toEqual({
      key: "busScheduledFromOrigin",
      params: { time: "18:15" },
      tone: "normal",
      kind: "scheduled",
    });
  });

  it("flags tomorrow's first service", () => {
    expect(parseStatusLabel("明日 06:00")).toEqual({
      key: "busScheduledTomorrow",
      params: { time: "06:00" },
      tone: "normal",
      kind: "scheduled",
    });
    expect(parseStatusLabel("明日 06:00 起點發車")?.key).toBe(
      "busScheduledTomorrowFromOrigin",
    );
  });

  it("accepts a single-digit hour", () => {
    expect(parseStatusLabel("6:05")).toEqual({
      key: "busScheduledAt",
      params: { time: "6:05" },
      tone: "normal",
      kind: "scheduled",
    });
  });

  it("keeps the TDX statuses the backend never overwrites", () => {
    expect(parseStatusLabel("末班車已過")?.key).toBe("busServiceEnded");
    expect(parseStatusLabel("今日未營運")?.key).toBe("busNoServiceToday");
    expect(parseStatusLabel("交管不停靠")?.key).toBe("busStopSkipped");
    expect(parseStatusLabel("尚未發車")?.key).toBe("busNotDeparted");
  });

  it("reads a published headway as scheduled, not live", () => {
    expect(parseStatusLabel("每 5–10 分一班")).toEqual({
      key: "busHeadwayRange",
      params: { min: 5, max: 10 },
      tone: "muted",
      kind: "scheduled",
    });
    expect(parseStatusLabel("每 5-10 分一班")?.key).toBe("busHeadwayRange");
    expect(parseStatusLabel("每 12 分一班")).toEqual({
      key: "busHeadway",
      params: { count: 12 },
      tone: "muted",
      kind: "scheduled",
    });
    expect(parseStatusLabel("每 分一班")).toBeNull();
  });

  it("maps the arrival feed's 暫無到站資訊", () => {
    expect(parseStatusLabel("暫無到站資訊")).toEqual({
      key: "busArrivalUnavailable",
      tone: "muted",
      kind: "status",
    });
  });

  it("returns null for labels that say nothing useful", () => {
    expect(parseStatusLabel("正常")).toBeNull();
    expect(parseStatusLabel("誰知道")).toBeNull();
  });
});

describe("resolveEtaLabel", () => {
  const row = (
    estimateMinutes: number | null,
    state: "passed" | "current" | "upcoming" = "upcoming",
    statusLabel = "",
    pending = false,
  ) =>
    ({
      seq: 1,
      name: "A站",
      estimateMinutes,
      statusLabel,
      state,
      kind: "intermediate",
      pending,
    }) as const;

  it("maps 0 minutes to arriving", () => {
    expect(resolveEtaLabel(row(0))).toEqual({
      key: "busArrivalArriving",
      tone: "arriving",
      kind: "eta",
    });
  });

  it("maps under 3 minutes to due", () => {
    expect(resolveEtaLabel(row(2))).toEqual({
      key: "busArrivalSoon",
      tone: "arriving",
      kind: "eta",
    });
  });

  it("maps single-digit minutes to the soon tone", () => {
    expect(resolveEtaLabel(row(5))).toEqual({
      key: "busArrivalMinutes",
      params: { count: 5 },
      tone: "soon",
      kind: "eta",
    });
  });

  it("maps 10+ minutes to the normal tone", () => {
    expect(resolveEtaLabel(row(30))).toEqual({
      key: "busArrivalMinutes",
      params: { count: 30 },
      tone: "normal",
      kind: "eta",
    });
  });

  // Regression: placeholder rows used to render as 「尚未發車」 while the
  // route-detail request was still in flight, contradicting the plan's own
  // "18:15 發車" badge.
  it("reports pending, not a status, while the lookup is still running", () => {
    const pendingRow = row(null, "upcoming", "", true);
    expect(resolveEtaLabel(pendingRow).kind).toBe("pending");
    expect(resolveEtaLabel(pendingRow).key).toBeUndefined();
    expect(resolveEtaLabel(row(-1, "upcoming", "", true)).kind).toBe("pending");
  });

  // The backend leaves StopStatus 0 as 「正常」 and computes estimateMinutes
  // independently, so 「正常」 + null ETA is a real combination. Calling that
  // "no service" is the misleading claim this whole change exists to remove.
  it("reports unavailable rather than inventing no service once settled", () => {
    expect(resolveEtaLabel(row(null, "upcoming", "正常"))).toEqual({
      key: "busArrivalUnavailable",
      tone: "muted",
      kind: "status",
    });
    for (const status of ["", "  ", "暫無到站資訊"]) {
      expect(resolveEtaLabel(row(null, "upcoming", status)).key).toBe(
        "busArrivalUnavailable",
      );
    }
  });

  it("shows the next departure time instead of a missing ETA", () => {
    expect(resolveEtaLabel(row(null, "upcoming", "18:15"))).toEqual({
      key: "busScheduledAt",
      params: { time: "18:15" },
      tone: "normal",
      kind: "scheduled",
    });
    expect(resolveEtaLabel(row(-1, "upcoming", "明日 06:00")).key).toBe(
      "busScheduledTomorrow",
    );
  });

  it("keeps 末班車已過 as an end-of-service status", () => {
    expect(resolveEtaLabel(row(null, "upcoming", "末班車已過"))).toEqual({
      key: "busServiceEnded",
      tone: "muted",
      kind: "status",
    });
  });

  it("prefers a live ETA over the status label", () => {
    expect(resolveEtaLabel(row(4, "upcoming", "18:15")).key).toBe(
      "busArrivalMinutes",
    );
  });

  it("lets passed override any ETA", () => {
    expect(resolveEtaLabel(row(2, "passed"))).toEqual({
      key: "busStopPassed",
      tone: "muted",
      kind: "status",
    });
  });
});

describe("normalizeStopName", () => {
  it("folds the variants TDX and the planner disagree on", () => {
    expect(normalizeStopName("高鐵臺中站(第11月台)")).toBe(
      normalizeStopName("高鐵台中"),
    );
    expect(normalizeStopName("國立臺中科技大學")).toBe("國立台中科技大學");
    expect(normalizeStopName(" 中和 （黎明路） ")).toBe("中和");
    expect(normalizeStopName(undefined)).toBe("");
  });
});

describe("sliceLegStops name matching", () => {
  const stop = (seq: number, name: string) => ({
    seq,
    name,
    lat: 0,
    lng: 0,
    estimateMinutes: null,
    statusLabel: "",
  });

  it("matches across 臺/台 and a bracketed platform note", () => {
    const stops = [
      stop(0, "永順文心南七路口"),
      stop(1, "豐樂公園"),
      stop(2, "高鐵臺中站(第11月台)"),
    ];
    const sliced = sliceLegStops(stops, "永順文心南七路口", "高鐵台中站");
    expect(sliced?.map((s) => s.seq)).toEqual([0, 1, 2]);
  });

  it("prefers an exact match over a containment match", () => {
    const stops = [
      stop(0, "板橋"),
      stop(1, "板橋國中"),
      stop(2, "板橋"),
      stop(3, "終點"),
    ];
    // "板橋國中" contains "板橋", so a containment-first pass would board at 0.
    const sliced = sliceLegStops(stops, "板橋國中", "終點");
    expect(sliced?.map((s) => s.seq)).toEqual([1, 2, 3]);
  });
});

describe("resolveLegStops", () => {
  const line = (names: string[]) =>
    names.map((name, seq) => ({
      seq,
      name,
      lat: 0,
      lng: 0,
      estimateMinutes: null,
      statusLabel: "正常",
    }));

  const outbound = line([
    "高鐵臺中站(第11月台)",
    "豐樂公園",
    "永順文心南七路口",
  ]);
  const inbound = line([
    "永順文心南七路口",
    "豐樂公園",
    "高鐵臺中站(第11月台)",
  ]);
  const directions = [
    { direction: 0 as const, stops: outbound },
    { direction: 1 as const, stops: inbound },
  ];

  const leg = {
    direction: 0 as const,
    departureStop: "永順文心南七路口",
    arrivalStop: "高鐵臺中站(第11月台)",
  };

  // Regression: 365 / 26 declare direction 0 while the ride only exists in
  // direction 1, so slicing the declared direction found no arrival stop after
  // the departure stop and every badge was left with no data at all.
  it("falls through to the other direction when the declared one cannot hold the ride", () => {
    const sliced = resolveLegStops(directions, leg);
    expect(sliced?.map((s) => s.name)).toEqual([
      "永順文心南七路口",
      "豐樂公園",
      "高鐵臺中站(第11月台)",
    ]);
  });

  it("uses the declared direction when it does contain the ride", () => {
    const sliced = resolveLegStops(directions, { ...leg, direction: 1 });
    expect(sliced?.[0].name).toBe("永順文心南七路口");
  });

  it("returns null when neither direction contains the ride", () => {
    expect(
      resolveLegStops(directions, { ...leg, arrivalStop: "不存在的站" }),
    ).toBeNull();
    expect(resolveLegStops(undefined, leg)).toBeNull();
  });
});

describe("resolveLegStops sub-route scoping", () => {
  const line = (names: string[]) =>
    names.map((name, seq) => ({
      seq,
      name,
      lat: 0,
      lng: 0,
      estimateMinutes: null,
      statusLabel: "正常",
    }));

  // 99 and 99延 share a name and a direction number but not a stop list: only
  // 99延 reaches 臺中區監理所.
  const directions = [
    {
      direction: 0 as const,
      subRouteUid: "TXG99",
      subRouteName: "99",
      stops: line(["豐樂公園", "美榮藥局", "仁友停車場"]),
    },
    {
      direction: 0 as const,
      subRouteUid: "TXG991",
      subRouteName: "99延",
      stops: line(["豐樂公園", "美榮藥局", "臺中區監理所(遊園路)"]),
    },
  ];

  it("rides the sub-route the planner booked, not the first that fits", () => {
    const sliced = resolveLegStops(directions, {
      direction: 0,
      departureStop: "豐樂公園",
      arrivalStop: "美榮藥局",
      subRouteUid: "TXG991",
    });
    expect(sliced?.map((s) => s.name)).toEqual(["豐樂公園", "美榮藥局"]);
    // Scoped to 99延, so the stop only 99 serves must not leak in.
    expect(
      resolveLegStops(directions, {
        direction: 0,
        departureStop: "豐樂公園",
        arrivalStop: "仁友停車場",
        subRouteUid: "TXG991",
      }),
    ).toBeNull();
  });

  it("falls back to geometry when the leg names no sub-route", () => {
    const sliced = resolveLegStops(directions, {
      direction: 0,
      departureStop: "豐樂公園",
      arrivalStop: "臺中區監理所(遊園路)",
    });
    expect(sliced?.at(-1)?.name).toBe("臺中區監理所(遊園路)");
  });

  // Rows that explicitly name another branch are evidence against the ride.
  it("does not borrow a different known branch for an unknown sub-route", () => {
    expect(
      resolveLegStops(directions, {
        direction: 0,
        departureStop: "豐樂公園",
        arrivalStop: "仁友停車場",
        subRouteUid: "TXG-nope",
      }),
    ).toBeNull();
  });

  it("lets an unknown sub-route fall back only to rows carrying no UID", () => {
    const unlabelled = [{ direction: 0 as const, stops: line(["A", "B"]) }];
    expect(
      resolveLegStops(unlabelled, {
        direction: 0,
        departureStop: "A",
        arrivalStop: "B",
        subRouteUid: "TXG-nope",
      })?.length,
    ).toBe(2);
  });

  it("does not let the GTFS direction break a tie between two fitting runs", () => {
    const both = [
      {
        direction: 1 as const,
        subRouteUid: "TXG99",
        stops: line(["A", "B", "C"]),
      },
      {
        direction: 0 as const,
        subRouteUid: "TXG99",
        stops: line(["A", "B", "C"]),
      },
    ];
    const ref = {
      direction: 0 as const,
      departureStop: "A",
      arrivalStop: "C",
      subRouteUid: "TXG99",
    };
    expect(resolveLegDirection(both, ref)).toBeNull();
    expect(resolveLegDirection(both, { ...ref, direction: 1 })).toBeNull();
  });

  it("resolves when only one of a sub-route's runs holds the ride", () => {
    const runs = [
      {
        direction: 1 as const,
        subRouteUid: "TXG99",
        stops: line(["C", "B", "A"]),
      },
      {
        direction: 0 as const,
        subRouteUid: "TXG99",
        stops: line(["A", "B", "C"]),
      },
    ];
    expect(
      resolveLegDirection(runs, {
        direction: 1,
        departureStop: "A",
        arrivalStop: "C",
        subRouteUid: "TXG99",
      }),
    ).toBe(0);
  });
});

describe("resolveLegRide", () => {
  const line = (names: string[]) =>
    names.map((name, seq) => ({
      seq,
      name,
      lat: 0,
      lng: 0,
      estimateMinutes: null,
      statusLabel: "正常",
    }));
  const ref = {
    direction: 0 as const,
    departureStop: "A",
    arrivalStop: "C",
  };

  it("never resolves a 255 run into a ride", () => {
    expect(
      resolveLegRide([{ direction: 255, stops: line(["A", "B", "C"]) }], ref),
    ).toBeNull();
  });

  it("accepts the loop (2) and circular (10) directions", () => {
    expect(
      resolveLegRide([{ direction: 2, stops: line(["A", "B", "C"]) }], ref)
        ?.direction,
    ).toBe(2);
    expect(
      resolveLegRide([{ direction: 10, stops: line(["A", "B", "C"]) }], ref)
        ?.direction,
    ).toBe(10);
  });

  it("refuses when two branches without a UID both fit", () => {
    expect(
      resolveLegRide(
        [
          { direction: 0, subRouteUid: "X", stops: line(["A", "B", "C"]) },
          { direction: 0, subRouteUid: "Y", stops: line(["A", "C"]) },
        ],
        ref,
      ),
    ).toBeNull();
  });

  it("reports the resolved branch and whether it is the only one in its direction", () => {
    const runs = [
      { direction: 0 as const, subRouteUid: "X", stops: line(["A", "B", "C"]) },
      { direction: 0 as const, subRouteUid: "Y", stops: line(["A", "D"]) },
      { direction: 1 as const, subRouteUid: "X", stops: line(["C", "A"]) },
    ];
    const ride = resolveLegRide(runs, { ...ref, subRouteUid: "X" });
    expect(ride?.subRouteUid).toBe("X");
    expect(ride?.direction).toBe(0);
    expect(ride?.singleBranchInDirection).toBe(false);
  });
});

describe("busLegKey", () => {
  const base = {
    routeName: "99",
    direction: 0,
    departureStop: "A",
    arrivalStop: "B",
    tdxCity: "Taichung",
  } as BusLeg;

  it("distinguishes city, branch and board/alight stops", () => {
    const k = busLegKey("0:0", base);
    expect(busLegKey("0:0", { ...base, tdxCity: "Taipei" })).not.toBe(k);
    expect(busLegKey("0:0", { ...base, subRouteUid: "X" })).not.toBe(k);
    expect(busLegKey("0:0", { ...base, arrivalStop: "C" })).not.toBe(k);
    expect(busLegKey("0:1", base)).not.toBe(k);
    expect(busLegKey("0:0", { ...base })).toBe(k);
  });
});

it("retains the original 10:00 schedule at every stop even while loading or after failure", () => {
  const at = Date.parse("2030-01-01T10:00:00+08:00");
  const leg = {
    type: "BUS",
    departureStop: "A",
    arrivalStop: "C",
    scheduledTrip: {
      tripId: "trip",
      boardingReadyAt: at - 600_000,
      stops: [
        { name: "A", arrivalAt: at - 60_000, departureAt: at },
        { name: "B", arrivalAt: at + 600_000 },
        { name: "C", arrivalAt: at + 1_200_000 },
      ],
    },
  } as BusLeg;
  const rows = fallbackStopRows(leg, { pending: true });
  expect(
    rows.map((r) => [r.name, r.estimateMinutes, r.statusLabel, r.pending]),
  ).toEqual([
    ["A", null, "10:00", false],
    ["B", null, "10:10", false],
    ["C", null, "10:20", false],
  ]);
});

it("preserves display names on rows without changing canonical stop matching", () => {
  const stops = [
    stop(1, "起點", { displayName: "Origin" }),
    stop(2, "終點", { displayName: "End" }),
  ];
  expect(
    buildStopRows(stops, null).map((row) => [row.name, row.displayName]),
  ).toEqual([
    ["起點", "Origin"],
    ["終點", "End"],
  ]);
  expect(sliceLegStops(stops, "Origin", "End")).toBeNull();
  expect(sliceLegStops(stops, "起點", "終點")).toEqual(stops);
  const leg = {
    type: "BUS",
    departureStop: "起點",
    arrivalStop: "終點",
    fromNameEn: "Origin",
    toNameEn: "End",
    fromDisplayName: "舊起點",
    toDisplayName: "舊終點",
    displayLanguage: "zh-TW",
    intermediateStops: [
      { name: "中間", nameEn: "Middle", displayName: "舊中間" },
    ],
  } as unknown as BusLeg;
  expect(
    fallbackStopRows(leg, { language: "en" }).map((row) => row.displayName),
  ).toEqual(["Origin", "Middle", "End"]);
  expect(
    fallbackStopRows(leg, { language: "zh-TW" }).map((row) => row.name),
  ).toEqual(["起點", "中間", "終點"]);
});
