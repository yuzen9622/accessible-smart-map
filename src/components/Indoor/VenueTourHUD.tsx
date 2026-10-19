"use client";

import { ChevronRight, List, MapPin, Square } from "lucide-react";
import { Fragment, useState } from "react";
import { useAppTranslation } from "@/i18n/client";
import { indoorModelVersion, venueBuildingKey } from "@/lib/indoor/catalog";
import {
  type VenueJourney,
  type VenueRouteSection,
  venueJourneyStepLabel,
  venueRouteSections,
} from "@/lib/indoor/journey";
import type { LocalIndoorModel } from "@/lib/indoor/types";
import { stopNavigation } from "@/lib/navigation/navigationLifecycle";
import { cn } from "@/lib/utils";
import useIndoorCatalog from "@/stores/useIndoorCatalog";
import useMapStore from "@/stores/useMapStore";
import useNavStore from "@/stores/useNavStore";
import { formatDistance } from "@/types/route";
import { venueSectionLabel } from "../shared/VenueRouteSteps";
import VenueStepIcon from "../shared/VenueStepIcon";

function journeyModels(models: LocalIndoorModel[], journey: VenueJourney) {
  return models.filter(
    (model) =>
      model.venueId === journey.venueId &&
      indoorModelVersion(model) === journey.sourceVersion,
  );
}

/** Outdoor stretches are drawn with the ground floor of a neighbouring building. */
function sectionView(
  sections: VenueRouteSection[],
  index: number,
  models: LocalIndoorModel[],
) {
  const section = sections[index];
  const anchor =
    section.levelRef !== null
      ? section
      : (sections.slice(index + 1).find((item) => item.levelRef !== null) ??
        sections.slice(0, index).findLast((item) => item.levelRef !== null));
  const model = models.find((item) => item.building.id === anchor?.buildingId);
  if (!model) return null;
  const level =
    section.levelRef === null
      ? model.building.levels.find((item) => item.ordinal === 0)
      : model.building.levels.find((item) => item.ref === section.levelRef);
  return level ? { model, ordinal: level.ordinal } : null;
}

function showSection(view: NonNullable<ReturnType<typeof sectionView>>) {
  const catalog = useIndoorCatalog.getState();
  if (
    !useMapStore.getState().indoorExploring ||
    catalog.activeBuildingKey !== venueBuildingKey(view.model)
  )
    catalog.showBuilding(view.model);
  useIndoorCatalog.getState().setActiveLevel(view.ordinal);
}

/** Floating indoor controls sit below the banner, whose height follows the
 * instruction length and the chip row. */
function publishBannerHeight(node: HTMLDivElement | null) {
  if (!node) return;
  const root = document.documentElement;
  const observer = new ResizeObserver(() =>
    root.style.setProperty(
      "--nav-hud-h",
      `${node.getBoundingClientRect().bottom}px`,
    ),
  );
  observer.observe(node);
  return () => {
    observer.disconnect();
    root.style.removeProperty("--nav-hud-h");
  };
}

/** The outdoor navigation chrome, driven by floors instead of a location fix:
 * the map shows one floor of the route at a time and the user picks it. */
export default function VenueTourHUD() {
  const { t } = useAppTranslation();
  const journey = useMapStore((s) => s.venueJourney);
  const models = useIndoorCatalog((s) => s.models);
  const activeKey = useIndoorCatalog((s) => s.activeBuildingKey);
  const activeLevel = useIndoorCatalog((s) => s.activeLevel);
  const exploring = useMapStore((s) => s.indoorExploring);
  const stepListOpen = useNavStore((s) => s.stepListOpen);
  const setStepListOpen = useNavStore((s) => s.setStepListOpen);
  const [chosen, setChosen] = useState(0);
  if (journey?.guidance.status !== "touring") return null;

  const sections = venueRouteSections(journey);
  const venue = journeyModels(models, journey);
  const views = sections.map((_, index) => sectionView(sections, index, venue));
  const displays = (index: number) => {
    const view = views[index];
    return Boolean(
      exploring &&
        view &&
        venueBuildingKey(view.model) === activeKey &&
        view.ordinal === activeLevel,
    );
  };
  // A ground floor is shared by its building and the campus outside it, so
  // the section the user picked wins over the first one that matches.
  const current = displays(chosen)
    ? chosen
    : Math.max(
        sections.findIndex((_, index) => displays(index)),
        0,
      );
  const section = sections[current];
  const goal = section?.steps.at(-1);
  const last = current === sections.length - 1;
  const destination = t(
    journey.to.arrivalKind === "corridor"
      ? "venueArriveAtCorridor"
      : "venueArriveAt",
    { destination: journey.to.name },
  );

  return (
    <>
      <div
        ref={publishBannerHeight}
        className="absolute top-3 left-3 right-3 lg:left-1/2 lg:right-auto lg:-translate-x-1/2 lg:w-[560px] z-40"
      >
        <div className="bg-slate-900 dark:ring-1 dark:ring-white/10 text-white rounded-2xl shadow-2xl overflow-hidden">
          <div className="flex items-center gap-3.5 px-4 py-4 sm:px-6">
            <div className="h-14 w-14 rounded-2xl bg-white/10 flex items-center justify-center shrink-0">
              {last || !goal ? (
                <MapPin className="h-8 w-8" />
              ) : (
                <VenueStepIcon step={goal} className="h-8 w-8" />
              )}
            </div>
            <div className="flex-1 min-w-0" aria-live="polite">
              <p className="text-xl font-bold leading-snug line-clamp-2">
                {last || !goal ? destination : venueJourneyStepLabel(goal, t)}
              </p>
              {section && (
                <p className="text-sm text-white/70 mt-1 tabular-nums truncate">
                  {venueSectionLabel(section, t("routeOutdoorSection"))} ·{" "}
                  {formatDistance(section.distanceM)}
                </p>
              )}
            </div>
          </div>
          {sections.length > 1 && (
            <nav
              aria-label={t("venueRouteFloors")}
              className="flex items-center gap-1 overflow-x-auto bg-white/5 border-t border-white/10 px-3 py-2.5 sm:px-5 [scrollbar-width:none]"
            >
              {sections.map((item, index) => {
                const view = views[index];
                const sameBuilding =
                  index > 0 &&
                  item.levelRef !== null &&
                  sections[index - 1].buildingId === item.buildingId;
                return (
                  <Fragment key={item.key}>
                    {index > 0 && (
                      <ChevronRight
                        className="h-3.5 w-3.5 shrink-0 text-white/30"
                        aria-hidden
                      />
                    )}
                    <button
                      type="button"
                      disabled={!view}
                      aria-current={index === current ? "step" : undefined}
                      onClick={() => {
                        if (!view) return;
                        setChosen(index);
                        showSection(view);
                      }}
                      className={cn(
                        "shrink-0 rounded-full px-3 min-h-9 text-sm font-semibold whitespace-nowrap transition-[background-color,transform] active:scale-[0.97] disabled:opacity-40",
                        index === current
                          ? "bg-white text-slate-900"
                          : "bg-white/10 text-white/80 hover:bg-white/20",
                      )}
                    >
                      {sameBuilding
                        ? item.levelRef
                        : venueSectionLabel(item, t("routeOutdoorSection"))}
                    </button>
                  </Fragment>
                );
              })}
            </nav>
          )}
        </div>
      </div>

      <div
        className={cn(
          "absolute bottom-3 left-3 right-3 lg:left-1/2 lg:right-auto lg:-translate-x-1/2 lg:w-[560px] xl:w-[640px] z-40",
          // On phones the open step list is the bottom sheet itself.
          stepListOpen && "hidden lg:block",
        )}
      >
        <div className="bg-background/95 backdrop-blur-md border border-border/50 rounded-2xl shadow-2xl px-5 py-4 flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-3xl font-black leading-tight text-green-600 dark:text-green-400 tabular-nums truncate">
              {formatDistance(journey.route.distanceM)}
            </p>
            <p className="text-sm text-muted-foreground truncate mt-0.5">
              {destination}
            </p>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setStepListOpen(!stepListOpen)}
              aria-label={t("stepList")}
              aria-pressed={stepListOpen}
              className={cn(
                "h-11 w-11 rounded-full flex items-center justify-center transition-colors",
                stepListOpen
                  ? "bg-primary/10 text-primary"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted",
              )}
            >
              <List className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={stopNavigation}
              aria-label={t("endNav")}
              className="flex items-center justify-center gap-2 bg-red-500 hover:bg-red-600 text-white rounded-full h-12 w-12 sm:w-auto sm:px-6 text-sm font-bold transition-colors shadow-lg"
            >
              <Square className="h-4 w-4 shrink-0" />
              <span className="hidden sm:inline">{t("endNav")}</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
