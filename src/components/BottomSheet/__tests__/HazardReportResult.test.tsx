import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "@/i18n/locale/en/translation.json";
import type { HazardReport } from "@/types/route";

vi.mock("@/i18n/client", () => ({
  useAppTranslation: () => ({
    t: (key: string) => (en as Record<string, unknown>)[key] ?? key,
  }),
}));

import { HazardReportResultContent } from "@/components/BottomSheet/HazardReportResult";

const base: HazardReport = {
  _id: "test",
  publicPhotoUrl: null,
  hazardType: "obstacle",
  status: "pending",
  reportedLocation: { type: "Point", coordinates: [121, 25] },
};
function render(report: HazardReport, merged = false) {
  return renderToStaticMarkup(
    <HazardReportResultContent
      report={report}
      reportId={report._id}
      merged={merged}
      notice="idle"
      canVote
      onRefresh={vi.fn()}
      onResubmit={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );
}
describe("actual review result component", () => {
  it("uncertain commit offers query first, and an explicit new submission after 404", () => {
    const props = {
      reportId: "uncertain",
      onRefresh: vi.fn(),
      onResubmit: vi.fn(),
      onConfirm: vi.fn(),
      onNewSubmission: vi.fn(),
    };
    const pending = renderToStaticMarkup(
      <HazardReportResultContent {...props} notice="idle" />,
    );
    expect(pending).toContain(en.hazardReviewUncertain);
    expect(pending).toContain(en.hazardReviewRefresh);
    expect(pending).not.toContain(en.hazardReviewResubmit);
    const missing = renderToStaticMarkup(
      <HazardReportResultContent {...props} notice="missing" />,
    );
    expect(missing).toContain(en.hazardPoll_missing);
    expect(missing).toContain(en.hazardReviewResubmit);
  });
  it("supported is photo evidence, not on-site verification or confidence", () => {
    const html = render({
      ...base,
      status: "verified",
      aiReview: {
        version: 2,
        state: "completed",
        decision: "supported",
        reason: "Visible obstruction",
        reasonCode: "TEST",
      },
      aiVerification: {
        verdict: "verified",
        confidence: 0.95,
        reason: "legacy",
      },
    });
    expect(html).toContain(
      "Photo supports the report; not on-site verification",
    );
    expect(html).toContain("Visible obstruction");
    expect(html).not.toContain("95%");
    expect(html).toContain(en.confirmHazard);
  });
  it("needs evidence offers new submission and controlled hints, renders reason as text", () => {
    const html = render(
      {
        ...base,
        aiReview: {
          version: 2,
          state: "completed",
          decision: "needs_evidence",
          reason: "<img src=x onerror=alert(1)>",
          reasonCode: "MAP_REFERENCE_REQUIRED",
          requiredEvidence: ["map_reference", "wider_view"],
          observations: ["<script>bad</script>"],
          limitations: ["Location unknown"],
        },
      },
      true,
    );
    expect(html).toContain(en.hazardReviewNeedsEvidence);
    expect(html).toContain(en.hazardReviewResubmit);
    expect(html).toContain(en.hazardEvidence_map_reference);
    expect(html).toContain(en.hazardReviewMerged);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain(en.confirmHazard);
  });
  it("manual verified override still displays verified after AI cancellation", () => {
    const html = render({
      ...base,
      status: "verified",
      aiReview: {
        version: 2,
        state: "cancelled",
        reason: "Manual override",
        reasonCode: "MANUAL_OVERRIDE",
      },
    });
    expect(html).toContain(en.hazardReviewVerified);
    expect(html).not.toContain(en.hazardReviewCancelled);
    expect(html).toContain(en.confirmHazard);
  });
  it("explicit backend delay displays delay instead of processing", () => {
    const html = render({
      ...base,
      aiReview: {
        version: 2,
        state: "processing",
        delayed: true,
        reason: "Delayed",
        reasonCode: "TEST",
      },
    });
    expect(html).toContain(en.hazardReviewDelayed);
    expect(html).not.toContain(en.hazardReviewProcessing);
  });
  it("temporary failure offers new photo rather than infinite recognition spinner", () => {
    const html = render({
      ...base,
      aiReview: {
        version: 2,
        state: "failed",
        reason: "Temporary failure",
        reasonCode: "PROVIDER_TIMEOUT",
      },
    });
    expect(html).toContain(en.hazardReviewFailed);
    expect(html).toContain(en.hazardReviewResubmit);
    expect(html).not.toContain(en.hazardReviewProcessing);
  });
  it("legacy stale and expiry are explicit, expiry removes votes/resubmit and photo observations", () => {
    const legacy = {
      ...base,
      createdAt: new Date(Date.now() - 700_000).toISOString(),
      aiVerification: {
        verdict: "skipped" as const,
        reason: "legacy",
        confidence: 0,
      },
    };
    expect(render(legacy)).toContain(en.hazardReviewLegacyStalled);
    const expired = render({
      ...legacy,
      expiredAt: new Date(Date.now() - 1).toISOString(),
    });
    expect(expired).toContain(en.hazardReviewExpired);
    expect(expired).not.toContain(en.confirmHazard);
    expect(expired).not.toContain(en.hazardReviewResubmit);
  });
});
