import type {
  AddProtocolAction,
  Map as MapLibreMap,
  RequestParameters,
  ResourceType,
  StyleSpecification,
} from "maplibre-gl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalIndoorModel, XY } from "../types";

const mocks = vi.hoisted(() => ({
  protocols: new Map<string, AddProtocolAction>(),
  addProtocol: vi.fn(),
  transform: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("maplibre-gl", () => ({
  addProtocol: (name: string, handler: AddProtocolAction) => {
    mocks.addProtocol(name, handler);
    mocks.protocols.set(name, handler);
  },
}));
vi.mock("../mapBuildingTile", () => ({
  transformIndoorBuildingTile: mocks.transform,
}));

import { mountIndoorBuildingMask } from "../mapBuildingShell";
import { indoorBasemapRequest } from "../mapRequests";

const template = "https://tiles.example.test/buildings/{z}/{x}/{y}.pbf";
const rectangle = (x: number, y: number, w: number, h: number): XY[] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
  [x, y],
];
const model = {
  origin: [12, 35],
  building: { footprint: [rectangle(0, 0, 20, 10)] },
} as LocalIndoorModel;
const original = new Uint8Array([11, 22, 33]).buffer;
const transformed = new Uint8Array([44, 55]).buffer;
const cleanups = new Set<() => void>();

function tileAt([lng, lat]: XY, z = 14) {
  const size = 2 ** z;
  const radians = (lat * Math.PI) / 180;
  return {
    z,
    x: Math.floor(((lng + 180) / 360) * size),
    y: Math.floor(((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * size),
  };
}
function tileUrl(
  tile = tileAt(model.origin),
  pattern = template,
  scheme: "xyz" | "tms" = "xyz",
) {
  return pattern
    .replace("{z}", String(tile.z))
    .replace("{x}", String(tile.x))
    .replace(
      "{y}",
      String(scheme === "tms" ? 2 ** tile.z - 1 - tile.y : tile.y),
    );
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function fixture(options: { tiles?: string[]; scheme?: "xyz" | "tms" } = {}) {
  const makeSource = () => ({
    type: "vector" as const,
    tiles: options.tiles?.slice() ?? [template],
    scheme: options.scheme ?? "xyz",
    setTiles: vi.fn(),
  });
  let source = makeSource();
  const roadSource = {
    type: "vector",
    tiles: ["https://tiles.example.test/roads/{z}/{x}/{y}.pbf"],
    scheme: "xyz",
  };
  let style = freezeDeep<StyleSpecification>({
    version: 8,
    sources: {
      buildings: {
        type: "vector",
        url: "https://tiles.example.test/source.json",
      },
      roads: {
        type: "vector",
        tiles: ["https://tiles.example.test/roads/{z}/{x}/{y}.pbf"],
      },
    },
    layers: [
      {
        id: "building-flat",
        type: "fill",
        source: "buildings",
        "source-layer": "building",
        filter: ["!=", "class", "hidden"],
      },
      {
        id: "building-3d",
        type: "fill-extrusion",
        source: "buildings",
        "source-layer": "building",
        filter: false,
      },
      { id: "road", type: "line", source: "roads", "source-layer": "road" },
    ],
  });
  const handlers = new Map<string, Set<() => void>>();
  const emit = (event: string) => {
    for (const handler of handlers.get(event) ?? []) handler();
  };
  const refreshTiles = vi.fn((_sourceId: string) => emit("sourcedata"));
  const setFilter = vi.fn();
  const map = {
    getStyle: () => style,
    getSource: (id: string) =>
      id === "buildings" ? source : id === "roads" ? roadSource : undefined,
    refreshTiles,
    setFilter,
    on: (event: string, listener: () => void) => {
      const group = handlers.get(event) ?? new Set();
      group.add(listener);
      handlers.set(event, group);
    },
    off: (event: string, listener: () => void) => {
      handlers.get(event)?.delete(listener);
    },
  };
  return {
    map: map as unknown as MapLibreMap,
    refreshTiles,
    setFilter,
    emit,
    source: () => source,
    style: () => style,
    listenerCount: () =>
      [...handlers.values()].reduce((sum, group) => sum + group.size, 0),
    replaceStyle: () => {
      style = freezeDeep(structuredClone(style));
      source = makeSource();
      emit("style.load");
    },
  };
}

const flush = async () => {
  // refreshTiles synchronously emits sourcedata in this fake; its queued pass
  // must settle without scheduling another refresh of the same source.
  for (let i = 0; i < 4; i++) await Promise.resolve();
};
function mount(map: MapLibreMap, data = model) {
  const close = mountIndoorBuildingMask(map, data);
  cleanups.add(close);
  return () => {
    cleanups.delete(close);
    close();
  };
}
function request(map: MapLibreMap | null, url: string, type = "Tile") {
  return indoorBasemapRequest(map, url, type as ResourceType);
}
function wrapped(map: MapLibreMap, url = tileUrl()) {
  const result = request(map, url);
  if (!result || !("url" in result))
    throw new Error("Expected a synchronous indoor request transformation");
  expect(result.url).toMatch(/^local-indoor-shell:\/\//);
  return result;
}
function load(request: RequestParameters, controller = new AbortController()) {
  const handler = mocks.protocols.get("local-indoor-shell");
  if (!handler) throw new Error("Expected registered public protocol handler");
  return handler(request, controller);
}
function response(data: ArrayBuffer | Promise<ArrayBuffer> = original) {
  return {
    ok: true,
    status: 200,
    arrayBuffer: vi.fn(async () => data),
    headers: new Headers({
      "cache-control": "max-age=120",
      expires: "Wed, 01 Jan 2031 00:00:00 GMT",
      etag: '"provider-original"',
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.fetch.mockResolvedValue(response());
  mocks.transform.mockReturnValue({ data: transformed });
});
afterEach(async () => {
  for (const close of cleanups) close();
  cleanups.clear();
  await flush();
  vi.unstubAllGlobals();
});

describe("public indoor building tile request bridge", () => {
  it("wraps only known nearby building tiles and preserves other resource requests", async () => {
    const f = fixture();
    const near = tileUrl();
    expect(request(null, near)).toEqual({ url: near });
    expect(request(f.map, near)).toEqual({ url: near });
    const close = mount(f.map);
    await flush();
    const result = wrapped(f.map, near);
    expect(
      decodeURIComponent(result.url.slice(result.url.lastIndexOf("/") + 1)),
    ).toBe(near);
    for (const type of ["Source", "Glyphs", "Style", "Image"]) {
      expect(request(f.map, near, type)).toEqual({ url: near });
    }
    const tile = tileAt(model.origin);
    for (const url of [
      tileUrl({ ...tile, x: tile.x + 40 }),
      tileUrl({ ...tile, y: tile.y - 40 }),
      tileUrl(tileAt(model.origin, 25)),
      near.replace("/buildings/", "/roads/"),
      near.replace("tiles.example.test", "unrelated.example.test"),
    ]) {
      expect(request(f.map, url)).toEqual({ url });
    }
    close();
    expect(request(f.map, near)).toEqual({ url: near });
  });

  it("preserves source definitions, tile templates and all original layer filters", async () => {
    const f = fixture();
    const styleBefore = structuredClone(f.style());
    const tilesBefore = f.source().tiles.slice();
    const close = mount(f.map);
    await flush();
    await load(wrapped(f.map));
    close();
    expect(f.style()).toEqual(styleBefore);
    expect(f.source().tiles).toEqual(tilesBefore);
    expect(f.source().setTiles).not.toHaveBeenCalled();
    expect(f.setFilter).not.toHaveBeenCalled();
  });

  it("refreshes the whole source cache on mount, style recreation and exit without a source event loop", async () => {
    const f = fixture();
    const close = mount(f.map);
    await flush();
    expect(f.refreshTiles.mock.calls).toEqual([["buildings"]]);
    for (let i = 0; i < 5; i++) {
      f.emit("styledata");
      f.emit("sourcedata");
    }
    await flush();
    expect(f.refreshTiles).toHaveBeenCalledTimes(1);
    f.replaceStyle();
    await flush();
    expect(f.refreshTiles.mock.calls).toEqual([["buildings"], ["buildings"]]);
    expect(wrapped(f.map).url).toContain("local-indoor-shell://");
    close();
    await flush();
    // No tile-ID argument: offscreen cached tiles must also be invalidated.
    expect(f.refreshTiles.mock.calls).toEqual([
      ["buildings"],
      ["buildings"],
      ["buildings"],
    ]);
    expect(f.listenerCount()).toBe(0);
  });

  it("waits for public vector source templates, then refreshes once for each actual template change", async () => {
    const f = fixture({ tiles: [] });
    mount(f.map);
    await flush();
    expect(request(f.map, tileUrl())).toEqual({ url: tileUrl() });
    expect(f.refreshTiles).not.toHaveBeenCalled();
    f.source().tiles = [template];
    f.emit("sourcedata");
    await flush();
    expect(f.refreshTiles).toHaveBeenCalledTimes(1);
    const previousUrl = tileUrl();
    const changed = template.replace("/buildings/", "/revision-2/");
    f.source().tiles = [changed];
    f.emit("sourcedata");
    await flush();
    expect(f.refreshTiles).toHaveBeenCalledTimes(2);
    expect(request(f.map, previousUrl)).toEqual({ url: previousUrl });
    wrapped(f.map, tileUrl(undefined, changed));
  });

  it("cancels queued discovery on immediate cleanup and never refreshes a disposed source later", async () => {
    const f = fixture();
    mount(f.map)();
    await flush();
    f.emit("styledata");
    f.emit("sourcedata");
    await flush();
    expect(f.refreshTiles).not.toHaveBeenCalled();
    expect(f.listenerCount()).toBe(0);
    expect(request(f.map, tileUrl())).toEqual({ url: tileUrl() });
  });

  it("decodes TMS and template query placeholders without changing the provider URL", async () => {
    const pattern = `${template}?key=a.b%2Fc&ratio={ratio}`;
    const f = fixture({ scheme: "tms", tiles: [pattern] });
    mount(f.map);
    await flush();
    const tile = tileAt(model.origin);
    const url = tileUrl(tile, pattern, "tms").replace("{ratio}", "2");
    const result = await load(wrapped(f.map, url));
    expect(result.data).toBe(transformed);
    expect(mocks.fetch).toHaveBeenCalledWith(url, expect.any(Object));
    expect(mocks.transform).toHaveBeenCalledWith(original, tile, model);
  });

  it("forwards cancellation and request options, while omitting the provider ETag for changed bytes", async () => {
    const f = fixture();
    mount(f.map);
    await flush();
    const controller = new AbortController();
    const headers = { Authorization: "synthetic-token", "X-Test": "indoor" };
    const result = await load(
      {
        ...wrapped(f.map),
        headers,
        credentials: "include",
        cache: "no-cache",
        referrerPolicy: "no-referrer",
      },
      controller,
    );
    expect(mocks.fetch).toHaveBeenCalledWith(tileUrl(), {
      signal: controller.signal,
      headers,
      credentials: "include",
      cache: "no-cache",
      referrerPolicy: "no-referrer",
    });
    expect(result).toEqual({
      data: transformed,
      cacheControl: "max-age=120",
      expires: "Wed, 01 Jan 2031 00:00:00 GMT",
    });
    expect(result).not.toHaveProperty("etag");
  });

  it("does not transform bytes when cancellation arrives while the response body is pending", async () => {
    const f = fixture();
    mount(f.map);
    await flush();
    let resolveBody: (value: ArrayBuffer) => void = () => {};
    const body = new Promise<ArrayBuffer>((resolve) => {
      resolveBody = resolve;
    });
    mocks.fetch.mockResolvedValue(response(body));
    const controller = new AbortController();
    const pending = load(wrapped(f.map), controller);
    controller.abort();
    resolveBody(original);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.transform).not.toHaveBeenCalled();
  });

  it("keeps the protocol available for queued URLs but returns original bytes after closing", async () => {
    const f = fixture();
    const close = mount(f.map);
    await flush();
    const queuedRequest = wrapped(f.map);
    close();
    const result = await load(queuedRequest);
    expect(result.data).toBe(original);
    expect(mocks.transform).not.toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledWith(tileUrl(), expect.any(Object));
  });

  it("does not retain a model in a request already fetching when the map exits indoor mode", async () => {
    const f = fixture();
    const close = mount(f.map);
    await flush();
    let resolveBody: (value: ArrayBuffer) => void = () => {};
    const body = new Promise<ArrayBuffer>((resolve) => {
      resolveBody = resolve;
    });
    mocks.fetch.mockResolvedValue(response(body));
    const pending = load(wrapped(f.map));
    close();
    resolveBody(original);
    const result = await pending;
    expect(result.data).toBe(original);
    expect(mocks.transform).not.toHaveBeenCalled();
  });

  it("isolates two maps and models, including a queued request from the map that closed", async () => {
    const second = {
      ...model,
      origin: [-38, -20] as XY,
    } as LocalIndoorModel;
    const a = fixture();
    const b = fixture();
    const closeA = mount(a.map);
    mount(b.map, second);
    await flush();
    const urlA = tileUrl();
    const urlB = tileUrl(tileAt(second.origin));
    const requestA = wrapped(a.map, urlA);
    const requestB = wrapped(b.map, urlB);
    expect(requestA.url).not.toBe(requestB.url);
    expect(request(a.map, urlB)).toEqual({ url: urlB });
    expect(request(b.map, urlA)).toEqual({ url: urlA });
    await load(requestA);
    await load(requestB);
    expect(mocks.transform.mock.calls.map((call) => call[2])).toEqual([
      model,
      second,
    ]);
    closeA();
    mocks.transform.mockClear();
    expect((await load(requestA)).data).toBe(original);
    expect(mocks.transform).not.toHaveBeenCalled();
    expect((await load(wrapped(b.map, urlB))).data).toBe(transformed);
    expect(mocks.transform).toHaveBeenCalledWith(
      original,
      tileAt(second.origin),
      second,
    );
  });

  it("rejects malformed, non-HTTP and failed provider requests without decoding", async () => {
    const f = fixture();
    mount(f.map);
    await flush();
    await expect(load({ url: "local-indoor-shell://invalid" })).rejects.toThrow(
      "Invalid indoor tile URL",
    );
    const invalidOrigin = {
      url: wrapped(f.map).url.replace(
        /[^/]+$/,
        encodeURIComponent("file:///tile"),
      ),
    };
    await expect(load(invalidOrigin)).rejects.toThrow(
      "Unsupported indoor tile origin",
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
    mocks.fetch.mockResolvedValue({ ok: false, status: 503 });
    await expect(load(wrapped(f.map))).rejects.toThrow("503");
    expect(mocks.transform).not.toHaveBeenCalled();
  });
});
