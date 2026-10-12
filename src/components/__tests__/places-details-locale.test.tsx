import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AutocompleteItem, PlaceResult } from "@/types/place";

const h = vi.hoisted(() => ({
  language: "zh-TW",
  callbacks: [] as unknown[],
  effects: [] as { effect: () => undefined | (() => void); deps: unknown[] }[],
  store: {} as Record<string, unknown>,
  details: vi.fn(),
  select: vi.fn(),
  history: vi.fn(),
  info: vi.fn(),
  search: vi.fn(),
  sheet: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => [
    typeof initial === "function" ? (initial as () => unknown)() : initial,
    vi.fn(),
  ],
  useRef: (current: unknown) => ({ current }),
  useCallback: (fn: unknown) => {
    h.callbacks.push(fn);
    return fn;
  },
  useEffect: (effect: () => undefined | (() => void), deps: unknown[]) =>
    h.effects.push({ effect, deps }),
}));
vi.mock("zustand/react/shallow", () => ({ useShallow: (s: unknown) => s }));
vi.mock("@/stores/useMapStore", () => ({
  default: (s: (state: typeof h.store) => unknown) => s(h.store),
  placeKey: () => "id",
}));
vi.mock("@/i18n/client", () => ({
  useAppTranslation: () => ({
    t: (key: string) => key,
    i18n: {
      get language() {
        return h.language;
      },
    },
  }),
}));
vi.mock("@/lib/api/placeSearch", () => ({
  getPlaceDetails: h.details,
  getPlaceAutocomplete: vi.fn(),
  reverseGeocode: vi.fn(),
}));
vi.mock("@/hook/usePlacePredictions", () => ({
  default: () => ({
    suggestions: [],
    loading: false,
    sessionToken: "session",
    resetSession: vi.fn(),
  }),
}));
vi.mock("@/hook/useIsDesktop", () => ({ default: () => true }));
vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));
vi.mock("react-map-gl/maplibre", () => ({
  default: () => null,
  NavigationControl: () => null,
}));
vi.mock("../Route/RouteSessionPill", () => ({ default: () => null }));
vi.mock("../shared/NowPin", () => ({ default: () => null }));
vi.mock("../Wrapper/A11yFacilitiesWrapper", () => ({ default: () => null }));
vi.mock("../Wrapper/MapWrapper", () => ({ default: () => null }));
vi.mock("../Wrapper/RoutePreviewHydrator", () => ({ default: () => null }));
vi.mock("../Wrapper/RouteWrapper", () => ({ default: () => null }));
vi.mock("../NavigationController", () => ({ default: () => null }));
vi.mock("../shared/SearchPin", () => ({ default: () => null }));
vi.mock("../Wrapper/AIResultWrapper", () => ({ default: () => null }));
vi.mock("../Wrapper/HazardWrapper", () => ({ default: () => null }));
vi.mock("../Wrapper/LiveBusWrapper", () => ({ default: () => null }));
vi.mock("../Wrapper/MapControlsWrapper", () => ({ default: () => null }));
vi.mock("../Wrapper/ParkingWrapper", () => ({ default: () => null }));
vi.mock("../Wrapper/SosTrackerWrapper", () => ({ default: () => null }));
vi.mock("../Wrapper/TransitWrapper", () => ({ default: () => null }));

import ClientMap from "../ClientMap";
import PlaceInput from "../shared/PlaceInput";

const item = {
  id: "osm:node:123",
  source: "osm",
  location: null,
} as AutocompleteItem;
const place = {
  id: item.id,
  name: "Canonical",
  location: { coordinates: [121, 25] },
  nearbyFacilities: {
    toilets: [
      {
        id: "facility-id",
        name: "中文",
        displayName: "English facility",
        displayAddress: "English address",
      },
    ],
    metro: [],
  },
} as unknown as PlaceResult;
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.clearAllMocks();
  h.language = "zh-TW";
  h.callbacks = [];
  h.effects = [];
  h.store = {
    searchHistory: [],
    addSearchHistory: h.history,
    setInfoShow: h.info,
    setSearchPlace: h.search,
    setSheetMode: h.sheet,
    userLocation: null,
    map: null,
  };
  vi.stubGlobal("window", { location: { search: "?place=osm:node:123" } });
  vi.stubGlobal("localStorage", { getItem: () => null });
});
afterEach(() => vi.unstubAllGlobals());
function inputDetails() {
  PlaceInput({ onPlaceSelect: h.select });
  return h.callbacks[0] as (item: AutocompleteItem) => Promise<void>;
}
function linkDetails() {
  ClientMap();
  const effect = h.effects.find(
    (entry) =>
      entry.deps?.length === 6 &&
      entry.deps.includes(h.info) &&
      entry.deps.includes(h.language),
  );
  if (!effect) throw new Error("Shared-link details effect not found");
  return effect;
}
describe("Places details locale ownership and field preservation", () => {
  it("input ignores late previous-locale details", async () => {
    const request = deferred();
    h.details.mockReturnValueOnce(request.promise);
    const pending = inputDetails()(item);
    h.language = "en";
    request.resolve({ ok: true, data: place });
    await pending;
    expect(h.history).not.toHaveBeenCalled();
    expect(h.select).not.toHaveBeenCalled();
  });
  it("input preserves nearby display fields and canonical IDs", async () => {
    h.language = "en";
    h.details.mockResolvedValue({ ok: true, data: place });
    await inputDetails()(item);
    expect(h.details).toHaveBeenCalledWith(
      item.id,
      expect.objectContaining({ lang: "en" }),
    );
    expect(h.select.mock.calls[0][0].place).toEqual(place);
    expect(
      h.history.mock.calls[0][0].place.nearbyFacilities.toilets[0].id,
    ).toBe("facility-id");
  });
  it("shared link ignores previous locale even before cleanup", async () => {
    const request = deferred();
    h.details.mockReturnValueOnce(request.promise);
    linkDetails().effect();
    h.language = "en";
    request.resolve({ ok: true, data: place });
    await new Promise((resolve) => setImmediate(resolve));
    expect(h.info).not.toHaveBeenCalled();
    expect(h.search).not.toHaveBeenCalled();
  });
  it("shared link checks abort even if the transport resolves successfully", async () => {
    const request = deferred();
    h.details.mockReturnValueOnce(request.promise);
    const cleanup = linkDetails().effect();
    cleanup?.();
    request.resolve({ ok: true, data: place });
    await new Promise((resolve) => setImmediate(resolve));
    expect(h.info).not.toHaveBeenCalled();
  });
  it("shared link retains display fields for the current locale", async () => {
    h.language = "en";
    h.details.mockResolvedValue({ ok: true, data: place });
    linkDetails().effect();
    await new Promise((resolve) => setImmediate(resolve));
    expect(h.info).toHaveBeenCalledWith({ isOpen: true, kind: "place", place });
    expect(h.search.mock.calls[0][0].place.nearbyFacilities).toEqual(
      place.nearbyFacilities,
    );
  });
});
