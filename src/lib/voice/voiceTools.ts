import type { VoiceToolEvent } from "./voiceSession";

export interface VoiceToolActivity {
  id: string;
  state: "pending" | "done" | "failed" | "cancelled";
  event: VoiceToolEvent;
}

export function isUserVisibleVoiceTool(name: string): boolean {
  return name !== "endVoiceSession";
}

export function toolResultFailure(event: VoiceToolEvent): string | null {
  if (event.type !== "result") return null;
  const result = event.result;
  const data =
    result && typeof result === "object" && !Array.isArray(result)
      ? (result as Record<string, unknown>)
      : null;
  const failed =
    event.ok === false ||
    data?.ok === false ||
    !!data?.error ||
    (typeof data?.status === "string" &&
      !["OK", "ZERO_RESULTS", "adopted"].includes(data.status));
  if (!failed) return null;
  for (const value of [data?.error, data?.message, data?.reason, event.summary])
    if (typeof value === "string" && value.trim()) return value;
  return "查詢未成功，請稍後再試。";
}
