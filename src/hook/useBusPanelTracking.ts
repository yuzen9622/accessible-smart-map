"use client";

import { useEffect } from "react";
import { getBusArrival, getLiveBusPositions } from "@/lib/api/transit";
import {
  createTrackingPoller,
  matchArrival,
  matchVehicles,
  type TrackingTarget,
} from "@/lib/transit/busPanelTracking";
import useBusTrackingStore from "@/stores/useBusTrackingStore";

export default function useBusPanelTracking(target: TrackingTarget | null) {
  useEffect(() => {
    const publish = useBusTrackingStore.getState().publish;
    publish(null);
    if (!target) return;
    const stop = target.detail.stops[target.boarding];
    if (!stop || target.detail.direction === 255) return;
    const poller = createTrackingPoller({
      visible: () => document.visibilityState === "visible",
      publish,
      fetch: async (signal) => {
        const [arrival, positions] = await Promise.all([
          getBusArrival(
            target.routeName,
            stop.name,
            target.detail.direction,
            target.city,
            signal,
          ),
          getLiveBusPositions(
            target.routeName,
            target.city,
            target.detail.direction,
            signal,
          ),
        ]);
        if (
          !(arrival.ok || arrival.success) ||
          !(positions.ok || positions.success) ||
          !arrival.data ||
          !positions.data
        )
          throw new Error("Unavailable");
        // Row-level branch/direction matches cannot establish which query the
        // response belongs to. Reject mismatched or missing envelope identity.
        if (
          arrival.data.routeName !== target.routeName ||
          arrival.data.city !== target.city ||
          arrival.data.stopName !== stop.name ||
          positions.data.routeName !== target.routeName ||
          positions.data.city !== target.city
        )
          throw new Error("Mismatched bus tracking response");
        const now = Date.now();
        return {
          receivedAt: now,
          arrival: matchArrival(target, arrival.data.arrivals),
          buses: matchVehicles(target, positions.data.buses, now),
        };
      },
    });
    void poller.refresh();
    const timer = setInterval(() => {
      poller.tick();
      void poller.refresh();
    }, 15_000);
    const expiry = setInterval(poller.tick, 1000);
    document.addEventListener("visibilitychange", poller.visibility);
    return () => {
      clearInterval(timer);
      clearInterval(expiry);
      document.removeEventListener("visibilitychange", poller.visibility);
      poller.dispose();
    };
  }, [target]);
  return useBusTrackingStore((s) => s.snapshot);
}
