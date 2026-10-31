import { isValidElement } from "react";
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
vi.mock("@/i18n/client", async () => {
  const { default: zh } = await import("@/i18n/locale/zh-TW/translation.json");
  const { default: en } = await import("@/i18n/locale/en/translation.json");
  return {
    useAppTranslation: () => ({
      t: (key: string) => {
        const labels = h.language.toLowerCase().startsWith("en") ? en : zh;
        return key === "accessibleToilet"
          ? labels.accessibleToilet
          : key === "a11yFeatureRamp"
            ? labels.a11yFeatureRamp
            : key === "elevator"
              ? labels.elevator
              : key === "facility"
                ? labels.facility
                : key;
      },
      i18n: {
        get language() {
          return h.language;
        },
      },
    }),
  };
});
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
  // Follow a root wrapper into the selected content component, stopping at
  // its host element. This still exercises the real outdoor hooks after
  // PlaceContent delegates venue and outdoor details to separate children.
  let element = component();
  while (isValidElement(element) && typeof element.type === "function") {
    element = (element.type as (props: unknown) => unknown)(element.props);
  }
  return h.effects;
}
async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}
beforeEach(() => {
  // A failed case must not leave queued mockReturnValueOnce responses for
  // another consumer of the same nearby API (for example station details).
  vi.resetAllMocks();
  h.writes = [];
  h.stateValues = null;
  h.language = "zh-TW";
  h.store = {
    infoShow: {
      kind: "place",
      place: {
        id: "osm:node:123",
        location: { coordinates: [121, 25] },
        bounds: [120.9, 24.9, 121.1, 25.1],
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
  it("keeps the detail instance only while the selected place, extent, and language remain the same", () => {
    const key = () => {
      const element = PlaceContent();
      return isValidElement(element) ? element.key : null;
    };
    const info = h.store.infoShow as {
      place: {
        id: string;
        bounds: number[];
        location: { coordinates: number[] };
      };
    };
    const original = key();
    expect(original).not.toBeNull();
    info.place = { ...info.place, bounds: [...info.place.bounds] };
    expect(key()).toBe(original);
    info.place.id = "osm:node:456";
    expect(key()).not.toBe(original);
    info.place.id = "osm:node:123";
    info.place.bounds = [120.8, 24.8, 121.2, 25.2];
    expect(key()).not.toBe(original);
    info.place.bounds = [120.9, 24.9, 121.1, 25.1];
    info.place.location.coordinates = [121.01, 25];
    expect(key()).not.toBe(original);
    info.place.location.coordinates = [121, 25];
    h.language = "en";
    expect(key()).not.toBe(original);
  });

  it("shows campus facility categories from the backend rather than calling all facilities elevators", () => {
    const rows = [
      {
        _id: "t",
        source: "campus",
        facType: "accessible_toilet",
        facTypeLabel: "無障礙廁所",
        displayName: "資訊大樓廁所",
      },
      {
        _id: "p",
        source: "campus",
        facType: "outdoor_path",
        facTypeLabel: "室外通路",
        displayName: "資訊大樓坡道",
      },
      {
        _id: "r",
        source: "campus",
        facType: "ramp",
        facTypeLabel: "無障礙坡道",
        displayName: "行政大樓坡道",
      },
    ];
    h.stateValues = [[], rows, false, null, null];
    h.stateIndex = 0;
    const html = renderToStaticMarkup(<PlaceContent />);
    const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
    const row = (name: string) =>
      buttons.find((button) => button.includes(name)) ?? "";
    expect(row("資訊大樓廁所")).toMatch(
      /data-slot="badge"[^>]*>無障礙廁所<\/span>/,
    );
    expect(row("資訊大樓坡道")).toMatch(
      /data-slot="badge"[^>]*>室外通路<\/span>/,
    );
    expect(row("行政大樓坡道")).toMatch(/data-slot="badge"[^>]*>坡道<\/span>/);
    expect(row("資訊大樓廁所")).not.toMatch(
      /data-slot="badge"[^>]*>電梯<\/span>/,
    );
    expect(row("資訊大樓坡道")).not.toMatch(
      /data-slot="badge"[^>]*>電梯<\/span>/,
    );
  });

  it("uses the existing English facility label for an untranslated campus type without altering the facility name", () => {
    h.language = "en";
    h.stateValues = [
      [],
      [
        {
          _id: "p",
          source: "campus",
          facType: "outdoor_path",
          facTypeLabel: "室外通路",
          displayName: "校園坡道",
        },
        {
          _id: "u",
          source: "campus",
          facType: "unknown",
          facTypeLabel: "其他類型",
          displayName: "校園設備",
        },
      ],
      false,
      null,
      null,
    ];
    h.stateIndex = 0;
    const html = renderToStaticMarkup(<PlaceContent />);
    const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
    const row = buttons.find((button) => button.includes("校園坡道")) ?? "";
    expect(row).toContain("校園坡道");
    expect(row).toMatch(/data-slot="badge"[^>]*>Facility<\/span>/);
    expect(row).not.toContain("室外通路");
    const unknown = buttons.find((button) => button.includes("校園設備")) ?? "";
    expect(unknown).toContain("校園設備");
    expect(unknown).toMatch(/data-slot="badge"[^>]*>Facility<\/span>/);
    expect(unknown).not.toContain("其他類型");
  });

  it("does not request nearby facilities when the selected place has no bounds", () => {
    h.nearby.mockResolvedValue({ ok: true, data: {} });
    const info = h.store.infoShow as { place: { bounds?: unknown } };
    delete info.place.bounds;
    render(() => PlaceContent())[0].effect();
    expect(h.nearby).not.toHaveBeenCalled();
  });

  it("does not request nearby facilities when a station only has a position", () => {
    h.nearby.mockResolvedValue({ ok: true, data: {} });
    render(() => StationDetailContent())[0]?.effect();
    expect(h.nearby).not.toHaveBeenCalled();
  });

  it("does not infer elevator or ramp from a mixed facility list when the summary is absent", () => {
    h.stateValues = [
      [],
      [
        {
          _id: "t",
          source: "campus",
          facType: "accessible_toilet",
          facTypeLabel: "無障礙廁所",
          displayName: "校園廁所",
        },
      ],
      false,
      null,
      null,
    ];
    h.stateIndex = 0;
    const html = renderToStaticMarkup(<PlaceContent />);
    const items = html.match(/<li\b[^>]*>[\s\S]*?<\/li>/g) ?? [];
    expect(items.find((item) => item.includes("hasElevator"))).toContain(
      "a11yStatusUnknown",
    );
    expect(items.find((item) => item.includes("hasRamp"))).toContain(
      "a11yStatusUnknown",
    );
  });

  it("uses each category from the summary independently", () => {
    const summary = {
      elevator: { count: 0, nearestMeters: null },
      ramp: { count: 2, nearestMeters: 15 },
      toilet: { count: 3, nearestMeters: 12 },
    };
    h.stateValues = [[], [], false, null, summary];
    h.stateIndex = 0;
    const html = renderToStaticMarkup(<PlaceContent />);
    const items = html.match(/<li\b[^>]*>[\s\S]*?<\/li>/g) ?? [];
    expect(items.find((item) => item.includes("hasElevator"))).toContain(
      "a11yStatusUnknown",
    );
    expect(items.find((item) => item.includes("hasRamp"))).toContain(
      "a11yStatusYes",
    );
    expect(
      items.find((item) => item.includes("hasAccessibleToilet")),
    ).toContain("a11yStatusYes");
  });

  it("cancels the previous place and clears loading when the next place has no bounds", async () => {
    const old = deferred();
    h.nearby
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue({ ok: true, data: {} });
    const cleanup = render(() => PlaceContent())[0].effect();
    expect(h.nearby).toHaveBeenCalledTimes(1);
    const signal = h.nearby.mock.calls[0][1] as AbortSignal;
    cleanup?.();
    expect(signal.aborted).toBe(true);
    const info = h.store.infoShow as { place: { bounds?: unknown } };
    delete info.place.bounds;
    render(() => PlaceContent())[0].effect();
    expect(h.nearby).toHaveBeenCalledTimes(1);
    expect(h.writes).toContainEqual({ index: 2, value: false });
    const settled = [...h.writes];
    old.resolve({
      ok: true,
      data: { nearbyBathroom: [{ name: "舊地點" }], nearbyMetroA11y: [] },
    });
    await flush();
    expect(h.writes).toEqual(settled);
  });
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
