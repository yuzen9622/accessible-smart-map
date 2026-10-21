/**
 * Pure closure module carrying every piece of wiring logic between
 * `useVoiceSession` and `VoiceSessionController` (plan
 * `memory/reviews/plans/a1e4a3b4026e7400.md` §3.3, rev3 round2-F1): the
 * transcript aggregator state, the previously-seen status (for turn-boundary
 * sealing), and the mic-level zeroing rule. `useVoiceSession` is reduced to
 * a thin `useState`/`useEffect` shell that constructs one instance via a
 * stable ref and forwards controller callbacks straight into it.
 */

import { executeAction } from "@/lib/ai/actionExecutor";
import { type ToolSummary, toolSummary } from "@/lib/ai/routeConversation";
import { mapToolToActions } from "@/lib/ai/toolActionMapper";
import { isMicActiveStatus, wrapFrameHandler } from "./audioLevel";
import {
  type AggEntry,
  type AggState,
  appendFragment,
  applyCorrection,
  applyStatusTransition,
  emptyAggState,
  sealRole,
  type TranscriptCorrection,
  type TranscriptFragment,
} from "./transcriptAggregator";
import type {
  VoiceStatus,
  VoiceStatusName,
  VoiceToolEvent,
} from "./voiceSession";
import {
  isUserVisibleVoiceTool,
  toolResultFailure,
  type VoiceToolActivity,
} from "./voiceTools";

export interface BindingSinks {
  /** Bind to the hook's `setTranscripts` (React state). */
  publishTranscripts(entries: AggEntry[]): void;
  /** Bind to the hook's `setStatusState` (and its `statusRef` update). */
  publishStatus(status: VoiceStatus): void;
  /** Bind to the hook's `setActiveTool`. */
  publishTool(event: VoiceToolEvent | null): void;
  publishToolActivities?(activities: VoiceToolActivity[]): void;
  /** Bind to `useVoiceStore.getState().setMicLevel`. */
  setMicLevel(level: number): void;
  persistTurn?(
    entries: AggEntry[],
    summaries: ToolSummary[],
  ): ReadonlyMap<number, string> | undefined;
  correctPersistedMessage?(messageId: string, text: string): void;
  clearPersistedMappings?(): void;
}

export interface VoiceBindings {
  onTranscript(transcript: TranscriptFragment): void;
  onTranscriptCorrection(correction: TranscriptCorrection): void;
  onTurnComplete(): void;
  onInterrupted(): void;
  onStatusChange(status: VoiceStatus): void;
  onToolEvent(event: VoiceToolEvent): void;
  /** = `wrapFrameHandler(forward, <gated setMicLevel>)`. */
  wrapCaptureFrame(
    forward: (frame: ArrayBuffer) => void,
  ): (frame: ArrayBuffer) => void;
  /**
   * Mirrors the controller's mute flag. Muting discards the microphone
   * uplink, so the recording dot must stop reacting to input too — otherwise
   * the UI keeps showing a live mic that is no longer being heard.
   */
  setMuted(muted: boolean): void;
  /** `startSession` calls this instead of clearing transcripts itself. */
  reset(): void;
  /** Unmount cleanup: zeroes the mic level. */
  dispose(): void;
}

export function createVoiceBindings(sinks: BindingSinks): VoiceBindings {
  let agg: AggState = emptyAggState();
  let currentStatus: VoiceStatusName = "idle";
  let muted = false;
  let summaries: ToolSummary[] = [];
  let persisted = 0;
  const utteranceMessages = new Map<string, string>();
  let activities: VoiceToolActivity[] = [];
  let nextToolId = 0;

  function settlePendingTools(): void {
    activities = activities.map((activity) =>
      activity.state === "pending"
        ? { ...activity, state: "cancelled" }
        : activity,
    );
    sinks.publishToolActivities?.(activities);
    sinks.publishTool(null);
  }

  function onTranscript(transcript: TranscriptFragment): void {
    agg = appendFragment(agg, transcript);
    sinks.publishTranscripts(agg.entries);
  }

  function onTranscriptCorrection(correction: TranscriptCorrection): void {
    agg = applyCorrection(agg, correction);
    const messageId = utteranceMessages.get(correction.utteranceId);
    const entry = agg.entries.find(
      (item) =>
        item.role === "user" && item.utteranceId === correction.utteranceId,
    );
    if (messageId && entry)
      sinks.correctPersistedMessage?.(messageId, entry.text);
    sinks.publishTranscripts(agg.entries);
  }

  function onTurnComplete(): void {
    settlePendingTools();
    agg = sealRole(agg, "model");
    sinks.publishTranscripts(agg.entries);
    const entries = agg.entries.slice(persisted);
    const ids = sinks.persistTurn?.(entries, summaries);
    if (ids)
      for (const entry of entries) {
        const messageId = ids.get(entry.id);
        if (entry.role === "user" && entry.utteranceId && messageId)
          utteranceMessages.set(entry.utteranceId, messageId);
      }
    persisted = agg.entries.length;
    summaries = [];
  }

  function onInterrupted(): void {
    settlePendingTools();
    agg = sealRole(agg, "model");
    agg = sealRole(agg, "user");
    sinks.publishTranscripts(agg.entries);
  }

  function onStatusChange(status: VoiceStatus): void {
    agg = applyStatusTransition(agg, currentStatus, status.status);
    if (
      [
        "reconnecting",
        "draining-playback",
        "ended",
        "error",
        "needs-login",
      ].includes(status.status)
    ) {
      settlePendingTools();
      utteranceMessages.clear();
      sinks.clearPersistedMappings?.();
      // A rebuilt transport may reuse u1. Keep the displayed history, not its wire identity.
      agg = {
        ...agg,
        entries: agg.entries.map((entry) => ({
          ...entry,
          utteranceId: undefined,
          sealed: true,
        })),
      };
    }
    sinks.publishTranscripts(agg.entries);
    sinks.publishStatus(status);
    if (!isMicActiveStatus(status.status)) {
      sinks.setMicLevel(0);
    }
    currentStatus = status.status;
  }

  function onToolEvent(event: VoiceToolEvent): void {
    if (!isUserVisibleVoiceTool(event.name)) return;
    sinks.publishTool(event);

    const existing = event.callId
      ? activities.findIndex(
          (activity) => activity.event.callId === event.callId,
        )
      : -1;
    const activity: VoiceToolActivity = {
      id: existing >= 0 ? activities[existing].id : `tool-${nextToolId++}`,
      event,
      state:
        event.type === "call"
          ? "pending"
          : toolResultFailure(event)
            ? "failed"
            : "done",
    };
    activities =
      existing >= 0
        ? activities.map((item, index) =>
            index === existing ? activity : item,
          )
        : [...activities, activity];
    sinks.publishToolActivities?.(activities);

    if (
      event.type === "result" &&
      event.result != null &&
      !toolResultFailure(event)
    ) {
      const summary = toolSummary(event.name, event.summary);
      if (summary && summaries.length < 8) summaries.push(summary);
      const actions = mapToolToActions(event.name, event.result, event.args);
      for (const action of actions) {
        if (action.type === "close-chat") continue;
        executeAction(action);
      }
    }
  }

  function wrapCaptureFrame(
    forward: (frame: ArrayBuffer) => void,
  ): (frame: ArrayBuffer) => void {
    return wrapFrameHandler(forward, (level) => {
      // Reviewer round-3 non-blocking suggestion: a capture frame can
      // arrive after the status already left a mic-active state (capture
      // isn't stopped synchronously with every transition, e.g.
      // playback-blocked). Forward the frame either way, but don't let a
      // late frame repopulate `micLevel` once `onStatusChange` has already
      // zeroed it for a non-active status.
      if (muted || !isMicActiveStatus(currentStatus)) return;
      sinks.setMicLevel(level);
    });
  }

  function setMuted(nextMuted: boolean): void {
    muted = nextMuted;
    if (muted) sinks.setMicLevel(0);
  }

  function reset(): void {
    agg = emptyAggState();
    activities = [];
    nextToolId = 0;
    sinks.publishTool(null);
    sinks.publishToolActivities?.([]);
    utteranceMessages.clear();
    sinks.clearPersistedMappings?.();
    summaries = [];
    persisted = 0;
    currentStatus = "idle";
    muted = false;
    sinks.publishTranscripts([]);
  }

  function dispose(): void {
    // UI unmount is not a transport close: an assistant farewell may still drain.
    // onStatusChange owns mapping cleanup at the actual disconnect/terminal boundary.
    sinks.setMicLevel(0);
  }

  return {
    onTranscript,
    onTranscriptCorrection,
    onTurnComplete,
    onInterrupted,
    onStatusChange,
    onToolEvent,
    wrapCaptureFrame,
    setMuted,
    reset,
    dispose,
  };
}
