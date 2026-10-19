function requireString(value, field) {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`Invalid local label override: ${field}`);
}

function requireKeys(value, allowed, field) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    throw new Error(`Invalid local label override: ${field}`);
}

function labelTags(tags, label) {
  return {
    ...tags,
    "a11ymap:original_name": tags["a11ymap:original_name"] ?? tags.name ?? "",
    "a11ymap:original_ref": tags["a11ymap:original_ref"] ?? tags.ref ?? "",
    "a11ymap:local_label_override": "source-hash-guarded",
    name: label.name,
    ref: label.ref,
  };
}

/**
 * Apply private, source-guarded presentation corrections to an in-memory copy.
 * This deliberately cannot change IDs, coordinates, stops, access or topology.
 * A stale/malformed override fails closed instead of silently serving old labels.
 */
export function applyIndoorLabelOverrides(model, overrides) {
  requireKeys(
    overrides,
    ["schemaVersion", "sourceSha256", "note", "connectionLabels"],
    "manifest",
  );
  requireString(overrides.sourceSha256, "sourceSha256");
  requireString(overrides.note, "note");
  if (
    overrides.schemaVersion !== 1 ||
    overrides.sourceSha256 !== model.source.sha256 ||
    !Array.isArray(overrides.connectionLabels)
  )
    throw new Error("Local label override source/schema mismatch");
  const output = structuredClone(model);
  const seen = new Set();
  for (const patch of overrides.connectionLabels) {
    requireKeys(patch, ["connectionId", "expected", "label"], "connection");
    requireString(patch.connectionId, "connectionId");
    requireKeys(
      patch.expected,
      ["name", "ref", "levelRefs", "featureName"],
      "expected",
    );
    requireKeys(patch.label, ["name", "ref", "featureName"], "label");
    for (const group of [patch.expected, patch.label])
      for (const field of ["name", "ref", "featureName"])
        requireString(group[field], field);
    if (
      seen.has(patch.connectionId) ||
      !Array.isArray(patch.expected.levelRefs) ||
      patch.expected.levelRefs.some((level) => typeof level !== "string")
    )
      throw new Error("Duplicate/invalid local label override connection");
    seen.add(patch.connectionId);
    const connections = output.connections.filter(
      (connection) => connection.id === patch.connectionId,
    );
    const connection = connections[0];
    if (
      connections.length !== 1 ||
      connection.name !== patch.expected.name ||
      connection.tags.name !== patch.expected.name ||
      connection.tags.ref !== patch.expected.ref ||
      JSON.stringify(connection.levelRefs) !==
        JSON.stringify(patch.expected.levelRefs)
    )
      throw new Error("Local label override connection guard failed");
    connection.name = patch.label.name;
    connection.tags = labelTags(connection.tags, patch.label);

    for (const feature of output.features.filter(
      (entry) => entry.connectionId === patch.connectionId,
    )) {
      if (
        feature.name !== patch.expected.featureName ||
        feature.tags.name !== patch.expected.featureName
      )
        throw new Error("Local label override feature guard failed");
      feature.name = patch.label.featureName;
      if (feature.ref !== undefined) feature.ref = patch.label.ref;
      feature.tags = labelTags(feature.tags, {
        ...patch.label,
        name: patch.label.featureName,
      });
    }
    for (const place of output.places.filter(
      (entry) =>
        entry.connectionId === patch.connectionId ||
        entry.connectionIds?.includes(patch.connectionId),
    )) {
      const suffix = place.levelRef ? ` · ${place.levelRef}` : "";
      if (
        place.name !== `${patch.expected.name}${suffix}` ||
        place.tags.name !== patch.expected.name ||
        place.ref !== patch.expected.ref
      )
        throw new Error("Local label override place guard failed");
      place.name = `${patch.label.name}${suffix}`;
      place.ref = patch.label.ref;
      place.tags = labelTags(place.tags, patch.label);
    }
    for (const edge of output.edges.filter(
      (entry) => entry.osmRef === connection.osmRef,
    )) {
      if (
        edge.tags.name !== patch.expected.name ||
        edge.tags.ref !== patch.expected.ref
      )
        throw new Error("Local label override edge guard failed");
      edge.tags = labelTags(edge.tags, patch.label);
    }
  }
  output.source.warnings = [
    ...output.source.warnings,
    `本機標籤更正：${overrides.note}`,
  ];
  return output;
}
