import { Accessibility } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
  resolveViewedCandidate,
} from "@/lib/transit/departureCandidates";
import type { BusDepartureCandidate } from "@/types/route";

/** Same wording as the plain leg's wait badge: a clock time for a timetable
 * departure, whole minutes (the backend sends 3.2889) for a live arrival. */
function candidateWait(
  candidate: BusDepartureCandidate,
  language: "en" | "zh-TW",
  t: (key: string, options?: Record<string, string | number>) => string,
) {
  const clock = formatRouteClock(candidate.boardingTime, language);
  if (candidate.boardingTimeSource === "schedule" && clock)
    return t("departsAt", { time: clock });
  if (candidate.estimatedWaitMinutes !== null)
    return t("waitMinutes", {
      count: Math.max(0, Math.round(candidate.estimatedWaitMinutes)),
    });
  return clock ? t("departsAt", { time: clock }) : null;
}

export function BusDepartureCandidates({
  candidates,
  viewedCandidateId,
  onViewCandidate,
  onOpenChange,
  color = ROUTE_COLORS.BUS,
}: {
  candidates: BusDepartureCandidate[];
  viewedCandidateId?: string;
  onViewCandidate: (id: string) => void;
  onOpenChange?: (open: boolean) => void;
  color?: string;
}) {
  const { t } = useAppTranslation();
  const language = getAppLanguage();
  const candidate = resolveViewedCandidate(candidates, viewedCandidateId);
  const optionLabel = (item: BusDepartureCandidate) =>
    [item.routeName, candidateWait(item, language, t)]
      .filter(Boolean)
      .join(" · ");
  const wait = candidate ? candidateWait(candidate, language, t) : null;

  const badgeClass =
    "rounded px-2 py-0.5 text-xs leading-4 font-bold text-white";
  const canChoose =
    candidates.length > 1 || (!candidate && candidates.length > 0);

  return (
    <section
      className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
      aria-label={t("busCandidateInformation")}
      data-candidate-id={candidate?.candidateId}
    >
      {canChoose ? (
        <Select
          value={candidate?.candidateId ?? ""}
          onValueChange={onViewCandidate}
          onOpenChange={onOpenChange}
        >
          <SelectTrigger
            aria-label={t("busCandidateChoose")}
            size="sm"
            className={`${badgeClass} gap-0.5 border-0 pr-1 leading-4 shadow-none hover:brightness-110 data-[size=sm]:h-auto dark:hover:bg-transparent [&_svg]:size-3 [&_svg]:opacity-90 [&_svg:not([class*='text-'])]:text-white`}
            style={{ backgroundColor: color }}
          >
            <SelectValue placeholder={t("busCandidateChoose")}>
              {candidate?.routeName ?? t("busCandidateChoose")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent
            align="start"
            className="min-w-0 max-w-[calc(100vw-2rem)]"
          >
            {candidates.map((item) => (
              <SelectItem
                key={item.candidateId}
                value={item.candidateId}
                textValue={optionLabel(item)}
                className="min-h-9 cursor-pointer py-1 pl-1.5"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <Badge
                    variant="outline"
                    className="rounded px-1.5 py-0 text-xs font-semibold"
                  >
                    {item.routeName}
                  </Badge>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {candidateWait(item, language, t) ?? "—"}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        candidate && (
          <span className={badgeClass} style={{ backgroundColor: color }}>
            {candidate.routeName}
          </span>
        )
      )}
      {candidate && (
        <div
          className="flex min-w-0 flex-wrap items-center gap-2"
          aria-live="polite"
        >
          {!candidate.selected && (
            <span className="sr-only">{t("busCandidateViewing")}</span>
          )}
          {wait && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {wait}
            </span>
          )}
          {candidate.vehicleAccessibility === "low_floor" && (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
              <Accessibility aria-hidden className="h-3 w-3" />
              {t("busCandidateVehicle_low_floor")}
            </span>
          )}
        </div>
      )}
      {candidates.length === 0 && (
        <span className="text-xs text-muted-foreground">
          {t("busCandidateEmpty")}
        </span>
      )}
    </section>
  );
}
