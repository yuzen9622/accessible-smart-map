import i18n from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locale/en/translation.json";
import zhTW from "@/i18n/locale/zh-TW/translation.json";
import type { ChatBubble } from "@/stores/useChatStore";

const h = vi.hoisted(() => ({ messages: [] as ChatBubble[] }));
vi.mock("@/hook/useAIChat", () => ({
  default: () => ({
    messages: h.messages,
    handleSend: vi.fn(),
    input: "",
    setInput: vi.fn(),
    isLoading: false,
    stopStreaming: vi.fn(),
  }),
}));
vi.mock("@/hook/useIsDesktop", () => ({ default: () => true }));
vi.mock("@/hook/useOpenAiResult", () => ({
  default: () => ({ openAiResult: vi.fn(), flyTo: vi.fn() }),
}));
vi.mock("@/i18n/client", () => ({
  default: i18n,
  useAppTranslation: () => ({ t: i18n.t.bind(i18n), i18n }),
}));

import AIChatBot from "../AIChatBot";

beforeEach(async () => {
  await i18n.init({
    lng: "en",
    fallbackLng: "zh-TW",
    resources: { en: { translation: en }, "zh-TW": { translation: zhTW } },
  });
  h.messages = [
    { role: "assistant", content: zhTW.assistFirstMessage, kind: "greeting" },
  ];
});

describe("AI panel frontend-owned copy", () => {
  it("renders the default greeting in English even if seeded in Chinese", () => {
    const html = renderToStaticMarkup(<AIChatBot />);
    expect(html).toContain("Accessible Smart Map AI Assistant");
    expect(html).not.toContain(zhTW.assistFirstMessage);
  });
  it("renders English recommendations and input copy instead of Chinese fallbacks", () => {
    const html = renderToStaticMarkup(<AIChatBot />);
    expect(html).toContain("Nearby accessible facilities");
    expect(html).toContain("Directions to the nearest station");
    expect(html).toContain("Nearby restaurants");
    expect(html).toContain('placeholder="Ask a question..."');
    expect(html).toContain("Send");
  });
  it("updates only the greeting on language change, retaining user messages and AI answers", async () => {
    h.messages.push(
      { role: "user", content: "附近無障礙設施" },
      { role: "assistant", content: "Existing answer stays unchanged" },
    );
    const originalMessages = structuredClone(h.messages);
    await i18n.changeLanguage("zh-TW");
    expect(renderToStaticMarkup(<AIChatBot />)).toContain(
      zhTW.assistFirstMessage,
    );
    await i18n.changeLanguage("en");
    const html = renderToStaticMarkup(<AIChatBot />);
    expect(html).toContain("Accessible Smart Map AI Assistant");
    expect(html).toContain("附近無障礙設施");
    expect(html).toContain("Existing answer stays unchanged");
    expect(h.messages).toEqual(originalMessages);
  });
});
