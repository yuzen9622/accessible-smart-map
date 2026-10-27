import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/zh-TW",
  redirect: () => {},
}));
vi.mock("@/stores/useAuthStore", () => ({ default: vi.fn() }));
// Static rendering reads a zustand store's initial state, so serve the slice
// this component selects from directly.
const mapState = vi.hoisted(() => ({
  activeBusLeg: null as unknown,
  liveBusPositions: [] as unknown[],
  setActiveBusLeg: () => {},
}));
vi.mock("@/stores/useMapStore", () => ({
  default: (select: (state: typeof mapState) => unknown) => select(mapState),
}));
vi.mock("@/lib/api/transit", async (original) => ({
  ...(await original<typeof import("@/lib/api/transit")>()),
  getBusRouteDetail: vi.fn(),
}));

import { BusLegStops } from "@/components/shared/RouteCard/BusLegStops";
import i18n from "@/i18n/client";
import { getBusRouteDetail } from "@/lib/api/transit";
import { busLegKey } from "@/lib/transit/busLegStops";
import { fetchRouteDetailSnapshot } from "@/lib/transit/busRouteDetailCache";
import useAuthStore from "@/stores/useAuthStore";
import type { BusLeg, LiveBus } from "@/types/route";

const leg: BusLeg = {
  type: "BUS",
  routeName: "綠1",
  subRouteUid: "TPE-G1",
  departureStop: "A",
  arrivalStop: "B",
  tdxCity: "Taipei",
  direction: 0,
  estimatedWaitMinutes: 54,
  waitInfo: { source: "schedule", time: "18:16" },
  polyline: [],
  departureStopA11y: [],
  arrivalStopA11y: [],
};
const stop = (seq: number, name: string, estimateMinutes: number | null) => ({
  seq,
  name,
  lat: 25,
  lng: 121.5,
  estimateMinutes,
  statusLabel: estimateMinutes === null ? "17:30" : "正常",
});

beforeEach(async () => {
  vi.mocked(useAuthStore).mockReturnValue({
    userConfig: { language: "zh-TW" },
    updateUserConfig: vi.fn(),
  } as never);
  await i18n.changeLanguage("zh-TW");
  // The public feed's next 綠1 reaches A in 8 minutes; the viewed departure
  // is a later timetable trip.
  vi.mocked(getBusRouteDetail).mockResolvedValue({
    ok: true,
    data: {
      directions: [
        {
          direction: 0,
          subRouteUid: "TPE-G1",
          stops: [stop(1, "A", 8), stop(2, "M", 12), stop(3, "B", null)],
        },
      ],
    },
  } as never);
  mapState.activeBusLeg = null;
  mapState.liveBusPositions = [];
  await fetchRouteDetailSnapshot("綠1", "Taipei", {
    subRouteUid: "TPE-G1",
    lang: "zh-TW",
    force: true,
  });
});

const openWithBus = (plateNumb: string) => {
  mapState.activeBusLeg = {
    key: busLegKey("0:0", { ...leg, planContext: undefined }),
    leg,
  };
  mapState.liveBusPositions = [
    {
      plateNumb,
      direction: 0,
      lat: 25,
      lng: 121.5,
      speed: 0,
      gpsTime: "",
      isLowFloor: "",
      hasLiftOrRamp: "",
      vehicleClass: "",
      isTarget: true,
    } satisfies LiveBus,
  ];
};

const text = (props: Partial<Parameters<typeof BusLegStops>[0]> = {}) =>
  renderToStaticMarkup(
    <BusLegStops
      leg={leg}
      routeIndex={0}
      legIndex={0}
      isSelected
      publicFeed
      hidePlannedTimes
      boardTime="18:16"
      alightTime="18:40"
      {...props}
    />,
  ).replace(/<[^>]+>/g, "");

describe("another departure read from the public feed", () => {
  it("offers the collapsed stop list from fetched stops when the planned leg omits intermediates", () => {
    const html = renderToStaticMarkup(
      <BusLegStops
        leg={leg}
        routeIndex={0}
        legIndex={0}
        isSelected
        publicFeed
      />,
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("經過 1 個站點");
    expect(html).toContain("M");
  });

  it("offers the collapsed stop list from the selected timetable before a feed is available", () => {
    const scheduled: BusLeg = {
      ...leg,
      tdxCity: undefined,
      scheduledTrip: {
        tripId: "trip-with-stops",
        boardingReadyAt: Date.now(),
        stops: [{ name: "A" }, { name: "時刻表中間站" }, { name: "B" }],
      },
    };
    const html = renderToStaticMarkup(
      <BusLegStops leg={scheduled} routeIndex={0} legIndex={0} isSelected />,
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("經過 1 個站點");
    expect(html).toContain("時刻表中間站");
  });

  it("does not take the line's next bus as the viewed departure's live time", () => {
    const html = text();
    expect(html).toContain("18:16");
    expect(html).toContain("18:40");
    expect(html).not.toContain("即時");
    expect(html).not.toContain("17:30");
  });

  it("keeps the next bus's times out of the expanded stop rows", () => {
    openWithBus("OTHER-1");
    const html = text({ viewedPlate: "788-U5" });
    expect(html).toContain("M");
    expect(html).not.toContain("12 分");
    expect(html).not.toContain("17:30");
    expect(html).not.toContain("即時追蹤中");
  });

  it("tracks a live bus only when it is the viewed departure's vehicle", () => {
    openWithBus("788-U5");
    expect(text({ viewedPlate: "788-U5" })).toContain("即時追蹤中");
  });

  it("shows the viewed departure's own live estimate", () => {
    expect(text({ boardEtaMinutes: 3 })).toContain("即時・3 分鐘後");
  });
});
