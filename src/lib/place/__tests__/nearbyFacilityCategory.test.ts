import { describe, expect, it } from "vitest";

import type { metroA11yData } from "@/types";
import { nearbyFacilityCategory } from "../nearbyFacilityCategory";

function facility(overrides: Partial<metroA11yData>): metroA11yData {
  return {
    項次: "test",
    "出入口電梯/無障礙坡道名稱": "無障礙坡道",
    ...overrides,
  };
}

describe("nearbyFacilityCategory", () => {
  it("classifies the campus type instead of a conflicting facility name", () => {
    expect(
      nearbyFacilityCategory(
        facility({ source: "campus", facType: "accessible_toilet" }),
      ),
    ).toBe("toilet");
    expect(
      nearbyFacilityCategory(
        facility({ source: "campus", facType: "outdoor_path" }),
      ),
    ).toBe("other");
    expect(
      nearbyFacilityCategory(facility({ source: "campus", facType: "ramp" })),
    ).toBe("ramp");
  });

  it("classifies OSM facilities using their category", () => {
    expect(
      nearbyFacilityCategory(facility({ source: "osm", category: "elevator" })),
    ).toBe("elevator");
    expect(
      nearbyFacilityCategory(facility({ source: "osm", category: "toilet" })),
    ).toBe("toilet");
    expect(
      nearbyFacilityCategory(facility({ source: "osm", category: "kerb_cut" })),
    ).toBe("other");
  });

  it("uses the backend metro name rule only when the type is absent", () => {
    expect(nearbyFacilityCategory(facility({ source: "metro" }))).toBe("ramp");
    expect(
      nearbyFacilityCategory(
        facility({
          source: "metro",
          "出入口電梯/無障礙坡道名稱": "電梯及坡道",
        }),
      ),
    ).toBe("elevator");
    expect(
      nearbyFacilityCategory(facility({ source: "metro", category: "other" })),
    ).toBe("other");
    expect(nearbyFacilityCategory(facility({ source: "campus" }))).toBe(
      "other",
    );
    expect(nearbyFacilityCategory(facility({}))).toBe("other");
  });
});
