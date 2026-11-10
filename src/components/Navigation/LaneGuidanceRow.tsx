import {
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  CornerUpLeft,
  CornerUpRight,
  type LucideIcon,
  Undo2,
} from "lucide-react";
import { type LaneGuidance, laneNumbers } from "@/lib/navigation/roadGuidance";
import type { RoadLane, RoadLaneDirection } from "@/types/route";

/** Same arrow glyphs as the turn icons (navStepIcon). */
const LANE_ICON: Record<RoadLaneDirection, LucideIcon> = {
  none: ArrowUp,
  straight: ArrowUp,
  left: CornerUpLeft,
  slight_left: ArrowUpLeft,
  sharp_left: CornerUpLeft,
  right: CornerUpRight,
  slight_right: ArrowUpRight,
  sharp_right: CornerUpRight,
  uturn: Undo2,
  merge_left: ArrowUpLeft,
  merge_right: ArrowUpRight,
};

/** A recommended lane shows the arrow it is recommended for. */
function laneDirection(lane: RoadLane): RoadLaneDirection {
  return lane.recommendation !== "not_recommended" && lane.maneuverDirection
    ? lane.maneuverDirection
    : (lane.directions[0] ?? "none");
}

/** Preferred = filled, usable = outlined, not recommended = dimmed, no box. */
const LANE_CLASS: Record<RoadLane["recommendation"], string> = {
  preferred: "bg-white text-slate-900",
  usable: "border border-white/60 text-white",
  not_recommended: "text-white/40",
};

export function laneGuidanceLabel(
  lanes: readonly RoadLane[],
  t: (key: string, options?: Record<string, string | number>) => string,
): string {
  const join = (numbers: number[]) => numbers.join(t("laneListSeparator"));
  const preferred = laneNumbers(lanes, "preferred");
  const usable = laneNumbers(lanes, "usable");
  const parts = [t("laneCount", { count: lanes.length })];
  if (preferred.length)
    parts.push(t("lanePreferred", { lanes: join(preferred) }));
  if (usable.length)
    parts.push(
      t(preferred.length ? "laneAlsoUsable" : "laneUsable", {
        lanes: join(usable),
      }),
    );
  return parts.join(t("laneClauseSeparator"));
}

/** Lanes for the upcoming maneuver, left to right, inside the turn banner. */
export function LaneGuidanceRow({
  guidance,
  t,
}: {
  guidance: LaneGuidance;
  t: (key: string, options?: Record<string, string | number>) => string;
}) {
  return (
    <div className="flex items-center gap-2.5 bg-white/5 border-t border-white/10 px-6 py-3">
      <div
        role="img"
        aria-label={laneGuidanceLabel(guidance.lanes, t)}
        className="flex items-center gap-1 shrink-0"
      >
        {guidance.lanes.map((lane, index) => {
          const Icon = LANE_ICON[laneDirection(lane)];
          return (
            <span
              // Lanes have no identity beyond their left-to-right position.
              // biome-ignore lint/suspicious/noArrayIndexKey: positional lanes
              key={index}
              aria-hidden="true"
              className={`h-8 w-8 rounded-lg flex items-center justify-center ${LANE_CLASS[lane.recommendation]}`}
            >
              <Icon className="h-4.5 w-4.5" />
            </span>
          );
        })}
      </div>
      {guidance.laneHint && (
        <span
          aria-hidden="true"
          className="min-w-0 text-sm text-white/70 line-clamp-2"
        >
          {guidance.laneHint}
        </span>
      )}
    </div>
  );
}
