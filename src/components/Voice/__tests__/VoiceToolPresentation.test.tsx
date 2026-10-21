import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ToolResultsBox from "@/components/ai/ToolResultsBox";
import VoiceModeView from "../VoiceModeView";
import VoiceToolResults from "../VoiceToolResults";

const actions = vi.hoisted(() => ({ openAiResult: vi.fn(), flyTo: vi.fn() }));

import useVoiceStore from "@/stores/useVoiceStore";

vi.mock("@/i18n/client", () => ({
  useAppTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "zh-TW", resolvedLanguage: "zh-TW" },
  }),
}));
vi.mock("@/stores/useVoiceStore", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/stores/useVoiceStore")>();
  const store = actual.default;
  return {
    default: Object.assign(
      (selector: (state: ReturnType<typeof store.getState>) => unknown) =>
        selector(store.getState()),
      { setState: store.setState, getState: store.getState },
    ),
  };
});
vi.mock("thinking-orbs", () => ({ ThinkingOrb: () => null }));
vi.mock("@/hook/useReducedMotion", () => ({ default: () => true }));
vi.mock("@animateicons/react/lucide", () => ({
  XIcon: () => null,
  AccessibilityIcon: () => null,
  SearchIcon: () => null,
  TriangleAlertIcon: () => null,
}));
vi.mock("@/hook/useOpenAiResult", () => ({ default: () => actions }));
const event = (name: string, result: unknown) => ({
  type: "result" as const,
  name,
  result,
  args: { query: "三民校區" },
  summary: "摘要",
});
const coverage = {
  cards: [
    "findGooglePlaces",
    "findA11yPlaces",
    "findCampusAccessibility",
    "getCampusAccessibilityDetails",
    "getBusRoute",
    "getBusRouteDetail",
    "getBusTimetable",
    "trackBuses",
    "findNearbyBusStops",
    "getAirQuality",
    "getA11yFacilityDetails",
    "getEnvironmentInfo",
    "getNearbyHazards",
    "findNearbyParking",
    "getNavInstructions",
  ],
  semanticResults: [
    "planAccessibleRoute",
    "getBusArrival",
    "getTrainTimetable",
    "getStationTimetable",
    "getMetroAlerts",
    "getTransitAlerts",
    "searchAccessibilityGuide",
    "webSearch",
  ],
  controls: [
    "startNavigation",
    "stopNavigation",
    "repeatNavStep",
    "getActiveNavigationContext",
    "confirmNavigationCandidateSwitch",
    "saveMemory",
    "deleteMemory",
  ],
  proposals: ["proposeNavigationCandidate"],
  internalOnly: ["endVoiceSession"],
};
const render = () => renderToStaticMarkup(createElement(VoiceModeView));
beforeEach(() =>
  useVoiceStore.setState({
    transcripts: [],
    toolActivities: [],
    activeTool: null,
  }),
);
describe("voice view result presentation", () => {
  it("shows a successful real-shaped plan on the map despite empty alert and accessibility metadata", () => {
    const result = {
      ok: true,
      origin: "目前位置",
      destination: "三民校區",
      routeContractVersion: 1,
      planId: "isolated-plan",
      selectedRouteId: "isolated-route-0",
      mode: "transit",
      metroAlerts: [],
      transitAlerts: [],
      routes: Array.from({ length: 3 }, (_, index) => ({
        routeId: `isolated-route-${index}`,
        routeName: `校園交通方案 ${index + 1}`,
        totalMinutes: 12 + index,
        transferCount: 0,
        legs: [{ legType: "WALK" }],
        accessibilityHighlights: [],
        scoreWarnings: [],
        accessibilityHighlightDetails: [],
      })),
    };
    useVoiceStore.setState({
      toolActivities: [
        {
          id: "plan",
          state: "done",
          event: event("planAccessibleRoute", result),
        },
      ],
    });
    const html = render();
    expect(html).toContain("路線已顯示在地圖上");
    for (const text of [
      "無資料",
      "metroAlerts",
      "planAccessibleRoute",
      "isolated-plan",
    ])
      expect(html).not.toContain(text);
    expect(useVoiceStore.getState().toolActivities[0].event.result).toBe(
      result,
    );
  });
  it("uses routes alone to identify an empty plan, not arbitrary empty metadata", () => {
    useVoiceStore.setState({
      toolActivities: [
        {
          id: "plan",
          state: "done",
          event: event("planAccessibleRoute", {
            ok: true,
            routes: [],
            metroAlerts: [{ title: "測試公告" }],
          }),
        },
      ],
    });
    expect(render()).toContain("無資料");
    useVoiceStore.setState({
      toolActivities: [
        {
          id: "unknown",
          state: "done",
          event: event("futureLookup", {
            ok: true,
            items: [{ title: "有效結果" }],
            warnings: [],
          }),
        },
      ],
    });
    expect(render()).toContain("查詢完成");
    expect(render()).not.toContain("無資料");
  });
  it.each([
    "startNavigation",
    "stopNavigation",
    "repeatNavStep",
    "saveMemory",
    "deleteMemory",
  ])(
    "keeps successful %s controls quiet without swallowing failures",
    (name) => {
      useVoiceStore.setState({
        toolActivities: [
          { id: name, state: "done", event: event(name, { ok: true }) },
        ],
      });
      expect(render()).not.toContain("查詢完成");
      useVoiceStore.setState({
        toolActivities: [
          {
            id: name,
            state: "failed",
            event: event(name, { ok: false, error: "暫時無法完成操作" }),
          },
        ],
      });
      expect(render()).toContain("暫時無法完成操作");
    },
  );
  it("animates pending feedback only when the user allows motion", () => {
    useVoiceStore.setState({
      toolActivities: [
        {
          id: "pending",
          state: "pending",
          event: { type: "call", name: "planAccessibleRoute" },
        },
      ],
    });
    expect(render()).toContain("motion-safe:animate-pulse");
    expect(render()).not.toContain("foreground animate-pulse");
  });
  it("keeps cancellation truthful and technical payloads out of the voice UI", () => {
    useVoiceStore.setState({
      toolActivities: [
        {
          id: "stale",
          state: "done",
          event: {
            ...event("planAccessibleRoute", {
              ok: false,
              reason: "STALE_SELECTION",
              error: "缺少位置資訊",
            }),
            summary: '{"ok":false,"reason":"STALE_SELECTION"}',
          },
        },
      ],
    });
    const html = render();
    expect(html).toContain("已取消");
    for (const text of [
      "STALE_SELECTION",
      "缺少位置",
      "planAccessibleRoute",
      "<details",
      "查詢條件",
      "三民校區",
    ])
      expect(html).not.toContain(text);
  });
  it("uses exactly the text result cards without opening the map during render", () => {
    const result = {
      ok: true,
      campuses: [
        {
          campusId: 62,
          schoolName: "臺中科技大學",
          branchName: "三民校區",
          location: { type: "Point", coordinates: [120.683, 24.15] },
        },
      ],
    };
    actions.flyTo.mockClear();
    actions.openAiResult.mockClear();
    const shared = renderToStaticMarkup(
      createElement(ToolResultsBox, {
        activities: [
          { name: "findCampusAccessibility", result, status: "done" },
        ],
      }),
    );
    const voice = renderToStaticMarkup(
      createElement(VoiceToolResults, {
        activities: [
          {
            id: "campus",
            state: "done",
            event: event("findCampusAccessibility", result),
          },
        ],
      }),
    );
    expect(shared).toContain("三民校區");
    expect(voice).toContain(shared);
    expect(actions.flyTo).not.toHaveBeenCalled();
    expect(actions.openAiResult).not.toHaveBeenCalled();
  });
  it("classifies all 32 tools without duplicate names", () => {
    const names = Object.values(coverage).flat();
    expect(names).toHaveLength(32);
    expect(new Set(names).size).toBe(32);
  });
  it.each(
    Object.entries(coverage)
      .filter(([category]) => category !== "internalOnly")
      .flatMap(([, names]) => names),
  )(
    "%s keeps full payload in storage without dumping technical fields",
    (name) => {
      const result = {
        ok: true,
        metadata: { page: 2, totalPages: 9, truncated: true },
        nested: Array.from({ length: 35 }, (_, i) => ({
          tags: { description: `完整內容-${i}` },
          sources: ["https://example.com/source"],
        })),
      };
      useVoiceStore.setState({
        toolActivities: [
          { id: name, state: "done", event: event(name, result) },
        ],
      });
      const html = render();
      for (const technical of [
        name,
        "完整內容-34",
        "totalPages",
        "truncated",
        "<details",
        "<dl",
      ])
        expect(html).not.toContain(technical);
      expect(useVoiceStore.getState().toolActivities[0].event.result).toBe(
        result,
      );
    },
  );
  it.each(["pending", "done", "failed", "cancelled"] as const)(
    "hides internal end-session tools in the %s state without hiding real query errors",
    (state) => {
      const rejection = "使用者沒有明確要求結束語音，請繼續對話，不要道別。";
      useVoiceStore.setState({
        transcripts: [
          {
            id: 1,
            role: "user",
            text: "Bye-bye.",
            raw: "Bye-bye.",
            sealed: true,
          },
          { id: 2, role: "model", text: "再見！", raw: "再見！", sealed: true },
        ],
        toolActivities: [
          {
            id: "end",
            state,
            event: {
              ...event("endVoiceSession", {
                ok: false,
                reason: "EXPLICIT_END_REQUIRED",
                message: rejection,
              }),
              summary: JSON.stringify({
                reason: "EXPLICIT_END_REQUIRED",
                message: rejection,
              }),
            },
          },
          {
            id: "search",
            state: "failed",
            event: event("webSearch", { ok: false, error: "來源暫時不可用" }),
          },
        ],
      });
      const html = render();
      expect(html).not.toContain("endVoiceSession");
      expect(html).not.toContain("EXPLICIT_END_REQUIRED");
      expect(html).not.toContain(rejection);
      expect(html).toContain("Bye-bye.");
      expect(html).toContain("再見！");
      expect(html).toContain("來源暫時不可用");
    },
  );
  it("renders human loading, cancellation, failure and semantic answers with safe sources", () => {
    useVoiceStore.setState({
      toolActivities: [
        {
          id: "1",
          state: "pending",
          event: { type: "call", name: "getBusArrival" },
        },
        {
          id: "2",
          state: "cancelled",
          event: { type: "call", name: "getBusArrival" },
        },
        {
          id: "3",
          state: "done",
          event: event("webSearch", { ok: false, error: "來源暫時不可用" }),
        },
        {
          id: "4",
          state: "done",
          event: event("webSearch", {
            answer: "完整指南",
            sources: [
              { url: "https://example.com/guide", title: "交通指南" },
              { url: "javascript:alert(1)" },
            ],
            metadata: { truncated: true, pages: [1, 2] },
          }),
        },
      ],
    });
    const html = render();
    for (const text of [
      "查詢中",
      "已取消",
      "查詢失敗",
      "來源暫時不可用",
      "完整指南",
      "交通指南",
      "https://example.com/guide",
    ])
      expect(html).toContain(text);
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain("<details");
    expect(html).not.toContain("<dl");
    expect(html).not.toContain("truncated");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('rel="noopener noreferrer"');
  });
  it("renders guide titles, content and sources rather than DTO field labels", () => {
    useVoiceStore.setState({
      toolActivities: [
        {
          id: "guide",
          state: "done",
          event: event("searchAccessibilityGuide", {
            ok: true,
            results: [
              {
                title: "輪椅搭車指引",
                content: "請先向司機示意。",
                source: "https://example.org/guide",
                category: "internal-category",
              },
            ],
          }),
        },
      ],
    });
    const html = render();
    for (const text of [
      "輪椅搭車指引",
      "請先向司機示意。",
      'href="https://example.org/guide"',
    ])
      expect(html).toContain(text);
    for (const text of [
      "category",
      "internal-category",
      "<dl",
      "searchAccessibilityGuide",
    ])
      expect(html).not.toContain(text);
  });
  it.each(["pending", "done", "failed", "cancelled"] as const)(
    "hides internal context controls in %s state",
    (state) => {
      useVoiceStore.setState({
        toolActivities: [
          {
            id: "context",
            state,
            event: event("getActiveNavigationContext", {
              message: "internal-context-token",
            }),
          },
        ],
      });
      expect(render()).not.toContain("internal-context-token");
      expect(render()).not.toContain("getActiveNavigationContext");
    },
  );
  it("never calls a proposed or reconciling route committed", () => {
    const show = (result: unknown) => {
      useVoiceStore.setState({
        toolActivities: [
          {
            id: "confirm",
            state: "done",
            event: event("confirmNavigationCandidateSwitch", result),
          },
        ],
      });
      return render();
    };
    expect(show({ ok: true, status: "adopted" })).toContain("已切換路線");
    expect(show({ ok: true })).not.toContain("已切換路線");
    expect(
      show({
        ok: false,
        status: "reconciling",
        message: "導航狀態確認中，尚未切換。",
      }),
    ).not.toContain("已切換路線");
    expect(
      show({ ok: false, reason: "PROPOSAL_NOT_AUTHORIZED" }),
    ).not.toContain("PROPOSAL_NOT_AUTHORIZED");
  });
  it("distinguishes proposal from a committed switch and exposes empty results", () => {
    useVoiceStore.setState({
      toolActivities: [
        {
          id: "1",
          state: "done",
          event: event("proposeNavigationCandidate", { candidates: [] }),
        },
      ],
    });
    expect(render()).toContain("尚未切換");
    useVoiceStore.setState({
      toolActivities: [
        {
          id: "empty",
          state: "done",
          event: event("webSearch", { answer: "", sources: [] }),
        },
      ],
    });
    expect(render()).toContain("無資料");
  });
});
