import { Fragment } from "react";
import { useAppTranslation } from "@/i18n/client";
import {
  type VenueJourney,
  venueJourneyStepLabel,
  venueJourneySteps,
} from "@/lib/indoor/journey";
import type { AccessibleRoute } from "@/types/route";
import { formatDistance } from "@/types/route";
import { getLegKey } from "./utils";
import { WalkStepItems } from "./WalkStepsList";

type Props = { journey: VenueJourney; approach?: AccessibleRoute };

export function VenueWalkSummary({ journey, approach }: Props) {
  const { t } = useAppTranslation();
  const approachDistance =
    approach?.legs.reduce(
      (total, leg) => total + (leg.type === "WALK" ? leg.distanceM : 0),
      0,
    ) ?? 0;
  return (
    <p className="text-xs text-muted-foreground">
      <span className="text-blue-600 dark:text-blue-400">
        {[journey.to.buildingName, journey.to.levelRef]
          .filter(Boolean)
          .join(" · ")}
      </span>
      {" · "}
      {t("venueWalkDistance", {
        distance: formatDistance(journey.route.distanceM),
      })}
      {approachDistance > 0 && (
        <>
          {" · "}
          {t("venueApproachDistance", {
            distance: formatDistance(approachDistance),
          })}
        </>
      )}
    </p>
  );
}

/** List items for the existing walking disclosure, never synthetic API legs. */
export function VenueWalkSteps({ journey, approach }: Props) {
  const { t } = useAppTranslation();
  return (
    <>
      {approach?.legs.map((leg) =>
        leg.type === "WALK" ? (
          <Fragment key={getLegKey(leg)}>
            {leg.steps?.length ? (
              <WalkStepItems
                steps={leg.steps}
                stepStreetNames={leg.stepStreetNames}
                displayLanguage={leg.displayLanguage}
              />
            ) : (
              <li className="text-xs text-foreground">
                {t("walk")}
                {" · "}
                {formatDistance(leg.distanceM)}
              </li>
            )}
          </Fragment>
        ) : null,
      )}
      {!journey.route.context && (
        <li className="pt-1 text-xs font-medium text-foreground">
          {t("venueArriveAt", { destination: journey.from.name })}
        </li>
      )}
      {venueJourneySteps(journey).map((step) => {
        const entersBuilding = step.fromLevel === null && step.toLevel !== null;
        const changesFloor =
          step.fromLevel !== null &&
          step.toLevel !== null &&
          step.fromLevel !== step.toLevel;
        return (
          <li
            key={`${step.startIndex}-${step.endIndex}-${step.action ?? step.kind}-${step.instruction ?? ""}`}
            className="text-xs text-muted-foreground"
          >
            <span
              className={
                changesFloor
                  ? "font-medium text-blue-600 dark:text-blue-400"
                  : "text-foreground"
              }
            >
              {venueJourneyStepLabel(step, t)}
            </span>
            {step.distanceM > 0 && step.kind !== "elevator" && (
              <> · {formatDistance(step.distanceM)}</>
            )}
            {entersBuilding && !step.instruction && (
              <span className="block text-blue-600 dark:text-blue-400">
                {t("venueEnterBuilding", {
                  building: journey.to.buildingName,
                  floor: step.toLevel,
                })}
              </span>
            )}
          </li>
        );
      })}
      {!journey.route.context && (
        <li className="pt-1 text-xs font-medium text-blue-600 dark:text-blue-400">
          {t(
            journey.to.arrivalKind === "corridor"
              ? "venueArriveAtCorridor"
              : "venueArriveAt",
            { destination: journey.to.name },
          )}
        </li>
      )}
    </>
  );
}
