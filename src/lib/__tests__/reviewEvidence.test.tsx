import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ReviewEvidenceDetails,
  ReviewEvidenceFields,
} from "@/components/BottomSheet/ReviewEvidence";
import {
  evidenceLines,
  fromReviewEvidence,
  toEvidencePayload,
  UNSET,
} from "@/lib/reviewEvidence";
import type { ReviewItem } from "@/types/review";

const review: ReviewItem = {
  _id: "r",
  userId: "u",
  rating: 3,
  passageWidthRating: 3,
  toiletRating: 3,
  elevatorRating: 3,
  serviceRating: 3,
  createdAt: "2026-10-11",
};
const t = (key: string) => key;
describe("structured review evidence", () => {
  it("keeps legacy missing data unassessed and omits all unset fields", () => {
    const form = fromReviewEvidence(review);
    expect(Object.values(form)).toEqual(Array(5).fill(UNSET));
    expect(toEvidencePayload(form)).toEqual({});
    expect(evidenceLines(review, t)).toEqual([]);
    expect(
      renderToStaticMarkup(<ReviewEvidenceDetails review={review} t={t} />),
    ).toBe("");
  });
  it("prefills and serializes every evidence field including false without aggregate", () => {
    const existing = {
      ...review,
      entranceAccessibility: "ramp" as const,
      toiletTurningRoom: false,
      wheelchairTableHeight: true,
      adequateAisleWidth: false,
      staffHelpfulnessRating: 5,
      aggregateAccessibilityScore: 73.5,
    };
    expect(fromReviewEvidence(existing).toiletTurningRoom).toBe("no");
    expect(toEvidencePayload(fromReviewEvidence(existing))).toEqual({
      entranceAccessibility: "ramp",
      toiletTurningRoom: false,
      wheelchairTableHeight: true,
      adequateAisleWidth: false,
      staffHelpfulnessRating: 5,
    });
    const html = renderToStaticMarkup(
      <ReviewEvidenceDetails review={existing} t={t} />,
    );
    expect(html).toContain(
      "nativeReviewEvidence_toiletTurningRoom：nativeReviewNo",
    );
    expect(html).toContain("nativeReviewStaff：5/5");
    expect(html).toContain("nativeReviewAggregate：73.5");
  });
  it("renders zero aggregate rather than treating it as missing", () => {
    expect(
      renderToStaticMarkup(
        <ReviewEvidenceDetails
          review={{ ...review, aggregateAccessibilityScore: 0 }}
          t={t}
        />,
      ),
    ).toContain("0.0");
  });
  it("offers unassessed only for originally unset fields and explains PATCH limitation", () => {
    const persisted = fromReviewEvidence({
      toiletTurningRoom: false,
      entranceAccessibility: "step_free",
    });
    const html = renderToStaticMarkup(
      <ReviewEvidenceFields
        value={persisted}
        persisted={persisted}
        disabled={false}
        onChange={() => {}}
        t={t}
      />,
    );
    expect((html.match(/value="unset"/g) ?? []).length).toBe(3);
    expect(html).toContain("reviewEvidenceCannotClear");
    expect((html.match(/<label/g) ?? []).length).toBe(5);
    expect(html).toContain("min-h-11");
    expect(html).toContain('value="no" selected=""');
  });
  it("new form reset forgets prior evidence and offers all unassessed choices", () => {
    const empty = fromReviewEvidence();
    const html = renderToStaticMarkup(
      <ReviewEvidenceFields
        value={empty}
        persisted={empty}
        disabled={false}
        onChange={() => {}}
        t={t}
      />,
    );
    expect((html.match(/value="unset"/g) ?? []).length).toBe(5);
    expect(html).not.toContain("reviewEvidenceCannotClear");
  });
  it.each(["0", "6", "2.5", "NaN", UNSET])(
    "does not serialize invalid staff score %s",
    (staff) => {
      expect(
        toEvidencePayload({
          ...fromReviewEvidence(),
          staffHelpfulnessRating: staff,
        }),
      ).toEqual({});
    },
  );
});
