import { describe, expect, it } from "vitest";
import { mapToolToActions } from "../toolActionMapper";

describe("text assistant navigation controls", () => {
  it("maps the text agent's start/stop results to the page's navigation actions", () => {
    expect(
      mapToolToActions("startNavigation", {
        ok: true,
        clientAction: "start-navigation",
        routeId: "r2",
      }),
    ).toEqual([{ type: "start-navigation", routeId: "r2" }]);
    expect(
      mapToolToActions("startNavigation", {
        ok: true,
        clientAction: "start-navigation",
      }),
    ).toEqual([{ type: "start-navigation" }]);
    expect(
      mapToolToActions("stopNavigation", {
        ok: true,
        clientAction: "stop-navigation",
      }),
    ).toEqual([{ type: "stop-navigation" }]);
  });

  it("ignores voice results, which the backend already ran as ui.command", () => {
    expect(
      mapToolToActions("startNavigation", { ok: true, guidance: "live" }),
    ).toEqual([]);
  });
});

describe("refused route plans", () => {
  it("leave the map alone so the assistant can explain the refusal", () => {
    for (const reason of [
      "LOCATION_REQUIRED",
      "TRAVEL_MODE_NOT_ALLOWED_FOR_MODE",
    ])
      expect(
        mapToolToActions("planAccessibleRoute", {
          ok: false,
          reason,
          error: "…",
        }),
      ).toEqual([]);
  });

  it("still reject an accepted plan that breaks the route contract", () => {
    expect(() =>
      mapToolToActions("planAccessibleRoute", { ok: true, routes: [] }),
    ).toThrow();
  });
});
