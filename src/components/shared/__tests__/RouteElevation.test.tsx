import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessibleRoute } from "@/types/route";

const state = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/zh-TW" }));
vi.mock("@/stores/useMapStore", () => ({
  default: (selector: (value: Record<string, unknown>) => unknown) =>
    selector(state.current),
}));

import { RouteCard } from "@/components/shared/RouteCard";

const profile = {
  status: "complete" as const,
  source: {
    dataset: "MOI_DTM_20M" as const,
    kind: "terrain" as const,
    resolutionM: 20 as const,
    samplingIntervalM: 20 as const,
    interpolation: "bilinear" as const,
    smoothing: "none" as const,
  },
  distanceM: 80,
  samples: [10, 20, 15, 30, 25].map((elevationM, i) => ({
    distanceM: i * 20,
    coordinates: [121.51 + i * 0.0002, 25.13] as [number, number],
    elevationM,
  })),
  summary: {
    ascentM: 25,
    descentM: 10,
    minElevationM: 10,
    maxElevationM: 30,
    netElevationM: 15,
    validSamples: 5,
    sampleCount: 5,
  },
};
const route = {
  routeId: "elevation-test",
  routeName: "步行路線",
  totalMinutes: 2,
  transferCount: 0,
  accessibilityHighlights: [],
  totalWalkDistanceM: 80,
  legs: [
    {
      type: "WALK" as const,
      from: "起點",
      to: "終點",
      distanceM: 80,
      minutesEst: 2,
      polyline: [
        [121.51, 25.13],
        [121.5108, 25.13],
      ] as [number, number][],
      a11yFacilities: [],
    },
  ],
  elevationProfile: profile,
};
const render = (value: AccessibleRoute = route) =>
  renderToStaticMarkup(<RouteCard route={value} idx={0} />);

beforeEach(() => {
  state.current = {
    selectRoute: { index: 0, route },
    routeTravelMode: "walk",
    map: null,
    setRouteSelect: vi.fn(),
    origin: null,
    destination: null,
    userLocation: null,
  };
});

describe("walking route elevation in the real route card", () => {
  it("shows the curve and backend ascent/descent before the walking steps", () => {
    const html = render();
    expect(html).toContain("沿途高程");
    expect(html).toContain('role="slider"');
    expect(html).toContain("25");
    expect(html).toContain("10");
    expect(html).toContain('data-elevation-segment="line"');
    expect(html.indexOf("沿途高程")).toBeLessThan(html.indexOf("步行 80 m"));
  });

  it.each(["transit", "drive", "motorcycle", null])(
    "does not show elevation for resolved mode %s, even with all WALK legs",
    (mode) => {
      state.current.routeTravelMode = mode;
      expect(render()).not.toContain("沿途高程");
    },
  );

  it("keeps legacy routes without elevation unchanged", () => {
    const { elevationProfile: _, ...legacy } = route;
    expect(render(legacy)).not.toContain("沿途高程");
  });

  it("shows only a compact summary on an unselected candidate", () => {
    state.current.selectRoute = { index: 1, route };
    const html = render();
    expect(html).toContain("上升");
    expect(html).toContain("下降");
    expect(html).not.toContain('role="slider"');
    expect(html).not.toContain("高程資料說明");
  });

  it("breaks the curve across null samples and never invents zero ascent", () => {
    const partial = {
      ...route,
      elevationProfile: {
        ...profile,
        status: "partial" as const,
        samples: profile.samples.map((sample, i) =>
          i === 2 ? { ...sample, elevationM: null } : sample,
        ),
        summary: {
          ...profile.summary,
          ascentM: null,
          descentM: null,
          netElevationM: null,
          validSamples: 4,
        },
      },
    };
    const html = render(partial);
    expect(html).toContain("部分路段缺少高程資料");
    expect(html.match(/data-elevation-segment="line"/g)).toHaveLength(2);
    expect(html).toContain("資料不足");
  });

  it("keeps unavailable elevation inline without a blank chart or technical reason", () => {
    const unavailable = {
      ...route,
      elevationProfile: {
        status: "unavailable" as const,
        reason: "timeout" as const,
      },
    };
    const html = render(unavailable);
    expect(html).toContain("暫無高程資料");
    expect(html).not.toContain('role="slider"');
    expect(html).not.toContain("timeout");
    expect(html).toContain("步行 80 m");
  });
});
