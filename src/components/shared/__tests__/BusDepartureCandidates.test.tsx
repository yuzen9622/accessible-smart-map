import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/zh-TW",
  redirect: () => {},
}));
vi.mock("@/stores/useAuthStore", () => ({ default: vi.fn() }));

import { BusDepartureCandidates } from "@/components/shared/RouteCard/BusDepartureCandidates";
import { BusLegDetails } from "@/components/shared/RouteCard/BusLegDetails";
import { RouteJourneyTime } from "@/components/shared/RouteCard/RouteJourneyTime";
import i18n from "@/i18n/client";
import { departureCandidates } from "@/lib/transit/__tests__/fixtures/departureCandidates";
import useAuthStore from "@/stores/useAuthStore";
import type { BusLeg } from "@/types/route";

beforeEach(async () => {
  vi.mocked(useAuthStore).mockReturnValue({
    userConfig: { language: "zh-TW" },
    updateUserConfig: vi.fn(),
  } as never);
  await i18n.changeLanguage("zh-TW");
});
const visible = (html: string) => html.replace(/<[^>]+>/g, "");
const render = (viewedCandidateId?: string) =>
  renderToStaticMarkup(
    <BusDepartureCandidates
      candidates={departureCandidates}
      viewedCandidateId={viewedCandidateId}
      onViewCandidate={() => {}}
    />,
  );

// Presentation v2 supersedes the old verbose/native-select assertions by the
// user's explicit request. Candidate identity / unknown / legacy rules remain.
describe("compact shadcn candidate view", () => {
  it("shows the non-first adopted service and a shadcn service selector", () => {
    const html = render();
    expect(html).toContain('data-candidate-id="chosen-82"');
    expect(visible(html)).not.toContain("建議");
    expect(visible(html)).toContain("00:00");
    expect(visible(html)).not.toContain("23:58");
    expect(html).toContain('data-slot="select-trigger"');
    expect(html).toContain('role="combobox"');
    expect(visible(html)).not.toContain("不會變更路線或導航");
    expect(visible(html)).not.toContain("2026/");
    expect(html).not.toContain("<details");
  });
  it("shows another service without presenting it as adopted or inventing accessibility evidence", () => {
    const html = render("early-12");
    expect(html).toContain('data-candidate-id="early-12"');
    expect(visible(html)).toContain("等候約 2 分");
    expect(visible(html)).not.toContain("建議");
    expect(visible(html)).not.toContain("低地板公車");
    expect(visible(html)).not.toContain("BUS-82");
  });
  it("keeps unknown times unknown without extra hint popovers", () => {
    const html = render("later-82");
    expect(visible(html)).not.toContain("發車");
    expect(visible(html)).not.toContain("0 分");
    expect(visible(html)).not.toContain("低地板公車");
    expect(visible(html)).not.toContain("無障礙車輛資訊未知");
    expect(html).not.toContain('data-slot="popover-trigger"');
  });
  it("rounds fractional wait minutes", () => {
    const html = renderToStaticMarkup(
      <BusDepartureCandidates
        candidates={[
          {
            ...departureCandidates[1],
            boardingTimeSource: "realtime",
            estimatedWaitMinutes: 3.2889,
          },
        ]}
        onViewCandidate={() => {}}
      />,
    );
    expect(visible(html)).toContain("等候約 3 分");
    expect(visible(html)).not.toContain("3.2889");
  });
  it("does not offer other services when only the adopted service exists", () => {
    const html = renderToStaticMarkup(
      <BusDepartureCandidates
        candidates={[departureCandidates[1]]}
        onViewCandidate={() => {}}
      />,
    );
    expect(html).toContain('data-candidate-id="chosen-82"');
    expect(html).not.toContain('data-slot="select-trigger"');
  });
  it("asks which service to view when the backend marks none adopted", () => {
    const html = renderToStaticMarkup(
      <BusDepartureCandidates
        candidates={departureCandidates.map((candidate) => ({
          ...candidate,
          selected: false,
        }))}
        onViewCandidate={() => {}}
      />,
    );
    expect(html).not.toContain("data-candidate-id=");
    expect(visible(html)).toContain("選擇搭乘班次");
    expect(visible(html)).not.toContain("23:58");
  });
  it("keeps boarding and alighting times on the stop rows", () => {
    const leg: BusLeg = {
      type: "BUS",
      routeName: "82",
      subRouteUid: "route-82",
      departureStop: "A",
      arrivalStop: "B",
      departureTime: "00:00",
      arrivalTime: "00:20",
      direction: 0,
      estimatedWaitMinutes: 4,
      waitInfo: { source: "schedule", time: "00:00" },
      polyline: [],
      departureStopA11y: [],
      arrivalStopA11y: [],
      departureCandidates,
    };
    const html = renderToStaticMarkup(
      <BusLegDetails leg={leg} routeIndex={0} legIndex={0} isSelected>
        {"legacy"}
      </BusLegDetails>,
    );
    expect(visible(html)).toContain("00:00");
    expect(visible(html)).toContain("00:20");
    expect(visible(html)).toContain("預定 00:00");
    expect(visible(html)).toContain("預定 00:20");
    expect(visible(html)).not.toContain("原規劃站序");
  });
  it("times the stop rows by the adopted service, not an older plan, and shows its live estimate", () => {
    const leg = {
      type: "BUS",
      routeName: "82",
      subRouteUid: "route-82",
      departureStop: "A",
      arrivalStop: "B",
      departureTime: "23:50",
      arrivalTime: "00:10",
      direction: 0,
      estimatedWaitMinutes: 4,
      waitInfo: { source: "unavailable", time: null },
      polyline: [],
      departureStopA11y: [],
      arrivalStopA11y: [],
      departureCandidates: departureCandidates.map((candidate) =>
        candidate.selected
          ? {
              ...candidate,
              boardingTimeSource: "realtime" as const,
              estimatedWaitMinutes: 4.4,
            }
          : candidate,
      ),
    } satisfies BusLeg;
    const text = visible(
      renderToStaticMarkup(
        <BusLegDetails leg={leg} routeIndex={0} legIndex={0} isSelected>
          {"legacy"}
        </BusLegDetails>,
      ),
    );
    expect(text).toContain("即時・4 分鐘後");
    expect(text).toContain("預定 00:20");
    expect(text).not.toContain("23:50");
    expect(text).not.toContain("00:10");
    expect(text).not.toContain("原規劃");
    expect(text).not.toContain("建議");
  });
  it("does not claim completeness for absent flags and handles an empty refreshed list", () => {
    const html = renderToStaticMarkup(
      <BusDepartureCandidates candidates={[]} onViewCandidate={() => {}} />,
    );
    expect(html).toContain("目前沒有候選班次");
    expect(html).not.toContain("班次未完整");
  });
});

describe("compact journey-level clock times", () => {
  it("shows Taiwan HH:mm with a next-day marker and keeps full ISO in time attributes", () => {
    const html = renderToStaticMarkup(
      <RouteJourneyTime
        departureTime="2026-10-19T15:55:00Z"
        arrivalTime="2026-10-19T16:25:00Z"
      />,
    );
    expect(visible(html)).toContain("23:55");
    expect(visible(html)).toContain("00:25");
    expect(visible(html)).toContain("+1天");
    expect(visible(html)).not.toContain("2026");
    expect(html).toContain('dateTime="2026-10-19T15:55:00Z"');
    expect(html).toContain('dateTime="2026-10-19T16:25:00Z"');
  });
  it("does not show dates/day markers for a same-day journey", () => {
    const html = renderToStaticMarkup(
      <RouteJourneyTime
        departureTime="2026-10-19T08:39:00+08:00"
        arrivalTime="2026-10-19T09:02:00+08:00"
      />,
    );
    expect(visible(html)).toContain("08:39");
    expect(visible(html)).toContain("09:02");
    expect(visible(html)).not.toContain("天");
    expect(visible(html)).not.toContain("2026");
  });
  it("does not add fake journey times for legacy routes", () => {
    expect(renderToStaticMarkup(<RouteJourneyTime />)).toBe("");
  });
});
