import i18next from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import en from "@/i18n/locale/en/translation.json";
import zhTW from "@/i18n/locale/zh-TW/translation.json";
import type { RoadLane } from "@/types/route";
import { LaneGuidanceRow, laneGuidanceLabel } from "../LaneGuidanceRow";

const i18n = i18next.createInstance();
beforeAll(async () => {
  await i18n.init({
    lng: "zh-TW",
    resources: {
      "zh-TW": { translation: zhTW },
      en: { translation: en },
    },
  });
});

const lanes: RoadLane[] = [
  {
    directions: ["straight"],
    recommendation: "not_recommended",
    maneuverDirection: null,
  },
  {
    directions: ["straight"],
    recommendation: "not_recommended",
    maneuverDirection: null,
  },
  {
    directions: ["straight", "right"],
    recommendation: "usable",
    maneuverDirection: "right",
  },
  {
    directions: ["right"],
    recommendation: "preferred",
    maneuverDirection: "right",
  },
];

describe("lane guidance row", () => {
  it("labels lanes for screen readers, not by color alone", () => {
    const t = i18n.getFixedT("zh-TW");
    expect(laneGuidanceLabel(lanes, t)).toBe(
      "4 條車道，建議走左起第 4 車道，第 3 車道也可行駛",
    );
    expect(laneGuidanceLabel(lanes, i18n.getFixedT("en"))).toBe(
      "4 lanes; use lane 4 from the left; lane 3 also works",
    );
  });

  it("draws one box per lane, left to right, with distinct preferred/usable shapes and the hint text", () => {
    const html = renderToStaticMarkup(
      <LaneGuidanceRow
        guidance={{ lanes, laneHint: "靠右側兩個車道" }}
        t={i18n.getFixedT("zh-TW")}
      />,
    );
    expect(html).toContain('role="img"');
    expect(html).toContain(
      'aria-label="4 條車道，建議走左起第 4 車道，第 3 車道也可行駛"',
    );
    const boxes = html.match(/class="h-8 w-8 rounded-lg[^"]*"/g) ?? [];
    expect(boxes).toHaveLength(4);
    expect(boxes[3]).toContain("bg-white text-slate-900");
    expect(boxes[2]).toContain("border border-white/60");
    expect(boxes[0]).toContain("text-white/40");
    expect(html).toContain("靠右側兩個車道");
  });
});
