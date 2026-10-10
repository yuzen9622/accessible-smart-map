import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RouteDetailDirection } from "@/lib/api/transit";
import {
  __clearRouteDetailCache,
  fetchRouteDetailCached,
  fetchRouteDetailSnapshot,
  peekRouteDetail,
  peekRouteDetailSnapshot,
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

describe("route-detail identity", () => {
  it("keys by sub-route as well, so branches never share an entry", async () => {
    expect(routeDetailKey("99", "Taichung", "A")).not.toBe(
      routeDetailKey("99", "Taichung", "B"),
    );
    expect(routeDetailKey("99", "Taichung")).not.toBe(
      routeDetailKey("99", "Taichung", "A"),
    );
    getBusRouteDetail.mockResolvedValue(ok());
    await fetchRouteDetailCached("99", "Taichung", { subRouteUid: "A" });
    await fetchRouteDetailCached("99", "Taichung", { subRouteUid: "B" });
    expect(getBusRouteDetail).toHaveBeenCalledTimes(2);
    expect(getBusRouteDetail).toHaveBeenNthCalledWith(
      1,
      "99",
      "Taichung",
      "A",
      undefined,
      undefined,
    );
    expect(peekRouteDetail("99", "Taichung", "A")).toEqual(directions);
    expect(peekRouteDetail("99", "Taichung")).toBeNull();
  });
});

describe("receipt time", () => {
  it("is set once on response and not refreshed by later reads", async () => {
    getBusRouteDetail.mockResolvedValue(ok());
    const first = await fetchRouteDetailSnapshot("365", "Taichung");
    vi.advanceTimersByTime(10_000);
    const second = await fetchRouteDetailSnapshot("365", "Taichung");
    expect(second?.receivedAt).toBe(first?.receivedAt);
    expect(second?.expiresAt).toBe((first?.receivedAt ?? 0) + 15_000);
    expect(peekRouteDetailSnapshot("365", "Taichung")?.receivedAt).toBe(
      first?.receivedAt,
    );
    vi.advanceTimersByTime(5_001);
    expect(peekRouteDetail("365", "Taichung")).toBeNull();
  });

  it("is measured from the response, not from the request start", async () => {
    let finish: (v: unknown) => void = () => {};
    getBusRouteDetail.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = fetchRouteDetailSnapshot("365", "Taichung");
    vi.advanceTimersByTime(8_000);
    finish(ok());
    const snapshot = await pending;
    expect(snapshot?.receivedAt).toBe(Date.now());
  });
});

describe("failure and cancellation", () => {
  it("a failed forced refresh does not delete a newer entry", async () => {
    let failFirst: (v: unknown) => void = () => {};
    getBusRouteDetail.mockReturnValueOnce(
      new Promise((resolve) => {
        failFirst = resolve;
      }),
    );
    const slow = fetchRouteDetailCached("365", "Taichung");
    // Replace the in-flight request's slot with a newer one.
    getBusRouteDetail.mockResolvedValueOnce(ok());
    __clearRouteDetailCache();
    await fetchRouteDetailCached("365", "Taichung");
    failFirst({ ok: false });
    await expect(slow).resolves.toBeNull();
    expect(peekRouteDetail("365", "Taichung")).toEqual(directions);
  });

  it("a cancelled consumer stops waiting but the shared request completes for others", async () => {
    let finish: (v: unknown) => void = () => {};
    getBusRouteDetail.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const controller = new AbortController();
    const cancelled = fetchRouteDetailCached("365", "Taichung", {
      signal: controller.signal,
    });
    const other = fetchRouteDetailCached("365", "Taichung");
    controller.abort();
    await expect(cancelled).resolves.toBeNull();

    finish(ok());
    await expect(other).resolves.toEqual(directions);
    expect(getBusRouteDetail).toHaveBeenCalledTimes(1);
  });

  it("returns null without waiting when already aborted", async () => {
    getBusRouteDetail.mockResolvedValue(ok());
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetchRouteDetailCached("365", "Taichung", { signal: controller.signal }),
    ).resolves.toBeNull();
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

it("isolates different plans and repeated legs of the same line", async () => {
  getBusRouteDetail.mockResolvedValue(ok());
  for (const planContext of [
    { routeToken: "one", legIndex: 1 },
    { routeToken: "two", legIndex: 1 },
    { routeToken: "one", legIndex: 3 },
  ]) {
    await fetchRouteDetailCached("99", "Taipei", { planContext });
  }
  expect(getBusRouteDetail).toHaveBeenCalledTimes(3);
  await fetchRouteDetailCached("99", "Taipei", {
    planContext: { routeToken: "one", legIndex: 1 },
  });
  expect(getBusRouteDetail).toHaveBeenCalledTimes(3);
  expect(peekRouteDetail("99", "Taipei")).toBeNull();
});
