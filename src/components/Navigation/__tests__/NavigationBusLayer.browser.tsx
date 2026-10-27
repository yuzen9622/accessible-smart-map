import "maplibre-gl/dist/maplibre-gl.css";
import type {
  GeoJSONSource,
  Map as MapInstance,
  StyleSpecification,
} from "maplibre-gl";
import { createRoot } from "react-dom/client";
import MapView from "react-map-gl/maplibre";
import NowPin from "@/components/shared/NowPin";
import RouteLine from "@/components/Wrapper/RouteWrapper";
import { buildCumulativePath } from "@/lib/geo";
import useMapStore from "@/stores/useMapStore";
import useNavStore from "@/stores/useNavStore";
import type { AccessibleRoute } from "@/types/route";

// Synthetic L-shaped route deliberately exposes coordinate tweening across a corner.
const route: AccessibleRoute = {
  routeId: "renderer-fixture",
  routeToken: "renderer-token",
  navigationId: "renderer-nav",
  routeVersion: 1,
  routeName: "Renderer fixture",
  totalMinutes: 3,
  transferCount: 0,
  accessibilityHighlights: [],
  legs: [
    {
      type: "BUS",
      routeName: "測試公車",
      departureStop: "起站",
      arrivalStop: "迄站",
      direction: 0,
      waitInfo: { source: "schedule", time: 0 },
      estimatedWaitMinutes: 0,
      departureStopA11y: [],
      arrivalStopA11y: [],
      polyline: [
        [121.5, 25],
        [121.5, 25.002],
        [121.502, 25.002],
      ],
    },
  ],
};
const path = buildCumulativePath(route.legs);
const style = (dark: boolean): StyleSpecification => ({
  version: 8,
  sources: {},
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": dark ? "#111827" : "#f1f5f9" },
    },
  ],
});
function progress(alongM: number) {
  useNavStore.setState({
    routeProgress: {
      routeToken: route.routeToken as string,
      navigationId: "renderer-nav",
      routeVersion: 1,
      legIndex: 0,
      segmentIndex: alongM < path.cumM[1] ? 0 : 1,
      alongM,
      observedAt: Date.now(),
      source: "gps",
    },
  });
}
useMapStore.setState({
  isNavigating: true,
  activeNavigationRoute: route,
  routeWaypoints: [],
  venueJourney: null,
  userLocation: { lng: 121.5, lat: 25.001 },
});
useNavStore.setState({
  navigationMode: "live",
  navigationId: "renderer-nav",
  routeVersion: 1,
  navigationSource: "local",
  userHeading: 0,
  transitRide: {
    key: JSON.stringify([
      route.routeToken,
      route.navigationId,
      route.routeVersion,
      0,
    ]),
    boarded: false,
    vehicle: null,
    candidate: null,
    candidateAt: 0,
    sample: null,
    movingSamples: 0,
    observedAtStop: true,
  },
});
progress(path.cumM[1] - 90);
const host = document.createElement("div");
host.style.cssText = "position:fixed;inset:0";
document.body.style.margin = "0";
document.body.append(host);
const css = document.createElement("style");
css.textContent =
  ".sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}";
document.head.append(css);
let map: MapInstance;
const root = createRoot(host);
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const sources = async () => {
  const ids = Object.keys(map.getStyle().sources).filter((id) =>
    id.startsWith("route-leg-"),
  );
  return Promise.all(
    ids.map(async (id) => ({
      id,
      data: await (map.getSource(id) as GeoJSONSource).getData(),
    })),
  );
};
const pixels = () =>
  new Promise((resolve) => {
    map.once("render", () => {
      const canvas = map.getCanvas();
      const gl = canvas.getContext("webgl2");
      if (!gl) throw new Error("WebGL2 context unavailable");
      const width = gl.drawingBufferWidth,
        height = gl.drawingBufferHeight;
      const buffer = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, buffer);
      let count = 0,
        xSum = 0,
        ySum = 0;
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          const r = buffer[i],
            g = buffer[i + 1],
            b = buffer[i + 2];
          if (b > r * 1.4 && b > g * 1.1 && b > 100) {
            count++;
            xSum += x;
            ySum += height - 1 - y;
          }
        }
      resolve({
        count,
        x: xSum / count / devicePixelRatio,
        y: ySum / count / devicePixelRatio,
      });
    });
    map.triggerRepaint();
  });
root.render(
  <MapView
    initialViewState={{
      longitude: 121.5006,
      latitude: 25.00145,
      zoom: 17,
      pitch: 55,
      bearing: -20,
    }}
    mapStyle={style(false)}
    canvasContextAttributes={{ preserveDrawingBuffer: true }}
    onLoad={(event) => {
      map = event.target;
      Object.assign(window, {
        busProbe: {
          map,
          path,
          route,
          progress,
          pixels,
          sources,
          async boarded(value: boolean) {
            useNavStore.setState((s) => ({
              transitRide: s.transitRide
                ? { ...s.transitRide, boarded: value }
                : null,
            }));
            await pause(100);
          },
          async dark(value: boolean) {
            map.setStyle(style(value));
            await pause(300);
          },
          nav(values: Partial<ReturnType<typeof useNavStore.getState>>) {
            useNavStore.setState(values);
          },
          async stop() {
            useMapStore.setState({ isNavigating: false });
            await pause(100);
          },
          async unmount() {
            root.unmount();
            await pause(100);
          },
        },
      });
    }}
  >
    <RouteLine />
    <NowPin />
  </MapView>,
);
