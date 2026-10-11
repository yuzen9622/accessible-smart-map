import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import zh from "@/i18n/locale/zh-TW/translation.json";
import { reportDate, reportPresentation } from "@/lib/report-presentation";
import type { HazardReport } from "@/types/route";

vi.mock("@/i18n/client", () => ({
  useAppTranslation: () => ({
    t: (key: string) => (zh as Record<string, unknown>)[key] ?? key,
    i18n: { language: "zh-TW" },
  }),
}));

import { HazardReportResultContent } from "../HazardReportResult";
import HazardReviewDetails from "../HazardReviewDetails";

const report: HazardReport = {
  _id: "test",
  publicPhotoUrl: null,
  hazardType: "construction",
  severity: "difficult",
  status: "rejected",
  reportedLocation: { type: "Point", coordinates: [120.6372, 24.1305] },
  exifValidation: {
    timestampFresh: true,
    gpsPresent: false,
    gpsMatchesClaimed: false,
  },
  aiVerification: {
    verdict: "rejected",
    confidence: 0.05,
    reason: "legacy duplicate",
  },
  aiReview: {
    version: 2,
    state: "completed",
    decision: "unsupported",
    reasonCode: "NON_STREET_IMAGE",
    reason: "照片未呈現可供核對的街道或通路場景。",
    observations: [],
    limitations: ["單張照片無法證實實際寬度。"],
    requiredEvidence: [],
    queuedAt: "2026-10-09T01:26:32.893Z",
    startedAt: "2026-10-09T01:26:33.129Z",
    completedAt: "2026-10-09T01:26:41.561Z",
  },
  createdAt: "2026-10-09T01:26:31.667Z",
};
describe("rich report review presentation", () => {
  it("distinguishes absent GPS from a wrong location and presents the supplied limits and timeline", () => {
    const html = renderToStaticMarkup(<HazardReviewDetails report={report} />);
    expect(html).toContain(zh.reportGpsAbsent);
    expect(html).toContain(zh.reportGpsHint);
    expect(html).not.toContain(zh.reportGpsMatches);
    expect(html).toContain(zh.reportTimeFresh);
    expect(html).toContain("單張照片無法證實實際寬度。");
    expect(html).toContain(zh.reportStreetPhotoHint);
    expect(html).toContain(zh.reportReviewFinished);
    expect(html).toContain("09:26");
    expect(html).not.toContain("5%");
  });
  it("gives rejected reports a new-photo action and renders the v2 reason once", () => {
    const html = renderToStaticMarkup(
      <HazardReportResultContent
        report={report}
        reportId="test"
        notice="idle"
        onRefresh={vi.fn()}
        onResubmit={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(html).toContain(zh.hazardReviewResubmit);
    expect(html.split("照片未呈現可供核對的街道或通路場景。")).toHaveLength(2);
    expect(html).not.toContain("legacy duplicate");
    expect(html).toContain(zh.reportStateRejected);
  });
  it("does not invent a timeline or metadata checks when omitted", () => {
    const html = renderToStaticMarkup(
      <HazardReviewDetails
        report={{
          ...report,
          aiReview: undefined,
          exifValidation: undefined,
          createdAt: undefined,
        }}
      />,
    );
    expect(html).not.toContain(zh.reportTimeline);
    expect(html).not.toContain(zh.reportTimeFresh);
    expect(html).toContain(zh.reportNoEvidence);
  });
  it("keeps expiry higher priority and formats Taiwan time independently of browser timezone", () => {
    expect(
      reportPresentation(
        { ...report, expiredAt: "2026-10-08T00:00:00Z" },
        Date.parse("2026-10-09T00:00:00Z"),
      ).label,
    ).toBe("reportStateExpired");
    expect(reportDate("2026-10-09T01:26:31.667Z", "zh-TW")).toContain("09:26");
    expect(reportDate("invalid")).toBe("—");
  });
});
