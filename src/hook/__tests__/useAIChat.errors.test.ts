import i18n from "i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locale/en/translation.json";
import zhTW from "@/i18n/locale/zh-TW/translation.json";
import { AI_ROUTE_UNAVAILABLE } from "@/lib/ai/routeContract";
import { ApiError } from "@/lib/fetch";
import useChatStore from "@/stores/useChatStore";

const h = vi.hoisted(() => ({
  stream: vi.fn(),
  effects: [] as (() => void)[],
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useCallback: (fn: unknown) => fn,
  useRef: (current: unknown) => ({ current }),
  useEffect: (effect: () => void) => h.effects.push(effect),
}));
vi.mock("zustand/react/shallow", () => ({
  useShallow: (selector: unknown) => selector,
}));
vi.mock("@/i18n/client", () => ({
  useAppTranslation: () => ({ t: i18n.t.bind(i18n), i18n }),
}));
vi.mock("@/i18n/language", () => ({ getAppLanguage: () => "en" }));
vi.mock("@/lib/api/ai", () => ({ streamChatWithAgent: h.stream }));
vi.mock("@/lib/ai/actionExecutor", () => ({
  executeAction: () => ({ ok: true }),
}));
vi.mock("@/stores/useChatStore", async (importOriginal) => {
  const { default: store } =
    await importOriginal<typeof import("@/stores/useChatStore")>();
  return {
    default: Object.assign(
      (selector: (state: ReturnType<typeof store.getState>) => unknown) =>
        selector(store.getState()),
      store,
    ),
  };
});
vi.mock("@/stores/useMapStore", async (importOriginal) => {
  const { default: store } =
    await importOriginal<typeof import("@/stores/useMapStore")>();
  return {
    default: Object.assign(
      (selector: (state: ReturnType<typeof store.getState>) => unknown) =>
        selector(store.getState()),
      store,
    ),
  };
});

import useAIChat from "../useAIChat";

beforeEach(async () => {
  vi.clearAllMocks();
  h.effects.length = 0;
  await i18n.init({
    lng: "en",
    fallbackLng: "zh-TW",
    resources: { en: { translation: en }, "zh-TW": { translation: zhTW } },
  });
  useChatStore.setState({ hydrated: true });
  useChatStore.getState().clearAll();
  useChatStore.getState().setIsLoading(false);
});

describe("chat greeting identity", () => {
  it("marks a fresh default greeting for live translation", () => {
    useAIChat();
    h.effects[0]();
    expect(useChatStore.getState().messages).toEqual([
      { role: "assistant", kind: "greeting", content: en.assistFirstMessage },
    ]);
  });
  it("recognizes a restored Chinese greeting without changing actual conversation turns", () => {
    const user = { role: "user" as const, content: "附近無障礙設施" };
    const answer = { role: "assistant" as const, content: "這是既有回答" };
    useChatStore.setState({
      messages: [
        { role: "assistant", content: zhTW.assistFirstMessage },
        user,
        answer,
      ],
    });
    useAIChat();
    h.effects[0]();
    expect(useChatStore.getState().messages[0]).toMatchObject({
      kind: "greeting",
    });
    expect(useChatStore.getState().messages.slice(1)).toEqual([user, answer]);
    expect(useChatStore.getState().messages[1]).toBe(user);
    expect(useChatStore.getState().messages[2]).toBe(answer);
  });
  it("does not mistake a user message or ordinary AI answer for a greeting", () => {
    const messages = [
      { role: "user" as const, content: zhTW.assistFirstMessage },
      { role: "assistant" as const, content: "Source answer" },
    ];
    useChatStore.setState({ messages });
    useAIChat();
    h.effects[0]();
    expect(useChatStore.getState().messages).toBe(messages);
  });
  it("waits for storage hydration before seeding a greeting", () => {
    useChatStore.setState({ hydrated: false });
    useAIChat();
    h.effects[0]();
    expect(useChatStore.getState().messages).toEqual([]);
  });
});

describe("chat error display", () => {
  it.each(["AI_RATE_LIMITED", "FUTURE_REASON", undefined])(
    "preserves the server's localized message for %s",
    async (reason) => {
      h.stream.mockRejectedValueOnce(
        new ApiError("Please wait before trying again.", 429, reason),
      );
      const chat = useAIChat();
      await chat.handleSend("Plan a route");
      expect(useChatStore.getState().messages.at(-1)?.content).toBe(
        "Please wait before trying again.",
      );
      expect(useChatStore.getState().isLoading).toBe(false);
    },
  );
  it("retains the local invalid-route safety message", async () => {
    h.stream.mockRejectedValueOnce(new Error(AI_ROUTE_UNAVAILABLE));
    const chat = useAIChat();
    await chat.handleSend("Plan a route");
    expect(useChatStore.getState().messages.at(-1)?.content).toBe(
      AI_ROUTE_UNAVAILABLE,
    );
  });
  it("uses frontend i18n for failures without a server envelope", async () => {
    h.stream.mockRejectedValueOnce(new Error("Network failure"));
    const chat = useAIChat();
    await chat.handleSend("Plan a route");
    expect(useChatStore.getState().messages.at(-1)?.content).toBe(
      en.chatbot.error,
    );
  });
});
