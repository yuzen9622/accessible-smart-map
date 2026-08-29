import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `useAppTranslation` reads the pathname even during static rendering.
vi.mock("next/navigation", () => ({
  usePathname: () => "/zh-TW",
  redirect: () => {},
}));
vi.mock("@/stores/useAuthStore", () => ({
  default: vi.fn(),
}));

import { WalkStepsList } from "@/components/shared/RouteCard/WalkStepsList";
import i18n from "@/i18n/client";
import useAuthStore from "@/stores/useAuthStore";
import type { WalkRelativeDirection, WalkStep } from "@/types/route";

const mockUseAuthStore = vi.mocked(useAuthStore);

type Locale = "en" | "zh-TW";

const WALK_RELATIVE_DIRECTIONS = [
  "DEPART",
  "CONTINUE",
  "STRAIGHT",
  "LEFT",
  "RIGHT",
  "SLIGHTLY_LEFT",
  "SLIGHTLY_RIGHT",
  "HARD_LEFT",
  "HARD_RIGHT",
  "UTURN_LEFT",
  "UTURN_RIGHT",
  "CIRCLE_CLOCKWISE",
  "CIRCLE_COUNTERCLOCKWISE",
  "ELEVATOR",
  "ESCALATOR",
  "MOVING_WALKWAY",
  "FARE_GATE",
  "ENTER_STATION",
  "EXIT_STATION",
] as const satisfies readonly WalkRelativeDirection[];

const EXPECTED_ACTIONS = {
  en: {
    DEPART: "Depart",
    CONTINUE: "Continue straight",
    STRAIGHT: "Go straight",
    LEFT: "Turn left",
    RIGHT: "Turn right",
    SLIGHTLY_LEFT: "Bear left",
    SLIGHTLY_RIGHT: "Bear right",
    HARD_LEFT: "Sharp left",
    HARD_RIGHT: "Sharp right",
    UTURN_LEFT: "Make a U-turn to the left",
    UTURN_RIGHT: "Make a U-turn to the right",
    CIRCLE_CLOCKWISE: "Enter the roundabout clockwise",
    CIRCLE_COUNTERCLOCKWISE: "Enter the roundabout counterclockwise",
    ELEVATOR: "Take the elevator",
    ESCALATOR: "Take the escalator",
    MOVING_WALKWAY: "Use the moving walkway",
    FARE_GATE: "Pass the fare gate",
    ENTER_STATION: "Enter the station",
    EXIT_STATION: "Leave the station",
  },
  "zh-TW": {
    DEPART: "出發",
    CONTINUE: "直行",
    STRAIGHT: "直行",
    LEFT: "左轉",
    RIGHT: "右轉",
    SLIGHTLY_LEFT: "稍向左",
    SLIGHTLY_RIGHT: "稍向右",
    HARD_LEFT: "大幅左轉",
    HARD_RIGHT: "大幅右轉",
    UTURN_LEFT: "向左迴轉",
    UTURN_RIGHT: "向右迴轉",
    CIRCLE_CLOCKWISE: "進入圓環並順時針行駛",
    CIRCLE_COUNTERCLOCKWISE: "進入圓環並逆時針行駛",
    ELEVATOR: "搭乘電梯",
    ESCALATOR: "搭乘電扶梯",
    MOVING_WALKWAY: "使用電動步道",
    FARE_GATE: "通過付費閘門",
    ENTER_STATION: "進入車站",
    EXIT_STATION: "離開車站",
  },
} satisfies Record<Locale, Record<WalkRelativeDirection, string>>;

function makeStep(
  relativeDirection: WalkRelativeDirection,
  overrides: Partial<WalkStep> = {},
): WalkStep {
  return {
    relativeDirection,
    absoluteDirection: null,
    streetName: "",
    bogusName: true,
    area: false,
    stairs: false,
    steepSlope: false,
    distanceM: 42,
    location: [121.5, 25.03],
    ...overrides,
  };
}

async function renderSteps(locale: Locale, steps: WalkStep[]) {
  mockUseAuthStore.mockReturnValue({
    userConfig: { language: locale },
    updateUserConfig: vi.fn(),
  } as never);
  await i18n.changeLanguage(locale);
  return renderToStaticMarkup(React.createElement(WalkStepsList, { steps }));
}

function getListItem(html: string, streetName: string) {
  return html
    .match(/<li[^>]*>[\s\S]*?<\/li>/g)
    ?.find((item) => item.includes(streetName));
}

beforeEach(() => {
  mockUseAuthStore.mockReset();
});

afterEach(async () => {
  await i18n.changeLanguage("zh-TW");
});

describe("WalkStepsList", () => {
  it("keeps each WALK step to the exact nine-field contract", () => {
    const step = makeStep("DEPART");

    expect(Object.keys(step)).toEqual([
      "relativeDirection",
      "absoluteDirection",
      "streetName",
      "bogusName",
      "area",
      "stairs",
      "steepSlope",
      "distanceM",
      "location",
    ]);
    for (const field of ["instruction", "maneuver", "text", "type"]) {
      expect(field in step).toBe(false);
    }
  });

  it.each(["en", "zh-TW"] as const)(
    "translates each of all 19 relative-direction tokens in %s without rendering raw tokens",
    async (locale) => {
      for (const direction of WALK_RELATIVE_DIRECTIONS) {
        const html = await renderSteps(locale, [makeStep(direction)]);
        const listItems = html.match(/<li[^>]*>[\s\S]*?<\/li>/g) ?? [];

        expect(listItems).toHaveLength(1);
        expect(listItems[0]).toContain(EXPECTED_ACTIONS[locale][direction]);
        expect(listItems[0]).not.toContain(direction);
      }
    },
  );

  it("renders STRAIGHT and MOVING_WALKWAY from their machine tokens", async () => {
    const html = await renderSteps("en", [
      makeStep("STRAIGHT", {
        streetName: "Main Street",
        bogusName: false,
      }),
      makeStep("MOVING_WALKWAY", {
        streetName: "Terminal Concourse",
        bogusName: false,
      }),
    ]);

    expect(html).toContain("Go straight on Main Street");
    expect(html).toContain("Use the moving walkway");
    expect(html).not.toContain("Terminal Concourse");
  });

  it("omits bogus and empty street names", async () => {
    const html = await renderSteps("en", [
      makeStep("CONTINUE", {
        streetName: "Unnamed road",
        bogusName: true,
      }),
      makeStep("LEFT", {
        streetName: "",
        bogusName: false,
      }),
    ]);

    expect(html).toContain("Continue straight");
    expect(html).toContain("Turn left");
    expect(html).not.toContain("Unnamed road");
  });

  it.each([
    ["en", "Stairs", "Steep slope"],
    ["zh-TW", "樓梯", "陡坡"],
  ] as const)(
    "shows separate visible, readable stair and slope warnings in %s",
    async (locale, stairsLabel, slopeLabel) => {
      const html = await renderSteps(locale, [
        makeStep("RIGHT", {
          streetName: "Stairs-only street",
          bogusName: false,
          stairs: true,
        }),
        makeStep("RIGHT", {
          streetName: "Slope-only street",
          bogusName: false,
          steepSlope: true,
        }),
        makeStep("RIGHT", {
          streetName: "Combined warning street",
          bogusName: false,
          stairs: true,
          steepSlope: true,
        }),
      ]);
      const stairsItem = getListItem(html, "Stairs-only street");
      const slopeItem = getListItem(html, "Slope-only street");
      const combinedItem = getListItem(html, "Combined warning street");

      expect(stairsItem).toContain(stairsLabel);
      expect(stairsItem).not.toContain(slopeLabel);
      expect(slopeItem).not.toContain(stairsLabel);
      expect(slopeItem).toContain(slopeLabel);
      expect(combinedItem).toContain(stairsLabel);
      expect(combinedItem).toContain(slopeLabel);
    },
  );

  it("translates an English absolute direction, suppresses null, and accepts area steps", async () => {
    const html = await renderSteps("en", [
      makeStep("DEPART", {
        absoluteDirection: "NORTH",
        streetName: "North Road",
        bogusName: false,
      }),
      makeStep("RIGHT", {
        streetName: "Town Square",
        bogusName: false,
        area: true,
      }),
    ]);

    expect(html).toContain("Depart on North Road · North");
    expect(html).toContain("Turn right onto Town Square");
    expect(html).not.toContain("null");
    expect(html).not.toContain("NORTH");
  });
});
