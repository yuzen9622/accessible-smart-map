import { useEffect, useRef } from "react";
import { getBusArrival, getLiveBusPositions } from "@/lib/api/transit";
import useMapStore from "@/stores/useMapStore";
import type { BusLeg, LiveBus } from "@/types/route";

const POLL_INTERVAL_MS = 15_000;

interface ArrivalTarget {
  /** Plate of the next bus at the boarding stop, if TDX has dispatched one. */
  plate?: string;
  /** Soonest ETA (minutes) at the boarding stop for this leg's direction. */
  eta: number | null;
}

/**
 * The next vehicle at the boarding stop, from the arrival (ETA) feed.
 *
 * The backend now maps TDX's plate into each arrival entry, so the soonest
 * arrival tells us both *when* the next bus comes and *which plate* it is —
 * the single most reliable way to pin "the bus you're about to board".
 */
async function fetchArrival(leg: BusLeg): Promise<ArrivalTarget> {
  try {
    const res = await getBusArrival(
      leg.routeName,
      leg.departureStop,
      leg.direction,
      leg.tdxCity,
    );
    if (!res.ok || !res.data?.arrivals) return { eta: null };

    const next = res.data.arrivals
      .filter(
        (a) =>
          a.direction === leg.direction &&
          typeof a.estimateMinutes === "number",
      )
      .sort(
        (a, b) => (a.estimateMinutes as number) - (b.estimateMinutes as number),
      )[0];
    if (!next) return { eta: null };

    const plate =
      next.plateNumb && next.plateNumb !== "-1" ? next.plateNumb : undefined;
    return { plate, eta: next.estimateMinutes ?? null };
  } catch {
    return { eta: null };
  }
}

/**
 * Decide which live vehicle is "the one the user is about to board".
 *
 * Requirements:
 *   - Only vehicles that are CURRENTLY IN SERVICE / DISPATCHED are considered.
 *   - If no realtime ETA / bus is dispatched (e.g. 尚未發車 / no active vehicle for this departure),
 *     do NOT pin a generic random vehicle from elsewhere on the route.
 *
 * Priority:
 *   1. The plate the arrival (ETA) feed reports as next at the boarding stop —
 *      a 100% precise match whenever it's present in the live feed.
 *   2. Otherwise the plate the route planner pinned (`nearestBus`), provided it is active in the live feed.
 *   3. If arrival feed reports no plate (e.g. 尚未發車 / not yet dispatched), return undefined (no map marker).
 */
function resolveTargetPlate(
  leg: BusLeg,
  buses: LiveBus[],
  arrivalPlate?: string,
): string | undefined {
  if (arrivalPlate && buses.some((b) => b.plateNumb === arrivalPlate)) {
    return arrivalPlate;
  }

  const planned = leg.nearestBus?.plateNumb;
  if (planned && buses.some((b) => b.plateNumb === planned)) return planned;

  // If no plate was assigned by TDX arrival feed or planner, do not randomly pick a bus.
  return undefined;
}

/**
 * Resolve the single vehicle the user is about to board on this leg.
 *
 * Returns an empty array when no plate can be pinned: an unidentifiable bus is
 * worse than none, because a marker for "some vehicle on this line" reads as
 * "your vehicle".
 */
async function fetchLeg(leg: BusLeg, signal: AbortSignal): Promise<LiveBus[]> {
  // ETA and positions are independent; run them together.
  const [arrival, posRes] = await Promise.all([
    fetchArrival(leg),
    getLiveBusPositions(leg.routeName, leg.tdxCity, leg.direction, signal),
  ]);

  if (!posRes.ok || !posRes.data?.buses?.length) return [];

  const buses = posRes.data.buses;
  const targetPlate = resolveTargetPlate(leg, buses, arrival.plate);
  if (!targetPlate) return [];

  const target = buses.find((b) => b.plateNumb === targetPlate);
  if (!target) return [];

  return [
    {
      ...target,
      routeName: leg.routeName,
      city: leg.tdxCity ?? "",
      isTarget: true,
      estimateTime: arrival.eta,
    },
  ];
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
 * - Keeps the last good position on a transient error instead of blanking.
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
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const refresh = async () => {
      const current = legRef.current;
      if (!current) return;
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;

      try {
        const buses = await fetchLeg(current, signal);
        if (cancelled || signal.aborted) return;
        setLiveBusPositions(buses);
      } catch {
        // Transient failure: keep the last good position, next tick retries.
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
      document.removeEventListener("visibilitychange", onVisibility);
      setLiveBusPositions([]);
    };
  }, [legKey, setLiveBusPositions]);
}
