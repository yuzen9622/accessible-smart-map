"use client";

import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Navigation,
  Pause,
  Play,
  RotateCcw,
  Square,
} from "lucide-react";
import { useAppTranslation } from "@/i18n/client";
import { indoorModelVersion } from "@/lib/indoor/catalog";
import {
  type VenueJourney,
  venueJourneyConfirmLabel,
  venueJourneyStepLabel,
} from "@/lib/indoor/journey";
import { requiresElevatorOnly } from "@/lib/indoor/profilePolicy";
import { isVenueTourAllowed } from "@/lib/indoor/tour";
import {
  confirmVenueArrival,
  startNavigation,
  startVenueApproach,
  stopNavigation,
  venueApproachRouteKind,
} from "@/lib/navigation/navigationLifecycle";
import useIndoorCatalog from "@/stores/useIndoorCatalog";
import useMapStore from "@/stores/useMapStore";
import useNavStore from "@/stores/useNavStore";
import type { AccessibleRoute } from "@/types/route";
import { Button } from "../ui/button";

function approachFor(journey: VenueJourney, route?: AccessibleRoute) {
  return route?.routeToken
    ? journey.outdoor?.approachRoutes?.[route.routeToken]
    : undefined;
}

function walkingDistance(route: AccessibleRoute): number {
  return (
    route.totalWalkDistanceM ??
    route.legs.reduce(
      (distance, leg) => distance + (leg.type === "WALK" ? leg.distanceM : 0),
      0,
    )
  );
}

const transportLabels = {
  transit: "大眾運輸",
  drive: "開車",
  motorcycle: "機車",
  walk: "步行",
};

function transportLabel(
  route: AccessibleRoute,
  requested?: keyof typeof transportLabels,
): string {
  const types = new Set(route.legs.map((leg) => leg.type));
  if (types.has("DRIVE")) return transportLabels.drive;
  if (types.has("MOTORCYCLE")) return transportLabels.motorcycle;
  if (
    (["BUS", "METRO", "THSR", "TRA"] as const).some((type) => types.has(type))
  )
    return transportLabels.transit;
  if (types.has("WALK")) return transportLabels.walk;
  return requested ? transportLabels[requested] : "戶外路線";
}

/** Arrival here completes an outdoor leg, not the final indoor destination. */
export function venueOutdoorArrivalCopy(
  journey: VenueJourney | null,
  language = "zh-TW",
) {
  if (!journey?.outdoor || journey.guidance.status !== "outdoor") return null;
  const primary =
    journey.outdoor.routes[
      journey.outdoor.navigationIndex ?? journey.outdoor.selectedIndex
    ];
  const needsApproach =
    journey.outdoor.phase !== "approach" &&
    Boolean(approachFor(journey, primary));
  const needsDropOff =
    needsApproach && venueApproachRouteKind(primary) === "vehicle";
  const english = language.startsWith("en");
  return {
    needsApproach,
    needsDropOff,
    title: needsDropOff
      ? english
        ? "You have reached the drop-off point"
        : "已到下車點"
      : needsApproach
        ? english
          ? "Continue walking to the campus entrance"
          : "繼續步行前往校門"
        : english
          ? "Near the campus entrance"
          : "接近校門",
    description: needsApproach
      ? english
        ? `Continue on foot to ${journey.outdoor.arrival.name}, then follow the campus route to ${journey.to.name}.`
        : `${needsDropOff ? "請下車後" : "請繼續"}沿步行路線前往 ${journey.outdoor.arrival.name}，再接續校內路線至 ${journey.to.name}。`
      : english
        ? `At ${journey.outdoor.arrival.name}, continue campus guidance to ${journey.to.name}.`
        : `到達 ${journey.outdoor.arrival.name} 後，接續校內引導前往 ${journey.to.name}。`,
    actionLabel: needsApproach
      ? english
        ? "Continue on foot to the campus entrance"
        : needsDropOff
          ? "已下車，繼續前往校門"
          : "繼續步行前往校門"
      : english
        ? "Continue campus guidance"
        : "接續校內引導",
  };
}

export function VenueArrivalConfirmation({
  inHud = false,
  language = "zh-TW",
}: {
  inHud?: boolean;
  language?: string;
}) {
  const journey = useMapStore((s) => s.venueJourney);
  const arrived = useNavStore((s) => s.arrived);
  const copy = venueOutdoorArrivalCopy(journey, language);
  if (!arrived || !copy || !journey?.outdoor) return null;
  return (
    <div
      className={
        inHud
          ? "space-y-3"
          : "rounded-xl border border-primary/25 bg-primary/5 p-4 space-y-3"
      }
    >
      <p className="font-semibold">{copy.title}</p>
      <p className="text-sm text-muted-foreground">{copy.description}</p>
      <Button
        className="w-full"
        onClick={copy.needsApproach ? startVenueApproach : confirmVenueArrival}
      >
        {copy.actionLabel}
      </Button>
    </div>
  );
}

/** Route animation controls share the original navigation sheet. */
function VenueRouteTour({ journey }: { journey: VenueJourney }) {
  const { t } = useAppTranslation();
  const models = useIndoorCatalog((state) => state.models);
  const model = models.find(
    (item) =>
      item.venueId === journey.venueId &&
      item.building.id === journey.buildingId &&
      indoorModelVersion(item) === journey.sourceVersion,
  );
  const { playing } = journey.preview;
  const allowed = Boolean(model && isVenueTourAllowed(journey.route));
  const update = useMapStore.getState().setVenueJourneyPreview;
  return (
    <div
      className="space-y-3"
      data-venue-journey={journey.id}
      data-venue-tour="true"
    >
      <div>
        <p className="text-xs text-primary font-medium">
          {t("venueTourTitle")}
        </p>
        <p className="text-sm text-muted-foreground">
          {journey.from.name} → {journey.to.name}
        </p>
      </div>
      {!allowed && (
        <p className="text-sm text-muted-foreground">
          {t("venueTourUnavailable")}
        </p>
      )}
      <Button
        className="w-full gap-2"
        disabled={!allowed}
        aria-label={t(
          playing ? "venueRouteAnimationPause" : "venueRouteAnimationPlay",
        )}
        onClick={() =>
          update({ playing: !playing, following: false, direction: 1 })
        }
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        {t(playing ? "venueRouteAnimationPause" : "venueRouteAnimationPlay")}
      </Button>
      <p className="text-xs text-muted-foreground">
        {t("venueRouteManualView")}
      </p>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">
          {t("venueRouteSteps")}
        </summary>
        <ol className="mt-2 space-y-2">
          {journey.route.steps.map((step, index) => (
            <li
              key={`${step.startIndex}-${step.endIndex}-${step.kind}-${step.name}`}
              className="text-muted-foreground"
            >
              {index + 1}. {venueJourneyStepLabel(step, t)}
            </li>
          ))}
        </ol>
      </details>
      <Button
        variant="outline"
        className="w-full gap-2"
        onClick={stopNavigation}
      >
        <Square className="h-4 w-4" />
        {t("endNav")}
      </Button>
    </div>
  );
}

/** The existing route/navigation sheet owns this content; no separate panel. */
export default function VenueJourneyContent({
  navigating = false,
}: {
  navigating?: boolean;
}) {
  const { t } = useAppTranslation();
  const journey = useMapStore((s) => s.venueJourney);
  const setPreview = useMapStore((s) => s.setVenueJourneyPreview);
  const invalidTokens = useMapStore((s) => s.invalidRouteTokens);
  if (!journey) return null;
  if (journey.guidance.status === "touring")
    return <VenueRouteTour journey={journey} />;
  const active = journey.guidance.stepIndex;
  const arrived = journey.guidance.status === "arrived";
  const outdoorRoute = journey.outdoor?.routes[journey.outdoor.selectedIndex];
  const approachRoute = approachFor(journey, outdoorRoute);
  const approachSummary = approachRoute
    ? venueApproachRouteKind(outdoorRoute) === "vehicle"
      ? "（含下車後步行）"
      : "（含接續步行）"
    : "";
  const showIndoorDetails =
    !journey.outdoor ||
    journey.guidance.status === "guiding" ||
    journey.guidance.status === "arrived";
  const canStart =
    !journey.outdoor ||
    Boolean(
      outdoorRoute?.routeToken &&
        !invalidTokens.includes(outdoorRoute.routeToken),
    );
  const showVenue = () => useIndoorCatalog.getState().showPlace(journey.from);
  const back = () => {
    const state = useMapStore.getState();
    state.setVenueJourney(null);
    state.setSheetMode("plan");
  };
  return (
    <div className="space-y-4" data-venue-journey={journey.id}>
      {!navigating && (
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={back}
            aria-label="返回路線規劃"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Navigation className="h-5 w-5 text-primary shrink-0" />
          <h1 className="text-lg font-bold">路線規劃結果</h1>
        </div>
      )}

      {!navigating && (
        <div className="rounded-xl bg-muted/50 p-4 space-y-1">
          <p className="text-sm text-muted-foreground">
            {journey.outdoor
              ? journey.outdoor.origin.kind === "place"
                ? journey.outdoor.origin.place.name ||
                  journey.outdoor.origin.place.fullAddress
                : journey.outdoor.origin.address
              : journey.from.name}
          </p>
          <p className="font-semibold flex items-center gap-2">
            <ArrowRight className="h-4 w-4 shrink-0" />
            {journey.to.name}
          </p>
          <p className="text-sm text-muted-foreground">
            {journey.to.buildingName} · {journey.to.levelRef ?? "戶外"}
          </p>
          <p className="text-sm text-muted-foreground">
            {outdoorRoute &&
              `校外約 ${Math.round(outdoorRoute.totalMinutes + (approachRoute?.totalMinutes ?? 0))} 分鐘${approachSummary} · `}
            校內約 {Math.round(journey.route.distanceM)} 公尺
          </p>
          <p className="text-xs text-muted-foreground">
            {journey.mode === "elderly"
              ? "長者模式 · "
              : journey.mode === "visual_impaired"
                ? "視障模式 · "
                : ""}
            {journey.mode === "wheelchair" && "輪椅模式 · "}
            {requiresElevatorOnly(journey.mode)
              ? "校內跨樓層搭乘電梯，不使用樓梯"
              : "依路線安排通路與樓層移動"}
          </p>
        </div>
      )}

      {navigating ? (
        <>
          <p className="text-sm text-muted-foreground">
            {t("venueHeadingTo", { destination: journey.to.name })} ·{" "}
            {journey.to.levelRef ?? t("routeOutdoorSection")}
          </p>
          {arrived ? (
            <div
              role="status"
              className="rounded-xl border border-primary/25 bg-primary/5 p-4 space-y-2"
            >
              <CheckCircle2 className="h-7 w-7 text-primary" />
              <p className="font-semibold">
                {t(
                  journey.to.arrivalKind === "corridor"
                    ? "venueReachedCorridor"
                    : "venueReachedAt",
                  { destination: journey.to.name },
                )}
              </p>
              {journey.to.arrivalKind === "corridor" && (
                <p className="text-sm text-muted-foreground">
                  {t("venueCorridorArrivalNotice")}
                </p>
              )}
            </div>
          ) : (
            <div
              className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3"
              aria-live="polite"
            >
              <p className="text-xs text-primary">
                {t("venueStepCount", {
                  current: active + 1,
                  total: journey.route.steps.length,
                })}
              </p>
              <p className="font-semibold">
                {journey.route.steps[active]
                  ? venueJourneyStepLabel(journey.route.steps[active], t)
                  : t("venueConfirmArrival")}
              </p>
              {journey.route.steps[active]?.heightPending && (
                <p className="text-sm text-amber-800 dark:text-amber-300">
                  {t("venueStepHeightPending")}
                </p>
              )}
              <Button
                className="w-full h-12"
                onClick={() => useMapStore.getState().advanceVenueGuidance()}
              >
                {venueJourneyConfirmLabel(journey, t)}
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {t("venueManualGuidanceNotice")}
          </p>
          <Button
            variant="outline"
            className="w-full gap-2"
            onClick={stopNavigation}
          >
            <Square className="h-4 w-4" />
            {t("venueEndGuidance")}
          </Button>
        </>
      ) : (
        <>
          {journey.outdoor && (
            <div className="space-y-2">
              <h2 className="font-semibold text-sm">
                完整行程：戶外導航接續校內引導
              </h2>
              <p className="text-xs text-muted-foreground">
                路線經 {journey.outdoor.arrival.name} 前往 {journey.to.name}。
                到達校園後才展開校內步驟。
              </p>
              {journey.outdoor.routes.map((outdoor, index) => {
                const approach = approachFor(journey, outdoor);
                const afterVehicle =
                  venueApproachRouteKind(outdoor) === "vehicle";
                const transport = transportLabel(
                  outdoor,
                  journey.outdoor?.travelMode,
                );
                const name = outdoor.routeName?.trim();
                const label =
                  name && name !== transport
                    ? `${transport} · ${name}`
                    : transport;
                return (
                  <button
                    key={outdoor.routeId}
                    type="button"
                    aria-pressed={index === journey.outdoor?.selectedIndex}
                    className={`w-full text-left rounded-xl border p-3 ${index === journey.outdoor?.selectedIndex ? "border-primary bg-primary/5" : "border-border"}`}
                    onClick={() =>
                      useMapStore
                        .getState()
                        .setRouteSelect({ index, route: outdoor })
                    }
                  >
                    <span className="font-medium text-sm">{label}</span>
                    <span className="block text-xs text-muted-foreground">
                      校外約{" "}
                      {Math.round(
                        outdoor.totalMinutes + (approach?.totalMinutes ?? 0),
                      )}{" "}
                      分鐘
                      {approach
                        ? afterVehicle
                          ? "（含下車後步行）"
                          : "（含接續步行）"
                        : ""}
                      ，接續校內逐段引導
                    </span>
                    {approach && (
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {afterVehicle ? "抵達下車點後，步行 " : "接續步行 "}
                        {Math.round(walkingDistance(approach))} 公尺至校門
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          <Button
            className="w-full h-12 gap-2"
            disabled={!canStart}
            onClick={startNavigation}
          >
            <Navigation className="h-5 w-5" />
            {journey.outdoor ? "開始導航" : "開始逐段引導"}
          </Button>
          {showIndoorDetails && !journey.route.animationSafe && (
            <p
              role="status"
              className="text-sm text-amber-700 dark:text-amber-400"
            >
              高差或實體通路待確認，預覽播放暫停；手動引導仍需逐段確認。
            </p>
          )}
          {showIndoorDetails && (
            <div className="rounded-xl border p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-semibold text-sm">校內路線預覽</h2>
                <Button size="sm" variant="ghost" onClick={showVenue}>
                  在地圖查看
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                播放僅為路線示範，不代表目前位置或已到樓層。
              </p>
              <div className="flex gap-2">
                <Button
                  className="flex-1 gap-2"
                  variant="outline"
                  disabled={!journey.route.animationSafe}
                  onClick={() => {
                    const { progress, direction, playing } = journey.preview;
                    setPreview({
                      playing: !playing,
                      progress:
                        !playing &&
                        ((direction === 1 && progress >= 1) ||
                          (direction === -1 && progress <= 0))
                          ? direction === 1
                            ? 0
                            : 1
                          : progress,
                    });
                    if (!playing) showVenue();
                  }}
                >
                  {journey.preview.playing ? (
                    <Pause className="h-4 w-4" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  {journey.preview.playing ? "暫停" : "播放"}
                </Button>
                <Button
                  variant="outline"
                  className="gap-2"
                  disabled={!journey.route.animationSafe}
                  onClick={() =>
                    setPreview({
                      direction: journey.preview.direction === 1 ? -1 : 1,
                    })
                  }
                >
                  <RotateCcw className="h-4 w-4" />
                  {journey.preview.direction === 1 ? "改為反向" : "改為正向"}
                </Button>
              </div>
              <input
                aria-label="校內路線預覽進度"
                type="range"
                min="0"
                max="1"
                step="0.001"
                disabled={!journey.route.animationSafe}
                value={journey.preview.progress}
                onChange={(event) =>
                  setPreview({
                    progress: Number(event.target.value),
                    playing: false,
                  })
                }
                className="w-full accent-primary"
              />
            </div>
          )}
        </>
      )}

      {showIndoorDetails && (
        <ol className="space-y-2" aria-label={t("venueRouteSteps")}>
          {journey.route.steps.map((step, index) => (
            <li
              key={`${step.startIndex}-${step.endIndex}`}
              aria-current={
                navigating && !arrived && index === active ? "step" : undefined
              }
              className={`rounded-xl border p-3 text-sm ${navigating && index === active ? "border-primary bg-primary/5" : "border-transparent bg-muted/40"}`}
            >
              <span className="text-xs text-muted-foreground mr-2">
                {index + 1}
              </span>
              {venueJourneyStepLabel(step, t)}
              <span className="block mt-1 text-xs text-muted-foreground">
                {t("venueStepDistance", {
                  distance: Math.round(step.distanceM),
                })}
              </span>
            </li>
          ))}
        </ol>
      )}
      {journey.to.arrivalKind === "corridor" && (
        <p className="text-sm text-muted-foreground">
          {t("venueCorridorEndpointNotice")}
        </p>
      )}
      {journey.route.warnings.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">
            來源與通行限制（{journey.route.warnings.length}）
          </summary>
          <ul className="list-disc pl-5 mt-2 space-y-2 text-muted-foreground">
            {journey.route.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
