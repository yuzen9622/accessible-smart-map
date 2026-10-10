import type { RouteDetailDirection, RouteDetailStop } from "@/lib/api/transit";
import { haversineMeters } from "@/lib/geo";
import type { BusLeg } from "@/types/route";
import type { BusDirection } from "@/types/transit";

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
  direction: BusDirection,
  subRouteUid?: string,
): RouteDetailStop[] | null {
  // 255 means TDX could not say which way the run goes: never a ride.
  if (direction === 255) return null;
  // Several branches can share a direction number; guessing the first one
  // would show another branch's stops.
  const matches = (directions ?? []).filter(
    (d) =>
      d.direction === direction &&
      (subRouteUid === undefined || d.subRouteUid === subRouteUid),
  );
  if (matches.length !== 1) return null;
  return matches[0].stops?.length ? matches[0].stops : null;
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
 * Every forward (departure before arrival) pair is enumerated; the ride is
 * only returned when exactly one exists. A name that repeats on the line, or a
 * loop that passes both stops twice, leaves the intended lap unknowable, so it
 * is rejected rather than guessed. Exact (normalised) names are tried first,
 * and containment is only a fallback when nothing matched exactly — and must
 * itself be unique. No wrap-around: the arrival is always after the departure.
 */
export function sliceLegStops(
  stops: RouteDetailStop[],
  departureStop: string,
  arrivalStop: string,
): RouteDetailStop[] | null {
  for (const eq of [equalStopName, looseEqualStopName]) {
    const pairs: [number, number][] = [];
    for (let from = 0; from < stops.length; from++) {
      if (!eq(stops[from].name, departureStop)) continue;
      for (let to = from + 1; to < stops.length; to++) {
        if (eq(stops[to].name, arrivalStop)) pairs.push([from, to]);
      }
    }
    if (pairs.length === 1) return stops.slice(pairs[0][0], pairs[0][1] + 1);
    if (pairs.length > 1) return null;
  }
  return null;
}

/**
 * Identifies the ride the planner chose. `direction` is the planner's (GTFS)
 * number: TDX numbers a line's runs independently, so it is never used to pick
 * between candidates — only the stop order can.
 */
export interface LegRideRef {
  direction: 0 | 1;
  departureStop: string;
  arrivalStop: string;
  subRouteUid?: string;
}

export interface ResolvedLegRide {
  direction: BusDirection;
  stops: RouteDetailStop[];
  /** The branch the ride was found on; absent when the payload names none. */
  subRouteUid?: string;
  /** True when no other run of the same direction number exists in the payload. */
  singleBranchInDirection: boolean;
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
): BusDirection | null {
  return resolveLegRide(directions, leg)?.direction ?? null;
}

/**
 * Find the one published run that holds board → alight, in stop order.
 *
 * - A supplied `subRouteUid` with matching rows restricts the search to that
 *   branch. When it matches nothing, only rows that carry no UID may stand in:
 *   a row explicitly naming a different branch is evidence against it.
 * - Without a UID, the ride is only usable when exactly one run fits.
 * - 255 (direction unknown) is never a ride, and the GTFS direction number
 *   never breaks a tie: more than one fitting run means null.
 */
export function resolveLegRide(
  directions: RouteDetailDirection[] | undefined,
  leg: LegRideRef,
): ResolvedLegRide | null {
  if (!directions?.length) return null;

  let pool = directions;
  if (leg.subRouteUid) {
    const named = directions.filter((d) => d.subRouteUid === leg.subRouteUid);
    pool = named.length ? named : directions.filter((d) => !d.subRouteUid);
  }

  const candidates: { run: RouteDetailDirection; stops: RouteDetailStop[] }[] =
    [];
  for (const run of pool) {
    if (run.direction === 255 || !run.stops?.length) continue;
    const stops = sliceLegStops(run.stops, leg.departureStop, leg.arrivalStop);
    if (stops?.length) candidates.push({ run, stops });
  }
  if (candidates.length !== 1) return null;

  const { run, stops } = candidates[0];
  return {
    direction: run.direction,
    stops,
    subRouteUid: run.subRouteUid,
    singleBranchInDirection:
      directions.filter((d) => d.direction === run.direction).length === 1,
  };
}

/**
 * Stable identity of a tracked bus leg. Both entry points (route card and
 * navigation) build their store key from this so the same ride is never
 * tracked under two keys, and two different rides never share one.
 */
export function busLegKey(prefix: string, leg: BusLeg): string {
  return JSON.stringify([
    prefix,
    leg.planContext?.routeToken ?? null,
    leg.planContext?.legIndex ?? null,
    leg.tdxCity ?? leg.cityCode ?? "",
    leg.subRouteName ?? leg.routeName,
    leg.subRouteUid ?? null,
    leg.direction,
    leg.departureStop,
    leg.arrivalStop,
  ]);
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
  if (leg.scheduledTrip?.stops.length) {
    return leg.scheduledTrip.stops.map((stop, i, stops) => {
      const time =
        i === 0
          ? (stop.departureAt ?? stop.arrivalAt)
          : (stop.arrivalAt ?? stop.departureAt);
      return {
        seq: i + 1,
        name: stop.name,
        stationUid: stop.stopUid,
        estimateMinutes: null,
        statusLabel:
          typeof time === "number" && Number.isFinite(time)
            ? new Date(time).toLocaleTimeString("en-GB", {
                timeZone: "Asia/Taipei",
                hour: "2-digit",
                minute: "2-digit",
              })
            : "",
        state: "upcoming" as const,
        kind:
          i === 0
            ? ("board" as const)
            : i === stops.length - 1
              ? ("alight" as const)
              : ("intermediate" as const),
        pending: false,
      };
    });
  }
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

/** `每 5–10 分一班` / `每 10 分一班`: a published headway, not a live ETA. */
const HEADWAY_RE = /^每\s*(\d+)(?:\s*[–—-]\s*(\d+))?\s*分一班$/;

/**
 * Interpret the backend's `statusLabel`.
 *
 * Both `/transit/bus/route-detail` and `/transit/bus/arrival` emit this compound
 * text. route-detail does not just echo TDX's StopStatus: when a stop
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

  const headway = HEADWAY_RE.exec(label);
  if (headway) {
    return headway[2]
      ? {
          key: "busHeadwayRange",
          params: { min: Number(headway[1]), max: Number(headway[2]) },
          tone: "muted",
          kind: "scheduled",
        }
      : {
          key: "busHeadway",
          params: { count: Number(headway[1]) },
          tone: "muted",
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
    case "暫無到站資訊":
      return { key: "busArrivalUnavailable", tone: "muted", kind: "status" };
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
  if (typeof m === "number" && Number.isFinite(m) && m >= 0) {
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
  return { key: "busArrivalUnavailable", tone: "muted", kind: "status" };
}
