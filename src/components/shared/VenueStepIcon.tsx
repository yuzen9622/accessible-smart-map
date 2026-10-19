import { arrowsUpDownSquare, stairs } from "@lucide/lab";
import {
  ArrowUp,
  CornerUpLeft,
  CornerUpRight,
  DoorOpen,
  Icon,
  type LucideProps,
  TrendingUp,
  Undo2,
} from "lucide-react";
import type { IndoorRouteStep } from "@/lib/indoor/types";

export function isFloorChange(step: IndoorRouteStep) {
  return (
    ["elevator", "steps", "escalator"].includes(step.kind) &&
    step.fromLevel !== null &&
    step.toLevel !== null &&
    step.fromLevel !== step.toLevel
  );
}

/** Same glyph family as the outdoor manoeuvre icons and the facility pins. */
export default function VenueStepIcon({
  step,
  ...props
}: { step: IndoorRouteStep } & LucideProps) {
  if (step.kind === "elevator")
    return <Icon iconNode={arrowsUpDownSquare} {...props} />;
  if (step.kind === "steps" || step.kind === "escalator")
    return <Icon iconNode={stairs} {...props} />;
  if (step.kind === "ramp") return <TrendingUp {...props} />;
  if (step.action === "enter" || step.action === "exit")
    return <DoorOpen {...props} />;
  if (step.maneuver === "left") return <CornerUpLeft {...props} />;
  if (step.maneuver === "right") return <CornerUpRight {...props} />;
  if (step.maneuver === "uturn") return <Undo2 {...props} />;
  return <ArrowUp {...props} />;
}
