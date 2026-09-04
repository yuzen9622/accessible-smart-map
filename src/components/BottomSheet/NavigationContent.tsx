"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Footprints,
  Square,
  TramFront,
} from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { useAppTranslation } from "@/i18n/client";
import { stopNavigation } from "@/lib/navigation/navigationLifecycle";
import { cn } from "@/lib/utils";
import useNavStore from "@/stores/useNavStore";
import { formatDistance } from "@/types/route";
import { Button } from "../ui/button";

/**
 * Step list shown while navigating (the live banner/ETA moved to the on-map
 * NavigationHUD). Opened from the HUD's list button; tapping a step manually
 * overrides the engine's auto-advance.
 */
export default function NavigationContent() {
  const { t } = useAppTranslation();

  const instructions = useNavStore((s) => s.instructions);
  const currentStep = useNavStore((s) => s.currentStepIndex);
  const arrived = useNavStore((s) => s.arrived);
  const setStepIndex = useNavStore((s) => s.setStepIndex);
  const warnings = useNavStore((s) => s.warnings);

  const currentRef = useRef<HTMLButtonElement | null>(null);

  const activeNavWarnings = useMemo(() => {
    const list: string[] = [];
    if (!warnings) return list;
    const walkStepsUnavailable =
      warnings.includes("WALK_STEPS_UNAVAILABLE") ||
      warnings.includes("ORS_STEPS_UNAVAILABLE");
    if (walkStepsUnavailable) {
      list.push(t("walkStepsUnavailable"));
    }
    if (warnings.includes("ROAD_STEPS_UNAVAILABLE")) {
      list.push(t("roadStepsUnavailable"));
    }
    return list;
  }, [warnings, t]);

  // Keep the active step in view as the engine advances.
  useEffect(() => {
    currentRef.current?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, []);

  if (arrived) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col items-center gap-3 p-6 rounded-xl bg-green-500/10 border border-green-500/20">
          <CheckCircle2 className="h-12 w-12 text-green-500" />
          <p className="text-base font-semibold">{t("arrived")}</p>
          <p className="text-sm text-muted-foreground text-center">
            {t("arrivedDesc")}
          </p>
        </div>
        <Button
          onClick={stopNavigation}
          className="w-full rounded-xl h-11 gap-2"
        >
          <Square className="h-4 w-4" />
          {t("endNav")}
        </Button>
      </div>
    );
  }

  if (instructions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        {t("preparingNav")}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {activeNavWarnings.length > 0 && (
        <div className="space-y-1.5">
          {activeNavWarnings.map((wMsg) => (
            <div
              key={wMsg}
              className="flex items-center gap-2.5 p-3 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 text-xs font-semibold"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{wMsg}</span>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        {instructions.map((step, i) => {
          const active = i === currentStep;
          const passed = i < currentStep;
          return (
            <button
              key={`${step.type}-${step.text}-${step.distanceM ?? 0}-${step.polylineIndex ?? 0}`}
              ref={active ? currentRef : undefined}
              type="button"
              onClick={() => setStepIndex(i)}
              className={cn(
                "w-full flex items-start gap-3 p-3 rounded-xl text-left transition-colors",
                active
                  ? "bg-primary/10 border border-primary/30"
                  : "hover:bg-muted/60 border border-transparent",
                passed && "opacity-50",
              )}
            >
              <div
                className={cn(
                  "h-7 w-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <p
                  className={cn(
                    "text-sm leading-snug",
                    active ? "font-semibold" : "font-medium",
                  )}
                >
                  {step.text}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  {step.legType === "WALK" ? (
                    <Footprints className="h-3 w-3 text-blue-500" />
                  ) : (
                    <TramFront className="h-3 w-3 text-orange-500" />
                  )}
                  {step.streetName && (
                    <span className="text-xs text-muted-foreground truncate">
                      {step.streetName}
                    </span>
                  )}
                  {step.distanceM != null && (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatDistance(step.distanceM)}
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
