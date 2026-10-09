import { getAppLanguage } from "@/i18n/language";
import type {
  RouteConversationInput,
  ToolSummary,
} from "@/lib/ai/routeConversation";
import { END_POINT } from "@/lib/config";
import { fetchRequest, getAccessToken } from "@/lib/fetch";
import type { ApiResponse } from "@/types/response";
import type {
  AccessibleRoute,
  RouteExplanation,
  RouteIntent,
} from "@/types/route";

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_summaries?: ToolSummary[];
};
export type AgentChatRequest = Partial<RouteConversationInput> & {
  messages: ChatMessage[];
  language?: "zh-TW" | "en";
  model?: string;
  stream?: boolean;
  temperature?: number;
  userLocation?: { latitude: number; longitude: number };
};

export async function chatWithAgent(request: AgentChatRequest) {
  return fetchRequest(`${END_POINT}/api/v1/ai/chat`, {
    method: "POST",
    body: { ...request, language: getAppLanguage(), stream: false },
  }) as Promise<ApiResponse<unknown>>;
}

export async function streamChatWithAgent(
  request: AgentChatRequest,
  onChunk: (text: string) => void,
  onToolCall?: (
    name: string,
    args: string,
    isDone: boolean,
    result?: unknown,
    metadata?: { callId?: string; summary?: string },
  ) => void,
  signal?: AbortSignal,
): Promise<void> {
  const token = await getAccessToken();
  const response = await fetch(`${END_POINT}/api/v1/ai/chat`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      ...request,
      language: getAppLanguage(),
      stream: true,
    }),
    signal,
  });
  if (!response.ok) throw new Error(`AI request failed (${response.status})`);
  if (!response.body) throw new Error("AI response has no stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "";
  let currentToolCall: { id: string; name: string; args: string } | null = null;
  const customToolArgsMap = new Map<string, string>();

  const flushToolCall = (isDone = false) => {
    if (currentToolCall) {
      try {
        onToolCall?.(currentToolCall.name, currentToolCall.args, isDone);
      } catch (e) {
        console.error("Failed to parse tool args", e);
      }
      if (isDone) {
        currentToolCall = null;
      }
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        flushToolCall(true);
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
          continue;
        }
        if (!line.trim()) continue;
        if (line.startsWith("data: ")) {
          const raw = line.slice(6).trim();
          if (raw === "[DONE]" || raw === "done") {
            flushToolCall(true);
            return;
          }
          try {
            const chunk = JSON.parse(raw);
            if (eventName === "error") throw new Error("AI response failed");

            // Support custom backend format for tool calls: {"name": "...", "args": {...}}
            if (chunk.name && chunk.args !== undefined) {
              const argsStr =
                typeof chunk.args === "string"
                  ? chunk.args
                  : JSON.stringify(chunk.args);
              customToolArgsMap.set(chunk.callId ?? chunk.name, argsStr);
              onToolCall?.(chunk.name, argsStr, false, undefined, {
                callId: chunk.callId,
              });
              continue;
            }

            // Support custom backend format for tool results: {"name": "...", "result": {...}}
            if (chunk.name && chunk.result !== undefined) {
              const argsStr =
                customToolArgsMap.get(chunk.callId ?? chunk.name) || "";
              onToolCall?.(chunk.name, argsStr, true, chunk.result, {
                callId: chunk.callId,
                summary: chunk.summary,
              });
              continue;
            }
            // Support original broken format just in case: {"name": "...", "arguments": {...}}
            if (chunk.name && chunk.arguments !== undefined) {
              const argsStr =
                typeof chunk.arguments === "string"
                  ? chunk.arguments
                  : JSON.stringify(chunk.arguments);
              onToolCall?.(chunk.name, argsStr, true);
              continue;
            }

            // Support custom backend format for text tokens: {"text": "..."}
            if (chunk.text !== undefined) {
              onChunk(chunk.text);
              continue;
            }

            // Support OpenAI format
            const delta = chunk?.choices?.[0]?.delta;
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (tc.id) {
                  flushToolCall(true);
                  currentToolCall = {
                    id: tc.id,
                    name: tc.function?.name || "",
                    args: tc.function?.arguments || "",
                  };
                  flushToolCall(false);
                } else if (currentToolCall) {
                  currentToolCall.args += tc.function?.arguments || "";
                  flushToolCall(false);
                }
              }
            } else if (delta?.content) {
              onChunk(delta.content);
            }
          } catch (error) {
            if (!(error instanceof SyntaxError)) throw error;
          }
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function parseIntent(query: string) {
  return fetchRequest(`${END_POINT}/api/v1/ai/intent`, {
    method: "POST",
    body: { query },
  }) as Promise<ApiResponse<RouteIntent>>;
}

export async function explainRoute(
  route: AccessibleRoute,
  mode: RouteIntent["mode"] = "normal",
  language: "zh-TW" | "en" = "zh-TW",
) {
  return fetchRequest(`${END_POINT}/api/v1/ai/explain`, {
    method: "POST",
    body: { route, mode, language },
  }) as Promise<ApiResponse<RouteExplanation>>;
}
