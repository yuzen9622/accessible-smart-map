import { beforeEach, describe, expect, it, vi } from "vitest";
import { __clearRouteDetailCache } from "@/lib/transit/busRouteDetailCache";
import type { BusLeg } from "@/types/route";
import { fetchLeg } from "../useLiveBusPositions";

const { getBusArrival, getLiveBusPositions, getBusRouteDetail } = vi.hoisted(
  () => ({
    getBusArrival: vi.fn(),
    getLiveBusPositions: vi.fn(),
    getBusRouteDetail: vi.fn(),
  }),
);

vi.mock("@/lib/api/transit", () => ({
  getBusArrival,
  getLiveBusPositions,
  getBusRouteDetail,
}));

const stop = (seq: number, name: string) => ({
  seq,
  name,
  lat: 24.13,
  lng: 120.64,
  estimateMinutes: null,
  statusLabel: "正常",
});

/**
 * Route 99 as TDX actually publishes it: the ride 豐樂公園 → 國立臺中科技大學
 * exists only in direction 1, while the leg declares direction 0.
 */
const routeDetail = {
  ok: true,
  data: {
    directions: [
      {
        direction: 0,
        stops: [
          stop(0, "國立臺中科技大學"),
          stop(1, "美榮藥局"),
          stop(2, "豐樂公園"),
        ],
      },
      {
        direction: 1,
        stops: [
          stop(0, "豐樂公園"),
          stop(1, "美榮藥局"),
          stop(2, "國立臺中科技大學"),
        ],
      },
    ],
  },
};

const leg = {
  type: "BUS",
  routeName: "99",
  direction: 0,
  departureStop: "豐樂公園",
  arrivalStop: "國立臺中科技大學",
  tdxCity: "Taichung",
  nearestBus: { plateNumb: "EAL-0386" },
} as unknown as BusLeg;

const vehicle = (
  plateNumb: string,
  subRouteUid?: string,
  direction: number = 1,
) => ({
  plateNumb,
  direction,
  subRouteUid,
  lat: 24.13,
  lng: 120.64,
  speed: 20,
  gpsTime: "2026-09-05T17:00:00+08:00",
  isLowFloor: "是",
  hasLiftOrRamp: "是",
  vehicleClass: "大型巴士",
});

const arrivals = (
  items: {
    plateNumb?: string;
    estimateMinutes: number | null;
    direction?: number;
    subRouteUid?: string;
    stopName?: string;
  }[],
) => ({
  ok: true,
  data: {
    arrivals: items.map((i) => ({
      stopName: "豐樂公園",
      direction: 1,
      directionLabel: "返程",
      ...i,
    })),
  },
});

const positions = (
  plates: (
    | string
    | { plate: string; subRouteUid?: string; direction?: number }
  )[],
) => ({
  ok: true,
  data: {
    buses: plates.map((p) =>
      typeof p === "string"
        ? vehicle(p)
        : vehicle(p.plate, p.subRouteUid, p.direction),
    ),
  },
});

beforeEach(() => {
  __clearRouteDetailCache();
  getBusArrival.mockReset();
  getLiveBusPositions.mockReset();
  getBusRouteDetail.mockReset();
  getBusRouteDetail.mockResolvedValue(routeDetail);
});

const signal = new AbortController().signal;

describe("fetchLeg", () => {
  it("pins the vehicle the boarding stop's arrival feed names", async () => {
    getBusArrival.mockResolvedValue(
      arrivals([{ plateNumb: "KKA-1234", estimateMinutes: 4 }]),
    );
    getLiveBusPositions.mockResolvedValue(positions(["KKA-1234", "EAL-0386"]));

    const [bus] = await fetchLeg(leg, signal);

    expect(bus.plateNumb).toBe("KKA-1234");
    expect(bus.isTarget).toBe(true);
  });

  // Regression: `nearestBus` is a snapshot from when the route was planned, so
  // pinning it tracked whichever vehicle was running the line *now* — marking
  // every stop it had served as 已過站 on a trip that had not departed yet.
  it("does not fall back to the plate the planner pinned", async () => {
    getBusArrival.mockResolvedValue(
      arrivals([{ estimateMinutes: 17 }]), // dispatched, but no plate yet
    );
    getLiveBusPositions.mockResolvedValue(positions(["EAL-0386"]));

    expect(await fetchLeg(leg, signal)).toEqual([]);
  });

  // Regression: the ETA used to be attached unconditionally, so a plate from
  // the planner sat next to a countdown belonging to a different vehicle —
  // "已過站" and "約 17 分" describing the same marker.
  it("only reports an ETA that belongs to the pinned vehicle", async () => {
    getBusArrival.mockResolvedValue(
      arrivals([
        { plateNumb: "KKA-1234", estimateMinutes: 6 },
        { plateNumb: "EAL-0386", estimateMinutes: 21 },
      ]),
    );
    getLiveBusPositions.mockResolvedValue(positions(["KKA-1234", "EAL-0386"]));

    const [bus] = await fetchLeg(leg, signal);

    expect(bus.plateNumb).toBe("KKA-1234");
    expect(bus.estimateTime).toBe(6);
    expect(bus.etaStopName).toBe("豐樂公園");
  });

  it("pins nothing when the named vehicle is not in the live feed", async () => {
    getBusArrival.mockResolvedValue(
      arrivals([{ plateNumb: "KKA-1234", estimateMinutes: 4 }]),
    );
    getLiveBusPositions.mockResolvedValue(positions(["EAL-0386"]));

    expect(await fetchLeg(leg, signal)).toEqual([]);
  });

  it("pins nothing when no vehicle is running the line", async () => {
    getBusArrival.mockResolvedValue(
      arrivals([{ plateNumb: "KKA-1234", estimateMinutes: 4 }]),
    );
    getLiveBusPositions.mockResolvedValue({ ok: true, data: { buses: [] } });

    expect(await fetchLeg(leg, signal)).toEqual([]);
  });

  it("ignores arrivals for the other direction", async () => {
    getBusArrival.mockResolvedValue(
      arrivals([{ plateNumb: "KKA-1234", estimateMinutes: 2, direction: 0 }]),
    );
    getLiveBusPositions.mockResolvedValue(positions(["KKA-1234"]));

    expect(await fetchLeg(leg, signal)).toEqual([]);
  });

  // Regression: the leg declares direction 0 but the ride only exists in
  // direction 1. Asking TDX about direction 0 pinned a vehicle running the
  // opposite way and showed its arrival time for a journey the user was not
  // taking — the "已過站" stop list next to a "約 17 分" marker.
  it("queries the direction that actually contains the ride", async () => {
    getBusArrival.mockResolvedValue(
      arrivals([{ plateNumb: "KKA-1234", estimateMinutes: 4 }]),
    );
    getLiveBusPositions.mockResolvedValue(positions(["KKA-1234"]));

    await fetchLeg(leg, signal);

    expect(getBusArrival).toHaveBeenCalledWith(
      "99",
      "豐樂公園",
      1,
      "Taichung",
      signal,
    );
    expect(getLiveBusPositions).toHaveBeenCalledWith(
      "99",
      "Taichung",
      1,
      signal,
    );
  });

  // The declared (GTFS) direction is not TDX's: without a resolved run nothing
  // may be queried or tracked.
  it("tracks nothing when route-detail is unusable", async () => {
    getBusRouteDetail.mockResolvedValue({ ok: false });
    getBusArrival.mockResolvedValue(
      arrivals([{ plateNumb: "KKA-1234", estimateMinutes: 4, direction: 0 }]),
    );
    getLiveBusPositions.mockResolvedValue(
      positions([{ plate: "KKA-1234", direction: 0 }]),
    );

    expect(await fetchLeg(leg, signal)).toEqual([]);
    expect(getBusArrival).not.toHaveBeenCalled();
    expect(getLiveBusPositions).not.toHaveBeenCalled();
  });

  it("tracks nothing when the ride fits two runs (no GTFS tie-break)", async () => {
    getBusRouteDetail.mockResolvedValue({
      ok: true,
      data: {
        directions: [
          { direction: 0, stops: routeDetail.data.directions[1].stops },
          { direction: 1, stops: routeDetail.data.directions[1].stops },
        ],
      },
    });
    getBusArrival.mockResolvedValue(
      arrivals([{ plateNumb: "KKA-1234", estimateMinutes: 4 }]),
    );
    getLiveBusPositions.mockResolvedValue(positions(["KKA-1234"]));

    expect(await fetchLeg(leg, signal)).toEqual([]);
    expect(getLiveBusPositions).not.toHaveBeenCalled();
  });

  it("never tracks a ride that only resolves to direction 255", async () => {
    getBusRouteDetail.mockResolvedValue({
      ok: true,
      data: {
        directions: [
          { direction: 255, stops: routeDetail.data.directions[1].stops },
        ],
      },
    });
    expect(await fetchLeg(leg, signal)).toEqual([]);
    expect(getBusArrival).not.toHaveBeenCalled();
  });

  it("passes the abort signal to the arrival request", async () => {
    getBusArrival.mockResolvedValue(arrivals([]));
    getLiveBusPositions.mockResolvedValue(positions([]));
    await fetchLeg(leg, signal);
    expect(getBusArrival.mock.calls[0][4]).toBe(signal);
  });

  it("ignores a position whose direction differs from the resolved run", async () => {
    getBusArrival.mockResolvedValue(
      arrivals([{ plateNumb: "KKA-1234", estimateMinutes: 4 }]),
    );
    getLiveBusPositions.mockResolvedValue(
      positions([{ plate: "KKA-1234", direction: 0 }]),
    );
    expect(await fetchLeg(leg, signal)).toEqual([]);
  });

  it("ignores arrivals for another stop or without a usable ETA", async () => {
    getLiveBusPositions.mockResolvedValue(positions(["KKA-1234"]));
    getBusArrival.mockResolvedValue(
      arrivals([
        { plateNumb: "KKA-1234", estimateMinutes: 4, stopName: "別的站" },
      ]),
    );
    expect(await fetchLeg(leg, signal)).toEqual([]);

    getBusArrival.mockResolvedValue(
      arrivals([{ plateNumb: "KKA-1234", estimateMinutes: null }]),
    );
    expect(await fetchLeg(leg, signal)).toEqual([]);

    getBusArrival.mockResolvedValue(
      arrivals([{ plateNumb: "KKA-1234", estimateMinutes: -1 }]),
    );
    expect(await fetchLeg(leg, signal)).toEqual([]);
  });

  it("matches the arrival stop by normalised name and keeps unknown vehicle fields", async () => {
    getBusArrival.mockResolvedValue(
      arrivals([
        { plateNumb: "KKA-1234", estimateMinutes: 0, stopName: "豐樂公園站" },
      ]),
    );
    getLiveBusPositions.mockResolvedValue({
      ok: true,
      data: { buses: [{ ...vehicle("KKA-1234"), isLowFloor: "未知" }] },
    });
    const [bus] = await fetchLeg(leg, signal);
    expect(bus.estimateTime).toBe(0);
    expect(bus.isLowFloor).toBe("未知");
  });

  it("does not report a result once the signal has aborted", async () => {
    const controller = new AbortController();
    getBusArrival.mockImplementation(async () => {
      controller.abort();
      return arrivals([{ plateNumb: "KKA-1234", estimateMinutes: 4 }]);
    });
    getLiveBusPositions.mockResolvedValue(positions(["KKA-1234"]));
    expect(await fetchLeg(leg, controller.signal)).toEqual([]);
  });

  it("does not query anything when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await fetchLeg(leg, controller.signal)).toEqual([]);
    expect(getBusArrival).not.toHaveBeenCalled();
  });

  it("survives an arrival lookup that throws", async () => {
    getBusArrival.mockRejectedValue(new Error("network down"));
    getLiveBusPositions.mockResolvedValue(positions(["KKA-1234"]));

    expect(await fetchLeg(leg, signal)).toEqual([]);
  });
});

describe("fetchLeg sub-route scoping", () => {
  const legOn延 = {
    ...leg,
    subRouteUid: "TXG991",
    subRouteName: "99延",
  } as BusLeg;

  const branchedDetail = {
    ok: true,
    data: {
      directions: [
        ...["TXG99", "TXG991"].flatMap((subRouteUid) =>
          routeDetail.data.directions.map((d) => ({ ...d, subRouteUid })),
        ),
      ],
    },
  };

  beforeEach(() => {
    getBusRouteDetail.mockResolvedValue(branchedDetail);
  });

  it("asks TDX for the sub-route the planner booked", async () => {
    getBusArrival.mockResolvedValue(
      arrivals([
        { plateNumb: "KKA-1234", estimateMinutes: 4, subRouteUid: "TXG991" },
      ]),
    );
    getLiveBusPositions.mockResolvedValue(
      positions([{ plate: "KKA-1234", subRouteUid: "TXG991" }]),
    );

    const [bus] = await fetchLeg(legOn延, signal);

    expect(bus.plateNumb).toBe("KKA-1234");
    expect(getBusRouteDetail).toHaveBeenCalledWith(
      "99延",
      "Taichung",
      "TXG991",
    );
    expect(getBusArrival.mock.calls[0][0]).toBe("99延");
    expect(getLiveBusPositions.mock.calls[0][0]).toBe("99延");
  });

  // Regression: 99 and 99延 share a feed. Pinning a 99延 vehicle for a 99 rider
  // tracked a bus that never reaches their stop.
  it("ignores vehicles and arrivals running a different sub-route", async () => {
    getBusArrival.mockResolvedValue(
      arrivals([
        { plateNumb: "KKA-1234", estimateMinutes: 4, subRouteUid: "TXG99" },
      ]),
    );
    getLiveBusPositions.mockResolvedValue(
      positions([{ plate: "KKA-1234", subRouteUid: "TXG99" }]),
    );
    expect(await fetchLeg(legOn延, signal)).toEqual([]);

    getBusArrival.mockResolvedValue(
      arrivals([
        { plateNumb: "KKA-1234", estimateMinutes: 4, subRouteUid: "TXG991" },
      ]),
    );
    expect(await fetchLeg(legOn延, signal)).toEqual([]);
  });

  it("rejects unidentified records even when a branch-scoped snapshot contains only that branch", async () => {
    getBusArrival.mockResolvedValue(
      arrivals([{ plateNumb: "KKA-1234", estimateMinutes: 4 }]),
    );
    getLiveBusPositions.mockResolvedValue(positions(["KKA-1234"]));

    // Two branches share direction 1: a UID-less record cannot be attributed.
    expect(await fetchLeg(legOn延, signal)).toEqual([]);

    // A scoped result cannot prove that the unscoped feeds have one branch.
    __clearRouteDetailCache();
    getBusRouteDetail.mockResolvedValue({
      ok: true,
      data: {
        directions: routeDetail.data.directions.map((d) => ({
          ...d,
          subRouteUid: "TXG991",
        })),
      },
    });
    expect(await fetchLeg(legOn延, signal)).toEqual([]);
    getBusArrival.mockResolvedValue(
      arrivals([
        { plateNumb: "KKA-1234", estimateMinutes: 4, subRouteUid: "TXG991" },
      ]),
    );
    // A confirmed arrival must not be paired with a UID-less vehicle either.
    expect(await fetchLeg(legOn延, signal)).toEqual([]);
    getLiveBusPositions.mockResolvedValue(
      positions([{ plate: "KKA-1234", subRouteUid: "TXG991" }]),
    );
    const [bus] = await fetchLeg(legOn延, signal);
    expect(bus.plateNumb).toBe("KKA-1234");
  });
  it("rejects conflicting branch IDs on the same plate in legacy unidentified-run fallback", async () => {
    getBusRouteDetail.mockResolvedValue(routeDetail);
    getBusArrival.mockResolvedValue(
      arrivals([
        { plateNumb: "KKA-1234", estimateMinutes: 4, subRouteUid: "A" },
      ]),
    );
    getLiveBusPositions.mockResolvedValue(
      positions([{ plate: "KKA-1234", subRouteUid: "B" }]),
    );
    expect(await fetchLeg(leg, signal)).toEqual([]);
  });
  it("requires the requested known UID when a scoped route-detail omits its own ID", async () => {
    getBusRouteDetail.mockResolvedValue(routeDetail);
    getBusArrival.mockResolvedValue(
      arrivals([{ plateNumb: "KKA-1234", estimateMinutes: 4 }]),
    );
    getLiveBusPositions.mockResolvedValue(positions(["KKA-1234"]));
    expect(await fetchLeg(legOn延, signal)).toEqual([]);
  });
});
