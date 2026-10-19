"use client";

import { Building2, Footprints, MapPin } from "lucide-react";
import { useAppTranslation } from "@/i18n/client";
import {
  type VenueJourney,
  type VenueRouteSection,
  venueRouteSections,
  venueSectionStepLabel,
} from "@/lib/indoor/journey";
import { cn } from "@/lib/utils";
import { formatDistance } from "@/types/route";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../ui/accordion";
import VenueStepIcon, { isFloorChange } from "./VenueStepIcon";

export function venueSectionLabel(
  section: VenueRouteSection,
  outdoorLabel: string,
) {
  if (section.levelRef === null) return outdoorLabel;
  return section.buildingName
    ? `${section.buildingName} · ${section.levelRef}`
    : section.levelRef;
}

function SectionNode({ outdoor }: { outdoor: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center justify-center w-8 h-8 rounded-full border-2",
        outdoor
          ? "border-blue-500/55 bg-blue-500/10 text-blue-500"
          : "border-primary/55 bg-primary/10 text-primary",
      )}
    >
      {outdoor ? (
        <Footprints className="h-4 w-4" aria-hidden />
      ) : (
        <Building2 className="h-4 w-4" aria-hidden />
      )}
    </div>
  );
}

/** The same leg timeline as an outdoor route card, one node per floor. */
export default function VenueRouteSteps({
  journey,
  showArrival = false,
  title,
}: {
  journey: VenueJourney;
  showArrival?: boolean;
  title?: string;
}) {
  const { t } = useAppTranslation();
  const sections = venueRouteSections(journey);
  return (
    <Accordion
      type="single"
      collapsible
      defaultValue="route-steps"
      className="rounded-xl border px-3"
    >
      <AccordionItem value="route-steps" className="border-none">
        <AccordionTrigger className="min-h-11 py-2 hover:no-underline">
          {title ?? t("venueRouteSteps")}
        </AccordionTrigger>
        <AccordionContent className="pb-1">
          <ol className="relative" aria-label={t("venueRouteSteps")}>
            {sections.map((section, index) => {
              const outdoor = section.levelRef === null;
              const hasNext = index < sections.length - 1 || showArrival;
              return (
                <li key={section.key} className="relative pl-8">
                  {hasNext && (
                    <div
                      className={cn(
                        "absolute left-3.5 top-10 bottom-1 w-0.5 rounded-full",
                        outdoor ? "bg-blue-500/40" : "bg-primary/40",
                      )}
                    />
                  )}
                  <div className="absolute left-0 top-0">
                    <SectionNode outdoor={outdoor} />
                  </div>
                  <div className="ml-4 pb-4">
                    <p className="flex items-baseline justify-between gap-3 pt-1.5">
                      <span className="text-sm font-semibold">
                        {venueSectionLabel(section, t("routeOutdoorSection"))}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                        {formatDistance(section.distanceM)}
                      </span>
                    </p>
                    <ul className="mt-2 space-y-1.5">
                      {section.steps.map((step) => {
                        const label = venueSectionStepLabel(step, t);
                        const distance = Math.round(step.distanceM);
                        const floorChange = isFloorChange(step);
                        return (
                          <li
                            key={`${step.startIndex}-${step.endIndex}-${step.kind}`}
                            className={cn(
                              "flex items-start gap-2 text-sm",
                              floorChange &&
                                "rounded-lg bg-primary/10 px-2 py-1.5 font-medium text-primary",
                              step.heightPending &&
                                "text-amber-700 dark:text-amber-400",
                            )}
                          >
                            <VenueStepIcon
                              step={step}
                              className={cn(
                                "h-4 w-4 shrink-0 mt-0.5",
                                !floorChange && "text-muted-foreground",
                              )}
                              aria-hidden
                            />
                            <span className="flex-1 min-w-0">{label}</span>
                            {!floorChange &&
                              distance >= 1 &&
                              !new RegExp(`${distance}\\s*(公尺|m\\b)`).test(
                                label,
                              ) && (
                                <span className="text-xs text-muted-foreground tabular-nums shrink-0 mt-0.5">
                                  {formatDistance(step.distanceM)}
                                </span>
                              )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </li>
              );
            })}
            {showArrival && (
              <li className="relative pl-8">
                <div className="absolute left-0 top-0 flex items-center justify-center w-8 h-8 rounded-full border-2 border-red-500/55 bg-red-500/10 text-red-500">
                  <MapPin className="h-4 w-4" aria-hidden />
                </div>
                <p className="ml-4 pb-3 pt-1.5 text-sm font-semibold">
                  {t(
                    journey.to.arrivalKind === "corridor"
                      ? "venueArriveAtCorridor"
                      : "venueArriveAt",
                    { destination: journey.to.name },
                  )}
                </p>
              </li>
            )}
          </ol>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
