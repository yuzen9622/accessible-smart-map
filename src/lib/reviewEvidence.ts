import type {
  EntranceAccessibility,
  ReviewEvidence,
  ReviewItem,
} from "@/types/review";

export const ENTRANCE_VALUES: readonly EntranceAccessibility[] = [
  "step_free",
  "ramp",
  "stairs_with_assistance",
  "inaccessible",
];
export const BOOLEAN_EVIDENCE_KEYS = [
  "toiletTurningRoom",
  "wheelchairTableHeight",
  "adequateAisleWidth",
] as const;
export const EVIDENCE_KEYS = [
  "entranceAccessibility",
  ...BOOLEAN_EVIDENCE_KEYS,
  "staffHelpfulnessRating",
] as const;
export type EvidenceKey = (typeof EVIDENCE_KEYS)[number];
export type EvidenceForm = Record<EvidenceKey, string>;
export const UNSET = "unset";

export function fromReviewEvidence(review: ReviewEvidence = {}): EvidenceForm {
  return {
    entranceAccessibility: review.entranceAccessibility ?? UNSET,
    toiletTurningRoom: booleanToChoice(review.toiletTurningRoom),
    wheelchairTableHeight: booleanToChoice(review.wheelchairTableHeight),
    adequateAisleWidth: booleanToChoice(review.adequateAisleWidth),
    staffHelpfulnessRating:
      review.staffHelpfulnessRating === undefined
        ? UNSET
        : String(review.staffHelpfulnessRating),
  };
}
export function booleanToChoice(value: boolean | undefined): string {
  if (value === undefined) return UNSET;
  return value ? "yes" : "no";
}
/** Omit unassessed fields; PATCH omission preserves persisted values. Never emit null or the response-only score. */
export function toEvidencePayload(form: EvidenceForm): ReviewEvidence {
  const payload: ReviewEvidence = {};
  const entrance = ENTRANCE_VALUES.find(
    (v) => v === form.entranceAccessibility,
  );
  if (entrance) payload.entranceAccessibility = entrance;
  for (const key of BOOLEAN_EVIDENCE_KEYS) {
    if (form[key] === "yes") payload[key] = true;
    else if (form[key] === "no") payload[key] = false;
  }
  const staff = Number(form.staffHelpfulnessRating);
  if (Number.isInteger(staff) && staff >= 1 && staff <= 5)
    payload.staffHelpfulnessRating = staff;
  return payload;
}
export type ReviewTranslate = (
  key: string,
  options?: { defaultValue: string },
) => string;
export const REVIEW_DEFAULTS: Record<string, string> = {
  nativeReviewEvidenceTitle: "無障礙細節（選填）",
  nativeReviewEvidenceFooter:
    "沒有實際觀察到的項目請保持「未評估」，不會被當成「否」。",
  nativeReviewNotAssessed: "未評估",
  nativeReviewYes: "是",
  nativeReviewNo: "否",
  nativeReviewEntrance: "入口",
  nativeReviewEntrance_step_free: "無階通行",
  nativeReviewEntrance_ramp: "有坡道",
  nativeReviewEntrance_stairs_with_assistance: "有階梯，需協助",
  nativeReviewEntrance_inaccessible: "無法通行",
  nativeReviewEvidence_toiletTurningRoom: "廁所可供輪椅迴轉",
  nativeReviewEvidence_wheelchairTableHeight: "桌面高度適合輪椅",
  nativeReviewEvidence_adequateAisleWidth: "走道寬度足夠",
  nativeReviewStaff: "工作人員協助程度",
  nativeReviewAggregate: "無障礙綜合分數",
  nativeReviewTooLong: "評語不得超過 500 字",
  reviewEvidenceCannotClear: "已儲存的項目可以更新，但目前無法改回「未評估」。",
};
export function reviewText(t: ReviewTranslate, key: string) {
  return t(key, { defaultValue: REVIEW_DEFAULTS[key] ?? key });
}
export function evidenceLines(
  review: ReviewItem,
  t: ReviewTranslate,
): string[] {
  const text = (key: string) => reviewText(t, key);
  const lines: string[] = [];
  if (review.entranceAccessibility)
    lines.push(
      `${text("nativeReviewEntrance")}：${text(`nativeReviewEntrance_${review.entranceAccessibility}`)}`,
    );
  for (const key of BOOLEAN_EVIDENCE_KEYS) {
    const value = review[key];
    if (typeof value === "boolean")
      lines.push(
        `${text(`nativeReviewEvidence_${key}`)}：${text(value ? "nativeReviewYes" : "nativeReviewNo")}`,
      );
  }
  if (review.staffHelpfulnessRating !== undefined)
    lines.push(
      `${text("nativeReviewStaff")}：${review.staffHelpfulnessRating}/5`,
    );
  return lines;
}
