import { afterEach, describe, expect, it, vi } from "vitest";
import { isBusDirection } from "@/types/transit";
import {
  getBusArrival,
  getBusRouteDetail,
  getBusTimetable,
  getLiveBusPositions,
} from "../transit";

// Synthetic contract fixtures: no assertion that a live city feed supplies 2/10/255.
const directions = [0, 1, 2, 10, 255] as const;
const invalidDirections = ["0", "2", null, undefined, -1, 3, 256, false];
const arrival = {
  stopName: "測試站",
  direction: 0,
  directionLabel: "去程",
  estimateMinutes: 7.5,
  statusLabel: "正常・測試複合文字",
  plateNumb: "ABC-123",
  subRouteUid: "TEST",
  subRouteName: "測試支線",
};
const bus = {
  plateNumb: "ABC-123",
  direction: 0,
  lat: 25,
  lng: 121,
  speed: 12,
  gpsTime: "fixture",
  isLowFloor: "未知",
  hasLiftOrRamp: "未知",
  vehicleClass: "未知",
};
const stop = {
  seq: 1,
  name: "測試站",
  lat: 25,
  lng: 121,
  estimateMinutes: null,
  statusLabel: "",
};
function mockData(data: unknown) {
  const mock = vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ ok: true, data }), { status: 200 }),
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("TDX API direction contract (explicit synthetic fixtures)", () => {
  it("strictly accepts only the five numeric directions", () => {
    for (const direction of directions)
      expect(isBusDirection(direction)).toBe(true);
    for (const direction of invalidDirections)
      expect(isBusDirection(direction)).toBe(false);
  });
  it.each(directions)(
    "sends direction %s on actual arrival and position fetch URLs",
    async (direction) => {
      let mock = mockData({ routeName: "測試", city: "Taipei", arrivals: [] });
      await getBusArrival("測試", "測試站", direction, "Taipei");
      let url = new URL(String(mock.mock.calls[0]?.[0]));
      expect(url.pathname).toBe("/api/v1/transit/bus/arrival");
      expect(Object.fromEntries(url.searchParams)).toEqual({
        routeName: "測試",
        stopName: "測試站",
        direction: String(direction),
        city: "Taipei",
      });
      mock = mockData({ routeName: "測試", city: "Taipei", buses: [] });
      await getLiveBusPositions("測試", "Taipei", direction);
      url = new URL(String(mock.mock.calls[0]?.[0]));
      expect(url.pathname).toBe("/api/v1/transit/bus/positions");
      expect(Object.fromEntries(url.searchParams)).toEqual({
        routeName: "測試",
        city: "Taipei",
        direction: String(direction),
      });
    },
  );
  it.each([null, undefined])(
    "omits nullish direction %s without leaking extra query keys",
    async (direction) => {
      let mock = mockData({ arrivals: [] });
      await getBusArrival("測試", "測試站", direction);
      expect(
        new URL(String(mock.mock.calls[0]?.[0])).searchParams.has("direction"),
      ).toBe(false);
      mock = mockData({ routeName: "測試", city: "Taipei", buses: [] });
      await getLiveBusPositions("測試", undefined, direction);
      expect(
        new URL(String(mock.mock.calls[0]?.[0])).searchParams.has("direction"),
      ).toBe(false);
    },
  );
  it("keeps all five arrival rows, exact ETA/null and compound prose; rejects invalid directions/required fields", async () => {
    mockData({
      arrivals: [
        ...directions.map((direction) => ({ ...arrival, direction })),
        ...invalidDirections.map((direction) => ({ ...arrival, direction })),
        { ...arrival, stopName: "" },
        { ...arrival, estimateMinutes: "7" },
        { ...arrival, estimateMinutes: -1 },
        {
          ...arrival,
          direction: 10,
          estimateMinutes: null,
          statusLabel: undefined,
          plateNumb: "-1",
        },
        {
          ...arrival,
          direction: 255,
          estimateMinutes: null,
          statusLabel: null,
          plateNumb: 123,
        },
      ],
    });
    const rows = (await getBusArrival()).data?.arrivals;
    expect(rows?.map((row) => row.direction)).toEqual([...directions, 10, 255]);
    expect(rows?.[0]).toEqual(arrival);
    expect(rows?.[5]?.estimateMinutes).toBeNull();
    expect(rows?.[5]?.statusLabel).toBe("");
    expect(rows?.[5]?.plateNumb).toBeUndefined();
    expect(rows?.[6]?.plateNumb).toBeUndefined();
  });
  it("validates position plate and coordinates while retaining unknown accessibility", async () => {
    mockData({
      routeName: "測試",
      city: "Taipei",
      count: 999,
      lowFloorCount: 999,
      buses: [
        ...directions.map((direction) => ({ ...bus, direction })),
        ...invalidDirections.map((direction) => ({ ...bus, direction })),
        ...["", " ", "-1", null, 123].map((plateNumb) => ({
          ...bus,
          plateNumb,
        })),
        ...[
          { lat: 91 },
          { lng: 181 },
          { lat: "25" },
          { lng: null },
          { lat: undefined },
        ].map((invalid) => ({ ...bus, ...invalid })),
      ],
    });
    const data = (await getLiveBusPositions("測試")).data;
    expect(data?.buses.map((row) => row.direction)).toEqual(directions);
    expect(data?.count).toBe(5);
    expect(data?.lowFloorCount).toBe(0);
    expect(data?.buses[0]?.isLowFloor).toBe("未知");
    expect(data?.buses[0]?.hasLiftOrRamp).toBe("未知");
  });
  it("validates route-detail per row, not discarding branches for absent optional status", async () => {
    const mock = mockData({
      directions: [
        ...directions.map((direction) => ({
          direction,
          subRouteUid: "TEST",
          stops: [stop, { ...stop, seq: 2, statusLabel: undefined }],
        })),
        ...invalidDirections.map((direction) => ({ direction, stops: [stop] })),
        {
          direction: 10,
          stops: [
            { ...stop, seq: 0 },
            { ...stop, seq: 1.5 },
            { ...stop, seq: "1" },
            { ...stop, name: "" },
            { ...stop, lat: 91 },
            { ...stop, lng: "121" },
            { ...stop, estimateMinutes: "3" },
            stop,
          ],
        },
      ],
    });
    const data = (await getBusRouteDetail("測試", "Taipei")).data;
    expect(data?.directions.map((row) => row.direction)).toEqual([
      ...directions,
      10,
    ]);
    expect(data?.directions[0]?.stops).toEqual([stop, { ...stop, seq: 2 }]);
    expect(data?.directions[5]?.stops).toEqual([stop]);
    const params = new URL(String(mock.mock.calls[0]?.[0])).searchParams;
    expect(Object.fromEntries(params)).toEqual({
      routeName: "測試",
      city: "Taipei",
    });
  });
  it("uses only optional subRouteUid for detail and supports the four-argument signal call", async () => {
    const controller = new AbortController();
    const mock = mockData({ directions: [] });
    await getBusRouteDetail("測試", "Taipei", "branch / 1", controller.signal);
    expect(
      Object.fromEntries(new URL(String(mock.mock.calls[0]?.[0])).searchParams),
    ).toEqual({ routeName: "測試", city: "Taipei", subRouteUid: "branch / 1" });
    await getBusRouteDetail("測試", "Taipei", undefined, controller.signal);
    expect(
      new URL(String(mock.mock.calls[1]?.[0])).searchParams.has("subRouteUid"),
    ).toBe(false);
  });
  it("preserves origin-only trips, actual stop times and headway schedules in timetable", async () => {
    const data = {
      routeName: "測試",
      city: "Taipei",
      note: "origin only",
      truncated: true,
      schedules: directions.map((direction) => ({
        direction,
        directionLabel: "fixture",
        frequencies: [
          {
            scheduleType: "trip",
            serviceDays: "平日",
            originStopName: "起點",
            originDepartureTime: "06:00",
          },
          {
            scheduleType: "trip",
            serviceDays: "平日",
            originStopName: "起點",
            originDepartureTime: "07:00",
            stopTimes: [{ seq: 2, stopName: "下一站", arrivalTime: "07:05" }],
          },
          {
            scheduleType: "headway",
            serviceDays: "週末",
            start: "08:00",
            end: "20:00",
            minHeadwayMins: 10,
            maxHeadwayMins: 20,
          },
        ],
      })),
    };
    const mock = mockData(data);
    expect((await getBusTimetable("測試", "Taipei")).data).toEqual(data);
    const url = new URL(String(mock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/api/v1/transit/bus/timetable");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      routeName: "測試",
      city: "Taipei",
    });
  });
  it("filters invalid timetable directions per row and retains branch/structured schedule data", async () => {
    const trip = {
      scheduleType: "trip",
      serviceDays: "平日",
      originStopName: "起點",
      originDepartureTime: "06:00",
    };
    const headway = {
      scheduleType: "headway",
      serviceDays: "週末",
      minHeadwayMins: 12,
      maxHeadwayMins: 20,
    };
    const row = {
      direction: 0,
      directionLabel: "fixture",
      subRouteUid: "BRANCH",
      subRouteName: "fixture支線",
      first: "06:00",
      last: "22:00",
      frequencies: [trip, headway],
    };
    mockData({
      routeName: "測試",
      city: "Taipei",
      note: "origin only",
      schedules: [
        ...directions.map((direction) => ({ ...row, direction })),
        ...invalidDirections.map((direction) => ({ ...row, direction })),
      ],
    });
    const schedules = (await getBusTimetable("測試", "Taipei")).data?.schedules;
    expect(schedules).toEqual(
      directions.map((direction) => ({ ...row, direction })),
    );
    expect(schedules?.[0]?.frequencies[0]).not.toHaveProperty("stopTimes");
  });
  it("does not pass malformed trip/headway objects as structured frequencies", async () => {
    mockData({
      routeName: "測試",
      city: "Taipei",
      note: "fixture",
      schedules: [
        {
          direction: 2,
          frequencies: [
            {
              scheduleType: "trip",
              serviceDays: "平日",
              originDepartureTime: "06:00",
            },
            {
              scheduleType: "headway",
              serviceDays: "平日",
              minHeadwayMins: "10",
            },
            { scheduleType: "other", serviceDays: "平日" },
            {
              scheduleType: "trip",
              serviceDays: "平日",
              originStopName: "起點",
              originDepartureTime: "06:00",
              stopTimes: [{ seq: 0, stopName: "站", arrivalTime: "06:05" }],
            },
            { scheduleType: "headway", serviceDays: "平日" },
          ],
        },
      ],
    });
    expect(
      (await getBusTimetable("測試")).data?.schedules[0]?.frequencies,
    ).toEqual([{ scheduleType: "headway", serviceDays: "平日" }]);
  });
  it("preserves optional valid polyline and stopUid without inventing absent geometry or identifiers", async () => {
    const polyline = [
      [121, 25],
      [121.1, 25.1],
    ];
    const stops = [
      { ...stop, stopUid: "BOARD" },
      { ...stop, seq: 2, stopUid: "ALIGHT" },
    ];
    mockData({
      directions: [
        { direction: 2, polyline, stops },
        { direction: 10, stops: [stop] },
        ...[
          null,
          [],
          [[181, 25]],
          [[121, 91]],
          [["121", 25]],
          [[121, 25, 0]],
          [null],
        ].map((invalid) => ({
          direction: 255,
          polyline: invalid,
          stops: [{ ...stop, stopUid: "" }],
        })),
      ],
    });
    const rows = (await getBusRouteDetail("測試", "Taipei")).data?.directions;
    expect(rows?.[0]).toEqual({ direction: 2, polyline, stops });
    expect(rows?.[1]).toEqual({ direction: 10, stops: [stop] });
    expect(rows).toHaveLength(9);
    for (const row of rows?.slice(1) ?? []) {
      expect(row).not.toHaveProperty("polyline");
      expect(row.stops[0]).not.toHaveProperty("stopUid");
    }
  });
  it("rejects duplicate/non-increasing retained sequences without sorting or adding stops", async () => {
    mockData({
      directions: [
        {
          direction: 0,
          subRouteUid: "DUP",
          stops: [stop, { ...stop, seq: 1 }],
        },
        {
          direction: 1,
          subRouteUid: "REVERSE",
          stops: [{ ...stop, seq: 2 }, stop],
        },
        {
          direction: 2,
          subRouteUid: "LATE_REVERSE",
          stops: [stop, { ...stop, seq: 4 }, { ...stop, seq: 3 }],
        },
        {
          direction: 10,
          subRouteUid: "INCREASING",
          stops: [stop, { ...stop, seq: 3 }, { ...stop, seq: 4 }],
        },
        { direction: 255, subRouteUid: "SINGLE", stops: [stop] },
      ],
    });
    const rows = (await getBusRouteDetail("測試", "Taipei")).data?.directions;
    expect(rows?.map((row) => row.subRouteUid)).toEqual([
      "INCREASING",
      "SINGLE",
    ]);
    expect(rows?.[0]?.stops.map((row) => row.seq)).toEqual([1, 3, 4]);
  });
  it.each(["arrival", "detail", "timetable"])(
    "cleans timeout and caller abort listener after %s failure",
    async (endpoint) => {
      vi.useFakeTimers();
      const controller = new AbortController();
      const remove = vi.spyOn(controller.signal, "removeEventListener");
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new Error("fixture failure");
        }),
      );
      const request =
        endpoint === "arrival"
          ? getBusArrival("x", "y", 0, "Taipei", controller.signal)
          : endpoint === "detail"
            ? getBusRouteDetail("x", "Taipei", undefined, controller.signal)
            : getBusTimetable("x", "Taipei", controller.signal);
      await expect(request).rejects.toThrow("fixture failure");
      expect(vi.getTimerCount()).toBe(0);
      expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    },
  );
  it("clears successful request timers and actually times out pending fetches", async () => {
    vi.useFakeTimers();
    mockData({ arrivals: [] });
    await getBusArrival("x", "y");
    expect(vi.getTimerCount()).toBe(0);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: unknown, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener(
              "abort",
              () => reject(new Error("timed out")),
              { once: true },
            );
          }),
      ),
    );
    const failure = expect(getBusRouteDetail("x", "Taipei")).rejects.toThrow(
      "timed out",
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await failure;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("bounds hung positions requests and allows a subsequent successful poll", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: unknown, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener(
              "abort",
              () => reject(new Error("positions timeout")),
              { once: true },
            );
          }),
      ),
    );
    const pending = expect(
      getLiveBusPositions("測試", "Taipei", 0, controller.signal),
    ).rejects.toThrow("positions timeout");
    await vi.advanceTimersByTimeAsync(10_000);
    await pending;
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    mockData({ routeName: "測試", city: "Taipei", buses: [] });
    expect(
      (await getLiveBusPositions("測試", "Taipei", 0)).data?.buses,
    ).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("forwards caller cancellation through the bounded positions request", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: unknown, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener(
              "abort",
              () => reject(new Error("positions aborted")),
              { once: true },
            );
          }),
      ),
    );
    const pending = expect(
      getLiveBusPositions("測試", "Taipei", 0, controller.signal),
    ).rejects.toThrow("positions aborted");
    controller.abort();
    await pending;
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });
  it("rejects malformed collection payloads rather than presenting stale success", async () => {
    mockData({ arrivals: null });
    await expect(getBusArrival()).rejects.toThrow(
      "Invalid bus arrivals payload",
    );
    mockData({ directions: {} });
    await expect(getBusRouteDetail("x", "Taipei")).rejects.toThrow(
      "Invalid bus directions payload",
    );
    mockData({ buses: [], routeName: null, city: "Taipei" });
    await expect(getLiveBusPositions("x")).rejects.toThrow(
      "Invalid bus positions metadata",
    );
  });
  it("forwards arrival/detail cancellation and handles an already aborted caller", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: unknown, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            if (init.signal?.aborted) reject(new Error("aborted"));
            else
              init.signal?.addEventListener(
                "abort",
                () => reject(new Error("aborted")),
                { once: true },
              );
          }),
      ),
    );
    for (const endpoint of ["arrival", "detail"]) {
      const controller = new AbortController();
      const request =
        endpoint === "arrival"
          ? getBusArrival("x", "y", 0, "Taipei", controller.signal)
          : getBusRouteDetail("x", "Taipei", undefined, controller.signal);
      controller.abort();
      await expect(request).rejects.toThrow("aborted");
    }
    const controller = new AbortController();
    controller.abort();
    await expect(
      getBusArrival("x", "y", 0, "Taipei", controller.signal),
    ).rejects.toThrow("aborted");
  });
});
