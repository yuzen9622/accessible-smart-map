import type { LiveBus, LiveBusPositionsData } from "@/types/route";
import type {
  BusFrequency,
  BusScheduleByDirection,
  BusTimetableData,
} from "@/types/transit";
import { isBusDirection } from "@/types/transit";
import type {
  BusArrivalItem,
  RouteDetailDirection,
  RouteDetailStop,
} from "./transit";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function eta(value: unknown): value is number | null {
  return value === null || (finite(value) && value >= 0);
}
function coordinates(row: Record<string, unknown>) {
  return (
    finite(row.lat) &&
    Math.abs(row.lat) <= 90 &&
    finite(row.lng) &&
    Math.abs(row.lng) <= 180
  );
}
function geometry(value: unknown): value is [number, number][] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (point) =>
        Array.isArray(point) &&
        point.length === 2 &&
        finite(point[0]) &&
        Math.abs(point[0]) <= 180 &&
        finite(point[1]) &&
        Math.abs(point[1]) <= 90,
    )
  );
}
function plate(value: unknown): value is string {
  return text(value) && value.trim() !== "-1";
}
function branch(row: Record<string, unknown>) {
  return {
    ...(text(row.subRouteUid) ? { subRouteUid: row.subRouteUid } : {}),
    ...(text(row.subRouteName) ? { subRouteName: row.subRouteName } : {}),
  };
}
function label(value: unknown): string {
  // This is display prose (possibly compound), never a numeric status code.
  return typeof value === "string" ? value : "";
}
function list(data: unknown, key: string): unknown[] {
  if (!record(data) || !Array.isArray(data[key]))
    throw new TypeError(`Invalid bus ${key} payload`);
  return data[key];
}

export function parseBusArrivals(data: unknown): BusArrivalItem[] {
  return list(data, "arrivals").flatMap((row) => {
    if (
      !record(row) ||
      !text(row.stopName) ||
      !isBusDirection(row.direction) ||
      !eta(row.estimateMinutes)
    )
      return [];
    return [
      {
        stopName: row.stopName,
        direction: row.direction,
        directionLabel: label(row.directionLabel),
        estimateMinutes: row.estimateMinutes,
        statusLabel: label(row.statusLabel),
        ...branch(row),
        ...(plate(row.plateNumb) ? { plateNumb: row.plateNumb } : {}),
      },
    ];
  });
}

export function parseLiveBusPositions(data: unknown): LiveBusPositionsData {
  const buses: LiveBus[] = list(data, "buses").flatMap((row) => {
    if (
      !record(row) ||
      !plate(row.plateNumb) ||
      !isBusDirection(row.direction) ||
      !coordinates(row)
    )
      return [];
    return [
      {
        ...branch(row),
        plateNumb: row.plateNumb,
        direction: row.direction,
        directionLabel: label(row.directionLabel),
        lat: row.lat as number,
        lng: row.lng as number,
        speed: finite(row.speed) ? row.speed : 0,
        statusLabel: label(row.statusLabel),
        gpsTime: label(row.gpsTime),
        isLowFloor:
          typeof row.isLowFloor === "string" ? row.isLowFloor : "未知",
        hasLiftOrRamp:
          typeof row.hasLiftOrRamp === "string" ? row.hasLiftOrRamp : "未知",
        vehicleClass: label(row.vehicleClass),
      },
    ];
  });
  if (!record(data) || !text(data.routeName) || !text(data.city))
    throw new TypeError("Invalid bus positions metadata");
  return {
    routeName: data.routeName,
    city: data.city,
    buses,
    count: buses.length,
    lowFloorCount: buses.filter((bus) => bus.isLowFloor === "是").length,
  };
}

export function parseBusRouteDirections(data: unknown): RouteDetailDirection[] {
  return list(data, "directions").flatMap((row) => {
    if (
      !record(row) ||
      !isBusDirection(row.direction) ||
      !Array.isArray(row.stops)
    )
      return [];
    const stops: RouteDetailStop[] = row.stops.flatMap((stop) => {
      if (
        !record(stop) ||
        !Number.isInteger(stop.seq) ||
        !finite(stop.seq) ||
        stop.seq < 1 ||
        !text(stop.name) ||
        !coordinates(stop) ||
        !eta(stop.estimateMinutes)
      )
        return [];
      return [
        {
          ...(text(stop.stopUid) ? { stopUid: stop.stopUid } : {}),
          seq: stop.seq,
          name: stop.name,
          lat: stop.lat as number,
          lng: stop.lng as number,
          estimateMinutes: stop.estimateMinutes,
          statusLabel: label(stop.statusLabel),
          ...(plate(stop.plateNumb) ? { plateNumb: stop.plateNumb } : {}),
        },
      ];
    });
    // Never sort or repair the published sequence: an ambiguous/reversed
    // retained sequence cannot safely identify the forward ride interval.
    if (
      stops.some((stop, index) => index > 0 && stop.seq <= stops[index - 1].seq)
    )
      return [];
    return [
      {
        ...branch(row),
        direction: row.direction,
        stops,
        ...(geometry(row.polyline) ? { polyline: row.polyline } : {}),
      },
    ];
  });
}

function frequency(value: unknown): value is BusFrequency {
  if (!record(value) || !text(value.serviceDays)) return false;
  if (value.scheduleType === "trip") {
    return (
      text(value.originStopName) &&
      text(value.originDepartureTime) &&
      (value.stopTimes === undefined ||
        (Array.isArray(value.stopTimes) &&
          value.stopTimes.every(
            (stop) =>
              record(stop) &&
              finite(stop.seq) &&
              Number.isInteger(stop.seq) &&
              stop.seq > 0 &&
              text(stop.stopName) &&
              text(stop.arrivalTime),
          )))
    );
  }
  if (value.scheduleType !== "headway") return false;
  return (
    (value.start === undefined || text(value.start)) &&
    (value.end === undefined || text(value.end)) &&
    (value.minHeadwayMins === undefined ||
      (finite(value.minHeadwayMins) && value.minHeadwayMins >= 0)) &&
    (value.maxHeadwayMins === undefined ||
      (finite(value.maxHeadwayMins) && value.maxHeadwayMins >= 0))
  );
}

export function parseBusTimetable(data: unknown): BusTimetableData {
  const schedules: BusScheduleByDirection[] = list(data, "schedules").flatMap(
    (row) => {
      if (
        !record(row) ||
        !isBusDirection(row.direction) ||
        !Array.isArray(row.frequencies)
      )
        return [];
      return [
        {
          ...branch(row),
          direction: row.direction,
          directionLabel: label(row.directionLabel),
          ...(text(row.first) ? { first: row.first } : {}),
          ...(text(row.last) ? { last: row.last } : {}),
          // Retain published structured trip/headway information verbatim. In
          // particular, an origin-only trip must never acquire invented stopTimes.
          frequencies: row.frequencies.filter(frequency),
        },
      ];
    },
  );
  if (
    !record(data) ||
    !text(data.routeName) ||
    !text(data.city) ||
    typeof data.note !== "string"
  )
    throw new TypeError("Invalid bus timetable metadata");
  return {
    routeName: data.routeName,
    city: data.city,
    note: data.note,
    schedules,
    ...(typeof data.truncated === "boolean"
      ? { truncated: data.truncated }
      : {}),
  };
}
