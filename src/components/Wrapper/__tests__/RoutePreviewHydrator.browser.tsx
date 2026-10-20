import { act } from "react";
import { createRoot } from "react-dom/client";
import { toast } from "sonner";
import { lineRoadPlanFixture } from "@/lib/__tests__/lineRoadPreview.fixture";
import useMapStore from "@/stores/useMapStore";
import RoutePreviewHydrator from "../RoutePreviewHydrator";
import { navigation } from "./routePreviewNavigation.fixture";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const token = "a".repeat(43);
const route = (id: string) => ({
  routeId: id,
  routeName: id,
  routeToken: `trusted-${id}`,
  totalMinutes: 10,
  transferCount: 0,
  accessibilityHighlights: ["無階梯"],
  legs: [
    {
      type: "WALK",
      legName: "保留的路段",
      from: "起",
      to: "迄",
      distanceM: 100,
      minutesEst: 10,
      a11yFacilities: [],
      polyline: [[121.5, 25], id === "b" ? [121.6, 25.1] : [121.51, 25.01]],
    },
  ],
});
const plan = () => ({
  ok: true,
  routeContractVersion: 1,
  planId: "d15bd2ca-cd6f-413f-9107-e8066be139a1",
  selectedRouteId: "b",
  origin: { name: "起點", lat: 25, lng: 121.5 },
  destination: { name: "終點", lat: 25.01, lng: 121.51 },
  city: "Taipei",
  mode: "wheelchair",
  travelMode: "transit",
  routes: [route("a"), route("b")],
  effectivePreferences: {
    mode: "wheelchair",
    travelMode: "transit",
    transitPreference: "rail",
    avoidStairs: true,
    requireElevator: true,
    maxTransfers: 2,
    maxSlopePercent: 6,
    departureTime: "2026-10-20T10:00:00+08:00",
  },
  metroAlerts: [],
  transitAlerts: [],
  alerts: ["保留"],
});
const results: string[] = [];
const check = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
const equal = (a: unknown, b: unknown, message: string) =>
  check(JSON.stringify(a) === JSON.stringify(b), message);
let errors: unknown[] = [];
let requests: string[] = [];
let response: unknown;
let reject = false;
let expired = false;
let pending: ((value: Response) => void) | null = null;
let deferred = false;
let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLDivElement;
const reply = (data: unknown) =>
  new Response(
    JSON.stringify({ ok: true, status: "success", code: 200, data }),
    { status: 200 },
  );
window.fetch = async (input) => {
  requests.push(String(input));
  if (expired)
    return new Response(
      JSON.stringify({ ok: false, code: 404, message: "expired" }),
      { status: 404 },
    );
  if (reject) throw new Error("offline");
  if (deferred)
    return new Promise<Response>((resolve) => {
      pending = resolve;
    });
  return reply(response);
};
toast.error = (message) => {
  errors.push(message);
  return 1;
};
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function render(query: string) {
  navigation.params = new URLSearchParams(query);
  await act(async () => {
    root?.render(<RoutePreviewHydrator />);
  });
  await flush();
}
async function reset() {
  await act(async () => root?.unmount());
  useMapStore.setState(useMapStore.getInitialState());
  errors = [];
  requests = [];
  response = plan();
  reject = false;
  expired = false;
  deferred = false;
  pending = null;
  navigation.replacements = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
}
async function test(name: string, body: () => Promise<void>) {
  await reset();
  try {
    await body();
    results.push(`PASS ${name}`);
  } catch (e) {
    results.push(`FAIL ${name}: ${String(e)}`);
  }
}
await test("direct planToken preserves exact result and never starts navigation", async () => {
  await render(`planToken=${token}`);
  const s = useMapStore.getState();
  check(
    requests.length === 1 && requests[0].endsWith(`?planToken=${token}`),
    "missing snapshot HTTP request",
  );
  equal(s.computeRoutes, plan().routes, "routes/token/legName changed");
  equal(
    s.effectivePreferences,
    plan().effectivePreferences,
    "preferences lost",
  );
  check(
    s.selectedRouteId === "b" &&
      s.selectRoute?.index === 1 &&
      s.planId === plan().planId,
    "selection identity lost",
  );
  check(
    s.originName === "起點" &&
      s.destinationName === "終點" &&
      s.sheetMode === "route" &&
      s.routeInfoShow,
    "result UI not opened",
  );
  check(!s.isNavigating && s.activeNavigationRoute === null, "auto navigation");
  equal(s.metroAlerts, [], "alerts lost");
  check(errors.length === 0, "unexpected error");
});
await test("LIFF wrapped planToken", async () => {
  await render(
    new URLSearchParams({ "liff.state": `/?planToken=${token}` }).toString(),
  );
  check(
    useMapStore.getState().selectedRouteId === "b",
    "wrapped link not hydrated",
  );
});
await test("canonical SOS keeps complete routes and labels", async () => {
  response = {
    sessionId: "c".repeat(32),
    origin: { lat: 25, lng: 121.5 },
    destination: { lat: 25.01, lng: 121.51 },
    originLabel: "SOS起",
    destinationLabel: "SOS迄",
    routes: plan().routes,
    travelMode: "transit",
  };
  await render(`sessionId=${"c".repeat(32)}`);
  const s = useMapStore.getState();
  equal(s.computeRoutes, plan().routes, "SOS route fields changed");
  check(
    s.originName === "SOS起" && s.destinationName === "SOS迄",
    "SOS labels lost",
  );
  check(
    s.selectRoute?.index === 0 && !s.isNavigating,
    "SOS selection/navigation wrong",
  );
});
await test("late map readiness centers selected bounds", async () => {
  await render(`planToken=${token}`);
  const fits: unknown[] = [];
  await act(async () => {
    useMapStore.setState({
      map: {
        resize: () => {},
        getContainer: () => host,
        fitBounds: (...args: unknown[]) => fits.push(args),
      } as never,
    });
  });
  await new Promise(requestAnimationFrame);
  check(fits.length === 1, "late map was not centered");
  const bounds = (fits[0] as [{ toArray: () => number[][] }])[0];
  equal(
    bounds.toArray(),
    [
      [121.5, 25],
      [121.6, 25.1],
    ],
    "selected route geometry not included in bounds",
  );
});
for (const mode of ["drive", "motorcycle"] as const) {
  await test(`${mode} planToken keeps canonical road result`, async () => {
    const road = lineRoadPlanFixture(mode);
    response = road;
    const query = `planToken=${token}`;
    await render(
      mode === "drive"
        ? query
        : new URLSearchParams({ "liff.state": `/?${query}` }).toString(),
    );
    const state = useMapStore.getState();
    equal(
      state.computeRoutes,
      road.routes,
      "road geometry/coordinates/maneuvers lost",
    );
    equal(
      state.effectivePreferences,
      road.effectivePreferences,
      "road mode/preferences lost",
    );
    check(
      state.routeInfoShow && state.sheetMode === "route",
      "road result panel missing",
    );
    check(!state.isNavigating && errors.length === 0, "road navigation/error");
  });
  await test(`SOS ${mode} keeps canonical road result`, async () => {
    const road = lineRoadPlanFixture(mode);
    response = {
      sessionId: "c".repeat(24),
      origin: road.origin,
      destination: road.destination,
      originLabel: "SOS起點",
      destinationLabel: "SOS終點",
      travelMode: mode,
      routes: road.routes,
    };
    const query = `sessionId=${"c".repeat(32)}`;
    await render(
      mode === "drive"
        ? query
        : new URLSearchParams({ "liff.state": `/?${query}` }).toString(),
    );
    const state = useMapStore.getState();
    equal(state.computeRoutes, road.routes, "SOS road result changed");
    check(
      state.originName === "SOS起點" && state.destinationName === "SOS終點",
      "SOS labels lost",
    );
    check(
      state.routeInfoShow &&
        state.sheetMode === "route" &&
        !state.isNavigating &&
        errors.length === 0,
      "SOS road panel/navigation/error",
    );
  });
}
for (const failure of [
  "malformed",
  "empty",
  "invalid",
  "expired",
  "network",
  "conflict",
]) {
  await test(`${failure} gives error without success`, async () => {
    if (failure === "empty") response = { ...plan(), routes: [] };
    if (failure === "invalid")
      response = { ...plan(), selectedRouteId: "missing" };
    if (failure === "expired") expired = true;
    if (failure === "network") reject = true;
    const query =
      failure === "malformed"
        ? "planToken=bad"
        : failure === "conflict"
          ? `planToken=${token}&sessionId=${"c".repeat(32)}`
          : `planToken=${token}`;
    await render(query);
    check(errors.length > 0, "no error toast");
    check(
      !useMapStore.getState().routeInfoShow &&
        useMapStore.getState().computeRoutes === null,
      "invalid data presented as success",
    );
  });
}
await test("A to B discards old request", async () => {
  deferred = true;
  await render(`planToken=${token}`);
  const old = pending;
  check(typeof old === "function", "no A request to race");
  deferred = false;
  response = { ...plan(), planId: "new-plan" };
  await render(`planToken=${"b".repeat(43)}`);
  await act(async () => {
    old?.(reply(plan()));
  });
  await flush();
  check(useMapStore.getState().planId === "new-plan", "stale A overwrote B");
});
await test("cancelled route session discards in-flight request", async () => {
  deferred = true;
  await render(`planToken=${token}`);
  const old = pending;
  check(typeof old === "function", "no in-flight request to cancel");
  useMapStore.getState().endRouteSession();
  await act(async () => {
    old?.(reply(plan()));
  });
  await flush();
  check(
    useMapStore.getState().computeRoutes === null,
    "cancelled result applied",
  );
});
await test("active navigation not replaced", async () => {
  useMapStore.setState({ isNavigating: true });
  await render(`planToken=${token}`);
  check(
    useMapStore.getState().computeRoutes === null &&
      useMapStore.getState().isNavigating,
    "active navigation overwritten",
  );
});
await act(async () => root?.unmount());
document.body.textContent = results.join("\n");
document.body.dataset.done = "true";
