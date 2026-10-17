import type {
  IndoorEdge,
  IndoorMode,
  IndoorNode,
  IndoorVerticalPreference,
  LocalIndoorModel,
} from "./types";

export function requiresElevatorOnly(mode: IndoorMode): boolean {
  return (
    mode === "wheelchair" || mode === "elderly" || mode === "visual_impaired"
  );
}

export function effectiveVerticalPreference(
  mode: IndoorMode,
  requested: IndoorVerticalPreference = "auto",
): IndoorVerticalPreference {
  return requiresElevatorOnly(mode) ? "elevator" : requested;
}

function nodeBuilding(
  model: LocalIndoorModel,
  node: IndoorNode,
): string | null {
  return node.buildingId === undefined
    ? node.levelRef === null
      ? null
      : model.building.id
    : node.buildingId;
}

function sourceSpan(edge: IndoorEdge): string {
  return edge.kind === "elevator"
    ? edge.osmRef
    : `${edge.osmRef}@${edge.id.slice(edge.id.lastIndexOf("@") + 1)}`;
}

/** Vertical policy only; wheelchair dimensions remain a separate source rule. */
export function isIndoorEdgeAllowedForProfile(
  model: LocalIndoorModel,
  edge: IndoorEdge,
  mode: IndoorMode,
  requested: IndoorVerticalPreference = "auto",
): boolean {
  const preference = effectiveVerticalPreference(mode, requested);
  if (preference === "stairs")
    return edge.kind !== "elevator" && edge.kind !== "escalator";
  if (preference !== "elevator") return true;
  if (edge.kind === "steps" || edge.kind === "escalator") return false;
  if (edge.kind === "elevator") return true;

  const from = model.nodes.find((node) => node.id === edge.from);
  const to = model.nodes.find((node) => node.id === edge.to);
  if (!from || !to) return false;
  if (
    from.levelRef !== null &&
    to.levelRef !== null &&
    from.levelRef !== to.levelRef
  )
    return false;

  const source = sourceSpan(edge);
  const connection = model.connections.find(
    (candidate) => candidate.id === source,
  );
  const related = model.edges.filter(
    (candidate) => sourceSpan(candidate) === source,
  );
  const ids = new Set(
    related.flatMap((candidate) => [candidate.from, candidate.to]),
  );
  const levels = new Set(
    [
      ...(connection?.levelRefs ?? []),
      ...model.nodes
        .filter((node) => ids.has(node.id))
        .map((node) => node.levelRef),
    ].filter((level): level is string => level !== null),
  );
  if (levels.size > 1) return false;

  // A sloping interior segment with an unassigned floor cannot establish that
  // this is same-floor access. An outdoor-to-entry ramp is deliberately exempt.
  if (
    (from.levelRef === null || to.levelRef === null) &&
    nodeBuilding(model, from) !== null &&
    nodeBuilding(model, from) === nodeBuilding(model, to) &&
    Math.abs(from.point[2] - to.point[2]) > 0.001
  )
    return false;
  return true;
}

/** Unknown intermediate levels must not erase the last known indoor floor. */
export function isIndoorTraversalAllowedForProfile(
  model: LocalIndoorModel,
  nodes: IndoorNode[],
  edges: IndoorEdge[],
  mode: IndoorMode,
  requested: IndoorVerticalPreference = "auto",
): boolean {
  if (effectiveVerticalPreference(mode, requested) !== "elevator") return true;
  const floorByBuilding = new Map<string, string>();
  for (let index = 0; index < nodes.length; index += 1) {
    if (index > 0 && edges[index - 1].kind === "elevator")
      floorByBuilding.clear();
    const node = nodes[index];
    const building = nodeBuilding(model, node);
    if (building === null || node.levelRef === null) continue;
    const previous = floorByBuilding.get(building);
    if (previous !== undefined && previous !== node.levelRef) return false;
    floorByBuilding.set(building, node.levelRef);
  }
  return true;
}
