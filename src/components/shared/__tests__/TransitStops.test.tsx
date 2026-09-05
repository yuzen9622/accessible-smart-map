import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/zh-TW",
  redirect: () => {},
}));
vi.mock("@/stores/useAuthStore", () => ({
  default: vi.fn(),
}));

import { TransitStops } from "@/components/shared/RouteCard/TransitStops";
import i18n from "@/i18n/client";
import type { BusLegStopRow } from "@/lib/transit/busLegStops";
import useAuthStore from "@/stores/useAuthStore";

const mockUseAuthStore = vi.mocked(useAuthStore);

const rows: BusLegStopRow[] = [
  {
    seq: 0,
    name: "臺中車站(大智北路)",
    estimateMinutes: null,
    statusLabel: "20:42",
    state: "upcoming",
    kind: "board",
  },
  {
    seq: 1,
    name: "干城站",
    estimateMinutes: null,
    statusLabel: "20:45",
    state: "upcoming",
    kind: "intermediate",
  },
  {
    seq: 2,
    name: "國立臺中科技大學",
    estimateMinutes: null,
    statusLabel: "20:54",
    state: "upcoming",
    kind: "alight",
  },
];

function renderStops(
  liveEtaMinutes?: number | null,
  isStopsOpen: boolean = true,
) {
  return renderToStaticMarkup(
    <TransitStops
      boardName="臺中車站(大智北路)"
      alightName="國立臺中科技大學"
      boardTime="20:46"
      alightTime="20:56"
      color="#22c55e"
      rows={rows}
      isStopsOpen={isStopsOpen}
      liveEtaMinutes={liveEtaMinutes}
    />,
  );
}

describe("TransitStops endpoint timing", () => {
  beforeEach(async () => {
    mockUseAuthStore.mockReset();
    mockUseAuthStore.mockReturnValue({
      userConfig: { language: "zh-TW" },
      updateUserConfig: vi.fn(),
    } as never);
    await i18n.changeLanguage("zh-TW");
  });

  it("replaces the boarding timetable with one clearly-labelled live countdown", () => {
    const html = renderStops(4);

    expect(html).toContain("即時・4 分鐘後");
    expect(html).not.toContain("20:42");
    expect(html).not.toContain("20:46");
    expect(html).toContain("預定 20:56");
    expect(html).not.toContain("20:54");
  });

  it("shows only labelled timetable times when no exact-vehicle ETA exists", () => {
    const html = renderStops(null);

    expect(html).toContain("預定 20:46");
    expect(html).toContain("預定 20:56");
    expect(html).not.toContain("20:42");
    expect(html).not.toContain("20:54");
  });

  it("uses an immediate-arrival message instead of zero minutes", () => {
    const html = renderStops(0);

    expect(html).toContain("即時・進站中");
    expect(html).not.toContain("0 分鐘後");
  });

  it("does not leak the active leg's live countdown into a closed leg", () => {
    const html = renderStops(4, false);

    expect(html).toContain("預定 20:46");
    expect(html).not.toContain("即時・4 分鐘後");
  });
});
