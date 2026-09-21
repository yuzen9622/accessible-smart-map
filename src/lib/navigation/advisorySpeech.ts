/**
 * Announcement rule for navigation advisories (the HUD's local TTS).
 *
 * Kept out of the component so the dedupe contract is testable: an advisory
 * is announced once per `advisoryId` + `issuedAt` pair, so a backend that
 * reissues the same hazard with a newer timestamp is heard again, while the
 * store re-sorting or re-pushing the same list stays silent.
 */

import type { NavAdvisory } from "@/stores/useNavStore";

export function advisoryAnnouncementKey(advisory: NavAdvisory): string {
  return `${advisory.advisoryId}:${advisory.issuedAt}`;
}

export interface AdvisoryAnnouncement {
  /** Keys to mark as seen, whether or not anything is spoken. */
  keysToRemember: string[];
  /** The single line to speak, or null when there is nothing to say. */
  speech: string | null;
}

/**
 * `advisories` is expected newest-first (`pushAdvisories` sorts by
 * `issuedAt` descending). Speaking cancels the previous utterance, so
 * announcing a whole batch would only ever leave the last one audible:
 * the newest unseen advisory is the one worth hearing.
 */
export function selectAdvisoryAnnouncement(
  advisories: NavAdvisory[],
  spokenKeys: ReadonlySet<string>,
  options: { arrived: boolean },
): AdvisoryAnnouncement {
  const unspoken = advisories.filter(
    (advisory) => !spokenKeys.has(advisoryAnnouncementKey(advisory)),
  );
  const keysToRemember = unspoken.map(advisoryAnnouncementKey);
  // Arrival still consumes the keys: the alert is stale the moment the user
  // is at the destination, and it must not be announced late.
  if (options.arrived) return { keysToRemember, speech: null };
  // An advisory may carry no speech line at all (it is still shown in the
  // HUD): normalise that to null rather than asking callers to guard "".
  const speech = unspoken[0]?.speech;
  return { keysToRemember, speech: speech ? speech : null };
}
