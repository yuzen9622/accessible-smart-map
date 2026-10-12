import { describe, expect, it } from "vitest";
import type { AccessibleRoute, StepStreetName, WalkStep } from "@/types/route";
import {
  legSourceName,
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
