import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  effects: [] as (() => undefined | (() => void))[],
  language: "zh-TW",
  reroute: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: (effect: () => undefined | (() => void)) => h.effects.push(effect),
  useRef: (value: unknown) => ({ current: value }),
  useState: (value: unknown) => [value, vi.fn()],
  useCallback: (value: unknown) => value,
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) =>
    snapshot(),
  useDebugValue: () => {},
}));
vi.mock("@/stores/useMapStore", async (original) => {
  const actual = await original<typeof import("@/stores/useMapStore")>();
  return {
    ...actual,
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
vi.mock("@/stores/useNavStore", async (original) => {
  const actual = await original<typeof import("@/stores/useNavStore")>();
  return {
    ...actual,
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
vi.mock("@/i18n/client", () => ({
  useAppTranslation: () => ({ i18n: { language: h.language } }),
}));
vi.mock("../useRouteReroute", () => ({
  default: () => ({
    confirmOffRouteEpisode: h.reroute,
    clearOffRouteEpisode: vi.fn(),
  }),
}));
vi.mock("@/lib/api/a11y", () => ({ getRouteInstructions: vi.fn() }));

import { getRouteInstructions } from "@/lib/api/a11y";
import useMapStore from "@/stores/useMapStore";
import useNavStore from "@/stores/useNavStore";
import type { AccessibleRoute, NavInstruction } from "@/types/route";
import useNavigation from "../useNavigation";

const route = {
  routeToken: "same-token",
  routeId: "same-route",
  navigationId: "nav",
  routeVersion: 1,
  totalMinutes: 3,
  legs: [
    {
      type: "WALK",
      polyline: [
        [121, 25],
        [121.002, 25],
      ],
      a11yFacilities: [],
    },
  ],
} as unknown as AccessibleRoute;
let cleanup: (() => void) | undefined;
function load(language: string) {
  cleanup?.();
  h.language = language;
  h.effects.length = 0;
  // biome-ignore lint/correctness/useHookAtTopLevel: deterministic effect harness
  useNavigation();
  cleanup = h.effects[2]() as (() => void) | undefined;
}
beforeEach(() => {
  h.reroute.mockClear();
  useNavStore.getState().reset();
  useMapStore.setState({
    activeNavigationRoute: route,
    isNavigating: true,
    userLocation: null,
    invalidRouteTokens: [],
  });
});
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.clearAllMocks();
});
describe("navigation language switch", () => {
  it("requests the same token in the new language and ignores a late old-language response without rerouting", async () => {
    let oldResolve!: (
      value: Awaited<ReturnType<typeof getRouteInstructions>>,
    ) => void;
    const steps = (text: string): NavInstruction[] => [
      {
        text,
        type: "depart",
        legType: "WALK",
        legIndex: 0,
        polylineIndex: 0,
        bearing: null,
        relativeDirection: null,
        distanceM: 30,
        streetName: null,
      },
    ];
    const response = (text: string) => ({
      ok: true,
      status: "success" as const,
      code: 200,
      message: "",
      data: {
        instructions: steps(text),
        initialBearing: 0,
        totalSteps: 1,
        warnings: [],
      },
    });
    vi.mocked(getRouteInstructions)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            oldResolve = resolve;
          }),
      )
      .mockResolvedValueOnce(response("Roosevelt Road"));
    load("zh-TW");
    load("en");
    await Promise.resolve();
    expect(useNavStore.getState().instructions[0].text).toBe("Roosevelt Road");
    oldResolve(response("羅斯福路"));
    await Promise.resolve();
    expect(useNavStore.getState().instructions[0].text).toBe("Roosevelt Road");
    expect(
      vi
        .mocked(getRouteInstructions)
        .mock.calls.map(([request]) => [request.routeToken, request.language]),
    ).toEqual([
      ["same-token", "zh-TW"],
      ["same-token", "en"],
    ]);
    expect(useMapStore.getState().activeNavigationRoute).toBe(route);
    expect(h.reroute).not.toHaveBeenCalled();
  });
});
