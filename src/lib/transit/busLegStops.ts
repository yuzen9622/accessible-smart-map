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
  /**
   * True while the ETA lookup has not settled. Distinguishes "we do not know
   * yet" from "the lookup finished and had nothing for this stop" — rendering
   * both as a status sentence is what made a scheduled departure read as
   * 「尚未發車」.
   */
  pending?: boolean;
}

export function pickDirection(
  directions: RouteDetailDirection[] | undefined,
  direction: 0 | 1,
): RouteDetailStop[] | null {
  const match = directions?.find((d) => d.direction === direction);
  return match?.stops?.length ? match.stops : null;
}

/**
 * Stop names as written by TDX and by the route planner drift apart: 臺/台,
 * full/half width, a trailing 站, and bracketed platform notes
 * (`高鐵臺中站(第11月台)`). Mirrors the backend's `normalizeStopName`
 * (`src/utils/transit-text.ts`) so both ends agree on what "the same stop" is.
 */
export function normalizeStopName(name?: string): string {
  if (!name) return "";
  return name
    .normalize("NFKC")
    .replace(/[(（][^）)]*[)）]/g, "")
    .replace(/站/g, "")
    .replace(/\s+/g, "")
    .replace(/臺/g, "台")
    .replace(/[－–—-]/g, "")
    .toLowerCase()
    .trim();
}

/** Same-stop test on normalised names. Exact match only — see {@link looseEqualStopName}. */
export function equalStopName(a?: string, b?: string): boolean {
  const na = normalizeStopName(a);
  const nb = normalizeStopName(b);
  return Boolean(na) && na === nb;
}

/**
 * Exact-normalised match, then containment (`高鐵台中` vs `高鐵台中第11月台`).
 * Containment can over-match on a long line, so callers try the exact pass
 * across the whole list first.
 */
function looseEqualStopName(a?: string, b?: string): boolean {
  const na = normalizeStopName(a);
  const nb = normalizeStopName(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

/**
 * Cut `departureStop` → `arrivalStop` (inclusive) out of the whole line.
 *
 * The arrival stop is searched *after* the departure stop so a circular route
 * that visits the same name twice yields the ride, not the whole loop. Exact
 * (normalised) names are tried across the whole line before falling back to
 * containment, so a loose match never beats a real one.
 */
export function sliceLegStops(
  stops: RouteDetailStop[],
  departureStop: string,
  arrivalStop: string,
): RouteDetailStop[] | null {
  for (const eq of [equalStopName, looseEqualStopName]) {
    const from = stops.findIndex((s) => eq(s.name, departureStop));
    if (from === -1) continue;

    const relative = stops
      .slice(from + 1)
      .findIndex((s) => eq(s.name, arrivalStop));
    if (relative === -1) continue;

    return stops.slice(from, from + 1 + relative + 1);
  }
  return null;
}

/**
 * The ride's stops, hunting for the direction that actually contains it.
 *
 * `leg.direction` cannot be trusted: TDX numbers a line's two directions
 * independently of how the planner labelled the leg, so on 365 / 26 the
 * declared direction 0 holds the stops in the opposite order and the slice
 * finds no arrival stop after the departure stop — leaving every badge with no
 * data at all. The declared direction is tried first, then the other one.
 */
/** Identifies the exact run a leg rides: the planner's sub-route, if it named one. */
export interface LegRideRef {
  direction: 0 | 1;
  departureStop: string;
  arrivalStop: string;
  subRouteUid?: string;
}

export function resolveLegStops(
  directions: RouteDetailDirection[] | undefined,
  leg: LegRideRef,
): RouteDetailStop[] | null {
  return resolveLegRide(directions, leg)?.stops ?? null;
}

/**
 * TDX's direction number for this ride, or null when nothing matches.
 *
 * Everything that asks TDX about "this leg" — arrival times, live vehicle
 * positions — must use *this* number rather than `leg.direction`, or it may
 * query the opposite run of the line.
 */
export function resolveLegDirection(
  directions: RouteDetailDirection[] | undefined,
  leg: LegRideRef,
): 0 | 1 | null {
  return resolveLegRide(directions, leg)?.direction ?? null;
}

/**
 * Pick the published run this leg actually rides.
 *
 * `subRouteUid` is authoritative when the planner supplied one: a line's
 * sub-routes (99 vs 99延) share a name but not a stop list, and picking the
 * wrong one yields stops the rider never sees. Only when the payload carries
 * no matching sub-route do we fall back to geometry — trying each direction
 * and keeping the one whose stop order can hold board → alight.
 */
export function resolveLegRide(
  directions: RouteDetailDirection[] | undefined,
  leg: LegRideRef,
): { direction: 0 | 1; stops: RouteDetailStop[] } | null {
  if (!directions?.length) return null;

  const scoped = leg.subRouteUid
    ? directions.filter((d) => d.subRouteUid === leg.subRouteUid)
    : [];
  const pool = scoped.length ? scoped : directions;

  // The declared direction first: with a correct sub-route it is normally
  // right, and preferring it keeps a loop route from matching the wrong lap.
  const ordered = [
    ...pool.filter((d) => d.direction === leg.direction),
    ...pool.filter((d) => d.direction !== leg.direction),
  ];

  for (const candidate of ordered) {
    if (!candidate.stops?.length) continue;
    const sliced = sliceLegStops(
      candidate.stops,
      leg.departureStop,
      leg.arrivalStop,
    );
    if (sliced?.length)
      return { direction: candidate.direction, stops: sliced };
  }
  return null;
}

/** Beyond this the target vehicle counts as travelling between stops. */
export const CURRENT_STOP_RADIUS_M = 200;

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

/**
 * Name-only rows from the leg's static data, for when route-detail is unusable.
 *
 * `pending` says whether the ETA lookup is still running: while it is, the rows
 * render as placeholders; once it has settled with nothing usable they render
 * as "no information", never as a service status.
 */
export function fallbackStopRows(
  leg: BusLeg,
  { pending = false }: { pending?: boolean } = {},
): BusLegStopRow[] {
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
    pending,
  }));
}

export type EtaLabelKind = "eta" | "scheduled" | "status" | "pending";

export interface EtaLabel {
  /** i18n key. Undefined only when `kind === "pending"`. */
  key?: string;
  /** Interpolation values for `t(key, params)` — e.g. `{ time }` or `{ count }`. */
  params?: Record<string, string | number>;
  tone: EtaTone;
  /**
   * `pending` means "we do not know yet" — the caller must render a placeholder,
   * never a status sentence. Showing 「尚未發車」 while the ETA request is still in
   * flight is what made a 18:15 departure read as "not running".
   */
  kind: EtaLabelKind;
}

/**
 * `HH:mm`, optionally prefixed 明日 (tomorrow) and/or suffixed 起點發車
 * (departs from the line's origin, because this stop has no per-stop schedule).
 */
const SCHEDULED_RE = /^(明日\s*)?(\d{1,2}:\d{2})(\s*起點發車)?$/;

/**
 * Interpret the backend's `statusLabel`.
 *
 * `/transit/bus/route-detail` does not just echo TDX's StopStatus: when a stop
 * reports StopStatus 1 (尚未發車) the backend overwrites the label with the next
 * departure it can find — TDX's `NextBusTime`, else the timetable — so the field
 * carries times like `18:15`, `18:15 起點發車` or `明日 06:00`. The other statuses
 * (末班車已過 / 今日未營運 / 交管不停靠) are never overwritten and stay verbatim.
 *
 * Returns null when the label says nothing the caller can use (`正常`, or an
 * unrecognised value), leaving the ETA branch to decide.
 */
export function parseStatusLabel(statusLabel: string): EtaLabel | null {
  const label = statusLabel.trim();
  if (!label) return null;

  const scheduled = SCHEDULED_RE.exec(label);
  if (scheduled) {
    const tomorrow = Boolean(scheduled[1]);
    const fromOrigin = Boolean(scheduled[3]);
    const key = tomorrow
      ? fromOrigin
        ? "busScheduledTomorrowFromOrigin"
        : "busScheduledTomorrow"
      : fromOrigin
        ? "busScheduledFromOrigin"
        : "busScheduledAt";
    return {
      key,
      params: { time: scheduled[2] },
      tone: "normal",
      kind: "scheduled",
    };
  }

  switch (label) {
    case "末班車已過":
      return { key: "busServiceEnded", tone: "muted", kind: "status" };
    case "今日未營運":
      return { key: "busNoServiceToday", tone: "muted", kind: "status" };
    case "交管不停靠":
      return { key: "busStopSkipped", tone: "muted", kind: "status" };
    case "尚未發車":
      return { key: "busNotDeparted", tone: "muted", kind: "status" };
    default:
      return null;
  }
}

/**
 * ETA → i18n key + colour tone. The caller owns `t()`, so this stays pure and
 * testable without an i18n runtime.
 *
 * A live ETA wins; without one we fall back to the backend's `statusLabel`,
 * which is where the next scheduled departure lives.
 */
export function resolveEtaLabel(row: BusLegStopRow): EtaLabel {
  if (row.state === "passed")
    return { key: "busStopPassed", tone: "muted", kind: "status" };

  const m = row.estimateMinutes;
  if (typeof m === "number" && m >= 0) {
    if (m === 0)
      return { key: "busArrivalArriving", tone: "arriving", kind: "eta" };
    if (m < 3) return { key: "busArrivalSoon", tone: "arriving", kind: "eta" };
    return {
      key: "busArrivalMinutes",
      params: { count: m },
      tone: m < 10 ? "soon" : "normal",
      kind: "eta",
    };
  }

  const fromStatus = parseStatusLabel(row.statusLabel ?? "");
  if (fromStatus) return fromStatus;

  // Still waiting: a placeholder, never a status sentence.
  if (row.pending) return { tone: "muted", kind: "pending" };

  // Settled with nothing usable — including `正常` paired with a null ETA,
  // which the backend emits whenever TDX has no position to estimate from.
  // "No service" would be a claim we cannot support.
  return { key: "busEtaUnknown", tone: "muted", kind: "status" };
}
