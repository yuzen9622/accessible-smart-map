import type { ReactElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  effects: [] as (() => void)[],
  cleanups: [] as (() => void)[],
  lang: "zh-TW" as "en" | "zh-TW",
  routes: vi.fn(),
  stops: vi.fn(),
  detail: vi.fn(),
  nearby: vi.fn(),
  setStops: vi.fn(),
  setSelected: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useMemo: (fn: () => unknown) => fn(),
  useRef: (value: unknown) => {
    const i = h.cursor++;
    h.slots[i] ??= { current: value };
    return h.slots[i];
  },
  useState: (value: unknown) => {
    const i = h.cursor++;
    if (!(i in h.slots))
      h.slots[i] = typeof value === "function" ? value() : value;
    return [
      h.slots[i],
      (next: unknown) => {
        h.slots[i] = typeof next === "function" ? next(h.slots[i]) : next;
      },
    ];
  },
  useEffect: (fn: () => (() => void) | undefined, deps: unknown[]) => {
    const i = h.cursor++;
    const old = h.slots[i] as unknown[] | undefined;
    if (!old || deps.some((v, j) => !Object.is(v, old[j]))) {
      h.slots[i] = deps;
      h.effects.push(() => {
        h.cleanups[i]?.();
        h.cleanups[i] = fn() ?? (() => {});
      });
    }
  },
}));
vi.mock("zustand/react/shallow", () => ({ useShallow: (s: unknown) => s }));
const t = (key: string, params?: { destination?: string }) =>
  params?.destination ?? key;
vi.mock("@/i18n/client", () => ({ useAppTranslation: () => ({ t }) }));
vi.mock("@/i18n/language", () => ({ getAppLanguage: () => h.lang }));
vi.mock("@/hook/useBusSearch", () => ({
  default: () => ({
    results: [
      {
        routeName: "線",
        routeDisplayName: "中文線",
        city: "Taipei",
        departure: "起",
        destination: "終",
      },
      {
        stopUid: "stop-id",
        stopName: "站",
        stopDisplayName: "中文站",
        city: "Taipei",
        coordinates: [121, 25],
        routes: ["線", "支線"],
        routeDisplayNames: ["中文線", "中文支線"],
      },
    ],
    loading: false,
  }),
}));
vi.mock("@/lib/api/transit", () => ({
  getBusRouteDetail: h.detail,
  getNearbyBusStops: h.nearby,
  searchBusRoutes: h.routes,
  searchBusStops: h.stops,
}));
vi.mock("@/stores/useMapStore", () => ({
  default: (s: (v: unknown) => unknown) =>
    s({
      userLocation: null,
      map: null,
      nearbyBusStops: [],
      setNearbyBusStops: h.setStops,
      setBusRouteStops: h.setStops,
      selectedBusStop: null,
      setSelectedBusStop: h.setSelected,
    }),
}));

import BusPanel from "../BusPanel";

function render() {
  h.cursor = 0;
  const tree = BusPanel({ onClose: () => {} });
  const effects = h.effects.splice(0);
  effects.forEach((fn) => {
    fn();
  });
  return tree;
}
function nodes(tree: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object" || !("props" in tree)) return [];
  const el = tree as ReactElement<Record<string, unknown>>;
  return [el, ...nodes(el.props.children)];
}
function text(tree: unknown): string {
  if (Array.isArray(tree)) return tree.map(text).join(" ");
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  if (tree && typeof tree === "object" && "props" in tree)
    return text((tree as ReactElement<Record<string, unknown>>).props.children);
  return "";
}
const flush = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve();
};
function deferred() {
  let resolve!: (v: unknown) => void;
  return {
    promise: new Promise((r) => {
      resolve = r;
    }),
    resolve: (v: unknown) => resolve(v),
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  h.lang = "zh-TW";
  h.routes.mockResolvedValue({ data: { routes: [] } });
  h.stops.mockResolvedValue({ data: { stops: [] } });
  h.detail.mockResolvedValue({ ok: true, data: { directions: [] } });
  vi.stubGlobal("document", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});
afterEach(() => {
  h.cleanups.forEach((fn) => {
    fn?.();
  });
  h.slots = [];
  h.cleanups = [];
  h.effects = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it("keeps canonical selected route, invalidates display and rejects a late old-language detail", async () => {
  let tree = render();
  const input = nodes(tree).find((el) => el.type === "input")!;
  (input.props.onChange as (e: unknown) => void)({ target: { value: "線" } });
  tree = render();
  const route = nodes(tree).find(
    (el) =>
      typeof el.props.onSelect === "function" && text(el).includes("中文線"),
  )!;
  expect(route.key).toBe("Taipei-線-起-終");
  expect(route.props.value).toBe("Taipei-線-起-終");
  (route.props.onSelect as () => void)();
  const old = deferred();
  h.detail.mockReturnValueOnce(old.promise);
  render();
  h.lang = "en";
  const fresh = deferred();
  h.detail.mockReturnValueOnce(fresh.promise);
  tree = render();
  expect(text(tree)).not.toContain("中文線");
  h.routes.mockResolvedValue({ data: { routes: [] } });
  fresh.resolve({
    ok: true,
    data: {
      routeDisplayName: "Line",
      directions: [
        {
          direction: 0,
          subRouteUid: "same-id",
          subRouteName: "支線",
          subRouteDisplayName: "Branch",
          stops: [
            {
              seq: 1,
              name: "終",
              displayName: "End",
              lat: 25,
              lng: 121,
              estimateMinutes: null,
              statusLabel: "",
            },
          ],
        },
      ],
    },
  });
  await flush();
  tree = render();
  expect(text(tree)).toContain("Line");
  expect(text(tree)).toContain("Branch · End");
  old.resolve({ ok: true, data: { routeDisplayName: "OLD", directions: [] } });
  await flush();
  expect(text(render())).toContain("Line");
  expect(text(render())).not.toContain("OLD");
  expect(h.detail.mock.calls.at(-1)).toEqual([
    "線",
    "Taipei",
    undefined,
    expect.any(AbortSignal),
    undefined,
    "en",
  ]);
});
it("refreshes selected stop by canonical name and UID and renders route tags in original order", async () => {
  let tree = render();
  const stopMode = nodes(tree).find(
    (el) => el.type === "button" && text(el) === "找站牌",
  )!;
  (stopMode.props.onClick as () => void)();
  tree = render();
  const input = nodes(tree).find((el) => el.type === "input")!;
  (input.props.onChange as (e: unknown) => void)({ target: { value: "站" } });
  tree = render();
  const stop = nodes(tree).find(
    (el) =>
      typeof el.props.onSelect === "function" && text(el).includes("中文站"),
  )!;
  (stop.props.onSelect as () => void)();
  render();
  await flush();
  h.stops.mockResolvedValue({
    data: {
      stops: [
        {
          stopUid: "stop-id",
          city: "Taipei",
          stopDisplayName: "Stop",
          routeDisplayNames: ["Line", " "],
        },
      ],
    },
  });
  h.lang = "en";
  tree = render();
  expect(text(tree)).not.toContain("中文站");
  await flush();
  tree = render();
  expect(text(tree)).toContain("Stop");
  const tags = nodes(tree).filter(
    (el) => el.type === "button" && ["Line", "支線"].includes(text(el)),
  );
  expect(tags.map(text)).toEqual(["Line", "支線"]);
  (tags[0].props.onClick as () => void)();
  render();
  expect(h.detail.mock.calls.at(-1)?.[0]).toBe("線");
  expect(h.stops.mock.calls.at(-1)).toEqual(["站", undefined, "en"]);
});
