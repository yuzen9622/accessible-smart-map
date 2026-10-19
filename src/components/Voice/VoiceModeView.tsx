"use client";

import { XIcon } from "@animateicons/react/lucide";
import { Keyboard } from "lucide-react";
import { useEffect, useRef } from "react";
import { ThinkingOrb } from "thinking-orbs";
import { Button } from "@/components/ui/button";
import useReducedMotion from "@/hook/useReducedMotion";
import { useAppTranslation } from "@/i18n/client";
import { toolToOrbState } from "@/lib/ai/orbState";
import { cn } from "@/lib/utils";
import { recordingDotPresentation } from "@/lib/voice/audioLevel";
import useVoiceStore from "@/stores/useVoiceStore";
import {
  getVoiceStatusLabel,
  isVoiceSessionActive,
} from "./VoiceFloatingIndicator";

/**
 * Voice mode view rendered as `AIChatBot`'s panel body while a voice
 * session is in `viewMode === "panel"` (plan §4 VoiceModeView row):
 * connection status, transcripts (`aria-live="polite"`), tool activity,
 * a "tap to resume playback" affordance, an end-session button, and a
 * "back to text" button that switches the panel back to the ordinary text
 * chat without ending the session (it keeps running, surfaced instead by
 * `VoiceFloatingIndicator`).
 */
export default function VoiceModeView() {
  const { t } = useAppTranslation();
  const status = useVoiceStore((s) => s.status);
  const transcripts = useVoiceStore((s) => s.transcripts);
  const activeTool = useVoiceStore((s) => s.activeTool);
  const micLevel = useVoiceStore((s) => s.micLevel);
  const endSession = useVoiceStore((s) => s.endSession);
  const setStatus = useVoiceStore((s) => s.setStatus);
  const resumePlayback = useVoiceStore((s) => s.resumePlayback);
  const setViewMode = useVoiceStore((s) => s.setViewMode);
  const reducedMotion = useReducedMotion();

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (transcripts.length > 0 || activeTool) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [transcripts, activeTool]);

  const label = getVoiceStatusLabel(status, t);
  const active = isVoiceSessionActive(status.status);
  const listening = status.status === "listening" || status.status === "ready";
  const ending =
    status.status === "assistant-ending" ||
    status.status === "draining-playback";
  const dot = recordingDotPresentation(micLevel, status.status, reducedMotion);

  return (
    <div className="h-full min-h-0 flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/40 text-xs shrink-0">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span
            className={cn(
              "relative inline-flex h-2.5 w-2.5 rounded-full transition-transform duration-100",
              active ? "bg-red-500" : "bg-muted-foreground",
            )}
            style={{ transform: `scale(${dot.scale})` }}
          />
        </span>
        <span className="font-medium text-foreground">{label}</span>
      </div>

      <div
        className="flex-1 overflow-auto px-4 py-3 space-y-3"
        aria-live="polite"
      >
        {transcripts.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-6">
            <ThinkingOrb
              state={
                listening
                  ? "listening"
                  : status.status === "model-speaking"
                    ? "composing"
                    : "working"
              }
              size={64}
              role="img"
              aria-label={
                listening
                  ? t("chatbot.voice.listeningHint", "請開始說話")
                  : ending
                    ? label
                    : t("chatbot.voice.connectingHint", "連線中，請稍候…")
              }
            />
            <p className="text-xs text-muted-foreground text-center">
              {listening
                ? t("chatbot.voice.listeningHint", "請開始說話")
                : ending
                  ? label
                  : t("chatbot.voice.connectingHint", "連線中，請稍候…")}
            </p>
          </div>
        )}

        {transcripts.map((entry) => (
          <div
            key={entry.id}
            className={cn(
              "flex flex-col gap-1",
              entry.role === "user" ? "items-end" : "items-start",
            )}
          >
            <span className="text-xs text-muted-foreground px-1">
              {entry.role === "user"
                ? t("chatbot.voice.transcriptUser", "你")
                : t("chatbot.voice.transcriptModel", "助理")}
            </span>
            <div
              className={cn(
                "max-w-[85%] w-fit px-3 py-2 rounded-2xl text-sm",
                entry.role === "user"
                  ? "bg-primary text-primary-foreground rounded-tr-sm"
                  : "bg-muted rounded-tl-sm shadow-sm border border-border/30",
              )}
            >
              {entry.text}
            </div>
          </div>
        ))}

        {activeTool && (
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground py-1.5 px-1">
            {activeTool.type === "call" ? (
              <>
                <ThinkingOrb
                  state={toolToOrbState(activeTool.name)}
                  size={20}
                  role="img"
                  aria-label={t("chatbot.voice.toolQuerying", "查詢中…")}
                  className="shrink-0"
                />
                <span className="animate-pulse">
                  {t("chatbot.voice.toolQuerying", "查詢中…")}（
                  {activeTool.name}）
                </span>
              </>
            ) : (
              <span>
                {t("chatbot.voice.toolDone", "完成")}（{activeTool.name}）
              </span>
            )}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {(status.status === "playback-blocked" ||
        (ending && status.code === "PLAYBACK_BLOCKED")) && (
        <div className="px-4 py-2 border-t bg-card shrink-0">
          <Button
            type="button"
            onClick={resumePlayback}
            size="sm"
            variant="outline"
            className="w-full"
          >
            {t("chatbot.voice.resumePlayback", "點擊以繼續播放")}
          </Button>
        </div>
      )}

      <div className="p-3 border-t bg-card flex items-center gap-2 shrink-0">
        <Button
          type="button"
          onClick={() => setViewMode("pill")}
          size="sm"
          variant="ghost"
          className="flex-1"
        >
          <Keyboard className="h-4 w-4 mr-1.5" />
          {t("chatbot.voice.backToText", "切回文字")}
        </Button>
        <Button
          type="button"
          onClick={() => {
            if (status.status === "needs-login" || status.status === "error") {
              setStatus({ status: "idle" });
            } else {
              endSession();
            }
          }}
          disabled={ending}
          size="sm"
          variant="destructive"
          className="flex-1"
        >
          <XIcon size={16} className="mr-1.5" />
          {t("chatbot.voice.endSession", "結束語音對話")}
        </Button>
      </div>
    </div>
  );
}
