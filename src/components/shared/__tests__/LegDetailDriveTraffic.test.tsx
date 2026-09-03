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

import { LegDetail } from "@/components/shared/RouteCard/LegDetail";
import type { PointLabelContext } from "@/components/shared/RouteCard/utils";
import i18n from "@/i18n/client";
import useAuthStore from "@/stores/useAuthStore";
import type { DriveLeg, TrafficLevel } from "@/types/route";

const mockUseAuthStore = vi.mocked(useAuthStore);

type Locale = "en" | "zh-TW";

const pointCtx: PointLabelContext = {
  originFallback: "起點",
  destinationFallback: "終點",
  myLocationFallback: "我的位置",
};

function makeDriveLeg(overrides: Partial<DriveLeg> = {}): DriveLeg {
  return {
    type: "DRIVE",
    from: "台北車站",
    to: "松山機場",
    distanceM: 8200,
    durationMin: 20,
    durationInTrafficMin: 32,
    polyline: [
      [121.5, 25.03],
      [121.55, 25.06],
    ],
    ...overrides,
  };
}

async function renderLeg(locale: Locale, leg: DriveLeg) {
  mockUseAuthStore.mockReturnValue({
    userConfig: { language: locale },
    updateUserConfig: vi.fn(),
  } as never);
  await i18n.changeLanguage(locale);
  return renderToStaticMarkup(
    React.createElement(LegDetail, {
      leg,
      isFirst: true,
      isLast: true,
      pointCtx,
      isSelected: false,
    }),
  );
}

beforeEach(() => {
  mockUseAuthStore.mockReset();
});

afterEach(async () => {
  await i18n.changeLanguage("zh-TW");
});

describe("LegDetail drive traffic label", () => {
  it("shows no traffic label when the leg carries no trafficLevel", async () => {
    const html = await renderLeg("zh-TW", makeDriveLeg());

    expect(html).toContain("約");
    expect(html).not.toContain("車流壅塞");
    expect(html).not.toContain("車多緩行");
    expect(html).not.toContain("嚴重壅塞");
    expect(html).not.toContain("道路封閉");
  });

  it.each([
    ["moderate", "（車多緩行）"],
    ["heavy", "（車流壅塞）"],
    ["severe", "（嚴重壅塞）"],
    ["closed", "（道路封閉）"],
  ] as const)(
    "renders the zh-TW label for trafficLevel %s",
    async (trafficLevel, expected) => {
      const html = await renderLeg(
        "zh-TW",
        makeDriveLeg({ trafficLevel: trafficLevel as TrafficLevel }),
      );
      expect(html).toContain(expected);
    },
  );

  it.each([
    ["moderate", "(Moderate traffic)"],
    ["heavy", "(Heavy traffic)"],
    ["severe", "(Severe traffic)"],
    ["closed", "(Road closed)"],
  ] as const)(
    "renders the en label for trafficLevel %s",
    async (trafficLevel, expected) => {
      const html = await renderLeg(
        "en",
        makeDriveLeg({ trafficLevel: trafficLevel as TrafficLevel }),
      );
      expect(html).toContain(expected);
    },
  );

  it("shows exactly one label at a time", async () => {
    const html = await renderLeg(
      "zh-TW",
      makeDriveLeg({ trafficLevel: "heavy" }),
    );

    expect(html).toContain("（車流壅塞）");
    expect(html).not.toContain("（嚴重壅塞）");
    expect(html).not.toContain("（車多緩行）");
    expect(html).not.toContain("（道路封閉）");
  });

  it("shows no label for the light and unknown levels", async () => {
    for (const trafficLevel of ["light", "unknown"] as const) {
      const html = await renderLeg("zh-TW", makeDriveLeg({ trafficLevel }));
      expect(html).not.toContain("（");
    }
  });

  it("still prefers the in-traffic duration over the free-flow duration", async () => {
    const html = await renderLeg(
      "zh-TW",
      makeDriveLeg({ trafficLevel: "heavy" }),
    );

    expect(html).toContain("32 min");
    expect(html).not.toContain("20 min");
  });

  it("renders the same label for a MOTORCYCLE leg", async () => {
    const html = await renderLeg(
      "zh-TW",
      makeDriveLeg({ type: "MOTORCYCLE", trafficLevel: "severe" }),
    );

    expect(html).toContain("（嚴重壅塞）");
  });
});
