import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `useAppTranslation` (src/i18n/client.ts) calls `usePathname()` directly,
// which throws outside a mounted Next.js app router. Static rendering here
// happens standalone (no Next.js runtime), so this stub is required for
// RouteCard to render at all.
vi.mock("next/navigation", () => ({
  usePathname: () => "/zh-TW",
  redirect: () => {},
}));

// zustand v5's React binding (`zustand/react`'s `useStore`) intentionally
// serves `getInitialState()` — not the live current state — as the
// `useSyncExternalStore` "server snapshot", so that a real singleton store
// stays hydration-safe across concurrent server requests. `renderToStaticMarkup`
// is treated by React as a server render, so real `useMapStore.setState(...)`
// calls are (by design) invisible to a component rendered this way. Mocking
// the store hooks directly is the correct way to control what RouteCard sees
// under static rendering.
vi.mock("@/stores/useMapStore", () => ({
  default: vi.fn(),
}));
vi.mock("@/stores/useAuthStore", () => ({
  default: vi.fn(),
}));

import {
  dedupeA11yCategories,
  getConfidenceLabelKey,
  getRouteAlertsCount,
  RouteCard,
  shouldAppendExitNumber,
} from "@/components/shared/RouteCard";
import { ColorEnum, FontSizeEnum, LanguageEnum } from "@/lib/config";
import useAuthStore from "@/stores/useAuthStore";
import useMapStore from "@/stores/useMapStore";
import type {
  AccessibleRoute,
  BusLeg,
  MetroLeg,
  SlimOsmA11y,
} from "@/types/route";

const mockUseMapStore = vi.mocked(useMapStore);
const mockUseAuthStore = vi.mocked(useAuthStore);

const baseUserConfig = {
  language: LanguageEnum.Chinese,
  darkMode: "system" as const,
  themeColor: ColorEnum.Default,
  fontSize: FontSizeEnum.Medium,
  notifications: false,
  highContrast: false,
  memoryEnabled: true,
};

// --- Pure helper tests -----------------------------------------------------

describe("shouldAppendExitNumber", () => {
  it("suppresses when the exit name already spells out the number", () => {
    expect(shouldAppendExitNumber("2號出口", "2")).toBe(false);
    expect(shouldAppendExitNumber("出口 2", "2")).toBe(false);
  });

  it("appends when the exit name has no number", () => {
    expect(shouldAppendExitNumber("市政府站", "2")).toBe(true);
  });

  it("does not false-suppress on a numeric coincidence inside a larger number", () => {
    // "12號出口" contains the substring "2" but it's part of "12", not the
    // standalone exit number "2" — plain `.includes()` would wrongly suppress.
    expect(shouldAppendExitNumber("12號出口", "2")).toBe(true);
  });

  it("returns false when there is no exit number", () => {
    expect(shouldAppendExitNumber("市政府站", undefined)).toBe(false);
    expect(shouldAppendExitNumber("市政府站", "")).toBe(false);
  });

  it("returns true when there is no exit name to check against", () => {
    expect(shouldAppendExitNumber(undefined, "2")).toBe(true);
  });
});

describe("getConfidenceLabelKey", () => {
  it("maps each known confidence level to its i18n key", () => {
    expect(getConfidenceLabelKey("high")).toBe("confidenceHigh");
    expect(getConfidenceLabelKey("medium")).toBe("confidenceMedium");
    expect(getConfidenceLabelKey("low")).toBe("confidenceLow");
  });

  it("returns null when confidence is absent", () => {
    expect(getConfidenceLabelKey(undefined)).toBeNull();
  });
});

describe("dedupeA11yCategories", () => {
  it("returns an empty array for undefined/empty input", () => {
    expect(dedupeA11yCategories(undefined)).toEqual([]);
    expect(dedupeA11yCategories([])).toEqual([]);
  });

  it("collapses duplicate categories, preserving first-seen order", () => {
    const items: SlimOsmA11y[] = [
      {
        osmId: "1",
        category: "elevator",
        location: { type: "Point", coordinates: [0, 0] },
      },
      {
        osmId: "2",
        category: "toilet",
        location: { type: "Point", coordinates: [0, 0] },
      },
      {
        osmId: "3",
        category: "elevator",
        location: { type: "Point", coordinates: [0, 0] },
      },
    ];
    expect(dedupeA11yCategories(items)).toEqual(["elevator", "toilet"]);
  });
});

describe("getRouteAlertsCount", () => {
  it("returns 0 for routes with no alerts", () => {
    const route = buildRoute();
    expect(getRouteAlertsCount(route)).toBe(0);
  });

  it("counts distinct alerts across legs and top-level transitAlerts", () => {
    const route = buildRoute();
    route.legs[1] = {
      ...route.legs[1],
      alerts: [
        {
          alertId: "BUS-1",
          title: "公車改道",
          description: "施工不停靠",
          status: "active",
          matchKind: "route",
        },
      ],
    } as BusLeg;
    route.legs[2] = {
      ...route.legs[2],
      alerts: [
        {
          alertId: "METRO-1",
          title: "電梯維修",
          description: "板橋站電梯維修",
          status: 2,
          stations: [{ id: "BL07", name: "板橋站" }],
          lines: ["BL"],
          publishTime: "",
          updateTime: "",
        },
      ],
    } as MetroLeg;

    expect(getRouteAlertsCount(route)).toBe(2);
  });

  it("deduplicates alerts with the same alertId", () => {
    const route = buildRoute();
    route.legs[1] = {
      ...route.legs[1],
      alerts: [
        {
          alertId: "ALERT-SHARED",
          title: "豪雨特報",
          description: "減速行駛",
          status: 2,
          matchKind: "route",
        },
      ],
    } as BusLeg;
    route.legs[2] = {
      ...route.legs[2],
      alerts: [
        {
          alertId: "ALERT-SHARED",
          title: "豪雨特報",
          description: "減速行駛",
          status: 2,
          stations: [],
          lines: [],
          publishTime: "",
          updateTime: "",
        },
      ],
    } as MetroLeg;

    expect(getRouteAlertsCount(route)).toBe(1);
  });
});

// --- Component rendering tests ---------------------------------------------
//
// Uses `react-dom/server`'s `renderToStaticMarkup` (already a transitive dep
// via `react-dom`, no new devDependency) to render the real component to an
// HTML string in Node, and asserts on that string. This is real coverage of
// gating/labels/structure, not just source-text grepping — but it cannot
// exercise interactivity (clicking a toggle) or CSS layout/visibility, since
// there is no browser/layout engine involved. Collapsible sections always
// render their content in the DOM (matching the existing `IntermediateStops`
// pattern) with `aria-hidden`/`aria-expanded` controlling visibility via CSS
// — so "not visually shown while collapsed" is not something this test
// suite checks; it checks that the DOM/ARIA scaffolding for collapse exists
// and starts in the collapsed (`aria-expanded="false"`) state.

const busDepartureA11y: SlimOsmA11y[] = [
  {
    osmId: "b1",
    name: "Ramp A",
    category: "ramp",
    wheelchair: "yes",
    location: { type: "Point", coordinates: [121.5, 25.03] },
  },
  {
    // Deliberately no `wheelchair` field: the expanded list must show the
    // name/category but omit any wheelchair-status text for this item.
    osmId: "b2",
    name: "Toilet A",
    category: "toilet",
    location: { type: "Point", coordinates: [121.5, 25.03] },
  },
];

const metroArrivalA11y: SlimOsmA11y[] = [
  {
    osmId: "m1",
    name: "Wheelchair Access A",
    category: "wheelchair_accessible",
    wheelchair: "limited",
    location: { type: "Point", coordinates: [121.52, 25.04] },
  },
];

function buildRoute(): AccessibleRoute {
  return {
    routeId: "r1",
    routeName: "測試路線",
    totalMinutes: 30,
    transferCount: 2,
    accessibilityHighlights: ["低地板公車"],
    accessibilityScore: 82,
    accessibilityLabel: "excellent",
    scoreComponents: {
      facilityScore: 80,
      timeScore: 70,
      criticalFeatureScore: 90,
    },
    dataConfidence: "medium",
    scoreWarnings: ["部分路段缺乏無障礙資料"],
    totalWalkDistanceM: 450,
    attribution: "資料來源：台北市政府開放資料",
    legs: [
      {
        type: "WALK",
        from: "起點",
        to: "市府站",
        distanceM: 320,
        minutesEst: 5,
        polyline: [
          [121.5, 25.03],
          [121.51, 25.031],
        ],
        a11yFacilities: [],
        exitInfo: {
          exitName: "市政府站",
          exitNumber: "2",
          type: "elevator",
          coords: [121.5, 25.03],
        },
        steps: [
          {
            relativeDirection: "DEPART",
            absoluteDirection: null,
            streetName: "忠孝東路",
            bogusName: false,
            area: false,
            stairs: false,
            steepSlope: false,
            distanceM: 150,
            location: [121.5, 25.03],
          },
          {
            relativeDirection: "RIGHT",
            absoluteDirection: null,
            streetName: "松山路",
            bogusName: false,
            area: false,
            stairs: false,
            steepSlope: false,
            distanceM: 170,
            location: [121.51, 25.031],
          },
        ],
      },
      {
        type: "BUS",
        routeName: "信義幹線",
        departureStop: "市府站",
        arrivalStop: "永春站",
        waitInfo: { time: null, source: "unavailable" },
        estimatedWaitMinutes: 5,
        direction: 0,
        polyline: [
          [121.5, 25.03],
          [121.52, 25.04],
        ],
        departureStopA11y: busDepartureA11y,
        arrivalStopA11y: [],
      },
      {
        type: "METRO",
        railSystem: "TRTC",
        lineId: "BL",
        lineName: "板南線",
        lineUid: "BL01",
        departureStation: "永春站",
        arrivalStation: "市政府站",
        departureStationUid: "BL01",
        arrivalStationUid: "BL02",
        direction: 0,
        stopsCount: 2,
        rideMinutes: 6,
        waitInfo: { time: null, source: "unavailable" },
        estimatedWaitMinutes: 3,
        polyline: [
          [121.5, 25.03],
          [121.52, 25.04],
        ],
        departureStationA11y: [],
        arrivalStationA11y: metroArrivalA11y,
        facilityHighlights: [],
      },
      {
        type: "DRIVE",
        from: "市政府站",
        to: "目的地",
        distanceM: 1200,
        durationMin: 8,
        polyline: [
          [121.5, 25.03],
          [121.55, 25.05],
        ],
        steps: [
          {
            instruction: "直行忠孝東路",
            distanceM: 800,
            durationMin: 5,
            polyline: [
              [121.5, 25.03],
              [121.52, 25.04],
            ],
          },
          {
            instruction: "右轉市府路",
            distanceM: 400,
            durationMin: 3,
            polyline: [
              [121.52, 25.04],
              [121.55, 25.05],
            ],
          },
        ],
      },
    ],
  };
}

function renderRoute(route: AccessibleRoute, idx: number, selected: boolean) {
  mockUseMapStore.mockReturnValue({
    setRouteSelect: vi.fn(),
    selectRoute: selected ? { index: idx, route } : null,
    map: null,
    origin: null,
    destination: null,
    originName: "",
    destinationName: "",
    userLocation: null,
    // biome-ignore lint/suspicious/noExplicitAny: partial store mock, only the fields RouteCard reads matter
  } as any);
  mockUseAuthStore.mockReturnValue({
    userConfig: baseUserConfig,
    updateUserConfig: vi.fn(),
    setUser: vi.fn(),
    setUserConfig: vi.fn(),
    setSession: vi.fn(),
    logout: vi.fn(),
    user: null,
    session: null,
  });
  return renderToStaticMarkup(React.createElement(RouteCard, { route, idx }));
}

describe("RouteCard", () => {
  const route = buildRoute();

  beforeEach(() => {
    mockUseMapStore.mockReset();
    mockUseAuthStore.mockReset();
  });

  it("Part A: keeps the grid-overflow fix classes on CardHeader and the route summary", () => {
    const html = renderRoute(route, 0, true);
    // CardHeader must carry an explicit grid-cols-1 (minmax(0,1fr)) track,
    // not the implicit `auto` track that caused the overflow.
    expect(html).toMatch(
      /data-slot="card-header" class="[^"]*\bgrid-cols-1\b[^"]*"/,
    );
    // The routeSummary <p> (long joined leg-name text, `truncate` alone is
    // not enough inside a grid item) must also carry min-w-0.
    expect(html).toMatch(
      /<p class="[^"]*\btruncate\b[^"]*\bmin-w-0\b[^"]*" title="/,
    );
  });

  it("hides selected-only enhancements when the card is not selected", () => {
    const html = renderRoute(route, 0, false);
    expect(html).not.toContain("查看步行細節");
    expect(html).not.toContain("查看路線細節");
    expect(html).not.toContain("部分路段缺乏無障礙資料");
    expect(html).not.toContain("資料可信度");
    expect(html).not.toContain("450 m");
    expect(html).not.toContain("資料來源：台北市政府開放資料");
    expect(html).not.toContain("2 號出口");
  });

  it("shows every enhancement, correctly gated, when the card is selected", () => {
    const html = renderRoute(route, 0, true);

    // Walk steps collapsible: default-collapsed toggle present.
    expect(html).toMatch(
      /<button[^>]*aria-expanded="false"[^>]*>[\s\S]*?查看步行細節[\s\S]*?<\/button>/,
    );
    expect(html).toContain("忠孝東路");
    expect(html).toContain("150 m");

    // Drive steps collapsible.
    expect(html).toContain("查看路線細節");
    expect(html).toContain("直行忠孝東路");
    expect(html).toContain("800 m");

    // Station accessibility icons: aria-labels for each present category.
    expect(html).toContain('aria-label="斜坡"'); // ramp
    expect(html).toContain('aria-label="廁所"'); // toilet
    expect(html).toContain('aria-label="輪椅通道"'); // wheelchair_accessible

    // Expanded facility list content (rendered in the DOM even while
    // collapsed, per the static-rendering caveat above).
    expect(html).toContain("Ramp A");
    expect(html).toContain("輪椅完全可通行"); // wheelchairYes, for Ramp A
    expect(html).toContain("Toilet A");
    // Toilet A has no `wheelchair` field — must NOT get a status suffix.
    expect(html).not.toContain("Toilet A ·");
    expect(html).toContain("Wheelchair Access A");

    // Score warnings + confidence.
    expect(html).toContain("部分路段缺乏無障礙資料");
    expect(html).toContain("資料可信度");
    expect(html).toContain("中"); // confidenceMedium

    // Total walk distance summary badge.
    expect(html).toContain("450 m");

    // Exit number appended to the exitInfo line.
    expect(html).toContain("2 號出口");

    // Attribution footer.
    expect(html).toContain("資料來源：台北市政府開放資料");
  });

  it("renders route-level warning badge and leg alert notices when alerts exist", () => {
    const routeWithAlerts = buildRoute();
    routeWithAlerts.legs[1] = {
      ...routeWithAlerts.legs[1],
      alerts: [
        {
          alertId: "BUS-101",
          title: "配合施工改道",
          description: "8/27~8/30 施工改道，不停靠中正路站。",
          status: "active",
          matchKind: "route",
          reason: "道路施工",
        },
      ],
    } as BusLeg;
    routeWithAlerts.legs[2] = {
      ...routeWithAlerts.legs[2],
      alerts: [
        {
          alertId: "METRO-202",
          title: "板橋站 3 號出口電梯維修中",
          description: "設施維護作業",
          status: 2,
          stations: [{ id: "BL07", name: "板橋站" }],
          lines: ["BL"],
          publishTime: "",
          updateTime: "",
        },
      ],
    } as MetroLeg;

    // Scan layer (unselected): route-level warning badge is visible
    const unselectedHtml = renderRoute(routeWithAlerts, 0, false);
    expect(unselectedHtml).toContain("包含營運通阻 (2)");

    // Selected layer: route-level warning badge and leg notices are visible
    const selectedHtml = renderRoute(routeWithAlerts, 0, true);
    expect(selectedHtml).toContain("包含營運通阻 (2)");
    expect(selectedHtml).toContain("配合施工改道");
    expect(selectedHtml).toContain("8/27~8/30 施工改道，不停靠中正路站。");
    expect(selectedHtml).toContain("板橋站 3 號出口電梯維修中");
  });
});
