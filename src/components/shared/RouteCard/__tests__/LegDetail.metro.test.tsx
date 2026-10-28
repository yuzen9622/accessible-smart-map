import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import zh from "@/i18n/locale/zh-TW/translation.json";
import type { MetroLeg } from "@/types/route";

vi.mock("@/i18n/client", () => ({
  useAppTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const found = key
        .split(".")
        .reduce<unknown>(
          (node, part) => (node as Record<string, unknown> | undefined)?.[part],
          zh,
        );
      return (
        typeof found === "string" ? found : String(values?.defaultValue ?? key)
      ).replace(/{{(\w+)}}/g, (_, name: string) =>
        String(values?.[name] ?? ""),
      );
    },
  }),
}));
vi.mock("@/i18n/language", () => ({ getAppLanguage: () => "zh-TW" }));

const { LegDetail } = await import("../LegDetail");

const metro = (patch: Partial<MetroLeg> = {}): MetroLeg => ({
  type: "METRO",
  railSystem: "TRTC",
  lineId: "BL",
  lineName: "板南線",
  lineUid: "TRTC_BL_BL-1_1",
  departureStation: "市政府",
  arrivalStation: "台北車站",
  departureStationUid: "TRTC_BL18",
  arrivalStationUid: "TRTC_BL12",
  direction: 1,
  stopsCount: 6,
  rideMinutes: 10,
  waitInfo: { time: null, source: "unavailable" },
  estimatedWaitMinutes: 0,
  polyline: [],
  departureStationA11y: [],
  arrivalStationA11y: [],
  facilityHighlights: [],
  ...patch,
});

const render = (leg: MetroLeg) =>
  renderToStaticMarkup(
    <LegDetail
      leg={leg}
      isFirst={false}
      isLast={false}
      isSelected={false}
      pointCtx={{
        originFallback: "起點",
        destinationFallback: "終點",
        myLocationFallback: "我的位置",
      }}
    />,
  );

describe("metro leg title", () => {
  it("renders the line from its label, not from the source line name", () => {
    const html = render(
      metro({
        lineKey: "TRTC_R_R-3",
        lineName: "舊名",
        terminalStation: "北投",
      }),
    );
    expect(html).toContain("新北投支線・往北投");
    expect(html).not.toContain("舊名");
  });

  it("falls back to the source line name for an unknown label", () => {
    expect(render(metro({ lineKey: "UNKNOWN_X", lineName: "某線" }))).toContain(
      "某線",
    );
  });

  it.each([
    ["板南線", "頂埔"],
    ["板南線", "亞東醫院"],
    ["新北投支線", "北投"],
  ])(
    "shows %s・往%s with the alighting station listed separately",
    (lineName, terminalStation) => {
      const html = render(metro({ lineName, terminalStation }));
      expect(html).toContain(`${lineName}・往${terminalStation}`);
      expect(html).toContain("台北車站");
      expect(html).not.toContain("往台北車站");
    },
  );

  it("shows only the line name when the trip terminal is unknown", () => {
    const html = render(metro());
    expect(html).toContain("板南線");
    expect(html).not.toContain("・往");
  });
});
