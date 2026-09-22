import { useCallback, useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppTranslation } from "@/i18n/client";
import { executeAction } from "@/lib/ai/actionExecutor";
import { mapToolToActions } from "@/lib/ai/toolActionMapper";
import { streamChatWithAgent } from "@/lib/api/ai";
import useAuthStore from "@/stores/useAuthStore";
import useChatStore, {
  type ChatBubble,
  type ToolActivity,
} from "@/stores/useChatStore";
import useMapStore from "@/stores/useMapStore";
import useOnboardingStore from "@/stores/useOnboardingStore";
import { describeProfileForAssistant } from "@/types/a11yProfile";
import useComputeRoute from "./useComputeRoute";

export type { ChatBubble, ToolActivity };

export default function useAIChat() {
  const { t } = useAppTranslation();
  const { userConfig } = useAuthStore(
    useShallow((s) => ({ userConfig: s.userConfig })),
  );

  // Shared across every mount of the AI panel (mobile/desktop copies, and
  // any remount from the panel being collapsed/closed then reopened) so a
  // panel toggle no longer wipes the conversation back to the greeting.
  const {
    messages,
    setMessages,
    input,
    setInput,
    isLoading,
    setIsLoading,
    hydrated,
  } = useChatStore(
    useShallow((s) => ({
      messages: s.messages,
      setMessages: s.setMessages,
      input: s.input,
      setInput: s.setInput,
      isLoading: s.isLoading,
      setIsLoading: s.setIsLoading,
      hydrated: s.hydrated,
    })),
  );

  // Seed the greeting once sessionStorage has been read (gated on
  // `hydrated`, not just mount). `AIChatBot` now mounts immediately with the
  // page instead of lazily on first open (Phase 1.4 — the panel toggle no
  // longer unmounts it), so without this gate its mount effect can win the
  // race against `ClientLayout`'s storage-restore effect (React fires a
  // deeply-nested child's effects before an ancestor's, in the same commit)
  // and seed a fresh greeting *before* the restored conversation loads —
  // which then overwrites the sessionStorage snapshot with just that
  // greeting. Waiting for `hydrated` defers this to the next commit, after
  // the restore has actually landed.
  useEffect(() => {
    if (!hydrated) return;
    if (useChatStore.getState().messages.length === 0) {
      setMessages([
        {
          role: "assistant",
          content: t(
            "assistFirstMessage",
            "你好！我是無障礙智慧地圖的 AI 助理，有什麼我能幫你的嗎？附近無障礙設施或者是問題回饋？請隨時提出！",
          ),
        },
      ]);
    }
  }, [hydrated, setMessages, t]);

  const {
    userLocation,
    chatOpen: open,
    setChatOpen: setOpen,
  } = useMapStore(
    useShallow((s) => ({
      userLocation: s.userLocation,
      chatOpen: s.chatOpen,
      setChatOpen: s.setChatOpen,
    })),
  );
  const { handleComputeRoute } = useComputeRoute();
  const abortRef = useRef<AbortController | null>(null);

  const markDone = useCallback(
    (activities: ToolActivity[] | undefined) =>
      activities?.map((a) => ({ ...a, status: "done" as const })),
    [],
  );

  const handleSend = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isLoading) return;

      setInput("");
      setIsLoading(true);
      executeAction({ type: "clear-markers" });

      // Re-derived on every send (not just at mount) so a profile edited mid
      // session — e.g. via settings — takes effect on the next message without
      // needing the chat to remount.
      const profileNote = describeProfileForAssistant(
        useOnboardingStore.getState().profile,
        userConfig.language === "en" ? "en" : "zh-TW",
      );
      const baseSystemPrompt = `你是「無障礙智慧地圖」的 AI 助理，專門協助使用者查詢無障礙相關資訊、路線規劃、附近設施。請使用${userConfig.language === "en" ? "英文" : "繁體中文"}回答。`;
      // §6.1 of the UX audit's global a11y filter — re-read live (not
      // subscribed) for the same reason `profileNote` is re-derived every
      // send: toggling it mid-conversation should affect the next message
      // without needing the chat to remount.
      const a11yFilterNote = useMapStore.getState().a11yFilterEnabled
        ? userConfig.language === "en"
          ? " The user has turned on the accessibility filter — only recommend places and routes that are wheelchair/step-free accessible."
          : "使用者已開啟無障礙篩選，請只推薦無障礙（輪椅可通行、無階梯）的地點與路線。"
        : "";
      // Go through `setChatHistory` (immutable, writes sessionStorage) rather
      // than mutating the array in place — direct mutation bypassed the
      // store's persistence write and left a "safe only because nobody else
      // touches this array" assumption baked in.
      const { setChatHistory } = useChatStore.getState();
      setChatHistory((prev) => {
        const next = [...prev];
        next[0] = {
          role: "system",
          content: `${baseSystemPrompt}${profileNote ?? ""}${a11yFilterNote}`,
        };
        return next;
      });

      const userBubble: ChatBubble = { role: "user", content: trimmed };
      setMessages((prev) => [...prev, userBubble]);

      setChatHistory((prev) => [...prev, { role: "user", content: trimmed }]);
      // Read back the now-current history for the request payload — zustand's
      // `set` is synchronous, so this reflects both writes above.
      const chatHistory = useChatStore.getState().chatHistory;

      const assistantBubble: ChatBubble = {
        role: "assistant",
        content: "",
        isStreaming: true,
        toolActivities: [],
      };
      setMessages((prev) => [...prev, assistantBubble]);

      const controller = new AbortController();
      abortRef.current = controller;

      // 從 assistant bubble 建立算到 finally，含被 abort 的情況——使用者按停止
      // 之後仍看得到「已完成 2 項查詢 · 3.1 秒」，而不是時間憑空消失。
      const startedAt = Date.now();
      let fullText = "";

      try {
        await streamChatWithAgent(
          {
            messages: chatHistory,
            stream: true,
            temperature: 0.7,
            ...(userLocation
              ? {
                  userLocation: {
                    latitude: userLocation.lat,
                    longitude: userLocation.lng,
                  },
                }
              : {}),
          },
          (chunk) => {
            fullText += chunk;
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last.role === "assistant") {
                const activities = markDone(last.toolActivities);
                updated[updated.length - 1] = {
                  ...last,
                  content: fullText,
                  isStreaming: true,
                  toolActivities: activities,
                };
              }
              return updated;
            });
          },
          (toolName, toolArgs, isDone, result) => {
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last.role === "assistant") {
                const existing = last.toolActivities
                  ? [...last.toolActivities]
                  : [];
                // Find if this tool is already in the list
                const idx = existing.findIndex(
                  (a) => a.name === toolName && a.status === "running",
                );

                if (idx !== -1) {
                  existing[idx] = {
                    ...existing[idx],
                    args: toolArgs,
                    result,
                    status: isDone ? "done" : "running",
                  };
                  updated[updated.length - 1] = {
                    ...last,
                    toolActivities: existing,
                  };
                } else {
                  const doneExisting = markDone(existing) ?? [];
                  updated[updated.length - 1] = {
                    ...last,
                    toolActivities: [
                      ...doneExisting,
                      {
                        name: toolName,
                        args: toolArgs,
                        result,
                        status: isDone ? "done" : "running",
                      },
                    ],
                  };
                }
              }
              return updated;
            });

            if (isDone) {
              const actions = mapToolToActions(toolName, result, toolArgs);
              let shouldCloseChat = false;

              for (const action of actions) {
                if (action.type === "compute-route") {
                  void handleComputeRoute({
                    origin: action.origin,
                    destination: action.destination,
                  }).then((ok) => {
                    if (ok) setOpen(false);
                  });
                } else {
                  executeAction(action);
                  if (
                    action.type === "show-route" ||
                    action.type === "switch-panel"
                  ) {
                    shouldCloseChat = true;
                  }
                }
              }
              if (shouldCloseChat) setOpen(false);
            }
          },
          controller.signal,
        );
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        fullText =
          fullText || t("chatbot.error", "抱歉，發生錯誤，請稍後再試。");
      } finally {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last.role === "assistant") {
            const activities = last.toolActivities?.map((a) => ({
              ...a,
              status: "done" as const,
            }));
            updated[updated.length - 1] = {
              ...last,
              content: fullText,
              isStreaming: false,
              toolActivities: activities,
              thinkingMs: Date.now() - startedAt,
            };
          }
          return updated;
        });

        setChatHistory((prev) => [
          ...prev,
          { role: "assistant", content: fullText },
        ]);
        setIsLoading(false);
        abortRef.current = null;
      }
    },
    [
      isLoading,
      userLocation,
      handleComputeRoute,
      setOpen,
      t,
      userConfig.language,
      markDone,
      setInput,
      setIsLoading,
      setMessages,
    ],
  );

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    setIsLoading(false);
  }, [setIsLoading]);

  return {
    messages,
    input,
    setInput,
    isLoading,
    open,
    setOpen,
    handleSend,
    stopStreaming,
  };
}
