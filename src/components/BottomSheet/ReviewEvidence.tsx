import { useId } from "react";
import {
  BOOLEAN_EVIDENCE_KEYS,
  ENTRANCE_VALUES,
  EVIDENCE_KEYS,
  type EvidenceForm,
  evidenceLines,
  type ReviewTranslate,
  reviewText,
  UNSET,
} from "@/lib/reviewEvidence";
import type { ReviewItem } from "@/types/review";

export function ReviewEvidenceFields({
  value,
  persisted,
  onChange,
  disabled,
  t,
}: {
  value: EvidenceForm;
  persisted: EvidenceForm;
  onChange: (value: EvidenceForm) => void;
  disabled: boolean;
  t: ReviewTranslate;
}) {
  const id = useId();
  const text = (key: string) => reviewText(t, key);
  const label = (key: string) =>
    text(
      key === "entranceAccessibility"
        ? "nativeReviewEntrance"
        : key === "staffHelpfulnessRating"
          ? "nativeReviewStaff"
          : `nativeReviewEvidence_${key}`,
    );
  return (
    <fieldset
      disabled={disabled}
      className="space-y-2"
      aria-describedby={`${id}-hint`}
    >
      <legend className="text-sm font-medium">
        {text("nativeReviewEvidenceTitle")}
      </legend>
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        {text("nativeReviewEvidenceFooter")}
      </p>
      {EVIDENCE_KEYS.map((key) => (
        <div key={key} className="space-y-1">
          <label htmlFor={`${id}-${key}`} className="block text-xs">
            {label(key)}
          </label>
          <select
            id={`${id}-${key}`}
            value={value[key]}
            onChange={(event) =>
              onChange({ ...value, [key]: event.target.value })
            }
            aria-describedby={
              persisted[key] !== UNSET ? `${id}-saved` : undefined
            }
            className="min-h-11 w-full rounded-lg border border-border bg-background px-2 text-sm focus-visible:outline-2 focus-visible:outline-primary"
          >
            {persisted[key] === UNSET && (
              <option value={UNSET}>{text("nativeReviewNotAssessed")}</option>
            )}
            {key === "entranceAccessibility" &&
              ENTRANCE_VALUES.map((v) => (
                <option key={v} value={v}>
                  {text(`nativeReviewEntrance_${v}`)}
                </option>
              ))}
            {BOOLEAN_EVIDENCE_KEYS.some((v) => v === key) && (
              <>
                <option value="yes">{text("nativeReviewYes")}</option>
                <option value="no">{text("nativeReviewNo")}</option>
              </>
            )}
            {key === "staffHelpfulnessRating" &&
              [1, 2, 3, 4, 5].map((v) => (
                <option key={v} value={String(v)}>
                  {v}/5
                </option>
              ))}
          </select>
        </div>
      ))}
      {EVIDENCE_KEYS.some((key) => persisted[key] !== UNSET) && (
        <p id={`${id}-saved`} className="text-xs text-muted-foreground">
          {text("reviewEvidenceCannotClear")}
        </p>
      )}
    </fieldset>
  );
}

export function ReviewEvidenceDetails({
  review,
  t,
}: {
  review: ReviewItem;
  t: ReviewTranslate;
}) {
  const lines = evidenceLines(review, t);
  const score = review.aggregateAccessibilityScore;
  return (
    <>
      {lines.length > 0 && (
        <ul className="text-xs text-muted-foreground space-y-1">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {typeof score === "number" && Number.isFinite(score) && (
        <p className="text-xs text-muted-foreground">
          {reviewText(t, "nativeReviewAggregate")}：{score.toFixed(1)}/5
        </p>
      )}
    </>
  );
}
