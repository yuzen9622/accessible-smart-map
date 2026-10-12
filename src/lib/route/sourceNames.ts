type AppLanguage = "en" | "zh-TW";

import type {
  AccessibleRoute,
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
