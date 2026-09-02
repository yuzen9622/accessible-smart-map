import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ArrowUpLeft,
  ArrowUpRight,
  Bike,
  Bus,
  Car,
  CornerUpLeft,
  CornerUpRight,
  Flag,
  type LucideIcon,
  Navigation,
  Redo2,
  SquareParking,
  TramFront,
  Undo2,
} from "lucide-react";
import { isVehicleLegType } from "@/lib/navigation/legMode";
import type { NavInstruction } from "@/types/route";

/** Direction arrows, shared by every travel mode — a right turn looks the
 * same whether the user is walking or driving it. */
function directionIcon(step: NavInstruction): LucideIcon {
  switch (step.relativeDirection) {
    case "正前方":
      return ArrowUp;
    case "左前方":
      return ArrowUpLeft;
    case "右前方":
      return ArrowUpRight;
    case "左側":
      return CornerUpLeft;
    case "右側":
      return CornerUpRight;
    case "左後方":
      return Undo2;
    case "右後方":
      return Redo2;
    case "正後方":
      return ArrowDown;
    default:
      return ArrowUp;
  }
}

export function stepIcon(step: NavInstruction | undefined): LucideIcon {
  if (!step) return ArrowUp;

  // Vehicle legs get their own departure and end-of-leg glyphs: a driving leg
  // ends at a parking space, not at the door.
  if (isVehicleLegType(step.legType)) {
    switch (step.type) {
      case "depart":
        return step.legType === "MOTORCYCLE" ? Bike : Car;
      case "arrive":
      case "facility":
        return SquareParking;
      default:
        return directionIcon(step);
    }
  }

  switch (step.type) {
    case "arrive":
      return Flag;
    case "depart":
      return Navigation;
    case "transit_board":
    case "transit_alight":
      return step.legType === "BUS" ? Bus : TramFront;
    case "facility":
      return ArrowUpDown;
    default:
      return directionIcon(step);
  }
}
