import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import useMapStore from "@/stores/useMapStore";
import TransitWrapper from "../TransitWrapper";

// SSR normally uses Zustand's startup snapshot; feed the current fixture state
// while retaining the real transit slice/setters under test.
vi.mock("@/stores/useMapStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/useMapStore")>();
  return {
    default: Object.assign(
      (
        selector: (
          state: ReturnType<typeof actual.default.getState>,
        ) => unknown,
      ) => selector(actual.default.getState()),
      actual.default,
    ),
  };
});
vi.mock("react-map-gl/maplibre", () => ({
  useMap: () => ({ current: null }),
  Marker: () => null,
}));
vi.mock("use-supercluster", () => ({ default: () => ({ clusters: [] }) }));
vi.mock("@/hook/useMapBoundsAndZoom", () => ({
  useMapBoundsAndZoom: () => ({ bounds: null, zoom: 14 }),
}));
vi.mock("@/components/Polyline", () => ({
  default: ({ path }: { path: { lng: number; lat: number }[] }) => (
    <output>{JSON.stringify(path)}</output>
  ),
}));

const stop = {
  seq: 1,
  name: "Fixture stop",
  lat: 25,
  lng: 121,
  estimateMinutes: null,
  statusLabel: "",
};
beforeEach(() =>
  useMapStore.setState({
    activeRailPanel: "bus",
    busRouteStops: [],
    busRoutePolyline: [],
    nearbyBusStops: [],
    userLocation: null,
  }),
);
describe("selected bus branch shape", () => {
  it("renders only the published coordinates of the current branch, without loop closure", () => {
    useMapStore.getState().setBusRouteStops(
      [stop],
      [
        [121, 25],
        [122, 26],
      ],
    );
    expect(renderToStaticMarkup(<TransitWrapper />)).toContain(
      "[{&quot;lng&quot;:121,&quot;lat&quot;:25},{&quot;lng&quot;:122,&quot;lat&quot;:26}]",
    );
    useMapStore.getState().setBusRouteStops(
      [stop],
      [
        [123, 27],
        [124, 28],
      ],
    );
    const html = renderToStaticMarkup(<TransitWrapper />);
    expect(html).toContain("&quot;lng&quot;:123");
    expect(html).not.toContain("&quot;lng&quot;:121");
  });
  it("does not fabricate a shape by connecting stops or show it outside the bus panel", () => {
    useMapStore.getState().setBusRouteStops([stop]);
    expect(renderToStaticMarkup(<TransitWrapper />)).not.toContain("output");
    useMapStore.getState().setBusRouteStops(
      [stop],
      [
        [121, 25],
        [122, 26],
      ],
    );
    useMapStore.setState({ activeRailPanel: "search" });
    expect(renderToStaticMarkup(<TransitWrapper />)).toBe("");
  });
});
