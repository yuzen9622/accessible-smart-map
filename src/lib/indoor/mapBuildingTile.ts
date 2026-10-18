import { classifyRings, VectorTile } from "@mapbox/vector-tile";
import { fromVectorTileJs } from "@maplibre/vt-pbf";
import Pbf from "pbf";
import polygonClipping, {
  type MultiPolygon,
  type Polygon,
} from "polygon-clipping";
import { localToLngLat } from "./coordinates";
import type { LocalIndoorModel } from "./types";

export interface IndoorTileCoordinate {
  z: number;
  x: number;
  y: number;
}

export interface IndoorBuildingTileResult {
  data: ArrayBuffer;
  removedComponents: number;
  featureIndex?: number;
  reason:
    | "removed"
    | "outside-footprint"
    | "no-match"
    | "ambiguous"
    | "invalid-tile";
}

/** Apply the same exact component matcher independently to each displayed
 * building. Never union footprints: their intervening campus is not a roof. */
export function transformIndoorBuildingTiles(
  data: ArrayBuffer,
  tile: IndoorTileCoordinate,
  models: readonly Pick<LocalIndoorModel, "origin" | "building">[],
): IndoorBuildingTileResult {
  let result: IndoorBuildingTileResult = {
    data,
    removedComponents: 0,
    reason: "no-match",
  };
  for (const model of models) {
    const next = transformIndoorBuildingTile(result.data, tile, model);
    result = {
      data: next.data,
      removedComponents: result.removedComponents + next.removedComponents,
      reason:
        result.removedComponents || next.removedComponents
          ? "removed"
          : next.reason,
    };
  }
  return result;
}

interface WireField {
  tag: number;
  wire: number;
  start: number;
  end: number;
  payloadStart: number;
}

/** Preserve untouched protobuf fields byte-for-byte, including unknown fields. */
function fields(bytes: Uint8Array): WireField[] {
  const reader = new Pbf(bytes);
  const result: WireField[] = [];
  while (reader.pos < bytes.length) {
    const start = reader.pos;
    const key = reader.readVarint();
    const wire = key & 7;
    let payloadStart = reader.pos;
    if (wire === 2) {
      const length = reader.readVarint();
      payloadStart = reader.pos;
      reader.pos += length;
    } else {
      reader.skip(key);
    }
    if (key >> 3 === 0 || reader.pos > bytes.length || reader.pos <= start)
      throw new Error("Invalid MVT protobuf field");
    result.push({ tag: key >> 3, wire, start, end: reader.pos, payloadStart });
  }
  return result;
}

function payload(bytes: Uint8Array, field: WireField) {
  if (field.wire !== 2)
    throw new Error("Expected a length-delimited MVT field");
  return bytes.subarray(field.payloadStart, field.end);
}

function replace(bytes: Uint8Array, field: WireField, replacement: Uint8Array) {
  const output = new Uint8Array(
    bytes.length - (field.end - field.start) + replacement.length,
  );
  output.set(bytes.subarray(0, field.start));
  output.set(replacement, field.start);
  output.set(bytes.subarray(field.end), field.start + replacement.length);
  return output;
}

function wrap(tag: number, bytes: Uint8Array) {
  const writer = new Pbf();
  writer.writeBytesField(tag, bytes);
  return writer.finish();
}

function area(polygons: MultiPolygon) {
  return polygons.reduce(
    (sum, polygon) =>
      sum +
      polygon.reduce((sum, ring, i) => {
        const twice = ring.reduce((sum, p, j) => {
          const q = ring[(j + 1) % ring.length];
          return sum + p[0] * q[1] - q[0] * p[1];
        }, 0);
        return sum + (i === 0 ? 1 : -1) * Math.abs(twice / 2);
      }, 0),
    0,
  );
}

/**
 * Remove a confidently matched building, including disjoint roof components,
 * never a whole shared ID. Only matched features' geometry fields are encoded;
 * tags, IDs, string
 * tables and every other feature/layer retain their original protobuf bytes.
 * Nonmatching/ambiguous tiles return the identical input ArrayBuffer.
 */
export function transformIndoorBuildingTile(
  data: ArrayBuffer,
  tile: IndoorTileCoordinate,
  model: Pick<LocalIndoorModel, "origin" | "building">,
): IndoorBuildingTileResult {
  const unchanged = (
    reason: IndoorBuildingTileResult["reason"],
  ): IndoorBuildingTileResult => ({ data, removedComponents: 0, reason });
  try {
    const count = 2 ** tile.z;
    if (
      !Number.isInteger(tile.z) ||
      tile.z < 0 ||
      tile.z > 30 ||
      !Number.isInteger(tile.x) ||
      !Number.isInteger(tile.y) ||
      tile.x < 0 ||
      tile.y < 0 ||
      tile.x >= count ||
      tile.y >= count
    )
      return unchanged("invalid-tile");

    // Normalized tile coordinates permit a cheap geographic reject before
    // decoding unrelated tiles. Matching remains in this tile's integer basis.
    const normalized = model.building.footprint.map((ring) =>
      ring.map((point) => {
        const [lng, lat] = localToLngLat(point, model.origin);
        const latitude = (lat * Math.PI) / 180;
        return [
          ((lng + 180) / 360) * count - tile.x,
          (0.5 -
            Math.log(Math.tan(Math.PI / 4 + latitude / 2)) / (2 * Math.PI)) *
            count -
            tile.y,
        ] as [number, number];
      }),
    );
    const points = normalized.flat();
    if (!points.length || points.some((p) => !p.every(Number.isFinite)))
      return unchanged("invalid-tile");
    const bounds = [
      Math.min(...points.map((p) => p[0])),
      Math.min(...points.map((p) => p[1])),
      Math.max(...points.map((p) => p[0])),
      Math.max(...points.map((p) => p[1])),
    ];
    if (bounds[2] < 0 || bounds[0] > 1 || bounds[3] < 0 || bounds[1] > 1)
      return unchanged("outside-footprint");

    const bytes = new Uint8Array(data);
    const source = new VectorTile(new Pbf(bytes));
    const building = source.layers.building;
    if (!building) return unchanged("no-match");
    const footprint: Polygon = normalized.map((ring) =>
      ring.map(([x, y]) => [x * building.extent, y * building.extent]),
    );
    const footprintArea = area([footprint]);
    if (!(footprintArea > 0)) return unchanged("invalid-tile");

    const candidates: {
      featureIndex: number;
      rings: ReturnType<typeof classifyRings>[number];
      component: ReturnType<typeof classifyRings>[number];
      polygon: Polygon;
    }[] = [];
    for (let i = 0; i < building.length; i++) {
      const feature = building.feature(i);
      if (feature.type !== 3) continue;
      const rings = feature.loadGeometry();
      for (const component of classifyRings(rings)) {
        const outer = component[0];
        if (!outer?.length) continue;
        const extent = building.extent;
        if (
          Math.max(...outer.map((p) => p.x)) < bounds[0] * extent ||
          Math.min(...outer.map((p) => p.x)) > bounds[2] * extent ||
          Math.max(...outer.map((p) => p.y)) < bounds[1] * extent ||
          Math.min(...outer.map((p) => p.y)) > bounds[3] * extent
        )
          continue;
        const polygon: Polygon = component.map((ring) =>
          ring.map((p) => [p.x, p.y]),
        );
        const componentArea = area([polygon]);
        const overlap = area(polygonClipping.intersection(footprint, polygon));
        if (!(componentArea > 0) || !(overlap / componentArea >= 0.7)) continue;
        candidates.push({ featureIndex: i, rings, component, polygon });
      }
    }
    if (!candidates.length) return unchanged("no-match");
    // A building can have several disjoint roof polygons in the provider's
    // tile. Match their union to the same footprint instead of requiring each
    // roof to cover the whole building. Overlapping alternatives remain
    // ambiguous; this does not broaden removal to shared IDs or neighbours.
    for (let i = 0; i < candidates.length; i++) {
      for (let j = 0; j < i; j++) {
        if (
          area(
            polygonClipping.intersection(
              candidates[i].polygon,
              candidates[j].polygon,
            ),
          ) > 1e-6
        )
          return unchanged("ambiguous");
      }
    }
    const combined = polygonClipping.union(
      candidates[0].polygon,
      ...candidates.slice(1).map((candidate) => candidate.polygon),
    );
    const combinedArea = area(combined);
    const overlap = area(polygonClipping.intersection(footprint, combined));
    if (
      overlap / footprintArea < 0.7 ||
      overlap / combinedArea < 0.7 ||
      overlap / (footprintArea + combinedArea - overlap) < 0.65
    )
      return unchanged("no-match");
    const matches = [...new Set(candidates.map((c) => c.featureIndex))]
      .map((featureIndex) => {
        const parts = candidates.filter((c) => c.featureIndex === featureIndex);
        const removedRings = new Set(parts.flatMap((part) => part.component));
        return {
          featureIndex,
          // Unrelated degenerate rings omitted by classifyRings also retain
          // their exact coordinates and order.
          retained: parts[0].rings.filter((ring) => !removedRings.has(ring)),
        };
      })
      .sort((a, b) => b.featureIndex - a.featureIndex);

    const layers = fields(bytes).filter((f) => f.tag === 3 && f.wire === 2);
    const matchingLayers = layers.filter((layerField) => {
      const layer = payload(bytes, layerField);
      const name = fields(layer).find((field) => field.tag === 1);
      return (
        name && new TextDecoder().decode(payload(layer, name)) === "building"
      );
    });
    if (matchingLayers.length !== 1) return unchanged("invalid-tile");
    const layerField = matchingLayers[0];
    const layerBytes = payload(bytes, layerField);
    const featureFields = fields(layerBytes).filter((f) => f.tag === 2);
    let newLayer = layerBytes;
    // Replace from the end so original offsets stay valid across features.
    for (const match of matches) {
      const featureField = featureFields[match.featureIndex];
      if (!featureField) return unchanged("invalid-tile");
      let replacement = new Uint8Array();
      if (match.retained.length) {
        // vt-pbf is used only for integer geometry commands. Never re-encode
        // original names/values: that would also risk changing Unicode values.
        const encoded = fromVectorTileJs({
          layers: {
            building: {
              version: building.version,
              name: "building",
              extent: building.extent,
              length: 1,
              feature: () => ({
                type: 3,
                id: undefined,
                extent: building.extent,
                properties: {},
                loadGeometry: () => match.retained,
              }),
            },
          },
        });
        const encodedLayer = payload(encoded, fields(encoded)[0]);
        const encodedFeatureField = fields(encodedLayer).find(
          (f) => f.tag === 2,
        );
        if (!encodedFeatureField) return unchanged("invalid-tile");
        const encodedFeature = payload(encodedLayer, encodedFeatureField);
        const encodedGeometry = fields(encodedFeature).find((f) => f.tag === 4);
        const featureBytes = payload(layerBytes, featureField);
        const geometryFields = fields(featureBytes).filter((f) => f.tag === 4);
        if (!encodedGeometry || geometryFields.length !== 1)
          return unchanged("invalid-tile");
        const newFeature = replace(
          featureBytes,
          geometryFields[0],
          encodedFeature.subarray(encodedGeometry.start, encodedGeometry.end),
        );
        replacement = new Uint8Array(wrap(2, newFeature));
      }
      newLayer = replace(newLayer, featureField, replacement);
    }
    const output = replace(bytes, layerField, wrap(3, newLayer));
    return {
      data: output.buffer,
      removedComponents: candidates.length,
      featureIndex: matches.length === 1 ? matches[0].featureIndex : undefined,
      reason: "removed",
    };
  } catch {
    return unchanged("invalid-tile");
  }
}
