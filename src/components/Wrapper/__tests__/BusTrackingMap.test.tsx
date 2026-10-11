import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import useBusTrackingStore from "@/stores/useBusTrackingStore";
import useMapStore from "@/stores/useMapStore";
import TransitWrapper from "../TransitWrapper";

vi.mock("@/stores/useMapStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/useMapStore")>();
  return {
    default: Object.assign(
      (s: (state: ReturnType<typeof actual.default.getState>) => unknown) =>
        s(actual.default.getState()),
      actual.default,
    ),
  };
});
vi.mock("@/stores/useBusTrackingStore", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/stores/useBusTrackingStore")>();
  return {
    default: Object.assign(
      (s: (state: ReturnType<typeof actual.default.getState>) => unknown) =>
        s(actual.default.getState()),
      actual.default,
    ),
  };
});
vi.mock("react-map-gl/maplibre", () => ({
  useMap: () => ({ current: null }),
  Marker: ({
    children,
    longitude,
    latitude,
  }: {
    children: React.ReactNode;
    longitude: number;
    latitude: number;
  }) => <output data-position={`${longitude},${latitude}`}>{children}</output>,
}));
vi.mock("use-supercluster", () => ({ default: () => ({ clusters: [] }) }));
vi.mock("@/hook/useMapBoundsAndZoom", () => ({
  useMapBoundsAndZoom: () => ({ bounds: null, zoom: 14 }),
}));
beforeEach(() => {
  useMapStore.setState({
    activeRailPanel: "bus",
    busRouteStops: [
      {
        seq: 1,
        name: "A",
        lat: 25,
        lng: 121,
        estimateMinutes: null,
        statusLabel: "",
      },
    ],
    busRoutePolyline: [],
    nearbyBusStops: [],
    userLocation: null,
  });
  useBusTrackingStore.getState().publish({
    receivedAt: Date.now(),
    arrival: null,
    buses: [
      {
        plateNumb: "PANEL",
        direction: 2,
        lat: 25,
        lng: 121,
        speed: 0,
        gpsTime: new Date().toISOString(),
        isLowFloor: "",
        hasLiftOrRamp: "",
        vehicleClass: "",
      },
    ],
  });
});
describe("standalone map layer", () => {
  it("renders separate tracking vehicles without replacing navigation positions", () => {
    const nav = useMapStore.getState().liveBusPositions;
    const active = useMapStore.getState().activeBusLeg;
    const html = renderToStaticMarkup(<TransitWrapper />);
    expect(html).toContain("PANEL");
    expect(html).toContain('data-position="121,25"');
    expect(useMapStore.getState().liveBusPositions).toBe(nav);
    expect(useMapStore.getState().activeBusLeg).toBe(active);
  });
  it("revoked snapshot and other panels hide standalone vehicles", () => {
    useBusTrackingStore.getState().publish(null);
    expect(renderToStaticMarkup(<TransitWrapper />)).not.toContain("PANEL");
    useMapStore.setState({ activeRailPanel: "search" });
    expect(renderToStaticMarkup(<TransitWrapper />)).toBe("");
  });
});
