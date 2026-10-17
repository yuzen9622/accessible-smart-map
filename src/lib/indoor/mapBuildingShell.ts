import {
  addProtocol,
  type Map as MapLibreMap,
  type VectorTileSource,
} from "maplibre-gl";
import { localToLngLat } from "./coordinates";
import { transformIndoorBuildingTile } from "./mapBuildingTile";
import { registerIndoorTileRequest } from "./mapRequests";
import type { LocalIndoorModel } from "./types";

const PROTOCOL = "local-indoor-shell";
const models = new Map<string, LocalIndoorModel>();
let registered = false;
type TileTemplate = {
  pattern: RegExp;
  positions: { z: number; x: number; y: number };
  scheme: "xyz" | "tms";
};
type SourceState = {
  source: VectorTileSource;
  signature: string;
  templates: TileTemplate[];
};

function registerProtocol() {
  if (registered) return;
  registered = true;
  // Keep this small loader registered after closing. A worker can still send a
  // queued request for the old URL; without its private model it safely returns
  // the original tile. No private geometry is sent to the tile provider.
  addProtocol(PROTOCOL, async (request, abortController) => {
    const match = request.url.match(
      /^local-indoor-shell:\/\/([^/]+)\/(xyz|tms)\/(\d+)\/(\d+)\/(\d+)\/(.+)$/,
    );
    if (!match) throw new Error("Invalid indoor tile URL");
    const [, key, scheme, zoom, column, row, encoded] = match;
    const url = decodeURIComponent(encoded);
    if (!/^https?:\/\//.test(url))
      throw new Error("Unsupported indoor tile origin");
    const response = await fetch(url, {
      signal: abortController.signal,
      headers: request.headers,
      credentials: request.credentials,
      cache: request.cache,
      referrerPolicy: request.referrerPolicy,
    });
    if (!response.ok)
      throw new Error(
        `Indoor basemap tile request failed (${response.status})`,
      );
    const original = await response.arrayBuffer();
    abortController.signal.throwIfAborted();
    const z = Number(zoom),
      x = Number(column),
      y = scheme === "tms" ? 2 ** z - 1 - Number(row) : Number(row);
    const model = models.get(key);
    const data = model
      ? transformIndoorBuildingTile(original, { z, x, y }, model).data
      : original;
    // Do not forward the server's ETag: MapLibre would treat different bytes
    // with that same ETag as unchanged and retain the old exterior roof.
    return {
      data,
      cacheControl: response.headers.get("cache-control"),
      expires: response.headers.get("expires"),
    };
  });
}

function tileTemplate(url: string, scheme: "xyz" | "tms"): TileTemplate | null {
  if (!/^https?:\/\//.test(url)) return null;
  const positions = { z: 0, x: 0, y: 0 };
  let group = 0;
  const pattern = url
    .split(/(\{[^}]+\})/)
    .map((part) => {
      if (part.startsWith("{")) {
        group++;
        const name = part.slice(1, -1);
        if (name === "x" || name === "y" || name === "z") {
          positions[name] ||= group;
          return "(\\d+)";
        }
        return "([^/?]*)";
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
  if (!positions.x || !positions.y || !positions.z) return null;
  return { pattern: new RegExp(`^${pattern}$`), positions, scheme };
}

/**
 * Open only the matched polygon component in the existing vector tiles. A
 * provider can aggregate many buildings into one feature ID, so hiding an ID
 * would incorrectly remove unrelated buildings. Source definitions and layer
 * filters stay untouched; mode changes invalidate both visible and cached tiles.
 */
export function mountIndoorBuildingMask(
  map: MapLibreMap,
  model: LocalIndoorModel,
): () => void {
  registerProtocol();
  const key = crypto.randomUUID();
  models.set(key, model);
  let states = new Map<string, SourceState>();
  let disposed = false;
  let scheduled = false;
  const worldPoints = model.building.footprint.flat().map((point) => {
    const [lng, lat] = localToLngLat(point, model.origin);
    const latitude = Math.max(-85.051129, Math.min(85.051129, lat));
    const sine = Math.sin((latitude * Math.PI) / 180);
    return [
      (lng + 180) / 360,
      0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI),
    ];
  });
  const minX = Math.min(...worldPoints.map((p) => p[0]));
  const maxX = Math.max(...worldPoints.map((p) => p[0]));
  const minY = Math.min(...worldPoints.map((p) => p[1]));
  const maxY = Math.max(...worldPoints.map((p) => p[1]));
  const unregisterRequest = registerIndoorTileRequest(
    map,
    (url, resourceType) => {
      if (resourceType !== "Tile") return { url };
      for (const state of states.values()) {
        for (const template of state.templates) {
          const match = url.match(template.pattern);
          if (!match) continue;
          const z = Number(match[template.positions.z]);
          const x = Number(match[template.positions.x]);
          const row = Number(match[template.positions.y]);
          const scale = 2 ** z;
          const y = template.scheme === "tms" ? scale - 1 - row : row;
          // Include the standard vector-tile buffer at a tile boundary. The
          // geometry matcher still requires an unambiguous complete component.
          const buffer = 0.125;
          if (
            z > 24 ||
            x + 1 + buffer < minX * scale ||
            x - buffer > maxX * scale ||
            y + 1 + buffer < minY * scale ||
            y - buffer > maxY * scale
          )
            return { url };
          return {
            url: `${PROTOCOL}://${key}/xyz/${z}/${x}/${y}/${encodeURIComponent(url)}`,
          };
        }
      }
      return { url };
    },
  );

  const apply = () => {
    scheduled = false;
    if (disposed) return;
    const style = map.getStyle();
    if (!style) return;
    const sourceIds = new Set(
      style.layers.flatMap((layer) =>
        (layer.type === "fill" || layer.type === "fill-extrusion") &&
        layer["source-layer"] === "building" &&
        style.sources[layer.source]?.type === "vector"
          ? [layer.source]
          : [],
      ),
    );
    const next = new Map<string, SourceState>();
    const refresh: string[] = [];
    for (const id of sourceIds) {
      const source = map.getSource<VectorTileSource>(id);
      if (source?.type !== "vector" || !source.tiles?.length) continue;
      const signature = JSON.stringify([source.tiles, source.scheme]);
      const previous = states.get(id);
      if (previous?.source === source && previous.signature === signature) {
        next.set(id, previous);
        continue;
      }
      const templates = source.tiles
        .map((url) =>
          tileTemplate(url, source.scheme === "tms" ? "tms" : "xyz"),
        )
        .filter((template): template is TileTemplate => template !== null);
      if (templates.length) {
        next.set(id, { source, signature, templates });
        refresh.push(id);
      }
    }
    states = next;
    // No tile IDs: also clear offscreen cached tiles so later panning cannot
    // resurrect the roof. Each new source/template is refreshed just once.
    for (const id of refresh) map.refreshTiles(id);
  };
  const schedule = () => {
    if (disposed || scheduled) return;
    scheduled = true;
    queueMicrotask(apply);
  };
  map.on("style.load", schedule);
  map.on("styledata", schedule);
  map.on("sourcedata", schedule);
  schedule();

  return () => {
    disposed = true;
    map.off("style.load", schedule);
    map.off("styledata", schedule);
    map.off("sourcedata", schedule);
    unregisterRequest();
    models.delete(key);
    for (const [id, state] of states) {
      try {
        if (map.getStyle() && map.getSource(id) === state.source)
          map.refreshTiles(id);
      } catch {
        // Context loss or map teardown can remove the style before React cleanup.
      }
    }
    states.clear();
  };
}
