import { ArrowRight } from "lucide-react";
import { useAppTranslation } from "@/i18n/client";
import { getAppLanguage } from "@/i18n/language";
import {
  formatRouteClock,
  formatRouteInstant,
  routeDayOffset,
} from "@/lib/transit/departureCandidates";

export function RouteClock({
  instant,
  relativeTo,
  label,
}: {
  instant?: string | null;
  relativeTo?: string | null;
  label?: string;
}) {
  const { t } = useAppTranslation();
  const language = getAppLanguage();
  const clock = formatRouteClock(instant, language);
  if (!clock || !instant)
    return (
      <span>
        <span className="sr-only">{t("busCandidateTimeUnknown")}</span>
        <span aria-hidden>—</span>
      </span>
    );
  const offset = routeDayOffset(instant, relativeTo);
  return (
    <span className="inline-flex items-baseline gap-0.5 whitespace-nowrap tabular-nums">
      {label && <span className="sr-only">{label}</span>}
      <time
        dateTime={instant}
        title={formatRouteInstant(instant, language) ?? undefined}
      >
        {clock}
      </time>
      {offset !== null && offset !== 0 && (
        <span className="text-[10px] font-normal text-muted-foreground">
          {t("routeDayOffset", { days: `${offset > 0 ? "+" : ""}${offset}` })}
        </span>
      )}
    </span>
  );
}

export function RouteJourneyTime({
  departureTime,
  arrivalTime,
}: {
  departureTime?: string;
  arrivalTime?: string;
}) {
  const { t } = useAppTranslation();
  const language = getAppLanguage();
  const departure = formatRouteClock(departureTime, language);
  const arrival = formatRouteClock(arrivalTime, language);
  if (!departure && !arrival) return null;
  return (
    <div className="flex items-center gap-1.5 text-sm font-medium">
      {departure && (
        <RouteClock
          instant={departureTime}
          label={t("routeJourneyDeparture")}
        />
      )}
      {departure && arrival && (
        <ArrowRight aria-hidden className="h-3 w-3 text-muted-foreground" />
      )}
      {arrival && (
        <RouteClock
          instant={arrivalTime}
          relativeTo={departureTime}
          label={t("routeJourneyArrival")}
        />
      )}
    </div>
  );
}
