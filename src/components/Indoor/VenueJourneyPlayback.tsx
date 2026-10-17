"use client";

import { useEffect } from "react";
import useMapStore from "@/stores/useMapStore";

/** A single clock survives sheet and building-view switches; it never advances guidance. */
export default function VenueJourneyPlayback() {
  const playing = useMapStore((s) => s.venueJourney?.preview.playing ?? false);
  useEffect(() => {
    if (!playing) return;
    let frame = 0,
      previous = 0;
    const tick = (now: number) => {
      const state = useMapStore.getState(),
        journey = state.venueJourney;
      if (!journey?.preview.playing || journey.guidance.status !== "idle")
        return;
      const elapsed = previous ? Math.min((now - previous) / 1000, 0.1) : 0;
      previous = now;
      const progress = Math.max(
        0,
        Math.min(
          1,
          journey.preview.progress +
            (journey.preview.direction * elapsed * 1.8) /
              Math.max(journey.route.distanceM, 1),
        ),
      );
      state.setVenueJourneyPreview({
        progress,
        playing: !(journey.preview.direction === 1
          ? progress >= 1
          : progress <= 0),
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);
  return null;
}
