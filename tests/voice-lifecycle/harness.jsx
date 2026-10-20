// Frozen browser acceptance v1. External boundaries only are controlled here.
import { createRoot } from "react-dom/client";
import VoiceModeView from "@/components/Voice/VoiceModeView";
import VoiceSessionHost from "@/components/Voice/VoiceSessionHost";
import useAuthStore from "@/stores/useAuthStore";
import useChatStore from "@/stores/useChatStore";
import useMapStore from "@/stores/useMapStore";
import useNavStore from "@/stores/useNavStore";
import useVoiceStore from "@/stores/useVoiceStore";

const sockets = [];
const contexts = [];
const nativeSocket = window.WebSocket;
const NativeAudioContext = window.AudioContext;
const realFetch = window.fetch.bind(window);
let refreshCalls = 0;
let refreshResolve;
let stoppedTracks = 0;
class ControlledSocket {
  sent = [];
  readyState = 1;
  constructor(url) {
    this.url = url;
    sockets.push(this);
  }
  send(data) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  event(message) {
    this.onmessage?.({
      data: message instanceof ArrayBuffer ? message : JSON.stringify(message),
    });
  }
  closed(code, reason) {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}
window.WebSocket = new Proxy(nativeSocket, {
  construct(target, args) {
    return String(args[0]).includes("/voice/ws")
      ? new ControlledSocket(args[0])
      : Reflect.construct(target, args);
  },
});
window.AudioContext = class extends NativeAudioContext {
  constructor(options) {
    super(options);
    contexts.push(this);
  }
};
// Use a real browser MediaStream and capture worklet, but no physical mic or permission prompt.
Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
  configurable: true,
  value: async () => {
    const source = new NativeAudioContext();
    const stream = source.createMediaStreamDestination().stream;
    for (const track of stream.getTracks()) {
      const stop = track.stop.bind(track);
      track.stop = () => {
        stoppedTracks++;
        stop();
        void source.close();
      };
    }
    return stream;
  },
});
window.fetch = (input, init) => {
  const url = String(input);
  if (url.includes("/api/v1/user/refresh")) {
    refreshCalls++;
    return new Promise((resolve) => {
      refreshResolve = (token) =>
        resolve(
          new Response(JSON.stringify({ ok: !!token, accessToken: token })),
        );
    });
  }
  if (
    url.startsWith("/") ||
    new URL(url, location.href).origin === location.origin
  )
    return realFetch(input, init);
  throw new Error(`External request prohibited in acceptance harness: ${url}`);
};
function App() {
  const status = useVoiceStore((s) => s.status.status);
  const nav = useMapStore((s) => s.isNavigating);
  return (
    <>
      <VoiceSessionHost />
      <section data-testid="voice-panel">
        <VoiceModeView />
      </section>
      <output data-testid="state">
        {status} / navigation={String(nav)}
      </output>
    </>
  );
}
createRoot(document.getElementById("root")).render(<App />);
const tick = async (ms = 50) =>
  new Promise((resolve) => setTimeout(resolve, ms));
function assert(value, message) {
  if (!value) throw new Error(message);
}
function route(version = 1, id = "nav-a") {
  return {
    routeId: `${id}-r${version}`,
    navigationId: id,
    routeVersion: version,
    routeToken: `${id}-t${version}`,
    routeName: `route ${version}`,
    totalMinutes: 5,
    transferCount: 0,
    legs: [],
    accessibilityHighlights: [],
  };
}
function step(text = "first backend step") {
  return {
    index: 0,
    instruction: text,
    legType: "WALK",
    distanceM: 100,
    isTransit: false,
  };
}
function replacement(version = 2) {
  return {
    type: "nav.route_replaced",
    navigationId: "nav-a",
    previousRouteVersion: version - 1,
    routeVersion: version,
    routeToken: `nav-a-t${version}`,
    route: route(version),
    steps: [step(`step ${version}`)],
    warnings: [`warning ${version}`],
    currentStepIndex: 0,
  };
}
async function reset(missing = false) {
  useVoiceStore.getState().endSession();
  await tick();
  useVoiceStore.getState().setStatus({ status: "idle" });
  useVoiceStore.getState().setViewMode("panel");
  useChatStore.getState().clearAll();
  useNavStore.getState().reset();
  useMapStore.setState({
    isNavigating: false,
    activeNavigationRoute: null,
    selectRoute: null,
    computeRoutes: null,
    userLocation: null,
    chatOpen: true,
    invalidRouteTokens: [],
  });
  useAuthStore.setState({
    user: { _id: "local-fixture-user" },
    session: missing ? null : { accessToken: "local-fixture-token" },
  });
  sockets.length = 0;
  contexts.length = 0;
  stoppedTracks = 0;
  refreshCalls = 0;
  await tick();
}
async function ready() {
  useVoiceStore.getState().startSession();
  await tick();
  const s = sockets.at(-1);
  assert(s, "socket not built");
  s.onopen?.();
  s.event({
    type: "session.ready",
    capabilities: { aiRouteContractVersion: 1, routeContextSync: true },
  });
  for (
    let i = 0;
    i < 60 && useVoiceStore.getState().status.status !== "listening";
    i++
  )
    await tick();
  assert(
    useVoiceStore.getState().status.status === "listening",
    "capture/listening not ready",
  );
  return s;
}
async function seedNavigation(s, selectedSecond = false) {
  const first = route();
  const second = route(1, "nav-second");
  useMapStore.setState({
    computeRoutes: [first, second],
    selectRoute: {
      index: selectedSecond ? 1 : 0,
      route: selectedSecond ? second : first,
    },
  });
  s.event({
    type: "nav.start",
    steps: [step()],
    currentStepIndex: 0,
    totalSteps: 1,
  });
  await tick();
  // Context sync is an existing hook side effect of navigation start; ack its real request.
  for (const data of s.sent)
    if (typeof data === "string") {
      const m = JSON.parse(data);
      if (m.type === "route.context.set")
        s.event({
          type: "route.context.ack",
          requestId: m.requestId,
          selectionVersion: m.selectionVersion,
          ok: true,
        });
    }
  await tick();
}
async function scenario(name) {
  await reset(name === "refresh");
  if (name === "refresh") {
    useVoiceStore.getState().startSession();
    useVoiceStore.getState().startSession();
    await tick();
    assert(
      refreshCalls === 1 && sockets.length === 0,
      "missing token did not single-flight refresh before connection",
    );
    assert(
      useVoiceStore.getState().status.status !== "needs-login",
      "premature needs-login",
    );
    refreshResolve("fixture-refreshed");
    await tick();
    assert(sockets.length === 1, "refresh did not create exactly one socket");
    sockets[0].onopen?.();
    sockets[0].event({ type: "session.ready" });
    for (
      let i = 0;
      i < 60 && useVoiceStore.getState().status.status !== "listening";
      i++
    )
      await tick();
    assert(
      useVoiceStore.getState().status.status === "listening",
      "real auth subscription interrupted refresh",
    );
    return "13/14 real hook + authRefresh + transport + store PASS";
  }
  const s = await ready();
  if (name === "correction") {
    s.event({
      type: "transcript",
      role: "user",
      utteranceId: "u1",
      text: "珠北車站",
      final: true,
    });
    s.event({ type: "turn.complete" });
    s.event({ type: "interrupted" });
    await tick();
    const before = useChatStore.getState().chatHistory.length;
    s.event({
      type: "transcript.correction",
      utteranceId: "u1",
      text: "竹北車站",
    });
    await tick();
    assert(
      useChatStore.getState().chatHistory.length === before,
      "correction appended history",
    );
    assert(
      useChatStore.getState().chatHistory.at(-1)?.content === "竹北車站",
      "hook failed to update persisted chat history",
    );
    assert(
      useChatStore.getState().messages.at(-1)?.content === "竹北車站",
      "visible chat history was not corrected",
    );
    assert(
      document
        .querySelector('[data-testid="voice-panel"]')
        .textContent.includes("竹北車站"),
      "actual transcript UI was not corrected",
    );
    return "08/09/10 actual hook/chat store/rendered transcript PASS";
  }
  await seedNavigation(s, name === "start");
  if (name === "start") {
    assert(
      useMapStore.getState().isNavigating,
      "nav.start did not activate UI",
    );
    assert(
      useMapStore.getState().activeNavigationRoute?.navigationId === "nav-a",
      "did not use backend first candidate",
    );
    assert(
      useNavStore.getState().navigationSource === "voice",
      "voice owner lost",
    );
    return "18 nav.start uses first backend candidate directly PASS";
  }
  if (name === "replacement") {
    const observations = [];
    const observe = () => {
      const m = useMapStore.getState();
      const n = useNavStore.getState();
      observations.push([
        m.activeNavigationRoute?.routeVersion,
        n.routeVersion,
        n.instructions[0]?.text,
        n.warnings[0],
        n.currentStepIndex,
      ]);
    };
    const a = useMapStore.subscribe(observe);
    const b = useNavStore.subscribe(observe);
    s.event(replacement());
    await tick();
    a();
    b();
    assert(
      observations.length &&
        observations.every(
          (x) =>
            JSON.stringify(x) ===
            JSON.stringify([2, 2, "step 2", "warning 2", 0]),
        ),
      "half-replaced state observed",
    );
    const old = useMapStore.getState().activeNavigationRoute;
    for (const event of [
      { ...replacement(3), navigationId: "other" },
      replacement(4),
      replacement(2),
    ])
      s.event(event);
    await tick();
    assert(
      useMapStore.getState().activeNavigationRoute === old,
      "invalid replacement changed route",
    );
    return "19/20 WS → hook queue → Host → coordinator → atomic stores PASS";
  }
  if (name === "resume") {
    s.closed(1006, "");
    await tick(1200);
    const next = sockets.at(-1);
    assert(next !== s, "abnormal close did not reconnect");
    next.onopen?.();
    next.event({
      type: "session.ready",
      capabilities: { aiRouteContractVersion: 1, routeContextSync: true },
    });
    // Same task: React must not drop or reverse the replay queue.
    next.event(replacement());
    next.event({
      type: "nav.resume_ok",
      navigationId: "nav-a",
      routeVersion: 2,
      routeToken: "nav-a-t2",
      steps: [step("resumed step")],
      currentStepIndex: 0,
      totalSteps: 1,
      onVehicle: false,
    });
    await tick(150);
    assert(
      useMapStore.getState().activeNavigationRoute?.routeVersion === 2,
      "resume replay replacement dropped",
    );
    assert(
      useNavStore.getState().routeVersion === 2 &&
        useNavStore.getState().instructions[0]?.text === "resumed step",
      "resume replay out of order",
    );
    return "07 + replacement → resume_ok real Host ordered replay PASS";
  }
  if (name.startsWith("stop:")) {
    const reason = name.split(":")[1];
    s.event({ type: "nav.stop", reason });
    await tick();
    assert(
      s.readyState === 1 &&
        useVoiceStore.getState().status.status === "listening",
      "nav.stop closed voice",
    );
    if (reason === "arrived")
      assert(
        useNavStore.getState().arrived && useMapStore.getState().isNavigating,
        "arrival semantics lost",
      );
    else
      assert(
        !useMapStore.getState().isNavigating,
        "nav.stop did not stop navigation",
      );
    return `21 + nav.stop/${reason} real Host PASS`;
  }
  if (name === "ending") {
    const map = useMapStore.getState();
    const nav = useNavStore.getState();
    // One second of actual scheduled Web Audio, then more downlink after ending.
    s.event(new ArrayBuffer(48000));
    await tick();
    const playback = contexts.find((c) => c.sampleRate === 24000);
    assert(playback, "no real playback context");
    s.event({ type: "session.ending", reason: "assistant-end" });
    await tick();
    assert(stoppedTracks === 1, "microphone track not stopped");
    assert(
      useVoiceStore.getState().status.status === "assistant-ending",
      "ending state not wired",
    );
    assert(
      document
        .querySelector('[data-testid="voice-panel"]')
        .textContent.includes("道別"),
      "UI does not show farewell state",
    );
    const endButtons = [...document.querySelectorAll("button")].filter(
      (b) =>
        b.textContent.includes("結束語音") ||
        b.getAttribute("aria-label") === "結束語音對話",
    );
    assert(
      endButtons.length > 0 && endButtons.every((b) => b.disabled),
      "ending end controls can destroy playback",
    );
    s.event(new ArrayBuffer(24000));
    s.closed(1000, "assistant-end");
    await tick();
    assert(playback.state !== "closed", "playback prematurely closed");
    assert(
      useVoiceStore.getState().status.status === "draining-playback",
      "drain UI state missing",
    );
    assert(
      useMapStore.getState().activeNavigationRoute ===
        map.activeNavigationRoute &&
        useMapStore.getState().isNavigating &&
        useNavStore.getState().navigationId === nav.navigationId,
      "assistant-end cleared active navigation/UI",
    );
    await tick(2000);
    assert(
      playback.state === "closed",
      "actual PCM completion did not dispose player",
    );
    assert(
      useVoiceStore.getState().status.status === "ended",
      "drain not finished",
    );
    assert(
      useMapStore.getState().isNavigating &&
        useMapStore.getState().activeNavigationRoute ===
          map.activeNavigationRoute &&
        useNavStore.getState().navigationId === nav.navigationId &&
        useNavStore.getState().routeVersion === nav.routeVersion &&
        useNavStore.getState().currentStepIndex === nav.currentStepIndex,
      "graceful voice ending cleared active navigation/route/version/step/UI",
    );
    assert(
      !document.body.textContent.includes("連線中斷") &&
        !document.body.textContent.includes("請重新登入"),
      "assistant ending surfaced network/login error",
    );
    assert(
      sockets.length === 1 &&
        !s.sent.some(
          (x) =>
            typeof x === "string" &&
            ["nav.cancel", "session.end"].includes(JSON.parse(x).type),
        ),
      "assistant-end cancelled backend snapshot",
    );
    return "01–06/22 actual Host/UI and real Web Audio drain PASS";
  }
  throw new Error(`unknown scenario ${name}`);
}
window.qa = {
  scenario,
  reset,
  ready,
  sockets,
  contexts,
  stores: {
    voice: useVoiceStore,
    auth: useAuthStore,
    map: useMapStore,
    nav: useNavStore,
    chat: useChatStore,
  },
  tick,
};
