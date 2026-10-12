import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/zh-TW",
  redirect: () => {},
}));
vi.mock("@/stores/useAuthStore", () => ({ default: vi.fn() }));

import { LegDetail } from "@/components/shared/RouteCard/LegDetail";
import i18n from "@/i18n/client";
import useAuthStore from "@/stores/useAuthStore";
import type { TraLeg } from "@/types/route";

const leg: TraLeg = {
  type: "TRA",
  trainNo: "101",
  trainTypeName: "自強",
  departureStation: "臺北",
  arrivalStation: "松山",
  departureStationUID: "A",
  arrivalStationUID: "B",
  departureTime: "10:00",
  arrivalTime: "10:05",
  rideMinutes: 5,
  waitInfo: { source: "unavailable", time: null },
  estimatedWaitMinutes: 0,
  polyline: [],
  departureStationA11y: [
    {
      osmId: "f",
      name: "電梯",
      nameEn: "Lift",
      displayName: "Lift display",
      category: "elevator",
      location: { type: "Point", coordinates: [121, 25] },
    },
  ],
  arrivalStationA11y: [],
  facilityHighlights: [],
  fromNameEn: "Taipei",
  toNameEn: "Songshan",
  routeNameEn: "Express",
  fromDisplayName: "Taipei display",
  toDisplayName: "Songshan display",
  routeDisplayName: "Express display",
  displayLanguage: "en",
  intermediateStops: [
    {
      stationUid: "C",
      name: "中間站",
      nameEn: "Middle",
      displayName: "Middle display",
    },
  ],
};
async function render(language: "en" | "zh-TW", input = leg) {
  vi.mocked(useAuthStore).mockReturnValue({
    userConfig: { language },
    updateUserConfig: vi.fn(),
  } as never);
  await i18n.changeLanguage(language);
  return renderToStaticMarkup(
    React.createElement(LegDetail, {
      leg: input,
      isFirst: true,
      isLast: true,
      pointCtx: {
        originFallback: "Origin",
        destinationFallback: "Destination",
        myLocationFallback: "Here",
      },
      isSelected: true,
    }),
  );
}
afterEach(async () => {
  await i18n.changeLanguage("zh-TW");
});
it("renders TRA routeDisplayName, endpoint and intermediate display, then returns to canonical on switch", async () => {
  const english = await render("en");
  for (const name of [
    "Express display",
    "Taipei display",
    "Songshan display",
    "Middle display",
    "Lift display",
  ])
    expect(english).toContain(name);
  const chinese = await render("zh-TW");
  for (const name of ["自強", "臺北", "松山", "中間站", "電梯"])
    expect(chinese).toContain(name);
  expect(chinese).not.toContain("display");
  expect(leg.departureStationUID).toBe("A");
  expect(leg.departureStation).toBe("臺北");
});
it("keeps a legacy route usable and falls back on empty display values", async () => {
  const html = await render("en", {
    ...leg,
    routeDisplayName: " ",
    fromDisplayName: " ",
    toDisplayName: "",
    routeNameEn: undefined,
    fromNameEn: undefined,
    toNameEn: undefined,
    displayLanguage: undefined,
  });
  expect(html).toContain("自強");
  expect(html).toContain("臺北");
  expect(html).toContain("松山");
});
