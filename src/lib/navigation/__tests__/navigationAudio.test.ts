import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  geminiOwnsNavigationSpeech,
  isNavigationAudioActive,
  resolveNavigationAudioToggle,
  shouldSpeakLocally,
} from "@/lib/navigation/navigationAudio";
import type { VoiceStatusName } from "@/lib/voice/voiceSession";
import useNavStore from "@/stores/useNavStore";
import useVoiceStore from "@/stores/useVoiceStore";

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

describe("geminiOwnsNavigationSpeech", () => {
  it("requires both the navigation and a channel that can carry speech", () => {
    for (const status of LIVE_STATUSES) {
      expect(geminiOwnsNavigationSpeech("voice", status)).toBe(true);
      // A background voice session must never silence a local navigation.
      expect(geminiOwnsNavigationSpeech("local", status)).toBe(false);
    }
    for (const status of NON_LIVE_STATUSES) {
      expect(geminiOwnsNavigationSpeech("voice", status)).toBe(false);
      expect(geminiOwnsNavigationSpeech("local", status)).toBe(false);
    }
  });
});

describe("shouldSpeakLocally", () => {
  it("never doubles up on a live Gemini channel", () => {
    expect(
      shouldSpeakLocally({ geminiOwnsSpeech: true, localVoiceEnabled: true }),
    ).toBe(false);
  });

  it("speaks whenever the local engine owns the navigation and voice is on", () => {
    expect(
      shouldSpeakLocally({ geminiOwnsSpeech: false, localVoiceEnabled: true }),
    ).toBe(true);
  });

  it("stays silent when the user disabled local voice", () => {
    expect(
      shouldSpeakLocally({ geminiOwnsSpeech: false, localVoiceEnabled: false }),
    ).toBe(false);
  });
});

describe("isNavigationAudioActive", () => {
  it("reads the mute flag while Gemini owns the channel", () => {
    expect(
      isNavigationAudioActive({
        geminiOwnsSpeech: true,
        geminiMuted: false,
        localVoiceEnabled: false,
      }),
    ).toBe(true);
    expect(
      isNavigationAudioActive({
        geminiOwnsSpeech: true,
        geminiMuted: true,
        localVoiceEnabled: true,
      }),
    ).toBe(false);
  });

  it("reads the local toggle otherwise, ignoring a muted background session", () => {
    expect(
      isNavigationAudioActive({
        geminiOwnsSpeech: false,
        geminiMuted: true,
        localVoiceEnabled: true,
      }),
    ).toBe(true);
  });
});

describe("resolveNavigationAudioToggle", () => {
  it("drives the Gemini mute while it owns the channel", () => {
    expect(
      resolveNavigationAudioToggle({
        geminiOwnsSpeech: true,
        geminiMuted: false,
        localVoiceEnabled: false,
      }),
    ).toEqual({ target: "gemini", nextActive: false });
    expect(
      resolveNavigationAudioToggle({
        geminiOwnsSpeech: true,
        geminiMuted: true,
        localVoiceEnabled: false,
      }),
    ).toEqual({ target: "gemini", nextActive: true });
  });

  it("drives the local toggle otherwise, leaving the mute untouched", () => {
    expect(
      resolveNavigationAudioToggle({
        geminiOwnsSpeech: false,
        geminiMuted: true,
        localVoiceEnabled: false,
      }),
    ).toEqual({ target: "local", nextActive: true });
  });
});

/**
 * The speaker button as both surfaces run it: resolve against live store
 * state, then apply the result through the real store actions.
 */
function pressSpeakerButton(): boolean {
  const nav = useNavStore.getState();
  const voice = useVoiceStore.getState();
  const { target, nextActive } = resolveNavigationAudioToggle({
    geminiOwnsSpeech: geminiOwnsNavigationSpeech(
      nav.navigationSource,
      voice.status.status,
    ),
    geminiMuted: voice.isMuted,
    localVoiceEnabled: nav.voiceEnabled,
  });
  if (target === "gemini") voice.toggleMute();
  else nav.setVoiceEnabled(nextActive);
  return nextActive;
}

describe("the speaker button against the real stores", () => {
  const controllerSetMuted = vi.fn();

  beforeEach(() => {
    controllerSetMuted.mockClear();
    useNavStore.getState().reset();
    useVoiceStore.setState({ status: { status: "idle" }, isMuted: false });
    useVoiceStore.getState().bindSessionActions({
      start: vi.fn(),
      end: vi.fn(),
      resumePlayback: vi.fn(),
      setMuted: controllerSetMuted,
    });
  });

  it("mutes Gemini during voice navigation without touching the local toggle", () => {
    useNavStore.setState({ navigationSource: "voice", voiceEnabled: true });
    useVoiceStore.setState({ status: { status: "listening" } });

    expect(pressSpeakerButton()).toBe(false);
    expect(useVoiceStore.getState().isMuted).toBe(true);
    expect(controllerSetMuted).toHaveBeenLastCalledWith(true);
    expect(useNavStore.getState().voiceEnabled).toBe(true);

    expect(pressSpeakerButton()).toBe(true);
    expect(useVoiceStore.getState().isMuted).toBe(false);
    expect(controllerSetMuted).toHaveBeenLastCalledWith(false);
  });

  it("keeps working for a local navigation while a voice session is live", () => {
    useNavStore.setState({ navigationSource: "local", voiceEnabled: true });
    useVoiceStore.setState({ status: { status: "listening" } });

    expect(pressSpeakerButton()).toBe(false);
    expect(useNavStore.getState().voiceEnabled).toBe(false);
    expect(useVoiceStore.getState().isMuted).toBe(false);
    expect(controllerSetMuted).not.toHaveBeenCalled();
  });

  it("falls back to the local toggle while a voice navigation is reconnecting", () => {
    useNavStore.setState({ navigationSource: "voice", voiceEnabled: false });
    useVoiceStore.setState({ status: { status: "reconnecting" } });

    expect(pressSpeakerButton()).toBe(true);
    expect(useNavStore.getState().voiceEnabled).toBe(true);
    expect(useVoiceStore.getState().isMuted).toBe(false);
  });

  it("drops a stale mute when the session reaches a terminal status", () => {
    useNavStore.setState({ navigationSource: "voice" });
    useVoiceStore.setState({ status: { status: "listening" } });
    pressSpeakerButton();
    expect(useVoiceStore.getState().isMuted).toBe(true);

    useVoiceStore.getState().setStatus({ status: "ended" });
    expect(useVoiceStore.getState().isMuted).toBe(false);
  });
});
