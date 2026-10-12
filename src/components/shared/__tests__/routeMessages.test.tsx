import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AccessibleRoute, RouteMessageDetail } from "@/types/route";
import { pairRouteMessages } from "../RouteCard/routeMessages";

// Open the real card's disclosure for static markup assertions, without
// pretending this tests browser interaction or layout.
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useState: () => [true, () => {}],
}));
vi.mock("@/i18n/client", () => ({
  useAppTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/stores/useMapStore", () => ({
  default: () => ({
    selectRoute: { index: 0 },
    setRouteSelect: () => {},
    map: null,
  }),
}));

import { RouteCard } from "../RouteCard/RouteCard";

const detail = (
  index: number,
  code: string,
  message: string,
): RouteMessageDetail => ({ index, code, message });

describe("route message pairing", () => {
  it("uses codes, not the language of the string", () => {
    for (const text of [
      "First bus is high-floor; take the next bus.",
      "首班高底盤，請留意",
    ])
      expect(
        pairRouteMessages(
          [text],
          [detail(0, "ROUTE_HIGH_FLOOR_ALTERNATIVE", text)],
        )[0].tone,
      ).toBe("caution");
    expect(
      pairRouteMessages(
        ["Bus"],
        [detail(0, "ROUTE_LOW_FLOOR_DIRECT", "Bus")],
      )[0].tone,
    ).toBe("positive");
  });
  it("pairs by original index even when details are sparse and out of order", () => {
    const paired = pairRouteMessages(
      ["positive", "source notice", "caution"],
      [
        detail(2, "ROUTE_WALK_CONNECTOR_UNAVAILABLE", "caution"),
        detail(0, "ROUTE_LOW_FLOOR_ALL", "positive"),
      ],
    );
    expect(paired.map((p) => p.tone)).toEqual([
      "positive",
      "neutral",
      "caution",
    ]);
    // A caller may sort the paired objects; their classification stays attached.
    expect([...paired].reverse()[0]).toEqual({
      index: 2,
      text: "caution",
      tone: "caution",
    });
  });
  it.each([
    undefined,
    [],
    [detail(1, "ROUTE_LOW_FLOOR_DIRECT", "raw")],
    [detail(0, "ROUTE_LOW_FLOOR_DIRECT", "different message")],
    [detail(0, "FUTURE_POSITIVE_CODE", "raw")],
    [
      detail(0, "ROUTE_LOW_FLOOR_DIRECT", "raw"),
      detail(0, "ROUTE_LOW_FLOOR_DIRECT", "raw"),
    ],
    [detail(-1, "ROUTE_LOW_FLOOR_DIRECT", "raw")],
    [detail(0.5, "ROUTE_LOW_FLOOR_DIRECT", "raw")],
  ])(
    "keeps raw text neutral for missing, ambiguous or invalid metadata %#",
    (details) => {
      expect(pairRouteMessages(["raw"], details)).toEqual([
        { index: 0, text: "raw", tone: "neutral" },
      ]);
    },
  );
  it("preserves duplicate raw strings as separate indexed entries", () => {
    expect(
      pairRouteMessages(
        ["raw", "raw"],
        [detail(1, "ROUTE_DATA_SPARSE", "raw")],
      ),
    ).toEqual([
      { index: 0, text: "raw", tone: "neutral" },
      { index: 1, text: "raw", tone: "caution" },
    ]);
  });
});

function render(overrides: Partial<AccessibleRoute>) {
  const route: AccessibleRoute = {
    routeId: "r1",
    routeToken: "token",
    routeName: "Route",
    totalMinutes: 10,
    transferCount: 0,
    legs: [],
    accessibilityHighlights: [],
    ...overrides,
  };
  return renderToStaticMarkup(<RouteCard route={route} idx={0} />);
}

function highlightMarkup(html: string, text: string) {
  return (
    [
      ...html.matchAll(
        /<span class="[^"]*">(?:(?!<span|<\/span>)[\s\S])*?<\/span>/g,
      ),
    ]
      .map((match) => match[0])
      .find((span) => span.endsWith(`>${text}</span>`)) ?? ""
  );
}

describe("RouteCard real markup", () => {
  it("renders English caution amber, confirmed positive green, unknown and legacy neutral", () => {
    const highlights = [
      "First bus is high-floor",
      "Low-floor bus",
      "Future warning",
      "請留意舊資料",
    ];
    const html = render({
      accessibilityHighlights: highlights,
      accessibilityHighlightDetails: [
        detail(0, "ROUTE_HIGH_FLOOR_NO_ALTERNATIVE", highlights[0]),
        detail(1, "ROUTE_LOW_FLOOR_DIRECT", highlights[1]),
        detail(2, "FUTURE_CODE", highlights[2]),
      ],
    });
    expect(highlightMarkup(html, highlights[0])).toContain("text-amber-700");
    expect(highlightMarkup(html, highlights[0])).not.toContain("emerald");
    expect(highlightMarkup(html, highlights[1])).toContain("text-emerald-700");
    for (const raw of highlights.slice(2)) {
      expect(highlightMarkup(html, raw)).toContain("text-muted-foreground");
      expect(highlightMarkup(html, raw)).not.toContain("emerald");
    }
  });
  it("renders every raw warning and score warning, including source notices without details", () => {
    const html = render({
      warnings: ["External notice", "System warning", "Legacy notice"],
      warningDetails: [detail(1, "ROUTE_HAZARD_ON_ROUTE", "System warning")],
      scoreWarnings: ["Score source", "Sparse data"],
      scoreWarningDetails: [detail(1, "ROUTE_DATA_SPARSE", "Sparse data")],
    });
    for (const raw of [
      "External notice",
      "System warning",
      "Legacy notice",
      "Score source",
      "Sparse data",
    ])
      expect(html).toContain(`<span>${raw}</span>`);
  });
  it("does not turn a mismatched or duplicate index into a green success badge", () => {
    const html = render({
      accessibilityHighlights: ["Wrong message", "Ambiguous"],
      accessibilityHighlightDetails: [
        detail(0, "ROUTE_LOW_FLOOR_DIRECT", "Different"),
        detail(1, "ROUTE_LOW_FLOOR_DIRECT", "Ambiguous"),
        detail(1, "ROUTE_LOW_FLOOR_DIRECT", "Ambiguous"),
      ],
    });
    for (const raw of ["Wrong message", "Ambiguous"]) {
      expect(highlightMarkup(html, raw)).toContain("text-muted-foreground");
      expect(highlightMarkup(html, raw)).not.toContain("emerald");
    }
  });
});
