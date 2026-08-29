import { AlertTriangle, ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { useAppTranslation } from "@/i18n/client";
import { cn } from "@/lib/utils";
import type {
  WalkAbsoluteDirection,
  WalkRelativeDirection,
  WalkStep,
} from "@/types/route";
import { formatDistance } from "@/types/route";

const DIRECTION_KEY = {
  DEPART: "walkDirDepart",
  CONTINUE: "walkDirContinue",
  STRAIGHT: "walkDirStraight",
  LEFT: "walkDirLeft",
  RIGHT: "walkDirRight",
  SLIGHTLY_LEFT: "walkDirSlightlyLeft",
  SLIGHTLY_RIGHT: "walkDirSlightlyRight",
  HARD_LEFT: "walkDirHardLeft",
  HARD_RIGHT: "walkDirHardRight",
  UTURN_LEFT: "walkDirUturnLeft",
  UTURN_RIGHT: "walkDirUturnRight",
  CIRCLE_CLOCKWISE: "walkDirCircleClockwise",
  CIRCLE_COUNTERCLOCKWISE: "walkDirCircleCounterclockwise",
  ELEVATOR: "walkDirElevator",
  ESCALATOR: "walkDirEscalator",
  MOVING_WALKWAY: "walkDirMovingWalkway",
  FARE_GATE: "walkDirFareGate",
  ENTER_STATION: "walkDirEnterStation",
  EXIT_STATION: "walkDirExitStation",
} satisfies Record<WalkRelativeDirection, string>;

const ABSOLUTE_DIRECTION_KEY = {
  NORTH: "walkDirNorth",
  NORTHEAST: "walkDirNortheast",
  EAST: "walkDirEast",
  SOUTHEAST: "walkDirSoutheast",
  SOUTH: "walkDirSouth",
  SOUTHWEST: "walkDirSouthwest",
  WEST: "walkDirWest",
  NORTHWEST: "walkDirNorthwest",
} satisfies Record<WalkAbsoluteDirection, string>;

// Facilities are places, not headings — gluing a street name onto them would
// describe a turn that never happens.
const FACILITY_DIRECTIONS = new Set<WalkRelativeDirection>([
  "ELEVATOR",
  "ESCALATOR",
  "MOVING_WALKWAY",
  "FARE_GATE",
  "ENTER_STATION",
  "EXIT_STATION",
]);

const ALONG_DIRECTIONS = new Set<WalkRelativeDirection>([
  "DEPART",
  "CONTINUE",
  "STRAIGHT",
]);

function useStepText() {
  const { t } = useAppTranslation();
  return (step: WalkStep): string => {
    const action = t(DIRECTION_KEY[step.relativeDirection]);
    const street = step.bogusName ? "" : step.streetName.trim();
    const text =
      !street || FACILITY_DIRECTIONS.has(step.relativeDirection)
        ? action
        : t(
            step.area || !ALONG_DIRECTIONS.has(step.relativeDirection)
              ? "walkStepInto"
              : "walkStepAlong",
            { street, action },
          );

    return step.absoluteDirection
      ? `${text} · ${t(ABSOLUTE_DIRECTION_KEY[step.absoluteDirection])}`
      : text;
  };
}

export function WalkStepsList({ steps }: { steps?: WalkStep[] }) {
  const { t } = useAppTranslation();
  const stepText = useStepText();
  const [isOpen, setIsOpen] = useState(false);
  const listId = useId();

  if (!steps || steps.length === 0) return null;

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-controls={listId}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 px-2 py-2.5 lg:py-1 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
      >
        <ChevronDown
          className={cn(
            "h-3 w-3 shrink-0 transition-transform duration-200 ease-out motion-reduce:transition-none",
            isOpen && "rotate-180",
          )}
        />
        <span>{t("viewWalkSteps") ?? "查看步行細節"}</span>
      </button>
      <div
        id={listId}
        aria-hidden={!isOpen}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none",
          isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden">
          <ul className="pl-3.5 my-2 space-y-1.5 border-l border-muted-foreground/30 ml-3.5">
            {steps.map((step) => (
              <li
                key={`${step.relativeDirection}-${step.streetName}-${step.distanceM}-${step.location.join(",")}`}
                className="text-xs text-muted-foreground"
              >
                <span
                  className={cn(
                    step.stairs
                      ? "text-red-600 dark:text-red-400 font-medium"
                      : step.steepSlope
                        ? "text-amber-600 dark:text-amber-400 font-medium"
                        : "text-foreground",
                  )}
                >
                  {stepText(step)}
                </span>
                {step.stairs && (
                  <>
                    {" · "}
                    <span className="inline-flex items-center gap-0.5 text-red-600 dark:text-red-400 font-medium">
                      <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
                      {t("walkStepStairsWarning")}
                    </span>
                  </>
                )}
                {step.steepSlope && (
                  <>
                    {" · "}
                    <span className="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400 font-medium">
                      <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
                      {t("walkStepSteepSlopeWarning")}
                    </span>
                  </>
                )}
                {" · "}
                {formatDistance(step.distanceM)}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
