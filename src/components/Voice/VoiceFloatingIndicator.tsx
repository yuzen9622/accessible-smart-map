"use client";

import { Mic, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import useReducedMotion from "@/hook/useReducedMotion";
import { useAppTranslation } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { recordingDotPresentation } from "@/lib/voice/audioLevel";
import type { VoiceStatus, VoiceStatusName } from "@/lib/voice/voiceSession";
import useMapStore from "@/stores/useMapStore";
import useVoiceStore, { type VoiceViewMode } from "@/stores/useVoiceStore";

/**
 * Single centralized definition of "the voice session is active" (plan
 * §5.6 privacy invariant). Both `VoiceFloatingIndicator` (this file) and
 * `AIChatBot`'s panel-vs-text decision import this exact function so the
 * two surfaces can never disagree about whether a session is running.
 */
export function isVoiceSessionActive(status: VoiceStatusName): boolean {
  return status !== "idle" && status !== "ended";
}

/**
 * Plan §4 VoiceFloatingIndicator row: the pill must show whenever a
 * session is active AND the voice view isn't already on screen inside the
 * chat panel (panel closed, or panel open but showing the text-chat
 * surface instead of `VoiceModeView`). This is the single selector that
 * decides pill visibility — nothing else in this component computes that
 * condition independently.
 */
export function shouldShowVoicePill(
  status: VoiceStatusName,
  chatOpen: boolean,
  viewMode: VoiceViewMode,
): boolean {
  return isVoiceSessionActive(status) && (!chatOpen || viewMode !== "panel");
}

/**
 * Shared status -> label mapping used by both this pill and
 * `VoiceModeView`. Close-code specific copy (needs-login / 4409 / 1011 /
 * live-session-ended / reconnecting) follows the task's acceptance
 * mapping.
 */
export function getVoiceStatusLabel(
  status: VoiceStatus,
  t: (key: string, fallback: string) => string,
): string {
  switch (status.status) {
    case "idle":
      return t("chatbot.voice.statusIdle", "語音待命中");
    case "connecting":
      return t("chatbot.voice.statusConnecting", "連線中…");
    case "ready":
      return t("chatbot.voice.statusReady", "已連線");
    case "listening":
      return t("chatbot.voice.statusListening", "聆聽中…");
    case "model-speaking":
      return t("chatbot.voice.statusModelSpeaking", "回覆中…");
    case "assistant-ending":
      return t("chatbot.voice.statusAssistantEnding", "正在播放道別…");
    case "draining-playback":
      return t("chatbot.voice.statusDrainingPlayback", "正在播完道別…");
    case "reconnecting":
      return t("chatbot.voice.statusReconnecting", "連線中斷，重連中");
    case "playback-blocked":
      return t("chatbot.voice.statusPlaybackBlocked", "播放已暫停");
    case "needs-login":
      return t("chatbot.voice.statusNeedsLogin", "請重新登入");
    case "ended":
      return t("chatbot.voice.statusEnded", "對話已結束");
    case "error":
      if (status.code === 4409) {
        return t("chatbot.voice.errorConflict", "已在其他裝置開啟語音對話");
      }
      if (status.code === "LIVE_SESSION_ENDED") {
        return t("chatbot.voice.errorSessionEnded", "對話已逾時，請重新開始");
      }
      if (status.code === 1011) {
        return t("chatbot.voice.errorServer", "語音暫時無法使用");
      }
      if (status.code === "MIC_UNAVAILABLE") {
        return t("chatbot.voice.errorMic", "無法使用麥克風");
      }
      return t("chatbot.voice.errorGeneric", "發生錯誤，請稍後再試");
    default:
      return t("chatbot.voice.statusIdle", "語音待命中");
  }
}

/**
 * Persistent, always-checked recording indicator (plan §5.6 rev16 privacy
 * core). Rendered unconditionally by `VoiceSessionHost`; returns `null`
 * whenever `VoiceModeView` inside the chat panel already provides the
 * required visible indicator + one-tap end control, so the two are never
 * both hidden and never both shown at once.
 */
export default function VoiceFloatingIndicator() {
  const { t } = useAppTranslation();
  const status = useVoiceStore((s) => s.status);
  const viewMode = useVoiceStore((s) => s.viewMode);
  const micLevel = useVoiceStore((s) => s.micLevel);
  const setViewMode = useVoiceStore((s) => s.setViewMode);
  const setStatus = useVoiceStore((s) => s.setStatus);
  const endSession = useVoiceStore((s) => s.endSession);
  const chatOpen = useMapStore((s) => s.chatOpen);
  const isNavigating = useMapStore((s) => s.isNavigating);
  const setChatOpen = useMapStore((s) => s.setChatOpen);
  const reducedMotion = useReducedMotion();

  if (!shouldShowVoicePill(status.status, chatOpen, viewMode)) return null;

  const isTerminal =
    status.status === "needs-login" || status.status === "error";
  const label = getVoiceStatusLabel(status, t);
  const dot = recordingDotPresentation(micLevel, status.status, reducedMotion);

  const handleExpand = () => {
    setViewMode("panel");
    setChatOpen(true);
  };

  const handleEnd = () => {
    if (isTerminal) {
      // Nothing left for the controller to tear down in these terminal
      // states (mic/playback are already released) — this is a pure UI
      // dismissal back to idle, the "一鍵結束" control for a state the
      // controller itself considers already-ended.
      setStatus({ status: "idle" });
    } else {
      endSession();
    }
  };

  return (
    // Fixed above map controls. During navigation it moves away from the
    // full-width top instruction banner while retaining the privacy-critical
    // recording indicator and one-tap end control.
    <div
      className={cn(
        "fixed z-50 flex justify-center px-2",
        isNavigating
          ? "right-2 bottom-[92px]"
          : "top-3 left-1/2 -translate-x-1/2",
      )}
      aria-live="polite"
    >
      <div className="flex items-center gap-1 rounded-full bg-card/95 backdrop-blur-sm border border-border/60 shadow-lg pl-3 pr-1.5 py-1.5 text-xs font-medium text-foreground">
        <button
          type="button"
          onClick={handleExpand}
          className="flex items-center gap-2"
          aria-label={t("chatbot.voice.pillExpand", "展開語音對話")}
        >
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span
              className={cn(
                "relative inline-flex h-2.5 w-2.5 rounded-full transition-transform duration-100",
                isTerminal ? "bg-muted-foreground" : "bg-red-500",
              )}
              style={{ transform: `scale(${dot.scale})` }}
            />
          </span>
          <Mic className="h-3.5 w-3.5 shrink-0" />
          <span className="max-w-[40vw] truncate">{label}</span>
        </button>
        <Button
          type="button"
          onClick={handleEnd}
          disabled={
            status.status === "assistant-ending" ||
            status.status === "draining-playback"
          }
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0 rounded-full shrink-0"
          aria-label={t("chatbot.voice.endSession", "結束語音對話")}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
