import type { ToolSummary } from "@/lib/ai/routeConversation";
import type { ChatMessage } from "@/lib/api/ai";
import useChatStore, { type ChatBubble } from "@/stores/useChatStore";
import type { AggEntry } from "./transcriptAggregator";

/** Frontend-only IDs: never add correction metadata to the model's wire history. */
export function createVoiceChatPersistence() {
  let nextId = 0;
  const messages = new Map<
    string,
    { history: ChatMessage; bubble: ChatBubble }
  >();
  return {
    persistTurn(
      entries: AggEntry[],
      summaries: ToolSummary[],
    ): ReadonlyMap<number, string> {
      const ids = new Map<number, string>();
      const history: ChatMessage[] = [];
      const bubbles: ChatBubble[] = [];
      for (const entry of entries) {
        if (!entry.text) continue;
        const role = entry.role === "model" ? "assistant" : "user";
        const turn: ChatMessage = {
          role,
          content: entry.text,
          ...(role === "assistant" ? { tool_summaries: summaries } : {}),
        };
        const bubble: ChatBubble = { role, content: entry.text };
        const id = `voice-message-${nextId++}`;
        messages.set(id, { history: turn, bubble });
        ids.set(entry.id, id);
        history.push(turn);
        bubbles.push(bubble);
      }
      const store = useChatStore.getState();
      store.setChatHistory((previous) => [...previous, ...history]);
      store.setMessages((previous) => [...previous, ...bubbles]);
      return ids;
    },
    correctPersistedMessage(messageId: string, text: string): void {
      const previous = messages.get(messageId);
      if (!previous) return;
      const store = useChatStore.getState();
      // Clearing chat or changing account invalidates object identity, even if IDs repeat.
      if (
        !store.chatHistory.includes(previous.history) ||
        !store.messages.includes(previous.bubble)
      )
        return;
      const history = { ...previous.history, content: text };
      const bubble = { ...previous.bubble, content: text };
      messages.set(messageId, { history, bubble });
      store.setChatHistory((entries) =>
        entries.map((entry) => (entry === previous.history ? history : entry)),
      );
      store.setMessages((entries) =>
        entries.map((entry) => (entry === previous.bubble ? bubble : entry)),
      );
    },
    clearPersistedMappings(): void {
      messages.clear();
    },
  };
}
