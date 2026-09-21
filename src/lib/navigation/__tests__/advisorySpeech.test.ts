import { beforeEach, describe, expect, it } from "vitest";
import {
  advisoryAnnouncementKey,
  selectAdvisoryAnnouncement,
} from "@/lib/navigation/advisorySpeech";
import useNavStore, { type NavAdvisory } from "@/stores/useNavStore";

const advisory: NavAdvisory = {
  advisoryId: "adv-1",
  category: "hazard",
  severity: "warning",
  action: "none",
  title: "前方施工",
  speech: "前方 50 公尺有施工路段",
  issuedAt: "2026-09-16T10:00:00.000Z",
};

const newer: NavAdvisory = {
  ...advisory,
  advisoryId: "adv-2",
  title: "電梯停用",
  speech: "前方電梯停用",
  issuedAt: "2026-09-16T10:05:00.000Z",
};

/** The HUD's effect: announce, then remember whatever it consumed. */
function announce(
  advisories: NavAdvisory[],
  spoken: Set<string>,
  arrived = false,
): string | null {
  const { keysToRemember, speech } = selectAdvisoryAnnouncement(
    advisories,
    spoken,
    { arrived },
  );
  for (const key of keysToRemember) spoken.add(key);
  return speech;
}

describe("selectAdvisoryAnnouncement", () => {
  it("announces each advisory only once", () => {
    const spoken = new Set<string>();
    expect(announce([advisory], spoken)).toBe(advisory.speech);
    expect(announce([advisory], spoken)).toBeNull();
  });

  it("re-announces an advisory the backend reissues with a newer timestamp", () => {
    const spoken = new Set<string>();
    announce([advisory], spoken);
    const reissued = { ...advisory, issuedAt: "2026-09-16T10:02:00.000Z" };
    expect(announce([reissued], spoken)).toBe(reissued.speech);
  });

  it("speaks only the newest of a batch, but consumes the whole batch", () => {
    // Speaking cancels the previous utterance, so a batch would only ever
    // leave the last one audible — and the older one must not surface later.
    const spoken = new Set<string>();
    expect(announce([newer, advisory], spoken)).toBe(newer.speech);
    expect(spoken.has(advisoryAnnouncementKey(advisory))).toBe(true);
    expect(announce([newer, advisory], spoken)).toBeNull();
  });

  it("stays silent after arrival but still consumes the keys", () => {
    const spoken = new Set<string>();
    expect(announce([advisory], spoken, true)).toBeNull();
    // Not re-announced once the arrival card is dismissed either.
    expect(announce([advisory], spoken)).toBeNull();
  });

  it("says nothing for an advisory carrying no speech line", () => {
    const spoken = new Set<string>();
    expect(announce([{ ...advisory, speech: "" }], spoken)).toBeNull();
  });
});

describe("against the store's own ordering", () => {
  beforeEach(() => {
    useNavStore.getState().reset();
  });

  it("follows pushAdvisories' newest-first sort", () => {
    const spoken = new Set<string>();
    // Pushed oldest-first; the store re-sorts by issuedAt descending.
    useNavStore.getState().pushAdvisories([advisory, newer]);
    expect(announce(useNavStore.getState().advisories, spoken)).toBe(
      newer.speech,
    );
  });

  it("does not re-announce after the store re-pushes the same advisories", () => {
    const spoken = new Set<string>();
    useNavStore.getState().pushAdvisories([advisory]);
    announce(useNavStore.getState().advisories, spoken);

    // A voice→local takeover re-pushes the carried alerts after
    // setInstructions cleared them: that must not speak them again.
    const carried = useNavStore.getState().advisories;
    useNavStore.getState().setInstructions(
      [
        {
          text: "直行",
          type: "depart",
          bearing: null,
          relativeDirection: null,
          distanceM: 100,
          streetName: null,
          legType: "WALK",
          polylineIndex: 0,
        },
      ],
      [],
    );
    expect(useNavStore.getState().advisories).toHaveLength(0);

    useNavStore.getState().pushAdvisories(carried);
    expect(useNavStore.getState().advisories).toHaveLength(1);
    expect(announce(useNavStore.getState().advisories, spoken)).toBeNull();
  });
});
