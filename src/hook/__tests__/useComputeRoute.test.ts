import i18n from "i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locale/en/translation.json";
import zhTW from "@/i18n/locale/zh-TW/translation.json";
import { ApiError } from "@/lib/fetch";
import useMapStore from "@/stores/useMapStore";
import type { AccessibleRoute } from "@/types/route";

const h = vi.hoisted(() => ({
  effects: [] as (() => undefined | (() => void))[],
  loading: vi.fn(),
  post: vi.fn(),
  toast: vi.fn(),
}));

// Exercise the real async hook callbacks and Zustand mutations; only the React
// lifecycle is driven manually (this project has no DOM test environment).
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useCallback: (fn: unknown) => fn,
  useRef: (current: unknown) => ({ current }),
  useState: () => [false, h.loading],
  useEffect: (effect: () => undefined | (() => void)) => h.effects.push(effect),
}));
vi.mock("zustand/react/shallow", () => ({
  useShallow: (selector: unknown) => selector,
}));
vi.mock("@/i18n/client", () => ({
  useAppTranslation: () => ({ t: i18n.t.bind(i18n), i18n }),
}));
vi.mock("@/lib/api/a11y", () => ({ getAccessibleRoute: h.post }));
vi.mock("sonner", () => ({ toast: { error: h.toast } }));
vi.mock("@/stores/useMapStore", async (importOriginal) => {
  const { default: store } =
    await importOriginal<typeof import("@/stores/useMapStore")>();
  return {
    default: Object.assign(
      (selector: (state: ReturnType<typeof store.getState>) => unknown) =>
        selector(store.getState()),
      store,
    ),
  };
});

import useComputeRoute from "../useComputeRoute";

const route: AccessibleRoute = {
  routeId: "new-route",
  routeName: "Route",
  totalMinutes: 10,
  transferCount: 0,
  legs: [],
  accessibilityHighlights: [],
};
const params = {
  origin: { lat: 25.0478, lng: 121.517 },
  destination: { lat: 25.033, lng: 121.5654 },
};
const result = (name = "Route") => ({
  ok: true,
  data: { routes: [{ ...route, routeName: name }] },
});
function deferred() {
  let resolve!: (value: ReturnType<typeof result>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<ReturnType<typeof result>>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
let cleanup: undefined | (() => void);
function mount() {
  // biome-ignore lint/correctness/useHookAtTopLevel: manually driven hook lifecycle; React hooks are mocked above
  const hook = useComputeRoute();
  cleanup = h.effects[0]();
  return hook;
}

beforeEach(async () => {
  vi.clearAllMocks();
  h.effects.length = 0;
  await i18n.init({
    lng: "en",
    fallbackLng: "zh-TW",
    resources: { en: { translation: en }, "zh-TW": { translation: zhTW } },
  });
  useMapStore.setState({
    map: null,
    routeGeneration: 0,
    computeRoutes: null,
    selectRoute: null,
    userLocation: null,
    routeInfoShow: false,
  });
  h.post.mockResolvedValue(result());
});
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.restoreAllMocks();
});

describe("useComputeRoute language and request ownership", () => {
  it("stores the resolved response mode rather than the requested mode", async () => {
    h.post.mockResolvedValueOnce({
      ok: true,
      data: { routes: [route], travelMode: "walk" },
    });
    const hook = mount();
    expect(
      await hook.handleComputeRoute({ ...params, travelMode: "transit" }),
    ).toBe(true);
    expect(useMapStore.getState().routeTravelMode).toBe("walk");
    useMapStore.getState().setComputeRoutes(null);
    expect(useMapStore.getState().routeTravelMode).toBeNull();
  });

  it.each(["en", "zh-TW"])(
    "sends the effective %s UI language",
    async (language) => {
      await i18n.changeLanguage(language);
      const hook = mount();
      expect(await hook.handleComputeRoute(params)).toBe(true);
      expect(h.post).toHaveBeenCalledWith(
        expect.objectContaining({
          language,
          origin: { latitude: params.origin.lat, longitude: params.origin.lng },
          destination: {
            latitude: params.destination.lat,
            longitude: params.destination.lng,
          },
        }),
      );
      expect(useMapStore.getState().selectRoute?.route.routeName).toBe("Route");
    },
  );

  it("discards a response after a language switch without replanning", async () => {
    const pending = deferred();
    h.post.mockReturnValueOnce(pending.promise);
    const hook = mount();
    const first = hook.handleComputeRoute(params);
    await i18n.changeLanguage("zh-TW");
    expect(h.loading).toHaveBeenLastCalledWith(false);
    expect(useMapStore.getState().routeInfoShow).toBe(false);
    pending.resolve(result("Old English"));
    expect(await first).toBe(false);
    expect(useMapStore.getState().computeRoutes).toBeNull();
    expect(h.post).toHaveBeenCalledTimes(1);
    expect(h.toast).not.toHaveBeenCalled();
  });

  it("does not resurrect a pending response after en → zh-TW → en", async () => {
    const pending = deferred();
    h.post.mockReturnValueOnce(pending.promise);
    const hook = mount();
    const first = hook.handleComputeRoute(params);
    await i18n.changeLanguage("zh-TW");
    await i18n.changeLanguage("en");
    pending.resolve(result());
    expect(await first).toBe(false);
    expect(useMapStore.getState().computeRoutes).toBeNull();
  });

  it("an old completion cannot clear the new request's loading state", async () => {
    const old = deferred();
    const current = deferred();
    h.post
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(current.promise);
    const hook = mount();
    const first = hook.handleComputeRoute(params);
    await i18n.changeLanguage("zh-TW");
    const second = hook.handleComputeRoute(params);
    old.resolve(result("Old"));
    expect(await first).toBe(false);
    expect(h.loading).toHaveBeenLastCalledWith(true);
    expect(useMapStore.getState().routeInfoShow).toBe(true);
    current.resolve(result("新路線"));
    expect(await second).toBe(true);
    expect(h.loading).toHaveBeenLastCalledWith(false);
    expect(useMapStore.getState().selectRoute?.route.routeName).toBe("新路線");
  });

  it("ignores stale failures without a toast or changes to the new result", async () => {
    const old = deferred();
    h.post.mockReturnValueOnce(old.promise);
    const hook = mount();
    const first = hook.handleComputeRoute(params);
    await i18n.changeLanguage("zh-TW");
    expect(await hook.handleComputeRoute(params)).toBe(true);
    const snapshot = useMapStore.getState();
    old.reject(new ApiError("Old failure", 422, "NO_ROUTE"));
    expect(await first).toBe(false);
    expect(useMapStore.getState()).toBe(snapshot);
    expect(h.toast).not.toHaveBeenCalled();
  });

  it("preserves the global generation guard against another planning source", async () => {
    const old = deferred();
    h.post.mockReturnValueOnce(old.promise);
    const hook = mount();
    const first = hook.handleComputeRoute(params);
    useMapStore
      .getState()
      .setComputeRoutes([{ ...route, routeName: "AI route" }]);
    old.resolve(result("Old"));
    expect(await first).toBe(false);
    expect(useMapStore.getState().computeRoutes?.[0].routeName).toBe(
      "AI route",
    );
  });

  it("does not replan or clear a completed route on language change", async () => {
    const hook = mount();
    await hook.handleComputeRoute(params);
    const snapshot = useMapStore.getState();
    await i18n.changeLanguage("zh-TW");
    expect(h.post).toHaveBeenCalledTimes(1);
    expect(useMapStore.getState()).toBe(snapshot);
  });

  it("does not publish after unmount", async () => {
    const pending = deferred();
    h.post.mockReturnValueOnce(pending.promise);
    const hook = mount();
    const first = hook.handleComputeRoute(params);
    cleanup?.();
    pending.resolve(result());
    expect(await first).toBe(false);
    expect(useMapStore.getState().computeRoutes).toBeNull();
  });

  it.each([undefined, "FUTURE_REASON"])(
    "preserves backend message for unknown/legacy reason %s",
    async (reason) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      h.post.mockRejectedValueOnce(
        new ApiError("Source explanation", 422, reason),
      );
      const hook = mount();
      expect(await hook.handleComputeRoute(params)).toBe(false);
      expect(h.toast).toHaveBeenLastCalledWith("Source explanation");
    },
  );

  it("localizes empty results and generic failures", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.post.mockResolvedValueOnce({ ok: true, data: { routes: [] } });
    const hook = mount();
    expect(await hook.handleComputeRoute(params)).toBe(false);
    expect(h.toast).toHaveBeenLastCalledWith(en.routeErrorEmpty);
    h.post.mockRejectedValueOnce(new Error("offline"));
    expect(await hook.handleComputeRoute(params)).toBe(false);
    expect(h.toast).toHaveBeenLastCalledWith(en.routeErrorPlanning);
  });
});
