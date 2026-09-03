import { useEffect, useRef, useState } from "react";
import type { RouteDetailStop } from "@/lib/api/transit";
import { getBusRouteDetail } from "@/lib/api/transit";
import { pickDirection } from "@/lib/transit/busLegStops";
import type { BusLeg } from "@/types/route";

export type BusLegEtaStatus = "idle" | "loading" | "ready" | "error";

const POLL_INTERVAL_MS = 20_000;

export function useBusLegStopEtas(
  leg: BusLeg | null,
  enabled: boolean,
): { stops: RouteDetailStop[] | null; status: BusLegEtaStatus } {
  const [stops, setStops] = useState<RouteDetailStop[] | null>(null);
  const [status, setStatus] = useState<BusLegEtaStatus>("idle");

  const city = leg?.tdxCity ?? leg?.cityCode ?? "";
  const routeName = leg?.routeName ?? "";
  const direction = leg?.direction ?? 0;

  const legRef = useRef(leg);
  legRef.current = leg;

  useEffect(() => {
    if (!enabled || !legRef.current || !routeName || !city) {
      setStatus("idle");
      setStops(null);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const fetchEtas = async () => {
      try {
        const res = await getBusRouteDetail(routeName, city);
        if (cancelled) return;

        if (!res.ok || !res.data?.directions) {
          setStatus("error");
          return;
        }

        const picked = pickDirection(res.data.directions, direction);
        if (!picked) {
          setStatus("error");
          return;
        }

        setStops(picked);
        setStatus("ready");
      } catch {
        if (!cancelled) {
          setStatus("error");
        }
      }
    };

    function scheduleNext() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    }

    async function tick() {
      if (typeof document !== "undefined" && document.hidden) {
        scheduleNext();
        return;
      }
      await fetchEtas();
      if (!cancelled) scheduleNext();
    }

    function onVisibility() {
      if (!cancelled && !document.hidden) tick();
    }

    setStatus("loading");
    tick();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, routeName, city, direction]);

  return { stops, status };
}
