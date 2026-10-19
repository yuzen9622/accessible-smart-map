// Frozen acceptance v1: do not weaken. See .pi/acceptance/voice-session-lifecycle.md.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refreshAccessToken } from "@/lib/authRefresh";
import { applyRouteReplacement } from "@/lib/navigation/rerouteCoordinator";
import useAuthStore from "@/stores/useAuthStore";
import useChatStore from "@/stores/useChatStore";
import useMapStore from "@/stores/useMapStore";
import useNavStore from "@/stores/useNavStore";
import type { AccessibleRoute, NavInstruction } from "@/types/route";
import {
  VoiceSessionController,
  type VoiceSocket,
  type VoiceStatus,
} from "../voiceSession";
import { createVoiceBindings } from "../voiceSessionBindings";

class Socket implements VoiceSocket {
  sent: (string | ArrayBuffer)[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror = null;
  send(data: string | ArrayBuffer) {
    this.sent.push(data);
  }
  close = vi.fn();
  event(data: unknown) {
    this.onmessage?.({
      data:
        typeof data === "object" && !(data instanceof ArrayBuffer)
          ? JSON.stringify(data)
          : data,
    });
  }
  closed(code: number, reason = "") {
    this.onclose?.({ code, reason });
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
const controllers: VoiceSessionController[] = [];
function harness(
  options: {
    token?: string;
    missing?: boolean;
    realRefresh?: boolean;
    deferredCapture?: boolean;
  } = {},
) {
  let token = options.missing ? undefined : (options.token ?? "opaque-token");
  const sockets: Socket[] = [];
  const statuses: VoiceStatus[] = [];
  const refresh = deferred<string | null>();
  const capture = deferred<{ stop: () => void }>();
  const stop = vi.fn();
  let frame: (data: ArrayBuffer) => void = () => {};
  let idle = true;
  let onIdle = () => {};
  let onBlocked = () => {};
  const playback = {
    play: vi.fn(() => {
      idle = false;
    }),
    clear: vi.fn(),
    dispose: vi.fn(),
    resume: vi.fn(async () => true),
    isIdle: () => idle,
    onIdle: (cb: () => void) => {
      onIdle = cb;
    },
    onBlocked: (cb: () => void) => {
      onBlocked = cb;
    },
  };
  const persisted: { id: string; content: string }[] = [];
  const bindings = createVoiceBindings({
    publishTranscripts: vi.fn(),
    publishTool: vi.fn(),
    setMicLevel: vi.fn(),
    publishStatus: (status) => statuses.push(status),
    persistTurn: (entries) => {
      const ids = new Map<number, string>();
      for (const entry of entries) {
        const id = `message-${persisted.length}`;
        persisted.push({ id, content: entry.text });
        ids.set(entry.id, id);
      }
      useChatStore
        .getState()
        .setChatHistory(
          persisted.map((m) => ({ role: "user", content: m.content })),
        );
      return ids;
    },
    ...{
      correctPersistedMessage: (id: string, text: string) => {
        const entry = persisted.find((m) => m.id === id);
        if (entry) entry.content = text;
        useChatStore
          .getState()
          .setChatHistory(
            persisted.map((m) => ({ role: "user", content: m.content })),
          );
      },
    },
  });
  const refreshAuth = vi.fn(
    options.realRefresh
      ? refreshAccessToken
      : () =>
          refresh.promise.then((value) => {
            token = value ?? undefined;
            return value;
          }),
  );
  const navigation = vi.fn();
  const controller = new VoiceSessionController({
    wsUrl: "ws://localhost/acceptance",
    createSocket: () => {
      const s = new Socket();
      sockets.push(s);
      return s;
    },
    getToken: () =>
      options.realRefresh
        ? useAuthStore.getState().session?.accessToken
        : token,
    getAuthIdentity: () =>
      options.realRefresh
        ? (useAuthStore.getState().user?._id ?? null)
        : "test-user",
    refreshAuth,
    getUserLocation: () => null,
    createPlayback: () => playback,
    createCapture: (cb) => {
      frame = cb;
      return options.deferredCapture
        ? capture.promise
        : Promise.resolve({ stop });
    },
    onStatusChange: bindings.onStatusChange,
    onTranscript: bindings.onTranscript,
    onTranscriptCorrection: bindings.onTranscriptCorrection,
    onTurnComplete: bindings.onTurnComplete,
    onInterrupted: bindings.onInterrupted,
    onToolEvent: bindings.onToolEvent,
    onNavigationEvent: navigation,
  });
  controllers.push(controller);
  async function ready() {
    controller.start();
    sockets.at(-1)?.onopen?.();
    sockets.at(-1)?.event({
      type: "session.ready",
      capabilities: { aiRouteContractVersion: 1, routeContextSync: true },
    });
    await flush();
  }
  return {
    controller,
    sockets,
    statuses,
    playback,
    stop,
    refresh,
    refreshAuth,
    navigation,
    persisted,
    ready,
    capture,
    bindings,
    frame: (data = new ArrayBuffer(4)) => frame(data),
    idle: () => {
      idle = true;
      onIdle();
    },
    blocked: () => onBlocked(),
    setToken: (value?: string) => {
      token = value;
    },
  };
}
function currentRoute(version = 1): AccessibleRoute {
  return {
    routeId: `r${version}`,
    navigationId: "nav-a",
    routeVersion: version,
    routeToken: `t${version}`,
    routeName: `route ${version}`,
    totalMinutes: 3,
    transferCount: 0,
    legs: [],
    accessibilityHighlights: [],
  };
}
const instruction: NavInstruction = {
  text: "new step",
  type: "depart",
  bearing: null,
  relativeDirection: null,
  distanceM: 12,
  streetName: null,
  legType: "WALK",
  polylineIndex: null,
};
function seedNav() {
  const route = currentRoute();
  useMapStore.setState({
    isNavigating: true,
    activeNavigationRoute: route,
    selectRoute: { index: 0, route },
    computeRoutes: [route],
  });
  useNavStore.setState({
    navigationSource: "voice",
    navigationId: "nav-a",
    routeVersion: 1,
    instructions: [{ ...instruction, text: "old" }],
    currentStepIndex: 1,
    warnings: ["old"],
  });
}
function replacement() {
  return {
    navigationId: "nav-a",
    previousRouteVersion: 1,
    routeVersion: 2,
    routeToken: "t2",
    route: currentRoute(2),
    instructions: [instruction],
    warnings: ["new"],
    currentStepIndex: 0 as const,
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  useChatStore.getState().clearAll();
  useNavStore.getState().reset();
});
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.end();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  useMapStore.setState({
    isNavigating: false,
    activeNavigationRoute: null,
    selectRoute: null,
    computeRoutes: null,
  });
  useNavStore.getState().reset();
});

describe("frozen voice P0/P1 acceptance", () => {
  it("01/02 ending stops capture/uplink but receives and plays subsequent PCM", async () => {
    const h = harness();
    await h.ready();
    const s = h.sockets[0];
    h.frame();
    const sent = s.sent.length;
    s.event({ type: "session.ending", reason: "assistant-end" });
    expect(h.stop).toHaveBeenCalledOnce();
    h.frame();
    expect(s.sent).toHaveLength(sent);
    s.event(new ArrayBuffer(8));
    expect(h.playback.play).toHaveBeenCalledOnce();
    expect(h.playback.clear).not.toHaveBeenCalled();
    expect(s.close).not.toHaveBeenCalled();
    expect(h.controller.getStatus().status).toBe("assistant-ending");
  });
  it("01 pending microphone setup is stopped when it resolves during ending", async () => {
    const h = harness({ deferredCapture: true });
    await h.ready();
    h.sockets[0].event({ type: "session.ending", reason: "assistant-end" });
    h.capture.resolve({ stop: h.stop });
    await flush();
    expect(h.stop).toHaveBeenCalledOnce();
    expect(h.controller.getStatus().status).toBe("assistant-ending");
  });
  it.each([true, false])(
    "03/04/05/06 close drains without clearing/reconnecting/nav.stop (ending=%s)",
    async (ending) => {
      const h = harness();
      await h.ready();
      const s = h.sockets[0];
      s.event(new ArrayBuffer(4));
      if (ending) s.event({ type: "session.ending", reason: "assistant-end" });
      s.closed(1000, "assistant-end");
      expect(h.playback.clear).not.toHaveBeenCalled();
      expect(h.playback.dispose).not.toHaveBeenCalled();
      expect(h.controller.getStatus().status).toBe("draining-playback");
      await vi.advanceTimersByTimeAsync(1000);
      expect(h.sockets).toHaveLength(1);
      expect(h.navigation).not.toHaveBeenCalled();
      h.idle();
      expect(h.playback.dispose).toHaveBeenCalledOnce();
      expect(h.controller.getStatus()).toMatchObject({
        status: "ended",
        code: "assistant-end",
      });
    },
  );
  it("06 finite drain deadline cleans resources even if playback never becomes idle", async () => {
    const h = harness();
    await h.ready();
    h.sockets[0].event(new ArrayBuffer(4));
    h.sockets[0].closed(1000, "assistant-end");
    expect(h.playback.dispose).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30000);
    expect(h.playback.dispose).toHaveBeenCalledOnce();
    expect(h.controller.getStatus().status).toBe("ended");
    expect(h.stop).toHaveBeenCalledOnce();
  });
  it("06 ending is bounded when the peer never closes, without dropping farewell PCM", async () => {
    const h = harness();
    await h.ready();
    h.sockets[0].event({ type: "session.ending", reason: "assistant-end" });
    h.sockets[0].event(new ArrayBuffer(4));
    expect(h.playback.clear).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60000);
    expect(h.controller.getStatus().status).toBe("ended");
    expect(h.playback.dispose).toHaveBeenCalledOnce();
    expect(h.sockets[0].close).toHaveBeenCalled();
  });
  it("06 old idle/resume callbacks never finish a new session; repeated start does not reset ending", async () => {
    const h = harness();
    await h.ready();
    h.sockets[0].event(new ArrayBuffer(4));
    h.sockets[0].closed(1000, "assistant-end");
    h.controller.start();
    expect(h.sockets).toHaveLength(1);
    h.idle();
    h.controller.start();
    const status = h.controller.getStatus();
    h.idle();
    await vi.advanceTimersByTimeAsync(30000);
    expect(h.controller.getStatus()).toEqual(status);
    expect(h.sockets).toHaveLength(2);
  });
  it("07 abnormal close reconnects and client-end remains immediate and explicit", async () => {
    const h = harness();
    await h.ready();
    h.sockets[0].closed(1006);
    expect(h.playback.clear).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.sockets).toHaveLength(2);
    h.sockets[1].onopen?.();
    h.controller.end();
    expect(
      h.sockets[1].sent.some(
        (m) => typeof m === "string" && JSON.parse(m).type === "session.end",
      ),
    ).toBe(true);
    expect(h.playback.dispose).toHaveBeenCalledOnce();
  });
  it.each(["turn.complete", "interrupted", "contextBlocked"])(
    "08/09/10 correction after %s changes persisted history in place",
    async (boundary) => {
      const h = harness();
      await h.ready();
      const s = h.sockets[0];
      s.event({
        type: "transcript",
        role: "user",
        utteranceId: "u1",
        text: "珠北車站",
        final: true,
      });
      s.event({ type: "turn.complete" });
      const id = h.persisted[0].id;
      if (boundary === "contextBlocked") h.controller.syncRouteContext();
      else s.event({ type: boundary });
      s.event({
        type: "transcript.correction",
        role: "user",
        utteranceId: "u1",
        text: "竹北車站",
      });
      expect(h.persisted).toEqual([{ id, content: "竹北車站" }]);
      expect(useChatStore.getState().chatHistory).toEqual([
        { role: "user", content: "竹北車站" },
      ]);
    },
  );
  it("11 unknown correction is ignored; 12 disconnected generation cannot mutate reused utterance", async () => {
    const h = harness();
    await h.ready();
    const old = h.sockets[0];
    const callback = old.onmessage;
    old.event({
      type: "transcript.correction",
      utteranceId: "unknown",
      text: "bad",
    });
    expect(h.persisted).toHaveLength(0);
    h.controller.end();
    h.bindings.reset();
    await h.ready();
    h.sockets[1].event({
      type: "transcript",
      role: "user",
      utteranceId: "u1",
      text: "new",
      final: true,
    });
    h.sockets[1].event({ type: "turn.complete" });
    callback?.({
      data: JSON.stringify({
        type: "transcript.correction",
        utteranceId: "u1",
        text: "old",
      }),
    });
    expect(h.persisted.at(-1)?.content).toBe("new");
  });
  it.each([undefined, `e30.${btoa(JSON.stringify({ exp: 1 }))}.sig`])(
    "13 missing/expired token refreshes before socket construction (%s)",
    async (token) => {
      const h = harness({ token, missing: token === undefined });
      h.controller.start();
      expect(h.refreshAuth).toHaveBeenCalledOnce();
      expect(h.sockets).toHaveLength(0);
      expect(h.controller.getStatus().status).not.toBe("needs-login");
      h.refresh.resolve("fresh");
      await flush();
      expect(h.sockets).toHaveLength(1);
      h.sockets[0].onopen?.();
      expect(JSON.parse(h.sockets[0].sent[0] as string).token).toBe("fresh");
    },
  );
  it("14 concurrent starts share the existing real auth single-flight and construct only one socket", async () => {
    useAuthStore.setState({
      user: { _id: "user-a" } as NonNullable<
        ReturnType<typeof useAuthStore.getState>["user"]
      >,
      session: null,
    });
    const response = deferred<Response>();
    const fetch = vi.fn(() => response.promise);
    vi.stubGlobal("fetch", fetch);
    const h = harness({ realRefresh: true });
    h.controller.start();
    h.controller.start();
    const shared = refreshAccessToken();
    expect(fetch).toHaveBeenCalledOnce();
    response.resolve(
      new Response(JSON.stringify({ ok: true, accessToken: "fresh" })),
    );
    await shared;
    await flush();
    expect(h.sockets).toHaveLength(1);
    expect(h.refreshAuth).toHaveBeenCalledOnce();
  });
  it.each(["null", "reject"])(
    "15 refresh %s failure alone yields needs-login, never loops",
    async (kind) => {
      const h = harness({ missing: true });
      h.controller.start();
      expect(h.controller.getStatus().status).not.toBe("needs-login");
      if (kind === "null") h.refresh.resolve(null);
      else h.refresh.reject(new Error("offline"));
      await flush();
      await vi.advanceTimersByTimeAsync(60000);
      expect(h.controller.getStatus().status).toBe("needs-login");
      expect(h.refreshAuth).toHaveBeenCalledOnce();
      expect(h.sockets).toHaveLength(0);
    },
  );
  it("16 stale refresh cannot start a socket or change a restarted session", async () => {
    const h = harness({ missing: true });
    h.controller.start();
    h.controller.end();
    h.setToken("other");
    h.controller.start();
    const before = h.controller.getStatus();
    h.refresh.resolve("stale");
    await flush();
    expect(h.sockets).toHaveLength(1);
    expect(h.controller.getStatus()).toEqual(before);
  });
  it("17 only a current-generation ready resets the refresh budget", async () => {
    const h = harness();
    await h.ready();
    h.sockets[0].closed(4401);
    h.refresh.resolve("new");
    await flush();
    expect(h.refreshAuth).toHaveBeenCalledTimes(1);
    const oldCallback = h.sockets[0].onmessage;
    h.sockets[1].onopen?.();
    oldCallback?.({ data: JSON.stringify({ type: "session.ready" }) });
    h.sockets[1].closed(4401);
    await flush();
    expect(h.refreshAuth).toHaveBeenCalledTimes(1);
    expect(h.controller.getStatus().status).toBe("needs-login");
    const k = harness();
    await k.ready();
    k.sockets[0].closed(4401);
    k.refresh.resolve("fresh");
    await flush();
    k.sockets[1].onopen?.();
    k.sockets[1].event({ type: "session.ready" });
    await flush();
    k.sockets[1].closed(4401);
    await flush();
    expect(k.refreshAuth).toHaveBeenCalledTimes(2);
  });
  it("19 every raw map/nav subscriber sees route, token, steps, warnings and index atomically", () => {
    seedNav();
    const observed: unknown[] = [];
    const snapshot = () => {
      const m = useMapStore.getState();
      const n = useNavStore.getState();
      observed.push([
        m.activeNavigationRoute?.routeVersion,
        m.activeNavigationRoute?.routeToken,
        n.routeVersion,
        n.instructions[0]?.text,
        n.warnings,
        n.currentStepIndex,
      ]);
    };
    const a = useMapStore.subscribe(snapshot);
    const b = useNavStore.subscribe(snapshot);
    try {
      expect(applyRouteReplacement(replacement())).toBe(true);
      expect(observed.length).toBeGreaterThan(0);
      for (const state of observed)
        expect(state).toEqual([2, "t2", 2, "new step", ["new"], 0]);
    } finally {
      a();
      b();
    }
  });
  it.each([
    { navigationId: "other" },
    { routeVersion: 4 },
    { routeVersion: 1 },
    { previousRouteVersion: 0 },
  ])("20 invalid replacement %j leaves both stores untouched", (bad) => {
    seedNav();
    const m = useMapStore.getState();
    const n = useNavStore.getState();
    expect(applyRouteReplacement({ ...replacement(), ...bad })).toBe(false);
    expect(useMapStore.getState()).toBe(m);
    expect(useNavStore.getState()).toBe(n);
  });
  it("22 assistant-end leaves active navigation, snapshot and UI intact", async () => {
    seedNav();
    const m = useMapStore.getState();
    const n = useNavStore.getState();
    const h = harness();
    await h.ready();
    h.sockets[0].event({ type: "session.ending", reason: "assistant-end" });
    h.sockets[0].closed(1000, "assistant-end");
    h.idle();
    expect(useMapStore.getState()).toBe(m);
    expect(useNavStore.getState()).toBe(n);
    expect(h.navigation).not.toHaveBeenCalled();
  });
});
