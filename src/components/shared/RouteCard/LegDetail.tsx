import {
  Bike,
  BusIcon,
  Car,
  Footprints,
  TrainFrontIcon,
  TrainFrontTunnelIcon,
  TramFront,
} from "lucide-react";
import { useAppTranslation } from "@/i18n/client";
import type { AccessibleRoute, RouteLeg, WaitInfo } from "@/types/route";
import { formatDistance, formatDuration, getLegColor } from "@/types/route";
import { LegAlertNotice } from "../TransitAlerts";
import { BusLegStops } from "./BusLegStops";
import { DriveIncidentNotice } from "./DriveIncidentNotice";
import { DriveStepsList } from "./DriveStepsList";
import { TransitStops } from "./TransitStops";
import type { PointLabelContext } from "./utils";
import { getPointLabel, shouldAppendExitNumber } from "./utils";
import { WalkA11ySummary } from "./WalkA11ySummary";
import { WalkStepsList } from "./WalkStepsList";

export function LegIcon({ leg }: { leg: RouteLeg }) {
  const color = getLegColor(leg);
  switch (leg.type) {
    case "WALK":
      return <Footprints className="h-4 w-4" style={{ color }} />;
    case "BUS":
      return <BusIcon className="h-4 w-4" style={{ color }} />;
    case "METRO":
      return <TramFront className="h-4 w-4" style={{ color }} />;
    case "THSR":
      return <TrainFrontTunnelIcon className="h-4 w-4" style={{ color }} />;
    case "TRA":
      return <TrainFrontIcon className="h-4 w-4" style={{ color }} />;
    case "DRIVE":
      return <Car className="h-4 w-4" style={{ color }} />;
    case "MOTORCYCLE":
      return <Bike className="h-4 w-4" style={{ color }} />;
  }
}

// "等候 23:08" read like a 23-hour wait — a schedule source carries a clock
// time (departure), a realtime source carries minutes to wait.
function WaitBadge({ waitInfo }: { waitInfo: WaitInfo | null | undefined }) {
  const { t } = useAppTranslation();
  if (!waitInfo || waitInfo.source === "unavailable") return null;

  let text: string | null = null;
  if (waitInfo.source === "schedule" && typeof waitInfo.time === "string") {
    text = t("departsAt", { time: waitInfo.time });
  } else if (typeof waitInfo.time === "number") {
    text = t("waitMinutes", { count: waitInfo.time });
  }
  if (!text) return null;
  return <span className="text-xs text-muted-foreground">{text}</span>;
}

function FacilityHighlights({ items }: { items?: string[] }) {
  if (!items?.length) return null;
  return (
    <div className="space-y-0.5">
      {items.map((h) => (
        <p key={h} className="text-xs text-blue-600 dark:text-blue-400">
          <span aria-hidden>♿</span> {h}
        </p>
      ))}
    </div>
  );
}

export function LegDetail({
  leg,
  isFirst,
  isLast,
  pointCtx,
  isSelected,
  engine,
  routeIndex = 0,
  legIndex = 0,
}: {
  leg: RouteLeg;
  isFirst: boolean;
  isLast: boolean;
  pointCtx: PointLabelContext;
  isSelected: boolean;
  engine?: AccessibleRoute["engine"];
  routeIndex?: number;
  legIndex?: number;
}) {
  const { t } = useAppTranslation();
  switch (leg.type) {
    case "WALK":
      return (
        <div className="space-y-1">
          <p className="text-sm font-medium">
            {t("walk")} {formatDistance(leg.distanceM)}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("approxTime", { time: formatDuration(leg.minutesEst) })}
          </p>
          {leg.exitInfo && (
            <p className="text-xs text-blue-600 dark:text-blue-400">
              <span aria-hidden>🛗</span> {leg.exitInfo.exitName} (
              {shouldAppendExitNumber(
                leg.exitInfo.exitName,
                leg.exitInfo.exitNumber,
              ) && (
                <>
                  {t("exitNumber", { number: leg.exitInfo.exitNumber }) ??
                    `${leg.exitInfo.exitNumber} 號出口`}
                  ・
                </>
              )}
              {leg.exitInfo.type === "elevator" ? t("elevator") : t("ramp")})
            </p>
          )}
          {!!leg.a11yFacilities?.length && (
            <p className="text-xs text-blue-600 dark:text-blue-400">
              <span aria-hidden>♿</span>{" "}
              {t("a11yFacilitiesAlong", { count: leg.a11yFacilities.length })}
            </p>
          )}
          {engine === "pedestrian-a11y" && <WalkA11ySummary leg={leg} />}
          {isSelected && <WalkStepsList steps={leg.steps} />}
        </div>
      );
    case "BUS":
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div
              className="px-2 py-0.5 rounded text-xs font-bold text-white"
              style={{ backgroundColor: getLegColor(leg) }}
            >
              {leg.routeName}
            </div>
            <WaitBadge waitInfo={leg.waitInfo} />
          </div>
          <BusLegStops
            leg={leg}
            routeIndex={routeIndex}
            legIndex={legIndex}
            isSelected={isSelected}
          />
          {leg.nearestBus && (
            <p className="text-xs text-green-600 dark:text-green-400">
              <span aria-hidden>🚌</span>{" "}
              {leg.nearestBus.stopsAway != null
                ? t("nearestBusStopsAway", { count: leg.nearestBus.stopsAway })
                : t("nearestBusApproaching")}
            </p>
          )}
          {leg.alerts && <LegAlertNotice alerts={leg.alerts} />}
        </div>
      );
    case "METRO":
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div
              className="px-2 py-0.5 rounded text-xs font-bold text-white"
              style={{ backgroundColor: getLegColor(leg) }}
            >
              {leg.lineName}
            </div>
            <WaitBadge waitInfo={leg.waitInfo} />
          </div>
          <div className="space-y-1">
            <TransitStops
              boardName={leg.departureStation}
              alightName={leg.arrivalStation}
              intermediateStops={leg.intermediateStops}
              color={getLegColor(leg)}
              departureA11y={leg.departureStationA11y}
              arrivalA11y={leg.arrivalStationA11y}
              isSelected={isSelected}
            />
            <div className="text-xs text-muted-foreground">
              {t("stopsUnit", { count: leg.stopsCount })} ·{" "}
              {t("approxTime", { time: formatDuration(leg.rideMinutes) })}
            </div>
          </div>
          <FacilityHighlights items={leg.facilityHighlights} />
          {leg.alerts && <LegAlertNotice alerts={leg.alerts} />}
        </div>
      );
    case "THSR":
    case "TRA": {
      const badgeLabel =
        leg.type === "THSR"
          ? `${t("thsr")} ${leg.trainNo}`
          : `${leg.trainTypeName} ${leg.trainNo}`;
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div
              className="px-2 py-0.5 rounded text-xs font-bold text-white"
              style={{ backgroundColor: getLegColor(leg) }}
            >
              {badgeLabel}
            </div>
            <WaitBadge waitInfo={leg.waitInfo} />
          </div>
          <div className="space-y-1">
            <TransitStops
              boardName={leg.departureStation}
              alightName={leg.arrivalStation}
              boardTime={leg.departureTime}
              alightTime={leg.arrivalTime}
              intermediateStops={leg.intermediateStops}
              color={getLegColor(leg)}
              departureA11y={leg.departureStationA11y}
              arrivalA11y={leg.arrivalStationA11y}
              isSelected={isSelected}
            />
            <div className="text-xs text-muted-foreground">
              {t("approxTime", { time: formatDuration(leg.rideMinutes) })}
            </div>
          </div>
          <FacilityHighlights items={leg.facilityHighlights} />
          {leg.alerts && <LegAlertNotice alerts={leg.alerts} />}
        </div>
      );
    }
    case "DRIVE":
    case "MOTORCYCLE":
      return (
        <div className="space-y-1">
          <p className="text-sm font-medium">
            {leg.label ?? (leg.type === "DRIVE" ? t("drive") : t("motorcycle"))}{" "}
            {formatDistance(leg.distanceM)}
          </p>
          <p className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
            <span>
              {t("approxTime", {
                time: formatDuration(
                  leg.durationInTrafficMin ??
                    leg.durationMin ??
                    leg.durationMinutes ??
                    0,
                ),
              })}
            </span>
            {leg.trafficLevel === "moderate" && (
              <span className="text-xs text-amber-500 font-medium">
                {t("trafficModerate") ?? "（車多緩行）"}
              </span>
            )}
            {leg.trafficLevel === "heavy" && (
              <span className="text-xs text-red-500 font-medium">
                {t("trafficHeavy") ?? "（車流壅塞）"}
              </span>
            )}
            {leg.trafficLevel === "severe" && (
              <span className="text-xs text-red-700 dark:text-red-400 font-medium">
                {t("trafficSevere") ?? "（嚴重壅塞）"}
              </span>
            )}
            {leg.trafficLevel === "closed" && (
              <span className="text-xs text-gray-500 font-medium">
                {t("trafficClosed") ?? "（道路封閉）"}
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {[
              getPointLabel(leg.from, pointCtx, isFirst, false),
              getPointLabel(leg.to, pointCtx, false, isLast),
            ]
              .filter(Boolean)
              .join(" → ")}
          </p>
          <DriveIncidentNotice
            incidents={leg.incidents}
            polyline={leg.polyline}
          />
          {isSelected && <DriveStepsList steps={leg.steps} />}
        </div>
      );
  }
}
