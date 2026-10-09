import { createInstance } from "i18next";
import { beforeAll, describe, expect, it } from "vitest";
import en from "@/i18n/locale/en/translation.json";
import zhTW from "@/i18n/locale/zh-TW/translation.json";
import type { ToolActivity } from "@/stores/useChatStore";
import {
  buildTraceRows as buildTraceRowsTranslated,
  describeThinking as describeThinkingTranslated,
  formatThinkingDuration as formatThinkingDurationTranslated,
  shouldShowTrace,
  summarizeToolArgs as summarizeToolArgsTranslated,
} from "../thinkingTrace";

const translations = createInstance();
beforeAll(async () => {
  await translations.init({
    resources: { en: { translation: en }, "zh-TW": { translation: zhTW } },
    lng: "zh-TW",
    fallbackLng: "zh-TW",
    interpolation: { escapeValue: false },
  });
});
const zh = translations.getFixedT("zh-TW");
const english = translations.getFixedT("en");
const buildTraceRows = (activities: ToolActivity[]) =>
  buildTraceRowsTranslated(activities, zh);
const summarizeToolArgs = (args: unknown) =>
  summarizeToolArgsTranslated(args, zh);
const formatThinkingDuration = (ms: number) =>
  formatThinkingDurationTranslated(ms, zh);
const describeThinking = (
  input: Omit<Parameters<typeof describeThinkingTranslated>[0], "t">,
) => describeThinkingTranslated({ ...input, t: zh });

function activity(
  name: string,
  status: ToolActivity["status"],
  args?: unknown,
): ToolActivity {
  return { name, status, args };
}

describe("summarizeToolArgs", () => {
  it("組合起訖點，並把 current_location 換成人看得懂的字", () => {
    expect(
      summarizeToolArgs(
        JSON.stringify({ origin: "current_location", destination: "台北101" }),
      ),
    ).toBe("目前位置 → 台北101");
  });

  it("只有終點時不畫箭頭", () => {
    expect(summarizeToolArgs(JSON.stringify({ destination: "台中車站" }))).toBe(
      "台中車站",
    );
  });

  it("沒有起訖點時退回 query 這類欄位", () => {
    expect(
      summarizeToolArgs(
        JSON.stringify({ query: "無障礙廁所", latitude: 25, longitude: 121 }),
      ),
    ).toBe("無障礙廁所");
  });

  it("依 DETAIL_KEYS 的順序挑欄位（routeName 優先於 stopName）", () => {
    expect(
      summarizeToolArgs(
        JSON.stringify({ stopName: "市政府", routeName: "藍7" }),
      ),
    ).toBe("藍7");
  });

  it("args 已經是物件時也要吃（型別上是 unknown，不保證被序列化過）", () => {
    expect(summarizeToolArgs({ query: "電梯" })).toBe("電梯");
  });

  it("過長的值會截斷並補上省略號", () => {
    const long = "台".repeat(40);
    const out = summarizeToolArgs(JSON.stringify({ query: long }));
    expect(out).toHaveLength(22);
    expect(out?.endsWith("…")).toBe(true);
  });

  it("壞掉的 JSON、空字串、只有座標的參數都回 undefined 而不是丟錯", () => {
    expect(summarizeToolArgs("{不是 JSON")).toBeUndefined();
    expect(summarizeToolArgs("")).toBeUndefined();
    expect(summarizeToolArgs(undefined)).toBeUndefined();
    expect(
      summarizeToolArgs(JSON.stringify({ latitude: 25, longitude: 121 })),
    ).toBeUndefined();
  });

  it("空字串欄位不算有值", () => {
    expect(
      summarizeToolArgs(JSON.stringify({ query: "   ", routeName: "307" })),
    ).toBe("307");
  });
});

describe("buildTraceRows", () => {
  it("保留發生順序、狀態，並為重複呼叫的同一工具給出不同的 key", () => {
    const rows = buildTraceRows([
      activity("getBusArrival", "done", JSON.stringify({ routeName: "307" })),
      activity(
        "getBusArrival",
        "running",
        JSON.stringify({ routeName: "藍7" }),
      ),
    ]);

    expect(rows.map((r) => r.id)).toEqual([
      "getBusArrival-0",
      "getBusArrival-1",
    ]);
    expect(rows.map((r) => r.status)).toEqual(["done", "running"]);
    expect(rows[0].label).toBe("查詢公車預估到站時間");
    expect(rows[1].detail).toBe("藍7");
  });

  it("未知工具退回原始名稱而不是空白", () => {
    expect(buildTraceRows([activity("someNewTool", "done")])[0].label).toBe(
      "someNewTool",
    );
  });
});

describe("formatThinkingDuration", () => {
  it.each([
    [0, "不到 1 秒"],
    [999, "不到 1 秒"],
    [1000, "1 秒"],
    [4040, "4 秒"],
    [2440, "2.4 秒"],
    [59_900, "59.9 秒"],
    [60_000, "1 分"],
    [65_000, "1 分 5 秒"],
  ])("%i ms → %s", (ms, expected) => {
    expect(formatThinkingDuration(ms)).toBe(expected);
  });

  it("非法值回空字串，呼叫端就不會印出「· NaN 秒」", () => {
    expect(formatThinkingDuration(Number.NaN)).toBe("");
    expect(formatThinkingDuration(-1)).toBe("");
  });
});

describe("describeThinking", () => {
  it("有工具在跑時顯示該工具的專屬 loading 文字並保持 working", () => {
    expect(
      describeThinking({
        activities: [activity("planAccessibleRoute", "running")],
        isStreaming: true,
        hasContent: false,
      }),
    ).toEqual({ working: true, label: "正在為你規劃無障礙路線…" });
  });

  it("工具都跑完但還沒吐字時，改成整理答覆", () => {
    expect(
      describeThinking({
        activities: [activity("getAirQuality", "done")],
        isStreaming: true,
        hasContent: false,
      }).label,
    ).toBe("正在整理答覆…");
  });

  it("完全沒有工具且還沒吐字時是「思考中…」", () => {
    expect(
      describeThinking({
        activities: [],
        isStreaming: true,
        hasContent: false,
      }),
    ).toEqual({ working: true, label: "思考中…" });
  });

  it("答覆開始串流且沒有工具在跑就落定——不能一邊閃一邊底下已有答案", () => {
    const header = describeThinking({
      activities: [activity("getAirQuality", "done")],
      isStreaming: true,
      hasContent: true,
    });
    expect(header.working).toBe(false);
    expect(header.label).toBe("已完成 1 項查詢");
  });

  it("串流中又有新工具開跑時要重新進入 working，即使已經有文字", () => {
    expect(
      describeThinking({
        activities: [
          activity("getAirQuality", "done"),
          activity("getBusRoute", "running"),
        ],
        isStreaming: true,
        hasContent: true,
      }).working,
    ).toBe(true);
  });

  it("結束後帶上耗時", () => {
    expect(
      describeThinking({
        activities: [
          activity("getBusRoute", "done"),
          activity("webSearch", "done"),
        ],
        isStreaming: false,
        hasContent: true,
        thinkingMs: 4200,
      }).label,
    ).toBe("已完成 2 項查詢 · 4.2 秒");
  });

  it("沒有 thinkingMs（例如重整前存下的舊訊息）就不顯示分隔點", () => {
    expect(
      describeThinking({
        activities: [activity("getBusRoute", "done")],
        isStreaming: false,
        hasContent: true,
      }).label,
    ).toBe("已完成 1 項查詢");
  });

  it("沒用到任何工具的純文字回答", () => {
    expect(
      describeThinking({
        activities: [],
        isStreaming: false,
        hasContent: true,
        thinkingMs: 1500,
      }).label,
    ).toBe("已完成思考 · 1.5 秒");
  });
});

describe("shouldShowTrace", () => {
  it("開場白這種沒有工具、也不在思考的訊息不掛 trace", () => {
    const header = describeThinking({
      activities: [],
      isStreaming: false,
      hasContent: true,
    });
    expect(shouldShowTrace({ activities: [], header })).toBe(false);
  });

  it("思考中即使還沒有任何工具也要顯示", () => {
    const header = describeThinking({
      activities: [],
      isStreaming: true,
      hasContent: false,
    });
    expect(shouldShowTrace({ activities: [], header })).toBe(true);
  });

  it("已結束但有工具紀錄時保留，讓使用者事後還能展開看過程", () => {
    const activities = [activity("webSearch", "done")];
    const header = describeThinking({
      activities,
      isStreaming: false,
      hasContent: true,
      thinkingMs: 2000,
    });
    expect(shouldShowTrace({ activities, header })).toBe(true);
  });
});

describe("English thinking trace", () => {
  it("refreshes stored tool history when the active UI language changes", async () => {
    const activities = [activity("findGooglePlaces", "done")];
    const render = () => ({
      rows: buildTraceRowsTranslated(activities, translations.t),
      header: describeThinkingTranslated({
        activities,
        isStreaming: false,
        hasContent: true,
        thinkingMs: 51700,
        t: translations.t,
      }),
    });
    expect(render().header.label).toBe("已完成 1 項查詢 · 51.7 秒");
    try {
      await translations.changeLanguage("en");
      expect(render().header.label).toBe("Completed 1 query · 51.7 s");
      expect(render().rows[0].label).toBe("Search nearby places");
    } finally {
      await translations.changeLanguage("zh-TW");
    }
    expect(render().rows[0].label).toBe("搜尋周邊地點");
  });

  it("translates the screenshot summary and tool labels while preserving place names", () => {
    const activities = [
      activity("findGooglePlaces", "done", { query: "station" }),
      activity("findGooglePlaces", "done", { query: "metro station" }),
      activity("planAccessibleRoute", "done", {
        origin: "current_location",
        destination: "捷運豐樂公園站",
      }),
    ];
    expect(
      describeThinkingTranslated({
        activities,
        isStreaming: false,
        hasContent: true,
        thinkingMs: 51700,
        t: english,
      }).label,
    ).toBe("Completed 3 queries · 51.7 s");
    const rows = buildTraceRowsTranslated(activities, english);
    expect(rows.map((row) => row.label)).toEqual([
      "Search nearby places",
      "Search nearby places",
      "Plan an accessible route",
    ]);
    expect(rows[2].detail).toBe("Current location → 捷運…");
    expect(buildTraceRowsTranslated(activities, zh)[0].label).toBe(
      "搜尋周邊地點",
    );
  });

  it("uses singular and plural counts and omits absent durations", () => {
    for (const [count, label] of [
      [1, "Completed 1 query"],
      [2, "Completed 2 queries"],
    ] as const) {
      expect(
        describeThinkingTranslated({
          activities: Array.from({ length: count }, () =>
            activity("webSearch", "done"),
          ),
          isStreaming: false,
          hasContent: true,
          t: english,
        }).label,
      ).toBe(label);
    }
    expect(
      describeThinkingTranslated({
        activities: [],
        isStreaming: false,
        hasContent: true,
        thinkingMs: 1500,
        t: english,
      }).label,
    ).toBe("Finished thinking · 1.5 s");
  });

  it("translates thinking, answer preparation, running tools, and unknown tools", () => {
    for (const [activities, expected] of [
      [[], "Thinking…"],
      [[activity("webSearch", "done")], "Preparing your answer…"],
      [
        [activity("planAccessibleRoute", "running")],
        "Planning an accessible route…",
      ],
      [[activity("someNewTool", "running")], "Running someNewTool…"],
    ] as [ToolActivity[], string][]) {
      expect(
        describeThinkingTranslated({
          activities,
          isStreaming: true,
          hasContent: false,
          t: english,
        }).label,
      ).toBe(expected);
    }
    expect(
      buildTraceRowsTranslated([activity("someNewTool", "done")], english)[0]
        .label,
    ).toBe("someNewTool");
  });

  it.each([
    [999, "Less than 1 second"],
    [1000, "1 s"],
    [60000, "1 min"],
    [65000, "1 min 5 s"],
  ])("translates %i ms as %s", (ms, expected) => {
    expect(formatThinkingDurationTranslated(ms as number, english)).toBe(
      expected,
    );
  });

  it("has English labels and loading text for every supported tool", () => {
    expect(Object.keys(en.chatbot.trace.tools).sort()).toEqual(
      Object.keys(zhTW.chatbot.trace.tools).sort(),
    );
    for (const name of Object.keys(zhTW.chatbot.trace.tools)) {
      expect(
        buildTraceRowsTranslated([activity(name, "done")], english)[0].label,
      ).not.toMatch(/[\u3400-\u9fff]/);
      expect(
        describeThinkingTranslated({
          activities: [activity(name, "running")],
          isStreaming: true,
          hasContent: false,
          t: english,
        }).label,
      ).not.toMatch(/[\u3400-\u9fff]/);
    }
  });
});
