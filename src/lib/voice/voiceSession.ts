import type { RouteConversationInput } from "@/lib/ai/routeConversation";
import type {
  AccessibleRoute,
  NavInstruction,
  RouteMessageDetail,
} from "@/types/route";
import { toolResultFailure } from "./voiceTools";

/**
 * VoiceSessionController — pure TS state machine for the realtime voice
 * assistant WebSocket session (Gemini Live proxy).
 *
 * No React, no direct browser API usage: every effectful dependency
 * (socket transport, mic capture, playback, auth) is injected via the
 * constructor so the whole state machine can run and be tested in Node.
 *
 * Protocol reference: VOICE_WS_PROTOCOL.md §3 (message types), §6 (close
 * codes), §6.1 (reconnect). See plan `memory/reviews/plans/c53da5fe11faa273.md`
 * §5.7–§5.10 and §6 for the exact concurrency/boundary contract implemented
 * here.
 */

/* ------------------------------------------------------------------ */
/* Wire protocol types (VOICE_WS_PROTOCOL.md §3)                        */
/* ------------------------------------------------------------------ */

/** Client -> server: must be the first message, sent within 5s of open. */
interface SessionStartMessage extends Partial<RouteConversationInput> {
  history?: {
    role: "user" | "assistant";
    text: string;
    tools?: { name: string; summary: string }[];
  }[];
  type: "session.start";
  token: string;
  language?: "zh-TW" | "en";
  userLocation?: { latitude: number; longitude: number };
}

// The gateway's 8 KiB control-frame limit includes the entire session.start JSON.
const CONTROL_FRAME_MAX_BYTES = 8 * 1024;

function encodeSessionStart(message: SessionStartMessage): string | null {
  const encoder = new TextEncoder();
  const original = JSON.stringify(message);
  if (encoder.encode(original).byteLength <= CONTROL_FRAME_MAX_BYTES)
    return original;

  const { history = [], ...required } = message;
  let payload = JSON.stringify(required);
  if (encoder.encode(payload).byteLength > CONTROL_FRAME_MAX_BYTES) return null;

  const retained: NonNullable<SessionStartMessage["history"]> = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const candidate = JSON.stringify({
      ...required,
      history: [history[i], ...retained],
    });
    if (encoder.encode(candidate).byteLength > CONTROL_FRAME_MAX_BYTES) break;
    retained.unshift(history[i]);
    payload = candidate;
  }
  return payload;
}

/** Client -> server: graceful end, server acks with close(1000, "client-end"). */
interface SessionEndMessage {
  type: "session.end";
}

interface NavSetRouteMessage {
  type: "nav.setRoute";
  routeToken: string;
}

export interface VoiceNavigationPosition {
  latitude: number;
  longitude: number;
  heading?: number;
  accuracy?: number;
}

interface NavPositionMessage extends VoiceNavigationPosition {
  type: "nav.position";
}

interface NavCancelMessage {
  type: "nav.cancel";
}

/**
 * Client -> server: re-attach to an in-flight backend navigation after the
 * socket was rebuilt (§6.1 reconnect). Sent right after `session.ready` of a
 * *reconnect* — never of the first connect, where there is nothing to resume.
 * The server answers with `nav.resume_ok` or `nav.resume_failed`.
 */
interface NavResumeMessage {
  type: "nav.resume";
  navigationId: string;
  routeVersion: number;
  routeToken: string;
  lastKnownStepIndex: number;
  currentPosition?: VoiceNavigationPosition;
}

/** Snapshot the adapter provides so the controller can build nav.resume. */
export interface VoiceNavigationResumeState {
  navigationId: string;
  routeVersion: number;
  routeToken: string;
  lastKnownStepIndex: number;
  currentPosition?: VoiceNavigationPosition;
}

/** Server -> client: auth + Gemini connect done, client may now send audio. */
interface SessionReadyMessage {
  type: "session.ready";
  capabilities?: {
    aiRouteContractVersion?: number;
    routeContextSync?: boolean;
  };
}

interface TranscriptMessage {
  type: "transcript";
  role: "user" | "model";
  text: string;
  final?: boolean;
  utteranceId?: string;
}

interface TranscriptCorrectionMessage {
  type: "transcript.correction";
  role?: "user";
  text: string;
  utteranceId: string;
}

interface ToolCallMessage {
  callId?: string;
  turnId?: string;
  summary?: string;
  type: "tool_call";
  name: string;
}

interface ToolResultMessage {
  callId?: string;
  turnId?: string;
  summary?: string;
  type: "tool_result";
  name: string;
  ok: boolean;
  durationMs: number;
  result?: unknown;
  args?: unknown;
}

interface InterruptedMessage {
  type: "interrupted";
}

interface TurnCompleteMessage {
  type: "turn.complete";
}

interface ErrorMessage {
  type: "error";
  code: "LIVE_CONNECT_FAILED" | "LIVE_SESSION_ENDED" | string;
}

export interface VoiceNavStep {
  index: number;
  instruction: string;
  legType: "WALK" | "DRIVE" | "MOTORCYCLE" | "BUS" | "METRO" | "THSR" | "TRA";
  distanceM: number | null;
  isTransit: boolean;
  type?: string;
  relativeDirection?: string | null;
  streetName?: string | null;
  bearing?: number | null;
}

export type VoiceRerouteReason =
  | "OFF_ROUTE"
  | "FACILITY_OUTAGE"
  | "CONFIRMED_HAZARD"
  | "TRANSIT_DISRUPTION"
  | "MANUAL";

export interface VoiceNavAdvisory {
  advisoryId: string;
  category: "facility" | "transit_alert" | "hazard" | "traffic";
  severity: "info" | "warning" | "critical";
  action: "none" | "reroute_suggested" | "reroute_applied";
  title: string;
  detail?: string;
  speech: string;
  rerouteReason?: VoiceRerouteReason;
  location?: { latitude: number; longitude: number };
  distanceAheadM?: number;
  issuedAt: string;
}

export type VoiceNavigationEvent =
  | {
      type: "nav.start";
      /** Frontend-only identity captured from the armed route on an explicit start tool call. */
      armedRouteToken?: string;
      selectionGeneration?: number;
      steps: VoiceNavStep[];
      currentStepIndex: number;
      totalSteps: number;
    }
  | {
      type: "nav.step";
      currentStepIndex: number;
      instruction: string;
      remainingM: number | null;
    }
  | {
      type: "nav.progress";
      navigationId: string;
      routeVersion: number;
      currentStepIndex: number;
      remainingDistanceM: number;
      remainingDurationSec: number;
      estimatedArrivalAt: string;
      etaSource: "schedule" | "realtime" | "free_flow" | "estimated";
      distanceToNextM: number | null;
    }
  | {
      type: "nav.transit";
      leg: {
        mode: "BUS" | "METRO" | "THSR" | "TRA";
        from: string;
        to: string;
        routeName?: string;
      };
    }
  | { type: "nav.arrived" }
  | {
      type: "nav.stop";
      reason: "user_voice" | "user_ui" | "arrived" | "session_end";
    }
  | { type: "nav.offroute"; distanceM: number }
  | {
      type: "nav.rerouting";
      navigationId: string;
      previousRouteVersion: number;
      clientRequestId: string;
      reason?: VoiceRerouteReason;
    }
  | ({
      type: "nav.route_replaced";
      navigationId: string;
      previousRouteVersion: number;
      routeVersion: number;
      routeToken: string;
      route: AccessibleRoute;
      warnings: string[];
      warningDetails?: RouteMessageDetail[];
      currentStepIndex: 0;
      reason?: VoiceRerouteReason;
    } & (
      | { instructions: NavInstruction[]; steps?: never }
      | { steps: VoiceNavStep[]; instructions?: never }
    ))
  | {
      type: "nav.reroute_failed";
      navigationId: string;
      previousRouteVersion: number;
      code: string;
      message: string;
      retryable: boolean;
    }
  | {
      type: "nav.resume_ok";
      navigationId: string;
      routeVersion: number;
      routeToken: string;
      currentStepIndex: number;
      totalSteps: number;
      onVehicle: boolean;
      steps: VoiceNavStep[];
    }
  | {
      type: "nav.resume_failed";
      navigationId: string;
      code:
        | "INVALID_REQUEST"
        | "SNAPSHOT_NOT_FOUND"
        | "USER_MISMATCH"
        | "ROUTE_VERSION_MISMATCH"
        | "ROUTE_EXPIRED";
      message: string;
      retryable: boolean;
    }
  | {
      type: "nav.advisory";
      navigationId: string;
      routeVersion: number;
      advisories: VoiceNavAdvisory[];
    }
  | {
      type: "nav.error";
      code: "NAV_ROUTE_INVALID" | "NO_ROUTE_ARMED";
      message: string;
    };

/**
 * Deliberately narrower than isVoiceSessionActive: connecting/reconnecting/
 * error/needs-login keep a session object alive but emit no audio, so local
 * TTS must take over. playback-blocked stays live because its audio is already
 * buffered and plays on resume — speaking locally would duplicate it.
 */
export function isVoiceSpeechChannelLive(status: VoiceStatusName): boolean {
  return (
    status === "ready" ||
    status === "listening" ||
    status === "model-speaking" ||
    status === "playback-blocked" ||
    status === "assistant-ending" ||
    status === "draining-playback"
  );
}

/**
 * nav.advisory is a pure UI alert that never touches the navigation state
 * machine, so a degraded voice transport must not swallow it. Every other
 * event mutates navigation identity/step/route and keeps the drop behaviour.
 */
export function requiresLiveVoiceSession(
  type: VoiceNavigationEvent["type"],
): boolean {
  return type !== "nav.advisory";
}

export function filterApplicableNavigationEvents(
  events: VoiceNavigationEvent[],
  status: VoiceStatusName,
): VoiceNavigationEvent[] {
  if (isVoiceSpeechChannelLive(status)) return events;
  return events.filter((event) => !requiresLiveVoiceSession(event.type));
}

/** The navigation an inbound advisory has to match to be shown. */
export interface AdvisoryTarget {
  isNavigating: boolean;
  arrived: boolean;
  navigationId: string | null;
  routeVersion: number;
}

/**
 * Fail closed: without a known identity to compare against there is no way
 * to tell a stale advisory from a current one, and injecting it would attach
 * the previous navigation's hazards to whatever route is running now.
 */
export function shouldAcceptAdvisoryEvent(
  event: Extract<VoiceNavigationEvent, { type: "nav.advisory" }>,
  target: AdvisoryTarget,
): boolean {
  return (
    target.isNavigating &&
    !target.arrived &&
    target.navigationId !== null &&
    event.navigationId === target.navigationId &&
    event.routeVersion === target.routeVersion
  );
}

type ServerEventMessage =
  | SessionReadyMessage
  | TranscriptMessage
  | TranscriptCorrectionMessage
  | ToolCallMessage
  | ToolResultMessage
  | InterruptedMessage
  | TurnCompleteMessage
  | ErrorMessage
  | VoiceNavigationEvent
  | { type: string };

/* ------------------------------------------------------------------ */
/* Close codes (VOICE_WS_PROTOCOL.md §6)                                */
/* ------------------------------------------------------------------ */

const CLOSE_AUTH_EXPIRED = 4401;
const CLOSE_CONFLICT = 4409;
const CLOSE_NORMAL = 1000;
const CLOSE_SERVER_ERROR = 1011;
const CLOSE_ABNORMAL = 1006;
const CLOSE_NAV_TURN_TIMEOUT = 4410;

const REASON_LIVE_SESSION_ENDED = "live-session-ended";
const ASSISTANT_END = "assistant-end";
/** Bound a missing peer close and a stalled audio queue independently. */
const ENDING_TIMEOUT_MS = 15000;
const PLAYBACK_DRAIN_TIMEOUT_MS = 15000;

/** Expiry is only a preflight hint, never a substitute for server auth. */
function isUsableToken(token: string | undefined): token is string {
  if (!token?.trim()) return false;
  try {
    const payload = token.split(".")[1];
    if (!payload) return true; // opaque tokens remain server-validated
    const decoded = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
    );
    return typeof decoded.exp !== "number" || decoded.exp * 1000 > Date.now();
  } catch {
    return true;
  }
}

/** Initial reconnect backoff (ms). Doubles each 1006 retry, capped at 30s. */
const RECONNECT_INITIAL_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;

/* ------------------------------------------------------------------ */
/* Injected dependency interfaces                                      */
/* ------------------------------------------------------------------ */

/**
 * WS-like transport the controller drives. Adapters (e.g. the real
 * `useVoiceSession` hook) MUST set `binaryType = "arraybuffer"` on the
 * underlying WebSocket BEFORE assigning any of the handler properties
 * below — otherwise downlink audio arrives as Blob instead of
 * ArrayBuffer and the controller's onmessage dispatch (§5.9) will warn
 * and discard it instead of forwarding it to playback.
 */
export interface VoiceSocket {
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event?: unknown) => void) | null;
}

export interface VoicePlayback {
  play(frame: ArrayBuffer): void;
  clear(): void;
  dispose(): void;
  resume(): Promise<boolean>;
  onBlocked(cb: () => void): void;
  isIdle?(): boolean;
  onIdle?(cb: () => void): void;
  setMuted?(muted: boolean): void;
}

export interface VoiceCapture {
  stop(): void;
}

export type VoiceStatusName =
  | "idle"
  | "connecting"
  | "ready"
  | "listening"
  | "model-speaking"
  | "reconnecting"
  | "playback-blocked"
  | "assistant-ending"
  | "draining-playback"
  | "needs-login"
  | "ended"
  | "error";

export interface VoiceStatus {
  status: VoiceStatusName;
  /** Present when status === "error" (close code or a local error tag). */
  code?: number | string;
}

export interface VoiceToolEvent {
  callId?: string;
  turnId?: string;
  summary?: string;
  type: "call" | "result";
  name: string;
  ok?: boolean;
  durationMs?: number;
  result?: unknown;
  args?: unknown;
}

export interface VoiceTranscript {
  role: "user" | "model";
  text: string;
  final?: boolean;
  utteranceId?: string;
}

export interface VoiceTranscriptCorrection {
  role?: "user";
  text: string;
  utteranceId: string;
}

export interface VoiceSessionDeps {
  getLanguage?(): SessionStartMessage["language"];
  getConversationInput?(): RouteConversationInput;
  getHistory?(): SessionStartMessage["history"];
  getRouteGeneration?(): number;
  onRouteContextStatus?(
    status: "deferred" | "pending" | "synced" | "failed" | "unsupported",
  ): void;

  wsUrl: string;
  createSocket(url: string): VoiceSocket;
  refreshAuth(): Promise<string | null>;
  getToken(): string | undefined;
  getAuthIdentity(): string | null;
  getUserLocation(): { latitude: number; longitude: number } | null;
  createCapture(onFrame: (frame: ArrayBuffer) => void): Promise<VoiceCapture>;
  createPlayback(): VoicePlayback;
  onStatusChange(status: VoiceStatus): void;
  onTranscript(transcript: VoiceTranscript): void;
  onTranscriptCorrection?(correction: VoiceTranscriptCorrection): void;
  onTurnComplete?(): void;
  onInterrupted?(): void;
  onToolEvent(event: VoiceToolEvent): void;
  onNavigationEvent(event: VoiceNavigationEvent): void;
  /**
   * Current backend-owned navigation, read synchronously right after a
   * reconnect's `session.ready`. Returning `null` (not navigating, or the
   * local engine owns navigation) skips `nav.resume` entirely.
   */
  getNavigationResumeState?(): VoiceNavigationResumeState | null;
}

/* ------------------------------------------------------------------ */
/* Controller                                                           */
/* ------------------------------------------------------------------ */

export class VoiceSessionController {
  private sessionLanguage: SessionStartMessage["language"];
  private status: VoiceStatus = { status: "idle" };

  /**
   * Monotonically increasing generation. Bumped by every new socket
   * attempt (connect()) and by every terminal transition (terminate()).
   * Any async callback (socket event, refresh resolve, capture resolve,
   * reconnect timer) captures the generation value valid at the time it
   * was scheduled and compares it against `this.generation` when it
   * fires; a mismatch means the callback is stale and must no-op. This
   * single counter is sufficient to isolate every race in §5.7 because
   * every transition away from "this generation is current" bumps it.
   */
  private generation = 0;

  /** Whether start() has been called and end() has not (yet) followed. */
  private sessionActive = false;

  /** Identity captured at start(); re-checked before every socket build. */
  private identityAtStart: string | null = null;

  /** One refresh until a current-generation ready reopens the budget. */
  private hasRefreshed = false;
  private refreshPending: {
    generation: number;
    promise: Promise<string | null>;
  } | null = null;
  private endingTimer: ReturnType<typeof setTimeout> | null = null;
  private drainTimer: ReturnType<typeof setTimeout> | null = null;

  private socket: VoiceSocket | null = null;
  private capture: VoiceCapture | null = null;
  private playback: VoicePlayback | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = RECONNECT_INITIAL_DELAY_MS;
  private muted = false;
  /** Latest selected HTTP route capability; re-armed after every reconnect. */
  private routeToken: string | null = null;

  /**
   * True once this session has seen a `session.ready`. Every later ready is
   * therefore a *reconnect* ready — the only point at which `nav.resume` is
   * meaningful.
   */
  private hasBeenReady = false;
  private deferredContext = false;
  private modelTurnActive = false;
  private contextSupported = false;
  private contextBlocked = false;
  private selectionVersion = 0;
  private pendingContext: {
    requestId: string;
    selectionVersion: number;
  } | null = null;
  private contextTimer: ReturnType<typeof setTimeout> | null = null;
  private initializedContext: string | null = null;
  private toolCalls = new Map<
    string,
    { name: string; turnId?: string; generation: number }
  >();
  private completedCalls = new Set<string>();
  private pendingStartRoute: {
    routeToken: string | null;
    generation: number;
  } | null = null;
  private ignoreNavigation = false;

  private isPendingStartStale(): boolean {
    return (
      this.pendingStartRoute !== null &&
      (this.pendingStartRoute.generation !==
        (this.deps.getRouteGeneration?.() ?? 0) ||
        this.pendingStartRoute.routeToken !== this.routeToken)
    );
  }

  syncRouteContext(options: { deferUntilIdle?: boolean } = {}): void {
    if (!this.sessionActive || this.isEnding()) return;
    const supersededStart = this.isPendingStartStale();
    if (supersededStart) this.cancelNavigation();
    if (
      options.deferUntilIdle &&
      !supersededStart &&
      !this.contextBlocked &&
      (this.modelTurnActive || this.playback?.isIdle?.() === false)
    ) {
      this.deferredContext = true;
      this.deps.onRouteContextStatus?.("deferred");
      return;
    }
    this.deferredContext = false;
    this.modelTurnActive = false;
    this.playback?.clear();
    this.toolCalls.clear();
    this.contextBlocked = true;
    if (!this.contextSupported) {
      this.deps.onRouteContextStatus?.("unsupported");
      return;
    }
    if (this.contextTimer) clearTimeout(this.contextTimer);
    const selectionVersion = ++this.selectionVersion;
    const requestId = `selection-${selectionVersion}`;
    this.pendingContext = { requestId, selectionVersion };
    this.deps.onRouteContextStatus?.("pending");
    this.socket?.send(
      JSON.stringify({
        type: "route.context.set",
        requestId,
        selectionVersion,
        routeContext: this.deps.getConversationInput?.().routeContext ?? null,
      }),
    );
    this.contextTimer = setTimeout(() => {
      this.pendingContext = null;
      this.deps.onRouteContextStatus?.("failed");
    }, 10000);
  }

  private flushDeferredContext(): void {
    if (
      this.deferredContext &&
      !this.modelTurnActive &&
      this.playback?.isIdle?.() !== false
    ) {
      this.syncRouteContext();
    }
  }

  constructor(private readonly deps: VoiceSessionDeps) {}

  /* ---------------------------- public API ---------------------------- */

  start(): void {
    if (this.sessionActive) return;

    const identity = this.deps.getAuthIdentity();
    if (identity === null) {
      // §5.7: identity null at start → reject, never build a socket.
      this.setStatus({ status: "needs-login" });
      return;
    }

    this.identityAtStart = identity;
    this.sessionActive = true;
    this.hasRefreshed = false;
    this.hasBeenReady = false;
    this.muted = false;
    this.reconnectDelay = RECONNECT_INITIAL_DELAY_MS;

    const playback = this.deps.createPlayback();
    this.playback = playback;
    playback.onIdle?.(() => {
      if (!this.sessionActive || this.playback !== playback) return;
      if (this.status.status === "draining-playback")
        this.finishAssistantEnd(playback);
      else if (!this.isEnding()) this.flushDeferredContext();
    });
    playback.onBlocked(() => {
      if (!this.sessionActive || this.playback !== playback) return;
      this.setStatus(
        this.isEnding()
          ? { ...this.status, code: "PLAYBACK_BLOCKED" }
          : { status: "playback-blocked" },
      );
    });

    this.setStatus({ status: "connecting" });
    this.connect();
  }

  isActive(): boolean {
    return this.sessionActive;
  }

  /** Store notifications during refresh failure must not race needs-login into ended. */
  handleAuthChange(): void {
    if (!this.sessionActive) return;
    if (this.deps.getAuthIdentity() !== this.identityAtStart) {
      this.terminate(
        { status: this.refreshPending ? "needs-login" : "ended" },
        true,
      );
    } else if (!this.deps.getToken() && !this.refreshPending) {
      this.end();
    }
  }

  private isEnding(): boolean {
    return (
      this.status.status === "assistant-ending" ||
      this.status.status === "draining-playback"
    );
  }

  end(): void {
    // Repeated UI commands and unmount cleanup cannot truncate an accepted farewell.
    // The peer-close/drain deadlines still release every resource after unmount.
    if (!this.sessionActive || this.isEnding()) return;
    this.terminate({ status: "ended" }, /* sendEndMessage */ true);
  }

  /** Rebuild only the transport: session.end/nav.cancel would delete nav snapshots. */
  reconnectForLanguageChange(): void {
    if (
      !this.sessionActive ||
      this.isEnding() ||
      this.deps.getLanguage?.() === this.sessionLanguage
    )
      return;
    this.clearReconnectTimer();
    this.stopCapture();
    this.playback?.clear();
    this.setStatus({ status: "reconnecting" });
    this.connect();
  }

  setMuted(muted: boolean): void {
    if (this.isEnding()) return;
    this.muted = muted;
    this.playback?.setMuted?.(muted);
    this.flushDeferredContext();
  }

  resumePlayback(): void {
    const playback = this.playback;
    if (!playback) return;
    const gen = this.generation;
    playback.resume().then((ok) => {
      if (
        !this.sessionActive ||
        this.playback !== playback ||
        gen !== this.generation
      )
        return;
      if (ok) {
        this.setStatus(
          this.isEnding()
            ? { status: this.status.status }
            : { status: "listening" },
        );
      }
      // ok === false: remain in playback-blocked, nothing to do.
    });
  }

  setNavigationRoute(routeToken: string | null): void {
    this.routeToken = routeToken;
    if (routeToken) {
      this.sendControl({ type: "nav.setRoute", routeToken });
    }
  }

  sendNavigationPosition(position: VoiceNavigationPosition): void {
    this.sendControl({ type: "nav.position", ...position });
  }

  cancelNavigation(): void {
    this.ignoreNavigation = true;
    this.sendControl({ type: "nav.cancel" });
  }

  getStatus(): VoiceStatus {
    return { ...this.status };
  }

  /* ------------------------------ internals ----------------------------- */

  private setStatus(status: VoiceStatus): void {
    this.status = status;
    this.deps.onStatusChange(status);
  }

  private sendControl(
    message:
      | NavSetRouteMessage
      | NavPositionMessage
      | NavCancelMessage
      | NavResumeMessage,
  ): void {
    if (!this.sessionActive || !this.socket) return;
    if (
      this.status.status !== "ready" &&
      this.status.status !== "listening" &&
      this.status.status !== "model-speaking" &&
      this.status.status !== "playback-blocked"
    ) {
      return;
    }
    this.socket.send(JSON.stringify(message));
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private stopCapture(): void {
    const capture = this.capture;
    this.capture = null;
    capture?.stop();
  }

  private clearEndingTimers(): void {
    if (this.endingTimer !== null) clearTimeout(this.endingTimer);
    if (this.drainTimer !== null) clearTimeout(this.drainTimer);
    this.endingTimer = this.drainTimer = null;
  }

  private detachSocket(): void {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
    socket.close();
  }

  private beginAssistantEnding(): void {
    if (!this.sessionActive || this.isEnding()) return;
    this.clearReconnectTimer();
    if (this.contextTimer) clearTimeout(this.contextTimer);
    this.pendingContext = null;
    this.contextBlocked = false;
    this.deferredContext = false;
    this.stopCapture();
    this.setStatus({
      status: "assistant-ending",
      ...(this.status.status === "playback-blocked"
        ? { code: "PLAYBACK_BLOCKED" }
        : {}),
    });
    const playback = this.playback;
    const gen = this.generation;
    this.endingTimer = setTimeout(() => {
      if (
        !this.sessionActive ||
        gen !== this.generation ||
        this.playback !== playback
      )
        return;
      this.detachSocket();
      this.beginPlaybackDrain();
    }, ENDING_TIMEOUT_MS);
  }

  private beginPlaybackDrain(): void {
    if (this.status.status === "draining-playback") return;
    this.generation += 1; // the transport is closed; only this player's completion remains valid
    if (this.endingTimer !== null) clearTimeout(this.endingTimer);
    this.endingTimer = null;
    const playback = this.playback;
    this.setStatus({
      status: "draining-playback",
      ...(this.status.code === "PLAYBACK_BLOCKED"
        ? { code: "PLAYBACK_BLOCKED" }
        : {}),
    });
    if (!playback) {
      this.finishAssistantEnd(null);
      return;
    }
    if (playback.isIdle?.() === true) {
      this.finishAssistantEnd(playback);
      return;
    }
    const gen = this.generation;
    this.drainTimer = setTimeout(() => {
      if (gen === this.generation) this.finishAssistantEnd(playback);
    }, PLAYBACK_DRAIN_TIMEOUT_MS);
  }

  private finishAssistantEnd(playback: VoicePlayback | null): void {
    if (
      !this.sessionActive ||
      this.playback !== playback ||
      this.status.status !== "draining-playback"
    )
      return;
    this.generation += 1;
    this.sessionActive = false;
    this.clearEndingTimers();
    this.clearReconnectTimer();
    this.stopCapture();
    this.detachSocket();
    this.playback = null;
    playback?.dispose();
    this.toolCalls.clear();
    this.muted = false;
    this.setStatus({ status: "ended", code: ASSISTANT_END });
  }

  /**
   * Full teardown shared by every terminal transition: end(), the
   * non-1006 close branches, mic-permission failure, identity/token
   * loss on (re)connect, and refresh-exhausted 4401. Always bumps
   * `generation` so any in-flight async work bound to the previous
   * generation is provably stale from this point on.
   */
  private terminate(status: VoiceStatus, sendEndMessage = false): void {
    this.deferredContext = false;
    this.modelTurnActive = false;
    this.generation += 1;
    this.refreshPending = null;
    this.clearEndingTimers();
    if (this.contextTimer) clearTimeout(this.contextTimer);
    this.pendingContext = null;
    this.toolCalls.clear();
    this.sessionActive = false;
    this.muted = false;
    this.clearReconnectTimer();
    this.stopCapture();

    const playback = this.playback;
    this.playback = null;
    playback?.clear();
    playback?.dispose();

    const socket = this.socket;
    this.socket = null;
    if (socket) {
      if (sendEndMessage) {
        socket.send(
          JSON.stringify({ type: "session.end" } satisfies SessionEndMessage),
        );
      }
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
    }

    this.setStatus(status);
  }

  /**
   * (Re)build the socket for the current session. Used for the initial
   * connect and for every reconnect (1006 backoff, refresh-success).
   * Re-validates identity and re-reads the token synchronously — no
   * awaits between reading them and sending `session.start` in onopen
   * (§6 boundary: "onopen 同步送出，不等待任何非同步取值").
   */
  private connect(refreshedToken?: string): void {
    if (!this.sessionActive || this.isEnding()) return;
    const pending = this.refreshPending;
    if (pending?.generation === this.generation) return;
    const gen = ++this.generation;

    if (this.deps.getAuthIdentity() !== this.identityAtStart) {
      // §5.7 rev13: identity changed since start — never build a socket
      // with a different identity's credentials.
      this.terminate({ status: "needs-login" });
      return;
    }

    const token = refreshedToken ?? this.deps.getToken();
    if (!isUsableToken(token)) {
      this.refreshForConnection(gen);
      return;
    }

    const location = this.deps.getUserLocation();

    // Defensive: detach + close any lingering previous socket before
    // building a new one (§6: "建新 socket 前先把舊 socket 的 handlers
    // 全部解除並 close()"). Should already be null in normal flow.
    if (this.socket) {
      const old = this.socket;
      this.socket = null;
      old.onopen = null;
      old.onmessage = null;
      old.onclose = null;
      old.onerror = null;
      old.close();
    }

    this.deferredContext = false;
    this.modelTurnActive = false;
    this.contextSupported = false;
    this.contextBlocked = false;
    this.selectionVersion = 0;
    this.pendingContext = null;
    if (this.contextTimer) clearTimeout(this.contextTimer);
    this.toolCalls.clear();
    this.completedCalls.clear();
    this.pendingStartRoute = null;
    this.ignoreNavigation = false;

    const socket = this.deps.createSocket(this.deps.wsUrl);
    this.socket = socket;

    socket.onopen = () => {
      if (gen !== this.generation) return; // stale
      const conversation = this.deps.getConversationInput?.();
      this.sessionLanguage = this.deps.getLanguage?.();
      this.initializedContext = conversation?.routeContext?.routeToken ?? null;
      const message: SessionStartMessage = {
        type: "session.start",
        token,
        ...conversation,
        ...(this.sessionLanguage ? { language: this.sessionLanguage } : {}),
        ...(this.deps.getHistory ? { history: this.deps.getHistory() } : {}),
      };
      if (location) message.userLocation = location;
      const payload = encodeSessionStart(message);
      if (payload === null) {
        this.terminate({ status: "error", code: "SESSION_START_TOO_LARGE" });
        return;
      }
      socket.send(payload);
    };
    socket.onmessage = (event) => this.handleMessage(gen, event.data);
    socket.onclose = (event) => this.handleClose(gen, event.code, event.reason);
  }

  private handleMessage(gen: number, data: unknown): void {
    if (gen !== this.generation) return; // stale socket

    if (data instanceof ArrayBuffer) {
      if (this.contextBlocked && !this.isEnding()) return;
      this.modelTurnActive = true;
      // Downlink audio: never JSON-parsed, forwarded to playback in
      // arrival order (§5.9).
      this.playback?.play(data);
      if (
        this.status.status === "listening" ||
        this.status.status === "model-speaking"
      ) {
        this.setStatus({ status: "model-speaking" });
      }
      return;
    }

    if (typeof data === "string") {
      let message: ServerEventMessage;
      try {
        message = JSON.parse(data) as ServerEventMessage;
      } catch {
        console.warn(
          "[voiceSession] Failed to parse text message, discarding",
          data,
        );
        return;
      }
      this.dispatchEvent(gen, message);
      return;
    }

    // Anything else (e.g. Blob, if the adapter forgot binaryType).
    console.warn(
      "[voiceSession] Unknown message payload type, discarding",
      data,
    );
  }

  private dispatchEvent(gen: number, message: ServerEventMessage): void {
    switch (message.type) {
      case "location.request": {
        const location = this.deps.getUserLocation();
        if (location) this.sendNavigationPosition(location);
        return;
      }
      case "session.ending": {
        if ((message as { reason?: string }).reason === ASSISTANT_END)
          this.beginAssistantEnding();
        return;
      }
      case "session.ready": {
        if (this.isEnding()) return;
        this.hasRefreshed = false;
        const capabilities = (message as SessionReadyMessage).capabilities;
        this.contextSupported =
          capabilities?.aiRouteContractVersion === 1 &&
          capabilities.routeContextSync === true;
        this.contextBlocked =
          !this.contextSupported && this.initializedContext !== null;
        this.deps.onRouteContextStatus?.(
          this.contextSupported ? "synced" : "unsupported",
        );
        const isReconnect = this.hasBeenReady;
        this.hasBeenReady = true;
        this.reconnectDelay = RECONNECT_INITIAL_DELAY_MS; // reset backoff on success
        this.setStatus({ status: "ready" });
        if (this.routeToken) {
          this.sendControl({
            type: "nav.setRoute",
            routeToken: this.routeToken,
          });
        }
        // A rebuilt socket dropped the server-side navigation binding; ask to
        // re-attach to it before any audio flows, so the assistant keeps
        // announcing the same navigation instead of starting from scratch.
        if (isReconnect) this.sendNavigationResume();
        this.startCapture(gen);
        if (
          (this.deps.getConversationInput?.().routeContext?.routeToken ??
            null) !== this.initializedContext
        )
          this.syncRouteContext();
        return;
      }
      case "route.context.ack": {
        const ack = message as {
          requestId?: string;
          selectionVersion?: number;
          ok?: boolean;
        };
        if (
          !this.pendingContext ||
          ack.requestId !== this.pendingContext.requestId ||
          ack.selectionVersion !== this.pendingContext.selectionVersion
        )
          return;
        if (this.contextTimer) clearTimeout(this.contextTimer);
        this.pendingContext = null;
        this.contextBlocked = ack.ok !== true;
        this.deps.onRouteContextStatus?.(ack.ok === true ? "synced" : "failed");
        return;
      }
      case "transcript": {
        if (this.contextBlocked && !this.isEnding()) return;
        const m = message as TranscriptMessage;
        this.modelTurnActive = true;
        this.deps.onTranscript({
          role: m.role,
          text: m.text,
          final: m.final,
          utteranceId: m.utteranceId,
        });
        return;
      }
      case "transcript.correction": {
        const m = message as TranscriptCorrectionMessage;
        this.deps.onTranscriptCorrection?.({
          role: m.role ?? "user",
          text: m.text,
          utteranceId: m.utteranceId,
        });
        return;
      }
      case "tool_call": {
        const m = message as ToolCallMessage;
        if (this.contextBlocked) return;
        this.modelTurnActive = true;
        if (
          m.callId &&
          (this.completedCalls.has(m.callId) || this.toolCalls.has(m.callId))
        )
          return;
        if (m.name === "startNavigation")
          this.pendingStartRoute = {
            routeToken: this.routeToken,
            generation: this.deps.getRouteGeneration?.() ?? 0,
          };
        if (m.callId)
          this.toolCalls.set(m.callId, {
            name: m.name,
            turnId: m.turnId,
            generation: this.deps.getRouteGeneration?.() ?? 0,
          });
        this.deps.onToolEvent({
          type: "call",
          name: m.name,
          callId: m.callId,
          turnId: m.turnId,
        });
        return;
      }
      case "tool_result": {
        const m = message as ToolResultMessage;
        if (this.contextBlocked) return;
        const call = m.callId ? this.toolCalls.get(m.callId) : undefined;
        if (m.callId && this.completedCalls.has(m.callId)) return;
        if (
          m.callId &&
          (!call ||
            call.name !== m.name ||
            (call.turnId && call.turnId !== m.turnId))
        )
          return;
        if (m.name === "startNavigation" && this.isPendingStartStale()) {
          this.syncRouteContext();
          return;
        }
        const routeTool =
          m.name === "planAccessibleRoute" || m.name === "plan_route";
        if (
          routeTool &&
          !toolResultFailure({ ...m, type: "result" }) &&
          (!this.contextSupported ||
            !m.callId ||
            !m.turnId ||
            !call ||
            call.turnId !== m.turnId ||
            call.generation !== (this.deps.getRouteGeneration?.() ?? 0))
        ) {
          this.terminate(
            { status: "error", code: "AI_ROUTE_UNAVAILABLE" },
            true,
          );
          return;
        }
        if (m.name === "startNavigation") this.pendingStartRoute = null;
        if (routeTool && !toolResultFailure({ ...m, type: "result" })) {
          this.pendingStartRoute = null;
          this.ignoreNavigation = false;
        }
        if (m.callId) {
          this.completedCalls.add(m.callId);
          this.toolCalls.delete(m.callId);
        }
        try {
          this.deps.onToolEvent({
            type: "result",
            callId: m.callId,
            turnId: m.turnId,
            summary: m.summary,
            name: m.name,
            ok: m.ok,
            durationMs: m.durationMs,
            result: m.result,
            args: m.args,
          });
        } catch {
          this.terminate(
            { status: "error", code: "AI_ROUTE_UNAVAILABLE" },
            true,
          );
        }
        return;
      }
      case "interrupted": {
        if (this.isEnding()) return;
        this.modelTurnActive = false;
        this.toolCalls.clear();
        if (this.pendingStartRoute) this.cancelNavigation();
        this.pendingStartRoute = null;
        // §5.10: interrupted always clears playback immediately.
        this.playback?.clear();
        this.deps.onInterrupted?.();
        this.flushDeferredContext();
        if (
          this.status.status === "model-speaking" ||
          this.status.status === "listening"
        ) {
          this.setStatus({ status: "listening" });
        }
        return;
      }
      case "turn.complete": {
        if (this.contextBlocked && !this.isEnding()) return;
        this.modelTurnActive = false;
        this.deps.onTurnComplete?.();
        if (!this.isEnding()) this.flushDeferredContext();
        if (this.status.status === "model-speaking") {
          this.setStatus({ status: "listening" });
        }
        return;
      }
      case "error": {
        // The server always follows this with a close carrying the
        // matching code/reason; the real state transition happens in
        // handleClose. Nothing to do here besides logging.
        console.warn(
          "[voiceSession] Server error event",
          (message as ErrorMessage).code,
        );
        return;
      }
      case "nav.start": {
        const event = message as Extract<
          VoiceNavigationEvent,
          { type: "nav.start" }
        >;
        if (this.ignoreNavigation && !this.pendingStartRoute) return;
        if (this.contextBlocked) {
          this.cancelNavigation();
          return;
        }
        if (this.isPendingStartStale()) {
          this.syncRouteContext();
          return;
        }
        this.ignoreNavigation = false;
        this.deps.onNavigationEvent({
          ...event,
          selectionGeneration:
            this.pendingStartRoute?.generation ??
            this.deps.getRouteGeneration?.() ??
            0,
          ...(this.pendingStartRoute?.routeToken
            ? { armedRouteToken: this.pendingStartRoute.routeToken }
            : {}),
        });
        return;
      }
      case "nav.step":
      case "nav.progress":
      case "nav.transit":
      case "nav.arrived":
      case "nav.stop":
      case "nav.offroute":
      case "nav.rerouting":
      case "nav.route_replaced":
      case "nav.reroute_failed":
      case "nav.advisory":
      case "nav.resume_ok":
      case "nav.resume_failed":
      case "nav.error": {
        if (this.ignoreNavigation) return;
        this.deps.onNavigationEvent(message as VoiceNavigationEvent);
        return;
      }
      default:
        console.warn(
          "[voiceSession] Unknown event type, discarding",
          message.type,
        );
    }
  }

  /**
   * Build and send `nav.resume` from the adapter's snapshot. Anything
   * incomplete (no navigation, no route capability) means there is nothing to
   * resume, so the message is skipped rather than sent half-filled.
   */
  private sendNavigationResume(): void {
    const state = this.deps.getNavigationResumeState?.();
    if (!state) return;
    const routeToken = state.routeToken || this.routeToken;
    if (!state.navigationId || !routeToken) return;

    const message: NavResumeMessage = {
      type: "nav.resume",
      navigationId: state.navigationId,
      routeVersion: state.routeVersion,
      routeToken,
      lastKnownStepIndex: state.lastKnownStepIndex,
    };
    if (state.currentPosition) message.currentPosition = state.currentPosition;
    this.sendControl(message);
  }

  private startCapture(gen: number): void {
    this.deps
      .createCapture((frame) => this.sendAudio(gen, frame))
      .then((capture) => {
        if (gen !== this.generation || !this.sessionActive || this.isEnding()) {
          // end() happened, or a reconnect superseded this generation,
          // while getUserMedia/setup was in flight — never (re)activate
          // the mic for a stale generation.
          capture.stop();
          return;
        }
        this.capture = capture;
        this.setStatus({ status: "listening" });
      })
      .catch((error) => {
        if (gen !== this.generation || this.isEnding()) return;
        console.warn("[voiceSession] Microphone capture failed", error);
        // §6 boundary: mic permission denied (or any capture setup
        // failure) → clear error, end the session, notify server.
        this.terminate({ status: "error", code: "MIC_UNAVAILABLE" }, true);
      });
  }

  private sendAudio(gen: number, frame: ArrayBuffer): void {
    if (gen !== this.generation) return; // stale capture, discarded
    if (this.muted || this.contextBlocked || this.deferredContext) return; // muted: discard microphone frames
    // §6: never send binary before `ready` — only listening/model-speaking
    // are reachable post-ready states in which uplink audio is valid.
    if (
      this.status.status !== "listening" &&
      this.status.status !== "model-speaking"
    )
      return;
    this.socket?.send(frame);
  }

  private handleClose(gen: number, code: number, reason: string): void {
    if (gen !== this.generation) return; // stale socket's close — no-op

    if (code === CLOSE_NORMAL && reason === ASSISTANT_END) {
      this.beginAssistantEnding();
      this.detachSocket();
      this.beginPlaybackDrain();
      return;
    }
    this.generation += 1; // close itself invalidates saved socket/capture callbacks
    if (this.contextTimer) clearTimeout(this.contextTimer);
    this.pendingContext = null;
    this.contextBlocked = true;
    this.deferredContext = false;
    this.modelTurnActive = false;
    // §6: any close, current-generation, immediately releases mic + playback.
    this.stopCapture();
    this.playback?.clear();
    this.socket = null;

    switch (code) {
      case CLOSE_AUTH_EXPIRED:
        this.handleAuthExpired();
        return;
      case CLOSE_CONFLICT:
        // §5: another tab took over — never auto-reconnect.
        this.terminate({ status: "error", code: CLOSE_CONFLICT });
        return;
      case CLOSE_NORMAL:
        if (reason === REASON_LIVE_SESSION_ENDED) {
          this.terminate({ status: "error", code: "LIVE_SESSION_ENDED" });
        } else {
          this.terminate({ status: "ended" });
        }
        return;
      case CLOSE_SERVER_ERROR:
        this.terminate({ status: "error", code: CLOSE_SERVER_ERROR });
        return;
      case CLOSE_ABNORMAL:
        this.scheduleReconnect();
        return;
      case CLOSE_NAV_TURN_TIMEOUT:
        // Navigation voice turn timed out twice. Rebuild the complete Live
        // session; session.ready will re-arm the latest routeToken.
        this.reconnectDelay = RECONNECT_INITIAL_DELAY_MS;
        this.scheduleReconnect();
        return;
      default:
        this.terminate({ status: "error", code });
    }
  }

  private handleAuthExpired(): void {
    this.setStatus({ status: "reconnecting" });
    this.refreshForConnection(this.generation);
  }

  private refreshForConnection(gen: number): void {
    if (this.refreshPending?.generation === gen) return;
    if (this.hasRefreshed) {
      this.terminate({ status: "needs-login" });
      return;
    }
    this.hasRefreshed = true;
    let promise: Promise<string | null>;
    try {
      promise = this.deps.refreshAuth();
    } catch {
      promise = Promise.resolve(null);
    }
    const lane = { generation: gen, promise };
    this.refreshPending = lane;
    const complete = (token: string | null) => {
      if (
        this.refreshPending !== lane ||
        gen !== this.generation ||
        !this.sessionActive ||
        this.isEnding()
      )
        return;
      this.refreshPending = null;
      if (
        this.deps.getAuthIdentity() !== this.identityAtStart ||
        !isUsableToken(token ?? undefined)
      ) {
        this.terminate({ status: "needs-login" });
        return;
      }
      this.setStatus({ status: "connecting" });
      this.connect(token ?? undefined);
    };
    void promise.then(complete, () => complete(null));
  }

  private scheduleReconnect(): void {
    if (!this.sessionActive) return;
    this.clearReconnectTimer();

    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(
      this.reconnectDelay * 2,
      RECONNECT_MAX_DELAY_MS,
    );

    this.setStatus({ status: "reconnecting" });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.sessionActive) return;
      this.setStatus({ status: "connecting" });
      this.connect();
    }, delay);
  }
}
