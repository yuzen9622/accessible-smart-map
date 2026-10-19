import { Accessibility, Info, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAppTranslation } from "@/i18n/client";
import { getAppLanguage } from "@/i18n/language";
import { ROUTE_COLORS } from "@/lib/config";
import {
  formatRouteClock,
  formatRouteInstant,
  resolveViewedCandidate,
} from "@/lib/transit/departureCandidates";
import type { BusDepartureCandidate } from "@/types/route";
import { RouteClock } from "./RouteJourneyTime";

export function BusDepartureCandidates({
  candidates,
  searchComplete,
  viewedCandidateId,
  onViewCandidate,
  onOpenChange,
  freshness = "live",
  color = ROUTE_COLORS.BUS,
}: {
  candidates: BusDepartureCandidate[];
  searchComplete?: boolean;
  viewedCandidateId?: string;
  onViewCandidate: (id: string) => void;
  onOpenChange?: (open: boolean) => void;
  freshness?: "live" | "plan" | "loading" | "error";
  color?: string;
}) {
  const { t } = useAppTranslation();
  const language = getAppLanguage();
  const candidate = resolveViewedCandidate(candidates, viewedCandidateId);
  const optionLabel = (item: BusDepartureCandidate) =>
    `${item.routeName} · ${formatRouteClock(item.boardingTime, language) ?? t("busCandidateTimeUnknown")}${item.selected ? ` · ${t("busCandidateAdopted")}` : ""}`;
  return (
    <section
      className="min-w-0 space-y-1"
      aria-label={t("busCandidateInformation")}
      data-candidate-id={candidate?.candidateId}
    >
      {candidate && (
        <>
          <div
            className="flex flex-wrap items-center gap-x-2 gap-y-1"
            aria-live="polite"
          >
            <Badge
              variant="outline"
              className="rounded text-xs font-semibold"
              style={{
                backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
                borderColor: `color-mix(in srgb, ${color} 35%, transparent)`,
              }}
            >
              {candidate.routeName}
            </Badge>
            {candidate.selected ? (
              <Badge
                variant="secondary"
                className="rounded font-normal text-[10px]"
              >
                {t("busCandidateAdopted")}
              </Badge>
            ) : (
              <span className="sr-only">{t("busCandidateViewing")}</span>
            )}
            <div className="ml-auto flex items-center gap-1 text-sm font-medium">
              <RouteClock instant={candidate.boardingTime} label={t("board")} />
              {candidate.alightingTime && (
                <>
                  <span aria-hidden className="text-muted-foreground">
                    –
                  </span>
                  <RouteClock
                    instant={candidate.alightingTime}
                    relativeTo={candidate.boardingTime}
                    label={t("alight")}
                  />
                </>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {candidate.boardingTimeSource !== "unknown" && (
              <span>
                {t(`busCandidateSource_${candidate.boardingTimeSource}`)}
              </span>
            )}
            {candidate.estimatedWaitMinutes !== null && (
              <span>
                {t("busCandidateWait", {
                  count: candidate.estimatedWaitMinutes,
                })}
              </span>
            )}
            {candidate.vehicleAccessibility === "low_floor" && (
              <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                <Accessibility aria-hidden className="h-3 w-3" />
                {t("busCandidateVehicle_low_floor")}
              </span>
            )}
          </div>
        </>
      )}
      <div className="flex flex-wrap items-center gap-x-2 min-w-0">
        {candidates.length > 0 ? (
          (candidates.length > 1 || !candidate) && (
            <Select
              value={candidate?.candidateId ?? ""}
              onValueChange={onViewCandidate}
              onOpenChange={onOpenChange}
            >
              <SelectTrigger
                aria-label={t("busCandidateChoose")}
                size="sm"
                className="min-h-11 w-auto max-w-full border-0 bg-transparent px-0 text-xs text-muted-foreground shadow-none dark:bg-transparent hover:text-foreground"
              >
                <SelectValue placeholder={t("busCandidateChoose")}>
                  {candidate
                    ? t("busCandidateOtherServices", {
                        count: candidates.length - 1,
                      })
                    : t("busCandidateChoose")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="start" className="max-w-[calc(100vw-2rem)]">
                {candidates.map((item) => (
                  <SelectItem
                    key={item.candidateId}
                    value={item.candidateId}
                    textValue={optionLabel(item)}
                    className="min-h-11 cursor-pointer"
                  >
                    <span className="flex min-w-0 flex-wrap items-center gap-2">
                      <Badge variant="outline" className="rounded font-medium">
                        {item.routeName}
                      </Badge>
                      <span className="tabular-nums">
                        {formatRouteClock(item.boardingTime, language) ?? "—"}
                      </span>
                      {item.selected && (
                        <span className="text-xs text-muted-foreground">
                          {t("busCandidateAdopted")}
                        </span>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )
        ) : (
          <span className="text-xs text-muted-foreground">
            {t("busCandidateEmpty")}
          </span>
        )}
        {freshness === "loading" && (
          <Loader2
            aria-label={t("busEtaLoading")}
            className="h-3 w-3 animate-spin motion-reduce:animate-none text-muted-foreground"
          />
        )}
        {freshness === "error" ? (
          <span role="status" className="text-xs text-muted-foreground">
            {t("busCandidateRefreshFailed")}
          </span>
        ) : (
          freshness === "plan" && (
            <span className="text-[11px] text-muted-foreground">
              {t("busCandidatePlanSnapshot")}
            </span>
          )
        )}
        {searchComplete === false && (
          <span role="status" className="text-[11px] text-muted-foreground">
            {t("busCandidatePartialShort")}
          </span>
        )}
        {(candidate || searchComplete === false || freshness !== "live") && (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-11 w-11 text-muted-foreground"
                aria-label={t("busCandidateInformation")}
              >
                <Info aria-hidden className="h-3.5 w-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="space-y-2 text-xs max-w-[calc(100vw-2rem)]"
            >
              <p className="font-medium">{t("busCandidateInformation")}</p>
              {candidate && (
                <>
                  {candidate.subRouteName && <p>{candidate.subRouteName}</p>}
                  {candidate.plateNumb && (
                    <p className="font-mono">{candidate.plateNumb}</p>
                  )}
                  <p>
                    {t(`busCandidateVehicle_${candidate.vehicleAccessibility}`)}
                  </p>
                  <p>
                    {t(
                      candidate.hasLiftOrRamp === null
                        ? "busCandidateRampUnknown"
                        : candidate.hasLiftOrRamp
                          ? "busCandidateRampYes"
                          : "busCandidateRampNo",
                    )}
                  </p>
                  <p className="text-muted-foreground">
                    {t("board")} ·{" "}
                    {formatRouteInstant(candidate.boardingTime, language) ??
                      t("busCandidateTimeUnknown")}
                  </p>
                </>
              )}
              {searchComplete === false && (
                <p>{t("busCandidateSearchPartial")}</p>
              )}
              {freshness !== "live" && (
                <p className="text-muted-foreground">
                  {t(`busCandidateFreshness_${freshness}`)}
                </p>
              )}
            </PopoverContent>
          </Popover>
        )}
      </div>
    </section>
  );
}
