import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RouteDetailDirection } from "@/lib/api/transit";
import {
  __clearRouteDetailCache,
  fetchRouteDetailCached,
  peekRouteDetail,
  routeDetailKey,
} from "@/lib/transit/busRouteDetailCache";

const { getBusRouteDetail } = vi.hoisted(() => ({
  getBusRouteDetail: vi.fn(),
}));

vi.mock("@/lib/api/transit", () => ({ getBusRouteDetail }));

const directions: RouteDetailDirection[] = [
  {
    direction: 0,
    stops: [
      {
        seq: 0,
        name: "永順文心南七路口",
        lat: 24.13,
        lng: 120.63,
        estimateMinutes: null,
        statusLabel: "18:15",
      },
    ],
  },
];

const ok = () => ({ ok: true, data: { directions } });

beforeEach(() => {
  __clearRouteDetailCache();
  getBusRouteDetail.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("routeDetailKey", () => {
  it("keys by city and route so two cities never collide", () => {
    expect(routeDetailKey("365", "Taichung")).not.toBe(
      routeDetailKey("365", "Taipei"),
    );
  });
});

describe("fetchRouteDetailCached", () => {
  it("issues one request for concurrent callers on the same route", async () => {
    getBusRouteDetail.mockResolvedValue(ok());

    const [a, b] = await Promise.all([
      fetchRouteDetailCached("365", "Taichung"),
      fetchRouteDetailCached("365", "Taichung"),
    ]);

    expect(getBusRouteDetail).toHaveBeenCalledTimes(1);
    expect(a).toEqual(directions);
    expect(b).toEqual(directions);
  });

  it("serves a warm entry without hitting the API again", async () => {
    getBusRouteDetail.mockResolvedValue(ok());

    await fetchRouteDetailCached("365", "Taichung");
    await fetchRouteDetailCached("365", "Taichung");

    expect(getBusRouteDetail).toHaveBeenCalledTimes(1);
  });

  it("refetches when the caller forces it", async () => {
    getBusRouteDetail.mockResolvedValue(ok());

    await fetchRouteDetailCached("365", "Taichung");
    await fetchRouteDetailCached("365", "Taichung", { force: true });

    expect(getBusRouteDetail).toHaveBeenCalledTimes(2);
  });

  it("refetches once the entry goes stale", async () => {
    getBusRouteDetail.mockResolvedValue(ok());

    await fetchRouteDetailCached("365", "Taichung");
    vi.advanceTimersByTime(15_001);
    await fetchRouteDetailCached("365", "Taichung");

    expect(getBusRouteDetail).toHaveBeenCalledTimes(2);
  });

  it("resolves null and does not cache a failed response", async () => {
    getBusRouteDetail.mockResolvedValue({ ok: false });

    await expect(fetchRouteDetailCached("365", "Taichung")).resolves.toBeNull();

    getBusRouteDetail.mockResolvedValue(ok());
    await expect(fetchRouteDetailCached("365", "Taichung")).resolves.toEqual(
      directions,
    );
    expect(getBusRouteDetail).toHaveBeenCalledTimes(2);
  });

  it("swallows a thrown request rather than rejecting", async () => {
    getBusRouteDetail.mockRejectedValue(new Error("network down"));

    await expect(fetchRouteDetailCached("365", "Taichung")).resolves.toBeNull();
  });
});

describe("peekRouteDetail", () => {
  it("returns nothing before anything is fetched", () => {
    expect(peekRouteDetail("365", "Taichung")).toBeNull();
  });

  it("exposes a warm entry synchronously", async () => {
    getBusRouteDetail.mockResolvedValue(ok());
    await fetchRouteDetailCached("365", "Taichung");

    expect(peekRouteDetail("365", "Taichung")).toEqual(directions);
  });

  it("stops exposing a stale entry", async () => {
    getBusRouteDetail.mockResolvedValue(ok());
    await fetchRouteDetailCached("365", "Taichung");
    vi.advanceTimersByTime(15_001);

    expect(peekRouteDetail("365", "Taichung")).toBeNull();
  });

  it("never exposes a request that is still in flight", () => {
    getBusRouteDetail.mockReturnValue(new Promise(() => {}));
    void fetchRouteDetailCached("365", "Taichung");

    expect(peekRouteDetail("365", "Taichung")).toBeNull();
  });
});
