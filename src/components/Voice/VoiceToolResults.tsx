"use client";

import ToolResultsBox from "@/components/ai/ToolResultsBox";
import { useAppTranslation } from "@/i18n/client";
import { getToolResultGroup } from "@/lib/toolResultCards";
import {
  toolResultFailure,
  type VoiceToolActivity,
} from "@/lib/voice/voiceTools";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function userText(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim();
  if (/^[{[]/.test(text) || /\b[A-Z]+(?:_[A-Z]+)+\b/.test(text)) return null;
  return text;
}

function safeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function SemanticResult({
  name,
  result,
}: {
  name: string;
  result: Record<string, unknown>;
}) {
  const { t } = useAppTranslation();
  if (name === "webSearch") {
    const answer = userText(result.answer);
    const sources = Array.isArray(result.sources) ? result.sources : [];
    return (
      <div className="space-y-2 text-sm min-w-0">
        {answer && <p className="whitespace-pre-wrap break-words">{answer}</p>}
        {sources.map((source) => {
          const data = record(source);
          const url = safeUrl(data.url);
          return url ? (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-primary underline break-words"
            >
              {userText(data.title) || url}
            </a>
          ) : null;
        })}
        {!answer && !sources.some((source) => safeUrl(record(source).url)) && (
          <p className="text-muted-foreground">
            {t("chatbot.voice.noData", "無資料")}
          </p>
        )}
      </div>
    );
  }
  if (name === "searchAccessibilityGuide") {
    const guides = Array.isArray(result.results) ? result.results : [];
    return guides.length ? (
      <div className="space-y-3 text-sm min-w-0">
        {guides.map((guide) => {
          const data = record(guide);
          const url = safeUrl(data.source);
          return (
            <article
              key={`${String(data.title)}-${String(data.content)}-${String(data.source)}`}
              className="space-y-1"
            >
              {userText(data.title) && (
                <h3 className="font-medium">{userText(data.title)}</h3>
              )}
              {userText(data.content) && (
                <p className="whitespace-pre-wrap break-words">
                  {userText(data.content)}
                </p>
              )}
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline break-words"
                >
                  {t("chatbot.voice.source", "參考來源")}
                </a>
              ) : userText(data.source) &&
                !String(data.source).includes(":") ? (
                <p className="text-xs text-muted-foreground">
                  {userText(data.source)}
                </p>
              ) : null}
            </article>
          );
        })}
      </div>
    ) : (
      <p className="text-sm text-muted-foreground">
        {t("chatbot.voice.noData", "無資料")}
      </p>
    );
  }
  return null;
}

export default function VoiceToolResults({
  activities,
}: {
  activities: VoiceToolActivity[];
}) {
  const { t } = useAppTranslation();
  const visible = activities.filter(
    ({ event }) =>
      !["endVoiceSession", "getActiveNavigationContext"].includes(event.name),
  );
  const isCancelled = ({ state, event }: VoiceToolActivity) => {
    const data = record(event.result);
    return (
      state === "cancelled" ||
      data.reason === "STALE_SELECTION" ||
      data.code === "STALE_SELECTION"
    );
  };
  const successful = visible.filter(
    (activity) =>
      activity.state === "done" &&
      !isCancelled(activity) &&
      !toolResultFailure(activity.event),
  );

  return (
    <div className="min-w-0 space-y-3">
      {visible.map((activity) => {
        const { id, state, event } = activity;
        const result = record(event.result);
        if (isCancelled(activity))
          return (
            <p key={id} className="text-xs text-muted-foreground">
              {t("chatbot.voice.toolCancelled", "已取消")}
            </p>
          );
        const failure = toolResultFailure(event);
        if (state === "failed" || failure)
          return (
            <p key={id} className="text-sm text-destructive">
              {t("chatbot.voice.toolFailed", "查詢失敗")}：
              {userText(failure) ||
                t("chatbot.voice.retry", "暫時無法完成，請稍後再試。")}
            </p>
          );
        if (state === "pending")
          return (
            <p
              key={id}
              role="status"
              className="text-xs text-muted-foreground motion-safe:animate-pulse"
            >
              {t("chatbot.voice.toolQuerying", "查詢中…")}
            </p>
          );
        if (state !== "done") return null;
        if (["webSearch", "searchAccessibilityGuide"].includes(event.name))
          return <SemanticResult key={id} name={event.name} result={result} />;
        if (event.name === "proposeNavigationCandidate")
          return (
            <p key={id} className="text-sm text-muted-foreground">
              {t(
                "chatbot.voice.routeProposalOnly",
                "路線比較提案，尚未切換路線",
              )}
            </p>
          );
        if (event.name === "confirmNavigationCandidateSwitch")
          return (
            <p key={id} className="text-sm">
              {result.status === "adopted"
                ? t("chatbot.voice.routeSwitched", "已切換路線")
                : t("chatbot.voice.routeSwitchPending", "路線尚未確認切換")}
            </p>
          );
        if (
          [
            "startNavigation",
            "stopNavigation",
            "repeatNavStep",
            "saveMemory",
            "deleteMemory",
          ].includes(event.name)
        )
          return null;
        if (
          event.name === "planAccessibleRoute" &&
          Array.isArray(result.routes)
        )
          return (
            <p key={id} className="text-xs text-muted-foreground">
              {result.routes.length
                ? t("chatbot.voice.routesOnMap", "路線已顯示在地圖上")
                : t("chatbot.voice.noData", "無資料")}
            </p>
          );
        if (getToolResultGroup(event.name, event.result, t)?.items.length)
          return null;
        return (
          <p key={id} className="text-xs text-muted-foreground">
            {t("chatbot.voice.resultReady", "查詢完成，請參考助理說明。")}
          </p>
        );
      })}
      <ToolResultsBox
        activities={successful.map(({ event }) => ({
          name: event.name,
          result: event.result,
          status: "done",
        }))}
      />
    </div>
  );
}
