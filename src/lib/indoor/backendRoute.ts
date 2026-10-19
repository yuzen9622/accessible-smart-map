import { ApiError, fetchRequest } from "@/lib/fetch";
import type { VenuePlaceDetail } from "@/types";
import { indoorModelVersion } from "./catalog";
import { lngLatToLocal } from "./coordinates";
import {
  isIndoorEdgeAllowedForProfile,
  isIndoorTraversalAllowedForProfile,
  requiresElevatorOnly,
} from "./profilePolicy";
import type {
  IndoorEdge,
  IndoorFeature,
  IndoorMode,
  IndoorNode,
  IndoorRoute,
  IndoorRouteStep,
  IndoorVerticalPreference,
  LocalIndoorModel,
  XY,
  XYZ,
} from "./types";
import {
  loadVenueCatalog,
  officialRoute,
  type VenueRouteResponse,
  validateVenueDetail,
  venueModels,
} from "./venueApi";

export interface BackendRouteProvenance {
  provider: "api";
  baseUrl: string;
  venueId: string;
  venueVersion: number;
  importedAt: string;
  /** Local semantic overlay revision, not the backend's numeric import version. */
  localSourceSha256: string;
}

export interface BackendVenueDetail {
  venueId: string;
  version: number;
  importedAt: string;
  buildings: {
    id: string;
    footprint: XY[][];
    levels: { ordinal: number; ref: string; elevationM: number }[];
  }[];
  places: {
    id: string;
    buildingId: string | null;
    levelRef: string | null;
    nodeId: string;
    arrivalNodeIds?: string[];
    location: XY;
  }[];
  features: Pick<
    IndoorFeature,
    "id" | "kind" | "buildingId" | "levelRef" | "ordinal" | "geometry"
  >[];
  connections: {
    id: string;
    kind: string;
    buildingId: string | null;
    coordinates: XYZ[];
    levelRefs: (string | null)[];
    wheelchair: string;
  }[];
}

export interface BackendVenueRoute {
  venueId: string;
  venueVersion: number;
  mode: IndoorMode;
  fromPlaceId: string;
  toPlaceId: string;
  distanceM: number;
  path: {
    coordinates: XYZ[];
    buildingIds: (string | null)[];
    levelRefs: (string | null)[];
  };
  steps: { type: string; pathStart: number; pathEnd: number }[];
}

export type BackendVenueRouteResult =
  | {
      ok: true;
      route: IndoorRoute;
      provenance: BackendRouteProvenance;
    }
  | {
      ok: false;
      reason: string;
      message: string;
      refreshedModels?: LocalIndoorModel[];
    };

export interface BackendVenueRouteOptions {
  baseUrl: string;
  model: LocalIndoorModel;
  from: VenuePlaceDetail;
  to: VenuePlaceDetail;
  mode: IndoorMode;
  verticalPreference?: IndoorVerticalPreference;
  language?: "zh-TW" | "en";
  signal?: AbortSignal;
}

class IncompatibleRoute extends Error {
  constructor(
    public reason: string,
    message: string,
  ) {
    super(message);
  }
}
function requireMatch(
  value: unknown,
  reason: string,
  message: string,
): asserts value {
  if (!value) throw new IncompatibleRoute(reason, message);
}
const geometryMessage =
  "後端場域與目前地圖的來源幾何不一致，請重新載入資料後再規劃。";
const pathMessage =
  "後端路線無法唯一對應目前的來源通路，暫不顯示可能錯接的路線。";

function localXY(model: LocalIndoorModel, point: XY): XY {
  requireMatch(
    Array.isArray(point) && point.length === 2 && point.every(Number.isFinite),
    "INVALID_BACKEND_DATA",
    geometryMessage,
  );
  return lngLatToLocal(point, model.origin);
}
function sameXY(a: XY, b: XY): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) <= 0.001;
}
function sameRings(
  model: LocalIndoorModel,
  source: XY[][],
  geographic: XY[][],
): boolean {
  return (
    Array.isArray(geographic) &&
    source.length === geographic.length &&
    source.every(
      (ring, i) =>
        Array.isArray(geographic[i]) &&
        ring.length === geographic[i].length &&
        ring.every((point, j) =>
          sameXY(point, localXY(model, geographic[i][j])),
        ),
    )
  );
}
function buildingId(
  model: LocalIndoorModel,
  value: { buildingId?: string | null; levelRef: string | null },
): string | null {
  return value.buildingId === undefined
    ? value.levelRef === null
      ? null
      : model.building.id
    : value.buildingId;
}

function edgeSource(edge: IndoorEdge): string {
  return edge.kind === "elevator"
    ? edge.osmRef
    : `${edge.osmRef}@${edge.id.slice(edge.id.lastIndexOf("@") + 1)}`;
}

function matchesConnectionBuilding(
  model: LocalIndoorModel,
  connection: LocalIndoorModel["connections"][number],
  apiBuildingId: string | null,
): boolean {
  const localBuildingId =
    connection.buildingId === undefined
      ? model.building.id
      : connection.buildingId;
  if (apiBuildingId === localBuildingId) return true;
  // The backend groups a boundary connection under its first non-null node's
  // building. The local exporter uses null for mixed indoor/outdoor chains.
  // Permit only that exact, source-node-proven distinction; path node context
  // is still checked independently for every returned point below.
  if (localBuildingId !== null || apiBuildingId === null) return false;
  const nodeIds = new Set(
    model.edges
      .filter((edge) => edgeSource(edge) === connection.id)
      .flatMap((edge) => [edge.from, edge.to]),
  );
  const nodes = model.nodes.filter((node) => nodeIds.has(node.id));
  if (nodes.length !== nodeIds.size) return false;
  const contexts = new Set(nodes.map((node) => buildingId(model, node)));
  return (
    contexts.size === 2 && contexts.has(null) && contexts.has(apiBuildingId)
  );
}

function validateEndpoints(options: BackendVenueRouteOptions) {
  const { model } = options;
  for (const endpoint of [options.from, options.to]) {
    const locals = model.places.filter(
      (place) => place.id === endpoint.placeId,
    );
    requireMatch(
      endpoint.venueId === model.venueId &&
        endpoint.sourceVersion === indoorModelVersion(model) &&
        locals.length === 1,
      "STALE_SOURCE",
      geometryMessage,
    );
    const place = locals[0];
    requireMatch(
      endpoint.buildingId === buildingId(model, place) &&
        endpoint.levelRef === place.levelRef &&
        sameXY(
          [place.point[0], place.point[1]],
          localXY(model, [endpoint.position.lng, endpoint.position.lat]),
        ),
      "STALE_SOURCE",
      geometryMessage,
    );
  }
}

function validateDetail(
  options: BackendVenueRouteOptions,
  detail: BackendVenueDetail,
) {
  const { model, from, to } = options;
  requireMatch(
    detail &&
      detail.venueId === model.venueId &&
      Number.isInteger(detail.version) &&
      detail.version > 0 &&
      typeof detail.importedAt === "string" &&
      Array.isArray(detail.buildings) &&
      Array.isArray(detail.places) &&
      Array.isArray(detail.features) &&
      Array.isArray(detail.connections),
    "INVALID_BACKEND_DATA",
    geometryMessage,
  );
  const buildings = detail.buildings.filter(
    (candidate) => candidate.id === model.building.id,
  );
  requireMatch(buildings.length === 1, "SOURCE_MISMATCH", geometryMessage);
  const building = buildings[0];
  requireMatch(
    sameRings(model, model.building.footprint, building.footprint) &&
      Array.isArray(building.levels) &&
      building.levels.length === model.building.levels.length &&
      model.building.levels.every((level) => {
        const matches = building.levels.filter(
          (other) =>
            other.ordinal === level.ordinal &&
            other.ref === level.ref &&
            Math.abs(other.elevationM - level.elevationM) <= 0.001,
        );
        return matches.length === 1;
      }),
    "SOURCE_MISMATCH",
    geometryMessage,
  );
  for (const endpoint of [from, to]) {
    const place = model.places.find((place) => place.id === endpoint.placeId);
    requireMatch(place, "STALE_SOURCE", geometryMessage);
    const matches = detail.places.filter((other) => other.id === place.id);
    requireMatch(
      matches.length === 1,
      "UNSUPPORTED_API_PLACE",
      "這個電梯、樓梯或館外接點尚未列入後端可規劃地點，請選擇後端已提供的教室或校門。",
    );
    const other = matches[0];
    const arrivals = place.arrivalNodeIds ?? [place.nodeId];
    const otherArrivals = other.arrivalNodeIds ?? [other.nodeId];
    requireMatch(
      arrivals.length > 0 &&
        arrivals.length <= 16 &&
        new Set(arrivals).size === arrivals.length &&
        arrivals.includes(place.nodeId) &&
        Array.isArray(otherArrivals) &&
        otherArrivals.length === arrivals.length &&
        arrivals.every((id) => otherArrivals.includes(id)) &&
        (!place.arrivalNodeIds ||
          arrivals.every((id) => {
            const nodes = model.nodes.filter((node) => node.id === id);
            return (
              nodes.length === 1 &&
              buildingId(model, nodes[0]) === buildingId(model, place) &&
              nodes[0].levelRef === place.levelRef
            );
          })),
      "SOURCE_MISMATCH",
      geometryMessage,
    );
    requireMatch(
      other.nodeId === place.nodeId &&
        other.buildingId === endpoint.buildingId &&
        other.levelRef === place.levelRef &&
        sameXY(
          [place.point[0], place.point[1]],
          localXY(model, other.location),
        ),
      "SOURCE_MISMATCH",
      geometryMessage,
    );
  }
  for (const feature of model.features) {
    const matches = detail.features.filter((other) => other.id === feature.id);
    requireMatch(matches.length === 1, "SOURCE_MISMATCH", geometryMessage);
    const other = matches[0];
    requireMatch(
      other.kind === feature.kind &&
        other.buildingId === buildingId(model, feature) &&
        other.levelRef === feature.levelRef &&
        other.ordinal === feature.ordinal &&
        other.geometry?.type === feature.geometry.type,
      "SOURCE_MISMATCH",
      geometryMessage,
    );
    const same =
      feature.geometry.type === "Polygon" && other.geometry.type === "Polygon"
        ? sameRings(
            model,
            feature.geometry.coordinates,
            other.geometry.coordinates,
          )
        : feature.geometry.type === "Point" &&
          other.geometry.type === "Point" &&
          sameXY(
            feature.geometry.coordinates,
            localXY(model, other.geometry.coordinates),
          );
    requireMatch(same, "SOURCE_MISMATCH", geometryMessage);
  }
  for (const connection of model.connections) {
    const matches = detail.connections.filter(
      (other) => other.id === connection.id,
    );
    requireMatch(matches.length === 1, "SOURCE_MISMATCH", geometryMessage);
    const other = matches[0];
    requireMatch(
      other.kind === connection.kind &&
        matchesConnectionBuilding(model, connection, other.buildingId) &&
        other.wheelchair === connection.wheelchair &&
        Array.isArray(other.coordinates) &&
        other.coordinates.length === connection.coordinates.length &&
        Array.isArray(other.levelRefs) &&
        other.levelRefs.length === connection.levelRefs.length &&
        connection.levelRefs.every((ref, i) => ref === other.levelRefs[i]) &&
        connection.coordinates.every((point, i) => {
          const p = other.coordinates[i];
          return (
            Array.isArray(p) &&
            p.length === 3 &&
            p.every(Number.isFinite) &&
            sameXY([point[0], point[1]], localXY(model, [p[0], p[1]])) &&
            Math.abs(point[2] - p[2]) <= 0.001
          );
        }),
      "SOURCE_MISMATCH",
      geometryMessage,
    );
  }
}

function routeFromBackend(
  options: BackendVenueRouteOptions,
  detail: BackendVenueDetail,
  response: BackendVenueRoute,
): IndoorRoute {
  const { model, from, to, mode } = options;
  requireMatch(
    response?.venueId === model.venueId &&
      response.venueVersion === detail.version &&
      response.mode === mode &&
      response.fromPlaceId === from.placeId &&
      response.toPlaceId === to.placeId,
    "STALE_BACKEND_ROUTE",
    "後端回傳了不同版本或起終點的路線，請重新規劃。",
  );
  const path = response.path;
  requireMatch(
    path &&
      Array.isArray(path.coordinates) &&
      path.coordinates.length > 0 &&
      Array.isArray(path.buildingIds) &&
      Array.isArray(path.levelRefs) &&
      path.buildingIds.length === path.coordinates.length &&
      path.levelRefs.length === path.coordinates.length &&
      Array.isArray(response.steps) &&
      Number.isFinite(response.distanceM) &&
      response.distanceM >= 0,
    "INVALID_BACKEND_DATA",
    pathMessage,
  );
  const points: XYZ[] = path.coordinates.map((point) => {
    requireMatch(
      Array.isArray(point) &&
        point.length === 3 &&
        point.every(Number.isFinite),
      "INVALID_BACKEND_DATA",
      pathMessage,
    );
    return [...localXY(model, [point[0], point[1]]), point[2]];
  });
  const nodes: IndoorNode[] = points.map((point, index) => {
    const matches = model.nodes.filter(
      (node) =>
        buildingId(model, node) === path.buildingIds[index] &&
        node.levelRef === path.levelRefs[index] &&
        sameXY([node.point[0], node.point[1]], [point[0], point[1]]) &&
        Math.abs(node.point[2] - point[2]) <= 0.0051,
    );
    // API Z is rounded to centimetres. XY uses only sub-millimetre conversion
    // tolerance; this is never a nearest-node snap or a synthesized connector.
    requireMatch(matches.length === 1, "UNMATCHED_BACKEND_PATH", pathMessage);
    return matches[0];
  });
  const endpointPairs: [string, IndoorNode][] = [
    [from.placeId, nodes[0]],
    [to.placeId, nodes[nodes.length - 1]],
  ];
  requireMatch(
    endpointPairs.every(([id, node]) => {
      const place = model.places.find((candidate) => candidate.id === id);
      return (
        place &&
        (place.arrivalNodeIds ?? [place.nodeId]).includes(node.id) &&
        buildingId(model, place) === buildingId(model, node) &&
        place.levelRef === node.levelRef
      );
    }),
    "UNMATCHED_BACKEND_PATH",
    pathMessage,
  );
  requireMatch(
    response.steps.every(
      (step) =>
        Number.isInteger(step.pathStart) &&
        Number.isInteger(step.pathEnd) &&
        step.pathStart >= 0 &&
        step.pathEnd >= step.pathStart &&
        step.pathEnd < nodes.length,
    ),
    "INVALID_BACKEND_DATA",
    pathMessage,
  );
  const edges: IndoorEdge[] = nodes.slice(1).map((node, index) => {
    const previous = nodes[index];
    const matches = model.edges.filter(
      (edge) =>
        (edge.from === previous.id && edge.to === node.id) ||
        (edge.to === previous.id && edge.from === node.id),
    );
    requireMatch(matches.length === 1, "UNMATCHED_BACKEND_PATH", pathMessage);
    const edge = matches[0];
    requireMatch(
      mode !== "wheelchair" ||
        (edge.kind !== "steps" &&
          edge.kind !== "escalator" &&
          edge.wheelchair !== "no" &&
          !(edge.widthM !== undefined && edge.widthM < 0.9) &&
          !(edge.slopeRatio !== undefined && edge.slopeRatio > 0.12)),
      "NO_ACCESSIBLE_ROUTE",
      "後端路線不符合目前來源的輪椅通行限制，未發布此行程。",
    );
    if (edge.kind === "elevator") {
      const connection = model.connections.find(
        (candidate) =>
          candidate.id === edge.osmRef && candidate.kind === "elevator",
      );
      requireMatch(
        connection &&
          previous.levelRef !== null &&
          node.levelRef !== null &&
          connection.levelRefs.includes(previous.levelRef) &&
          connection.levelRefs.includes(node.levelRef),
        "INVALID_ELEVATOR_STOP",
        "後端電梯路線包含未確認的停靠樓層，未發布此行程。",
      );
    }
    return edge;
  });
  requireMatch(
    edges.every((edge) =>
      isIndoorEdgeAllowedForProfile(
        model,
        edge,
        mode,
        options.verticalPreference,
      ),
    ) &&
      isIndoorTraversalAllowedForProfile(
        model,
        nodes,
        edges,
        mode,
        options.verticalPreference,
      ),
    requiresElevatorOnly(mode)
      ? "NO_ACCESSIBLE_ROUTE"
      : "UNSUPPORTED_PREFERENCE",
    requiresElevatorOnly(mode)
      ? "目前服務回傳的路線不符合無障礙模式；跨樓層只能搭乘電梯，請選擇其他起終點後再規劃。"
      : "目前服務回傳的路線不符合指定移動方式，請改選自動或其他起終點後再規劃。",
  );
  const warnings = new Set<string>();
  const steps: IndoorRouteStep[] = [];
  let priorSource: string | undefined;
  for (const [index, edge] of edges.entries()) {
    const kind = edge.ramp ? "ramp" : edge.kind;
    const source = edgeSource(edge);
    const connectionId = model.connections.find(
      (connection) => connection.id === source,
    )?.id;
    const name =
      edge.tags.name ??
      (kind === "elevator"
        ? "電梯"
        : kind === "steps"
          ? "樓梯"
          : kind === "ramp"
            ? "坡道"
            : "公共通路");
    const distanceM = edge.kind === "elevator" ? 0 : edge.lengthM;
    const previous = steps.at(-1);
    if (
      previous &&
      priorSource === source &&
      previous.kind === kind &&
      previous.connectionId === connectionId
    ) {
      previous.endIndex = index + 1;
      previous.toLevel = nodes[index + 1].levelRef;
      previous.distanceM += distanceM;
      previous.heightPending ||= edge.heightPending;
    } else
      steps.push({
        kind,
        name,
        fromLevel: nodes[index].levelRef,
        toLevel: nodes[index + 1].levelRef,
        distanceM,
        startIndex: index,
        endIndex: index + 1,
        heightPending: edge.heightPending,
        ...(connectionId ? { connectionId } : {}),
      });
    priorSource = source;
    if (edge.heightPending)
      warnings.add(
        "路段高差待確認；不能從編譯後同高程判斷上下坡，暫停行進動畫。",
      );
    if (edge.animationPending)
      warnings.add("路線包含尚未確認實體通路或樓板的路段，暫停行進動畫。");
    if (
      edge.heightStatus === "estimated" &&
      ["steps", "elevator", "ramp"].includes(kind)
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
  const usesStairs = edges.some((edge) => edge.kind === "steps");
  if (usesStairs)
    warnings.add(
      "樓梯保留後端選定的來源中心線；尚未套用已確認的展示幾何，暫停行進動畫。",
    );
  if (
    [from, to].some(
      (endpoint) =>
        model.places.find((place) => place.id === endpoint.placeId)
          ?.arrivalOnly,
    )
  )
    warnings.add(
      "房間路線停在來源走廊到達點；房門位置尚未確認，不表示已進入房內。",
    );
  return {
    ok: true,
    fromPlaceId: from.placeId,
    toPlaceId: to.placeId,
    points,
    kinds: edges.map((edge) => (edge.ramp ? "ramp" : edge.kind)),
    steps,
    distanceM: response.distanceM,
    animationSafe:
      !usesStairs &&
      !edges.some((edge) => edge.heightPending || edge.animationPending),
    warnings: [...warnings],
    edgeIds: edges.map((edge) => edge.id),
  };
}

/** Backend selects the entire traversal. Local data only validates and restores
 * authoring semantics omitted by that API; it never replans a failed response. */
export async function planBackendVenueRoute(
  options: BackendVenueRouteOptions,
): Promise<BackendVenueRouteResult> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  let timedOut = false;
  let refreshedModels: LocalIndoorModel[] | undefined;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 15_000);
  try {
    // Published endpoints are validated after fetching the current version, so
    // a stale catalog can be refreshed before an explicit, bounded retry.
    if (!options.model.api) validateEndpoints(options);
    requireMatch(!controller.signal.aborted, "ABORTED", "已取消這次規劃。");
    const baseUrl = options.baseUrl.replace(/\/$/, "");
    const url = `${baseUrl}/api/v1/a11y/venues/${encodeURIComponent(options.model.venueId)}`;
    const detailResponse = await fetchRequest(url, {
      signal: controller.signal,
    });
    requireMatch(
      detailResponse.ok && detailResponse.data,
      "BACKEND_UNAVAILABLE",
      "目前無法載入室內後端資料，起終點已保留。",
    );
    const detail = detailResponse.data as BackendVenueDetail;
    const published = options.model.api
      ? validateVenueDetail(detailResponse.data)
      : undefined;
    if (published) {
      if (
        published.version !== options.model.api?.version ||
        [options.from, options.to].some(
          (endpoint) =>
            endpoint.sourceVersion !== indoorModelVersion(options.model),
        )
      ) {
        refreshedModels = venueModels(published);
        throw new IncompatibleRoute(
          "VENUE_VERSION_CHANGED",
          "場域圖資已更新，請重新載入後規劃。",
        );
      }
      requireMatch(
        published.sourceSha256 === options.model.api?.sourceSha256,
        "SOURCE_MISMATCH",
        "同一圖資版本的來源內容已改變，請確認服務資料版本。",
      );
      validateEndpoints(options);
    } else validateDetail(options, detail);
    const routeResponse = await fetchRequest(`${url}/route`, {
      method: "POST",
      signal: controller.signal,
      body: {
        fromPlaceId: options.from.placeId,
        toPlaceId: options.to.placeId,
        mode: options.mode,
        language: options.language ?? "zh-TW",
      },
    });
    requireMatch(
      routeResponse.ok && routeResponse.data,
      "BACKEND_UNAVAILABLE",
      "目前無法取得室內後端路線，起終點已保留。",
    );
    requireMatch(!controller.signal.aborted, "ABORTED", "已取消這次規劃。");
    return {
      ok: true,
      route: published
        ? officialRoute(
            published,
            routeResponse.data as VenueRouteResponse,
            options.from.placeId,
            options.to.placeId,
            options.mode,
            options.language,
            options.verticalPreference,
          )
        : routeFromBackend(
            options,
            detail,
            routeResponse.data as BackendVenueRoute,
          ),
      provenance: {
        provider: "api",
        baseUrl,
        venueId: detail.venueId,
        venueVersion: detail.version,
        importedAt: detail.importedAt,
        localSourceSha256: options.model.source.sha256,
      },
    };
  } catch (error) {
    if (options.signal?.aborted)
      return {
        ok: false,
        reason: "ABORTED",
        message: "已取消這次規劃，起終點已保留。",
      };
    if (timedOut)
      return {
        ok: false,
        reason: "BACKEND_TIMEOUT",
        message: "室內路線服務超過 15 秒未回應，起終點已保留，請稍後重試。",
      };
    if (error instanceof IncompatibleRoute)
      return {
        ok: false,
        reason: error.reason,
        message: error.message,
        ...(refreshedModels ? { refreshedModels } : {}),
      };
    if (error instanceof ApiError && error.reason === "VENUE_VERSION_CHANGED") {
      try {
        refreshedModels = await loadVenueCatalog(
          options.baseUrl,
          controller.signal,
        );
      } catch {
        /* Preserve the original version error. */
      }
      return {
        ok: false,
        reason: error.reason,
        message: error.message,
        ...(refreshedModels ? { refreshedModels } : {}),
      };
    }
    if (
      error instanceof ApiError &&
      (error.reason === "NO_ROUTE" || error.reason === "NO_ACCESSIBLE_ROUTE")
    )
      return {
        ok: false,
        reason: error.reason,
        message:
          error.reason === "NO_ACCESSIBLE_ROUTE"
            ? "後端目前找不到符合輪椅條件的室內通路，起終點已保留。"
            : "後端目前找不到連通這兩個地點的通路，起終點已保留。",
      };
    if (error instanceof ApiError && error.code === 404) {
      if (options.model.api) {
        try {
          refreshedModels = await loadVenueCatalog(
            options.baseUrl,
            controller.signal,
          );
        } catch {
          /* The missing endpoint remains unavailable. */
        }
      }
      return {
        ok: false,
        reason: "UNSUPPORTED_API_PLACE",
        message: "後端尚未提供這個場域或地點，請更新資料或選擇其他地點。",
        ...(refreshedModels ? { refreshedModels } : {}),
      };
    }
    if (error instanceof ApiError && error.reason === "INVALID_BACKEND_DATA")
      return { ok: false, reason: error.reason, message: error.message };
    return {
      ok: false,
      reason: "BACKEND_UNAVAILABLE",
      message: "室內路線服務目前無法使用，起終點與選項已保留，請稍後再試。",
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}
