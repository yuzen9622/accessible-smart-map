"use client";

import { useEffect } from "react";
import { advanceVenueTourProgress } from "@/lib/indoor/tour";
import useMapStore from "@/stores/useMapStore";

/** Only the idle diagnostic preview advances a cursor. Product route animation
 * uses the renderer's repeating arrows and never advances journey progress. */
export default function VenueJourneyPlayback() {
  const playing = useMapStore((s) => s.venueJourney?.preview.playing ?? false);
  const status = useMapStore((s) => s.venueJourney?.guidance.status);
  useEffect(() => {
    if (!playing) return;
    let frame = 0,
      previous = 0;
    const tick = (now: number) => {
      const state = useMapStore.getState(),
        journey = state.venueJourney;
      if (!journey?.preview.playing || journey.guidance.status !== "idle")
        return;
      if (document.hidden) {
        previous = 0;
        frame = requestAnimationFrame(tick);
        return;
      }
      const elapsed = previous ? Math.min((now - previous) / 1000, 0.1) : 0;
      previous = now;
      const next = advanceVenueTourProgress(
        journey.route,
        journey.preview.progress,
        journey.preview.direction,
        elapsed,
      );
      state.setVenueJourneyPreview(next);
      if (next.playing) frame = requestAnimationFrame(tick);
    };
    const visibility = () => {
      previous = 0;
    };
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const reduceMotion = (event: MediaQueryListEvent) => {
      if (event.matches)
        useMapStore.getState().setVenueJourneyPreview({ playing: false });
    };
    motion?.addEventListener?.("change", reduceMotion);
    if (status === "idle") {
      document.addEventListener("visibilitychange", visibility);
      frame = requestAnimationFrame(tick);
    }
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", visibility);
      motion?.removeEventListener?.("change", reduceMotion);
    };
  }, [playing, status]);
  return null;
}
