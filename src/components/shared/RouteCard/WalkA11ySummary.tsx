import { useAppTranslation } from "@/i18n/client";
import { cn } from "@/lib/utils";
import type { A11yFeature, WalkLeg } from "@/types/route";
import { A11Y_FEATURE_COLOR, plausibleSlopePercent } from "@/types/route";

type Grade = "good" | "caution" | "bad";

const GRADE_DOT: Record<Grade, string> = {
  good: "bg-emerald-500",
  caution: "bg-amber-500",
  bad: "bg-red-500",
};

const FEATURE_LABEL_KEY: Record<A11yFeature, string> = {
  stairs: "a11yFeatureStairs",
  crossing: "a11yFeatureCrossing",
  curb_ramp_crossing: "a11yFeatureCurbRampCrossing",
  ramp: "a11yFeatureRamp",
  elevator: "a11yFeatureElevator",
  escalator: "a11yFeatureEscalator",
  moving_walkway: "a11yFeatureMovingWalkway",
  fare_gate: "a11yFeatureFareGate",
  exit_gate: "a11yFeatureExitGate",
};

// Order the legend so the things that can stop a wheelchair read first.
const FEATURE_ORDER: A11yFeature[] = [
  "stairs",
  "crossing",
  "curb_ramp_crossing",
  "ramp",
  "elevator",
  "escalator",
  "moving_walkway",
  "fare_gate",
  "exit_gate",
];

// 建築物無障礙設施設計規範: ramps may not exceed 1:12 (8.33%).
function gradeSlope(percent: number): Grade {
  if (percent <= 5) return "good";
  return percent <= 8.33 ? "caution" : "bad";
}

// 建築物無障礙設施設計規範: 90cm clear width to pass, 150cm to turn around.
function gradeWidth(cm: number): Grade {
  if (cm >= 150) return "good";
  return cm >= 90 ? "caution" : "bad";
}

function gradeUnconfirmedCrossings(count: number): Grade {
  if (count === 0) return "good";
  return count <= 2 ? "caution" : "bad";
}

function Metric({
  label,
  grade,
  verdict,
  value,
}: {
  label: string;
  grade: Grade;
  verdict: string;
  value?: string;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-10 shrink-0 text-muted-foreground">{label}</span>
      <span
        className={cn("h-2 w-2 shrink-0 rounded-full", GRADE_DOT[grade])}
        aria-hidden
      />
      <span className="font-medium">{verdict}</span>
      {value && (
        <span className="text-muted-foreground tabular-nums">{value}</span>
      )}
    </div>
  );
}

export function WalkA11ySummary({ leg }: { leg: WalkLeg }) {
  const { t } = useAppTranslation();

  const present = new Set(leg.a11ySegments?.map((s) => s.feature));
  const legend = FEATURE_ORDER.filter((f) => present.has(f));

  const slope = plausibleSlopePercent(
    leg.maxSlopePercent,
    present.has("stairs"),
  );
  const width = leg.minPathWidthCm;
  // 0 means "not observed", never "no ramp there", so the wording has to stay
  // at "unconfirmed" — calling it "no ramp" would send people the long way.
  const unconfirmed =
    leg.crossings != null && leg.crossingsWithCurbRamp != null
      ? leg.crossings - leg.crossingsWithCurbRamp
      : null;

  const hasMetrics = slope != null || width != null || unconfirmed != null;
  if (!legend.length && !hasMetrics) return null;

  return (
    <div className="mt-2 space-y-1.5">
      {legend.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="text-muted-foreground">{t("walkA11yAlong")}</span>
          {legend.map((feature) => (
            <span key={feature} className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: A11Y_FEATURE_COLOR[feature] }}
                aria-hidden
              />
              {t(FEATURE_LABEL_KEY[feature])}
            </span>
          ))}
        </div>
      )}

      {hasMetrics && (
        <div className="space-y-1">
          {slope != null && (
            <Metric
              label={t("walkA11ySlopeLabel")}
              grade={gradeSlope(slope)}
              verdict={t(`slopeVerdict_${gradeSlope(slope)}`)}
              value={`${slope.toFixed(1)}%`}
            />
          )}
          {width != null && (
            <Metric
              label={t("walkA11yWidthLabel")}
              grade={gradeWidth(width)}
              verdict={t(`widthVerdict_${gradeWidth(width)}`)}
              value={t("widthCm", { width })}
            />
          )}
          {unconfirmed != null && leg.crossings != null && (
            <Metric
              label={t("walkA11yCrossingLabel")}
              grade={gradeUnconfirmedCrossings(unconfirmed)}
              verdict={
                unconfirmed === 0
                  ? t("crossingAllRamped")
                  : t("crossingUnconfirmed", {
                      count: unconfirmed,
                      total: leg.crossings,
                    })
              }
            />
          )}
        </div>
      )}
    </div>
  );
}
