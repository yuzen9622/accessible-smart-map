import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locale/en/translation.json";
import { END_POINT } from "@/lib/config";
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
  publicPhotoUrl: "/api/v1/a11y/reports/report-with-photo/photo/public",
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
  it("renders only the backend public URL, never the private byte-stream component", () => {
    const html = render();
    if (!base.publicPhotoUrl) throw new Error("Missing fixture public URL");
    const url = new URL(base.publicPhotoUrl, new URL(END_POINT).origin).href;
    expect(html).toContain(`src="${url}"`);
    expect(html).not.toContain("data-photo-report");
  });
  it("null never guesses a private or legacy storage URL even when a photo exists", () => {
    const html = render({
      ...base,
      publicPhotoUrl: null,
      photoUrl: "https://storage.invalid/private.jpg",
    });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("data-photo-report");
    expect(html).not.toContain("https://storage.invalid");
  });
  it("tolerates a missing public URL during rolling deployment without private fallback", () => {
    const report = { ...base };
    Reflect.deleteProperty(report, "publicPhotoUrl");
    expect(render(report)).not.toContain("<img");
    expect(render(report)).not.toContain("data-photo-report");
  });
  it("uses the explicit public URL rather than hasPhoto as the permission hint", () => {
    expect(render({ ...base, hasPhoto: false })).toContain("/photo/public");
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
