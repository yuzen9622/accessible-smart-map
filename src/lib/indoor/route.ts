import {
  isIndoorEdgeAllowedForProfile,
  isIndoorTraversalAllowedForProfile,
  requiresElevatorOnly,
} from "./profilePolicy";
import type {
  IndoorEdge,
  IndoorMode,
  IndoorRoute,
  IndoorRouteOptions,
  IndoorRouteResult,
  IndoorRouteStep,
  IndoorStairDesign,
  LocalIndoorModel,
  XYZ,
} from "./types";

export function segmentDistance(a: XYZ, b: XYZ): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}

export function pathDistance(points: XYZ[]): number {
  return points
    .slice(1)
    .reduce((sum, p, i) => sum + segmentDistance(points[i], p), 0);
}

/**
 * Constant speed by 3D distance, without curves or corner cutting.
 * Reverse playback uses the exact same geometry and changes traversal only.
 */
export function samplePath(
  points: XYZ[],
  progress: number,
  reverse = false,
): XYZ {
  if (!points.length) throw new RangeError("A path needs at least one point");
  if (!Number.isFinite(progress))
    throw new RangeError("Path progress must be finite");
  const clamped = Math.min(1, Math.max(0, progress));
  const fraction = reverse ? 1 - clamped : clamped;
  if (fraction === 0) return [...points[0]];
  if (fraction === 1) return [...points[points.length - 1]];
  let distance = pathDistance(points) * fraction;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const length = segmentDistance(a, b);
    if (length === 0) continue;
    if (distance <= length) {
      const t = distance / length;
      return [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
      ];
    }
    distance -= length;
  }
  return [...points[points.length - 1]];
}

function allowed(
  model: LocalIndoorModel,
  edge: IndoorEdge,
  mode: IndoorMode,
  options: IndoorRouteOptions,
): boolean {
  if (
    !isIndoorEdgeAllowedForProfile(
      model,
      edge,
      mode,
      options.verticalPreference,
    )
  )
    return false;
  if (mode !== "wheelchair") return true;
  if (
    edge.kind === "steps" ||
    edge.kind === "escalator" ||
    edge.wheelchair === "no"
  )
    return false;
  // Known severe restrictions fail closed; unknown dimensions remain explicit
  // warnings, matching the source graph's distinction from surveyed access.
  if (edge.widthM !== undefined && edge.widthM < 0.9) return false;
  if (edge.slopeRatio !== undefined && edge.slopeRatio > 0.12) return false;
  return true;
}

function kindOf(edge: IndoorEdge): IndoorRouteStep["kind"] {
  return edge.ramp ? "ramp" : edge.kind;
}

function nameOf(edge: IndoorEdge): string {
  if (edge.tags.name) return edge.tags.name;
  if (edge.kind === "elevator") return "搭乘電梯";
  if (edge.kind === "steps") return "沿樓梯行進";
  if (edge.ramp) return "沿坡道行進";
  return "沿公共走廊行進";
}

/** The compiler's source identity is shared by its edges and connections. */
function connectionIdOf(
  model: LocalIndoorModel,
  edge: IndoorEdge,
): string | undefined {
  const id =
    edge.kind === "elevator"
      ? edge.osmRef
      : `${edge.osmRef}@${edge.id.slice(edge.id.lastIndexOf("@") + 1)}`;
  return model.connections.find(
    (connection) => connection.id === id && connection.osmRef === edge.osmRef,
  )?.id;
}

/** Keep graph topology immutable while displaying separately named candidates. */
function routeDisplayGeometry(
  model: LocalIndoorModel,
  points: XYZ[],
  edges: IndoorEdge[],
  levelRefs: (string | null)[],
) {
  // The array is authoritative when it includes the legacy single candidate.
  const designs = [...(model.stairDesigns ?? [])];
  if (
    model.stairDesign &&
    !designs.some((design) => design.id === model.stairDesign?.id)
  )
    designs.push(model.stairDesign);
  const samePoint = (a: XYZ, b: XYZ) => segmentDistance(a, b) < 0.000001;
  const records = designs.map((design) => {
    const connection = model.connections.find(
      (c) => c.id === design.sourceConnectionId,
    );
    // A repeated OSM way can have separate compiled spans: match the full span,
    // not merely osmRef, so adjacent floors never consume each other's edges.
    const sourceEdges = connection
      ? model.edges.filter(
          (edge) =>
            edge.kind === "steps" &&
            edge.osmRef === connection.osmRef &&
            `${edge.osmRef}@${edge.id.slice(edge.id.lastIndexOf("@") + 1)}` ===
              connection.id,
        )
      : [];
    const sourceIds = new Set(sourceEdges.map((edge) => edge.id));
    const valid = Boolean(
      connection &&
        design.sourceSha256 === model.source.sha256 &&
        design.conflicts.length === 0 &&
        connection.kind === "stairs" &&
        design.sourcePath.length === connection.coordinates.length &&
        design.sourcePath.every((point, i) =>
          samePoint(point, connection.coordinates[i]),
        ) &&
        design.animationPath.length >= 2 &&
        design.animationPath.every(
          (point) => point.length === 3 && point.every(Number.isFinite),
        ),
    );
    return { design, connection, sourceIds, valid };
  });
  const renderedPoints: XYZ[] = [[...points[0]]];
  const renderedEdges: IndoorEdge[] = [];
  const renderedLevels = [levelRefs[0]];
  const appliedDesigns: IndoorStairDesign[] = [];
  const coveredEdgeIds = new Set<string>();
  let blocked = false;
  const appendSource = (start: number, end: number) => {
    for (let index = start; index < end; index += 1) {
      renderedPoints.push([...points[index + 1]]);
      renderedEdges.push(edges[index]);
      renderedLevels.push(levelRefs[index + 1]);
    }
  };
  for (let index = 0; index < edges.length; ) {
    const matches = records.filter((record) =>
      record.sourceIds.has(edges[index].id),
    );
    if (matches.length !== 1) {
      // An ambiguous candidate must never choose a design arbitrarily.
      if (matches.length > 1) blocked = true;
      if (
        edges[index].kind === "steps" &&
        records.some((record) => !record.connection)
      )
        blocked = true;
      appendSource(index, index + 1);
      index += 1;
      continue;
    }
    const { design, sourceIds, valid } = matches[0];
    let end = index + 1;
    while (end < edges.length && sourceIds.has(edges[end].id)) end += 1;
    const runIds = new Set(edges.slice(index, end).map((edge) => edge.id));
    const complete =
      runIds.size === sourceIds.size && end - index === sourceIds.size;
    const first = design.animationPath[0];
    const last = design.animationPath[design.animationPath.length - 1];
    const forward =
      valid && samePoint(points[index], first) && samePoint(points[end], last);
    const reverse =
      valid && samePoint(points[index], last) && samePoint(points[end], first);
    if (!complete || (!forward && !reverse)) {
      appendSource(index, end);
      blocked = true;
    } else {
      const candidate = forward
        ? design.animationPath
        : [...design.animationPath].reverse();
      const displayEdge = {
        ...edges[index],
        heightPending: edges
          .slice(index, end)
          .some((edge) => edge.heightPending),
      };
      for (let vertex = 1; vertex < candidate.length; vertex += 1) {
        renderedPoints.push([...candidate[vertex]]);
        renderedEdges.push(displayEdge);
        renderedLevels.push(
          vertex === candidate.length - 1 ? levelRefs[end] : null,
        );
      }
      if (!appliedDesigns.some((applied) => applied.id === design.id))
        appliedDesigns.push(design);
      for (const id of runIds) coveredEdgeIds.add(id);
    }
    index = end;
  }
  return {
    points: renderedPoints,
    edges: renderedEdges,
    levelRefs: renderedLevels,
    blocked,
    appliedDesigns,
    coveredEdgeIds,
  };
}

/**
 * Local preview routing over the compiled graph, never room centroids.
 * No graph edges are invented. Elevator stops are exactly the compiled stops.
 */
export function planIndoorRoute(
  model: LocalIndoorModel,
  fromPlaceId: string,
  toPlaceId: string,
  mode: IndoorMode,
  options: IndoorRouteOptions = {},
): IndoorRouteResult {
  const from = model.places.find((p) => p.id === fromPlaceId);
  const to = model.places.find((p) => p.id === toPlaceId);
  if (!from || !to) return { ok: false, reason: "UNKNOWN_PLACE" };
  const nodeById = new Map(model.nodes.map((n) => [n.id, n]));
  if (!nodeById.has(from.nodeId) || !nodeById.has(to.nodeId))
    return { ok: false, reason: "NO_ROUTE" };
  const adjacency = new Map<
    string,
    { to: string; edge: IndoorEdge; cost: number }[]
  >();
  for (const edge of model.edges) {
    if (!allowed(model, edge, mode, options)) continue;
    const a = nodeById.get(edge.from);
    const b = nodeById.get(edge.to);
    if (!a || !b) continue;
    const distance = segmentDistance(a.point, b.point);
    // Elevator waiting cost makes the preview prefer walking on the same floor.
    // Geometry distance remains independent of this planning weight.
    const cost =
      edge.kind === "elevator"
        ? 30 + 3 * (edge.levelSpan ?? 1)
        : Math.max(distance, 0.001) *
          (mode === "wheelchair" && edge.wheelchair === "limited" ? 1.5 : 1);
    const aEdges = adjacency.get(edge.from) ?? [];
    aEdges.push({ to: edge.to, edge, cost });
    adjacency.set(edge.from, aEdges);
    const bEdges = adjacency.get(edge.to) ?? [];
    bEdges.push({ to: edge.from, edge, cost });
    adjacency.set(edge.to, bEdges);
  }

  const distances = new Map<string, number>([[from.nodeId, 0]]);
  const previous = new Map<string, { from: string; edge: IndoorEdge }>();
  const remaining = new Set<string>([from.nodeId]);
  const settled = new Set<string>();
  while (remaining.size) {
    let current = "";
    let cheapest = Infinity;
    for (const id of remaining) {
      const cost = distances.get(id) ?? Infinity;
      if (cost < cheapest) {
        current = id;
        cheapest = cost;
      }
    }
    if (!current) break;
    remaining.delete(current);
    settled.add(current);
    if (current === to.nodeId) break;
    for (const next of adjacency.get(current) ?? []) {
      if (settled.has(next.to)) continue;
      const cost = cheapest + next.cost;
      if (cost >= (distances.get(next.to) ?? Infinity)) continue;
      distances.set(next.to, cost);
      previous.set(next.to, { from: current, edge: next.edge });
      remaining.add(next.to);
    }
  }
  if (!settled.has(to.nodeId))
    return {
      ok: false,
      reason: requiresElevatorOnly(mode) ? "NO_ACCESSIBLE_ROUTE" : "NO_ROUTE",
    };

  const ids = [to.nodeId];
  const edges: IndoorEdge[] = [];
  while (ids[ids.length - 1] !== from.nodeId) {
    const prev = previous.get(ids[ids.length - 1]);
    if (!prev) return { ok: false, reason: "NO_ROUTE" };
    ids.push(prev.from);
    edges.push(prev.edge);
  }
  ids.reverse();
  edges.reverse();
  const nodes = ids
    .map((id) => nodeById.get(id))
    .filter((n) => n !== undefined);
  if (
    !isIndoorTraversalAllowedForProfile(
      model,
      nodes,
      edges,
      mode,
      options.verticalPreference,
    )
  )
    return {
      ok: false,
      reason: requiresElevatorOnly(mode) ? "NO_ACCESSIBLE_ROUTE" : "NO_ROUTE",
    };
  const display = routeDisplayGeometry(
    model,
    nodes.map((n): XYZ => [...n.point]),
    edges,
    nodes.map((n) => n.levelRef),
  );
  const points = display.points;
  const steps: IndoorRouteStep[] = [];
  const warnings = new Set<string>();
  let lastSource: string | undefined;
  display.edges.forEach((edge, i) => {
    const kind = kindOf(edge);
    const connectionId = connectionIdOf(model, edge);
    const sourceSpan = `${edge.osmRef}@${edge.id.slice(edge.id.lastIndexOf("@") + 1)}`;
    const distanceM = segmentDistance(points[i], points[i + 1]);
    const prevStep = steps[steps.length - 1];
    if (
      prevStep &&
      prevStep.kind === kind &&
      lastSource === sourceSpan &&
      prevStep.connectionId === connectionId
    ) {
      prevStep.distanceM += distanceM;
      prevStep.toLevel = display.levelRefs[i + 1];
      prevStep.endIndex = i + 1;
      prevStep.heightPending ||= edge.heightPending;
    } else {
      steps.push({
        kind,
        name: nameOf(edge),
        fromLevel: display.levelRefs[i],
        toLevel: display.levelRefs[i + 1],
        distanceM,
        startIndex: i,
        endIndex: i + 1,
        heightPending: edge.heightPending,
        ...(connectionId ? { connectionId } : {}),
      });
    }
    lastSource = sourceSpan;
  });
  // Restrictions belong to original source edges, even when one candidate
  // display segment represents several source edges.
  for (const edge of edges) {
    const kind = kindOf(edge);
    if (edge.heightPending)
      warnings.add("路段高差待量測；平面連通可參考，暫停此路線的3D動畫。");
    if (edge.animationPending && !display.coveredEdgeIds.has(edge.id))
      warnings.add("路線包含尚未建立或確認實體通路／樓板的路段，暫停3D動畫。");
    if (
      edge.heightStatus === "estimated" &&
      (kind === "steps" || kind === "elevator" || kind === "ramp")
    )
      warnings.add("垂直路段高度為估計值，並非現場實測。");
    if (
      mode === "wheelchair" &&
      (edge.wheelchair === "unknown" ||
        edge.wheelchair === "limited" ||
        (edge.ramp &&
          (edge.widthM === undefined || edge.slopeRatio === undefined)))
    )
      warnings.add("部分通路的淨寬、坡度或輪椅通行條件仍待確認。");
  }
  if (from.arrivalOnly || to.arrivalOnly)
    warnings.add(
      "房間路線停在已描繪的走廊到達點；房門位置尚未確認，不表示已進入房內。",
    );
  for (const design of display.appliedDesigns)
    warnings.add(
      `樓梯路段採用「${design.name}」研究假設版，並非現場實測；原始路網與來源座標未修改。`,
    );
  if (display.blocked)
    warnings.add(
      "研究假設版無法完整對應這段樓梯的來源路徑與端點，保留來源路線並暫停3D動畫。",
    );
  const missingPhysicalStairs =
    model.preview?.requirePhysicalStairs &&
    edges.some(
      (edge) => edge.kind === "steps" && !display.coveredEdgeIds.has(edge.id),
    );
  if (missingPhysicalStairs)
    warnings.add(
      "路線包含尚未建立實體踏面的樓梯；可查看來源路線，暫停3D行進動畫。",
    );
  const route: IndoorRoute = {
    ok: true,
    fromPlaceId,
    toPlaceId,
    points,
    kinds: display.edges.map(kindOf),
    steps,
    distanceM: pathDistance(points),
    animationSafe:
      !display.blocked &&
      !missingPhysicalStairs &&
      !edges.some(
        (e) =>
          e.heightPending ||
          (e.animationPending && !display.coveredEdgeIds.has(e.id)),
      ),
    warnings: [...warnings],
    edgeIds: edges.map((e) => e.id),
    ...(display.appliedDesigns.length
      ? {
          researchCandidateId: display.appliedDesigns[0].id,
          researchCandidateIds: display.appliedDesigns.map(
            (design) => design.id,
          ),
        }
      : {}),
  };
  return route;
}
