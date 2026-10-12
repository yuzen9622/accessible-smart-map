import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  lang: "zh-TW" as "en" | "zh-TW",
  slots: [] as unknown[],
  cursor: 0,
  effect: undefined as undefined | (() => (() => void) | undefined),
  deps: undefined as unknown[] | undefined,
  routes: vi.fn(),
  stops: vi.fn(),
}));
vi.mock("react", () => ({
  useState: (initial: unknown) => {
    const i = h.cursor++;
    if (!(i in h.slots)) h.slots[i] = initial;
    return [
      h.slots[i],
      (value: unknown) => {
        h.slots[i] = value;
      },
    ];
  },
  useEffect: (fn: () => (() => void) | undefined, deps: unknown[]) => {
    if (!h.deps || deps.some((v, i) => !Object.is(v, h.deps![i]))) {
      h.effect = fn;
      h.deps = deps;
    }
  },
}));
vi.mock("@/i18n/client", () => ({ useAppTranslation: () => ({}) }));
vi.mock("@/i18n/language", () => ({ getAppLanguage: () => h.lang }));
vi.mock("@/lib/api/transit", () => ({
  searchBusRoutes: h.routes,
  searchBusStops: h.stops,
}));

import useBusSearch from "../useBusSearch";

let cleanup: (() => void) | undefined;
function render(runEffect = true) {
  h.cursor = 0;
  // biome-ignore lint/correctness/useHookAtTopLevel: Node-only hook driver with mocked React lifecycle.
  const result = useBusSearch("線", "route");
  if (runEffect && h.effect) {
    cleanup?.();
    cleanup = h.effect();
    h.effect = undefined;
  }
  return result;
}
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
beforeEach(() => {
  h.lang = "zh-TW";
  h.slots = [];
  h.deps = undefined;
  h.effect = undefined;
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.useRealTimers();
  vi.clearAllMocks();
});
it("clears prior locale immediately and ignores deferred old locale arriving after English", async () => {
  let resolve!: (v: unknown) => void;
  h.routes.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  render();
  await vi.advanceTimersByTimeAsync(400);
  h.lang = "en";
  h.routes.mockResolvedValueOnce({
    ok: true,
    data: { routes: [{ routeName: "線", routeDisplayName: "Line" }] },
  });
  expect(render().results).toEqual([]);
  await vi.advanceTimersByTimeAsync(400);
  expect(render().results).toEqual([
    { routeName: "線", routeDisplayName: "Line" },
  ]);
  resolve({
    ok: true,
    data: { routes: [{ routeName: "線", routeDisplayName: "舊" }] },
  });
  await flush();
  expect(render().results).toEqual([
    { routeName: "線", routeDisplayName: "Line" },
  ]);
  expect(h.routes.mock.calls).toEqual([
    ["線", undefined, "zh-TW"],
    ["線", undefined, "en"],
  ]);
  h.lang = "zh-TW";
  expect(render(false).results).toEqual([]);
});
