import useChatStore from "@/stores/useChatStore";
import useMapStore from "@/stores/useMapStore";
import useOnboardingStore from "@/stores/useOnboardingStore";

export type ToolSummary = { name: string; summary: string };
export type RouteConversationInput = {
  routeContractVersion: 1;
  routeContext: { routeToken: string } | null;
  routingPreferences?: {
    mode?: "normal" | "wheelchair" | "elderly" | "visual_impaired";
    transitPreference?: "none" | "bus" | "rail" | "metro";
    departureTime?: string;
    avoidStairs?: boolean;
    requireElevator?: boolean;
  };
};

export function getRouteConversationInput(): RouteConversationInput {
  const map = useMapStore.getState();
  const token = map.selectRoute?.route.routeToken?.trim();
  const profile = useOnboardingStore.getState().profile;
  return {
    routeContractVersion: 1,
    routeContext:
      token && token.length <= 256 && !map.invalidRouteTokens.includes(token)
        ? { routeToken: token }
        : null,
    routingPreferences: {
      ...(profile.routeMode !== "normal" ? { mode: profile.routeMode } : {}),
      avoidStairs: profile.avoidStairs,
      requireElevator: profile.requireElevator,
    },
  };
}

export function getVoiceHistory() {
  return useChatStore
    .getState()
    .chatHistory.filter(
      (message) => message.role === "user" || message.role === "assistant",
    )
    .slice(-60)
    .map((message) => ({
      role: message.role as "user" | "assistant",
      text: (message.content ?? "").slice(0, 4000),
      ...(message.tool_summaries ? { tools: message.tool_summaries } : {}),
    }));
}

// Never serialize the full route/token as a fallback when summary is absent.
export function toolSummary(
  name: string,
  summary: unknown,
): ToolSummary | null {
  return typeof summary === "string" &&
    summary.length <= 1201 &&
    name.length <= 64
    ? { name, summary }
    : null;
}
