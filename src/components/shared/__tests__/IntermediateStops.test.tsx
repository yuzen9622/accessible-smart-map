import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/zh-TW",
  redirect: () => {},
}));
vi.mock("@/stores/useAuthStore", () => ({
  default: vi.fn(),
}));

import { IntermediateStops } from "@/components/shared/RouteCard/IntermediateStops";
import i18n from "@/i18n/client";
import type { BusLegStopRow } from "@/lib/transit/busLegStops";
import useAuthStore from "@/stores/useAuthStore";
import type { IntermediateStop } from "@/types/route";

const mockUseAuthStore = vi.mocked(useAuthStore);

describe("IntermediateStops Component", () => {
  beforeEach(async () => {
    mockUseAuthStore.mockReset();
    mockUseAuthStore.mockReturnValue({
      userConfig: { language: "zh-TW" },
      updateUserConfig: vi.fn(),
    } as never);
    await i18n.changeLanguage("zh-TW");
  });

  const mockStops: IntermediateStop[] = [
    { name: "中正紀念堂", stationUid: "TPE1" },
    { name: "古亭", stationUid: "TPE2" },
  ];

  const mockRows: BusLegStopRow[] = [
    {
      seq: 1,
      name: "站點 A",
      estimateMinutes: 0,
      statusLabel: "進站中",
      state: "passed",
      kind: "intermediate",
    },
    {
      seq: 2,
      name: "站點 B",
      estimateMinutes: 2,
      statusLabel: "即將到站",
      state: "current",
      kind: "intermediate",
    },
    {
      seq: 3,
      name: "站點 C",
      estimateMinutes: 8,
      statusLabel: "8 分鐘",
      state: "upcoming",
      kind: "intermediate",
    },
  ];

  it("renders closed by default (aria-expanded=false)", () => {
    const html = renderToStaticMarkup(
      <IntermediateStops stops={mockStops} color="#3b82f6" />,
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("經過 2 個站點");
  });

  it("renders plain stops correctly without ETA when rows not provided", () => {
    const html = renderToStaticMarkup(
      <IntermediateStops stops={mockStops} color="#3b82f6" open={true} />,
    );
    expect(html).toContain("中正紀念堂");
    expect(html).toContain("古亭");
    expect(html).not.toContain("即將到站");
  });

  it("renders rows with ETA, passed line-through, and current pulse when rows provided", () => {
    const html = renderToStaticMarkup(
      <IntermediateStops
        rows={mockRows}
        color="#3b82f6"
        open={true}
        targetPlate="EAA-123"
      />,
    );

    expect(html).toContain("站點 A");
    expect(html).toContain("line-through");
    expect(html).toContain("已過站");

    expect(html).toContain("站點 B");
    expect(html).toContain("animate-ping");
    expect(html).toContain("EAA-123");
    expect(html).toContain("即將到站");

    expect(html).toContain("站點 C");
    expect(html).toContain("8 分");
  });

  it("returns null when no stops or rows", () => {
    const html = renderToStaticMarkup(
      <IntermediateStops color="#3b82f6" open={true} />,
    );
    expect(html).toBe("");
  });
});
