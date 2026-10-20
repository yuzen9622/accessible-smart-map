import type { BusDepartureCandidate, BusLeg } from "@/types/route";

/** Display order is the backend's. A viewed candidate never selects a ride. */
export function resolveViewedCandidate(
  candidates: BusDepartureCandidate[],
  viewedCandidateId?: string,
): BusDepartureCandidate | null {
  return (
    candidates.find(
      (candidate) => candidate.candidateId === viewedCandidateId,
    ) ??
    candidates.find((candidate) => candidate.selected) ??
    null
  );
}

/** A live candidate's id ends in its boarding time, which moves with every
 * ETA refresh; the service is what precedes it (sub-route, direction, plate). */
function serviceId(candidateId: string) {
  const end = candidateId.lastIndexOf("|");
  return end < 0 ? candidateId : candidateId.slice(0, end);
}

/** The refreshed entry for a previously viewed candidate, if it still runs. */
export function followCandidate(
  candidates: BusDepartureCandidate[],
  previous: BusDepartureCandidate,
): BusDepartureCandidate | undefined {
  const exact = candidates.find((c) => c.candidateId === previous.candidateId);
  if (exact) return exact;
  const before = Date.parse(previous.boardingTime ?? "");
  const gap = (c: BusDepartureCandidate) =>
    Math.abs(Date.parse(c.boardingTime ?? "") - before) || 0;
  return candidates
    .filter((c) => serviceId(c.candidateId) === serviceId(previous.candidateId))
    .sort((a, b) => gap(a) - gap(b))[0];
}

/** Several departures of one line should occupy only one summary badge. */
export function busRouteNames(
  leg: BusLeg,
  candidates = leg.departureCandidates,
): string[] {
  const names = [
    ...new Set(candidates?.map((candidate) => candidate.routeName)),
  ];
  return names.length ? names : [leg.routeName];
}

function routeInstantDate(instant: string | null | undefined): Date | null {
  if (!instant || !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(instant))
    return null;
  const date = new Date(instant);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** Compact clock for the visible UI. Full dates belong in an accessible title. */
export function formatRouteClock(
  instant: string | null | undefined,
  language: "en" | "zh-TW",
): string | null {
  const date = routeInstantDate(instant);
  return date
    ? new Intl.DateTimeFormat(language, {
        timeZone: "Asia/Taipei",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(date)
    : null;
}

/** Calendar-day offset in Taiwan, independent of device timezone or elapsed hours. */
export function routeDayOffset(
  instant: string | null | undefined,
  reference: string | null | undefined,
): number | null {
  const date = routeInstantDate(instant);
  const from = routeInstantDate(reference);
  if (!date || !from) return null;
  const formatter = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const calendarDay = (value: Date) => {
    const parts = formatter.formatToParts(value);
    const part = (type: string) =>
      Number(parts.find((entry) => entry.type === type)?.value);
    return Date.UTC(part("year"), part("month") - 1, part("day"));
  };
  return (calendarDay(date) - calendarDay(from)) / 86_400_000;
}

/** Full instant for disclosure/accessible titles, never a device-local date. */
export function formatRouteInstant(
  instant: string | null | undefined,
  language: "en" | "zh-TW",
): string | null {
  const date = routeInstantDate(instant);
  if (!date) return null;
  return new Intl.DateTimeFormat(language, {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}
