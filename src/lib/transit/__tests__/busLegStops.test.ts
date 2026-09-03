import { describe, expect, it } from "vitest";
import type { RouteDetailStop } from "@/lib/api/transit";
import {
  buildStopRows,
  CURRENT_STOP_RADIUS_M,
  fallbackStopRows,
  pickDirection,
  resolveCurrentStopSeq,
  resolveEtaLabel,
  sliceLegStops,
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

  it("picks the first alight occurrence after the board stop on a loop", () => {
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

describe("resolveEtaLabel", () => {
  const row = (
    estimateMinutes: number | null,
    state: "passed" | "current" | "upcoming" = "upcoming",
  ) =>
    ({
      seq: 1,
      name: "A站",
      estimateMinutes,
      statusLabel: "",
      state,
      kind: "intermediate",
    }) as const;

  it("maps 0 minutes to arriving", () => {
    expect(resolveEtaLabel(row(0))).toEqual({
      key: "busArrivalArriving",
      tone: "arriving",
    });
  });

  it("maps under 3 minutes to due", () => {
    expect(resolveEtaLabel(row(2))).toEqual({
      key: "busArrivalSoon",
      tone: "arriving",
    });
  });

  it("maps single-digit minutes to the soon tone", () => {
    expect(resolveEtaLabel(row(5))).toEqual({
      key: "busArrivalMinutes",
      tone: "soon",
      count: 5,
    });
  });

  it("maps 10+ minutes to the normal tone", () => {
    expect(resolveEtaLabel(row(30))).toEqual({
      key: "busArrivalMinutes",
      tone: "normal",
      count: 30,
    });
  });

  it("maps null and negative sentinels to unavailable", () => {
    expect(resolveEtaLabel(row(null)).key).toBe("busArrivalUnavailable");
    expect(resolveEtaLabel(row(-1)).key).toBe("busArrivalUnavailable");
  });

  it("lets passed override any ETA", () => {
    expect(resolveEtaLabel(row(2, "passed"))).toEqual({
      key: "busStopPassed",
      tone: "muted",
    });
  });
});
