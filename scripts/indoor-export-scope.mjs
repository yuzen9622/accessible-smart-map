const sourceRef = /^(node|way|relation)\/-?\d+$/;

/** Explicit private source allowlists avoid treating a shared outer footprint
 * as proof that every interior feature belongs to the selected building. */
export function createExportScope(scope, hasSource) {
  if (scope === undefined) return null;
  if (!scope || typeof scope !== "object" || Array.isArray(scope))
    throw new Error("Invalid local export scope");
  const allowedKeys = ["featureRefs", "edgeRefs", "placeNodeRefs", "wallRefs"];
  if (Object.keys(scope).some((key) => !allowedKeys.includes(key)))
    throw new Error("Unknown local export scope field");
  const sets = Object.fromEntries(
    allowedKeys.map((key) => {
      const entries = scope[key];
      if (!Array.isArray(entries)) throw new Error(`Scope requires ${key}`);
      for (const ref of entries) {
        if (
          typeof ref !== "string" ||
          !sourceRef.test(ref) ||
          (key === "placeNodeRefs" && !ref.startsWith("node/")) ||
          !hasSource(ref)
        )
          throw new Error(
            `Invalid or missing source reference in ${key}: ${ref}`,
          );
      }
      if (new Set(entries).size !== entries.length)
        throw new Error(`Duplicate source reference in ${key}`);
      return [key, new Set(entries)];
    }),
  );
  const includes = (key, ref) => sets[key].has(ref.split("@")[0]);
  return {
    feature: (ref) => includes("featureRefs", ref),
    edge: (ref) => includes("edgeRefs", ref),
    placeNode: (id) => includes("placeNodeRefs", `node/${id}`),
    wall: (ref) => includes("wallRefs", ref),
    counts: Object.fromEntries(allowedKeys.map((key) => [key, sets[key].size])),
  };
}

/** A compiler may give an outdoor path ordinal zero; it remains outdoors. */
export function exportedLevelRef(node, levelRefOf) {
  return node.buildingId === null || node.ordinal === null
    ? null
    : levelRefOf(node.ordinal);
}
