import { classifyRings, VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";
import { describe, expect, it } from "vitest";
import { lngLatToLocal } from "../coordinates";
import {
  transformIndoorBuildingTile,
  transformIndoorBuildingTiles,
} from "../mapBuildingTile";
import type { LocalIndoorModel, XY } from "../types";

const tile = { z: 14, x: 10000, y: 6500 };
const extent = 4096;
const rectangle = (x: number, y: number, w: number, h: number): XY[] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
  [x, y],
];
const target = rectangle(1100, 1700, 140, 100);
type FixtureFeature = {
  id?: number | bigint;
  type?: 1 | 2 | 3;
  rings: XY[][];
  properties?: Record<string, string | number | boolean>;
};

function concat(...parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function idField(id: number | bigint) {
  let value = BigInt(id);
  const bytes = [8];
  while (value > BigInt(127)) {
    bytes.push(Number(value & BigInt(127)) | 128);
    value >>= BigInt(7);
  }
  bytes.push(Number(value));
  return Uint8Array.from(bytes);
}

// Build fixtures directly from the MVT command specification. TextEncoder
// ensures supplementary Unicode in the source is valid before transformation.
function layer(name: string, features: FixtureFeature[]) {
  const p = new Pbf();
  p.writeVarintField(15, 2);
  p.writeBytesField(1, new TextEncoder().encode(name));
  p.writeVarintField(5, extent);
  const keys: string[] = [],
    values: (string | number | boolean)[] = [];
  for (const feature of features) {
    const f = new Pbf(),
      tags = new Pbf(),
      geometry = new Pbf();
    for (const [key, value] of Object.entries(feature.properties ?? {})) {
      tags.writeVarint(keys.length);
      keys.push(key);
      tags.writeVarint(values.length);
      values.push(value);
    }
    f.writeBytesField(2, tags.finish());
    const type = feature.type ?? 3;
    f.writeVarintField(3, type);
    let x = 0,
      y = 0;
    for (const ring of feature.rings) {
      const count = type === 3 ? ring.length - 1 : ring.length;
      geometry.writeVarint(type === 1 ? (count << 3) | 1 : 9);
      for (let i = 0; i < count; i++) {
        if (i === 1 && type !== 1) geometry.writeVarint(((count - 1) << 3) | 2);
        const dx = ring[i][0] - x,
          dy = ring[i][1] - y;
        geometry.writeVarint((dx << 1) ^ (dx >> 31));
        geometry.writeVarint((dy << 1) ^ (dy >> 31));
        [x, y] = ring[i];
      }
      if (type === 3) geometry.writeVarint(15);
    }
    f.writeBytesField(4, geometry.finish());
    f.writeVarintField(9, 123); // A valid unknown extension must survive too.
    p.writeBytesField(
      2,
      feature.id === undefined
        ? f.finish()
        : concat(idField(feature.id), f.finish()),
    );
  }
  for (const key of keys) p.writeBytesField(3, new TextEncoder().encode(key));
  for (const value of values) {
    const v = new Pbf();
    if (typeof value === "string")
      v.writeBytesField(1, new TextEncoder().encode(value));
    else if (typeof value === "boolean") v.writeBooleanField(7, value);
    else v.writeDoubleField(3, value);
    p.writeBytesField(4, v.finish());
  }
  p.writeBytesField(17, new TextEncoder().encode("unknown layer 𩵚"));
  return p.finish();
}

function encode(layers: Record<string, FixtureFeature[]>) {
  const p = new Pbf();
  p.writeVarintField(8, 37); // Unknown top-level data also stays untouched.
  for (const [name, features] of Object.entries(layers))
    p.writeBytesField(3, layer(name, features));
  return new Uint8Array(p.finish()).buffer;
}

function rawFields(bytes: Uint8Array) {
  const result: { tag: number; bytes: Uint8Array; payload?: Uint8Array }[] = [];
  new Pbf(bytes).readFields((tag, _, reader) => {
    const start = reader.pos;
    const payload = reader.type === 2 ? reader.readBytes() : undefined;
    if (!payload) reader.skip((tag << 3) | reader.type);
    result.push({ tag, bytes: bytes.slice(start, reader.pos), payload });
  }, null);
  return result;
}

function layerBytes(data: ArrayBuffer, name: string) {
  const entry = rawFields(new Uint8Array(data)).find(
    (f) =>
      f.tag === 3 &&
      f.payload &&
      rawFields(f.payload).some(
        (p) => p.tag === 1 && new TextDecoder().decode(p.payload) === name,
      ),
  );
  if (!entry?.payload) throw new Error(`Missing synthetic layer ${name}`);
  return entry.payload;
}

function fieldPayload(field: { payload?: Uint8Array }) {
  if (!field.payload) throw new Error("Missing synthetic protobuf payload");
  return field.payload;
}

function model(
  rings = [target],
): Pick<LocalIndoorModel, "origin" | "building"> {
  const lngLat = ([x, y]: XY): XY => {
    const n = 2 ** tile.z;
    const my = (tile.y + y / extent) / n;
    return [
      ((tile.x + x / extent) / n) * 360 - 180,
      ((2 * Math.atan(Math.exp(Math.PI * (1 - 2 * my))) - Math.PI / 2) * 180) /
        Math.PI,
    ];
  };
  const origin = lngLat(rings[0][0]);
  return {
    origin,
    building: {
      footprint: rings.map((ring) =>
        ring.map((p) => lngLatToLocal(lngLat(p), origin)),
      ),
    },
  } as Pick<LocalIndoorModel, "origin" | "building">;
}

const decode = (data: ArrayBuffer) => new VectorTile(new Pbf(data));
const coordinates = (data: ArrayBuffer, index = 0) =>
  decode(data)
    .layers.building.feature(index)
    .loadGeometry()
    .map((r) => r.map((p) => [p.x, p.y]));

describe("component-level indoor MVT building transform", () => {
  it("removes four exact buildings while retaining the fifth roof and other layers unchanged", () => {
    const roofs = Array.from({ length: 5 }, (_, i) =>
      rectangle(400 + i * 400, 1700, 140, 100),
    );
    const input = encode({
      building: [
        {
          id: BigInt("9007199254740993"),
          rings: roofs,
          properties: { name: "synthetic 𩵚" },
        },
      ],
      road: [
        {
          type: 2,
          rings: [
            [
              [0, 0],
              [100, 100],
            ],
          ],
          properties: { name: "untouched" },
        },
      ],
    });
    const sources = roofs.slice(0, 4).map((roof) => model([roof]));
    const snapshot = JSON.stringify(sources);
    const result = transformIndoorBuildingTiles(input, tile, sources);
    expect(result.removedComponents).toBe(4);
    expect(coordinates(result.data)).toEqual([roofs[4]]);
    expect(layerBytes(result.data, "road")).toEqual(layerBytes(input, "road"));
    const sourceFeature = rawFields(layerBytes(input, "building")).find(
      (f) => f.tag === 2,
    );
    const resultFeature = rawFields(layerBytes(result.data, "building")).find(
      (f) => f.tag === 2,
    );
    if (!sourceFeature || !resultFeature)
      throw new Error("Synthetic building feature missing");
    expect(
      rawFields(fieldPayload(resultFeature)).filter((f) => f.tag !== 4),
    ).toEqual(
      rawFields(fieldPayload(sourceFeature)).filter((f) => f.tag !== 4),
    );
    expect(JSON.stringify(sources)).toBe(snapshot);
    expect(transformIndoorBuildingTiles(input, tile, []).data).toBe(input);
  });

  it("retains an ambiguous building even when another campus building can be safely opened", () => {
    const other = rectangle(1500, 1700, 140, 100);
    const input = encode({
      building: [
        { id: 1, rings: [target] },
        { id: 2, rings: [target] },
        { id: 3, rings: [other] },
      ],
    });
    const result = transformIndoorBuildingTiles(input, tile, [
      model(),
      model([other]),
    ]);
    expect(result.removedComponents).toBe(1);
    const before = rawFields(layerBytes(input, "building")).filter(
      (f) => f.tag === 2,
    );
    const after = rawFields(layerBytes(result.data, "building")).filter(
      (f) => f.tag === 2,
    );
    expect(after).toEqual(before.slice(0, 2));
  });

  it("removes a building partitioned into disjoint components without removing neighbouring components", () => {
    const west = rectangle(1100, 1700, 50, 100);
    const east = rectangle(1150, 1700, 90, 100);
    const neighbour = rectangle(1400, 1700, 120, 100);
    const input = encode({
      building: [
        { id: 7, rings: [west, neighbour, east], properties: { name: "𩵚" } },
      ],
    });
    const result = transformIndoorBuildingTile(input, tile, model());
    expect(result.reason).toBe("removed");
    expect(result.removedComponents).toBe(2);
    expect(coordinates(result.data)).toEqual([neighbour]);
    const before = rawFields(layerBytes(input, "building"));
    const after = rawFields(layerBytes(result.data, "building"));
    expect(after.filter((field) => field.tag !== 2)).toEqual(
      before.filter((field) => field.tag !== 2),
    );
    expect(
      rawFields(
        fieldPayload(after.filter((field) => field.tag === 2)[0]),
      ).filter((field) => field.tag !== 4),
    ).toEqual(
      rawFields(
        fieldPayload(before.filter((field) => field.tag === 2)[0]),
      ).filter((field) => field.tag !== 4),
    );
  });

  it("matches split roofs across features while preserving all unrelated features byte for byte", () => {
    const neighbour = rectangle(1400, 1700, 120, 100);
    const input = encode({
      building: [
        { id: 1, rings: [rectangle(1100, 1700, 50, 100)] },
        { id: 2, rings: [neighbour], properties: { name: "unrelated 𩵚" } },
        { id: 3, rings: [rectangle(1150, 1700, 90, 100)] },
      ],
    });
    const result = transformIndoorBuildingTile(input, tile, model());
    expect(result.removedComponents).toBe(2);
    expect(coordinates(result.data)).toEqual([neighbour]);
    const before = rawFields(layerBytes(input, "building"));
    const after = rawFields(layerBytes(result.data, "building"));
    expect(after.filter((field) => field.tag === 2)).toEqual([
      before.filter((field) => field.tag === 2)[1],
    ]);
    expect(after.filter((field) => field.tag !== 2)).toEqual(
      before.filter((field) => field.tag !== 2),
    );
  });

  it("does not remove a partition that covers too little of the active building", () => {
    const input = encode({
      building: [
        { rings: [rectangle(1100, 1700, 20, 100)] },
        { rings: [rectangle(1220, 1700, 20, 100)] },
      ],
    });
    expect(transformIndoorBuildingTile(input, tile, model()).data).toBe(input);
  });

  it("removes one component and its hole while preserving neighbours, their holes and large IDs", () => {
    const neighbour = rectangle(1400, 1700, 120, 100);
    const neighbourHole = rectangle(1430, 1730, 20, 20).reverse();
    const targetHole = rectangle(1140, 1730, 20, 20).reverse();
    const neighbour2 = rectangle(1700, 1800, 80, 80);
    const input = encode({
      building: [
        {
          id: BigInt("9007199254740993"),
          rings: [neighbour, neighbourHole, target, targetHole, neighbour2],
          properties: {
            name: "𩵚建築",
            render_height: 5,
            render_min_height: 0,
          },
        },
        {
          id: BigInt("9007199254740993"),
          rings: [rectangle(1900, 1800, 100, 90)],
        },
      ],
    });
    const snapshot = new Uint8Array(input).slice();
    const result = transformIndoorBuildingTile(
      input,
      tile,
      model([target, targetHole]),
    );
    expect(result.reason).toBe("removed");
    expect(result.removedComponents).toBe(1);
    expect(result.featureIndex).toBe(0);
    expect(coordinates(result.data)).toEqual([
      neighbour,
      neighbourHole,
      neighbour2,
    ]);
    expect(coordinates(result.data, 1)).toEqual(coordinates(input, 1));
    expect(new Uint8Array(input)).toEqual(snapshot);
    const before = rawFields(layerBytes(input, "building"));
    const after = rawFields(layerBytes(result.data, "building"));
    expect(after.filter((f) => f.tag !== 2)).toEqual(
      before.filter((f) => f.tag !== 2),
    );
    const originalFeatures = before.filter((f) => f.tag === 2);
    const changedFeatures = after.filter((f) => f.tag === 2);
    expect(changedFeatures[1]).toEqual(originalFeatures[1]);
    expect(
      rawFields(fieldPayload(changedFeatures[0])).filter((f) => f.tag !== 4),
    ).toEqual(
      rawFields(fieldPayload(originalFeatures[0])).filter((f) => f.tag !== 4),
    );
    expect(decode(result.data).layers.building.feature(0).properties.name).toBe(
      "𩵚建築",
    );
  });

  it("retains every other layer's exact bytes and supplementary Unicode properties", () => {
    const input = encode({
      poi: [
        {
          id: 18,
          type: 1,
          rings: [[[100, 100]]],
          properties: { name: "𩵚魠𡘙", enabled: true, score: 3.25 },
        },
      ],
      building: [{ id: 12, rings: [target, rectangle(1500, 1700, 90, 100)] }],
      road: [
        {
          id: 45,
          type: 2,
          rings: [
            [
              [10, 20],
              [100, 300],
              [500, 300],
            ],
          ],
          properties: { name: "synthetic road" },
        },
      ],
    });
    expect(decode(input).layers.poi.feature(0).properties.name).toBe("𩵚魠𡘙");
    const output = transformIndoorBuildingTile(input, tile, model()).data;
    for (const name of ["poi", "road"])
      expect(layerBytes(output, name)).toEqual(layerBytes(input, name));
    expect(
      rawFields(new Uint8Array(output)).filter((f) => f.tag !== 3),
    ).toEqual(rawFields(new Uint8Array(input)).filter((f) => f.tag !== 3));
    expect(decode(output).layers.poi.feature(0).properties).toEqual(
      decode(input).layers.poi.feature(0).properties,
    );
  });

  it("keeps hundreds of coalesced buildings at their original tile integer coordinates", () => {
    const neighbours = Array.from({ length: 900 }, (_, i) =>
      rectangle(100 + i * 3, 200, 2, 2),
    );
    const input = encode({
      building: [
        {
          rings: [
            ...neighbours.slice(0, 137),
            target,
            ...neighbours.slice(137),
          ],
          properties: { render_height: 5 },
        },
      ],
    });
    const result = transformIndoorBuildingTile(input, tile, model());
    expect(result.removedComponents).toBe(1);
    expect(
      classifyRings(
        decode(result.data).layers.building.feature(0).loadGeometry(),
      ),
    ).toHaveLength(900);
    expect(coordinates(result.data)).toEqual(neighbours);
  });

  it("removes an otherwise empty feature without dropping unrelated features sharing its ID", () => {
    const other = rectangle(1500, 1700, 100, 100);
    const input = encode({
      building: [
        { id: 9, rings: [target] },
        { id: 9, rings: [other] },
      ],
    });
    const result = transformIndoorBuildingTile(input, tile, model());
    expect(result.reason).toBe("removed");
    expect(decode(result.data).layers.building.length).toBe(1);
    expect(coordinates(result.data)).toEqual([other]);
  });

  it("returns the same buffer for unrelated tiles, missing building layers and partial overlaps", () => {
    const input = encode({
      building: [{ id: 1, rings: [rectangle(1000, 1600, 500, 500)] }],
    });
    expect(
      transformIndoorBuildingTile(input, { ...tile, x: tile.x + 1 }, model()),
    ).toEqual({
      data: input,
      removedComponents: 0,
      reason: "outside-footprint",
    });
    expect(transformIndoorBuildingTile(input, tile, model()).data).toBe(input);
    const noBuilding = encode({ poi: [{ type: 1, rings: [[[10, 10]]] }] });
    expect(transformIndoorBuildingTile(noBuilding, tile, model()).data).toBe(
      noBuilding,
    );
  });

  it("fails closed when more than one component meets the match threshold", () => {
    const input = encode({
      building: [
        { id: 1, rings: [target] },
        { id: 2, rings: [target] },
      ],
    });
    const result = transformIndoorBuildingTile(input, tile, model());
    expect(result.reason).toBe("ambiguous");
    expect(result.data).toBe(input);
  });

  it("keeps a courtyard hole and unrelated degenerate rings intact", () => {
    const surrounding = rectangle(1000, 1600, 400, 400);
    const courtyard = rectangle(1080, 1680, 180, 140).reverse();
    const noMatch = encode({ building: [{ rings: [surrounding, courtyard] }] });
    expect(transformIndoorBuildingTile(noMatch, tile, model()).data).toBe(
      noMatch,
    );
    const degenerate: XY[] = [
      [1400, 1700],
      [1450, 1700],
      [1400, 1700],
    ];
    const input = encode({
      building: [
        { rings: [target, degenerate, rectangle(1600, 1800, 100, 100)] },
      ],
    });
    const result = transformIndoorBuildingTile(input, tile, model());
    expect(coordinates(result.data)).toEqual([
      degenerate,
      rectangle(1600, 1800, 100, 100),
    ]);
  });

  it("leaves malformed protobuf and invalid tile addresses untouched", () => {
    const invalid = new Uint8Array([26, 100, 1]).buffer;
    expect(transformIndoorBuildingTile(invalid, tile, model())).toEqual({
      data: invalid,
      removedComponents: 0,
      reason: "invalid-tile",
    });
    const input = encode({ building: [{ rings: [target] }] });
    expect(
      transformIndoorBuildingTile(input, { ...tile, z: -1 }, model()).data,
    ).toBe(input);
  });
});
