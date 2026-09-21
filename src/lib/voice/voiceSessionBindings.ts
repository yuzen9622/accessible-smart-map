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
import { mapToolToActions } from "@/lib/ai/toolActionMapper";
import type { LatLng } from "@/types";
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

export interface BindingSinks {
  /** Bind to the hook's `setTranscripts` (React state). */
  publishTranscripts(entries: AggEntry[]): void;
  /** Bind to the hook's `setStatusState` (and its `statusRef` update). */
  publishStatus(status: VoiceStatus): void;
  /** Bind to the hook's `setActiveTool`. */
  publishTool(event: VoiceToolEvent): void;
  /** Bind to `useVoiceStore.getState().setMicLevel`. */
  setMicLevel(level: number): void;
  /** Bind to the hook's `handleComputeRoute` caller (from `useComputeRoute`). */
  computeRoute(params: { origin: LatLng; destination: LatLng }): void;
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

  function onTranscript(transcript: TranscriptFragment): void {
    agg = appendFragment(agg, transcript);
    sinks.publishTranscripts(agg.entries);
  }

  function onTranscriptCorrection(correction: TranscriptCorrection): void {
    agg = applyCorrection(agg, correction);
    sinks.publishTranscripts(agg.entries);
  }

  function onTurnComplete(): void {
    agg = sealRole(agg, "model");
    sinks.publishTranscripts(agg.entries);
  }

  function onInterrupted(): void {
    agg = sealRole(agg, "model");
    agg = sealRole(agg, "user");
    sinks.publishTranscripts(agg.entries);
  }

  function onStatusChange(status: VoiceStatus): void {
    agg = applyStatusTransition(agg, currentStatus, status.status);
    sinks.publishTranscripts(agg.entries);
    sinks.publishStatus(status);
    if (!isMicActiveStatus(status.status)) {
      sinks.setMicLevel(0);
    }
    currentStatus = status.status;
  }

  function onToolEvent(event: VoiceToolEvent): void {
    sinks.publishTool(event);

    if (event.type === "result" && event.result != null) {
      const actions = mapToolToActions(event.name, event.result, event.args);
      for (const action of actions) {
        if (action.type === "close-chat") continue;
        if (action.type === "compute-route") {
          sinks.computeRoute({
            origin: action.origin,
            destination: action.destination,
          });
          continue;
        }
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
    currentStatus = "idle";
    muted = false;
    sinks.publishTranscripts([]);
  }

  function dispose(): void {
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
