import { describe, expect, it } from "vitest";
import en from "@/i18n/locale/en/translation.json";
import type { BusLeg, MetroLeg, RouteLeg } from "@/types/route";
import { getLegColor } from "@/types/route";
import {
  contrastRatio,
  METRO_LINE_FILLS,
  metroLineColors,
} from "../metroLineColors";

const EXPECTED: Record<string, { fill: string; fg: string }> = {
  TRTC_BR: { fill: "#C48C31", fg: "#1A1A1A" },
  TRTC_R: { fill: "#E3002C", fg: "#FFFFFF" },
  TRTC_G: { fill: "#008659", fg: "#FFFFFF" },
  TRTC_O: { fill: "#F8B61C", fg: "#1A1A1A" },
  TRTC_BL: { fill: "#0070BD", fg: "#FFFFFF" },
  "TRTC_R_R-3": { fill: "#FD92A3", fg: "#1A1A1A" },
  "TRTC_G_G-3": { fill: "#CFDB00", fg: "#1A1A1A" },
  TRTCMG_MK: { fill: "#00AFE2", fg: "#1A1A1A" },
  NTMC_Y: { fill: "#FFDB00", fg: "#1A1A1A" },
  NTMC_LB: { fill: "#79BCE8", fg: "#1A1A1A" },
  NTDLRT_V: { fill: "#E5554F", fg: "#1A1A1A" },
  "NTDLRT_V_V-1": { fill: "#E5554F", fg: "#1A1A1A" },
  "NTDLRT_V_V-2": { fill: "#E5554F", fg: "#1A1A1A" },
  NTALRT_K: { fill: "#C3B091", fg: "#1A1A1A" },
};

// globals.css --background / --card for light, .dark, .high-contrast, plus
// light and dark map tiles.
const SURFACES = [
  "#FFFFFF",
  "#0C0A09",
  "#1C1917",
  "#000000",
  "#030303",
  "#121212",
];

const metro = (lineKey?: string): MetroLeg =>
  ({ type: "METRO", ...(lineKey ? { lineKey } : {}) }) as MetroLeg;

describe("metro line colours", () => {
  it.each(Object.entries(EXPECTED))("%s → fill %o", (lineKey, expected) => {
    expect(metroLineColors(metro(lineKey))).toEqual(expected);
    expect(getLegColor(metro(lineKey))).toBe(expected.fill);
  });

  it("lists exactly the expected lines, all of them translated", () => {
    expect(Object.keys(METRO_LINE_FILLS)).toEqual(Object.keys(EXPECTED));
    for (const key of Object.keys(METRO_LINE_FILLS))
      expect(en.metroLines).toHaveProperty([key]);
  });

  it.each([
    ["an unknown line", metro("KRTC_R")],
    ["a leg without a lineKey", metro()],
    [
      "a non-metro leg carrying a lineKey",
      { type: "BUS", lineKey: "TRTC_BL" } as unknown as BusLeg,
    ],
  ] as [string, RouteLeg][])("keeps the generic colour for %s", (_, leg) => {
    expect(metroLineColors(leg)).toBeNull();
    expect(getLegColor(leg)).toBe(leg.type === "BUS" ? "#22c55e" : "#FF6B35");
  });

  it.each(Object.entries(EXPECTED))("%s badge text reaches 4.5:1", (_, c) => {
    expect(contrastRatio(c.fill, c.fg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(Object.entries(EXPECTED))(
    "%s line or its outline reaches 3:1 on every surface",
    (_, c) => {
      for (const surface of SURFACES) {
        const visible =
          contrastRatio(c.fill, surface) >= 3 ||
          (contrastRatio(c.fg, surface) >= 3 &&
            contrastRatio(c.fill, c.fg) >= 3);
        expect({ surface, visible }).toEqual({ surface, visible: true });
      }
    },
  );
});
