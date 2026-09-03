"use client";

import { ChevronDown, Cone } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { useAppTranslation } from "@/i18n/client";
import { filterIncidentsAlongRoute } from "@/lib/geo";
import { cn } from "@/lib/utils";
import type { DriveIncident } from "@/types/route";

const DISCLOSURE_CLS =
  "grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none";

export function DriveIncidentNotice({
  incidents,
  polyline,
}: {
  incidents?: DriveIncident[];
  polyline?: [number, number][];
}) {
  const { t } = useAppTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const listId = useId();

  // Only show incidents that actually lie along this route leg (within 150m).
  const relevantIncidents = useMemo(
    () => filterIncidentsAlongRoute(incidents, polyline, 150),
    [incidents, polyline],
  );

  if (!relevantIncidents.length) return null;

  const count = relevantIncidents.length;
  // Check if all incidents are roadwork
  const allRoadwork = relevantIncidents.every(
    (inc) =>
      inc.title.includes("施工") || inc.title.toLowerCase().includes("work"),
  );

  const summaryTitle = allRoadwork
    ? (t("roadworkAlongRoute", { count }) ?? `沿線道路施工 (${count} 處)`)
    : (t("incidentsAlongRoute", { count }) ?? `沿線路況事件 (${count} 處)`);

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-controls={listId}
        className="flex w-full items-center gap-1.5 px-2.5 py-2 lg:py-1.5 rounded-lg text-left transition-colors hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
      >
        <Cone
          className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400"
          aria-hidden
        />
        <span className="text-xs font-medium text-foreground truncate min-w-0">
          {summaryTitle}
        </span>
        <ChevronDown
          className={cn(
            "h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-200 ease-out motion-reduce:transition-none ml-auto",
            isOpen && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      <div
        id={listId}
        aria-hidden={!isOpen}
        className={cn(
          DISCLOSURE_CLS,
          isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden">
          <ul className="px-2.5 pb-2.5 space-y-2 border-t border-amber-500/20 pt-2">
            {relevantIncidents.map((incident, idx) => {
              const isClosure = incident.severity === "closure";
              const key = incident.incidentId || `${incident.title}-${idx}`;

              return (
                <li key={key} className="text-xs space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "inline-flex items-center rounded px-1.5 py-0.2 text-[10px] font-semibold shrink-0",
                        isClosure
                          ? "bg-red-500/20 text-red-700 dark:text-red-300"
                          : "bg-amber-500/20 text-amber-800 dark:text-amber-300",
                      )}
                    >
                      {incident.title ||
                        t("trafficIncidentOther") ||
                        "路況事件"}
                    </span>
                    {isClosure && (
                      <span className="text-[10px] font-medium text-red-600 dark:text-red-400">
                        {t("incidentClosure") ?? "道路封閉"}
                      </span>
                    )}
                  </div>
                  {incident.description && (
                    <p className="text-muted-foreground pl-1 leading-relaxed">
                      {incident.description}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
