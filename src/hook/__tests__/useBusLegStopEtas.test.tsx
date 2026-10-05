import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RouteDetailDirection } from "@/lib/api/transit";
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
    type: "BUS",
    routeName: "99",
    tdxCity: "Taichung",
    subRouteUid,
  }) as unknown as BusLeg;

const probe = (leg: BusLeg | null, enabled = true, poll = false) => {
  let out: ReturnType<typeof useBusLegStopEtas> | undefined;
  const C = () => {
    out = useBusLegStopEtas(leg, enabled, poll);
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
  await fetchRouteDetailCached("99", "Taichung", { subRouteUid: "A" });
});
afterEach(() => vi.useRealTimers());

describe("useBusLegStopEtas render guard", () => {
  it("seeds a warm branch synchronously", () => {
    expect(probe(legOf("A"))).toEqual({ directions, status: "ready" });
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
});
