import { createRoot } from "react-dom/client";
import VoiceModeView from "@/components/Voice/VoiceModeView";
import "@/app/globals.css";

let root;
const tick = () => window.qa.tick(150);
function assert(value, message) {
  if (!value) throw new Error(message);
}

export async function mountVoicePanel() {
  document.querySelector('[data-testid="voice-panel"]').hidden = true;
  if (!root) {
    const panel = document.createElement("section");
    panel.id = "voice-ui-regression";
    panel.style.cssText =
      "position:fixed;inset:20px auto auto 20px;width:min(380px,calc(100vw - 40px));height:480px;display:flex;flex-direction:column;overflow:hidden;background:white;z-index:100";
    document.body.append(panel);
    root = createRoot(panel);
    root.render(
      <>
        <header style={{ height: 48, flexShrink: 0 }}>AI 助理</header>
        <div className="flex-1 overflow-hidden">
          <div className="h-full">
            <VoiceModeView />
          </div>
        </div>
      </>,
    );
  }
  await tick();
}

export async function prepareLongTranscripts() {
  await window.qa.reset();
  const socket = await window.qa.ready();
  for (let i = 0; i < 50; i++) {
    socket.event({
      type: "transcript",
      role: i % 2 ? "model" : "user",
      text: `第 ${i} 則對話，必須能捲動閱讀較早的紀錄。`,
      final: true,
    });
    socket.event({ type: "turn.complete" });
  }
  await mountVoicePanel();
  await window.qa.tick(500);
  const viewport = document.querySelector(
    '#voice-ui-regression [aria-live="polite"]',
  );
  assert(viewport, "transcript viewport missing");
  viewport.id = "voice-ui-transcripts";
  viewport.scrollTop = 0;
  await tick();
  return scrollMetrics();
}

export function scrollMetrics() {
  const viewport = document.getElementById("voice-ui-transcripts");
  const panel = document.getElementById("voice-ui-regression");
  const end = [...panel.querySelectorAll("button")].find((button) =>
    button.textContent.includes("結束語音"),
  );
  return {
    viewportHeight: viewport.clientHeight,
    contentHeight: viewport.scrollHeight,
    scrollTop: viewport.scrollTop,
    endButtonBottom: end.getBoundingClientRect().bottom,
    panelBottom: panel.getBoundingClientRect().bottom,
  };
}

export function assertScrolled() {
  const metrics = scrollMetrics();
  assert(
    metrics.contentHeight > metrics.viewportHeight,
    `no constrained scroll viewport: ${JSON.stringify(metrics)}`,
  );
  assert(
    metrics.scrollTop > 0,
    `wheel input could not scroll: ${JSON.stringify(metrics)}`,
  );
  assert(
    metrics.endButtonBottom <= metrics.panelBottom,
    `end control outside panel: ${JSON.stringify(metrics)}`,
  );
  return metrics;
}

export async function prepareTerminal(status) {
  await window.qa.reset();
  if (status === "needs-login") {
    window.qa.stores.auth.setState({ user: null });
    window.qa.stores.voice.getState().startSession();
  } else {
    const socket = await window.qa.ready();
    socket.closed(1011, "fixture-server-error");
  }
  await mountVoicePanel();
  assert(
    window.qa.stores.voice.getState().status.status === status,
    "terminal precondition not reached through real controller",
  );
  const button = [
    ...document.querySelectorAll("#voice-ui-regression button"),
  ].find((b) => b.textContent.includes("結束語音"));
  button.id = "voice-ui-end";
  return { before: status };
}

export async function assertTerminalDismissed() {
  await tick();
  const status = window.qa.stores.voice.getState().status.status;
  assert(status === "idle", `terminal End click left voice stuck at ${status}`);
  return { status };
}

export async function prepareActive() {
  await window.qa.reset();
  await window.qa.ready();
  await mountVoicePanel();
  const button = [
    ...document.querySelectorAll("#voice-ui-regression button"),
  ].find((b) => b.textContent.includes("結束語音"));
  button.id = "voice-ui-end";
}

export async function assertActiveEnded() {
  await tick();
  const status = window.qa.stores.voice.getState().status.status;
  assert(status === "ended", `active End did not terminate: ${status}`);
  assert(
    window.qa.contexts.every((context) => context.state === "closed"),
    "audio context leaked after active End",
  );
  assert(
    window.qa.sockets.every((socket) => socket.readyState === 3),
    "socket leaked after active End",
  );
  return { status };
}
