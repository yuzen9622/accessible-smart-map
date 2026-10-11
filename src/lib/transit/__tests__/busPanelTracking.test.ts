import { describe, expect, it, vi } from "vitest";
import type { BusArrivalItem, RouteDetailDirection } from "@/lib/api/transit";
import type { LiveBus } from "@/types/route";
import { createBusArrivalReminder } from "../busArrivalReminder";
import {
  accessibleVehicle,
  createTrackingPoller,
  hasUniqueTrackingBranch,
  matchArrival,
  matchVehicles,
  resolveOrigin,
  rideCount,
  TRACKING_FRESH_MS,
  type TrackingSnapshot,
  vehicleStopIndex,
} from "../busPanelTracking";

const now = Date.parse("2026-10-11T12:00:00Z");
const stop = (name: string, seq: number, lat = 25) => ({
  name,
  seq,
  lat,
  lng: 121,
  stopUid: name,
  estimateMinutes: null,
  statusLabel: "",
});
const detail: RouteDetailDirection = {
  direction: 2,
  subRouteUid: "branch",
  stops: [stop("A", 10), stop("B", 80, 25.01), stop("C", 200, 25.02)],
};
const target = { routeName: "99", city: "Taipei", detail, boarding: 0 };
const arrival: BusArrivalItem = {
  stopName: "A",
  direction: 2,
  directionLabel: "",
  estimateMinutes: 0,
  statusLabel: "",
  plateNumb: "BUS",
  subRouteUid: "branch",
};
const bus = {
  plateNumb: "BUS",
  direction: 2,
  subRouteUid: "branch",
  lat: 25,
  lng: 121,
  gpsTime: new Date(now).toISOString(),
  isLowFloor: "1",
  hasLiftOrRamp: "",
  vehicleClass: "",
  speed: 0,
} as LiveBus;
const snap = (minutes: number | null = 2): TrackingSnapshot => ({
  receivedAt: now,
  arrival: minutes === null ? null : { ...arrival, estimateMinutes: minutes },
  buses: [bus],
});
const origin = {
  stopUid: "A",
  stopName: "A",
  coordinates: [121, 25] as [number, number],
  city: "Taipei",
  routes: ["99"],
};
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe("standalone tracking identity", () => {
  it("resolves exact ID/name/coordinates and refuses ambiguous directions/branches", () => {
    expect(resolveOrigin([detail], origin)?.index).toBe(0);
    for (const details of [
      [detail, { ...detail, direction: 1 as const }],
      [detail, { ...detail, subRouteUid: "other" }],
      [{ ...detail, direction: 255 as const }],
    ])
      expect(resolveOrigin(details, origin)).toBeNull();
    expect(resolveOrigin([detail], { ...origin, stopUid: "other" })).toBeNull();
    expect(
      resolveOrigin([detail], { ...origin, coordinates: [121.02, 25] }),
    ).toBeNull();
    expect(resolveOrigin([{ ...detail, direction: 10 }], origin)?.index).toBe(
      0,
    );
  });
  it("checks raw branch geometry before UI deduplication", () => {
    expect(hasUniqueTrackingBranch([detail], detail)).toBe(true);
    expect(
      hasUniqueTrackingBranch(
        [detail, { ...detail, stops: [...detail.stops].reverse() }],
        detail,
      ),
    ).toBe(false);
    expect(
      hasUniqueTrackingBranch(
        [detail, { ...detail, stops: detail.stops.slice(1) }],
        detail,
      ),
    ).toBe(false);
    expect(hasUniqueTrackingBranch([], detail)).toBe(false);
  });
  it("allows identical axes with different ETA but isolates other identities", () => {
    const refreshed = {
      ...detail,
      stops: detail.stops.map((s) => ({ ...s, estimateMinutes: 3 })),
    };
    expect(hasUniqueTrackingBranch([detail, refreshed], detail)).toBe(true);
    expect(
      hasUniqueTrackingBranch(
        [
          detail,
          { ...detail, direction: 1, stops: [...detail.stops].reverse() },
          { ...detail, subRouteUid: "other", stops: detail.stops.slice(1) },
        ],
        detail,
      ),
    ).toBe(true);
    expect(
      hasUniqueTrackingBranch([detail], { ...detail, direction: 255 }),
    ).toBe(false);
  });
  it("refuses conflicting ID-less named branches", () => {
    const named = { ...detail, subRouteUid: undefined, subRouteName: "99A" };
    expect(hasUniqueTrackingBranch([named], named)).toBe(true);
    expect(
      hasUniqueTrackingBranch(
        [named, { ...named, stops: named.stops.slice(1) }],
        named,
      ),
    ).toBe(false);
  });
  it("uses indices, never irregular seq arithmetic, and forbids upstream alighting", () => {
    expect(rideCount(0, 2, detail.stops)).toBe(2);
    for (const index of [-1, 0, 3, 0.5])
      expect(rideCount(0, index, detail.stops)).toBeNull();
    expect(rideCount(2, 1, detail.stops)).toBeNull();
  });
  it("keeps 0 ETA on the same arrival plate; null never becomes zero", () => {
    expect(matchArrival(target, [arrival])).toMatchObject({
      estimateMinutes: 0,
      plateNumb: "BUS",
    });
    for (const estimateMinutes of [null, -1, NaN, Infinity])
      expect(
        matchArrival(target, [{ ...arrival, estimateMinutes }]),
      ).toBeNull();
  });
  it("refuses wrong direction, unknown, branch, duplicate records/names", () => {
    for (const patch of [
      { direction: 255 as const },
      { direction: 1 as const },
      { subRouteUid: "other" },
      { subRouteUid: undefined },
      { stopName: "B" },
    ])
      expect(matchArrival(target, [{ ...arrival, ...patch }])).toBeNull();
    expect(matchArrival(target, [arrival, arrival])).toBeNull();
    expect(
      matchArrival(
        {
          ...target,
          detail: {
            ...detail,
            stops: [...detail.stops, stop("A", 300, 25.03)],
          },
        },
        [arrival],
      ),
    ).toBeNull();
    expect(
      matchArrival({ ...target, detail: { ...detail, direction: 255 } }, [
        arrival,
      ]),
    ).toBeNull();
  });
  it("accepts 10 and 2, matches branch strictly and rejects stale GPS/duplicates", () => {
    expect(matchVehicles(target, [bus], now)).toEqual([bus]);
    expect(
      matchVehicles(
        { ...target, detail: { ...detail, direction: 10 } },
        [{ ...bus, direction: 10 }],
        now,
      ),
    ).toHaveLength(1);
    for (const patch of [
      { subRouteUid: "other" },
      { direction: 255 as const },
      { gpsTime: "" },
      { gpsTime: new Date(now - TRACKING_FRESH_MS - 1).toISOString() },
      { lat: NaN },
    ])
      expect(matchVehicles(target, [{ ...bus, ...patch }], now)).toEqual([]);
    expect(matchVehicles(target, [bus, bus], now)).toEqual([]);
  });
  it("places only near a unique stop and preserves unknown accessibility", () => {
    expect(vehicleStopIndex(bus, detail.stops)).toBe(0);
    expect(vehicleStopIndex({ ...bus, lat: 24 }, detail.stops)).toBeNull();
    expect(
      vehicleStopIndex(bus, [detail.stops[0], detail.stops[0]]),
    ).toBeNull();
    expect(accessibleVehicle(bus)).toBe(true);
    expect(
      accessibleVehicle({ ...bus, isLowFloor: "是", hasLiftOrRamp: "未知" }),
    ).toBe(true);
    expect(
      accessibleVehicle({ ...bus, isLowFloor: "否", hasLiftOrRamp: "否" }),
    ).toBe(false);
    expect(
      accessibleVehicle({ ...bus, isLowFloor: "否", hasLiftOrRamp: "未知" }),
    ).toBeNull();
    expect(
      accessibleVehicle({ ...bus, isLowFloor: "0", hasLiftOrRamp: "0" }),
    ).toBe(false);
    expect(
      accessibleVehicle({ ...bus, isLowFloor: "", hasLiftOrRamp: "" }),
    ).toBeNull();
    expect(
      accessibleVehicle({ ...bus, isLowFloor: "0", hasLiftOrRamp: "1" }),
    ).toBe(true);
  });
});

describe("poll concurrency and revocation", () => {
  it("prevents overlap, aborts on hide, rejects late response, then requires fresh visible response", async () => {
    let visible = true;
    let release: (v: TrackingSnapshot) => void = () => {};
    const fetch = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<TrackingSnapshot>((r) => {
            release = r;
          }),
      )
      .mockResolvedValue(snap(8));
    const publish = vi.fn();
    const poller = createTrackingPoller({
      fetch,
      publish,
      visible: () => visible,
      now: () => now,
    });
    const pending = poller.refresh();
    await poller.refresh();
    expect(fetch).toHaveBeenCalledTimes(1);
    visible = false;
    poller.visibility();
    expect(fetch.mock.calls[0][0].aborted).toBe(true);
    visible = true;
    poller.visibility();
    release(snap(2));
    await pending;
    await flush();
    expect(
      publish.mock.calls.filter((c) => c[0]?.arrival?.estimateMinutes === 2),
    ).toHaveLength(0);
    expect(publish.mock.calls.at(-1)?.[0]?.arrival.estimateMinutes).toBe(8);
    poller.dispose();
    expect(publish.mock.calls.at(-1)?.[0]).toBeNull();
  });
  it("clears failures, expired snapshots and late disposed requests", async () => {
    let clock = now;
    const publish = vi.fn();
    const fetch = vi.fn().mockResolvedValue(snap());
    const poller = createTrackingPoller({
      fetch,
      publish,
      visible: () => true,
      now: () => clock,
    });
    await poller.refresh();
    expect(publish.mock.calls.at(-1)?.[0]).not.toBeNull();
    clock += TRACKING_FRESH_MS + 1;
    poller.tick();
    expect(publish.mock.calls.at(-1)?.[0]).toBeNull();
    fetch.mockRejectedValue(new Error("down"));
    await poller.refresh();
    expect(publish.mock.calls.at(-1)?.[0]).toBeNull();
    let release: (s: TrackingSnapshot) => void = () => {};
    fetch.mockImplementation(
      () =>
        new Promise((r) => {
          release = r;
        }),
    );
    const pending = poller.refresh();
    poller.dispose();
    publish.mockClear();
    release(snap());
    await pending;
    expect(publish).not.toHaveBeenCalled();
  });
});

describe("foreground reminder", () => {
  it.each([0, 2, 3])(
    "fires once for valid ETA %s, requests permission only from enable",
    (minutes) => {
      const fire = vi.fn();
      const permission = vi.fn().mockResolvedValue("denied");
      const r = createBusArrivalReminder({
        fire,
        requestPermission: permission,
        now: () => now,
      });
      r.observe(snap(minutes), true);
      expect(permission).not.toHaveBeenCalled();
      expect(fire).not.toHaveBeenCalled();
      r.enable();
      expect(permission).toHaveBeenCalledTimes(1);
      expect(r.observe(snap(minutes), true)).toBe(true);
      r.observe(snap(), true);
      expect(fire).toHaveBeenCalledTimes(1);
    },
  );
  it("ignores null, invalid, stale, hidden; cancelled late permission cannot fire", async () => {
    const fire = vi.fn();
    let grant: (s: string) => void = () => {};
    const r = createBusArrivalReminder({
      fire,
      requestPermission: () =>
        new Promise((res) => {
          grant = res;
        }),
      now: () => now,
    });
    r.enable();
    for (const snapshot of [
      snap(null),
      snap(-1),
      snap(4),
      snap(NaN),
      { ...snap(), receivedAt: now - TRACKING_FRESH_MS - 1 },
    ])
      r.observe(snapshot, true);
    r.observe(snap(), false);
    expect(fire).not.toHaveBeenCalled();
    r.cancel();
    grant("granted");
    await flush();
    r.observe(snap(), true);
    expect(fire).not.toHaveBeenCalled();
  });
  it("fresh return rather than hidden ETA triggers, unsupported permission still page-fires", async () => {
    const fire = vi.fn();
    const r = createBusArrivalReminder({
      fire,
      requestPermission: async () => {
        throw Error("unsupported");
      },
      now: () => now,
    });
    r.enable();
    r.observe(snap(), false);
    r.observe(null, true);
    expect(fire).not.toHaveBeenCalled();
    await flush();
    r.observe(snap(), true);
    expect(fire).toHaveBeenCalledTimes(1);
  });
});
