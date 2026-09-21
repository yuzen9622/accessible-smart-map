import { beforeEach, describe, expect, it, vi } from "vitest";
import useVoiceStore, { type VoiceTranscriptEntry } from "../useVoiceStore";

function resetStore() {
  useVoiceStore.setState({
    status: { status: "idle" },
    transcripts: [],
    activeTool: null,
    viewMode: "panel",
    micLevel: 0,
    isMuted: false,
    startSession: () => {},
    endSession: () => {},
    resumePlayback: () => {},
  });
}

describe("useVoiceStore", () => {
  beforeEach(() => {
    resetStore();
  });

  it("case 14a: setTranscripts mirrors entries including the sealed field", () => {
    const entries: VoiceTranscriptEntry[] = [
      { id: 0, role: "user", raw: "你好", text: "你好", sealed: true },
      { id: 1, role: "model", raw: "哈囉", text: "哈囉", sealed: false },
    ];
    useVoiceStore.getState().setTranscripts(entries);

    expect(useVoiceStore.getState().transcripts).toEqual(entries);
    expect(useVoiceStore.getState().transcripts[0].sealed).toBe(true);
    expect(useVoiceStore.getState().transcripts[1].sealed).toBe(false);
  });

  it("case 14b: setMicLevel reads and writes micLevel", () => {
    expect(useVoiceStore.getState().micLevel).toBe(0);
    useVoiceStore.getState().setMicLevel(0.42);
    expect(useVoiceStore.getState().micLevel).toBe(0.42);
  });

  it("case 14c: bindSessionActions binds real actions, callable afterward", () => {
    const start = vi.fn();
    const end = vi.fn();
    const resumePlayback = vi.fn();

    // Before binding, the default no-ops must not throw.
    expect(() => useVoiceStore.getState().startSession()).not.toThrow();

    useVoiceStore.getState().bindSessionActions({ start, end, resumePlayback });

    useVoiceStore.getState().startSession();
    useVoiceStore.getState().endSession();
    useVoiceStore.getState().resumePlayback();

    expect(start).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
    expect(resumePlayback).toHaveBeenCalledTimes(1);
  });

  it("case 14d: isMuted defaults to false, toggles, and binds setMuted", () => {
    const setMuted = vi.fn();
    expect(useVoiceStore.getState().isMuted).toBe(false);

    useVoiceStore.getState().bindSessionActions({
      start: () => {},
      end: () => {},
      resumePlayback: () => {},
      setMuted,
    });

    useVoiceStore.getState().toggleMute();
    expect(useVoiceStore.getState().isMuted).toBe(true);
    expect(setMuted).toHaveBeenCalledWith(true);

    useVoiceStore.getState().toggleMute();
    expect(useVoiceStore.getState().isMuted).toBe(false);
    expect(setMuted).toHaveBeenCalledWith(false);

    useVoiceStore.getState().setMuted(true);
    expect(useVoiceStore.getState().isMuted).toBe(true);
    expect(setMuted).toHaveBeenCalledWith(true);

    // Ending the session resets isMuted back to false
    useVoiceStore.getState().endSession();
    expect(useVoiceStore.getState().isMuted).toBe(false);
  });

  it("case 14e: setStatus resets isMuted on every terminal status", () => {
    // The controller drops its own mute flag on all four of these, so the
    // store's mirror has to follow or the speaker button reopens muted.
    for (const status of ["idle", "ended", "error", "needs-login"] as const) {
      useVoiceStore.getState().setMuted(true);
      expect(useVoiceStore.getState().isMuted).toBe(true);

      useVoiceStore.getState().setStatus({ status });
      expect(useVoiceStore.getState().isMuted).toBe(false);
      expect(useVoiceStore.getState().status.status).toBe(status);
    }
  });

  it("case 14f: setStatus keeps isMuted across non-terminal statuses", () => {
    for (const status of [
      "connecting",
      "ready",
      "listening",
      "model-speaking",
      "reconnecting",
      "playback-blocked",
    ] as const) {
      useVoiceStore.getState().setMuted(true);
      useVoiceStore.getState().setStatus({ status });
      expect(useVoiceStore.getState().isMuted).toBe(true);
    }
  });

  it("case 14g: startSession opens a fresh session unmuted", () => {
    const start = vi.fn();
    useVoiceStore
      .getState()
      .bindSessionActions({ start, end: () => {}, resumePlayback: () => {} });

    useVoiceStore.getState().setMuted(true);
    useVoiceStore.getState().startSession();

    expect(start).toHaveBeenCalledTimes(1);
    expect(useVoiceStore.getState().isMuted).toBe(false);
  });
});
