import { expect, it } from "vitest";
import { parseAiRoutePlan } from "../ai/routeContract";
import { parseSosRoutePreview } from "../routePreviewAdapter";
import { lineRoadPlanFixture } from "./lineRoadPreview.fixture";

it.each(["drive", "motorcycle"] as const)(
  "preserves canonical %s coordinates and maneuvers in general and SOS previews",
  (mode) => {
    const plan = lineRoadPlanFixture(mode);
    expect(parseAiRoutePlan(plan)).toEqual(plan);
    const sos = {
      sessionId: "a".repeat(24),
      origin: plan.origin,
      destination: plan.destination,
      originLabel: "起點",
      destinationLabel: "終點",
      travelMode: mode,
      routes: plan.routes,
    };
    expect(parseSosRoutePreview(sos)).toEqual(sos);
  },
);

it.each([
  { lat: Number.NaN, lng: 121.56 },
  { lat: 25.03, lng: Number.POSITIVE_INFINITY },
  { lat: 91, lng: 121.56 },
  { lat: 25.03, lng: 181 },
  { lat: 25.03 },
  { name: "not a coordinate" },
])("rejects invalid road coordinates %j", (from) => {
  const plan = lineRoadPlanFixture();
  const invalid = {
    ...plan,
    routes: [
      { ...plan.routes[0], legs: [{ ...plan.routes[0].legs[0], from }] },
    ],
  };
  expect(() => parseAiRoutePlan(invalid)).toThrow();
});

it("keeps WALK endpoint validation strict", () => {
  const plan = lineRoadPlanFixture();
  plan.routes[0].legs[0].type = "WALK";
  expect(() => parseAiRoutePlan(plan)).toThrow();
});
