import assert from "node:assert/strict";
import { test } from "node:test";
import { createExportScope, exportedLevelRef } from "./indoor-export-scope.mjs";

const scope = {
  featureRefs: ["way/11"],
  edgeRefs: ["way/12", "way/13"],
  placeNodeRefs: ["node/14"],
  wallRefs: ["way/15"],
};
const exists = (ref) => Object.values(scope).flat().includes(ref);

test("explicit scope does not absorb a neighbouring building sharing the shell", () => {
  const selected = createExportScope(scope, exists);
  assert.equal(selected.feature("way/11@7"), true);
  assert.equal(selected.feature("way/99@0"), false);
  assert.equal(selected.edge("way/13"), true);
  assert.equal(selected.edge("way/99"), false);
  assert.equal(selected.placeNode("14@0"), true);
  assert.equal(selected.placeNode("99@0"), false);
  assert.equal(selected.wall("way/15"), true);
  assert.equal(selected.wall("way/11"), false);
});

test("scope fails closed for missing, malformed, duplicate or unknown entries", () => {
  for (const invalid of [
    { ...scope, edgeRefs: ["way/999"] },
    { ...scope, edgeRefs: ["way/12@0"] },
    { ...scope, featureRefs: ["way/11", "way/11"] },
    { ...scope, placeNodeRefs: ["way/11"] },
    { ...scope, unexpected: true },
    { edgeRefs: [] },
  ])
    assert.throws(() => createExportScope(invalid, exists));
  assert.equal(createExportScope(undefined, exists), null);
});

test("outdoor zero ordinal does not become a first-floor location", () => {
  const level = (o) => `${o + 1}F`;
  assert.equal(exportedLevelRef({ ordinal: 0, buildingId: null }, level), null);
  assert.equal(
    exportedLevelRef({ ordinal: 7, buildingId: "selected" }, level),
    "8F",
  );
  assert.equal(
    exportedLevelRef({ ordinal: null, buildingId: "selected" }, level),
    null,
  );
});
