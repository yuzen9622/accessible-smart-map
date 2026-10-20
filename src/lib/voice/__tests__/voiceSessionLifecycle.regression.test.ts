import { afterEach, describe, expect, it, vi } from "vitest";
import { refreshAccessToken } from "@/lib/authRefresh";
import useAuthStore from "@/stores/useAuthStore";
import useChatStore from "@/stores/useChatStore";
import { createVoiceChatPersistence } from "../voiceChatPersistence";
import {
  type VoicePlayback,
  VoiceSessionController,
  type VoiceSocket,
} from "../voiceSession";
import { createVoiceBindings } from "../voiceSessionBindings";

const flush = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve();
};
function user(id: string) {
  return { _id: id } as NonNullable<
    ReturnType<typeof useAuthStore.getState>["user"]
  >;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  useChatStore.getState().clearAll();
});

describe("auth null-session identity isolation", () => {
  it("same-identity profile replacement does not invalidate a valid refresh", async () => {
    useAuthStore.setState({ user: user("a"), session: null });
    let resolve!: (value: Response) => void;
    vi.stubGlobal(
      "fetch",
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    );
    const pending = refreshAccessToken();
    useAuthStore.setState({ user: user("a") });
    resolve(
      new Response(JSON.stringify({ ok: true, accessToken: "fresh-token" })),
    );
    expect(await pending).toBe("fresh-token");
    expect(useAuthStore.getState().session?.accessToken).toBe("fresh-token");
  });
  it.each([false, true])(
    "does not commit an old refresh after account switch or null-session ABA (ABA=%s)",
    async (aba) => {
      const original = user("a");
      useAuthStore.setState({ user: original, session: null });
      let resolve!: (value: Response) => void;
      vi.stubGlobal(
        "fetch",
        vi.fn(
          () =>
            new Promise<Response>((r) => {
              resolve = r;
            }),
        ),
      );
      const pending = refreshAccessToken();
      useAuthStore.setState({ user: null, session: null });
      useAuthStore.setState({
        user: aba ? original : user("b"),
        session: null,
      });
      resolve(
        new Response(
          JSON.stringify({ ok: true, accessToken: "old-user-token" }),
        ),
      );
      expect(await pending).toBeNull();
      expect(useAuthStore.getState().session).toBeNull();
      expect(useAuthStore.getState().user?._id).toBe(aba ? "a" : "b");
    },
  );
});

describe("actual chat persistence adapter", () => {
  it("unmount UI cleanup preserves correction mapping until the actual peer close", () => {
    const binding = createVoiceBindings({
      publishTranscripts: vi.fn(),
      publishStatus: vi.fn(),
      publishTool: vi.fn(),
      setMicLevel: vi.fn(),
      ...createVoiceChatPersistence(),
    });
    binding.onTranscript({
      role: "user",
      text: "before",
      final: true,
      utteranceId: "u1",
    });
    binding.onTurnComplete();
    binding.onStatusChange({ status: "assistant-ending" });
    binding.dispose();
    binding.onTranscriptCorrection({
      utteranceId: "u1",
      text: "after unmount",
    });
    expect(useChatStore.getState().chatHistory.at(-1)?.content).toBe(
      "after unmount",
    );
    binding.onStatusChange({ status: "draining-playback" });
    binding.onTranscriptCorrection({
      utteranceId: "u1",
      text: "after close must ignore",
    });
    expect(useChatStore.getState().chatHistory.at(-1)?.content).toBe(
      "after unmount",
    );
  });
  it("updates both persisted surfaces in place repeatedly and does not patch a cleared conversation", () => {
    useChatStore.getState().clearAll();
    const binding = createVoiceBindings({
      publishTranscripts: vi.fn(),
      publishStatus: vi.fn(),
      publishTool: vi.fn(),
      setMicLevel: vi.fn(),
      ...createVoiceChatPersistence(),
    });
    binding.onTranscript({
      role: "user",
      text: "old",
      final: true,
      utteranceId: "u1",
    });
    binding.onTurnComplete();
    for (const text of ["corrected", "corrected again"]) {
      binding.onTranscriptCorrection({ utteranceId: "u1", text });
      expect(useChatStore.getState().messages).toEqual([
        { role: "user", content: text },
      ]);
      expect(useChatStore.getState().chatHistory).toEqual([
        { role: "user", content: text },
      ]);
    }
    useChatStore.getState().clearAll();
    binding.onTranscriptCorrection({
      utteranceId: "u1",
      text: "must not reappear",
    });
    expect(useChatStore.getState().messages).toEqual([]);
    expect(useChatStore.getState().chatHistory).toEqual([]);
  });
  it("disconnect clears mappings without letting a reused utterance ID overwrite the prior session", () => {
    const binding = createVoiceBindings({
      publishTranscripts: vi.fn(),
      publishStatus: vi.fn(),
      publishTool: vi.fn(),
      setMicLevel: vi.fn(),
      ...createVoiceChatPersistence(),
    });
    binding.onTranscript({
      role: "user",
      text: "session one",
      final: true,
      utteranceId: "u1",
    });
    binding.onTurnComplete();
    binding.onStatusChange({ status: "reconnecting" });
    binding.onStatusChange({ status: "listening" });
    binding.onTranscript({
      role: "user",
      text: "session two",
      final: true,
      utteranceId: "u1",
    });
    binding.onTurnComplete();
    binding.onTranscriptCorrection({
      utteranceId: "u1",
      text: "new correction",
    });
    expect(
      useChatStore.getState().chatHistory.map((entry) => entry.content),
    ).toEqual(["session one", "new correction"]);
  });
});

function controllerHarness() {
  const sockets: VoiceSocket[] = [];
  const players: {
    player: VoicePlayback;
    idle: () => void;
    blocked: () => void;
    resolveResume: (value: boolean) => void;
  }[] = [];
  const controller = new VoiceSessionController({
    wsUrl: "ws://localhost/test",
    getAuthIdentity: () => "a",
    getToken: () => "opaque",
    refreshAuth: async () => null,
    getUserLocation: () => null,
    createSocket: () => {
      const socket: VoiceSocket = {
        send: vi.fn(),
        close: vi.fn(),
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
      };
      sockets.push(socket);
      return socket;
    },
    createCapture: async () => ({ stop: vi.fn() }),
    createPlayback: () => {
      let idle = () => {};
      let blocked = () => {};
      let resolveResume!: (value: boolean) => void;
      const player: VoicePlayback = {
        play: vi.fn(),
        clear: vi.fn(),
        dispose: vi.fn(),
        isIdle: () => false,
        resume: () =>
          new Promise<boolean>((r) => {
            resolveResume = r;
          }),
        onIdle: (cb) => {
          idle = cb;
        },
        onBlocked: (cb) => {
          blocked = cb;
        },
      };
      players.push({
        player,
        idle: () => idle(),
        blocked: () => blocked(),
        resolveResume: (value) => resolveResume(value),
      });
      return player;
    },
    onStatusChange: vi.fn(),
    onTranscript: vi.fn(),
    onToolEvent: vi.fn(),
    onNavigationEvent: vi.fn(),
  });
  const event = (message: object) =>
    sockets.at(-1)?.onmessage?.({ data: JSON.stringify(message) });
  const ready = async () => {
    controller.start();
    sockets.at(-1)?.onopen?.();
    event({ type: "session.ready" });
    await flush();
  };
  return { controller, sockets, players, event, ready };
}
describe("ending asynchronous guards", () => {
  it("repeated end/unmount cleanup preserves farewell downlink and scheduled playback", async () => {
    vi.useFakeTimers();
    const h = controllerHarness();
    await h.ready();
    h.event({ type: "session.ending", reason: "assistant-end" });
    h.controller.end();
    h.controller.end();
    expect(h.players[0].player.clear).not.toHaveBeenCalled();
    expect(h.players[0].player.dispose).not.toHaveBeenCalled();
    h.sockets[0].onmessage?.({ data: new ArrayBuffer(4) });
    expect(h.players[0].player.play).toHaveBeenCalledOnce();
    h.sockets[0].onclose?.({ code: 1000, reason: "assistant-end" });
    h.controller.end();
    expect(h.players[0].player.dispose).not.toHaveBeenCalled();
    h.players[0].idle();
    expect(h.players[0].player.dispose).toHaveBeenCalledOnce();
    expect(h.sockets[0].send).not.toHaveBeenCalledWith(
      JSON.stringify({ type: "session.end" }),
    );
  });
  it("closed socket callbacks cannot restart capture or change the status during drain", async () => {
    vi.useFakeTimers();
    const h = controllerHarness();
    await h.ready();
    const saved = h.sockets[0].onmessage;
    h.sockets[0].onclose?.({ code: 1000, reason: "assistant-end" });
    saved?.({ data: JSON.stringify({ type: "session.ready" }) });
    await flush();
    expect(h.controller.getStatus().status).toBe("draining-playback");
    h.players[0].idle();
    expect(h.controller.getStatus()).toEqual({
      status: "ended",
      code: "assistant-end",
    });
  });
  it("retains blocked ending UI, ignores context/language/interrupted, and bounds drain", async () => {
    vi.useFakeTimers();
    const h = controllerHarness();
    await h.ready();
    h.players[0].blocked();
    h.event({ type: "session.ending", reason: "assistant-end" });
    expect(h.controller.getStatus()).toEqual({
      status: "assistant-ending",
      code: "PLAYBACK_BLOCKED",
    });
    h.controller.syncRouteContext();
    h.controller.reconnectForLanguageChange();
    h.event({ type: "interrupted" });
    h.controller.setMuted(true);
    expect(h.players[0].player.clear).not.toHaveBeenCalled();
    expect(h.sockets).toHaveLength(1);
    h.sockets[0].onclose?.({ code: 1000, reason: "assistant-end" });
    await vi.advanceTimersByTimeAsync(15000);
    expect(h.players[0].player.dispose).toHaveBeenCalledOnce();
    expect(h.controller.getStatus()).toEqual({
      status: "ended",
      code: "assistant-end",
    });
  });
  it("saved callbacks from a disposed player, pending resume and old timers cannot affect the next player", async () => {
    vi.useFakeTimers();
    const h = controllerHarness();
    await h.ready();
    h.controller.resumePlayback();
    h.event({ type: "session.ending", reason: "assistant-end" });
    h.sockets[0].onclose?.({ code: 1000, reason: "assistant-end" });
    h.players[0].idle();
    await h.ready();
    const before = h.controller.getStatus();
    h.players[0].blocked();
    h.players[0].idle();
    h.players[0].resolveResume(true);
    await flush();
    await vi.advanceTimersByTimeAsync(60000);
    expect(h.controller.getStatus()).toEqual(before);
    expect(h.players[1].player.dispose).not.toHaveBeenCalled();
    h.controller.end();
  });
});
