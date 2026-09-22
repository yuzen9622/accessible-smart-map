"use client";

import {
  AccessibilityIcon,
  SearchIcon,
  SendIcon,
  TriangleAlertIcon,
} from "@animateicons/react/lucide";
import {
  Bus,
  ChevronDown,
  ChevronUp,
  Navigation,
  Square,
  SquareParking,
  Thermometer,
  Trash2,
  Wind,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { ChatBubble, ToolActivity } from "@/hook/useAIChat";
import useAIChat from "@/hook/useAIChat";
import useIsDesktop from "@/hook/useIsDesktop";
import useOpenAiResult from "@/hook/useOpenAiResult";
import { useAppTranslation } from "@/i18n/client";
import {
  buildTraceRows,
  describeThinking,
  shouldShowTrace,
} from "@/lib/ai/thinkingTrace";
import {
  getAggregatedToolResults,
  type ToolCardIcon,
  type ToolResultItem,
} from "@/lib/toolResultCards";
import { cn } from "@/lib/utils";
import useAuthStore from "@/stores/useAuthStore";
import useChatStore from "@/stores/useChatStore";
import useMapStore from "@/stores/useMapStore";
import useVoiceStore from "@/stores/useVoiceStore";
import ThinkingTrace from "./ai/ThinkingTrace";
import PlaceCard from "./shared/PlaceCard";
import StreamingMarkdown from "./shared/StreamingMarkdown";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { CardContent, CardFooter } from "./ui/card";
import { Input } from "./ui/input";
import { MicIcon } from "./ui/mic-icon";
import { ScrollArea } from "./ui/scroll-area";
import { isVoiceSessionActive } from "./Voice/VoiceFloatingIndicator";
import VoiceModeView from "./Voice/VoiceModeView";

const CARD_ICONS: Record<ToolCardIcon, React.ReactNode> = {
  search: <SearchIcon size={14} />,
  a11y: <AccessibilityIcon size={14} />,
  parking: <SquareParking className="h-3.5 w-3.5" />,
  bus: <Bus className="h-3.5 w-3.5" />,
  air: <Wind className="h-3.5 w-3.5" />,
  env: <Thermometer className="h-3.5 w-3.5" />,
  hazard: <TriangleAlertIcon size={14} />,
  nav: <Navigation className="h-3.5 w-3.5" />,
};

function ToolResultCard({
  item,
  onClick,
}: {
  item: ToolResultItem;
  onClick?: () => void;
}) {
  return (
    <PlaceCard
      title={item.title}
      subtitle={item.subtitle}
      badge={item.badge}
      onClick={onClick}
    />
  );
}

function ToolResultsBox({ activities }: { activities: ToolActivity[] }) {
  const { openAiResult, flyTo } = useOpenAiResult();
  const [activeTab, setActiveTab] = useState(0);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const groups = useMemo(
    () => getAggregatedToolResults(activities),
    [activities],
  );

  if (!groups.length) return null;

  const totalItems = groups.reduce((acc, g) => acc + g.items.length, 0);
  const safeActiveTab = Math.min(activeTab, groups.length - 1);
  const currentGroup = groups[safeActiveTab];

  const handleClick = (item: ToolResultItem) => {
    if (!item.position) return;
    if (item.target) {
      openAiResult({
        id: item.id,
        position: item.position,
        title: item.title,
        desc: item.subtitle,
        target: item.target,
      });
    } else {
      flyTo(item.position);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-1.5 mt-2 w-full max-w-[88vw] sm:max-w-[440px] rounded-2xl border border-border/50 bg-card/70 dark:bg-card/50 backdrop-blur-md p-2.5 shadow-2xs transition-all"
    >
      {/* 頂部 Header：摘要與折疊按鈕 */}
      <button
        type="button"
        aria-expanded={!isCollapsed}
        className="flex w-full items-center justify-between gap-2 px-1 cursor-pointer select-none text-left rounded-md hover:bg-muted/40 transition-colors"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            {CARD_ICONS[currentGroup.icon]}
          </span>
          <span className="text-xs font-semibold text-foreground truncate">
            {groups.length === 1 ? currentGroup.heading : "相關查詢結果"}
          </span>
          <Badge
            variant="secondary"
            className="text-[10px] px-1.5 py-0 h-4 font-normal text-muted-foreground"
          >
            共 {totalItems} 筆
          </Badge>
        </div>

        <span
          className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors px-1.5 py-0.5 rounded-md"
          aria-hidden="true"
        >
          <span>{isCollapsed ? "展開" : "收起"}</span>
          {isCollapsed ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronUp className="h-3.5 w-3.5" />
          )}
        </span>
      </button>

      {/* 展開後的內容 */}
      <AnimatePresence initial={false}>
        {!isCollapsed && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col gap-2 pt-0.5 overflow-hidden"
          >
            {/* 多 Group 分頁 Pills / Tabs */}
            {groups.length > 1 && (
              <div className="flex gap-1.5 overflow-x-auto pb-1 px-0.5 scrollbar-none snap-x">
                {groups.map((g, idx) => (
                  <button
                    key={`${g.heading}-${g.icon}`}
                    type="button"
                    onClick={() => setActiveTab(idx)}
                    className={cn(
                      "flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all shrink-0 snap-start",
                      safeActiveTab === idx
                        ? "bg-primary text-primary-foreground shadow-2xs font-semibold"
                        : "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <span className="shrink-0">{CARD_ICONS[g.icon]}</span>
                    <span>{g.heading}</span>
                    <span className="text-[10px] opacity-80">
                      ({g.items.length})
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Group 備註說明 */}
            {currentGroup.note && (
              <div className="text-[11px] text-muted-foreground px-1">
                {currentGroup.note}
              </div>
            )}

            {/* 橫向滑動卡片清單 */}
            <div className="flex gap-2.5 overflow-x-auto pb-1.5 pt-0.5 px-0.5 snap-x w-full [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:bg-muted-foreground/20 hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/40 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent">
              {currentGroup.items.map((item) => (
                <ToolResultCard
                  key={item.id}
                  item={item}
                  onClick={item.position ? () => handleClick(item) : undefined}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function MessageBubble({ message }: { message: ChatBubble }) {
  const isUser = message.role === "user";
  const activities = message.toolActivities ?? [];
  // 所有已完成的工具都嘗試渲染；ToolResultView 對無法渲染的工具回 null
  const doneActivities = activities.filter((a) => a.status === "done");

  // 標題文字、每一列的狀態與耗時都在 lib/ai/thinkingTrace 算好，這裡只決定
  // 要不要掛上去。trace 講「過程」，下方的 ToolResultsBox 講「結果」——兩者
  // 互補，trace 在思考結束後會自動收合成一行摘要，不會跟結果卡片打架。
  const header = describeThinking({
    activities,
    isStreaming: !!message.isStreaming,
    hasContent: !!message.content,
    thinkingMs: message.thinkingMs,
  });
  const showTrace = !isUser && shouldShowTrace({ activities, header });
  const traceRows = buildTraceRows(activities);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={cn(
        "flex flex-col gap-1.5 w-full",
        isUser ? "items-end" : "items-start",
      )}
    >
      {showTrace && <ThinkingTrace rows={traceRows} header={header} />}

      {message.content && (
        <div
          className={cn(
            "max-w-[85%] w-fit px-3 py-2 rounded-2xl text-sm",
            isUser
              ? "bg-primary text-primary-foreground rounded-tr-sm"
              : "bg-muted rounded-tl-sm shadow-sm border border-border/30",
          )}
        >
          <StreamingMarkdown
            content={message.content}
            streaming={!isUser && !!message.isStreaming}
          />
        </div>
      )}

      {/* Render done results only after streaming is finished, below the content */}
      {!message.isStreaming && !isUser && doneActivities.length > 0 && (
        <ToolResultsBox activities={doneActivities} />
      )}
    </motion.div>
  );
}

/**
 * AI 助理內容——不再是獨立浮動卡片，而是 BottomSheet 的其中一種面板內容
 * （桌面版側欄 / 手機版 Bottom Sheet 共用），由父層依 `chatOpen` 決定何時
 * 掛載。標題列與返回/關閉按鈕交給 BottomSheet 的共用 panel header 處理，
 * 這裡只負責訊息串、建議 chip 與輸入框。
 *
 * `BottomSheet` actually mounts *two* copies of this component at once — a
 * mobile one and a desktop one — and only toggles which is `inert`/hidden by
 * breakpoint, rather than conditionally rendering just one. `active` tells
 * this instance whether it's the one the user can actually see, so exactly
 * one of the two consumes `pendingAiQuery` on mount (see the effect below) —
 * without it, both instances' mount effects race for the same store value
 * and the message can land in the hidden copy.
 */
export default function AIChatBot({ active = true }: { active?: boolean }) {
  const { t } = useAppTranslation();
  const isDesktop = useIsDesktop();
  const setMobileSheetSnap = useMapStore((s) => s.setMobileSheetSnap);
  const { messages, handleSend, input, setInput, isLoading, stopStreaming } =
    useAIChat();

  const scrollRef = useRef<HTMLDivElement>(null);

  const voiceStatus = useVoiceStore((s) => s.status);
  const voiceViewMode = useVoiceStore((s) => s.viewMode);
  const setVoiceViewMode = useVoiceStore((s) => s.setViewMode);
  const startVoiceSession = useVoiceStore((s) => s.startSession);
  const voiceSessionActive = isVoiceSessionActive(voiceStatus.status);
  const showVoiceMode = voiceSessionActive && voiceViewMode === "panel";

  const handleMicClick = () => {
    if (!useAuthStore.getState().user) {
      toast.error(t("chatbot.voice.loginRequired", "請先登入才能使用語音對話"));
      return;
    }
    setVoiceViewMode("panel");
    startVoiceSession();
  };

  const recommendations = [
    t("chatbot.recommendation1", "附近無障礙設施"),
    t("chatbot.recommendation2", "目前位置到最近車站"),
    t("chatbot.recommendation3", "附近餐廳"),
  ];

  useEffect(() => {
    if (messages.length > 0) {
      scrollRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages.length]);

  // The unified home-screen input hands off a question-shaped query via the
  // store instead of calling `handleSend` directly: this component owns its
  // own `useAIChat()` instance (its own message history), so a query typed
  // before the panel exists has nowhere else to land. Gated on `active`
  // because both the mobile and desktop copies of this component mount at
  // once (see the doc comment above) — only the visible one may consume it.
  // The `pendingAiQuery` guard makes this safe to re-run whenever
  // `handleSend`'s identity changes — once consumed, the field is empty and
  // every later run no-ops.
  useEffect(() => {
    if (!active) return;
    const { pendingAiQuery, setPendingAiQuery } = useMapStore.getState();
    if (!pendingAiQuery) return;
    setPendingAiQuery("");
    handleSend(pendingAiQuery);
  }, [active, handleSend]);

  // "消失必須是使用者的決定，不是副作用" — the conversation now survives
  // collapse/reopen and reload, so this is the only way it ever goes away.
  // Re-seeds the greeting immediately (rather than leaving messages empty
  // for `useAIChat`'s mount-only effect to notice) since the panel is
  // already mounted and that effect won't re-fire.
  const handleClearConversation = () => {
    useChatStore.getState().clearAll([
      {
        role: "assistant",
        content: t(
          "assistFirstMessage",
          "你好！我是無障礙智慧地圖的 AI 助理，有什麼我能幫你的嗎？附近無障礙設施或者是問題回饋？請隨時提出！",
        ),
      },
    ]);
  };
  const hasConversation = messages.length > 1;

  const handleKeyPress = (e: React.KeyboardEvent) => {
    // !isComposing：避免中文輸入法選字時按 Enter 誤送出（與 PlanInput 一致）
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend(input);
    }
  };

  if (showVoiceMode) return <VoiceModeView />;

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex justify-end px-3 pt-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleClearConversation}
          aria-disabled={!hasConversation}
          className={cn(
            "h-11 gap-1.5 text-xs text-muted-foreground hover:text-destructive",
            !hasConversation && "opacity-50 pointer-events-none",
          )}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          {t("chatbot.clearConversation", "清除對話")}
        </Button>
      </div>
      {/* Radix ScrollArea's viewport wraps children in a `display: table`
          div (needed for its own auto-height logic), which makes a
          `w-full` child resolve against shrink-to-fit content width instead
          of the viewport — combined with the horizontal padding here, long
          message bubbles overflowed past the panel edge. Forcing that
          wrapper back to `display: block` fixes the width basis.
          `overflow-hidden` is required here (not just cosmetic): as a
          `flex-1` item this element's default flexbox `min-height` is
          `auto`, which resolves to its content height and defeats `flex-1`
          entirely unless `overflow` is non-`visible` — Radix's Root sets no
          `overflow` of its own, so without this the panel grows to fit all
          messages instead of scrolling internally. */}
      <ScrollArea className="flex-1 overflow-hidden pt-1 [&>[data-radix-scroll-area-viewport]>div]:!block">
        <CardContent className="min-h-full space-y-3" ref={scrollRef}>
          {messages.map((m, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: chat messages are an append-only stream without persistent IDs
            <Fragment key={i}>
              <MessageBubble message={m} />
            </Fragment>
          ))}
          {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
            <ThinkingTrace
              rows={[]}
              header={{
                working: true,
                label: t("chatbot.thinking", "思考中…"),
              }}
            />
          )}
        </CardContent>
      </ScrollArea>

      <div className="sticky bg-gradient-to-t from-card to-transparent bottom-0 py-2">
        <div className="flex gap-2 px-4 overflow-x-auto justify-center">
          {recommendations.map((rec) => (
            <Badge
              onClick={() => handleSend(rec)}
              key={rec}
              className="px-3 py-1.5 rounded-full cursor-pointer whitespace-nowrap text-xs transition-colors hover:bg-primary/80"
              asChild
            >
              <button type="button">{rec}</button>
            </Badge>
          ))}
        </div>
      </div>

      <CardFooter className="p-3 border-t bg-card flex flex-col gap-2">
        <div className="flex w-full items-center gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => {
              if (!isDesktop) {
                setMobileSheetSnap("full");
              }
            }}
            onKeyDown={handleKeyPress}
            placeholder={t("chatbot.placeholder", "輸入問題...")}
            className="flex-1"
            disabled={isLoading}
          />
          <Button
            onClick={handleMicClick}
            type="button"
            size="icon"
            variant={voiceSessionActive ? "default" : "outline"}
            aria-pressed={voiceSessionActive}
            aria-label={t("chatbot.voice.micLabel", "語音對話")}
            className="shrink-0"
          >
            <MicIcon size={16} />
          </Button>
          {isLoading ? (
            <Button
              onClick={stopStreaming}
              size="icon"
              variant="outline"
              className="shrink-0"
            >
              <Square className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              onClick={() => handleSend(input)}
              size="icon"
              disabled={!input.trim()}
              className="shrink-0"
            >
              <SendIcon size={16} />
              <span className="sr-only">{t("chatbot.send", "傳送")}</span>
            </Button>
          )}
        </div>
      </CardFooter>
    </div>
  );
}
