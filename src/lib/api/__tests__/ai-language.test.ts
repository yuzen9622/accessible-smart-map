import i18n from "i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAppLanguage } from "@/i18n/language";
import { fetchRequest } from "@/lib/fetch";
import { chatWithAgent, streamChatWithAgent } from "../ai";

vi.mock("@/lib/fetch", () => ({
  getAccessToken: async () => null,
  fetchRequest: vi.fn(async () => ({ success: true })),
}));

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.init({
    resources: {
      en: { translation: { test: "test" } },
      "zh-TW": { translation: { test: "測試" } },
    },
    lng: "zh-TW",
    fallbackLng: "zh-TW",
    supportedLngs: ["zh-TW", "en"],
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("data: [DONE]\n\n")),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("AI request UI language", () => {
  it.each(["json", "sse"])(
    "reads live UI language for every %s request and preserves route/history",
    async (transport) => {
      const request = {
        messages: [
          { role: "user" as const, content: "台北車站附近有電梯嗎？" },
        ],
        language: "zh-TW" as const,
        routeContractVersion: 1 as const,
        routeContext: null,
        userLocation: { latitude: 25, longitude: 121 },
      };
      const send = async () => {
        if (transport === "json") {
          await chatWithAgent(request);
          return vi.mocked(fetchRequest).mock.calls.at(-1)?.[1]?.body;
        }
        await streamChatWithAgent(request, vi.fn());
        return JSON.parse(
          vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body as string,
        );
      };
      expect(await send()).toEqual({
        ...request,
        language: "zh-TW",
        stream: transport === "sse",
      });
      await i18n.changeLanguage("en");
      expect(await send()).toEqual({
        ...request,
        language: "en",
        stream: transport === "sse",
      });
    },
  );

  it("normalizes a regional UI locale to a supported API code", async () => {
    await i18n.changeLanguage("en-US");
    expect(getAppLanguage()).toBe("en");
    await chatWithAgent({ messages: [] });
    expect(vi.mocked(fetchRequest).mock.calls[0][1]?.body).toMatchObject({
      language: "en",
    });
  });
});
