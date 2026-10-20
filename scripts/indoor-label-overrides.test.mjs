import assert from "node:assert/strict";
import { test } from "node:test";
import { applyIndoorLabelOverrides } from "./indoor-label-overrides.mjs";

function fixture() {
  const model = {
    source: { sha256: "synthetic-sha", warnings: ["Existing warning"] },
    origin: [0, 0],
    building: {
      footprint: [
        [
          [0, 0],
          [1, 0],
          [0, 1],
          [0, 0],
        ],
      ],
    },
    nodes: [{ id: "a@L0", point: [1, 2, 0], levelRef: "L0" }],
    walls: [
      {
        id: "wall",
        points: [
          [1, 2],
          [3, 4],
        ],
      },
    ],
    connections: [],
    features: [],
    places: [],
    edges: [],
  };
  for (const [id, ref, levelRefs] of [
    ["a", "3", ["L0", "L1", "L2"]],
    ["b", "1", ["L0", "L2"]],
    ["c", "2", ["L0", "L1"]],
  ]) {
    const name = `Lift ${ref}`;
    const connectionId = `node/${id}`;
    const tags = {
      name,
      ref,
      wheelchair: "yes",
      level: levelRefs.join(";"),
      note: "Source note",
    };
    model.connections.push({
      id: connectionId,
      osmRef: connectionId,
      kind: "elevator",
      name,
      levelRefs,
      coordinates: levelRefs.map((_, i) => [1, 2, i * 4]),
      tags: { ...tags },
    });
    for (const levelRef of ["L0", "L1", "L2"])
      model.features.push({
        id: `shaft-${id}@${levelRef}`,
        kind: "area",
        connectionId,
        levelRef,
        name: `Shaft ${ref}`,
        geometry: { type: "Point", coordinates: [1, 2] },
        tags: { name: `Shaft ${ref}`, "a11ymap:area_type": "elevator-shaft" },
      });
    for (const levelRef of levelRefs)
      model.places.push({
        id: `${id}@${levelRef}`,
        nodeId: `${id}@${levelRef}`,
        connectionId,
        connectionIds: [connectionId],
        name: `${name} · ${levelRef}`,
        ref,
        levelRef,
        point: [1, 2, 0],
        tags: { ...tags },
      });
    model.edges.push({
      id: `edge-${id}`,
      osmRef: connectionId,
      kind: "elevator",
      from: `${id}@${levelRefs[0]}`,
      to: `${id}@${levelRefs.at(-1)}`,
      lengthM: 8,
      wheelchair: "yes",
      tags: { ...tags },
    });
  }
  const overrides = {
    schemaVersion: 1,
    sourceSha256: "synthetic-sha",
    note: "User-confirmed numbering; physical connections stay unchanged.",
    connectionLabels: [
      {
        connectionId: "node/a",
        expected: {
          name: "Lift 3",
          ref: "3",
          levelRefs: ["L0", "L1", "L2"],
          featureName: "Shaft 3",
        },
        label: { name: "Lift 1", ref: "1", featureName: "Shaft 1" },
      },
      {
        connectionId: "node/b",
        expected: {
          name: "Lift 1",
          ref: "1",
          levelRefs: ["L0", "L2"],
          featureName: "Shaft 1",
        },
        label: { name: "Lift 3", ref: "3", featureName: "Shaft 3" },
      },
    ],
  };
  return { model, overrides };
}

test("renumbers every linked label atomically without moving connections or changing stops", () => {
  const { model, overrides } = fixture();
  const before = structuredClone(model);
  const result = applyIndoorLabelOverrides(model, overrides);
  assert.deepEqual(model, before);
  for (const [id, ref] of [
    ["a", "1"],
    ["b", "3"],
    ["c", "2"],
  ]) {
    const connection = result.connections.find(
      (entry) => entry.id === `node/${id}`,
    );
    const original = model.connections.find(
      (entry) => entry.id === connection.id,
    );
    assert.equal(connection.name, `Lift ${ref}`);
    assert.equal(connection.tags.ref, ref);
    assert.deepEqual(connection.coordinates, original.coordinates);
    assert.deepEqual(connection.levelRefs, original.levelRefs);
    for (const feature of result.features.filter(
      (entry) => entry.connectionId === connection.id,
    ))
      assert.equal(feature.name, `Shaft ${ref}`);
    for (const place of result.places.filter(
      (entry) => entry.connectionId === connection.id,
    )) {
      assert.equal(place.ref, ref);
      assert.equal(place.name, `Lift ${ref} · ${place.levelRef}`);
      assert.equal(place.tags.name, `Lift ${ref}`);
    }
    for (const edge of result.edges.filter(
      (entry) => entry.osmRef === connection.id,
    )) {
      assert.equal(edge.tags.name, `Lift ${ref}`);
      const source = model.edges.find((entry) => entry.id === edge.id);
      const { tags: _a, ...topology } = edge;
      const { tags: _b, ...sourceTopology } = source;
      assert.deepEqual(topology, sourceTopology);
      assert.equal(edge.tags.wheelchair, source.tags.wheelchair);
      assert.equal(edge.tags.level, source.tags.level);
    }
  }
  assert.deepEqual(result.nodes, model.nodes);
  assert.deepEqual(result.walls, model.walls);
  assert.deepEqual(result.building, model.building);
  assert.deepEqual(result.origin, model.origin);
  assert.equal(result.connections[0].tags["a11ymap:original_name"], "Lift 3");
  assert.equal(result.connections[0].tags["a11ymap:original_ref"], "3");
  assert.equal(result.source.sha256, model.source.sha256);
  assert.equal(result.source.warnings.length, model.source.warnings.length + 1);
});

test("rejects a different source hash without mutating the original model", () => {
  const { model, overrides } = fixture();
  const before = structuredClone(model);
  overrides.sourceSha256 = "new-source";
  assert.throws(
    () => applyIndoorLabelOverrides(model, overrides),
    /source\/schema mismatch/,
  );
  assert.deepEqual(model, before);
});

test("guards source ref, connection name, stops, feature name and place/edge labels", () => {
  for (const change of [
    (model) => {
      model.connections[0].tags.ref = "changed";
    },
    (model) => {
      model.connections[0].name = "Changed";
    },
    (model) => {
      model.connections[0].levelRefs = ["L0"];
    },
    (model) => {
      model.features[0].name = "Different shaft";
    },
    (model) => {
      model.places[0].name = "Different landing";
    },
    (model) => {
      model.edges[0].tags.name = "Different edge";
    },
  ]) {
    const { model, overrides } = fixture();
    change(model);
    const before = structuredClone(model);
    assert.throws(
      () => applyIndoorLabelOverrides(model, overrides),
      /guard failed/,
    );
    assert.deepEqual(model, before);
  }
});

test("rejects unknown/duplicate targets and any attempted non-label patch", () => {
  for (const change of [
    (overrides) => {
      overrides.connectionLabels[0].connectionId = "node/missing";
    },
    (overrides) => {
      overrides.connectionLabels.push(
        structuredClone(overrides.connectionLabels[0]),
      );
    },
    (overrides) => {
      overrides.connectionLabels[0].label.levelRefs = ["L0"];
    },
    (overrides) => {
      overrides.connectionLabels[0].label.coordinates = [[99, 99, 99]];
    },
    (overrides) => {
      overrides.connectionLabels[0].label.ref = "";
    },
  ]) {
    const { model, overrides } = fixture();
    change(overrides);
    const before = structuredClone(model);
    assert.throws(() => applyIndoorLabelOverrides(model, overrides));
    assert.deepEqual(model, before);
  }
});
