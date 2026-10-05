import { useEffect, useRef } from "react";
import type { BusArrivalItem, RouteDetailStop } from "@/lib/api/transit";
import { getBusArrival, getLiveBusPositions } from "@/lib/api/transit";
import {
  equalStopName,
  type ResolvedLegRide,
  resolveCurrentStopSeq,
  resolveLegRide,
} from "@/lib/transit/busLegStops";
import {
  fetchRouteDetailCached,
  legRouteDetailRef,
} from "@/lib/transit/busRouteDetailCache";
import useMapStore from "@/stores/useMapStore";
import type { BusLeg, LiveBus } from "@/types/route";

const POLL_INTERVAL_MS = 15_000;
/**
 * A tracked vehicle disappears if no poll has refreshed it by then: one poll
 * gap plus the 10s request timeout. Older than that, its position and ETA
 * describe a bus that has moved on.
 */
const STALE_AFTER_MS = POLL_INTERVAL_MS + 10_000;

/**
 * The name TDX answers to for this ride. A line's sub-routes (99 / 99延) have
 * separate stop lists and separate vehicles, and the planner tells us which one
 * it booked — querying the parent name returns both mixed together.
 */
function tdxRouteName(leg: BusLeg): string {
  return leg.subRouteName ?? leg.routeName;
}

/**
 * Whether a record belongs to the branch the ride was resolved to.
 *
 * A known branch requires a matching record ID, including when route-detail
 * was queried with subRouteUid. Only an unscoped, unidentified unique run can
 * use the legacy plate/stop fallback; scoped results never prove global uniqueness.
 */
function onResolvedBranch(
  ride: ResolvedLegRide,
  recordUid?: string,
  requestedUid?: string,
): boolean {
  const knownUid = ride.subRouteUid ?? requestedUid;
  // A branch-scoped snapshot cannot prove that unscoped arrival/positions
  // contain only this branch. Known identity requires explicit confirmation.
  if (knownUid) return recordUid === knownUid;
  return ride.singleBranchInDirection;
}

interface ArrivalTarget {
  /** Plate of the next bus at the boarding stop, if TDX has dispatched one. */
  plate?: string;
  /** Soonest ETA (minutes) at the boarding stop for this leg's direction. */
  eta: number | null;
  subRouteUid?: string;
}

/**
 * The next vehicle at the boarding stop, from the arrival (ETA) feed.
 *
 * The backend maps TDX's plate into each arrival entry, so the soonest arrival
 * tells us both *when* the next bus comes and *which plate* it is. Only entries
 * for the resolved branch and direction, at exactly the boarding stop, with a
 * finite non-negative ETA and a real plate qualify; anything else (a null ETA
 * included) is not matched to a vehicle.
 */
async function fetchArrival(
  leg: BusLeg,
  ride: ResolvedLegRide,
  city: string,
  signal: AbortSignal,
): Promise<ArrivalTarget> {
  try {
    const res = await getBusArrival(
      tdxRouteName(leg),
      leg.departureStop,
      ride.direction,
      city,
      signal,
    );
    if (!res.ok || !res.data?.arrivals) return { eta: null };

    const next = res.data.arrivals
      .filter(
        (a: BusArrivalItem) =>
          a.direction === ride.direction &&
          equalStopName(a.stopName, leg.departureStop) &&
          onResolvedBranch(ride, a.subRouteUid, leg.subRouteUid) &&
          typeof a.estimateMinutes === "number" &&
          Number.isFinite(a.estimateMinutes) &&
          a.estimateMinutes >= 0 &&
          Boolean(a.plateNumb) &&
          a.plateNumb !== "-1",
      )
      .sort(
        (a: BusArrivalItem, b: BusArrivalItem) =>
          (a.estimateMinutes as number) - (b.estimateMinutes as number),
      )[0];
    if (!next) return { eta: null };

    return {
      plate: next.plateNumb,
      eta: next.estimateMinutes,
      subRouteUid: next.subRouteUid,
    };
  } catch {
    return { eta: null };
  }
}

/**
 * Resolve the single vehicle the user is about to board on this leg.
 *
 * Returns an empty array when no plate can be pinned: an unidentifiable bus is
 * worse than none, because a marker for "some vehicle on this line" reads as
 * "your vehicle". The only trustworthy signal is the arrival feed at the
 * *boarding stop*; `leg.nearestBus` is a planning-time snapshot and is not
 * used.
 *
 * The run is resolved from route-detail first: when it cannot be resolved to
 * exactly one run (or resolves to 255, "direction unknown") nothing is
 * tracked — falling back to `leg.direction` would query a run the ride may not
 * be on.
 */
export async function fetchLeg(
  leg: BusLeg,
  signal: AbortSignal,
): Promise<LiveBus[]> {
  const ref = legRouteDetailRef(leg);
  if (!ref.city) return [];

  const directions = await fetchRouteDetailCached(ref.routeName, ref.city, {
    subRouteUid: ref.subRouteUid,
    signal,
  });
  if (signal.aborted) return [];

  const ride = resolveLegRide(directions ?? undefined, leg);
  if (!ride || ride.direction === 255) return [];

  // ETA and positions are independent; run them together.
  const [arrival, posRes] = await Promise.all([
    fetchArrival(leg, ride, ref.city, signal),
    getLiveBusPositions(ref.routeName, ref.city, ride.direction, signal),
  ]);
  if (signal.aborted) return [];

  if (!arrival.plate || arrival.eta == null) return [];
  if (!posRes.ok || !posRes.data?.buses?.length) return [];

  const target = posRes.data.buses.find(
    (b) =>
      b.plateNumb === arrival.plate &&
      b.direction === ride.direction &&
      onResolvedBranch(ride, b.subRouteUid, leg.subRouteUid) &&
      (!arrival.subRouteUid ||
        !b.subRouteUid ||
        arrival.subRouteUid === b.subRouteUid),
  );
  if (!target) return [];

  // Last guard: a vehicle already past the boarding stop cannot be the one the
  // user boards, whatever the feeds say. Without this, a stale or mislabelled
  // record shows "已過站" all down the stop list next to a countdown to that
  // same boarding stop — two claims that cannot both be true.
  if (hasPassedBoardingStop(ride.stops, target)) return [];

  // The plate and the ETA come from the same arrival record, so one bus's
  // plate never sits beside another bus's countdown.
  return [
    {
      ...target,
      routeName: leg.routeName,
      city: leg.tdxCity ?? "",
      isTarget: true,
      estimateTime: arrival.eta,
      etaStopName: leg.departureStop,
    },
  ];
}

/**
 * True when the vehicle can be placed on the ride *beyond* its first stop.
 *
 * Only decides when the vehicle is close enough to a stop to be located at all;
 * between stops `resolveCurrentStopSeq` returns null and we keep tracking.
 */
function hasPassedBoardingStop(
  stops: RouteDetailStop[],
  bus: { lat: number; lng: number },
): boolean {
  const seq = resolveCurrentStopSeq(stops, bus);
  if (seq == null) return false;
  const board = stops[0]?.seq;
  return board != null && seq > board;
}

/**
 * Polls the live position of the one bus the user is tracking — the leg they
 * expanded (`activeBusLeg`) — every 15s, and reports only that vehicle.
 *
 * Selecting a route no longer starts anything: with no active leg the hook
 * registers no timer and no listener, so a freshly planned route costs zero
 * requests until the user asks for a specific segment.
 *
 * - Fetches through the shared API layer (`END_POINT` config, not a hardcoded
 *   host) so it works in local dev.
 * - Cancels in-flight requests on leg change / unmount via AbortController.
 * - Restarts only when `activeBusLeg.key` changes, not on every re-render.
 * - Pauses while the tab is hidden and refreshes immediately on return.
 * - A failed poll, or one that takes longer than {@link STALE_AFTER_MS}, clears
 *   the vehicle: a stale position or ETA is worse than none.
 * - Each refresh carries a generation; a superseded or cancelled one is ignored.
 */
export function useLiveBusPositions(): void {
  const activeBusLeg = useMapStore((s) => s.activeBusLeg);
  const setLiveBusPositions = useMapStore((s) => s.setLiveBusPositions);

  // Exposes the freshest leg object to the polling loop without making the
  // loop restart on every re-render — only the key below does that.
  const legRef = useRef<BusLeg | null>(activeBusLeg?.leg ?? null);
  legRef.current = activeBusLeg?.leg ?? null;

  const legKey = activeBusLeg?.key ?? null;

  // `legKey` is the intended restart key: the loop reads the freshest leg from
  // `legRef`, so the effect must NOT also depend on the leg object reference.
  useEffect(() => {
    const leg = legRef.current;
    if (!legKey || !leg) {
      setLiveBusPositions([]);
      return;
    }

    let cancelled = false;
    let generation = 0;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let staleTimer: ReturnType<typeof setTimeout> | null = null;

    const armStale = () => {
      if (staleTimer) clearTimeout(staleTimer);
      staleTimer = setTimeout(() => {
        if (!cancelled) setLiveBusPositions([]);
      }, STALE_AFTER_MS);
    };

    const refresh = async () => {
      const current = legRef.current;
      if (!current) return;
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      const mine = ++generation;
      const live = () => !cancelled && !signal.aborted && mine === generation;

      try {
        const buses = await fetchLeg(current, signal);
        if (!live()) return;
        setLiveBusPositions(buses);
        // Only a vehicle on screen needs an expiry.
        if (buses.length) armStale();
        else if (staleTimer) clearTimeout(staleTimer);
      } catch {
        // A failed poll must not leave the previous vehicle looking current.
        if (live()) setLiveBusPositions([]);
      }
    };

    // Exactly one pending timer at any time: scheduleNext() always clears the
    // previous one before arming a new one, so overlapping triggers (e.g. the
    // tab being refocused mid-refresh) can never double the polling rate. The
    // gap is measured *after* each refresh settles, so a slow request never
    // stacks behind the next tick.
    function scheduleNext() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    }

    async function tick() {
      if (typeof document !== "undefined" && document.hidden) {
        scheduleNext();
        return;
      }
      await refresh();
      if (!cancelled) scheduleNext();
    }

    function onVisibility() {
      if (!cancelled && !document.hidden) tick();
    }

    tick();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      controller?.abort();
      if (timer) clearTimeout(timer);
      if (staleTimer) clearTimeout(staleTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      setLiveBusPositions([]);
    };
  }, [legKey, setLiveBusPositions]);
}
