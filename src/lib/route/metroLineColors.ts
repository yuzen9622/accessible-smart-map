import type { RouteLeg } from "@/types/route";

/**
 * Line colours keyed by the backend's `MetroLeg.lineKey`. Source (2026-10-28):
 * zh.wikipedia Template:台北捷運色彩; Sanying / Danhai / Ankeng from
 * Module:Adjacent stations/新北捷運. Lines not listed keep the generic METRO
 * colour.
 */
export const METRO_LINE_FILLS: Readonly<Record<string, string>> = {
  TRTC_BR: "#C48C31",
  TRTC_R: "#E3002C",
  TRTC_G: "#008659",
  TRTC_O: "#F8B61C",
  TRTC_BL: "#0070BD",
  "TRTC_R_R-3": "#FD92A3",
  "TRTC_G_G-3": "#CFDB00",
  TRTCMG_MK: "#00AFE2",
  NTMC_Y: "#FFDB00",
  NTMC_LB: "#79BCE8",
  NTDLRT_V: "#E5554F",
  "NTDLRT_V_V-1": "#E5554F",
  "NTDLRT_V_V-2": "#E5554F",
  NTALRT_K: "#C3B091",
};

const LIGHT_INK = "#FFFFFF";
const DARK_INK = "#1A1A1A";

function relativeLuminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  );
  return (hi + 0.05) / (lo + 0.05);
}

/** White or near-black, whichever reads better on `fill`. */
export function readableOn(fill: string): string {
  return contrastRatio(LIGHT_INK, fill) >= contrastRatio(DARK_INK, fill)
    ? LIGHT_INK
    : DARK_INK;
}

export interface MetroLineColors {
  /** Official line colour: badge background, map line, rail. */
  fill: string;
  /** Text / icon colour on `fill`, and the outline that keeps light lines visible. */
  fg: string;
}

/** The leg's line colours, or null when it is not a metro line in the table. */
export function metroLineColors(leg: RouteLeg): MetroLineColors | null {
  if (leg.type !== "METRO" || !leg.lineKey) return null;
  const fill = METRO_LINE_FILLS[leg.lineKey];
  return fill ? { fill, fg: readableOn(fill) } : null;
}
