import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/zh-TW",
  redirect: () => {},
}));
vi.mock("@/stores/useAuthStore", () => ({ default: vi.fn() }));

import i18n from "@/i18n/client";
import type { VenueJourney } from "@/lib/indoor/journey";
import type { IndoorRouteStep } from "@/lib/indoor/types";
import useAuthStore from "@/stores/useAuthStore";
import type { VenuePlaceDetail } from "@/types";
import type { AccessibleRoute } from "@/types/route";
import {
  VenueWalkSteps,
  VenueWalkSummary,
} from "../RouteCard/VenueWalkContinuation";
import { WalkStepsList } from "../RouteCard/WalkStepsList";

const room: VenuePlaceDetail = {
  kind: "venue-place",
  name: "教室甲",
  address: "測試館 3F",
  venueId: "synthetic-venue",
  buildingId: "synthetic-building",
  buildingName: "測試館",
  levelRef: "3F",
  placeId: "synthetic-room",
  sourceVersion: "synthetic-source-version",
  dataSource: "local",
  arrivalKind: "corridor",
  position: { lat: 10, lng: 10 },
};

function routeStep(
  kind: IndoorRouteStep["kind"],
  name: string,
  fromLevel: string | null,
  toLevel: string | null,
  startIndex: number,
): IndoorRouteStep {
  return {
    kind,
    name,
    fromLevel,
    toLevel,
    startIndex,
    endIndex: startIndex + 1,
    distanceM: 10,
    heightPending: kind === "ramp",
    connectionId: `synthetic-connection-${startIndex}`,
  };
}

const gate: VenuePlaceDetail = {
  ...room,
  name: "試驗校門",
  placeId: "synthetic-gate",
  buildingId: null,
  levelRef: null,
  arrivalKind: "place",
};
const primary: AccessibleRoute = {
  routeId: "synthetic-primary",
  routeName: "Source route",
  routeToken: "synthetic-primary-token",
  totalMinutes: 5,
  transferCount: 0,
  accessibilityHighlights: [],
  legs: [],
};
const approach: AccessibleRoute = {
  ...primary,
  routeId: "synthetic-approach",
  routeToken: "synthetic-approach-token",
  legs: [
    {
      type: "WALK",
      from: "Source path start",
      to: "Source gate",
      distanceM: 7,
      minutesEst: 1,
      a11yFacilities: [],
      polyline: [
        [10, 10],
        [10.0001, 10],
      ],
      steps: [
        {
          relativeDirection: "LEFT",
          absoluteDirection: null,
          streetName: "合成路",
          bogusName: false,
          area: false,
          stairs: false,
          steepSlope: false,
          distanceM: 7,
          location: [10, 10],
        },
      ],
    },
  ],
};
const journey: VenueJourney = {
  id: "synthetic-journey",
  venueId: room.venueId,
  buildingId: room.buildingId as string,
  sourceVersion: room.sourceVersion,
  from: gate,
  to: room,
  mode: "normal",
  verticalPreference: "auto",
  preview: { progress: 0.3, playing: false, direction: -1 },
  guidance: { status: "outdoor", stepIndex: 0 },
  outdoor: {
    origin: {
      kind: "coordinate",
      address: "Source origin",
      position: { lat: 10, lng: 10 },
    },
    routes: [primary],
    selectedIndex: 0,
    navigationIndex: 0,
    arrival: gate,
    approachRoutes: { "synthetic-primary-token": approach },
    phase: "travel",
  },
  route: {
    ok: true,
    fromPlaceId: gate.placeId,
    toPlaceId: room.placeId,
    points: [
      [0, 0, 0],
      [10, 0, 0],
      [20, 0, 0.5],
      [30, 0, 4.1],
      [20, 0, 0.5],
      [20, 10, 7.7],
      [30, 10, 7.7],
    ],
    kinds: ["footway", "ramp", "steps", "steps", "elevator", "corridor"],
    steps: [
      routeStep("footway", "公共通路", null, null, 0),
      routeStep("ramp", "範例坡道 R", null, "1F", 1),
      routeStep("steps", "樓梯甲", "1F", "2F", 2),
      routeStep("steps", "樓梯甲", "2F", "1F", 3),
      routeStep("elevator", "電梯甲", "1F", "3F", 4),
      routeStep("corridor", "沿公共走廊行進", "3F", "3F", 5),
    ],
    distanceM: 60,
    animationSafe: false,
    warnings: ["synthetic height pending"],
    edgeIds: [
      "source-path",
      "source-ramp",
      "source-up",
      "source-down",
      "source-lift",
      "source-corridor",
    ],
  },
};

function freezeSource(value: object) {
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") freezeSource(child);
  }
  Object.freeze(value);
}
freezeSource(journey);

async function renderContinuation(language: "en" | "zh-TW") {
  vi.mocked(useAuthStore).mockReturnValue({
    userConfig: { language },
    updateUserConfig: vi.fn(),
  } as never);
  await i18n.changeLanguage(language);
  return renderToStaticMarkup(
    <section>
      <VenueWalkSummary journey={journey} approach={approach} />
      <WalkStepsList
        continuation={<VenueWalkSteps journey={journey} approach={approach} />}
      />
    </section>,
  );
}

afterEach(async () => {
  await i18n.changeLanguage("zh-TW");
  vi.mocked(useAuthStore).mockReset();
});

describe("venue walking continuation with the real language dictionaries", () => {
  it.each([
    [
      "zh-TW",
      [
        "查看步行細節",
        "校內約",
        "校門前步行",
        "抵達 試驗校門",
        "公共通路",
        "沿範例坡道 R通行",
        "進入 測試館 · 1F",
        "上樓至 2F · 樓梯甲",
        "下樓至 1F · 樓梯甲",
        "搭乘 電梯甲 至 3F",
        "3F · 公共走廊",
        "抵達 教室甲 前的走道",
      ],
    ],
    [
      "en",
      [
        "View walking steps",
        "On campus about",
        "Walk to gate",
        "Arrive at 試驗校門",
        "Public passage",
        "Follow 範例坡道 R",
        "Enter 測試館 · 1F",
        "Go up to 2F · 樓梯甲",
        "Go down to 1F · 樓梯甲",
        "Take 電梯甲 to 3F",
        "3F · Public corridor",
        "Arrive at the corridor outside 教室甲",
      ],
    ],
  ] as const)(
    "renders the full entrance, up/down, lift and corridor sequence in %s",
    async (language, expected) => {
      const html = await renderContinuation(language);
      for (const text of expected) expect(html).toContain(text);
      expect(html).not.toMatch(
        /venue(?:Step|Generic|Enter|Arrive|Walk|Approach)[A-Z]\w*|viewWalkSteps|{{[^}]+}}/,
      );
      for (const name of [
        "試驗校門",
        "測試館",
        "範例坡道 R",
        "樓梯甲",
        "電梯甲",
        "教室甲",
        "合成路",
      ]) {
        expect(html).toContain(name);
      }
      if (language === "en") {
        expect(html).toContain("Turn left onto 合成路");
        expect(html).not.toMatch(
          /沿公共走廊行進|公共通路|上樓至|下樓至|搭乘 |抵達 |進入 /,
        );
      }
    },
  );

  it("rerenders the same immutable journey zh→en→zh without changing source geometry, owners or either token", async () => {
    const source = JSON.stringify(journey);
    const route = journey.route;
    const chinese = await renderContinuation("zh-TW");
    const english = await renderContinuation("en");
    const chineseAgain = await renderContinuation("zh-TW");
    expect(english).not.toBe(chinese);
    expect(chineseAgain).toBe(chinese);
    expect(JSON.stringify(journey)).toBe(source);
    expect(journey.route).toBe(route);
    expect(journey.outdoor?.routes[0]).toBe(primary);
    expect(journey.outdoor?.approachRoutes?.["synthetic-primary-token"]).toBe(
      approach,
    );
    expect(primary.routeToken).toBe("synthetic-primary-token");
    expect(approach.routeToken).toBe("synthetic-approach-token");
    expect(journey.guidance).toEqual({ status: "outdoor", stepIndex: 0 });
    expect(journey.preview).toEqual({
      progress: 0.3,
      playing: false,
      direction: -1,
    });
  });
});
