import { describe, expect, it } from "vitest";
import type { AccessibleRoute, StepStreetName, WalkStep } from "@/types/route";
import {
  legSourceName,
  metroLineName,
  metroTerminalName,
  sourceName,
  walkStreetName,
  withRouteNameLanguage,
} from "../sourceNames";

const step: WalkStep = {
  relativeDirection: "CONTINUE",
  absoluteDirection: null,
  streetName: "同名路",
  bogusName: false,
  area: false,
  stairs: false,
  steepSlope: false,
  distanceM: 30,
  location: [121, 25],
};

describe("metro line name", () => {
  const t = (key: string, values?: Record<string, unknown>) =>
    key === "metroLines.TRTC_BL" ? "Bannan Line" : String(values?.defaultValue);
  it("translates the backend line label instead of rendering source words", () => {
    expect(
      metroLineName({ lineKey: "TRTC_BL", lineName: "板南線" }, "en", t),
    ).toBe("Bannan Line");
  });
  it("falls back to the source line name when the label is missing or unknown", () => {
    expect(metroLineName({ lineName: "某線" }, "en", t)).toBe("某線");
    expect(metroLineName({ lineKey: "X", lineName: "某線" }, "en", t)).toBe(
      "某線",
    );
  });
});

describe("metro terminal name", () => {
  it("uses the trip terminal in the requested language", () => {
    const leg = {
      terminalStation: "頂埔",
      terminalNameEn: "Dingpu",
      terminalDisplayName: "Dingpu",
      displayLanguage: "en" as const,
    };
    expect(metroTerminalName(leg, "en")).toBe("Dingpu");
    expect(metroTerminalName(leg, "zh-TW")).toBe("頂埔");
    expect(metroTerminalName({ terminalStation: "亞東醫院" }, "en")).toBe(
      "亞東醫院",
    );
  });
  it("returns nothing when the trip had no terminal, even with display leftovers", () => {
    expect(metroTerminalName({}, "zh-TW")).toBeUndefined();
    expect(
      metroTerminalName(
        { terminalStation: " ", terminalDisplayName: "stale" },
        "zh-TW",
      ),
    ).toBeUndefined();
  });
});

describe("route source names", () => {
  it("prefers nonempty display only for its response language", () => {
    expect(sourceName("站", "Station", "Station display", "en", "en")).toBe(
      "Station display",
    );
    expect(sourceName("站", "Station", "Station display", "zh-TW", "en")).toBe(
      "站",
    );
    expect(sourceName("站", "Station", "站", "en", "zh-TW")).toBe("Station");
    expect(sourceName("站", undefined, "stale English", "zh-TW")).toBe("站");
    expect(sourceName("站", undefined, "  ", "en", "en")).toBe("站");
    expect(sourceName("", "English only", undefined, "en")).toBe(
      "English only",
    );
  });
  it("keeps canonical, identity, geometry and WALK9 untouched when marking provenance", () => {
    const route = {
      routeId: "id",
      routeToken: "token",
      legs: [
        {
          type: "WALK",
          from: "起",
          to: "迄",
          steps: [step],
          stepStreetNames: [{ index: 0, streetName: "同名路", nameEn: "Road" }],
          polyline: [[121, 25]],
        },
      ],
    } as unknown as AccessibleRoute;
    const marked = withRouteNameLanguage(route, "en");
    expect(marked.routeId).toBe("id");
    expect(marked.routeToken).toBe("token");
    expect(marked.legs[0]).toMatchObject({ from: "起", displayLanguage: "en" });
    expect(marked.legs[0].polyline).toBe(route.legs[0].polyline);
    expect(Object.keys(step)).toHaveLength(9);
    expect(route.legs[0].displayLanguage).toBeUndefined();
    expect(
      legSourceName(
        {
          routeNameEn: "Express",
          routeDisplayName: "特快",
          displayLanguage: "zh-TW",
        },
        "route",
        "特快",
        "en",
      ),
    ).toBe("Express");
  });
});

describe("WALK source sidecar", () => {
  const steps = [step, { ...step, distanceM: 50 }];
  const names: StepStreetName[] = [
    {
      index: 0,
      streetName: "同名路",
      nameEn: "First Road",
      displayName: "First Road",
    },
    {
      index: 1,
      streetName: "同名路",
      nameEn: "Second Road",
      displayName: "Second Road",
    },
  ];
  it("pairs original indices, not repeated canonical names, and switches without modifying steps", () => {
    expect(walkStreetName(steps, 0, names, "en", "en")).toBe("First Road");
    expect(walkStreetName(steps, 1, names, "en", "en")).toBe("Second Road");
    expect(walkStreetName(steps, 0, names, "zh-TW", "en")).toBe("同名路");
    expect(steps[0].streetName).toBe("同名路");
    expect(Object.keys(steps[0])).toHaveLength(9);
  });
  it.each([
    undefined,
    [],
    [names[0], names[0]],
    [{ ...names[0], streetName: "錯路" }],
    [{ ...names[0], nameEn: " " }],
    [{ ...names[0], index: -1 }],
    [{ ...names[0], index: 99 }],
    [{ ...names[0], index: 0.5 }],
  ])(
    "rejects absent, duplicated, mismatched or invalid sidecars: %j",
    (sidecar) => {
      expect(walkStreetName(steps, 0, sidecar, "en", "en")).toBe("同名路");
    },
  );
});
