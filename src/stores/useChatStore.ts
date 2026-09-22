"use client";

import { create } from "zustand";
import type { ChatMessage } from "@/lib/api/ai";

export interface ToolActivity {
  name: string;
  args?: unknown;
  result?: unknown;
  status: "running" | "done";
}

export interface ChatBubble {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  toolActivities?: ToolActivity[];
  /** 這則回覆從送出到串流結束的耗時（毫秒），給 ThinkingTrace 顯示
   * 「已完成 3 項查詢 · 4.2 秒」。存在 bubble 上而不是元件 state，是因為
   * `messages` 會鏡射進 sessionStorage：重整後舊訊息仍要說得出當時花了多久。
   * 串流中為 `undefined`，標題就只顯示「已完成 N 項查詢」。 */
  thinkingMs?: number;
}

type MessagesUpdater = ChatBubble[] | ((prev: ChatBubble[]) => ChatBubble[]);
type HistoryUpdater = ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[]);

const STORAGE_KEY = "aiChatConversation";

interface PersistedShape {
  messages: ChatBubble[];
  chatHistory: ChatMessage[];
}

// sessionStorage (not localStorage): a reload should restore the
// conversation, but a stale conversation from days ago showing up on a
// shared/public device would be worse than losing it — session-scoped is the
// right lifetime, same reasoning as clearing it on logout below.
function readStored(): PersistedShape | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      !Array.isArray(parsed?.messages) ||
      !Array.isArray(parsed?.chatHistory)
    ) {
      return null;
    }
    return parsed as PersistedShape;
  } catch {
    return null;
  }
}

function writeStored(messages: ChatBubble[], chatHistory: ChatMessage[]) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ messages, chatHistory }),
    );
  } catch {
    // Quota/private-mode failure only costs persistence, not correctness.
  }
}

function clearStored() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

interface ChatState {
  hydrated: boolean;
  /** Rendered bubbles. Lives here (not component state) so the AI panel
   * keeps its history across mount/unmount — e.g. collapsing the desktop
   * sidebar or closing the mobile sheet swaps `AIChatBot` out of the tree,
   * and a component-local `useState` would reset to the greeting on the
   * next open. Mobile and desktop each mount their own `AIChatBot`
   * instance (see AIChatBot.tsx's `active` prop); sharing this store means
   * they show the same conversation instead of two independent ones.
   * Also mirrored to `sessionStorage` so a page reload restores it too. */
  messages: ChatBubble[];
  input: string;
  isLoading: boolean;
  /** Raw system/user/assistant turns sent to the agent API — same
   * persistence reasoning as `messages`, kept separate because its shape
   * (system prompt, `ChatMessage`) differs from the rendered bubbles. */
  chatHistory: ChatMessage[];
  /** Reads the sessionStorage snapshot once. Safe to call from multiple
   * mounts — a no-op after the first (see `hydrated`), matching the
   * `initFromStorage` pattern already used by the other stores. */
  initFromStorage: () => void;
  setMessages: (updater: MessagesUpdater) => void;
  setInput: (input: string) => void;
  setIsLoading: (loading: boolean) => void;
  setChatHistory: (updater: HistoryUpdater) => void;
  /** Resets to a fresh conversation and drops the sessionStorage snapshot.
   * `seedMessages` lets a caller that already knows the localized greeting
   * (the "Clear conversation" button) show it immediately, rather than
   * waiting on `useAIChat`'s mount-only re-seed effect to notice an empty
   * array — pass nothing (e.g. from a logout handler with no UI context) to
   * leave it empty and let that effect re-seed on next open. */
  clearAll: (seedMessages?: ChatBubble[]) => void;
}

const useChatStore = create<ChatState>((set, get) => ({
  hydrated: false,
  messages: [],
  input: "",
  isLoading: false,
  chatHistory: [],
  initFromStorage: () => {
    if (get().hydrated) return;
    const stored = readStored();
    set({
      hydrated: true,
      ...(stored
        ? { messages: stored.messages, chatHistory: stored.chatHistory }
        : {}),
    });
  },
  setMessages: (updater) => {
    const next =
      typeof updater === "function" ? updater(get().messages) : updater;
    writeStored(next, get().chatHistory);
    set({ messages: next });
  },
  setInput: (input) => set({ input }),
  setIsLoading: (loading) => set({ isLoading: loading }),
  setChatHistory: (updater) => {
    const next =
      typeof updater === "function" ? updater(get().chatHistory) : updater;
    writeStored(get().messages, next);
    set({ chatHistory: next });
  },
  clearAll: (seedMessages = []) => {
    clearStored();
    set({ messages: seedMessages, chatHistory: [], input: "" });
  },
}));

export default useChatStore;
