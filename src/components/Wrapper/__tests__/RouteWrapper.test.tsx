import type React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/stores/useMapStore", () => ({
  default: vi.fn(),
}));

import Polyline from "@/components/Polyline";
import RouteLine from "@/components/Wrapper/RouteWrapper";
import useMapStore from "@/stores/useMapStore";
import type { AccessibleRoute, BusLeg, WalkLeg } from "@/types/route";

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
  Marker: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="mock-marker">{children}</div>
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
