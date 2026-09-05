"use client";

import { Accessibility, Bus } from "lucide-react";
import { useEffect, useRef } from "react";
import { Marker } from "react-map-gl/maplibre";
import { type AnimatedBus, useAnimatedBuses } from "@/hook/useAnimatedBuses";
import { useLiveBusPositions } from "@/hook/useLiveBusPositions";
import { resolveActiveBusLegOrdinal } from "@/lib/navigation/legMode";
import useMapStore from "@/stores/useMapStore";
import useNavStore from "@/stores/useNavStore";
import type { BusLeg } from "@/types/route";

function isAccessible(bus: AnimatedBus): boolean {
  return bus.isLowFloor === "是" || bus.hasLiftOrRamp === "是";
}

/**
 * A bare "約 17 分" is unreadable — seventeen minutes until what? The countdown
 * is always to the leg's boarding stop, so the label says which stop.
 */
function etaLabel(bus: AnimatedBus): string {
  const eta = bus.estimateTime;
  const stop = bus.etaStopName;
  if (typeof eta !== "number") return "你的車";
  if (eta <= 1) return stop ? `即將進 ${stop}` : "即將進站";
  return stop ? `${stop} 約 ${eta} 分` : `約 ${eta} 分`;
}

/** The vehicle the user is about to board — large, pulsing, labelled. */
function TargetBusMarker({ bus }: { bus: AnimatedBus }) {
  const accessible = isAccessible(bus);
  const accentBg = accessible ? "bg-blue-600" : "bg-slate-700";
  const accentBorder = accessible ? "border-b-blue-600" : "border-b-slate-700";
  const ringBg = accessible ? "bg-blue-500/40" : "bg-slate-500/40";

  return (
    <Marker
      longitude={bus.lng}
      latitude={bus.lat}
      anchor="center"
      style={{ zIndex: 10 }}
    >
      <div className="relative flex h-9 w-9 items-center justify-center">
        {/* attention-grabbing pulse */}
        <span
          className={`absolute inline-flex h-full w-full animate-ping rounded-full ${ringBg}`}
        />
        {/* heading indicator (triangle orbits the circle toward travel dir) */}
        <div
          className="absolute inset-0 z-10"
          style={{ transform: `rotate(${bus.bearing}deg)` }}
        >
          <span
            className={`absolute -top-1.5 left-1/2 h-0 w-0 -translate-x-1/2 border-x-[5px] border-x-transparent border-b-[7px] ${accentBorder}`}
          />
        </div>
        {/* vehicle badge */}
        <div
          className={`relative z-20 flex h-9 w-9 items-center justify-center rounded-full border-2 border-white text-white shadow-lg ${accentBg}`}
        >
          {accessible ? (
            <Accessibility className="h-5 w-5" />
          ) : (
            <Bus className="h-5 w-5" />
          )}
        </div>
        {/* callout */}
        <div className="absolute left-1/2 top-[calc(100%+5px)] z-20 flex -translate-x-1/2 flex-col items-center gap-0.5">
          <div
            className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold text-white shadow ${accentBg}`}
          >
            {etaLabel(bus)}
          </div>
          <div className="flex items-center gap-1 whitespace-nowrap rounded-full border bg-background/90 px-1.5 py-0.5 text-xs font-medium text-foreground shadow-sm">
            {accessible && <Accessibility className="h-3 w-3 text-blue-600" />}
            {bus.plateNumb}
          </div>
        </div>
      </div>
    </Marker>
  );
}

/**
 * While navigating, the user cannot reach the route card to expand a segment,
 * so the leg they are riding (or heading toward) is tracked for them.
 */
function useNavigationBusTracking() {
  const isNavigating = useMapStore((s) => s.isNavigating);
  const selectRoute = useMapStore((s) => s.selectRoute);
  const setActiveBusLeg = useMapStore((s) => s.setActiveBusLeg);
  const instructions = useNavStore((s) => s.instructions);
  const currentStepIndex = useNavStore((s) => s.currentStepIndex);

  // Every GPS tick re-runs this effect; writing the same leg again would clear
  // liveBusPositions and restart polling, making the marker blink.
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    // Outside navigation the route card owns the tracking decision; only undo
    // what this effect itself set.
    if (!isNavigating) {
      if (lastKeyRef.current !== null) {
        lastKeyRef.current = null;
        setActiveBusLeg(null);
      }
      return;
    }

    const busLegs = (selectRoute?.route?.legs ?? []).filter(
      (leg): leg is BusLeg => leg.type === "BUS",
    );
    const ordinal = resolveActiveBusLegOrdinal(instructions, currentStepIndex);
    const leg = ordinal == null ? undefined : busLegs[ordinal];
    const nextKey = leg
      ? `nav:${ordinal}:${leg.routeName}:${leg.direction}:${leg.departureStop}`
      : null;

    if (nextKey === lastKeyRef.current) return;
    lastKeyRef.current = nextKey;
    setActiveBusLeg(nextKey && leg ? { key: nextKey, leg } : null);
  }, [
    isNavigating,
    selectRoute?.route?.legs,
    instructions,
    currentStepIndex,
    setActiveBusLeg,
  ]);

  useEffect(
    () => () => {
      if (lastKeyRef.current !== null) setActiveBusLeg(null);
    },
    [setActiveBusLeg],
  );
}

export default function LiveBusWrapper() {
  // Starts/owns the 15s polling lifecycle while a bus leg is being tracked.
  useLiveBusPositions();
  useNavigationBusTracking();
  const liveBusPositions = useMapStore((s) => s.liveBusPositions);
  const buses = useAnimatedBuses(liveBusPositions);

  // The store already guarantees at most one vehicle; find() is the guard.
  const bus = buses.find((b) => b.isTarget);
  if (!bus) return null;

  return <TargetBusMarker bus={bus} />;
}
