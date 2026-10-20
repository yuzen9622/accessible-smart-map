import { afterEach, describe, expect, it, vi } from "vitest";
import { getVoiceHistory } from "@/lib/ai/routeConversation";
import useChatStore from "@/stores/useChatStore";
import {
  VoiceSessionController,
  type VoiceSessionDeps,
  type VoiceSocket,
} from "../voiceSession";

const MAX_FRAME_BYTES = 8192;
const byteLength = (text: string) => new TextEncoder().encode(text).byteLength;
const controllers: VoiceSessionController[] = [];
type History = NonNullable<
  ReturnType<NonNullable<VoiceSessionDeps["getHistory"]>>
>;

function harness(history: History, token = "valid-fixture-token") {
  const sockets: (VoiceSocket & { sent: string[]; opened: boolean })[] = [];
  const refresh = vi.fn(async () => "refreshed-fixture-token");
  const dispose = vi.fn();
  const controller = new VoiceSessionController({
    wsUrl: "wss://fixture.invalid/api/v1/voice/ws",
    getAuthIdentity: () => "fixture-user",
    getToken: () => token,
    refreshAuth: refresh,
    getLanguage: () => "zh-TW",
    getUserLocation: () => ({ latitude: 25.04, longitude: 121.51 }),
    getConversationInput: () => ({
      routeContractVersion: 1,
      routeContext: { routeToken: "route-token-must-survive" },
      routingPreferences: { mode: "wheelchair", avoidStairs: true },
    }),
    getHistory: () => history,
    createSocket: () => {
      const socket: (typeof sockets)[number] = {
        sent: [],
        opened: false,
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
        close: vi.fn(),
        send: (data) => {
          if (typeof data !== "string") return;
          socket.sent.push(data);
          if (JSON.parse(data).type !== "session.start") return;
          queueMicrotask(() => {
            if (byteLength(data) > MAX_FRAME_BYTES) {
              socket.onclose?.({ code: 4401, reason: "unauthorized" });
            } else {
              socket.onmessage?.({
                data: JSON.stringify({
                  type: "session.ready",
                  capabilities: {
                    aiRouteContractVersion: 1,
                    routeContextSync: true,
                  },
                }),
              });
            }
          });
        },
      };
      sockets.push(socket);
      return socket;
    },
    createCapture: async () => ({ stop: vi.fn() }),
    createPlayback: () => ({
      play: vi.fn(),
      clear: vi.fn(),
      dispose,
      resume: async () => true,
      onBlocked: vi.fn(),
    }),
    onStatusChange: vi.fn(),
    onTranscript: vi.fn(),
    onToolEvent: vi.fn(),
    onNavigationEvent: vi.fn(),
  });
  controllers.push(controller);
  async function start() {
    controller.start();
    for (let i = 0; i < 30; i++) {
      for (const socket of sockets) {
        if (socket.opened) continue;
        socket.opened = true;
        socket.onopen?.();
      }
      await Promise.resolve();
    }
  }
  return { controller, sockets, refresh, dispose, start };
}

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.end();
  useChatStore.getState().clearAll();
});

describe("session.start gateway byte budget", () => {
  it("does not misdiagnose long signed-in chat history as an expired login", async () => {
    useChatStore.getState().setChatHistory([
      ...Array.from({ length: 59 }, () => ({
        role: "assistant" as const,
        content: '繁體中文🧑‍🦽\n"\\'.repeat(350),
        tool_summaries: [
          { name: "searchPlaces", summary: "車站資訊".repeat(250) },
        ],
      })),
      { role: "user", content: "我想去竹北車站" },
    ]);
    const original = structuredClone(useChatStore.getState().chatHistory);
    const history = getVoiceHistory();
    const snapshot = structuredClone(history);
    const h = harness(history);
    await h.start();
    expect(h.controller.getStatus().status).toBe("listening");
    expect(h.refresh).not.toHaveBeenCalled();
    expect(h.sockets).toHaveLength(1);
    const wire = h.sockets[0].sent[0];
    expect(byteLength(wire)).toBeLessThanOrEqual(MAX_FRAME_BYTES);
    expect(JSON.parse(wire)).toMatchObject({
      type: "session.start",
      token: "valid-fixture-token",
      routeContractVersion: 1,
      routeContext: { routeToken: "route-token-must-survive" },
      routingPreferences: { mode: "wheelchair", avoidStairs: true },
      userLocation: { latitude: 25.04, longitude: 121.51 },
      language: "zh-TW",
    });
    expect(JSON.parse(wire).history.at(-1)).toEqual(history.at(-1));
    expect(history).toEqual(snapshot);
    expect(useChatStore.getState().chatHistory).toEqual(original);
  });

  it.each(["中文字".repeat(1300), "🧑‍🦽".repeat(1000), '"\\\n\t'.repeat(2000)])(
    "omits optional history when the newest turn alone cannot fit (%#)",
    async (text) => {
      const history: History = [{ role: "assistant", text }];
      const h = harness(history);
      await h.start();
      expect(h.controller.getStatus().status).toBe("listening");
      expect(byteLength(h.sockets[0].sent[0])).toBeLessThanOrEqual(
        MAX_FRAME_BYTES,
      );
      expect(history).toEqual([{ role: "assistant", text }]);
      expect(h.refresh).not.toHaveBeenCalled();
    },
  );

  it("retains the largest contiguous suffix that fits including JSON overhead", async () => {
    const history: History = Array.from({ length: 60 }, (_, i) => ({
      role: i % 2 ? "user" : "assistant",
      text: `${i}: ${'繁中🦽"\\\n'.repeat(50)}`,
    }));
    const h = harness(history);
    await h.start();
    const wire = h.sockets[0].sent[0];
    const message = JSON.parse(wire);
    expect(byteLength(wire)).toBeLessThanOrEqual(MAX_FRAME_BYTES);
    expect(message.history.length).toBeGreaterThan(0);
    expect(message.history.length).toBeLessThan(history.length);
    expect(message.history).toEqual(history.slice(-message.history.length));
    const previous = history[history.length - message.history.length - 1];
    expect(
      byteLength(
        JSON.stringify({ ...message, history: [previous, ...message.history] }),
      ),
    ).toBeGreaterThan(MAX_FRAME_BYTES);
  });

  it("preserves all small history entries including tool summaries", async () => {
    const history: History = [
      { role: "user", text: "找車站" },
      {
        role: "assistant",
        text: "找到車站",
        tools: [{ name: "searchPlaces", summary: "一處車站" }],
      },
    ];
    const h = harness(history);
    await h.start();
    expect(JSON.parse(h.sockets[0].sent[0]).history).toEqual(history);
  });

  it("does not send oversized required fields or falsely request a login", async () => {
    const h = harness([], "x".repeat(MAX_FRAME_BYTES));
    await h.start();
    expect(h.controller.getStatus()).toEqual({
      status: "error",
      code: "SESSION_START_TOO_LARGE",
    });
    expect(h.sockets[0].sent).toEqual([]);
    expect(h.sockets[0].close).toHaveBeenCalled();
    expect(h.dispose).toHaveBeenCalledOnce();
    expect(h.refresh).not.toHaveBeenCalled();
    expect(h.controller.isActive()).toBe(false);
  });
});
