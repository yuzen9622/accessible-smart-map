import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __clearRouteDetailCache } from "@/lib/transit/busRouteDetailCache";
import type { BusLeg } from "@/types/route";

const h = vi.hoisted(() => ({
  getBusArrival: vi.fn(),
  getLiveBusPositions: vi.fn(),
  getBusRouteDetail: vi.fn(),
  effects: [] as (() => undefined | (() => void))[],
  setLiveBusPositions: vi.fn(),
  state: {} as Record<string, unknown>,
}));

vi.mock("react", () => ({
  useEffect: (fn: () => undefined | (() => void)) => {
    h.effects.push(fn);
  },
  useRef: (value: unknown) => ({ current: value }),
}));
vi.mock("@/lib/api/transit", () => ({
  getBusArrival: h.getBusArrival,
  getLiveBusPositions: h.getLiveBusPositions,
  getBusRouteDetail: h.getBusRouteDetail,
}));
vi.mock("@/stores/useMapStore", () => ({
  default: (selector: (s: Record<string, unknown>) => unknown) =>
    selector(h.state),
}));

import { useLiveBusPositions } from "../useLiveBusPositions";

const stop = (seq: number, name: string) => ({
  seq,
  name,
  lat: 24.13,
  lng: 120.64,
  estimateMinutes: 5,
  plateNumb: "KKA-1",
  statusLabel: "正常",
});
const leg = {
  planContext: { routeToken: "plan", legIndex: 1 },
  type: "BUS",
  routeName: "99",
  direction: 0,
  departureStop: "A",
  arrivalStop: "B",
  tdxCity: "Taichung",
} as unknown as BusLeg;

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

const goodFeeds = () => {
  h.getBusRouteDetail.mockResolvedValue({
    ok: true,
    data: {
      directions: [{ direction: 0, stops: [stop(0, "A"), stop(1, "B")] }],
    },
  });
  h.getBusArrival.mockResolvedValue({
    ok: true,
    data: {
      arrivals: [
        {
          stopName: "A",
          direction: 0,
          plateNumb: "KKA-1",
          estimateMinutes: 3,
        },
      ],
    },
  });
  h.getLiveBusPositions.mockResolvedValue({
    ok: true,
    data: {
      buses: [{ plateNumb: "KKA-1", direction: 0, lat: 0, lng: 0 }],
    },
  });
};

let cleanup: undefined | (() => void);

beforeEach(() => {
  vi.useFakeTimers();
  __clearRouteDetailCache();
  h.effects.length = 0;
  h.setLiveBusPositions.mockReset();
  h.state = {
    activeBusLeg: { key: "k", leg },
    setLiveBusPositions: h.setLiveBusPositions,
  };
  vi.stubGlobal("document", {
    hidden: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  goodFeeds();
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const start = async () => {
  useLiveBusPositions();
  cleanup = h.effects[0]();
  await flush();
};
const lastSet = () => h.setLiveBusPositions.mock.calls.at(-1)?.[0];

describe("useLiveBusPositions lifecycle", () => {
  it("publishes the target vehicle", async () => {
    await start();
    expect(lastSet()).toHaveLength(1);
    expect(lastSet()[0].plateNumb).toBe("KKA-1");
  });

  it("clears the vehicle when a later poll fails instead of keeping it", async () => {
    await start();
    expect(lastSet()).toHaveLength(1);

    h.getLiveBusPositions.mockRejectedValue(new Error("down"));
    await vi.advanceTimersByTimeAsync(15_000);
    await flush();

    expect(lastSet()).toEqual([]);
  });

  it("clears a vehicle that no poll has refreshed within the stale window", async () => {
    await start();
    expect(lastSet()).toHaveLength(1);
    // The next request never settles (hung > 20s): the old vehicle must go.
    h.getBusRouteDetail.mockReturnValue(new Promise(() => {}));
    h.getLiveBusPositions.mockReturnValue(new Promise(() => {}));
    h.getBusArrival.mockReturnValue(new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(15_000);
    // Cached route-detail (15s TTL) has expired, so the poll hangs on the network.
    await vi.advanceTimersByTimeAsync(10_001);
    expect(lastSet()).toEqual([]);
  });

  it("ignores a response from a cancelled generation", async () => {
    let release: (v: unknown) => void = () => {};
    h.getLiveBusPositions.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    useLiveBusPositions();
    cleanup = h.effects[0]();
    await flush();
    h.setLiveBusPositions.mockClear();

    cleanup?.();
    cleanup = undefined;
    h.setLiveBusPositions.mockClear();
    release({
      ok: true,
      data: { buses: [{ plateNumb: "KKA-1", direction: 0, lat: 0, lng: 0 }] },
    });
    await flush();

    expect(h.setLiveBusPositions).not.toHaveBeenCalled();
  });
});
