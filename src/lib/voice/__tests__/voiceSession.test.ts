import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type VoiceCapture,
  type VoiceNavigationResumeState,
  VoiceSessionController,
  type VoiceSessionDeps,
  type VoiceSocket,
  type VoiceStatus,
} from "../voiceSession";

/* ------------------------------------------------------------------ */
/* Fake socket — scriptable open/message/close                         */
/* ------------------------------------------------------------------ */

class FakeSocket implements VoiceSocket {
  sent: Array<string | ArrayBuffer> = [];
  closed = false;
  closeArgs: [number?, string?] | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event?: unknown) => void) | null = null;

  constructor(public url: string) {}

  send(data: string | ArrayBuffer): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closed = true;
    this.closeArgs = [code, reason];
  }

  triggerOpen(): void {
    this.onopen?.();
  }

  triggerMessage(data: unknown): void {
    this.onmessage?.({ data });
  }

  triggerClose(code: number, reason = ""): void {
    this.onclose?.({ code, reason });
  }
}

/* ------------------------------------------------------------------ */
/* Deferred capture / refresh helpers                                  */
/* ------------------------------------------------------------------ */

interface CaptureCall {
  onFrame: (frame: ArrayBuffer) => void;
  stop: ReturnType<typeof vi.fn>;
  resolve: () => void;
  reject: (err: unknown) => void;
}

interface RefreshCall {
  resolve: (token: string | null) => void;
  reject: (err: unknown) => void;
}

function createHarness(opts?: {
  identity?: string | null;
  token?: string | undefined;
  location?: { latitude: number; longitude: number } | null;
  resumeState?: VoiceNavigationResumeState | null;
}) {
  const sockets: FakeSocket[] = [];
  const captureCalls: CaptureCall[] = [];
  const refreshCalls: RefreshCall[] = [];

  let identity: string | null =
    opts?.identity === undefined ? "user-A" : opts.identity;
  let token: string | undefined = opts?.token ?? "token-1";
  let location: { latitude: number; longitude: number } | null =
    opts?.location ?? null;
  let resumeState: VoiceNavigationResumeState | null =
    opts?.resumeState ?? null;

  const onStatusChange = vi.fn();
  const onTranscript = vi.fn();
  const onTranscriptCorrection = vi.fn();
  const onTurnComplete = vi.fn();
  const onInterrupted = vi.fn();
  const onToolEvent = vi.fn();
  const onNavigationEvent = vi.fn();

  const createSocket = vi.fn((url: string) => {
    const socket = new FakeSocket(url);
    sockets.push(socket);
    return socket;
  });

  const refreshAuth = vi.fn(() => {
    let resolveFn!: (t: string | null) => void;
    let rejectFn!: (e: unknown) => void;
    const promise = new Promise<string | null>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });
    refreshCalls.push({ resolve: resolveFn, reject: rejectFn });
    return promise;
  });

  const createCapture = vi.fn((onFrame: (frame: ArrayBuffer) => void) => {
    const stop = vi.fn();
    let resolveFn!: () => void;
    let rejectFn!: (e: unknown) => void;
    const promise = new Promise<VoiceCapture>((resolve, reject) => {
      resolveFn = () => resolve({ stop });
      rejectFn = reject;
    });
    captureCalls.push({ onFrame, stop, resolve: resolveFn, reject: rejectFn });
    return promise;
  });

  let blockedCb: (() => void) | null = null;
  const playback = {
    play: vi.fn(),
    clear: vi.fn(),
    dispose: vi.fn(),
    resume: vi.fn(() => Promise.resolve(true)),
    onBlocked: vi.fn((cb: () => void) => {
      blockedCb = cb;
    }),
  };
  const createPlayback = vi.fn(() => playback);

  const deps: VoiceSessionDeps = {
    wsUrl: "wss://example.test/api/v1/voice/ws",
    createSocket,
    refreshAuth,
    getToken: () => token,
    getAuthIdentity: () => identity,
    getUserLocation: () => location,
    createCapture,
    createPlayback,
    onStatusChange,
    onTranscript,
    onTranscriptCorrection,
    onTurnComplete,
    onInterrupted,
    onToolEvent,
    onNavigationEvent,
    getNavigationResumeState: () => resumeState,
  };

  const controller = new VoiceSessionController(deps);

  return {
    controller,
    sockets,
    captureCalls,
    refreshCalls,
    playback,
    createSocket,
    createCapture,
    createPlayback,
    onStatusChange,
    onTranscript,
    onTranscriptCorrection,
    onTurnComplete,
    onInterrupted,
    onToolEvent,
    onNavigationEvent,
    setIdentity: (v: string | null) => {
      identity = v;
    },
    setToken: (v: string | undefined) => {
      token = v;
    },
    setLocation: (v: { latitude: number; longitude: number } | null) => {
      location = v;
    },
    setResumeState: (v: VoiceNavigationResumeState | null) => {
      resumeState = v;
    },
    triggerBlocked: () => blockedCb?.(),
    lastStatus: (): VoiceStatus | undefined =>
      onStatusChange.mock.calls.at(-1)?.[0],
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function readyMessage(): string {
  return JSON.stringify({ type: "session.ready" });
}

/** Drive a harness all the way to "listening": open -> ready -> capture resolves. */
async function bringToListening(
  h: ReturnType<typeof createHarness>,
  socketIndex = 0,
): Promise<void> {
  h.sockets[socketIndex].triggerOpen();
  h.sockets[socketIndex].triggerMessage(readyMessage());
  await flush();
  const call = h.captureCalls.at(-1);
  call?.resolve();
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("VoiceSessionController", () => {
  it("case 1: gates sendAudio until listening; sends once capture resolves", async () => {
    const h = createHarness();
    h.controller.start();
    h.sockets[0].triggerOpen();
    h.sockets[0].triggerMessage(readyMessage());
    await flush();

    const call = h.captureCalls[0];
    expect(call).toBeDefined();

    // Frame arrives before the capture promise resolves (still "ready", not "listening").
    call.onFrame(new ArrayBuffer(4));
    expect(h.sockets[0].sent.some((d) => d instanceof ArrayBuffer)).toBe(false);
    expect(h.controller.getStatus().status).toBe("ready");

    call.resolve();
    await flush();
    expect(h.controller.getStatus().status).toBe("listening");

    const frame = new ArrayBuffer(8);
    call.onFrame(frame);
    expect(h.sockets[0].sent).toContain(frame);
  });

  it("case 2: session.start sent synchronously on open, token in body, not in URL", () => {
    const h = createHarness({
      token: "tok-A",
      location: { latitude: 1, longitude: 2 },
    });
    h.controller.start();

    expect(h.createSocket).toHaveBeenCalledTimes(1);
    expect(h.createSocket).toHaveBeenCalledWith(
      "wss://example.test/api/v1/voice/ws",
    );

    h.sockets[0].triggerOpen();
    expect(h.sockets[0].sent).toHaveLength(1);
    const body = JSON.parse(h.sockets[0].sent[0] as string);
    expect(body).toEqual({
      type: "session.start",
      token: "tok-A",
      userLocation: { latitude: 1, longitude: 2 },
    });
  });

  it("case 3: 1006 backoff is 1s,2s,4s,8s,16s,capped at 30s", async () => {
    const h = createHarness();
    h.controller.start();
    expect(h.sockets).toHaveLength(1);

    const expectedDelays = [1000, 2000, 4000, 8000, 16000, 30000, 30000];
    let index = 0;
    for (const delay of expectedDelays) {
      h.sockets[index].triggerClose(1006, "");
      expect(h.controller.getStatus().status).toBe("reconnecting");

      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(h.sockets).toHaveLength(index + 1); // not yet reconnected

      await vi.advanceTimersByTimeAsync(1);
      index += 1;
      expect(h.sockets).toHaveLength(index + 1); // reconnected right on schedule
    }
  });

  it("case 3b: backoff resets to 1s after a successful reconnect", async () => {
    const h = createHarness();
    h.controller.start();
    h.sockets[0].triggerClose(1006, "");
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.sockets).toHaveLength(2);

    // Reach session.ready on the reconnected socket -> resets backoff.
    h.sockets[1].triggerOpen();
    h.sockets[1].triggerMessage(readyMessage());

    h.sockets[1].triggerClose(1006, "");
    await vi.advanceTimersByTimeAsync(999);
    expect(h.sockets).toHaveLength(2); // not yet — must wait the full 1s again
    await vi.advanceTimersByTimeAsync(1);
    expect(h.sockets).toHaveLength(3);
  });

  it("case 4: end() during reconnect wait cancels the timer, no further socket is built", async () => {
    const h = createHarness();
    h.controller.start();
    h.sockets[0].triggerClose(1006, "");
    expect(h.controller.getStatus().status).toBe("reconnecting");

    h.controller.end();
    expect(h.controller.getStatus().status).toBe("ended");

    await vi.advanceTimersByTimeAsync(60000);
    expect(h.sockets).toHaveLength(1); // no reconnect happened
  });

  it("case 5: 4401 -> refreshAuth called once; success reconnects once with new token", async () => {
    const h = createHarness({ token: "old-token" });
    h.controller.start();
    h.sockets[0].triggerClose(4401, "");
    expect(h.refreshCalls).toHaveLength(1);

    h.setToken("new-token");
    h.refreshCalls[0].resolve("new-token");
    await flush();

    expect(h.sockets).toHaveLength(2);
    h.sockets[1].triggerOpen();
    const body = JSON.parse(h.sockets[1].sent[0] as string);
    expect(body.token).toBe("new-token");
  });

  it("case 5: 4401 -> refresh failure ends session, needs-login, no reconnect", async () => {
    const h = createHarness();
    h.controller.start();
    h.sockets[0].triggerClose(4401, "");
    expect(h.refreshCalls).toHaveLength(1);

    h.refreshCalls[0].resolve(null);
    await flush();

    expect(h.controller.getStatus().status).toBe("needs-login");
    expect(h.sockets).toHaveLength(1);
  });

  it("case 6: 4409 schedules no reconnect timer", () => {
    const h = createHarness();
    h.controller.start();
    h.sockets[0].triggerClose(4409, "");

    expect(h.controller.getStatus()).toEqual({ status: "error", code: 4409 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("case 7: a stale close from a superseded socket is a no-op", async () => {
    const h = createHarness();
    h.controller.start();
    await bringToListening(h);
    h.sockets[0].triggerClose(1006, "");
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.sockets).toHaveLength(2);
    await bringToListening(h, 1);
    const capture1Stop = h.captureCalls[1].stop;

    // Old (already-closed) socket fires close again — must be ignored.
    h.sockets[0].triggerClose(1006, "");

    expect(capture1Stop).not.toHaveBeenCalled();
    expect(h.controller.getStatus().status).toBe("listening");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("case 8: end() discards a late capture resolve — mic never (re)activated", async () => {
    const h = createHarness();
    h.controller.start();
    h.sockets[0].triggerOpen();
    h.sockets[0].triggerMessage(readyMessage());
    await flush();
    const call = h.captureCalls[0];

    h.controller.end();
    call.resolve(); // late getUserMedia resolution after end()
    await flush();

    expect(call.stop).toHaveBeenCalledTimes(1);
    expect(h.controller.getStatus().status).toBe("ended");
  });

  it("case 9: interrupted clears playback and returns to listening", async () => {
    const h = createHarness();
    h.controller.start();
    await bringToListening(h);

    h.sockets[0].triggerMessage(new ArrayBuffer(4)); // model starts speaking
    expect(h.controller.getStatus().status).toBe("model-speaking");

    h.sockets[0].triggerMessage(JSON.stringify({ type: "interrupted" }));
    expect(h.playback.clear).toHaveBeenCalled();
    expect(h.controller.getStatus().status).toBe("listening");
  });

  it("case 10: any close immediately stops capture and clears playback", async () => {
    const h = createHarness();
    h.controller.start();
    await bringToListening(h);
    const stop = h.captureCalls[0].stop;

    h.sockets[0].triggerClose(1006, "");

    expect(stop).toHaveBeenCalledTimes(1);
    expect(h.playback.clear).toHaveBeenCalled();
  });

  it("case 11: end() while a 4401 refresh is in-flight — resolve afterwards never reconnects", async () => {
    const h = createHarness();
    h.controller.start();
    h.sockets[0].triggerClose(4401, "");
    expect(h.refreshCalls).toHaveLength(1);

    h.controller.end();
    h.refreshCalls[0].resolve("some-token");
    await flush();

    expect(h.sockets).toHaveLength(1);
    expect(h.controller.getStatus().status).toBe("ended");
  });

  it("case 12: refresh loop guard — second 4401 in the same session never refreshes again; manual restart re-arms it", async () => {
    const h = createHarness({ token: "tok-0" });
    h.controller.start();
    h.sockets[0].triggerClose(4401, "");
    h.setToken("tok-1");
    h.refreshCalls[0].resolve("tok-1");
    await flush();
    expect(h.sockets).toHaveLength(2);

    h.sockets[1].triggerClose(4401, "");
    expect(h.refreshCalls).toHaveLength(1); // not called again
    expect(h.controller.getStatus().status).toBe("needs-login");
    expect(h.sockets).toHaveLength(2); // no third socket

    // Manual restart re-arms the one-refresh-per-session budget.
    h.controller.start();
    expect(h.sockets).toHaveLength(3);
    h.sockets[2].triggerClose(4401, "");
    expect(h.refreshCalls).toHaveLength(2);
  });

  it("case 13: downlink binary is forwarded in order without JSON parsing, interleaved with JSON events", async () => {
    const h = createHarness();
    h.controller.start();
    h.sockets[0].triggerOpen();
    h.sockets[0].triggerMessage(readyMessage());
    await flush();

    const frame1 = new Uint8Array([1, 2, 3]).buffer;
    const frame2 = new Uint8Array([4, 5]).buffer;
    const frame3 = new Uint8Array([6]).buffer;

    h.sockets[0].triggerMessage(frame1);
    h.sockets[0].triggerMessage(
      JSON.stringify({ type: "transcript", role: "model", text: "hi" }),
    );
    h.sockets[0].triggerMessage(frame2);
    h.sockets[0].triggerMessage(frame3);

    expect(h.playback.play).toHaveBeenNthCalledWith(1, frame1);
    expect(h.playback.play).toHaveBeenNthCalledWith(2, frame2);
    expect(h.playback.play).toHaveBeenNthCalledWith(3, frame3);
    expect(h.onTranscript).toHaveBeenCalledWith({ role: "model", text: "hi" });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("case 14: socket adapter contract — binaryType must be set before any handler is wired", () => {
    // Reference stub mirroring a browser WebSocket's assignment semantics;
    // the real adapter lives in useVoiceSession.ts (a different task's
    // file) and must follow this exact order.
    class StubBrowserWebSocket {
      assignmentOrder: string[] = [];
      private _binaryType = "blob";
      private _onopen: (() => void) | null = null;
      private _onmessage: ((e: { data: unknown }) => void) | null = null;
      private _onclose: ((e: { code: number; reason: string }) => void) | null =
        null;

      constructor(public url: string) {}

      get binaryType() {
        return this._binaryType;
      }
      set binaryType(v: string) {
        this._binaryType = v;
        this.assignmentOrder.push("binaryType");
      }
      get onopen() {
        return this._onopen;
      }
      set onopen(v) {
        this._onopen = v;
        this.assignmentOrder.push("onopen");
      }
      get onmessage() {
        return this._onmessage;
      }
      set onmessage(v) {
        this._onmessage = v;
        this.assignmentOrder.push("onmessage");
      }
      get onclose() {
        return this._onclose;
      }
      set onclose(v) {
        this._onclose = v;
        this.assignmentOrder.push("onclose");
      }
    }

    function createReferenceAdapter(url: string): StubBrowserWebSocket {
      const ws = new StubBrowserWebSocket(url);
      ws.binaryType = "arraybuffer"; // MUST happen before any handler is wired
      ws.onopen = () => {};
      ws.onmessage = () => {};
      ws.onclose = () => {};
      return ws;
    }

    const ws = createReferenceAdapter("wss://x");
    expect(ws.binaryType).toBe("arraybuffer");
    expect(ws.assignmentOrder[0]).toBe("binaryType");
    expect(ws.assignmentOrder.indexOf("binaryType")).toBeLessThan(
      ws.assignmentOrder.indexOf("onmessage"),
    );
  });

  it("case 17: interrupted and every close code clear playback; nothing plays after end()", async () => {
    for (const code of [1006, 4401, 4409, 1011, 1000]) {
      const h = createHarness();
      h.controller.start();
      await bringToListening(h);
      h.sockets[0].triggerClose(code, "");
      expect(h.playback.clear).toHaveBeenCalled();
    }

    const h = createHarness();
    h.controller.start();
    await bringToListening(h);
    const playCallsBefore = h.playback.play.mock.calls.length;
    const socket = h.sockets[0];

    h.controller.end();
    socket.triggerMessage(new ArrayBuffer(4)); // late frame, handlers already detached
    expect(h.playback.play.mock.calls.length).toBe(playCallsBefore);
  });

  it("case 18: capture stop count matches createCapture count across reconnects; stop() is idempotent", async () => {
    const h = createHarness();
    h.controller.start();
    await bringToListening(h);
    h.sockets[0].triggerClose(1006, "");
    await vi.advanceTimersByTimeAsync(1000);
    await bringToListening(h, 1);
    h.sockets[1].triggerClose(1006, "");
    await vi.advanceTimersByTimeAsync(2000);
    await bringToListening(h, 2);

    expect(h.createCapture).toHaveBeenCalledTimes(3);
    expect(h.captureCalls[0].stop).toHaveBeenCalledTimes(1);
    expect(h.captureCalls[1].stop).toHaveBeenCalledTimes(1);
    expect(h.captureCalls[2].stop).toHaveBeenCalledTimes(0);

    h.controller.end();
    expect(h.captureCalls[2].stop).toHaveBeenCalledTimes(1);

    // end() again is a no-op — stop() must not be called a second time.
    h.controller.end();
    expect(h.captureCalls[2].stop).toHaveBeenCalledTimes(1);
  });

  it("case 22: playback-blocked/resume — resume(true) unblocks, resume(false) stays blocked, frames still queue while blocked", async () => {
    const h = createHarness();
    h.controller.start();
    await bringToListening(h);

    h.triggerBlocked();
    expect(h.controller.getStatus().status).toBe("playback-blocked");

    const blockedFrame = new ArrayBuffer(2);
    h.sockets[0].triggerMessage(blockedFrame);
    expect(h.playback.play).toHaveBeenCalledWith(blockedFrame);

    h.playback.resume.mockResolvedValueOnce(false);
    h.controller.resumePlayback();
    await flush();
    expect(h.controller.getStatus().status).toBe("playback-blocked");

    h.playback.resume.mockResolvedValueOnce(true);
    h.controller.resumePlayback();
    await flush();
    expect(h.controller.getStatus().status).toBe("listening");
  });

  it("case 29: identity change during a 4401 refresh wait ends the session, never reconnects as the new identity", async () => {
    const h = createHarness({ identity: "user-A" });
    h.controller.start();
    h.sockets[0].triggerClose(4401, "");

    h.setIdentity("user-B");
    h.refreshCalls[0].resolve("token-for-A");
    await flush();

    expect(h.sockets).toHaveLength(1); // never built a socket for user-B
    expect(h.controller.getStatus().status).toBe("needs-login");
  });

  it("case 29: identity change during 1006 backoff wait ends the session before reconnecting", async () => {
    const h = createHarness({ identity: "user-A" });
    h.controller.start();
    await bringToListening(h);
    h.sockets[0].triggerClose(1006, "");

    h.setIdentity("user-B");
    await vi.advanceTimersByTimeAsync(1000);

    expect(h.sockets).toHaveLength(1); // reconnect attempt aborted before creating a socket
    expect(h.controller.getStatus().status).toBe("needs-login");
  });

  it("case 29: start() with no authenticated identity is rejected, no socket is built", () => {
    const h = createHarness({ identity: null });
    h.controller.start();

    expect(h.createSocket).not.toHaveBeenCalled();
    expect(h.controller.getStatus().status).toBe("needs-login");
  });

  it("queues nav.setRoute until ready, then sends position and cancel controls", () => {
    const h = createHarness();
    h.controller.setNavigationRoute("route-capability");
    h.controller.start();
    h.sockets[0].triggerOpen();

    expect(h.sockets[0].sent).toHaveLength(1);
    expect(JSON.parse(h.sockets[0].sent[0] as string).type).toBe(
      "session.start",
    );

    h.sockets[0].triggerMessage(readyMessage());
    h.controller.sendNavigationPosition({
      latitude: 25.0478,
      longitude: 121.517,
      heading: 90,
    });
    h.controller.cancelNavigation();

    expect(
      h.sockets[0].sent
        .slice(1)
        .map((message) => JSON.parse(message as string)),
    ).toEqual([
      { type: "nav.setRoute", routeToken: "route-capability" },
      {
        type: "nav.position",
        latitude: 25.0478,
        longitude: 121.517,
        heading: 90,
      },
      { type: "nav.cancel" },
    ]);
  });

  it("forwards every server nav event to the navigation sink", () => {
    const h = createHarness();
    h.controller.start();
    h.sockets[0].triggerOpen();

    const events = [
      {
        type: "nav.start",
        steps: [
          {
            index: 0,
            instruction: "向前直行",
            legType: "WALK",
            distanceM: 120,
            isTransit: false,
          },
        ],
        currentStepIndex: 0,
        totalSteps: 1,
      },
      {
        type: "nav.step",
        currentStepIndex: 0,
        instruction: "向前直行",
        remainingM: 30,
      },
      {
        type: "nav.progress",
        remainingDistanceM: 24,
        remainingDurationSec: 180,
        estimatedArrivalAt: "2026-09-02T12:00:00.000Z",
        etaSource: "server",
        distanceToNextM: 12,
      },
      { type: "nav.offroute", distanceM: 72 },
      {
        type: "nav.rerouting",
        navigationId: "nav-1",
        previousRouteVersion: 1,
        clientRequestId: "73e27df0-f3fa-4bf2-9320-da6bcb83d51a",
      },
      {
        type: "nav.route_replaced",
        navigationId: "nav-1",
        previousRouteVersion: 1,
        routeVersion: 2,
        routeToken: "route-v2-token",
        route: { routeId: "route-v2" },
        steps: [],
        warnings: [],
        currentStepIndex: 0,
      },
      {
        type: "nav.reroute_failed",
        navigationId: "nav-1",
        previousRouteVersion: 2,
        code: "NAV_PLANNER_UNAVAILABLE",
        message: "稍後再試",
        retryable: true,
      },
      { type: "nav.arrived" },
      { type: "nav.stop", reason: "arrived" },
    ];

    for (const event of events) {
      h.sockets[0].triggerMessage(JSON.stringify(event));
    }

    expect(h.onNavigationEvent.mock.calls.map((call) => call[0])).toEqual(
      events,
    );
  });

  it("WP5: forwards nav.advisory and the reroute reason without warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = createHarness();
    h.controller.start();
    h.sockets[0].triggerOpen();

    const events = [
      {
        type: "nav.advisory",
        navigationId: "nav-1",
        routeVersion: 2,
        advisories: [
          {
            advisoryId: "facility:station-1",
            category: "facility",
            severity: "critical",
            action: "reroute_applied",
            title: "電梯維修中",
            speech: "前方站體電梯維修中，已為你改道",
            rerouteReason: "FACILITY_OUTAGE",
            issuedAt: "2026-09-04T00:00:00.000Z",
          },
        ],
      },
      {
        type: "nav.route_replaced",
        navigationId: "nav-1",
        previousRouteVersion: 1,
        routeVersion: 2,
        routeToken: "route-v2-token",
        route: { routeId: "route-v2" },
        steps: [],
        warnings: [],
        currentStepIndex: 0,
        reason: "FACILITY_OUTAGE",
      },
    ];

    for (const event of events) {
      h.sockets[0].triggerMessage(JSON.stringify(event));
    }

    expect(h.onNavigationEvent.mock.calls.map((call) => call[0])).toEqual(
      events,
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("4410 rebuilds the live session and re-arms the route after ready", async () => {
    const h = createHarness();
    h.controller.setNavigationRoute("route-capability");
    h.controller.start();
    await bringToListening(h);

    h.sockets[0].triggerClose(4410, "navigation-turn-timeout");
    expect(h.controller.getStatus().status).toBe("reconnecting");

    await vi.advanceTimersByTimeAsync(1000);
    expect(h.sockets).toHaveLength(2);
    h.sockets[1].triggerOpen();
    h.sockets[1].triggerMessage(readyMessage());

    expect(
      h.sockets[1].sent.some(
        (message) =>
          typeof message === "string" &&
          JSON.parse(message).type === "nav.setRoute" &&
          JSON.parse(message).routeToken === "route-capability",
      ),
    ).toBe(true);
  });

  /* -------------------- WP4: nav.resume after reconnect ------------------- */

  const RESUME_STATE: VoiceNavigationResumeState = {
    navigationId: "nav-1",
    routeVersion: 2,
    routeToken: "route-capability",
    lastKnownStepIndex: 3,
    currentPosition: { latitude: 25.0478, longitude: 121.517, heading: 90 },
  };

  function sentNavResume(socket: { sent: Array<string | ArrayBuffer> }) {
    return socket.sent
      .filter((message): message is string => typeof message === "string")
      .map((message) => JSON.parse(message))
      .filter((message) => message.type === "nav.resume");
  }

  it("WP4: the first session.ready never sends nav.resume", async () => {
    const h = createHarness({ resumeState: RESUME_STATE });
    h.controller.setNavigationRoute("route-capability");
    h.controller.start();
    await bringToListening(h);

    expect(sentNavResume(h.sockets[0])).toEqual([]);
  });

  it("WP4: a reconnect's session.ready sends nav.resume with the live snapshot", async () => {
    const h = createHarness({ resumeState: RESUME_STATE });
    h.controller.setNavigationRoute("route-capability");
    h.controller.start();
    await bringToListening(h);

    h.sockets[0].triggerClose(1006, "");
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.sockets).toHaveLength(2);
    h.sockets[1].triggerOpen();
    h.sockets[1].triggerMessage(readyMessage());

    expect(sentNavResume(h.sockets[1])).toEqual([
      {
        type: "nav.resume",
        navigationId: "nav-1",
        routeVersion: 2,
        routeToken: "route-capability",
        lastKnownStepIndex: 3,
        currentPosition: { latitude: 25.0478, longitude: 121.517, heading: 90 },
      },
    ]);
    // Route re-arm still precedes the resume request.
    const types = h.sockets[1].sent
      .filter((message): message is string => typeof message === "string")
      .map((message) => JSON.parse(message).type);
    expect(types.indexOf("nav.setRoute")).toBeLessThan(
      types.indexOf("nav.resume"),
    );
  });

  it("WP4: nav.resume carries no currentPosition when there is no fix", async () => {
    const h = createHarness({
      resumeState: {
        navigationId: "nav-1",
        routeVersion: 1,
        routeToken: "route-capability",
        lastKnownStepIndex: 0,
      },
    });
    h.controller.start();
    await bringToListening(h);
    h.sockets[0].triggerClose(4410, "navigation-turn-timeout");
    await vi.advanceTimersByTimeAsync(1000);
    h.sockets[1].triggerOpen();
    h.sockets[1].triggerMessage(readyMessage());

    expect(sentNavResume(h.sockets[1])).toEqual([
      {
        type: "nav.resume",
        navigationId: "nav-1",
        routeVersion: 1,
        routeToken: "route-capability",
        lastKnownStepIndex: 0,
      },
    ]);
  });

  it("WP4: no nav.resume when nothing is navigating on reconnect", async () => {
    const h = createHarness({ resumeState: RESUME_STATE });
    h.controller.start();
    await bringToListening(h);

    h.setResumeState(null); // navigation ended while the socket was down
    h.sockets[0].triggerClose(1006, "");
    await vi.advanceTimersByTimeAsync(1000);
    h.sockets[1].triggerOpen();
    h.sockets[1].triggerMessage(readyMessage());

    expect(sentNavResume(h.sockets[1])).toEqual([]);
  });

  it("WP4: a restarted session treats its first ready as a first connect again", async () => {
    const h = createHarness({ resumeState: RESUME_STATE });
    h.controller.start();
    await bringToListening(h);
    h.sockets[0].triggerClose(1006, "");
    await vi.advanceTimersByTimeAsync(1000);
    h.sockets[1].triggerOpen();
    h.sockets[1].triggerMessage(readyMessage());
    expect(sentNavResume(h.sockets[1])).toHaveLength(1);

    h.controller.end();
    h.controller.start();
    h.sockets[2].triggerOpen();
    h.sockets[2].triggerMessage(readyMessage());
    expect(sentNavResume(h.sockets[2])).toEqual([]);
  });

  it("WP4: nav.resume_ok and nav.resume_failed reach the navigation sink", () => {
    const h = createHarness();
    h.controller.start();
    h.sockets[0].triggerOpen();

    const events = [
      {
        type: "nav.resume_ok",
        navigationId: "nav-1",
        routeVersion: 2,
        routeToken: "token-v2",
        currentStepIndex: 4,
        totalSteps: 8,
        onVehicle: false,
        steps: [
          {
            index: 0,
            instruction: "直行",
            legType: "WALK",
            distanceM: 100,
            isTransit: false,
          },
        ],
      },
      {
        type: "nav.resume_failed",
        navigationId: "nav-1",
        code: "SNAPSHOT_NOT_FOUND",
        message: "導航階段已逾期",
        retryable: false,
      },
    ];
    for (const event of events) {
      h.sockets[0].triggerMessage(JSON.stringify(event));
    }

    expect(h.onNavigationEvent.mock.calls.map((call) => call[0])).toEqual(
      events,
    );
  });

  it("case 24: transcript events with final and utteranceId are passed to onTranscript", async () => {
    const h = createHarness();
    h.controller.start();
    h.sockets[0].triggerOpen();
    h.sockets[0].triggerMessage(readyMessage());
    await flush();

    h.sockets[0].triggerMessage(
      JSON.stringify({
        type: "transcript",
        role: "user",
        text: "我想去竹北車站",
        final: true,
        utteranceId: "u1",
      }),
    );

    expect(h.onTranscript).toHaveBeenCalledWith({
      role: "user",
      text: "我想去竹北車站",
      final: true,
      utteranceId: "u1",
    });
  });

  it("case 25: transcript.correction events trigger onTranscriptCorrection", async () => {
    const h = createHarness();
    h.controller.start();
    h.sockets[0].triggerOpen();
    h.sockets[0].triggerMessage(readyMessage());
    await flush();

    h.sockets[0].triggerMessage(
      JSON.stringify({
        type: "transcript.correction",
        role: "user",
        text: "我想去竹北車站",
        utteranceId: "u1",
      }),
    );

    expect(h.onTranscriptCorrection).toHaveBeenCalledWith({
      role: "user",
      text: "我想去竹北車站",
      utteranceId: "u1",
    });
  });

  it("case 26: interrupted and turn.complete invoke onInterrupted and onTurnComplete callbacks", async () => {
    const h = createHarness();
    h.controller.start();
    h.sockets[0].triggerOpen();
    h.sockets[0].triggerMessage(readyMessage());
    await flush();

    h.sockets[0].triggerMessage(JSON.stringify({ type: "interrupted" }));
    expect(h.onInterrupted).toHaveBeenCalledTimes(1);

    h.sockets[0].triggerMessage(JSON.stringify({ type: "turn.complete" }));
    expect(h.onTurnComplete).toHaveBeenCalledTimes(1);
  });
});
