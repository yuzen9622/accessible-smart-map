import type {
  BusArrivalItem,
  RouteDetailDirection,
  RouteDetailStop,
} from "@/lib/api/transit";
import type { LiveBus } from "@/types/route";
import type { BusStopSearchResult } from "@/types/transit";

export const TRACKING_FRESH_MS = 45_000;
export interface TrackingTarget {
  routeName: string;
  city: string;
  detail: RouteDetailDirection;
  boarding: number;
}
export interface TrackingSnapshot {
  receivedAt: number;
  arrival: BusArrivalItem | null;
  buses: LiveBus[];
}
export function resolveOrigin(
  details: RouteDetailDirection[],
  origin: BusStopSearchResult,
) {
  const matches = details.flatMap((detail) => {
    if (detail.direction === 255) return [];
    return detail.stops.flatMap((stop, index) => {
      const identity =
        stop.stopUid && origin.stopUid
          ? stop.stopUid === origin.stopUid
          : stop.name === origin.stopName;
      const coordinates =
        Math.abs(stop.lng - origin.coordinates[0]) < 0.0001 &&
        Math.abs(stop.lat - origin.coordinates[1]) < 0.0001;
      if (!identity || stop.name !== origin.stopName || !coordinates) return [];
      return [{ detail, index }];
    });
  });
  return matches.length === 1 ? matches[0] : null;
}
/** Use raw details: UI option deduplication can hide conflicting stop axes. */
export function hasUniqueTrackingBranch(
  details: RouteDetailDirection[],
  selected: RouteDetailDirection,
) {
  if (selected.direction === 255) return false;
  const geometry = (detail: RouteDetailDirection) =>
    JSON.stringify(
      detail.stops.map((s) => [s.stopUid ?? null, s.seq, s.name, s.lat, s.lng]),
    );
  const axes = new Set(
    details
      .filter(
        (detail) =>
          detail.direction === selected.direction &&
          (selected.subRouteUid
            ? detail.subRouteUid === selected.subRouteUid
            : !detail.subRouteUid &&
              detail.subRouteName === selected.subRouteName),
      )
      .map(geometry),
  );
  return axes.size === 1 && axes.has(geometry(selected));
}
export function rideCount(
  boarding: number,
  alighting: number,
  stops: RouteDetailStop[],
) {
  return Number.isInteger(boarding) &&
    Number.isInteger(alighting) &&
    boarding >= 0 &&
    alighting > boarding &&
    alighting < stops.length
    ? alighting - boarding
    : null;
}
function branchMatches(
  detail: RouteDetailDirection,
  item: { subRouteUid?: string; subRouteName?: string },
) {
  if (detail.subRouteUid) return item.subRouteUid === detail.subRouteUid;
  if (detail.subRouteName)
    return !item.subRouteUid && item.subRouteName === detail.subRouteName;
  return !item.subRouteUid && !item.subRouteName;
}
export function matchArrival(
  target: TrackingTarget,
  arrivals: BusArrivalItem[],
) {
  const stop = target.detail.stops[target.boarding];
  if (
    !stop ||
    target.detail.direction === 255 ||
    target.detail.stops.filter((s) => s.name === stop.name).length !== 1
  )
    return null;
  const matches = arrivals.filter(
    (a) =>
      a.stopName === stop.name &&
      a.direction === target.detail.direction &&
      branchMatches(target.detail, a),
  );
  if (matches.length !== 1) return null;
  const arrival = matches[0];
  return typeof arrival.estimateMinutes === "number" &&
    Number.isFinite(arrival.estimateMinutes) &&
    arrival.estimateMinutes >= 0
    ? arrival
    : null;
}
export function matchVehicles(
  target: TrackingTarget,
  buses: LiveBus[],
  now: number,
) {
  return buses
    .filter((b) => {
      const time = Date.parse(b.gpsTime);
      return (
        b.direction === target.detail.direction &&
        b.direction !== 255 &&
        branchMatches(target.detail, b) &&
        (!b.routeName || b.routeName === target.routeName) &&
        (!b.city || b.city === target.city) &&
        Number.isFinite(b.lat) &&
        Number.isFinite(b.lng) &&
        Math.abs(b.lat) <= 90 &&
        Math.abs(b.lng) <= 180 &&
        Number.isFinite(time) &&
        now - time >= -5000 &&
        now - time <= TRACKING_FRESH_MS
      );
    })
    .filter(
      (b, _, all) =>
        all.filter((other) => other.plateNumb === b.plateNumb).length === 1,
    );
}
/** GPS nearest-stop placement is approximate; never invent a count off-axis. */
export function vehicleStopIndex(bus: LiveBus, stops: RouteDetailStop[]) {
  const distances = stops
    .map((s, index) => ({
      index,
      distance:
        Math.hypot(
          (s.lng - bus.lng) * Math.cos((bus.lat * Math.PI) / 180),
          s.lat - bus.lat,
        ) * 111_000,
    }))
    .filter((s) => Number.isFinite(s.distance))
    .sort((a, b) => a.distance - b.distance);
  if (
    !distances.length ||
    distances[0].distance > 150 ||
    (distances[1] && distances[1].distance - distances[0].distance < 20)
  )
    return null;
  return distances[0].index;
}
export function accessibleVehicle(bus: LiveBus): boolean | null {
  const yes = (v: string) =>
    ["是", "1", "true", "yes"].includes(v?.trim().toLowerCase());
  const no = (v: string) =>
    ["否", "0", "false", "no"].includes(v?.trim().toLowerCase());
  if (yes(bus.isLowFloor) || yes(bus.hasLiftOrRamp)) return true;
  if (no(bus.isLowFloor) && no(bus.hasLiftOrRamp)) return false;
  return null;
}

/** One lifetime, non-overlapping requests; hidden/expired data is revoked. */
export function createTrackingPoller(options: {
  fetch: (signal: AbortSignal) => Promise<TrackingSnapshot>;
  publish: (snapshot: TrackingSnapshot | null) => void;
  visible: () => boolean;
  now?: () => number;
}) {
  let disposed = false;
  let generation = 0;
  let pending = false;
  let controller: AbortController | undefined;
  let snapshot: TrackingSnapshot | null = null;
  const now = options.now ?? Date.now;
  const clear = () => {
    snapshot = null;
    options.publish(null);
  };
  const refresh = async () => {
    if (disposed || pending || !options.visible()) return;
    pending = true;
    const epoch = generation;
    controller = new AbortController();
    const signal = controller.signal;
    clear();
    try {
      const next = await options.fetch(signal);
      if (
        !disposed &&
        epoch === generation &&
        !signal.aborted &&
        options.visible() &&
        now() - next.receivedAt <= TRACKING_FRESH_MS
      ) {
        snapshot = next;
        options.publish(next);
      }
    } catch {
      if (!disposed && epoch === generation) clear();
    } finally {
      pending = false;
      if (!disposed && epoch !== generation && options.visible())
        void refresh();
    }
  };
  return {
    refresh,
    tick: () => {
      if (
        snapshot &&
        (now() - snapshot.receivedAt > TRACKING_FRESH_MS ||
          snapshot.buses.some(
            (b) => now() - Date.parse(b.gpsTime) > TRACKING_FRESH_MS,
          ))
      )
        clear();
    },
    visibility: () => {
      generation++;
      controller?.abort();
      clear();
      if (options.visible()) void refresh();
    },
    dispose: () => {
      disposed = true;
      generation++;
      controller?.abort();
      clear();
    },
  };
}
