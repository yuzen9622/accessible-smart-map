import type { AccessibleRoute, NavInstruction } from "@/types/route";

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
interface SessionStartMessage {
  type: "session.start";
  token: string;
  userLocation?: { latitude: number; longitude: number };
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
  type: "tool_call";
  name: string;
}

interface ToolResultMessage {
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

export type VoiceNavigationEvent =
  | {
      type: "nav.start";
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
    }
  | ({
      type: "nav.route_replaced";
      navigationId: string;
      previousRouteVersion: number;
      routeVersion: number;
      routeToken: string;
      route: AccessibleRoute;
      warnings: string[];
      currentStepIndex: 0;
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
      type: "nav.error";
      code: "NAV_ROUTE_INVALID" | "NO_ROUTE_ARMED";
      message: string;
    };

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
  | "needs-login"
  | "ended"
  | "error";

export interface VoiceStatus {
  status: VoiceStatusName;
  /** Present when status === "error" (close code or a local error tag). */
  code?: number | string;
}

export interface VoiceToolEvent {
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

  /** Per-session (not per-generation) refresh budget — §5.8. */
  private hasRefreshed = false;

  private socket: VoiceSocket | null = null;
  private capture: VoiceCapture | null = null;
  private playback: VoicePlayback | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = RECONNECT_INITIAL_DELAY_MS;
  /** Latest selected HTTP route capability; re-armed after every reconnect. */
  private routeToken: string | null = null;

  /**
   * True once this session has seen a `session.ready`. Every later ready is
   * therefore a *reconnect* ready — the only point at which `nav.resume` is
   * meaningful.
   */
  private hasBeenReady = false;

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
    this.reconnectDelay = RECONNECT_INITIAL_DELAY_MS;

    this.playback = this.deps.createPlayback();
    this.playback.onBlocked(() => {
      if (!this.sessionActive) return;
      this.setStatus({ status: "playback-blocked" });
    });

    this.setStatus({ status: "connecting" });
    this.connect();
  }

  end(): void {
    if (!this.sessionActive) return;
    this.terminate({ status: "ended" }, /* sendEndMessage */ true);
  }

  resumePlayback(): void {
    const playback = this.playback;
    if (!playback) return;
    playback.resume().then((ok) => {
      if (!this.sessionActive) return; // ended meanwhile — discard
      if (ok) {
        this.setStatus({ status: "listening" });
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

  /**
   * Full teardown shared by every terminal transition: end(), the
   * non-1006 close branches, mic-permission failure, identity/token
   * loss on (re)connect, and refresh-exhausted 4401. Always bumps
   * `generation` so any in-flight async work bound to the previous
   * generation is provably stale from this point on.
   */
  private terminate(status: VoiceStatus, sendEndMessage = false): void {
    this.generation += 1;
    this.sessionActive = false;
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
  private connect(): void {
    if (!this.sessionActive) return;

    if (this.deps.getAuthIdentity() !== this.identityAtStart) {
      // §5.7 rev13: identity changed since start — never build a socket
      // with a different identity's credentials.
      this.terminate({ status: "needs-login" });
      return;
    }

    const token = this.deps.getToken();
    if (!token) {
      this.terminate({ status: "needs-login" });
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

    this.generation += 1;
    const gen = this.generation;

    const socket = this.deps.createSocket(this.deps.wsUrl);
    this.socket = socket;

    socket.onopen = () => {
      if (gen !== this.generation) return; // stale
      const message: SessionStartMessage = { type: "session.start", token };
      if (location) message.userLocation = location;
      socket.send(JSON.stringify(message));
    };
    socket.onmessage = (event) => this.handleMessage(gen, event.data);
    socket.onclose = (event) => this.handleClose(gen, event.code, event.reason);
  }

  private handleMessage(gen: number, data: unknown): void {
    if (gen !== this.generation) return; // stale socket

    if (data instanceof ArrayBuffer) {
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
      case "session.ready": {
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
        return;
      }
      case "transcript": {
        const m = message as TranscriptMessage;
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
        this.deps.onToolEvent({ type: "call", name: m.name });
        return;
      }
      case "tool_result": {
        const m = message as ToolResultMessage;
        this.deps.onToolEvent({
          type: "result",
          name: m.name,
          ok: m.ok,
          durationMs: m.durationMs,
          result: m.result,
          args: m.args,
        });
        return;
      }
      case "interrupted": {
        // §5.10: interrupted always clears playback immediately.
        this.playback?.clear();
        this.deps.onInterrupted?.();
        if (
          this.status.status === "model-speaking" ||
          this.status.status === "listening"
        ) {
          this.setStatus({ status: "listening" });
        }
        return;
      }
      case "turn.complete": {
        this.deps.onTurnComplete?.();
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
      case "nav.start":
      case "nav.step":
      case "nav.progress":
      case "nav.transit":
      case "nav.arrived":
      case "nav.stop":
      case "nav.offroute":
      case "nav.rerouting":
      case "nav.route_replaced":
      case "nav.reroute_failed":
      case "nav.resume_ok":
      case "nav.resume_failed":
      case "nav.error": {
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
        if (gen !== this.generation) {
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
        if (gen !== this.generation) return; // stale, discard
        console.warn("[voiceSession] Microphone capture failed", error);
        // §6 boundary: mic permission denied (or any capture setup
        // failure) → clear error, end the session, notify server.
        this.terminate({ status: "error", code: "MIC_UNAVAILABLE" }, true);
      });
  }

  private sendAudio(gen: number, frame: ArrayBuffer): void {
    if (gen !== this.generation) return; // stale capture, discarded
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

  /** §5.8: 4401 — refresh once per session, controller never commits/invalidates. */
  private handleAuthExpired(): void {
    if (this.hasRefreshed) {
      // Second 4401 in this session: end only, never touch global auth.
      this.terminate({ status: "needs-login" });
      return;
    }
    this.hasRefreshed = true;

    const genAtRefreshStart = this.generation;
    this.setStatus({ status: "reconnecting" });

    this.deps.refreshAuth().then((token) => {
      if (this.generation !== genAtRefreshStart || !this.sessionActive) return; // stale — discard, don't reconnect

      if (this.deps.getAuthIdentity() !== this.identityAtStart) {
        // Identity changed while refreshing — never reconnect with a
        // different identity's token.
        this.terminate({ status: "needs-login" });
        return;
      }

      if (token === null) {
        this.terminate({ status: "needs-login" });
        return;
      }

      // Reconnect exactly once, using the store's current token via
      // getToken() (connect() re-reads it) — new generation.
      this.setStatus({ status: "connecting" });
      this.connect();
    });
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
