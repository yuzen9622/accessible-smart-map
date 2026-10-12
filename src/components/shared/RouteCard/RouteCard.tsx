import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clock,
  Footprints,
  Info,
  ShieldCheck,
} from "lucide-react";
import { memo, useId, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppTranslation } from "@/i18n/client";
import { getAppLanguage } from "@/i18n/language";
import { fitRouteBounds, routeBoundsFromLegs } from "@/lib/mapCamera";
import { legSourceName } from "@/lib/route/sourceNames";
import { cn } from "@/lib/utils";
import useMapStore from "@/stores/useMapStore";
import type { AccessibleRoute } from "@/types/route";
import {
  formatDistance,
  formatDuration,
  getLegColor,
  scoreToStars,
} from "@/types/route";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../ui/card";
import RouteReasonSummary from "../RouteReasonSummary";
import { LegDetail, LegIcon } from "./LegDetail";
import { pairRouteMessages } from "./routeMessages";
import { StarRating } from "./StarRating";
import type { PointLabelContext } from "./utils";
import {
  getConfidenceLabelKey,
  getLegKey,
  getRouteAlertsCount,
  LABEL_TO_SCORE,
  STAR_COLOR,
  scoreBarColor,
} from "./utils";

type RouteCardProps = {
  route: AccessibleRoute;
  idx: number;
};

export const RouteCard = memo(function RouteCard({
  route,
  idx,
}: RouteCardProps) {
  const {
    setRouteSelect,
    selectRoute,
    map,
    origin,
    destination,
    originName,
    destinationName,
    userLocation,
  } = useMapStore(
    useShallow((s) => ({
      setRouteSelect: s.setRouteSelect,
      selectRoute: s.selectRoute,
      map: s.map,
      origin: s.origin,
      destination: s.destination,
      originName: s.originName,
      destinationName: s.destinationName,
      userLocation: s.userLocation,
    })),
  );
  const { t } = useAppTranslation();
  const language = getAppLanguage();
  const isSelected = selectRoute?.index === idx;
  const [scoreOpen, setScoreOpen] = useState(false);
  const scoreDetailId = useId();

  const pointCtx: PointLabelContext = {
    originPosition: origin?.position ?? null,
    destinationPosition: destination?.position ?? null,
    userLocation,
    originName,
    destinationName,
    originFallback: t("origin"),
    destinationFallback: t("destination"),
    myLocationFallback: t("myLocation"),
  };

  const effectiveScore =
    route.accessibilityScore ??
    (route.accessibilityLabel
      ? LABEL_TO_SCORE[route.accessibilityLabel]
      : undefined);
  const stars = effectiveScore != null ? scoreToStars(effectiveScore) : null;
  const starColor = stars ? (STAR_COLOR[stars] ?? STAR_COLOR[1]) : null;

  const confidenceLabelKey = getConfidenceLabelKey(route.dataConfidence);
  const confidenceLabelText = confidenceLabelKey
    ? (t(confidenceLabelKey) ?? route.dataConfidence)
    : route.dataConfidence;

  const alertsCount = useMemo(() => getRouteAlertsCount(route), [route]);
  const warnings = pairRouteMessages(route.warnings, route.warningDetails);
  const scoreWarnings = pairRouteMessages(
    route.scoreWarnings,
    route.scoreWarningDetails,
  );
  const highlights = pairRouteMessages(
    route.accessibilityHighlights,
    route.accessibilityHighlightDetails,
  );

  const routeSummary = useMemo(() => {
    const types = route.legs
      .filter((l) => l.type !== "WALK")
      .map((l) => {
        switch (l.type) {
          case "BUS":
            return legSourceName(l, "route", l.routeName, language);
          case "METRO":
            return legSourceName(l, "route", l.lineName, language);
          case "THSR":
            return `${t("thsr")} ${l.trainNo}`;
          case "TRA":
            return `${legSourceName(l, "route", l.trainTypeName, language)}${l.trainNo}`;
          case "DRIVE":
          case "MOTORCYCLE":
            return (
              l.label ?? (l.type === "DRIVE" ? t("drive") : t("motorcycle"))
            );
          default:
            return "";
        }
      });
    return types.join(" → ");
  }, [route.legs, t, language]);

  const handleSelect = () => {
    setRouteSelect({ index: idx, route });
    if (map) {
      fitRouteBounds(map, routeBoundsFromLegs(route.legs));
    }
  };

  return (
    <Card
      className={cn(
        "transition-shadow",
        isSelected ? "ring-2 ring-primary" : "cursor-pointer hover:shadow-md",
      )}
      {...(!isSelected && {
        role: "button",
        tabIndex: 0,
        "aria-label": `${t("selectRoute")}: ${route.routeName}`,
        onClick: handleSelect,
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleSelect();
          }
        },
      })}
    >
      {/* ── Level 1: Scan layer (always visible) ── */}
      <CardHeader className="grid-cols-1">
        <CardTitle className="flex justify-between items-center gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <h2
              className="text-lg font-bold truncate min-w-0"
              title={route.routeName}
            >
              {route.routeName}
            </h2>
            {alertsCount > 0 && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30 px-2 py-0.5 text-xs font-semibold shrink-0"
                title={
                  t("routeTransitAlertsBadge", { count: alertsCount }) ??
                  `包含營運通阻 (${alertsCount})`
                }
              >
                <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
                {t("routeTransitAlertsBadge", { count: alertsCount }) ??
                  `包含營運通阻 (${alertsCount})`}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground shrink-0">
            <Clock className="h-4 w-4" />
            <span className="font-bold text-sm tabular-nums">
              {formatDuration(route.totalMinutes)}
            </span>
          </div>
        </CardTitle>

        {routeSummary && (
          <p
            className="text-xs text-muted-foreground truncate min-w-0"
            title={routeSummary}
          >
            {routeSummary}
          </p>
        )}

        {stars != null && starColor && (
          <div className="flex items-center gap-2">
            <StarRating
              filled={stars}
              colorClass={starColor}
              ariaLabel={t("starAriaLabel", { filled: stars }) ?? `${stars}/5`}
            />
            <span className={cn("text-sm font-bold", starColor)}>
              {t(`starLabel${stars}`)}
            </span>
          </div>
        )}
      </CardHeader>

      {/* ── Level 2: Decision layer (on select) ── */}
      {isSelected && (
        <CardContent className="space-y-3 pt-0">
          <div className="flex items-center gap-2 flex-wrap">
            {alertsCount > 0 && (
              <Badge
                variant="destructive"
                className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 gap-1 text-xs font-semibold hover:bg-amber-500/20"
              >
                <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
                {t("routeTransitAlertsBadge", { count: alertsCount }) ??
                  `包含營運通阻 (${alertsCount})`}
              </Badge>
            )}
            {route.transferCount > 0 && (
              <Badge variant="outline" className="text-xs">
                {t("transferCount", { count: route.transferCount })}
              </Badge>
            )}
            {route.totalWalkDistanceM != null && (
              <Badge
                variant="outline"
                className="text-xs gap-1"
                aria-label={
                  t("totalWalkDistance", {
                    distance: formatDistance(route.totalWalkDistanceM),
                  }) ?? `總步行距離 ${formatDistance(route.totalWalkDistanceM)}`
                }
              >
                <Footprints className="h-3 w-3" aria-hidden />
                {formatDistance(route.totalWalkDistanceM)}
              </Badge>
            )}
            {route.dataConfidence && (
              <Badge variant="outline" className="text-xs">
                {t("dataConfidence") ?? "資料可信度"}
                {t("labelColon")}
                {confidenceLabelText}
              </Badge>
            )}
            <RouteReasonSummary route={route} />
            <Badge>{t("selectedRoute")}</Badge>
          </div>

          {/* The only channel telling the user this route carries no
              accessibility guarantee, so it sits above the leg list. */}
          {!route.routeToken && (
            <p role="status" className="text-amber-700">
              {t("routeTokenUnavailable")}
            </p>
          )}
          {route.legs.some((leg) => !leg.polyline?.length) && (
            <p role="status" className="text-amber-700">
              {t("routeGeometryIncomplete")}
            </p>
          )}
          {!!route.warnings?.length && (
            <div className="space-y-1">
              {warnings.map((warning) => (
                <p
                  key={warning.index}
                  className={cn(
                    "flex items-start gap-1 text-xs",
                    route.degraded === true
                      ? "text-red-600 dark:text-red-400"
                      : "text-amber-600 dark:text-amber-400",
                  )}
                >
                  <AlertTriangle
                    className="h-3 w-3 shrink-0 mt-0.5"
                    aria-hidden
                  />
                  <span>{warning.text}</span>
                </p>
              ))}
            </div>
          )}

          {/* Leg overview */}
          <div className="relative space-y-2">
            {route.legs.map((leg, index) => {
              const color = getLegColor(leg);
              return (
                <div key={getLegKey(leg)} className="relative pl-8">
                  {index !== route.legs.length - 1 && (
                    <div
                      className="absolute left-3.5 top-11 bottom-0 w-0.5 rounded-full"
                      style={{
                        backgroundColor: `color-mix(in srgb, ${color} 40%, transparent)`,
                      }}
                    />
                  )}

                  <div className="absolute left-0 top-1">
                    <div
                      className="flex items-center justify-center w-8 h-8 rounded-full border-2 bg-background"
                      style={{
                        borderColor: `color-mix(in srgb, ${color} 55%, transparent)`,
                        backgroundColor: `color-mix(in srgb, ${color} 10%, var(--background))`,
                      }}
                    >
                      <LegIcon leg={leg} />
                    </div>
                  </div>

                  <div className="pb-4 ml-4">
                    <LegDetail
                      leg={leg}
                      isFirst={index === 0}
                      isLast={index === route.legs.length - 1}
                      pointCtx={pointCtx}
                      isSelected={isSelected}
                      engine={route.engine}
                      routeToken={route.routeToken}
                      routeIndex={idx}
                      legIndex={index}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Level 3: Professional layer (opt-in disclosure) ── */}
          {(route.scoreComponents ||
            (route.accessibilityHighlights?.length ?? 0) > 0) && (
            <div className="border-t pt-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setScoreOpen((v) => !v);
                }}
                aria-expanded={scoreOpen}
                aria-controls={scoreDetailId}
                className="flex w-full items-center justify-between gap-2 px-1 py-2 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                  {t("scoreDetails")}
                  {effectiveScore != null && (
                    <span className="tabular-nums font-semibold">
                      {effectiveScore}/100
                    </span>
                  )}
                </span>
                <ChevronDown
                  aria-hidden
                  className={cn(
                    "h-3.5 w-3.5 transition-transform",
                    scoreOpen && "rotate-180",
                  )}
                />
              </button>
              {scoreOpen && (
                <div id={scoreDetailId} className="space-y-3 pt-1">
                  {route.accessibilityHighlights?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {highlights.map((highlight) => {
                        const Icon = {
                          caution: AlertTriangle,
                          positive: Check,
                          neutral: Info,
                        }[highlight.tone];
                        return (
                          <span
                            key={highlight.index}
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
                              {
                                caution:
                                  "bg-amber-500/10 text-amber-700 dark:text-amber-400",
                                positive:
                                  "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                                neutral: "bg-muted text-muted-foreground",
                              }[highlight.tone],
                            )}
                          >
                            <Icon className="h-3 w-3 shrink-0" aria-hidden />
                            {highlight.text}
                          </span>
                        );
                      })}
                    </div>
                  )}

                  {route.scoreComponents && (
                    <div className="grid grid-cols-3 gap-2">
                      {(
                        [
                          "facilityScore",
                          "timeScore",
                          "criticalFeatureScore",
                        ] as const
                      ).map((key) => {
                        const val = route.scoreComponents?.[key] ?? 0;
                        return (
                          <div
                            key={key}
                            className="text-center p-2 rounded-lg bg-muted/40 space-y-1"
                          >
                            <p className="text-lg font-bold tabular-nums leading-none pt-1">
                              {val}
                            </p>
                            <div
                              aria-hidden="true"
                              className="h-1 rounded-full bg-muted overflow-hidden mx-1"
                            >
                              <div
                                className="h-full rounded-full transition-[width] duration-500 ease-out"
                                style={{
                                  width: `${Math.max(0, Math.min(100, val))}%`,
                                  backgroundColor: scoreBarColor(val),
                                }}
                              />
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {key === "facilityScore"
                                ? (t("facilityScore") ?? "設施")
                                : key === "timeScore"
                                  ? (t("timeScore") ?? "時間")
                                  : (t("criticalScore") ?? "關鍵")}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {!!route.scoreWarnings?.length && (
            <div className="space-y-1">
              {scoreWarnings.map((warning) => (
                <p
                  key={warning.index}
                  className="flex items-start gap-1 text-xs text-amber-600 dark:text-amber-400"
                >
                  <AlertTriangle
                    className="h-3 w-3 shrink-0 mt-0.5"
                    aria-hidden
                  />
                  <span>{warning.text}</span>
                </p>
              ))}
            </div>
          )}

          <div className="flex justify-end pt-2 border-t">
            <Button
              onClick={(e) => {
                e.stopPropagation();
                handleSelect();
              }}
              disabled={isSelected}
              variant="secondary"
            >
              {t("selectedRoute")}
            </Button>
          </div>

          {route.attribution && (
            <p className="text-xs text-muted-foreground pt-2">
              {route.attribution}
            </p>
          )}
        </CardContent>
      )}

      {/* Unselected: show select button inline */}
      {!isSelected && (
        <CardContent className="pt-0">
          <Button
            onClick={(e) => {
              e.stopPropagation();
              handleSelect();
            }}
            variant="default"
            className="w-full"
          >
            {t("selectRoute")}
          </Button>
        </CardContent>
      )}
    </Card>
  );
});
RouteCard.displayName = "RouteCard";
