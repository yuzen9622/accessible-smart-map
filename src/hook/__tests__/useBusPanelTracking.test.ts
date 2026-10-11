import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  effects: [] as (() => undefined | (() => void))[],
  arrival: vi.fn(),
  positions: vi.fn(),
}));
vi.mock("react", () => ({
  useEffect: (fn: () => undefined | (() => void)) => h.effects.push(fn),
}));
vi.mock("@/lib/api/transit", () => ({
  getBusArrival: h.arrival,
  getLiveBusPositions: h.positions,
}));

vi.mock("@/stores/useBusTrackingStore", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/stores/useBusTrackingStore")>();
  const store = original.default;
  return {
    default: Object.assign(
      (selector: (s: ReturnType<typeof store.getState>) => unknown) =>
        selector(store.getState()),
      store,
    ),
  };
});

import useBusTrackingStore from "@/stores/useBusTrackingStore";
import useMapStore from "@/stores/useMapStore";
import useBusPanelTracking from "../useBusPanelTracking";

const target = {
  routeName: "99",
  city: "Taipei",
  boarding: 0,
  detail: {
    direction: 2 as const,
    subRouteUid: "branch",
    stops: [
      {
        name: "A",
        seq: 10,
        lat: 25,
        lng: 121,
        estimateMinutes: null,
        statusLabel: "",
      },
    ],
  },
};
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
let cleanup: undefined | (() => void);
let listener: () => void;
let visible = "visible";
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-11T12:00:00Z"));
  h.effects = [];
  h.arrival.mockReset();
  h.positions.mockReset();
  visible = "visible";
  vi.stubGlobal("document", {
    get visibilityState() {
      return visible;
    },
    addEventListener: (_event: string, fn: () => void) => {
      listener = fn;
    },
    removeEventListener: vi.fn(),
  });
  h.arrival.mockResolvedValue({
    ok: true,
    data: {
      routeName: "99",
      city: "Taipei",
      stopName: "A",
      arrivals: [
        {
          stopName: "A",
          direction: 2,
          subRouteUid: "branch",
          estimateMinutes: 2,
          plateNumb: "BUS",
        },
      ],
    },
  });
  h.positions.mockResolvedValue({
    ok: true,
    data: {
      routeName: "99",
      city: "Taipei",
      buses: [
        {
          direction: 2,
          subRouteUid: "branch",
          plateNumb: "BUS",
          lat: 25,
          lng: 121,
          gpsTime: new Date().toISOString(),
        },
      ],
    },
  });
});
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const start = async () => {
  useBusPanelTracking(target);
  cleanup = h.effects[0]();
  await flush();
};
describe("standalone bus hook (mock feeds only)", () => {
  it("uses existing APIs with abort signal and never changes navigation/map state", async () => {
    const map = useMapStore.getState();
    const active = map.activeBusLeg;
    const positions = map.liveBusPositions;
    await start();
    expect(h.arrival).toHaveBeenCalledWith(
      "99",
      "A",
      2,
      "Taipei",
      expect.any(AbortSignal),
    );
    expect(h.positions).toHaveBeenCalledWith(
      "99",
      "Taipei",
      2,
      expect.any(AbortSignal),
    );
    expect(useBusTrackingStore.getState().snapshot?.arrival?.plateNumb).toBe(
      "BUS",
    );
    expect(useMapStore.getState().activeBusLeg).toBe(active);
    expect(useMapStore.getState().liveBusPositions).toBe(positions);
  });
  it.each([
    ["arrival", "routeName", "wrong-route"],
    ["arrival", "city", "NewTaipei"],
    ["arrival", "stopName", "wrong-stop"],
    ["positions", "routeName", "wrong-route"],
    ["positions", "city", "NewTaipei"],
    ["arrival", "routeName", undefined],
    ["arrival", "city", undefined],
    ["arrival", "stopName", undefined],
    ["positions", "routeName", undefined],
    ["positions", "city", undefined],
  ] as const)(
    "revokes the snapshot for %s metadata %s=%s despite matching rows",
    async (feed, field, value) => {
      await start();
      expect(useBusTrackingStore.getState().snapshot?.arrival?.plateNumb).toBe(
        "BUS",
      );
      const mock = h[feed];
      const valid = await mock.mock.results[0].value;
      mock.mockResolvedValue({
        ...valid,
        data: { ...valid.data, [field]: value },
      });
      await vi.advanceTimersByTimeAsync(15_000);
      expect(useBusTrackingStore.getState().snapshot).toBeNull();
    },
  );
  it("clears failed polls and close; late old route result cannot publish", async () => {
    await start();
    h.positions.mockRejectedValue(new Error("down"));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(useBusTrackingStore.getState().snapshot).toBeNull();
    let release: (r: unknown) => void = () => {};
    h.positions.mockImplementation(
      () =>
        new Promise((r) => {
          release = r;
        }),
    );
    await vi.advanceTimersByTimeAsync(15_000);
    cleanup?.();
    cleanup = undefined;
    release({ ok: true, data: { buses: [] } });
    await flush();
    expect(useBusTrackingStore.getState().snapshot).toBeNull();
  });
  it("hidden clears and pauses APIs; visible first gets a new receipt", async () => {
    await start();
    visible = "hidden";
    listener();
    expect(useBusTrackingStore.getState().snapshot).toBeNull();
    const calls = h.arrival.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.arrival).toHaveBeenCalledTimes(calls);
    visible = "visible";
    listener();
    expect(useBusTrackingStore.getState().snapshot).toBeNull();
    await flush();
    expect(h.arrival).toHaveBeenCalledTimes(calls + 1);
    expect(useBusTrackingStore.getState().snapshot?.receivedAt).toBe(
      Date.now(),
    );
  });
  it("unknown direction never calls feeds", async () => {
    useBusPanelTracking({
      ...target,
      detail: { ...target.detail, direction: 255 },
    });
    cleanup = h.effects[0]();
    await flush();
    expect(h.arrival).not.toHaveBeenCalled();
    expect(h.positions).not.toHaveBeenCalled();
  });
});
