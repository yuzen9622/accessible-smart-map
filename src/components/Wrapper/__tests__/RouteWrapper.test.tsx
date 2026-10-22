import type React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rendered = vi.hoisted(() => ({
  sources: [] as { id: string; coordinates: [number, number][] }[],
  colors: [] as { id: string; color: unknown }[],
}));

vi.mock("@/stores/useMapStore", () => ({
  default: vi.fn(),
}));

vi.mock("@/stores/useNavStore", () => ({ default: vi.fn() }));

import Polyline from "@/components/Polyline";
import RouteLine from "@/components/Wrapper/RouteWrapper";
import { buildCumulativePath } from "@/lib/geo";
import useMapStore from "@/stores/useMapStore";
import useNavStore from "@/stores/useNavStore";
import type { AccessibleRoute, BusLeg, DriveLeg, WalkLeg } from "@/types/route";
import { TRAFFIC_BASE_COLOR, TRAFFIC_LEVEL_COLORS } from "@/types/route";

const mockUseMapStore = vi.mocked(useMapStore);

vi.mock("react-map-gl/maplibre", () => ({
  Source: ({
    id,
    children,
    data,
  }: {
    id: string;
    children?: React.ReactNode;
    data: { geometry: { coordinates: [number, number][] } };
  }) => {
    rendered.sources.push({ id, coordinates: data.geometry.coordinates });
    return (
      <div data-testid="mock-source" data-source-id={id}>
        {children}
      </div>
    );
  },
  Layer: ({ id, paint }: { id: string; paint: Record<string, unknown> }) => {
    rendered.colors.push({ id, color: paint["line-color"] });
    return <div data-testid="mock-layer" data-layer-id={id} />;
  },
  Marker: ({
    children,
    longitude,
    latitude,
  }: {
    children?: React.ReactNode;
    longitude?: number;
    latitude?: number;
  }) => (
    <div data-testid="mock-marker" data-lng={longitude} data-lat={latitude}>
      {children}
    </div>
  ),
}));

beforeEach(() => {
  vi.mocked(useNavStore).mockReturnValue({
    routeProgress: null,
    navigationMode: "preview",
    navigationId: null,
    routeVersion: 0,
  });
  rendered.sources = [];
  rendered.colors = [];
});

describe("venue outdoor and walking-tail display", () => {
  const primary: AccessibleRoute = {
    routeId: "synthetic-drive",
    routeToken: "primary-token",
    routeName: "Drive",
    totalMinutes: 2,
    transferCount: 0,
    accessibilityHighlights: [],
    legs: [
      {
        type: "DRIVE",
        from: "Start",
        to: "Parking",
        distanceM: 100,
        durationMin: 2,
        polyline: [
          [10, 10],
          [10.001, 10],
        ],
      },
    ],
  };
  const tail: AccessibleRoute = {
    routeId: "synthetic-tail",
    routeToken: "tail-token",
    routeName: "Walk to gate",
    totalMinutes: 1,
    transferCount: 0,
    accessibilityHighlights: [],
    legs: [
      {
        type: "WALK",
        from: "Parking",
        to: "Gate",
        distanceM: 20,
        minutesEst: 1,
        a11yFacilities: [],
        polyline: [
          [10.001, 10],
          [10.001, 10.0001],
          [10.0011, 10.0001],
        ],
      },
    ],
  };
  const unusedTail: AccessibleRoute = {
    ...tail,
    routeId: "different-tail",
    legs: [
      {
        ...tail.legs[0],
        polyline: [
          [20, 20],
          [20.001, 20],
        ],
      },
    ],
  };
  function renderState(
    options: {
      isNavigating?: boolean;
      active?: AccessibleRoute | null;
      status?: "idle" | "outdoor" | "guiding" | "arrived";
      withoutVenue?: boolean;
    } = {},
  ) {
    const state = {
      selectRoute: { index: 0, route: primary },
      routeWaypoints: [],
      sosNavActive: false,
      isNavigating: options.isNavigating ?? false,
      activeNavigationRoute: options.active ?? null,
      venueJourney: options.withoutVenue
        ? null
        : {
            guidance: { status: options.status ?? "idle" },
            outdoor: {
              approachRoutes: {
                "primary-token": tail,
                "unselected-token": unusedTail,
              },
            },
          },
    };
    mockUseMapStore.mockImplementation((selector) => selector(state as never));
    const before = JSON.stringify({ primary, tail });
    const html = renderToStaticMarkup(<RouteLine />);
    expect(JSON.stringify({ primary, tail })).toBe(before);
    return html;
  }
  it("draws the active walking tail during navigation instead of the selected primary route", () => {
    renderState({ isNavigating: true, active: tail, status: "outdoor" });
    expect(rendered.sources.map((source) => source.coordinates)).toEqual([
      tail.legs[0].polyline,
    ]);
  });
  it.each(["guiding", "arrived"] as const)(
    "hides the old outdoor line once the venue journey is %s",
    (status) => {
      const html = renderState({ isNavigating: true, active: primary, status });
      expect(rendered.sources).toHaveLength(0);
      expect(html).not.toContain("mock-marker");
    },
  );
  it("keeps the selected primary and its own walking tail as distinct blue overview geometry", () => {
    renderState();
    expect(rendered.sources.map((source) => source.coordinates)).toEqual([
      primary.legs[0].polyline,
      tail.legs[0].polyline,
    ]);
    expect(new Set(rendered.sources.map((source) => source.id)).size).toBe(2);
    expect(rendered.colors.at(-1)?.color).toBe("#2563eb");
  });
  it("does not add a venue tail to an ordinary outdoor overview", () => {
    renderState({ withoutVenue: true });
    expect(rendered.sources.map((source) => source.coordinates)).toEqual([
      primary.legs[0].polyline,
    ]);
  });
});

describe("Polyline component", () => {
  it("renders Source and Layer with matching keys and IDs", () => {
    const element = Polyline({
      id: "test-leg-1",
      path: [
        { lat: 25.033, lng: 121.565 },
        { lat: 25.034, lng: 121.566 },
      ],
    });

    expect(element).not.toBeNull();
    expect(element?.props.id).toBe("test-leg-1");
    expect(element?.key).toBe("test-leg-1");
    expect(element?.props.children.props.id).toBe("test-leg-1-line");
    expect(element?.props.children.key).toBe("test-leg-1-line");
  });

  it("returns null for empty path", () => {
    const element = Polyline({
      id: "test-empty",
      path: [],
    });
    expect(element).toBeNull();
  });
});

describe("RouteLine component", () => {
  it("renders polylines for routes and updates cleanly when routes switch", () => {
    const walkLeg: WalkLeg = {
      type: "WALK",
      from: "Start",
      to: "Stop A",
      distanceM: 200,
      minutesEst: 5,
      polyline: [
        [121.565, 25.033],
        [121.566, 25.034],
      ],
      a11yFacilities: [],
    };

    const busLeg: BusLeg = {
      type: "BUS",
      routeName: "299",
      departureStop: "Stop A",
      arrivalStop: "Stop B",
      waitInfo: { time: 5, source: "schedule" },
      estimatedWaitMinutes: 5,
      direction: 0,
      polyline: [
        [121.566, 25.034],
        [121.57, 25.04],
      ],
      departureStopA11y: [],
      arrivalStopA11y: [],
    };

    const routeA: AccessibleRoute = {
      routeId: "route-a",
      routeName: "Route A",
      totalMinutes: 15,
      transferCount: 0,
      accessibilityHighlights: [],
      legs: [walkLeg, busLeg],
    };

    const mockState = {
      selectRoute: { index: 0, route: routeA },
      routeWaypoints: [],
      sosNavActive: false,
    };

    mockUseMapStore.mockImplementation((selector: unknown) => {
      const fn = selector as (s: typeof mockState) => unknown;
      return typeof fn === "function" ? fn(mockState) : mockState;
    });

    const html = renderToStaticMarkup(<RouteLine />);
    expect(html).toContain("data-source-id");
    expect(html).toContain("data-layer-id");
    expect(html).toContain("route-leg-WALK-121.565-25.033-121.566-25.034-2");
    expect(html).toContain("route-leg-BUS-121.566-25.034-121.57-25.04-2");
  });
});

describe("RouteLine drive traffic overlay", () => {
  const drivePolyline: [number, number][] = [
    [121.5, 25.03],
    [121.51, 25.031],
    [121.52, 25.032],
    [121.53, 25.033],
    [121.54, 25.034],
  ];

  const driveLegId = "route-leg-DRIVE-121.5-25.03-121.54-25.034-5";

  function renderDriveLeg(overrides: Partial<DriveLeg> = {}) {
    const driveLeg: DriveLeg = {
      type: "DRIVE",
      from: "Start",
      to: "End",
      distanceM: 4200,
      durationMin: 12,
      polyline: drivePolyline,
      ...overrides,
    };

    const route: AccessibleRoute = {
      routeId: "route-drive",
      routeName: "Drive route",
      totalMinutes: 12,
      transferCount: 0,
      accessibilityHighlights: [],
      legs: [driveLeg],
    };

    const mockState = {
      selectRoute: { index: 0, route },
      routeWaypoints: [],
      sosNavActive: false,
    };

    mockUseMapStore.mockImplementation((selector: unknown) => {
      const fn = selector as (s: typeof mockState) => unknown;
      return typeof fn === "function" ? fn(mockState) : mockState;
    });

    return renderToStaticMarkup(<RouteLine />);
  }

  it("draws only the plain base line when no traffic segments are present", () => {
    const html = renderDriveLeg();

    expect(html).toContain(driveLegId);
    expect(html).not.toContain(`${driveLegId}-traffic-`);
  });

  it("draws the solid base line plus one polyline per visible segment", () => {
    const html = renderDriveLeg({
      trafficSegments: [
        {
          fromIndex: 2,
          toIndex: 4,
          trafficLevel: "severe",
          congestionLevel: 5,
        },
        {
          fromIndex: 0,
          toIndex: 1,
          trafficLevel: "heavy",
          congestionLevel: 4,
        },
      ],
    });

    expect(html).toContain(driveLegId);
    expect(html).toContain(`${driveLegId}-traffic-heavy-0-1-0`);
    expect(html).toContain(`${driveLegId}-traffic-severe-2-4-1`);
  });

  it("skips out-of-range and unknown segments", () => {
    const html = renderDriveLeg({
      trafficSegments: [
        {
          fromIndex: 0,
          toIndex: 99,
          trafficLevel: "heavy",
          congestionLevel: 4,
        },
        {
          fromIndex: 1,
          toIndex: 3,
          trafficLevel: "unknown",
          congestionLevel: 0,
        },
      ],
    });

    expect(html).toContain(driveLegId);
    expect(html).not.toContain(`${driveLegId}-traffic-`);
  });

  it("places an incident marker at the reported coordinate", () => {
    const html = renderDriveLeg({
      incidents: [
        {
          incidentId: "inc-1",
          title: "塔城路封閉",
          severity: "closure",
          location: { lat: 25.032, lng: 121.52 },
        },
      ],
    });

    const marker = html
      .match(/<div data-testid="mock-marker"[^>]*>/g)
      ?.find((m) => m.includes('data-lng="121.52"'));

    expect(marker).toBeDefined();
    expect(marker).toContain('data-lat="25.032"');
    expect(html).toContain("塔城路封閉");
  });

  it("skips incidents without a numeric coordinate", () => {
    const html = renderDriveLeg({
      incidents: [
        {
          incidentId: "inc-bad-lat",
          title: "緯度遺失事件",
          severity: "advisory",
          location: { lat: Number.NaN, lng: 121.52 },
        },
        {
          incidentId: "inc-bad-lng",
          title: "經度遺失事件",
          severity: "advisory",
          location: { lat: 25.032, lng: "x" as unknown as number },
        },
      ],
    });

    expect(html).not.toContain("緯度遺失事件");
    expect(html).not.toContain("經度遺失事件");
  });

  it("skips incidents farther than 150m from the polyline", () => {
    const html = renderDriveLeg({
      incidents: [
        {
          incidentId: "inc-far",
          title: "台中遠方施工",
          severity: "advisory",
          location: { lat: 24.145, lng: 120.694 }, // in Taichung, route is in Taipei
        },
      ],
    });

    expect(html).not.toContain("台中遠方施工");
  });

  it("exposes both the dimmed base colour and the segment colours", () => {
    expect(TRAFFIC_BASE_COLOR).toBe("#475569");
    expect(TRAFFIC_LEVEL_COLORS.severe).not.toBe(TRAFFIC_LEVEL_COLORS.heavy);
  });
});

describe("completed route rendering", () => {
  const route: AccessibleRoute = {
    routeId: "progress",
    routeToken: "route-a",
    routeName: "Progress",
    totalMinutes: 5,
    transferCount: 0,
    accessibilityHighlights: [],
    legs: [
      {
        type: "WALK",
        from: "A",
        to: "B",
        distanceM: 100,
        minutesEst: 1,
        a11yFacilities: [],
        polyline: [
          [121, 25],
          [121.001, 25],
        ],
        a11ySegments: [
          {
            feature: "ramp",
            startIndex: 0,
            endIndex: 1,
            indoor: false,
            distanceM: null,
            maxSlopePercent: null,
            minWidthCm: null,
          },
        ],
      },
      {
        type: "DRIVE",
        from: "B",
        to: "C",
        distanceM: 200,
        durationMin: 1,
        polyline: [
          [121.001, 25],
          [121.002, 25],
          [121.002, 25.001],
        ],
        trafficSegments: [
          {
            fromIndex: 0,
            toIndex: 2,
            trafficLevel: "severe",
            congestionLevel: 4,
          },
        ],
      },
    ],
  };
  function renderProgress(overrides: Record<string, unknown> = {}) {
    const path = buildCumulativePath(route.legs);
    mockUseMapStore.mockReturnValue({
      isNavigating: true,
      activeNavigationRoute: route,
      routeWaypoints: [],
      selectRoute: { index: 0, route },
      sosNavActive: false,
      venueJourney: null,
    });
    vi.mocked(useNavStore).mockReturnValue({
      navigationMode: "live",
      navigationId: "nav-a",
      routeVersion: 1,
      routeProgress: {
        routeToken: "route-a",
        navigationId: "nav-a",
        routeVersion: 1,
        legIndex: 1,
        segmentIndex: 2,
        alongM: (path.cumM[2] + path.cumM[3]) / 2,
        observedAt: Date.now(),
        source: "gps",
      },
      ...overrides,
    });
    return renderToStaticMarkup(<RouteLine />);
  }
  it("grays previous legs and clips traffic at the exact shared progress point", () => {
    renderProgress();
    const gray = rendered.sources.filter((s) => s.id.endsWith("-completed"));
    expect(gray).toHaveLength(2);
    expect(gray[0].coordinates).toEqual(route.legs[0].polyline);
    expect(gray[1].coordinates.at(-1)?.[0]).toBeCloseTo(121.0015, 8);
    const traffic = rendered.sources.find((s) => s.id.includes("-traffic-"));
    expect(traffic?.coordinates[0]).toEqual(gray[1].coordinates.at(-1));
    expect(traffic?.coordinates.at(-1)).toEqual([121.002, 25.001]);
    expect(rendered.sources.some((s) => s.id.includes("-ramp-"))).toBe(false);
    expect(
      rendered.colors
        .filter((s) => s.id.includes("-completed"))
        .every((s) => s.color === "#94a3b8"),
    ).toBe(true);
  });
  it("clips accessibility overlays at an interior point without changing future legs", () => {
    const path = buildCumulativePath(route.legs);
    renderProgress({
      routeProgress: {
        routeToken: "route-a",
        navigationId: "nav-a",
        routeVersion: 1,
        legIndex: 0,
        segmentIndex: 0,
        alongM: path.cumM[1] / 2,
        observedAt: Date.now(),
        source: "gps",
      },
    });
    const gray = rendered.sources.find((s) => s.id.endsWith("-completed"));
    const ramp = rendered.sources.find((s) => s.id.includes("-ramp-"));
    expect(ramp?.coordinates[0]).toEqual(gray?.coordinates.at(-1));
    expect(ramp?.coordinates[0][0]).toBeCloseTo(121.0005, 8);
    expect(
      rendered.sources.find((s) => s.id.includes("-traffic-"))?.coordinates,
    ).toEqual(route.legs[1].polyline);
  });
  it("retains full route and overlays in preview or a mismatched navigation session", () => {
    renderProgress({ navigationId: "different-navigation" });
    expect(rendered.sources.some((s) => s.id.endsWith("-completed"))).toBe(
      false,
    );
    expect(
      rendered.sources.find((s) => s.id.includes("-traffic-"))?.coordinates,
    ).toEqual(route.legs[1].polyline);
    rendered.sources = [];
    renderProgress({ navigationMode: "preview" });
    expect(rendered.sources.some((s) => s.id.endsWith("-completed"))).toBe(
      false,
    );
  });
});
