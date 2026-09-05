import { useEffect, useRef, useState } from "react";
import type { RouteDetailDirection } from "@/lib/api/transit";
import {
  fetchRouteDetailCached,
  peekRouteDetail,
} from "@/lib/transit/busRouteDetailCache";
import type { BusLeg } from "@/types/route";

export type BusLegEtaStatus = "idle" | "loading" | "ready" | "error";

const POLL_INTERVAL_MS = 20_000;

/**
 * Stop-by-stop ETAs for one BUS leg.
 *
 * `enabled` and `poll` are deliberately separate: selecting a route enables the
 * hook so the payload is already warm (and shared through the route-detail
 * cache) by the time the user expands the leg, while only expanding it starts
 * the 20s refresh. Fetching only on expand is what made every stop render as
 * 「尚未發車」 for the first second.
 *
 * Both directions are returned rather than the leg's declared one: picking the
 * direction that actually contains the ride is `resolveLegStops`' job, because
 * `leg.direction` does not reliably match TDX's numbering.
 */
export function useBusLegStopEtas(
  leg: BusLeg | null,
  enabled: boolean,
  poll: boolean,
): { directions: RouteDetailDirection[] | null; status: BusLegEtaStatus } {
  const city = leg?.tdxCity ?? leg?.cityCode ?? "";
  // TDX indexes stop sequences by sub-route: 99 and 99延 are different lists.
  // The planner names the run it chose, so ask for that one.
  const routeName = leg?.subRouteName ?? leg?.routeName ?? "";

  // Seed from an already-warm cache entry so the first render after expanding
  // shows real ETAs instead of a placeholder.
  const [directions, setDirections] = useState<RouteDetailDirection[] | null>(
    () => (routeName && city ? peekRouteDetail(routeName, city) : null),
  );
  const [status, setStatus] = useState<BusLegEtaStatus>(() =>
    routeName && city && peekRouteDetail(routeName, city) ? "ready" : "idle",
  );

  const legRef = useRef(leg);
  legRef.current = leg;

  useEffect(() => {
    if (!enabled || !legRef.current || !routeName || !city) {
      setStatus("idle");
      setDirections(null);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const fetchEtas = async (force: boolean) => {
      const fetched = await fetchRouteDetailCached(routeName, city, { force });
      if (cancelled) return;

      if (!fetched) {
        setStatus("error");
        return;
      }

      setDirections(fetched);
      setStatus("ready");
    };

    function scheduleNext() {
      if (timer) clearTimeout(timer);
      // Force, or the poll would be served from the route-detail cache and only
      // ever refresh because the TTL happens to be shorter than the interval.
      timer = setTimeout(() => tick(true), POLL_INTERVAL_MS);
    }

    async function tick(force = false) {
      if (typeof document !== "undefined" && document.hidden) {
        scheduleNext();
        return;
      }
      await fetchEtas(force);
      if (!cancelled) scheduleNext();
    }

    function onVisibility() {
      if (!cancelled && !document.hidden) tick(true);
    }

    // A warm cache entry means we already have data; don't flash a loading
    // state over it just because the effect re-ran.
    const warm = peekRouteDetail(routeName, city);
    if (warm) {
      setDirections(warm);
      setStatus("ready");
    } else {
      setStatus("loading");
    }

    if (poll) {
      tick();
      document.addEventListener("visibilitychange", onVisibility);
    } else {
      // Prefetch only: warm the shared cache once, no timer, no listener.
      void fetchEtas(false);
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, poll, routeName, city]);

  return { directions, status };
}
