type AppLanguage = "en" | "zh-TW";

import type {
  AccessibleRoute,
  MetroLeg,
  RouteSourceNames,
  StepStreetName,
  WalkStep,
} from "@/types/route";

export function nonemptyName(
  value: string | null | undefined,
): string | undefined {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

/** Display fields belong to one response language; source names survive switches. */
export function sourceName(
  canonical: string | undefined,
  english: string | undefined,
  display: string | undefined,
  language: AppLanguage,
  displayLanguage?: AppLanguage,
): string {
  return (
    (displayLanguage === language ? nonemptyName(display) : undefined) ||
    (language === "en" ? nonemptyName(english) : undefined) ||
    nonemptyName(canonical) ||
    ""
  );
}

export function legSourceName(
  leg: RouteSourceNames,
  field: "from" | "to" | "route",
  canonical: string,
  language: AppLanguage,
): string {
  return sourceName(
    canonical,
    leg[`${field}NameEn`],
    leg[`${field}DisplayName`],
    language,
    leg.displayLanguage,
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Metro line text from the backend's line label; unknown labels fall back to the source line name. */
export function metroLineName(
  leg: Pick<
    MetroLeg,
    | "lineKey"
    | "lineName"
    | "routeNameEn"
    | "routeDisplayName"
    | "displayLanguage"
  >,
  language: AppLanguage,
  t: Translate,
): string {
  const fallback = legSourceName(leg, "route", leg.lineName, language);
  return leg.lineKey
    ? t(`metroLines.${leg.lineKey}`, { defaultValue: fallback })
    : fallback;
}

/** The selected trip's terminal for 「往…」; never substituted by the alighting station. */
export function metroTerminalName(
  leg: Pick<
    MetroLeg,
    | "terminalStation"
    | "terminalNameEn"
    | "terminalDisplayName"
    | "displayLanguage"
  >,
  language: AppLanguage,
): string | undefined {
  if (!nonemptyName(leg.terminalStation)) return undefined;
  return sourceName(
    leg.terminalStation,
    leg.terminalNameEn,
    leg.terminalDisplayName,
    language,
    leg.displayLanguage,
  );
}

/** Client-only provenance. Never overwrite canonical names or WALK machine steps. */
export function withRouteNameLanguage(
  route: AccessibleRoute,
  language?: AppLanguage,
): AccessibleRoute {
  if (!Array.isArray(route.legs)) return route;
  return {
    ...route,
    legs: route.legs.map((leg) => ({ ...leg, displayLanguage: language })),
  };
}

/** Index is in the original leg steps, not filtered rows or nav instructions. */
export function walkStreetName(
  steps: WalkStep[],
  index: number,
  names: StepStreetName[] | undefined,
  language: AppLanguage,
  displayLanguage?: AppLanguage,
): string {
  const canonical = steps[index]?.streetName ?? "";
  const matches = Array.isArray(names)
    ? names.filter((name) => name && name.index === index)
    : [];
  const entry = matches[0];
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= steps.length ||
    matches.length !== 1 ||
    !entry ||
    entry.streetName !== canonical ||
    !nonemptyName(entry.nameEn)
  )
    return canonical;
  return sourceName(
    canonical,
    entry.nameEn,
    entry.displayName,
    language,
    displayLanguage,
  );
}
