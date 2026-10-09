"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import i18n from "@/i18n/client";
import { getAppLanguage } from "@/i18n/language";
import {
  getRouteConversationInput,
  getVoiceHistory,
} from "@/lib/ai/routeConversation";
import { refreshAccessToken } from "@/lib/authRefresh";
import { END_POINT } from "@/lib/config";
import { createCapture } from "@/lib/voice/audioCapture";
import { createPlayback } from "@/lib/voice/audioPlayback";
import {
  type VoiceNavigationEvent,
  type VoiceNavigationPosition,
  type VoiceNavigationResumeState,
  VoiceSessionController,
  type VoiceSocket,
  type VoiceStatus,
  type VoiceToolEvent,
} from "@/lib/voice/voiceSession";
import { createVoiceBindings } from "@/lib/voice/voiceSessionBindings";
import useAuthStore from "@/stores/useAuthStore";
import useChatStore from "@/stores/useChatStore";
import useMapStore from "@/stores/useMapStore";
import useNavStore from "@/stores/useNavStore";
import useVoiceStore, {
  type VoiceTranscriptEntry,
} from "@/stores/useVoiceStore";

/**
 * Derive the voice WS URL from `END_POINT` (plan §3/§8). Every existing
 * `src/lib/api/*.ts` call builds URLs as `${END_POINT}/api/v1/...`, so
 * `END_POINT` itself carries no `/api/v1` prefix — this mirrors that
 * convention and only swaps the http(s) scheme for ws(s).
 */
function buildWsUrl(): string {
  try {
    const url = new URL(`${END_POINT}/api/v1/voice/ws`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.toString();
  } catch {
    return "ws://localhost:3000/api/v1/voice/ws";
  }
}

const VOICE_WS_URL = buildWsUrl();

/**
 * Native WebSocket adapter (plan §5.9 / round3-F1). `binaryType` is set to
 * `"arraybuffer"` immediately after construction — before any handler is
 * wired up on either the real socket or the adapter object — because the
 * browser default (`"blob"`) would make the controller's downlink
 * dispatch discard every binary frame as an unrecognized payload type
 * instead of forwarding it to playback.
 */
function createSocket(url: string): VoiceSocket {
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";

  const socket: VoiceSocket = {
    send: (data) => ws.send(data),
    close: (code, reason) => ws.close(code, reason),
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };

  ws.onopen = () => socket.onopen?.();
  ws.onmessage = (event) => socket.onmessage?.({ data: event.data });
  ws.onclose = (event) =>
    socket.onclose?.({ code: event.code, reason: event.reason });
  ws.onerror = (event) => socket.onerror?.(event);

  return socket;
}

function getUserLocation(): { latitude: number; longitude: number } | null {
  const location = useMapStore.getState().userLocation;
  if (!location) return null;
  const { lat, lng } = location;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  return { latitude: lat, longitude: lng };
}

/**
 * Snapshot for `nav.resume` after a reconnect (WP4). Only a backend-owned
 * navigation that is still running can be resumed: the local engine keeps
 * driving itself, and an arrived/absent navigation has nothing to re-attach
 * to, so both return `null` and the controller sends no message.
 */
function getNavigationResumeState(): VoiceNavigationResumeState | null {
  const map = useMapStore.getState();
  const nav = useNavStore.getState();
  if (!map.isNavigating || nav.navigationSource !== "voice" || nav.arrived) {
    return null;
  }

  const route = map.activeNavigationRoute ?? map.selectRoute?.route;
  const navigationId = route?.navigationId ?? nav.navigationId;
  const routeToken = route?.routeToken;
  if (
    !navigationId ||
    typeof routeToken !== "string" ||
    routeToken.length === 0
  ) {
    return null;
  }

  const location = map.userLocation;
  const heading = nav.userHeading ?? nav.gpsHeading;
  return {
    navigationId,
    routeVersion: route?.routeVersion ?? nav.routeVersion,
    routeToken,
    lastKnownStepIndex: nav.currentStepIndex,
    ...(location
      ? {
          currentPosition: {
            latitude: location.lat,
            longitude: location.lng,
            ...(heading == null ? {} : { heading }),
          },
        }
      : {}),
  };
}

export interface UseVoiceSessionResult {
  status: VoiceStatus;
  transcripts: VoiceTranscriptEntry[];
  activeTool: VoiceToolEvent | null;
  navigationEvents: VoiceNavigationEvent[];
  startSession: () => void;
  endSession: () => void;
  resumePlayback: () => void;
  setNavigationRoute: (routeToken: string | null) => void;
  sendNavigationPosition: (position: VoiceNavigationPosition) => void;
  cancelNavigation: () => void;
  consumeNavigationEvents: (count: number) => void;
  setMuted: (muted: boolean) => void;
}

/**
 * Thin React wrapper around `VoiceSessionController` (plan §4). The sole
 * consumer is `VoiceSessionHost`, which mirrors the state returned here
 * into `useVoiceStore` so it stays available to `VoiceModeView` and
 * `VoiceFloatingIndicator` even while `AIChatBot` (and this hook's own
 * previous instance) has unmounted.
 */
export default function useVoiceSession(): UseVoiceSessionResult {
  const [status, setStatusState] = useState<VoiceStatus>({ status: "idle" });
  const [transcripts, setTranscripts] = useState<VoiceTranscriptEntry[]>([]);
  const [activeTool, setActiveTool] = useState<VoiceToolEvent | null>(null);
  const [navigationEvents, setNavigationEvents] = useState<
    VoiceNavigationEvent[]
  >([]);

  // Read inside the auth subscription below without re-subscribing on
  // every status change.
  const statusRef = useRef(status);
  statusRef.current = status;

  // Identity captured when startSession() runs; compared against the auth
  // store on every change while the session is active (plan §5.8 rev13).
  const identityAtStartRef = useRef<string | null>(null);

  // Plan §3.3 (rev3): all transcript aggregation, turn-boundary sealing and
  // mic-level zeroing wiring lives in this pure module, constructed once so
  // React re-renders never replace its aggregator/prev-status state.
  const contextInputPausedRef = useRef(false);
  const bindingsRef = useRef<ReturnType<typeof createVoiceBindings> | null>(
    null,
  );
  if (!bindingsRef.current) {
    bindingsRef.current = createVoiceBindings({
      publishTranscripts: (entries) =>
        setTranscripts(entries as VoiceTranscriptEntry[]),
      publishStatus: (next) => {
        if (next.code === "AI_ROUTE_UNAVAILABLE")
          toast.error("目前無法將這份 AI 路線載入地圖，請手動規劃新行程。");
        statusRef.current = next;
        setStatusState(next);
      },
      publishTool: (event) => setActiveTool(event),
      setMicLevel: (level) =>
        useVoiceStore
          .getState()
          .setMicLevel(contextInputPausedRef.current ? 0 : level),
      persistTurn: (entries, summaries) => {
        const history = entries
          .filter((entry) => entry.text)
          .map((entry) => ({
            role:
              entry.role === "model"
                ? ("assistant" as const)
                : ("user" as const),
            content: entry.text,
            ...(entry.role === "model" ? { tool_summaries: summaries } : {}),
          }));
        useChatStore
          .getState()
          .setChatHistory((previous) => [...previous, ...history]);
      },
    });
  }
  const bindings = bindingsRef.current;

  const controllerRef = useRef<VoiceSessionController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new VoiceSessionController({
      wsUrl: VOICE_WS_URL,
      createSocket,
      refreshAuth: () => refreshAccessToken(),
      getToken: () => useAuthStore.getState().session?.accessToken,
      getAuthIdentity: () => useAuthStore.getState().user?._id ?? null,
      getUserLocation,
      getConversationInput: getRouteConversationInput,
      getHistory: getVoiceHistory,
      getLanguage: getAppLanguage,
      getRouteGeneration: () => useMapStore.getState().routeGeneration,
      onRouteContextStatus: (status) => {
        contextInputPausedRef.current =
          status === "deferred" || status === "pending" || status === "failed";
        if (contextInputPausedRef.current)
          useVoiceStore.getState().setMicLevel(0);
        if (status === "deferred") return;
        if (status === "pending")
          toast.loading("正在同步選中路線，請稍候再提問。", {
            id: "voice-route-context",
          });
        else toast.dismiss("voice-route-context");
        if (status === "failed")
          toast.error("路線脈絡同步失敗，請重試同步後再提問。", {
            id: "voice-route-context",
            duration: Infinity,
            action: {
              label: "重試同步",
              onClick: () => controllerRef.current?.syncRouteContext(),
            },
          });
        if (status === "unsupported")
          toast.info("此環境尚未支援語音路線同步，請改用手動路線規劃。");
      },
      createCapture: (onFrame) =>
        createCapture(bindings.wrapCaptureFrame(onFrame)),
      createPlayback: () => createPlayback(),
      onStatusChange: bindings.onStatusChange,
      onTranscript: bindings.onTranscript,
      onTranscriptCorrection: bindings.onTranscriptCorrection,
      onTurnComplete: bindings.onTurnComplete,
      onInterrupted: bindings.onInterrupted,
      onToolEvent: bindings.onToolEvent,
      onNavigationEvent: (event) =>
        setNavigationEvents((pending) => [...pending, event]),
      getNavigationResumeState,
    });
  }

  useEffect(() => {
    const reconnect = () => controllerRef.current?.reconnectForLanguageChange();
    i18n.on("languageChanged", reconnect);
    return () => {
      i18n.off("languageChanged", reconnect);
    };
  }, []);

  useEffect(
    () =>
      useMapStore.subscribe((state, previous) => {
        const startingNavigation =
          state.isNavigating &&
          (!previous.isNavigating ||
            state.activeNavigationRoute !== previous.activeNavigationRoute);
        if (startingNavigation) controllerRef.current?.syncRouteContext();
        else if (state.routeGeneration !== previous.routeGeneration) {
          controllerRef.current?.syncRouteContext({
            deferUntilIdle:
              !state.isNavigating &&
              !!state.selectRoute &&
              state.invalidRouteTokens === previous.invalidRouteTokens,
          });
        }
      }),
    [],
  );

  // §5.8 rev13: a session already in progress must end as soon as the
  // token disappears or the signed-in identity changes underneath it —
  // the controller only re-validates identity at specific points (start,
  // (re)connect, refresh), so this proactive subscription is what ends an
  // already-`listening` session immediately on logout/account switch
  // instead of waiting for the next reconnect attempt.
  useEffect(() => {
    const unsubscribe = useAuthStore.subscribe((state) => {
      const current = statusRef.current.status;
      if (current === "idle" || current === "ended") return; // nothing active
      const token = state.session?.accessToken;
      const identity = state.user?._id ?? null;
      if (!token || identity !== identityAtStartRef.current) {
        controllerRef.current?.end();
      }
    });
    return unsubscribe;
  }, []);

  // Unmount cleanup (plan §4 useVoiceSession row): cancels timers, closes
  // the socket, and releases audio resources via controller.end(); also
  // zeroes the store's micLevel via bindings.dispose() (§3.3).
  useEffect(() => {
    return () => {
      controllerRef.current?.end();
      bindings.dispose();
    };
  }, [bindings]);

  const startSession = useCallback(() => {
    identityAtStartRef.current = useAuthStore.getState().user?._id ?? null;
    bindings.reset();
    setActiveTool(null);
    setNavigationEvents([]);
    controllerRef.current?.start();
  }, [bindings]);

  const endSession = useCallback(() => {
    toast.dismiss("voice-route-context");
    controllerRef.current?.end();
  }, []);

  const resumePlayback = useCallback(() => {
    controllerRef.current?.resumePlayback();
  }, []);

  const setNavigationRoute = useCallback((routeToken: string | null) => {
    controllerRef.current?.setNavigationRoute(routeToken);
  }, []);

  const sendNavigationPosition = useCallback(
    (position: VoiceNavigationPosition) => {
      controllerRef.current?.sendNavigationPosition(position);
    },
    [],
  );

  const cancelNavigation = useCallback(() => {
    controllerRef.current?.cancelNavigation();
  }, []);

  const setMuted = useCallback(
    (muted: boolean) => {
      controllerRef.current?.setMuted(muted);
      // The recording dot reads `micLevel`, which is fed by capture frames the
      // controller now drops: gate it here or a muted mic keeps pulsing.
      bindings.setMuted(muted);
    },
    [bindings],
  );

  const consumeNavigationEvents = useCallback((count: number) => {
    setNavigationEvents((pending) => pending.slice(count));
  }, []);

  return {
    status,
    transcripts,
    activeTool,
    navigationEvents,
    startSession,
    endSession,
    resumePlayback,
    setNavigationRoute,
    sendNavigationPosition,
    cancelNavigation,
    consumeNavigationEvents,
    setMuted,
  };
}
