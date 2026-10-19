import { BusIcon } from "lucide-react";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { useBusLegStopEtas } from "@/hook/useBusLegStopEtas";
import { useAppTranslation } from "@/i18n/client";
import { getAppLanguage } from "@/i18n/language";
import { legSourceName } from "@/lib/route/sourceNames";
import { busRouteNames } from "@/lib/transit/departureCandidates";
import type { BusLeg } from "@/types/route";

export function useBusCandidateInfo(
  rawLeg: BusLeg,
  routeToken: string | undefined,
  legIndex: number,
  enabled: boolean,
  poll: boolean,
  cacheOnly = false,
) {
  const leg = useMemo(
    () => ({
      ...rawLeg,
      planContext: routeToken ? { routeToken, legIndex } : undefined,
    }),
    [rawLeg, routeToken, legIndex],
  );
  const refresh = useBusLegStopEtas(leg, enabled, poll, cacheOnly);
  return { leg, refresh };
}

export function BusRouteBadges({
  leg,
  routeToken,
  legIndex,
  enabled,
}: {
  leg: BusLeg;
  routeToken?: string;
  legIndex: number;
  enabled: boolean;
}) {
  const { t } = useAppTranslation();
  const { refresh } = useBusCandidateInfo(
    leg,
    routeToken,
    legIndex,
    enabled,
    false,
    !enabled,
  );
  const candidates = refresh.departureCandidates ?? leg.departureCandidates;
  const names = candidates?.length
    ? busRouteNames(leg, candidates)
    : [legSourceName(leg, "route", leg.routeName, getAppLanguage())];
  return (
    <span
      data-bus-candidates={candidates !== undefined ? "" : undefined}
      title={names.join(" / ")}
      className="inline-flex max-w-full flex-wrap items-center gap-1"
    >
      <span className="sr-only">{t("busCandidateRoutes")}</span>
      <BusIcon
        aria-hidden
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
      />
      {names.map((name) => (
        <Badge
          key={name}
          variant="outline"
          className="max-w-full whitespace-normal break-words rounded px-1.5 py-0 text-xs font-medium"
        >
          {name}
        </Badge>
      ))}
    </span>
  );
}
