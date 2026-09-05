"use client";

import { NumberTicker } from "@/components/motion/number-ticker";
import { cn } from "@/lib/utils";

export interface DistanceParts {
  value: number;
  unit: "m" | "km";
  format?: (value: number) => string;
  text: string;
}

/**
 * Splits meter distance into numeric value, unit, and formatting
 * consistent with formatDistance() in route.ts:
 * - >= 100km: whole km (e.g. 120 km)
 * - >= 1km: 1 decimal place km (e.g. 1.2 km)
 * - < 10m: whole meters (e.g. 5 m)
 * - < 1km: rounded to nearest 10m (e.g. 580 m)
 */
export function getDistanceParts(
  meters: number | null | undefined,
): DistanceParts | null {
  if (meters == null || !Number.isFinite(meters)) return null;

  if (meters >= 100_000) {
    const val = Math.round(meters / 1000);
    return { value: val, unit: "km", text: `${val} km` };
  }
  if (meters >= 1000) {
    const val = Math.round(meters / 100);
    return {
      value: val,
      unit: "km",
      format: (v: number) => (v / 10).toFixed(1),
      text: `${(meters / 1000).toFixed(1)} km`,
    };
  }
  if (meters < 10) {
    const val = Math.round(meters);
    return { value: val, unit: "m", text: `${val} m` };
  }
  const val = Math.round(meters / 10) * 10;
  return { value: val, unit: "m", text: `${val} m` };
}

export interface NavDistanceTickerProps {
  meters: number | null | undefined;
  duration?: number;
  blur?: boolean;
  className?: string;
  digitClassName?: string;
  unitClassName?: string;
}

/**
 * NavDistanceTicker renders distance numbers using vanilla NumberTicker
 * with blur={true} and digit rolling effects when the distance changes.
 */
export function NavDistanceTicker({
  meters,
  duration = 0.5,
  blur = true,
  className,
  digitClassName,
  unitClassName,
}: NavDistanceTickerProps) {
  const parts = getDistanceParts(meters);
  if (!parts) return null;

  return (
    <span
      className={cn(
        "inline-flex items-center tabular-nums tracking-tight whitespace-nowrap",
        className,
      )}
    >
      <NumberTicker
        value={parts.value}
        format={parts.format}
        duration={duration}
        blur={blur}
        startOnView={false}
        digitClassName={digitClassName}
      />
      <span
        className={cn("ml-1 font-bold select-none opacity-80", unitClassName)}
      >
        {parts.unit}
      </span>
    </span>
  );
}
