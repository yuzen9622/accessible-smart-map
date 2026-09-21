import { describe, expect, it } from "vitest";
import {
  type AdvisoryTarget,
  filterApplicableNavigationEvents,
  isVoiceSpeechChannelLive,
  requiresLiveVoiceSession,
  shouldAcceptAdvisoryEvent,
  type VoiceNavAdvisory,
  type VoiceNavigationEvent,
  type VoiceStatusName,
} from "@/lib/voice/voiceSession";

const LIVE_STATUSES: VoiceStatusName[] = [
  "ready",
  "listening",
  "model-speaking",
  "playback-blocked",
];

const NON_LIVE_STATUSES: VoiceStatusName[] = [
  "idle",
  "connecting",
  "reconnecting",
  "needs-login",
  "ended",
  "error",
];

const NAV_EVENT_TYPES_REQUIRING_LIVE_SESSION: VoiceNavigationEvent["type"][] = [
  "nav.start",
  "nav.step",
  "nav.progress",
  "nav.transit",
  "nav.arrived",
  "nav.stop",
  "nav.offroute",
  "nav.rerouting",
  "nav.route_replaced",
  "nav.reroute_failed",
  "nav.resume_ok",
  "nav.resume_failed",
  "nav.error",
];

const advisory: VoiceNavAdvisory = {
  advisoryId: "adv-1",
  category: "hazard",
  severity: "warning",
  action: "none",
  title: "前方施工",
  speech: "前方 50 公尺有施工路段",
  issuedAt: "2026-09-16T10:00:00.000Z",
};

const advisoryEvent: VoiceNavigationEvent = {
  type: "nav.advisory",
  navigationId: "nav-1",
  routeVersion: 1,
  advisories: [advisory],
};

const stepEvent: VoiceNavigationEvent = {
  type: "nav.step",
  currentStepIndex: 2,
  instruction: "右轉",
  remainingM: 400,
};

const progressEvent: VoiceNavigationEvent = {
  type: "nav.progress",
  navigationId: "nav-1",
  routeVersion: 1,
  currentStepIndex: 2,
  distanceToNextM: 30,
  remainingDistanceM: 400,
  remainingDurationSec: 300,
  estimatedArrivalAt: "2026-09-16T10:05:00.000Z",
  etaSource: "estimated",
};

describe("isVoiceSpeechChannelLive", () => {
  it.each(LIVE_STATUSES)("treats %s as a live speech channel", (status) => {
    expect(isVoiceSpeechChannelLive(status)).toBe(true);
  });

  it.each(NON_LIVE_STATUSES)("treats %s as not live", (status) => {
    expect(isVoiceSpeechChannelLive(status)).toBe(false);
  });
});

describe("requiresLiveVoiceSession", () => {
  it("never requires a live session for nav.advisory", () => {
    expect(requiresLiveVoiceSession("nav.advisory")).toBe(false);
  });

  it.each(NAV_EVENT_TYPES_REQUIRING_LIVE_SESSION)(
    "requires a live session for %s",
    (type) => {
      expect(requiresLiveVoiceSession(type)).toBe(true);
    },
  );
});

describe("filterApplicableNavigationEvents", () => {
  it.each(NON_LIVE_STATUSES)(
    "keeps only navigation alerts while %s",
    (status) => {
      const events = [stepEvent, advisoryEvent, progressEvent];
      const applicable = filterApplicableNavigationEvents(events, status);
      expect(applicable).toHaveLength(1);
      expect(applicable[0]).toBe(advisoryEvent);
    },
  );

  it("passes the original array through untouched while live", () => {
    const events = [stepEvent, advisoryEvent, progressEvent];
    expect(filterApplicableNavigationEvents(events, "ready")).toBe(events);
  });

  it("returns an empty list for an empty input", () => {
    expect(filterApplicableNavigationEvents([], "connecting")).toEqual([]);
  });
});

describe("nav.advisory identity gate", () => {
  const current: AdvisoryTarget = {
    isNavigating: true,
    arrived: false,
    navigationId: "nav-1",
    routeVersion: 1,
  };

  it("accepts an advisory that matches the live navigation identity", () => {
    expect(shouldAcceptAdvisoryEvent(advisoryEvent, current)).toBe(true);
  });

  it("rejects an advisory when no navigation identity is known", () => {
    // Fail closed: an unknown identity cannot be proven current, and the
    // advisory would otherwise land on whatever route is running now.
    expect(
      shouldAcceptAdvisoryEvent(advisoryEvent, {
        ...current,
        navigationId: null,
      }),
    ).toBe(false);
  });

  it("rejects an advisory carrying no navigation id of its own", () => {
    expect(
      shouldAcceptAdvisoryEvent(
        { ...advisoryEvent, navigationId: "" },
        current,
      ),
    ).toBe(false);
  });

  it("rejects an advisory from another navigation", () => {
    expect(
      shouldAcceptAdvisoryEvent(
        { ...advisoryEvent, navigationId: "nav-2" },
        current,
      ),
    ).toBe(false);
  });

  it("rejects an advisory from a superseded route version", () => {
    expect(
      shouldAcceptAdvisoryEvent({ ...advisoryEvent, routeVersion: 0 }, current),
    ).toBe(false);
  });

  it("rejects advisories once navigation stopped or arrived", () => {
    expect(
      shouldAcceptAdvisoryEvent(advisoryEvent, {
        ...current,
        isNavigating: false,
      }),
    ).toBe(false);
    expect(
      shouldAcceptAdvisoryEvent(advisoryEvent, { ...current, arrived: true }),
    ).toBe(false);
  });
});
