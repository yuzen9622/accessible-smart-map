import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __clearRouteDetailCache } from "@/lib/transit/busRouteDetailCache";
import type { BusLeg } from "@/types/route";

const h = vi.hoisted(() => ({
  lang: "zh-TW" as "en" | "zh-TW",
  getBusArrival: vi.fn(),
  getLiveBusPositions: vi.fn(),
  getBusRouteDetail: vi.fn(),
  effects: [] as (() => undefined | (() => void))[],
  setLiveBusPositions: vi.fn(),
  state: {} as Record<string, unknown>,
}));

vi.mock("@/i18n/client", () => ({ useAppTranslation: () => ({}) }));
vi.mock("@/i18n/language", () => ({ getAppLanguage: () => h.lang }));

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
  h.lang = "zh-TW";
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
  it("does not poll or publish a real ride in preview", async () => {
    useLiveBusPositions({ enabled: false, sessionKey: "preview" });
    cleanup = h.effects[0]();
    await flush();
    expect(h.getLiveBusPositions).not.toHaveBeenCalled();
    expect(lastSet()).toEqual([]);
  });
  it("hidden tab aborts and invalidates a late response, visible return requires fresh data", async () => {
    let release: (value: unknown) => void = () => {};
    h.getLiveBusPositions.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    useLiveBusPositions();
    cleanup = h.effects[0]();
    await flush();
    const listener = vi
      .mocked(document.addEventListener)
      .mock.calls.find(
        (call) => call[0] === "visibilitychange",
      )?.[1] as () => void;
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    listener();
    release({
      ok: true,
      data: { buses: [{ plateNumb: "KKA-1", direction: 0, lat: 0, lng: 0 }] },
    });
    await flush();
    expect(lastSet()).toEqual([]);
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    listener();
    await flush();
    expect(lastSet()).toHaveLength(1);
  });
  it("session/version replacement rejects the prior session response", async () => {
    let release: (value: unknown) => void = () => {};
    h.getLiveBusPositions.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    useLiveBusPositions({ enabled: true, sessionKey: "nav:1" });
    cleanup = h.effects[0]();
    await flush();
    cleanup?.();
    h.effects.length = 0;
    useLiveBusPositions({ enabled: true, sessionKey: "nav:2" });
    cleanup = h.effects[0]();
    await flush();
    h.setLiveBusPositions.mockClear();
    release({
      ok: true,
      data: { buses: [{ plateNumb: "OLD", direction: 0, lat: 0, lng: 0 }] },
    });
    await flush();
    expect(h.setLiveBusPositions).not.toHaveBeenCalled();
  });
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

it("restarts on language change without changing ride identity, ignoring late old-language positions", async () => {
  let finish!: (value: unknown) => void;
  h.getLiveBusPositions.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await start();
  cleanup?.();
  h.effects.length = 0;
  h.lang = "en";
  await start();
  expect(h.getBusRouteDetail.mock.calls.at(-1)?.at(-1)).toBe("en");
  expect(h.getLiveBusPositions.mock.calls.at(-1)).toEqual([
    "99",
    "Taichung",
    0,
    expect.any(AbortSignal),
    "en",
  ]);
  const current = lastSet();
  finish({
    ok: true,
    data: { buses: [{ plateNumb: "OLD", direction: 0, lat: 0, lng: 0 }] },
  });
  await flush();
  expect(lastSet()).toEqual(current);
  expect(h.state.activeBusLeg).toEqual({ key: "k", leg });
});
