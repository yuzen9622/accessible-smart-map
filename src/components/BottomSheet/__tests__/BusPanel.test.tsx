import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "@/i18n/locale/en/translation.json";
import zh from "@/i18n/locale/zh-TW/translation.json";
import { RouteStopCard } from "../BusPanel";

let language: "zh-TW" | "en" = "zh-TW";
vi.mock("@/i18n/client", () => ({
  useAppTranslation: () => ({
    t: (key: string, params: Record<string, unknown> = {}) => {
      const dict: Record<string, unknown> = language === "en" ? en : zh;
      const value = dict[key] ?? dict[`${key}_other`];
      let text = typeof value === "string" ? value : key;
      for (const [name, value] of Object.entries(params))
        text = text.replace(`{{${name}}}`, String(value));
      return text;
    },
  }),
}));

const render = (estimateMinutes: number | null, statusLabel = "") =>
  renderToStaticMarkup(
    <RouteStopCard
      stop={{
        seq: 1,
        name: "Fixture stop",
        lat: 25,
        lng: 121,
        estimateMinutes,
        statusLabel,
      }}
    />,
  );

describe("BusPanel stop ETA semantics (fixtures)", () => {
  it("renders 0/2/8 without turning null into zero or not departed", () => {
    language = "zh-TW";
    expect(render(0)).toContain("進站中");
    expect(render(2)).toContain("即將到站");
    expect(render(8)).toContain("約 8 分鐘");
    for (const status of ["", "  ", "正常", "暫無到站資訊"]) {
      expect(render(null, status)).toContain("暫無到站資訊");
      expect(render(null, status)).not.toContain("尚未發車");
      expect(render(null, status)).not.toContain("進站中");
    }
  });
  it("preserves explicit service states and clearly identifies schedule fallback", () => {
    language = "zh-TW";
    for (const status of ["尚未發車", "交管不停靠", "今日未營運"])
      expect(render(null, status)).toContain(status);
    expect(render(null, "末班車已過")).toContain(zh.busServiceEnded);
    expect(render(null, "18:15")).toContain("預定 18:15");
    expect(render(null, "明日 06:00 起點發車")).toContain(
      "預定 明日 06:00 起點發車",
    );
    expect(render(null, "臨時調整班次")).toContain("臨時調整班次");
  });
  it("translates unknown, numeric, service and scheduled states into English", () => {
    language = "en";
    expect(render(null, "正常")).toContain("No arrival information");
    expect(render(0)).toContain("Arriving");
    expect(render(2)).toContain("Due");
    expect(render(8)).toContain("~8 min");
    expect(render(null, "尚未發車")).toContain("Not departed");
    expect(render(null, "末班車已過")).toContain("Service ended");
    expect(render(null, "18:15")).toContain("Scheduled 18:15");
    language = "zh-TW";
  });
});
