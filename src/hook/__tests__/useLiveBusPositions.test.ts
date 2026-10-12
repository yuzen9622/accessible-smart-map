import { beforeEach, describe, expect, it, vi } from "vitest";
import { __clearRouteDetailCache } from "@/lib/transit/busRouteDetailCache";
import type { BusLeg } from "@/types/route";
import { fetchLeg } from "../useLiveBusPositions";

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    getBusRouteDetail: vi.fn(),
    getBusArrival: vi.fn(),
    getLiveBusPositions: vi.fn(),
  },
}));
vi.mock("@/lib/api/transit", () => mockApi);

const leg = {
  type: "BUS",
  routeName: "99",
  subRouteName: "99延",
  subRouteUid: "BRANCH",
  direction: 0,
  departureStop: "A",
  arrivalStop: "C",
  tdxCity: "Taichung",
  planContext: { routeToken: "plan-10", legIndex: 2 },
  nearestBus: { plateNumb: "OLD" },
} as unknown as BusLeg;
const signal = new AbortController().signal;
const detail = (
  plate: string | undefined = "BUS-10",
  minutes: number | null = 8,
) => ({
  ok: true,
  data: {
    directions: [
      {
        direction: 1,
        subRouteUid: "BRANCH",
        stops: [
          {
            seq: 1,
            name: "A",
            lat: 25,
            lng: 121,
            estimateMinutes: minutes,
            statusLabel: "10:00",
            plateNumb: plate as string | undefined,
          },
          {
            seq: 2,
            name: "C",
            lat: 25.1,
            lng: 121.1,
            estimateMinutes: 20,
            statusLabel: "10:20",
            plateNumb: plate as string | undefined,
          },
        ],
      },
    ],
  },
});
const vehicle = (overrides: Record<string, unknown> = {}) => ({
  plateNumb: "BUS-10",
  direction: 1,
  subRouteUid: "BRANCH",
  lat: 25,
  lng: 121,
  ...overrides,
});
const positions = (...buses: ReturnType<typeof vehicle>[]) => ({
  ok: true,
  data: { buses },
});
beforeEach(() => {
  __clearRouteDetailCache();
  vi.clearAllMocks();
  mockApi.getBusRouteDetail.mockResolvedValue(detail());
  mockApi.getLiveBusPositions.mockResolvedValue(positions(vehicle()));
});

describe("planned bus tracking", () => {
  it("uses the server-matched vehicle and ETA without querying the next arrival", async () => {
    const buses = await fetchLeg(leg, signal);
    expect(buses).toHaveLength(1);
    expect(buses[0]).toMatchObject({
      plateNumb: "BUS-10",
      estimateTime: 8,
      direction: 1,
    });
    expect(mockApi.getBusArrival).not.toHaveBeenCalled();
    expect(mockApi.getBusRouteDetail).toHaveBeenCalledWith(
      "99延",
      "Taichung",
      "BRANCH",
      undefined,
      leg.planContext,
      undefined,
    );
  });
  it("does not query a generic next bus when plan context is missing", async () => {
    expect(await fetchLeg({ ...leg, planContext: undefined }, signal)).toEqual(
      [],
    );
    expect(mockApi.getBusRouteDetail).not.toHaveBeenCalled();
    expect(mockApi.getBusArrival).not.toHaveBeenCalled();
  });
  it.each([
    { plateNumb: "OTHER" },
    { direction: 0 },
    { direction: 255 },
    { subRouteUid: "OTHER" },
    { subRouteUid: undefined },
    { lat: 25.1, lng: 121.1 },
  ])(
    "rejects an unrelated or already-passed vehicle (%j)",
    async (overrides) => {
      mockApi.getLiveBusPositions.mockResolvedValue(
        positions(vehicle(overrides)),
      );
      expect(await fetchLeg(leg, signal)).toEqual([]);
    },
  );
  it("does not borrow a plate or ETA from another stop", async () => {
    const response = detail();
    response.data.directions[0].stops[0].plateNumb = undefined;
    mockApi.getBusRouteDetail.mockResolvedValue(response);
    expect(await fetchLeg(leg, signal)).toEqual([]);
  });
  it("retains the schedule when the server has no matched ETA", async () => {
    mockApi.getBusRouteDetail.mockResolvedValue(detail("BUS-10", null));
    expect(await fetchLeg(leg, signal)).toEqual([]);
    expect(mockApi.getLiveBusPositions).not.toHaveBeenCalled();
  });
  it("rejects unknown direction and ambiguous stop runs", async () => {
    const response = detail();
    response.data.directions[0].direction = 255;
    mockApi.getBusRouteDetail.mockResolvedValue(response);
    expect(await fetchLeg(leg, signal)).toEqual([]);
    __clearRouteDetailCache();
    const ambiguous = detail();
    ambiguous.data.directions.push(ambiguous.data.directions[0]);
    mockApi.getBusRouteDetail.mockResolvedValue(ambiguous);
    expect(await fetchLeg(leg, signal)).toEqual([]);
  });
  it("does not retain a vehicle after the planned lookup fails or expires", async () => {
    expect(await fetchLeg(leg, signal)).toHaveLength(1);
    __clearRouteDetailCache();
    mockApi.getBusRouteDetail.mockResolvedValue({ ok: false, code: 404 });
    expect(await fetchLeg(leg, signal)).toEqual([]);
    expect(mockApi.getBusArrival).not.toHaveBeenCalled();
  });
  it("keeps same-line plans in separate caches", async () => {
    await fetchLeg(leg, signal);
    mockApi.getBusRouteDetail.mockResolvedValue(detail(undefined, null));
    expect(
      await fetchLeg(
        { ...leg, planContext: { routeToken: "plan-11", legIndex: 2 } },
        signal,
      ),
    ).toEqual([]);
    expect(mockApi.getBusRouteDetail).toHaveBeenCalledTimes(2);
  });
});

describe("boarded vehicle lock", () => {
  it("does not revive a planned ETA when the positions request outlives its snapshot", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    try {
      mockApi.getLiveBusPositions.mockImplementation(async () => {
        now.mockReturnValue(16001);
        return positions(vehicle());
      });
      expect(await fetchLeg(leg, signal)).toEqual([]);
      __clearRouteDetailCache();
      now.mockReturnValue(1000);
      const buses = await fetchLeg(leg, signal, {
        plate: "BUS-10",
        direction: 1,
        branch: "BRANCH",
      });
      expect(buses).toHaveLength(1);
      expect(buses[0].estimateTime).toBeUndefined();
    } finally {
      now.mockRestore();
    }
  });
  const lock = { plate: "BUS-10", direction: 1 as const, branch: "BRANCH" };
  it("tracks the boarded plate past boarding and reports only its alighting ETA", async () => {
    mockApi.getLiveBusPositions.mockResolvedValue(
      positions(vehicle({ lat: 25.1, lng: 121.1 })),
    );
    const buses = await fetchLeg(leg, signal, lock);
    expect(buses).toHaveLength(1);
    expect(buses[0]).toMatchObject({
      plateNumb: "BUS-10",
      etaStopName: "C",
      estimateTime: 20,
    });
  });
  it("does not switch to the next planned bus after boarding", async () => {
    mockApi.getBusRouteDetail.mockResolvedValue(detail("NEXT"));
    mockApi.getLiveBusPositions.mockResolvedValue(
      positions(vehicle(), vehicle({ plateNumb: "NEXT" })),
    );
    const buses = await fetchLeg(leg, signal, lock);
    expect(buses).toHaveLength(1);
    expect(buses[0].plateNumb).toBe("BUS-10");
    expect(buses[0].estimateTime).toBeUndefined();
  });
  it.each([
    { ...lock, branch: "OTHER" },
    { ...lock, direction: 0 as const },
    { ...lock, plate: null },
    null,
  ])("rejects unknown or mismatched lock %j", async (identity) => {
    expect(await fetchLeg(leg, signal, identity)).toEqual([]);
  });
  it("does not borrow alighting ETA from the boarding record", async () => {
    const response = detail();
    response.data.directions[0].stops[1].plateNumb = "NEXT";
    mockApi.getBusRouteDetail.mockResolvedValue(response);
    const buses = await fetchLeg(leg, signal, lock);
    expect(buses[0]?.estimateTime).toBeUndefined();
  });
});

it("ignores a response that finishes after cancellation", async () => {
  const controller = new AbortController();
  mockApi.getLiveBusPositions.mockImplementation(async () => {
    controller.abort();
    return positions(vehicle());
  });
  expect(await fetchLeg(leg, controller.signal)).toEqual([]);
});
