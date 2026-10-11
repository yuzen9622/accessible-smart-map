import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locale/en/translation.json";
import type { HazardReport } from "@/types/route";

const state = vi.hoisted(() => ({
  cursor: 0,
  report: null as HazardReport | null,
  user: { _id: "viewer" },
  voted: new Set<string>(),
  voting: null as string | null,
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const values = [[state.report], state.report, state.voted, state.voting];
    const index = state.cursor++;
    return [index < values.length ? values[index] : initial, vi.fn()];
  },
}));
vi.mock("react-map-gl/maplibre", () => ({
  Marker: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Popup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/stores/useMapStore", () => ({
  default: (selector: (s: unknown) => unknown) =>
    selector({ userLocation: null }),
}));
vi.mock("@/stores/useAuthStore", () => ({
  default: (selector: (s: unknown) => unknown) =>
    selector({ user: state.user }),
}));
vi.mock("@/stores/useContentSafetyStore", () => ({
  default: (selector: (s: unknown) => unknown) =>
    selector({ accountEpoch: 0, revision: 0 }),
}));
vi.mock("@/components/content-safety/ContentSafetyMenu", () => ({
  default: () => null,
}));
vi.mock("@/components/BottomSheet/HazardReportPhoto", () => ({
  default: ({
    reportId,
    variant,
    retryable,
  }: {
    reportId: string;
    variant?: string;
    retryable?: boolean;
  }) => (
    <span
      data-photo-report={reportId}
      data-variant={variant}
      data-retryable={retryable}
    />
  ),
}));
vi.mock("@/i18n/client", () => ({
  useAppTranslation: () => ({
    t: (key: string) => (en as Record<string, unknown>)[key] ?? key,
  }),
}));
vi.mock("@/lib/api/a11y", () => ({
  confirmHazardReport: vi.fn(),
  getNearbyHazardReports: vi.fn(),
}));

import HazardWrapper, { hazardPopupPan } from "../HazardWrapper";

const base: HazardReport = {
  _id: "report-with-photo",
  hazardType: "obstacle",
  status: "verified",
  reporterId: "author",
  reportedLocation: { type: "Point", coordinates: [121, 25] },
  hasPhoto: true,
  description: "Construction blocks the pavement",
  severity: "difficult",
  confirmCount: 3,
  denyCount: 1,
  aiReview: {
    version: 2,
    state: "completed",
    decision: "supported",
    reasonCode: "TEST",
    reason: "Visible obstruction; not independently verified on site.",
  },
};
function render(report: HazardReport = base) {
  state.cursor = 0;
  state.report = report;
  return renderToStaticMarkup(<HazardWrapper />);
}
beforeEach(() => {
  state.user = { _id: "viewer" };
  state.voted = new Set();
  state.voting = null;
});
describe("report popup viewport fitting", () => {
  const desktop = { left: 0, top: 0, right: 1280, bottom: 800 };
  it("does not move cards already inside the usable viewport", () => {
    expect(
      hazardPopupPan({ left: 450, top: 100, right: 786, bottom: 650 }, desktop),
    ).toEqual([0, 0]);
  });
  it("pans down for top overflow and right for left overflow", () => {
    expect(
      hazardPopupPan({ left: 30, top: -200, right: 366, bottom: 350 }, desktop),
    ).toEqual([-54, -216]);
  });
  it("pans left/up for right/bottom overflow, leaving map controls clear", () => {
    expect(
      hazardPopupPan(
        { left: 1000, top: 350, right: 1336, bottom: 900 },
        desktop,
      ),
    ).toEqual([128, 116]);
  });
  it("keeps mobile cards left of controls and above the peek sheet", () => {
    const viewport = { left: 0, top: 0, right: 375, bottom: 812 };
    const card = { left: 44, top: 200, right: 331, bottom: 750 };
    const [dx, dy] = hazardPopupPan(card, viewport);
    expect(card.left - dx).toBe(16);
    expect(card.right - dx).toBe(303);
    expect(card.bottom - dy).toBeCloseTo(698.56);
  });
});

describe("map hazard popup", () => {
  it("renders an attached photo through the authenticated byte-stream component", () => {
    const html = render();
    expect(html).toContain('data-photo-report="report-with-photo"');
    expect(html).toContain('data-variant="popup"');
    expect(html).toContain('data-retryable="true"');
  });
  it("uses the same secure photo path for legacy reports, never the storage URL", () => {
    const html = render({
      ...base,
      hasPhoto: undefined,
      photoUrl: "https://storage.invalid/private.jpg",
    });
    expect(html).toContain('data-photo-report="report-with-photo"');
    expect(html).not.toContain("https://storage.invalid");
  });
  it("does not request photos when explicitly absent", () => {
    expect(
      render({
        ...base,
        hasPhoto: false,
        photoUrl: "https://storage.invalid/old.jpg",
      }),
    ).not.toContain("data-photo-report");
  });
  it("keeps photo evidence distinct from on-site verification and escapes user text", () => {
    const html = render({
      ...base,
      description: '<script>alert("x")</script>',
    });
    expect(html).toContain(en.hazardReviewSupported);
    expect(html).toContain(base.aiReview?.reason);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
  it("shows severity and both community vote counts", () => {
    const html = render();
    expect(html).toContain(en.severityDifficult);
    expect(html).toContain(en.reportConfirmCount);
    expect(html).toContain(en.reportDenyCount);
    expect(html).toContain(">3<");
    expect(html).toContain(">1<");
  });
  it("preserves own-report, voted and in-flight vote guards", () => {
    state.user = { _id: "author" };
    expect(render()).not.toContain(en.confirmHazard);
    state.user = { _id: "viewer" };
    state.voted = new Set([base._id]);
    expect(render()).toContain(en.hazardVoted);
    expect(render()).not.toContain(en.confirmHazard);
    state.voted = new Set();
    state.voting = base._id;
    expect(render()).toMatch(/disabled=""/);
  });
  it("does not show expired reports or offer votes on rejected reports", () => {
    expect(render({ ...base, status: "expired" })).not.toContain(
      "data-photo-report",
    );
    expect(render({ ...base, status: "rejected" })).not.toContain(
      en.confirmHazard,
    );
  });
});
