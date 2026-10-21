import { describe, expect, it, vi } from "vitest";
import useMapStore from "@/stores/useMapStore";
import { VoiceSessionController, type VoiceSocket } from "../voiceSession";
import { createVoiceBindings } from "../voiceSessionBindings";
import type { VoiceToolActivity } from "../voiceTools";

function session(
  location: { latitude: number; longitude: number } | null = null,
  routeCapability = true,
) {
  const sent: unknown[] = [];
  const socket: VoiceSocket = {
    send: (message) =>
      sent.push(typeof message === "string" ? JSON.parse(message) : message),
    close: vi.fn(),
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  const onToolEvent = vi.fn();
  const controller = new VoiceSessionController({
    wsUrl: "wss://test",
    createSocket: () => socket,
    refreshAuth: async () => null,
    getToken: () => "token",
    getAuthIdentity: () => "user",
    getUserLocation: () => location,
    createCapture: async () => ({ stop: vi.fn() }),
    createPlayback: () => ({
      play: vi.fn(),
      clear: vi.fn(),
      dispose: vi.fn(),
      resume: async () => true,
      onBlocked: vi.fn(),
    }),
    onStatusChange: vi.fn(),
    onTranscript: vi.fn(),
    onToolEvent,
    onNavigationEvent: vi.fn(),
  });
  const event = (message: unknown) =>
    socket.onmessage?.({ data: JSON.stringify(message) });
  controller.start();
  socket.onopen?.();
  event({
    type: "session.ready",
    ...(routeCapability
      ? { capabilities: { aiRouteContractVersion: 1, routeContextSync: true } }
      : {}),
  });
  return { sent, controller, event, onToolEvent };
}

const call = {
  type: "tool_call",
  name: "findNearbyParking",
  callId: "c1",
  turnId: "t1",
};
const result = {
  ...call,
  type: "tool_result",
  ok: true,
  durationMs: 12,
  result: { parkingSpots: [] },
};

describe("voice tool/event coverage regressions", () => {
  it("answers location.request on the same socket using existing authorized location", () => {
    const h = session({ latitude: 25.03, longitude: 121.56 });
    h.event({ type: "location.request" });
    expect(h.sent.at(-1)).toEqual({
      type: "nav.position",
      latitude: 25.03,
      longitude: 121.56,
    });
    h.controller.end();
  });
  it("keeps voice available when no authorized location exists", () => {
    const h = session();
    const count = h.sent.length;
    h.event({ type: "location.request" });
    expect(h.sent).toHaveLength(count);
    expect(h.controller.isActive()).toBe(true);
    h.controller.end();
  });
  it("does not require route-adoption capability to deliver a recoverable LOCATION_REQUIRED failure", () => {
    const h = session(null, false);
    h.event({ ...call, name: "planAccessibleRoute" });
    h.event({
      ...result,
      name: "planAccessibleRoute",
      result: { ok: false, reason: "LOCATION_REQUIRED" },
    });
    expect(h.controller.isActive()).toBe(true);
    expect(h.onToolEvent).toHaveBeenCalledTimes(2);
    h.controller.end();
  });
  it("rejects cross-turn results and still accepts the correct result", () => {
    const h = session();
    h.event(call);
    h.event({ ...result, turnId: "another" });
    expect(h.onToolEvent).toHaveBeenCalledTimes(1);
    h.event(result);
    expect(h.onToolEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ callId: "c1", turnId: "t1", type: "result" }),
    );
    h.controller.end();
  });
  it("does not deliver an interrupted call's late result", () => {
    const h = session();
    h.event(call);
    h.event({ type: "interrupted" });
    h.event(result);
    expect(h.onToolEvent).toHaveBeenCalledTimes(1);
    h.controller.end();
  });
  it("does not redisplay a duplicate completed call", () => {
    const h = session();
    h.event(call);
    h.event(result);
    h.event(call);
    h.event(result);
    expect(h.onToolEvent).toHaveBeenCalledTimes(2);
    h.controller.end();
  });
  it("pairs concurrent same-name results by callId, retaining complete payloads", () => {
    const publishToolActivities = vi.fn<(items: VoiceToolActivity[]) => void>();
    const bindings = createVoiceBindings({
      publishTool: vi.fn(),
      publishToolActivities,
      publishStatus: vi.fn(),
      publishTranscripts: vi.fn(),
      setMicLevel: vi.fn(),
    });
    bindings.onToolEvent({ ...call, type: "call" });
    bindings.onToolEvent({ ...call, type: "call", callId: "c2" });
    const payload = {
      parkingSpots: [{ name: "市府停車場", lat: 25.03, lng: 121.56 }],
    };
    bindings.onToolEvent({
      ...result,
      type: "result",
      callId: "c2",
      result: payload,
    });
    const activities = publishToolActivities.mock.calls.at(-1)?.[0];
    expect(
      activities?.map((activity) => [activity.event.callId, activity.state]),
    ).toEqual([
      ["c1", "pending"],
      ["c2", "done"],
    ]);
    expect(activities?.[1].event.result).toBe(payload);
  });
  it.each([
    {
      ok: true,
      result: {
        ok: false,
        reason: "LOCATION_REQUIRED",
        error: "請提供目前位置",
      },
    },
    { ok: true, result: { error: "資料庫查詢失敗" } },
    { ok: true, result: { status: "REQUEST_DENIED" } },
    { ok: false, result: { status: "OK", places: [] } },
  ])("shows a truthful failure without map side effects for %j", (failure) => {
    const publishToolActivities = vi.fn<(items: VoiceToolActivity[]) => void>();
    const bindings = createVoiceBindings({
      publishTool: vi.fn(),
      publishToolActivities,
      publishStatus: vi.fn(),
      publishTranscripts: vi.fn(),
      setMicLevel: vi.fn(),
    });
    const before = useMapStore.getState();
    bindings.onToolEvent({
      type: "result",
      name: "planAccessibleRoute",
      ...failure,
    });
    expect(useMapStore.getState()).toBe(before);
    expect(publishToolActivities.mock.calls.at(-1)?.[0][0].state).toBe(
      "failed",
    );
  });
  it.each(["interrupted", "complete", "disconnected"])(
    "clears the active loading indicator when %s",
    (ending) => {
      const publishTool = vi.fn();
      const bindings = createVoiceBindings({
        publishTool,
        publishStatus: vi.fn(),
        publishTranscripts: vi.fn(),
        setMicLevel: vi.fn(),
      });
      bindings.onToolEvent({ ...call, type: "call" });
      if (ending === "interrupted") bindings.onInterrupted();
      else if (ending === "complete") bindings.onTurnComplete();
      else bindings.onStatusChange({ status: "reconnecting" });
      expect(publishTool).toHaveBeenLastCalledWith(null);
    },
  );
});
