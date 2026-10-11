import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrackingSnapshot } from "@/lib/transit/busPanelTracking";

const h = vi.hoisted(() => ({
  snapshot: null as TrackingSnapshot | null,
  permission: vi.fn(),
}));
vi.mock("@/hook/useBusPanelTracking", () => ({ default: () => h.snapshot }));
vi.mock("@/i18n/client", () => ({
  useAppTranslation: () => ({
    t: (key: string, params: Record<string, unknown> = {}) => {
      let text = String(params.defaultValue ?? key);
      for (const [k, v] of Object.entries(params))
        text = text.replace(`{{${k}}}`, String(v));
      return text;
    },
  }),
}));

import BusTrackingPanel from "../BusTrackingPanel";

const detail = {
  direction: 2 as const,
  subRouteUid: "branch",
  stops: [
    {
      seq: 10,
      name: "A",
      lat: 25,
      lng: 121,
      estimateMinutes: null,
      statusLabel: "",
    },
    {
      seq: 90,
      name: "B",
      lat: 25.01,
      lng: 121,
      estimateMinutes: null,
      statusLabel: "",
    },
    {
      seq: 100,
      name: "C",
      lat: 25.02,
      lng: 121,
      estimateMinutes: null,
      statusLabel: "",
    },
  ],
};
beforeEach(() => {
  h.snapshot = null;
  h.permission.mockClear();
});
describe("tracking UI", () => {
  it("shows source, explicit boarding, downstream-only alighting and foreground limitation", () => {
    const html = renderToStaticMarkup(
      <BusTrackingPanel
        routeName="99"
        city="Taipei"
        detail={detail}
        initialBoarding={1}
        originName="B"
        unresolvedBranch={false}
      />,
    );
    expect(html).toContain("原選站牌：B");
    expect(html).toContain("你的上車站");
    expect(html).toContain("min-h-11");
    expect(html).toContain("背景或關閉時無法保證提醒");
    const alight = html.split("下車站（僅下游站牌）")[1].split("</select>")[0];
    expect(alight).toContain("3. C");
    expect(alight).not.toContain("1. A");
    expect(alight).not.toContain("2. B");
  });
  it("does not borrow another vehicle's low-floor flag or position", () => {
    h.snapshot = {
      receivedAt: Date.now(),
      arrival: {
        stopName: "A",
        direction: 2,
        directionLabel: "",
        estimateMinutes: 0,
        statusLabel: "",
        plateNumb: "TARGET",
        subRouteUid: "branch",
      },
      buses: [
        {
          plateNumb: "OTHER",
          isLowFloor: "1",
          hasLiftOrRamp: "1",
          direction: 2,
          lat: 25,
          lng: 121,
          gpsTime: new Date().toISOString(),
          speed: 0,
          vehicleClass: "",
        },
      ],
    };
    const html = renderToStaticMarkup(
      <BusTrackingPanel
        routeName="99"
        city="Taipei"
        detail={detail}
        initialBoarding={0}
        unresolvedBranch={false}
      />,
    );
    expect(html).toContain("約 0 分鐘 · 車牌 TARGET");
    expect(html).not.toContain("低地板或有升降設備");
    expect(html).not.toContain("約在 A 附近");
  });
  it("unknown direction and unresolved branch cannot enable reminder", () => {
    for (const props of [
      {
        detail: { ...detail, direction: 255 as const },
        unresolvedBranch: false,
      },
      { detail, unresolvedBranch: true },
    ]) {
      const html = renderToStaticMarkup(
        <BusTrackingPanel
          routeName="99"
          city="Taipei"
          initialBoarding={0}
          {...props}
        />,
      );
      expect(html).toContain('disabled="" aria-pressed="false"');
      expect(html).toContain("暫無可確認的到站資訊");
    }
  });
});
