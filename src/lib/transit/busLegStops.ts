import type { RouteDetailDirection, RouteDetailStop } from "@/lib/api/transit";
import { haversineMeters } from "@/lib/geo";
import type { BusLeg } from "@/types/route";

export type StopRowState = "passed" | "current" | "upcoming";
export type StopRowKind = "board" | "intermediate" | "alight";
export type EtaTone = "arriving" | "soon" | "normal" | "muted";

export interface BusLegStopRow {
  seq: number;
  name: string;
  stationUid?: string;
  estimateMinutes: number | null;
  statusLabel: string;
  state: StopRowState;
  kind: StopRowKind;
}

/** Beyond this the target vehicle counts as travelling between stops. */
export const CURRENT_STOP_RADIUS_M = 200;

export function pickDirection(
  directions: RouteDetailDirection[] | undefined,
  direction: 0 | 1,
): RouteDetailStop[] | null {
  const match = directions?.find((d) => d.direction === direction);
  return match?.stops?.length ? match.stops : null;
}

/**
 * Cut `departureStop` → `arrivalStop` (inclusive) out of the whole line.
 *
 * The arrival stop is searched *after* the departure stop so a circular route
 * that visits the same name twice yields the ride, not the whole loop.
 */
export function sliceLegStops(
  stops: RouteDetailStop[],
  departureStop: string,
  arrivalStop: string,
): RouteDetailStop[] | null {
  const board = departureStop.trim();
  const alight = arrivalStop.trim();
  const from = stops.findIndex((s) => s.name.trim() === board);
  if (from === -1) return null;

  const relative = stops
    .slice(from + 1)
    .findIndex((s) => s.name.trim() === alight);
  if (relative === -1) return null;

  return stops.slice(from, from + 1 + relative + 1);
}

/** Seq of the nearest stop within `radiusM` of the target vehicle. */
export function resolveCurrentStopSeq(
  stops: RouteDetailStop[],
  bus: { lat: number; lng: number } | null,
  radiusM: number = CURRENT_STOP_RADIUS_M,
): number | null {
  if (!bus) return null;

  let best: { seq: number; dist: number } | null = null;
  for (const stop of stops) {
    const dist = haversineMeters(
      { lat: bus.lat, lng: bus.lng },
      { lat: stop.lat, lng: stop.lng },
    );
    if (!best || dist < best.dist) best = { seq: stop.seq, dist };
  }
  if (!best || best.dist > radiusM) return null;
  return best.seq;
}

export function buildStopRows(
  stops: RouteDetailStop[],
  currentSeq: number | null,
): BusLegStopRow[] {
  const last = stops.length - 1;
  return stops.map((stop, i) => {
    let state: StopRowState = "upcoming";
    if (currentSeq != null) {
      if (stop.seq === currentSeq) state = "current";
      else if (stop.seq < currentSeq) state = "passed";
    }
    let kind: StopRowKind = "intermediate";
    if (i === 0) kind = "board";
    else if (i === last) kind = "alight";
    return {
      seq: stop.seq,
      name: stop.name,
      estimateMinutes: stop.estimateMinutes,
      statusLabel: stop.statusLabel,
      state,
      kind,
    };
  });
}

/** Name-only rows from the leg's static data, for when route-detail is unusable. */
export function fallbackStopRows(leg: BusLeg): BusLegStopRow[] {
  const middle = leg.intermediateStops ?? [];
  const names = [
    { name: leg.departureStop, kind: "board" as StopRowKind },
    ...middle.map((s) => ({
      name: s.name,
      stationUid: s.stationUid,
      kind: "intermediate" as StopRowKind,
    })),
    { name: leg.arrivalStop, kind: "alight" as StopRowKind },
  ];
  return names.map((entry, i) => ({
    seq: i,
    name: entry.name,
    stationUid: "stationUid" in entry ? entry.stationUid : undefined,
    estimateMinutes: null,
    statusLabel: "",
    state: "upcoming",
    kind: entry.kind,
  }));
}

export interface EtaLabel {
  key: string;
  tone: EtaTone;
  count?: number;
}

/**
 * ETA → i18n key + colour tone. The caller owns `t()`, so this stays pure and
 * testable without an i18n runtime.
 */
export function resolveEtaLabel(row: BusLegStopRow): EtaLabel {
  if (row.state === "passed") return { key: "busStopPassed", tone: "muted" };

  const m = row.estimateMinutes;
  if (m == null || m < 0)
    return { key: "busArrivalUnavailable", tone: "muted" };
  if (m === 0) return { key: "busArrivalArriving", tone: "arriving" };
  if (m < 3) return { key: "busArrivalSoon", tone: "arriving" };
  return {
    key: "busArrivalMinutes",
    tone: m < 10 ? "soon" : "normal",
    count: m,
  };
}
