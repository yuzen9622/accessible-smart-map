import type React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/stores/useMapStore", () => ({
  default: vi.fn(),
}));

import Polyline from "@/components/Polyline";
import RouteLine from "@/components/Wrapper/RouteWrapper";
import useMapStore from "@/stores/useMapStore";
import type { AccessibleRoute, BusLeg, DriveLeg, WalkLeg } from "@/types/route";
import { TRAFFIC_BASE_COLOR, TRAFFIC_LEVEL_COLORS } from "@/types/route";

const mockUseMapStore = vi.mocked(useMapStore);

vi.mock("react-map-gl/maplibre", () => ({
  Source: ({ id, children }: { id: string; children?: React.ReactNode }) => (
    <div data-testid="mock-source" data-source-id={id}>
      {children}
    </div>
  ),
  Layer: ({ id }: { id: string }) => (
    <div data-testid="mock-layer" data-layer-id={id} />
  ),
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
