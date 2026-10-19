"use client";

import { useAppTranslation } from "@/i18n/client";
import {
  type VenueJourney,
  venueJourneyStepLabel,
  venueJourneySteps,
} from "@/lib/indoor/journey";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../ui/accordion";
import { Card, CardContent } from "../ui/card";

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
  const steps = venueJourneySteps(journey);
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
        <AccordionContent className="pb-3">
          <ol className="space-y-2" aria-label={t("venueRouteSteps")}>
            {steps.map((step, index) => {
              return (
                <li key={`${step.startIndex}-${step.endIndex}-${step.kind}`}>
                  <Card className="gap-0 border-transparent bg-muted/40 py-0 shadow-none">
                    <CardContent className="flex items-start gap-3 p-3 text-sm">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-background text-xs font-semibold text-foreground">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-foreground">
                          {venueJourneyStepLabel(step, t)}
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {t("venueStepDistance", {
                            distance: Math.round(step.distanceM),
                          })}
                        </span>
                      </span>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
            {showArrival && (
              <li>
                <Card className="gap-0 border-transparent bg-muted/40 py-0 shadow-none">
                  <CardContent className="flex items-start gap-3 p-3 text-sm">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-background text-xs font-semibold text-foreground">
                      {steps.length + 1}
                    </span>
                    <span className="text-foreground">
                      {t(
                        journey.to.arrivalKind === "corridor"
                          ? "venueArriveAtCorridor"
                          : "venueArriveAt",
                        { destination: journey.to.name },
                      )}
                    </span>
                  </CardContent>
                </Card>
              </li>
            )}
          </ol>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
