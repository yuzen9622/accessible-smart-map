#!/usr/bin/env node
import { execFileSync } from "node:child_process";
/** Local-only adapter. Reads OSM and pure compiler modules; never calls a DB or API. */
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { createExportScope, exportedLevelRef } from "./indoor-export-scope.mjs";

const configFlag = process.argv.indexOf("--config");
if (configFlag < 0 || !process.argv[configFlag + 1]) {
  throw new Error(
    "Usage: node scripts/indoor-export.mjs --config <ignored-local-config.json>",
  );
}
const configFile = realpathSync(process.argv[configFlag + 1]);
const cwd = process.cwd();
const assertIgnored = (path) => {
  const rel = relative(cwd, path);
  if (rel.startsWith("..") || isAbsolute(rel))
    throw new Error("Local output/config must be inside this checkout");
  execFileSync("git", ["check-ignore", "--quiet", "--", rel], { cwd });
};
assertIgnored(configFile);
const config = JSON.parse(readFileSync(configFile, "utf8"));
const outFile = resolve(dirname(configFile), config.output ?? "model.json");
assertIgnored(outFile);
const backend = realpathSync(config.compilerRoot);
const require = createRequire(resolve(backend, "package.json"));
require("ts-node").register({
  transpileOnly: true,
  skipProject: true,
  compilerOptions: {
    module: "CommonJS",
    moduleResolution: "Node",
    target: "ES2022",
  },
});
const { parseOsmXml } = require(
  resolve(backend, "src/modules/venue/venue-osm.parse.ts"),
);
const { compileVenue, levelsOf, levelRefOf } = require(
  resolve(backend, "src/modules/venue/venue.compile.ts"),
);
const { venueConnections } = require(
  resolve(backend, "src/modules/venue/venue.connections.ts"),
);
const xml = readFileSync(config.osmFile, "utf8");
const sha256 = createHash("sha256").update(xml).digest("hex");
if (config.sourceSha256 && config.sourceSha256 !== sha256)
  throw new Error(
    "Local source changed; review the new source before exporting",
  );
const osm = parseOsmXml(xml);
const scope = createExportScope(config.scope, (ref) => {
  const [kind, id] = ref.split("/");
  return (
    kind === "way" ? osm.ways : kind === "node" ? osm.nodes : osm.relations
  ).has(id);
});
const omittedBuildings = [];
// The source may contain other buildings that have not been surveyed yet.
// Exclude only their navigation identity in this in-memory compilation view.
for (const el of [...osm.ways.values(), ...osm.relations.values()]) {
  if (!el.tags.building || !el.tags["a11ymap:id"] || el.tags["building:levels"])
    continue;
  if (el.tags["a11ymap:id"] === config.buildingId)
    throw new Error("Selected building has no levels");
  omittedBuildings.push(el.tags["a11ymap:id"]);
  el.tags = { ...el.tags };
  delete el.tags["a11ymap:id"];
}
const { venue, errors, warnings } = compileVenue(osm, {
  venueId: config.venueId,
  name: config.name,
});
if (errors.length) throw new Error(errors.join("\n"));
const building = venue.buildings.find((b) => b.id === config.buildingId);
if (!building) throw new Error("Selected building was not compiled");
const sourcePattern = config.sourcePattern
  ? new RegExp(config.sourcePattern)
  : null;
const extraWays = new Set(config.includeWayIds ?? []);
const blockedAnimation = new Set(config.animationBlockedWayIds ?? []);
const selectedLevels = new Set(
  config.levelOrdinals ?? building.levels.map((l) => l.ordinal),
);
const tagsOf = (id) => {
  const [kind, rawId] = id.split("@")[0].split("/");
  return (
    (kind === "way"
      ? osm.ways
      : kind === "node"
        ? osm.nodes
        : osm.relations
    ).get(rawId)?.tags ?? {}
  );
};
const selectedSource = (id) =>
  extraWays.has(id) ||
  !!sourcePattern?.test(tagsOf(id)["a11ymap:source"] ?? "");
const origin = config.origin ?? building.footprint[0][0];
const rad = Math.PI / 180;
const radius = 6371000;
const project = ([lng, lat]) => [
  (lng - origin[0]) * rad * radius * Math.cos(origin[1] * rad),
  (lat - origin[1]) * rad * radius,
];
const project3 = ([lng, lat, z]) => [...project([lng, lat]), z];
const nodeById = new Map(venue.nodes.map((n) => [n.id, n]));
const selectedNode = (n) =>
  n && (n.ordinal === null || selectedLevels.has(n.ordinal));
const selectedEdges = venue.edges.filter((e) => {
  const a = nodeById.get(e.from);
  const b = nodeById.get(e.to);
  if (!selectedNode(a) || !selectedNode(b)) return false;
  if (scope) return scope.edge(e.osmRef);
  return (
    (a.buildingId === building.id && b.buildingId === building.id) ||
    selectedSource(e.osmRef)
  );
});
const usedNodes = new Set(selectedEdges.flatMap((e) => [e.from, e.to]));
const nodes = venue.nodes
  .filter((n) => usedNodes.has(n.id))
  .map((n) => ({
    id: n.id,
    buildingId: n.buildingId,
    osmRef: `node/${n.id.split("@")[0]}`,
    tags: osm.nodes.get(n.id.split("@")[0])?.tags ?? {},
    point: project3([n.lng, n.lat, n.z]),
    ordinal: n.ordinal,
    levelRef: exportedLevelRef(n, levelRefOf),
    kind: n.kind,
  }));
const localNodes = new Map(nodes.map((n) => [n.id, n]));
const features = venue.features
  .filter(
    (f) =>
      selectedLevels.has(f.ordinal) &&
      (scope
        ? scope.feature(f.id)
        : f.buildingId === building.id || selectedSource(f.id)),
  )
  .map((f) => ({
    id: f.id,
    buildingId: f.buildingId,
    kind: f.kind,
    levelRef: f.ordinal === null ? null : levelRefOf(f.ordinal),
    ordinal: f.ordinal,
    ...(f.name ? { name: f.name } : {}),
    ...(f.ref ? { ref: f.ref } : {}),
    geometry:
      f.geometry.type === "Polygon"
        ? {
            type: "Polygon",
            coordinates: f.geometry.coordinates.map((ring) =>
              ring.map(project),
            ),
          }
        : { type: "Point", coordinates: project(f.geometry.coordinates) },
    tags: tagsOf(f.id),
    geometryStatus: f.geometryStatus,
    heightStatus: f.heightStatus,
  }));
const edgeIds = new Set(selectedEdges.map((e) => e.osmRef));
const selectedOsmRefs = new Set([
  ...edgeIds,
  ...features.map((f) => f.id.split("@")[0]),
]);
const selectedWarnings = warnings.filter((warning) => {
  const references = [
    ...warning.matchAll(/\b(way|node|relation)[ /](-?\d+)/g),
  ].map((match) => `${match[1]}/${match[2]}`);
  // Compilation includes neighbouring source context, but the viewer exposes
  // only diagnostics belonging to the requested building.
  return (
    references.length > 0 && references.every((ref) => selectedOsmRefs.has(ref))
  );
});
const connections = venueConnections({ ...venue, edges: selectedEdges })
  .filter((c) => edgeIds.has(c.osmRef))
  .map((c) => ({
    id: c.id,
    buildingId: (() => {
      const ids = new Set(
        selectedEdges
          .filter((e) => e.osmRef === c.osmRef)
          .flatMap((e) => [
            localNodes.get(e.from)?.buildingId,
            localNodes.get(e.to)?.buildingId,
          ]),
      );
      return ids.size === 1 ? [...ids][0] : null;
    })(),
    kind: c.kind,
    name: tagsOf(c.osmRef).name ?? c.kind,
    coordinates: c.coordinates.map(project3),
    levelRefs: c.levelRefs,
    wheelchair: c.wheelchair,
    geometryStatus: c.geometryStatus,
    heightStatus: c.heightStatus,
    heightPending: tagsOf(c.osmRef)["a11ymap:height_pending"] === "yes",
    animationPending: blockedAnimation.has(c.osmRef),
    tags: tagsOf(c.osmRef),
    osmRef: c.osmRef,
  }));
const containsPoint = (ring, point) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j];
    const b = ring[i];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length2 = dx * dx + dy * dy;
    const t =
      length2 === 0
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2,
            ),
          );
    if (Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy) < 0.001)
      return true;
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < (dx * (point[1] - a[1])) / dy + a[0]
    )
      inside = !inside;
  }
  return inside;
};
for (const feature of features) {
  const areaType = feature.tags["a11ymap:area_type"];
  const displayKind =
    areaType === "elevator-shaft" || areaType === "vertical-core"
      ? "elevator"
      : areaType === "stairwell"
        ? "stairs"
        : null;
  if (!displayKind || feature.geometry.type !== "Polygon") continue;
  feature.displayKind = displayKind;
  const candidates = connections.filter(
    (connection) =>
      connection.kind === displayKind &&
      connection.coordinates.some(
        (point, index) =>
          (connection.kind === "elevator" ||
            connection.levelRefs[index] === feature.levelRef) &&
          containsPoint(feature.geometry.coordinates[0], point) &&
          !feature.geometry.coordinates
            .slice(1)
            .some((hole) => containsPoint(hole, point)),
      ),
  );
  // Prefer the connection beginning on this floor over the one arriving here.
  const connection =
    candidates.find(
      (candidate) => candidate.levelRefs[0] === feature.levelRef,
    ) ?? candidates[0];
  if (connection) feature.connectionId = connection.id;
}
const places = venue.places
  .filter(
    (p) =>
      usedNodes.has(p.nodeId) &&
      (scope ? scope.placeNode(p.nodeId) : p.buildingId === building.id),
  )
  .map((p) => {
    const tags = osm.nodes.get(p.nodeId.split("@")[0])?.tags ?? {};
    const doorKnown = !!tags.door || !!tags.entrance;
    const outdoors = p.buildingId === null;
    const arrivalOnly = !outdoors && !doorKnown && p.kind !== "anchor";
    return {
      id: p.id,
      buildingId: p.buildingId,
      name: p.name,
      ...(p.ref ? { ref: p.ref } : {}),
      kind: p.kind,
      nodeId: p.nodeId,
      point: localNodes.get(p.nodeId).point,
      levelRef: p.levelRef,
      routeEndpoint:
        outdoors || p.kind === "gate"
          ? "place"
          : doorKnown
            ? "door"
            : "corridor",
      doorKnown,
      arrivalOnly: p.kind === "gate" ? false : arrivalOnly,
      tags,
    };
  });
// Optional local handoff is an alias of an existing authored graph node.
// Its private identity/name belong in ignored config, never in this adapter.
const externalApproach = config.externalApproach;
if (externalApproach) {
  const { id, name, nodeId } = externalApproach;
  if (
    [id, name, nodeId].some(
      (value) => typeof value !== "string" || !value.trim(),
    )
  )
    throw new Error("externalApproach requires non-empty id, name and nodeId");
  const node = localNodes.get(nodeId);
  const sourceNode = nodeById.get(nodeId);
  // The compiler may mark the whole mixed indoor/outdoor way indoor.
  // Require the actual source node to sit outside any compiled building.
  if (!node || !sourceNode || sourceNode.buildingId !== null)
    throw new Error(
      "externalApproach must reference an exported outdoor source graph node",
    );
  if (places.some((place) => place.id === id))
    throw new Error("externalApproach id duplicates an existing place");
  places.push({
    id,
    buildingId: sourceNode.buildingId,
    name,
    kind: "external-approach",
    nodeId,
    point: [...node.point],
    levelRef: null,
    routeEndpoint: "place",
    doorKnown: false,
    arrivalOnly: false,
    tags: { ...(osm.nodes.get(nodeId.split("@")[0])?.tags ?? {}) },
  });
}
const verticalPlaces = new Map();
const landingDestinations = new Map();
for (const connection of connections) {
  if (connection.kind !== "elevator" && connection.kind !== "stairs") continue;
  if (
    connection.heightPending ||
    (connection.kind === "stairs" &&
      new Set(connection.levelRefs.filter(Boolean)).size < 2)
  )
    continue;
  const groupEdges = selectedEdges.filter((edge) => {
    const key =
      edge.kind === "elevator"
        ? edge.osmRef
        : `${edge.osmRef}@${edge.id.slice(edge.id.lastIndexOf("@") + 1)}`;
    return key === connection.id;
  });
  const chain =
    connection.kind === "elevator"
      ? [...new Set(groupEdges.flatMap((edge) => [edge.from, edge.to]))]
          .map((id) => localNodes.get(id))
          .sort((a, b) => a.ordinal - b.ordinal)
      : [groupEdges[0].from, ...groupEdges.map((edge) => edge.to)].map((id) =>
          localNodes.get(id),
        );
  const stops =
    connection.kind === "elevator"
      ? chain
      : [chain[0], chain[chain.length - 1]];
  for (const node of stops) {
    if (!node || node.ordinal === null || !node.levelRef) continue;
    const key = `${connection.kind}:${node.id}`;
    const existing = verticalPlaces.get(key);
    const destinations = landingDestinations.get(key) ?? new Set();
    for (const ref of connection.levelRefs) {
      if (ref && ref !== node.levelRef) destinations.add(ref);
    }
    landingDestinations.set(key, destinations);
    if (existing) {
      existing.connectionIds.push(connection.id);
      // Matches feature selection's preference for the span departing this floor.
      if (connection.levelRefs[0] === node.levelRef) {
        existing.connectionId = connection.id;
        existing.tags = connection.tags;
      }
      continue;
    }
    verticalPlaces.set(key, {
      id: `connection:${key}`,
      buildingId: node.buildingId,
      name: `${connection.name} · ${node.levelRef}`,
      ...(connection.tags.ref ? { ref: connection.tags.ref } : {}),
      kind: connection.kind,
      nodeId: node.id,
      point: node.point,
      levelRef: node.levelRef,
      routeEndpoint: "corridor",
      doorKnown: false,
      arrivalOnly: false,
      tags: connection.tags,
      connectionId: connection.id,
      connectionIds: [connection.id],
    });
  }
}
for (const [key, place] of verticalPlaces) {
  if (place.kind === "stairs") {
    const refs = [...landingDestinations.get(key)].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
    place.name += `（往 ${refs.join("／")}）`;
  }
  places.push(place);
}
const walls = [...osm.ways.values()]
  .filter(
    (w) =>
      w.tags.indoor === "wall" &&
      (scope
        ? scope.wall(`way/${w.id}`)
        : selectedSource(`way/${w.id}`) ||
          w.nodeIds.some((id) => usedNodes.has(`${id}@0`))),
  )
  .flatMap((w) =>
    (levelsOf(w.tags)?.all ?? [])
      .filter((o) => selectedLevels.has(o))
      .map((ordinal) => ({
        id: `way/${w.id}@${ordinal}`,
        buildingId: building.id,
        ordinal,
        points: w.nodeIds
          .map((id) => osm.nodes.get(id))
          .map((n) => project([n.lon, n.lat])),
        tags: w.tags,
      })),
  );
const model = {
  schemaVersion: 1,
  venueId: venue.venueId,
  name: config.name,
  source: {
    sha256,
    generatedAt: new Date().toISOString(),
    warnings: [...(config.warnings ?? []), ...selectedWarnings],
    ...(scope ? { scope: scope.counts } : {}),
  },
  origin,
  building: {
    id: building.id,
    name: building.name,
    footprint: building.footprint.map((r) => r.map(project)),
    levels: building.levels.filter((l) => selectedLevels.has(l.ordinal)),
    floorHeightM: building.floorHeightM,
    heightStatus: building.heightStatus,
    geometryStatus: building.geometryStatus,
    ...(config.photoOrientation !== undefined
      ? { photoOrientation: config.photoOrientation }
      : {}),
  },
  features,
  connections,
  nodes,
  edges: selectedEdges.map(({ source: _source, indoor: _indoor, ...e }) => ({
    ...e,
    tags: tagsOf(e.osmRef),
    heightPending: tagsOf(e.osmRef)["a11ymap:height_pending"] === "yes",
    animationPending: blockedAnimation.has(e.osmRef),
  })),
  places,
  walls,
  ...(config.photos ? { photos: config.photos } : {}),
  ...(config.preview || externalApproach
    ? {
        preview: {
          ...(config.preview ?? { levels: [...selectedLevels] }),
          ...(externalApproach
            ? { externalApproachPlaceId: externalApproach.id }
            : {}),
          gatePlaceIds: places
            .filter((p) => p.kind === "gate")
            .map((p) => p.id),
        },
      }
    : {}),
};
mkdirSync(dirname(outFile), { recursive: true });
if (
  createHash("sha256").update(readFileSync(config.osmFile)).digest("hex") !==
  sha256
)
  throw new Error(
    "Local source changed during export; output was not replaced",
  );
const tmp = `${outFile}.tmp`;
writeFileSync(tmp, JSON.stringify(model));
renameSync(tmp, outFile);
console.log(
  JSON.stringify(
    {
      output: relative(cwd, outFile),
      sha256,
      omittedBuildings: omittedBuildings.length,
      levels: model.building.levels.length,
      features: features.length,
      connections: connections.length,
      nodes: nodes.length,
      edges: model.edges.length,
      places: places.length,
      walls: walls.length,
      warnings: warnings.length,
    },
    null,
    2,
  ),
);
