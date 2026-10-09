import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MapStore } from "@/stores/map/types";
import type { AccessibleRoute } from "@/types/route";

const capture = vi.hoisted(() => ({
  selector: null as ((state: MapStore) => unknown) | null,
  stop: new Error("HUD selector captured"),
}));

vi.mock("@/i18n/client", () => ({
  useAppTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));
vi.mock("@/stores/useMapStore", () => ({
  default: (selector: (state: MapStore) => unknown) => {
    capture.selector = selector;
    // Stop after the real HUD creates its real useShallow selector. No map,
    // GPS, voice or effect is needed to exercise getSnapshot stability.
    throw capture.stop;
  },
}));

import NavigationHUD from "../NavigationHUD";

const route: AccessibleRoute = {
  routeId: "a",
  routeName: "A",
  totalMinutes: 3,
  transferCount: 0,
  accessibilityHighlights: [],
  legs: [],
};

function selector(): (state: MapStore) => unknown {
  capture.selector = null;
  expect(() => renderToStaticMarkup(<NavigationHUD />)).toThrow(capture.stop);
  if (!capture.selector) throw new Error("HUD did not subscribe to map state");
  return capture.selector;
}

function state(active: AccessibleRoute | null): MapStore {
  return {
    activeNavigationRoute: active,
    selectRoute: { index: 0, route },
    userLocation: { lat: 25, lng: 121.5 },
  } as MapStore;
}

describe("NavigationHUD useSyncExternalStore snapshot", () => {
  it.each([false, true])(
    "returns the same snapshot for unchanged state (active navigation: %s)",
    (active) => {
      const read = selector();
      const snapshot = state(active ? route : null);
      const first = read(snapshot);
      expect(read(snapshot)).toBe(first);
      expect(read({ ...snapshot, sidebarCollapsed: true })).toBe(first);
    },
  );

  it("ignores preview selection while following the active navigation route", () => {
    const read = selector();
    const snapshot = state(route);
    const first = read(snapshot);
    expect(
      read({
        ...snapshot,
        selectRoute: { index: 1, route: { ...route, routeId: "preview-b" } },
      }),
    ).toBe(first);
    expect(
      read({
        ...snapshot,
        activeNavigationRoute: { ...route, routeVersion: 2 },
      }),
    ).not.toBe(first);
    expect(
      read({ ...snapshot, userLocation: { lat: 25.01, lng: 121.5 } }),
    ).not.toBe(first);
  });
});
