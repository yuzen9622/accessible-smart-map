import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  language: "zh-TW",
  effects: [] as { effect: () => undefined | (() => void); deps?: unknown[] }[],
  writes: [] as { index: number; value: unknown }[],
  stateIndex: 0,
  stateValues: null as unknown[] | null,
  store: {} as Record<string, unknown> & {
    setA11yPlaces: ReturnType<typeof vi.fn>;
    setNearbyParking: ReturnType<typeof vi.fn>;
  },
  all: vi.fn(),
  nearby: vi.fn(),
  osm: vi.fn(),
  parking: vi.fn(),
  welfare: vi.fn(),
  hazards: vi.fn(),
  points: [] as unknown[],
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: (effect: () => undefined | (() => void), deps?: unknown[]) =>
    h.effects.push({ effect, deps }),
  useState: (initial: unknown) => {
    const index = h.stateIndex++;
    return [
      h.stateValues && index < h.stateValues.length
        ? h.stateValues[index]
        : typeof initial === "function"
          ? (initial as () => unknown)()
          : initial,
      (value: unknown) => h.writes.push({ index, value }),
    ];
  },
  useMemo: (fn: () => unknown) => fn(),
  useCallback: (fn: unknown) => fn,
  useRef: (current: unknown) => ({ current }),
}));
vi.mock("zustand/react/shallow", () => ({ useShallow: (s: unknown) => s }));
vi.mock("@/stores/useMapStore", () => ({
  default: Object.assign(
    (s: (store: typeof h.store) => unknown) => s(h.store),
    { getState: () => h.store },
  ),
}));
vi.mock("@/stores/useOnboardingStore", () => ({
  default: (s: (store: unknown) => unknown) =>
    s({ profile: { situations: [] } }),
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
vi.mock("@/lib/api/a11y", () => ({
  getAllA11yFacilities: h.all,
  getNearbyRouteA11yPlaces: h.nearby,
  getOsmPlaceDetail: h.osm,
  getNearbyParking: h.parking,
  getNearbyWelfare: h.welfare,
  getNearbyHazardReports: h.hazards,
}));
vi.mock("react-map-gl/maplibre", () => ({
  useMap: () => ({}),
  Marker: () => null,
}));
vi.mock("use-supercluster", () => ({
  default: ({ points }: { points: unknown[] }) => {
    h.points = points;
    return { clusters: [] };
  },
}));
vi.mock("@/hook/useMapBoundsAndZoom", () => ({
  useMapBoundsAndZoom: () => ({ zoom: 10 }),
}));
vi.mock("@/hook/useFetchLocation", () => ({
  useFetchLocation: (position: unknown) => position,
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}));

vi.mock("@/stores/useContentSafetyStore", () => ({
  default: (s: (store: unknown) => unknown) =>
    s({ accountEpoch: 0, revision: 0 }),
}));

import A11yPanel from "../BottomSheet/A11yPanel";
import ParkingPanel from "../BottomSheet/ParkingPanel";
import PlaceContent from "../BottomSheet/PlaceContent";
import StationDetailContent from "../BottomSheet/StationDetailContent";
import WelfarePanel from "../BottomSheet/WelfarePanel";
import Wrapper from "../Wrapper/A11yFacilitiesWrapper";
import ParkingWrapper from "../Wrapper/ParkingWrapper";

function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}
function render(component: () => unknown) {
  h.effects = [];
  h.stateIndex = 0;
  component();
  return h.effects;
}
async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}
beforeEach(() => {
  vi.clearAllMocks();
  h.writes = [];
  h.stateValues = null;
  h.language = "zh-TW";
  h.store = {
    infoShow: {
      kind: "place",
      place: {
        id: "osm:node:123",
        location: { coordinates: [121, 25] },
        accessibility: { wheelchair: null },
        externalLinks: {},
      },
    },
    userLocation: { lat: 25, lng: 121 },
    selectA11yPlace: { position: { lat: 25, lng: 121 } },
    a11yPlaces: [],
    routeA11y: [],
    selectedA11yTypes: new Set(),
    setA11yPlaces: vi.fn(),
    setNearbyParking: vi.fn(),
    setSelectedParking: vi.fn(),
    isSavedPlace: () => false,
  };
  h.osm.mockResolvedValue({ ok: true, data: null });
});

describe("facility effects use locale ownership", () => {
  it.each([
    {
      name: "place nearby",
      component: () => PlaceContent(),
      api: h.nearby,
      langIndex: 2,
    },
    {
      name: "station nearby",
      component: () => StationDetailContent(),
      api: h.nearby,
      langIndex: 2,
    },
    {
      name: "parking",
      component: () => ParkingPanel({ onClose: vi.fn() }),
      api: h.parking,
      langIndex: 2,
    },
    {
      name: "welfare",
      component: () => WelfarePanel({ onClose: vi.fn() }),
      api: h.welfare,
      langIndex: 3,
    },
  ])(
    "$name rejects the previous language response even when the transport ignores abort",
    async ({ component, api, langIndex }) => {
      const old = deferred();
      const fresh = deferred();
      api.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
      const initial = render(component)[0];
      expect(initial.deps).toContain("zh-TW");
      const cleanup = initial.effect();
      expect(api.mock.calls[0][langIndex]).toBe("zh-TW");
      cleanup?.();
      h.language = "en-US";
      const next = render(component)[0];
      expect(next.deps).toContain("en");
      next.effect();
      expect(api.mock.calls[1][langIndex]).toBe("en");
      const rows = [{ _id: "same-id", displayName: "English" }];
      const payload = {
        ok: true,
        data:
          api === h.nearby
            ? { nearbyBathroom: rows, nearbyMetroA11y: [] }
            : rows,
      };
      fresh.resolve(payload);
      await flush();
      expect(h.writes).toContainEqual({ index: 0, value: rows });
      const settled = [...h.writes];
      old.resolve({
        ok: true,
        data: [{ _id: "same-id", displayName: "舊中文" }],
      });
      await flush();
      expect(h.writes).toEqual(settled);
      expect(
        h.writes.some(
          (write) => Array.isArray(write.value) && write.value.length === 0,
        ),
      ).toBe(true);
    },
  );

  it("place OSM details clears on language change and ignores late previous details", async () => {
    const old = deferred();
    const fresh = deferred();
    h.nearby.mockResolvedValue({ ok: true, data: {} });
    h.osm
      .mockReset()
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(fresh.promise);
    const effect = render(() => PlaceContent())[1];
    const cleanup = effect.effect();
    cleanup?.();
    h.language = "en";
    render(() => PlaceContent())[1].effect();
    expect(h.osm.mock.calls.map((args) => args[2])).toEqual(["zh-TW", "en"]);
    fresh.resolve({ ok: true, data: { osmId: "123", displayName: "English" } });
    await flush();
    const settled = [...h.writes];
    old.resolve({ ok: true, data: { osmId: "123", displayName: "中文" } });
    await flush();
    expect(h.writes).toEqual(settled);
    expect(
      h.writes.filter((write) => write.index === 3 && write.value === null),
    ).toHaveLength(2);
  });

  it("all facilities caches by locale, clears old pins, keeps IDs and discards late data", async () => {
    const old = deferred();
    const fresh = deferred();
    h.all.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const cleanup = render(() => Wrapper())[0].effect();
    cleanup?.();
    h.language = "en";
    render(() => Wrapper())[0].effect();
    expect(h.all.mock.calls.map((args) => args[0])).toEqual(["zh-TW", "en"]);
    fresh.resolve({
      ok: true,
      data: [
        {
          _id: "stable-id",
          name: "中文",
          displayName: "English",
          category: "elevator",
          source: "metro",
          exitName: "1",
          location: { coordinates: [121, 25] },
        },
      ],
    });
    await flush();
    const writes = h.store.setA11yPlaces.mock.calls;
    expect(writes[0][0]).toEqual([]);
    expect(writes.at(-1)?.[0][0]).toMatchObject({
      id: "stable-id",
      content: { title: "English" },
    });
    const count = writes.length;
    old.resolve({ ok: true, data: [] });
    await flush();
    expect(h.store.setA11yPlaces).toHaveBeenCalledTimes(count);
    render(() => Wrapper())[0].effect();
    expect(h.all).toHaveBeenCalledTimes(2);
  });
});

describe("facility card display fallbacks", () => {
  it("parking displays nonempty display text and falls back without changing selected ID", () => {
    const rows = [
      {
        type: "lot",
        _id: "lot-a",
        name: "Canonical A",
        displayName: "English lot",
        address: "中文地址",
        displayAddress: "English address",
      },
      { type: "lot", _id: "lot-b", name: "Canonical B", displayName: "  " },
      {
        type: "disabled",
        _id: "space",
        placeName: "Canonical space",
        displayName: "English-only space",
        district: "District",
      },
    ];
    const original = structuredClone(rows);
    h.stateValues = [rows, false, null];
    h.stateIndex = 0;
    const html = renderToStaticMarkup(<ParkingPanel onClose={vi.fn()} />);
    expect(html).toContain("English lot");
    expect(html).toContain("English address");
    expect(html).toContain("Canonical B");
    expect(html).toContain("English-only space");
    expect(html).not.toContain("Canonical A");
    expect(rows).toEqual(original);
  });
  it("welfare displays nonempty names/addresses with canonical fallback", () => {
    const rows = [
      {
        _id: "a",
        name: "Canonical A",
        displayName: "English welfare",
        address: "中文地址",
        displayAddress: "English address",
        actualServed: {},
        approvedCapacity: {},
      },
      {
        _id: "b",
        name: "Canonical B",
        displayName: " ",
        address: "Canonical address",
        displayAddress: " ",
        actualServed: {},
        approvedCapacity: {},
      },
    ];
    h.stateValues = [rows, false, null];
    h.stateIndex = 0;
    const html = renderToStaticMarkup(<WelfarePanel onClose={vi.fn()} />);
    expect(html).toContain("English welfare");
    expect(html).toContain("English address");
    expect(html).toContain("Canonical B");
    expect(html).toContain("Canonical address");
    expect(html).not.toContain("Canonical A");
  });
});

describe("shared parking locale cache", () => {
  it("wrapper ignores late locale writes and reuses same-language empty cache without refetch", async () => {
    h.store.activeRailPanel = "parking";
    h.store.nearbyParking = [];
    const old = deferred();
    const fresh = deferred();
    h.parking
      .mockReset()
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(fresh.promise);
    const cleanup = render(() => ParkingWrapper())[0].effect();
    expect(h.store.setSelectedParking).toHaveBeenCalledWith(null);
    // Even before effect cleanup, the live language has changed.
    h.language = "en";
    old.resolve({ ok: true, data: [{ _id: "old" }] });
    await flush();
    expect(h.store.setNearbyParking).not.toHaveBeenCalled();
    cleanup?.();
    render(() => ParkingWrapper())[0].effect();
    const rows = [{ _id: "new" }];
    fresh.resolve({ ok: true, data: rows });
    await flush();
    expect(h.store.setNearbyParking).toHaveBeenCalledWith(rows, "en");
    h.store.nearbyParkingLanguage = "en";
    h.store.nearbyParking = [];
    render(() => ParkingWrapper())[0].effect();
    expect(h.parking).toHaveBeenCalledTimes(2);
  });
  it("wrapper does not render old-locale pins", () => {
    h.store.activeRailPanel = "parking";
    h.store.nearbyParkingLanguage = "en";
    h.store.nearbyParking = [
      { _id: "old", location: { coordinates: [121, 25] } },
    ];
    render(() => ParkingWrapper());
    expect(h.points).toEqual([]);
    h.language = "en";
    render(() => ParkingWrapper());
    expect(h.points).toHaveLength(1);
  });
  it("A11yPanel language parking effect is separate from report safety and rejects old response", async () => {
    h.hazards.mockResolvedValue({ ok: true, data: { reports: [] } });
    const old = deferred();
    const fresh = deferred();
    h.parking
      .mockReset()
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(fresh.promise);
    const session = () => {
      const element = A11yPanel({});
      return (element.type as (props: unknown) => unknown)(element.props);
    };
    const initial = render(session);
    expect(initial[0].deps).not.toContain("zh-TW");
    expect(initial[1].deps).toContain("zh-TW");
    const cleanup = initial[1].effect();
    cleanup?.();
    h.language = "en";
    render(session)[1].effect();
    fresh.resolve({ ok: true, data: [{ _id: "new" }] });
    await flush();
    expect(h.store.setNearbyParking).toHaveBeenCalledWith(
      [{ _id: "new" }],
      "en",
    );
    const writes = [...h.writes];
    old.resolve({ ok: true, data: [{ _id: "old" }] });
    await flush();
    expect(h.writes).toEqual(writes);
    expect(h.store.setNearbyParking).toHaveBeenCalledTimes(1);
  });
});
