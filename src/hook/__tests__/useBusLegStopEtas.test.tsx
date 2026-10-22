import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RouteDetailDirection } from "@/lib/api/transit";
import { departureCandidates } from "@/lib/transit/__tests__/fixtures/departureCandidates";
import {
  __clearRouteDetailCache,
  fetchRouteDetailCached,
} from "@/lib/transit/busRouteDetailCache";
import type { BusLeg } from "@/types/route";
import { useBusLegStopEtas } from "../useBusLegStopEtas";

const { getBusRouteDetail } = vi.hoisted(() => ({
  getBusRouteDetail: vi.fn(),
}));
vi.mock("@/lib/api/transit", () => ({ getBusRouteDetail }));

vi.mock("@/i18n/client", () => ({ useAppTranslation: () => ({}) }));
vi.mock("@/i18n/language", () => ({ getAppLanguage: () => "zh-TW" }));

const directions: RouteDetailDirection[] = [
  {
    direction: 0,
    subRouteUid: "A",
    stops: [
      {
        seq: 0,
        name: "X",
        lat: 0,
        lng: 0,
        estimateMinutes: 3,
        statusLabel: "",
      },
    ],
  },
];
const legOf = (subRouteUid: string) =>
  ({
    planContext: { routeToken: "plan", legIndex: 1 },
    type: "BUS",
    routeName: "99",
    tdxCity: "Taichung",
    subRouteUid,
  }) as unknown as BusLeg;

const probe = (
  leg: BusLeg | null,
  enabled = true,
  poll = false,
  cacheOnly = false,
  publicFeed = false,
) => {
  let out: ReturnType<typeof useBusLegStopEtas> | undefined;
  const C = () => {
    out = useBusLegStopEtas(leg, enabled, poll, cacheOnly, publicFeed);
    return null;
  };
  renderToStaticMarkup(<C />);
  return out as ReturnType<typeof useBusLegStopEtas>;
};

beforeEach(async () => {
  vi.useFakeTimers();
  __clearRouteDetailCache();
  getBusRouteDetail.mockReset();
  getBusRouteDetail.mockResolvedValue({ ok: true, data: { directions } });
  await fetchRouteDetailCached("99", "Taichung", {
    lang: "zh-TW",
    subRouteUid: "A",
    planContext: { routeToken: "plan", legIndex: 1 },
  });
});
afterEach(() => vi.useRealTimers());

describe("useBusLegStopEtas render guard", () => {
  it("seeds a warm branch synchronously", () => {
    expect(probe(legOf("A"))).toEqual({ directions, status: "ready" });
  });

  it("keeps fresh metadata when opening a consumer during a pending refresh or failed poll", async () => {
    getBusRouteDetail.mockResolvedValueOnce({
      ok: true,
      data: { directions, departureCandidates },
    });
    const options = {
      lang: "zh-TW" as const,
      subRouteUid: "A",
      planContext: { routeToken: "plan", legIndex: 1 },
      force: true,
    };
    await fetchRouteDetailCached("99", "Taichung", options);
    vi.advanceTimersByTime(10_000);
    let finish!: (value: unknown) => void;
    getBusRouteDetail.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const refresh = fetchRouteDetailCached("99", "Taichung", options);
    expect(probe(legOf("A"), true, true)).toMatchObject({
      directions,
      departureCandidates,
      status: "ready",
    });
    finish({ ok: false });
    await refresh;
    expect(probe(legOf("A"), true, true)).toMatchObject({
      directions,
      departureCandidates,
      status: "ready",
    });
    expect(probe(legOf("B"))).not.toHaveProperty("departureCandidates");
    vi.advanceTimersByTime(5_000);
    expect(probe(legOf("A"))).not.toHaveProperty("departureCandidates");
  });

  it("never exposes another branch's data", () => {
    expect(probe(legOf("B")).directions).toBeNull();
  });

  it("stops exposing data once the receipt is older than the TTL", () => {
    vi.advanceTimersByTime(15_001);
    expect(probe(legOf("A")).directions).toBeNull();
  });

  it("returns nothing for no leg", () => {
    expect(probe(null)).toEqual({ directions: null, status: "idle" });
  });

  it("lets an unselected summary read a warm snapshot only until its receipt expires", () => {
    expect(probe(legOf("A"), false, false, true)).toEqual({
      directions,
      status: "ready",
    });
    expect(probe(legOf("A"), false)).toEqual({
      directions: null,
      status: "idle",
    });
    vi.advanceTimersByTime(15_001);
    expect(probe(legOf("A"), false, false, true)).toEqual({
      directions: null,
      status: "idle",
    });
  });

  it("exposes refreshed metadata with the same plan/leg guard and receipt expiry", async () => {
    getBusRouteDetail.mockResolvedValue({
      ok: true,
      data: { directions, departureCandidates, candidateSearchComplete: false },
    });
    await fetchRouteDetailCached("99", "Taichung", {
      lang: "zh-TW",
      subRouteUid: "A",
      planContext: { routeToken: "plan", legIndex: 1 },
      force: true,
    });
    expect(probe(legOf("A"))).toMatchObject({
      departureCandidates,
      candidateSearchComplete: false,
    });
    expect(probe(legOf("B"))).not.toHaveProperty("departureCandidates");
    vi.advanceTimersByTime(15_001);
    expect(probe(legOf("A"))).not.toHaveProperty("departureCandidates");
  });

  it("reads a tokenless leg only when asked to use the public feed", async () => {
    await fetchRouteDetailCached("500延", "Taichung", {
      lang: "zh-TW",
      subRouteUid: "A",
    });
    const viewed = {
      type: "BUS",
      routeName: "500延",
      tdxCity: "Taichung",
      subRouteUid: "A",
    } as unknown as BusLeg;
    expect(probe(viewed).status).toBe("idle");
    expect(probe(viewed, true, false, false, true)).toMatchObject({
      directions,
      status: "ready",
    });
  });
});
