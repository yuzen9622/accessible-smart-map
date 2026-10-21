import { createRoot } from "react-dom/client";
import VoiceModeView from "@/components/Voice/VoiceModeView";
import VoiceSessionHost from "@/components/Voice/VoiceSessionHost";
import useAuthStore from "@/stores/useAuthStore";
import useChatStore from "@/stores/useChatStore";
import useMapStore from "@/stores/useMapStore";
import useVoiceStore from "@/stores/useVoiceStore";
import "@/app/globals.css";

const NativeSocket = window.WebSocket;
const wire = [];
let receivedAudioBytes = 0;
window.WebSocket = new Proxy(NativeSocket, {
  construct(target, args) {
    const voice = String(args[0]).includes("/voice/ws");
    const ws = Reflect.construct(
      target,
      voice ? ["ws://127.0.0.1:43863/api/v1/voice/ws"] : args,
    );
    if (voice) {
      ws.binaryType = "arraybuffer";
      ws.addEventListener("message", (event) => {
        if (typeof event.data === "string")
          wire.push({ direction: "in", ...JSON.parse(event.data) });
        else receivedAudioBytes += event.data.byteLength;
      });
      const send = ws.send.bind(ws);
      ws.send = (data) => {
        if (typeof data === "string")
          wire.push({ direction: "out", ...JSON.parse(data) });
        return send(data);
      };
    }
    return ws;
  },
});
const audio = new AudioContext({ sampleRate: 48000 });
const microphone = audio.createMediaStreamDestination();
Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
  configurable: true,
  value: async () => microphone.stream,
});
useChatStore.getState().clearAll();
useMapStore.setState({
  userLocation: { lat: 24.1306588, lng: 120.6373201 },
  selectRoute: null,
  computeRoutes: null,
  isNavigating: false,
  activeNavigationRoute: null,
  chatOpen: true,
});
useAuthStore.setState({
  user: { _id: "00000000000000000000aa72" },
  session: { accessToken: "voice-parity-synthetic" },
});
useVoiceStore.setState({ viewMode: "panel" });
function App() {
  return (
    <main className="min-h-dvh bg-muted/30 p-4 flex flex-col items-start gap-4">
      <p className="text-sm text-muted-foreground">
        本機真實串流驗收：合成身分與麥克風，真實 Gemini、工具服務及播放器。
      </p>
      <button
        type="button"
        className="rounded-lg border bg-background px-4 py-2"
        onClick={() => {
          audio.resume();
          useVoiceStore.getState().startSession();
        }}
      >
        開始語音驗收
      </button>
      <section
        id="live-voice-panel"
        className="w-full max-w-[380px] h-[600px] flex flex-col overflow-hidden rounded-2xl border bg-background shadow-sm"
      >
        <header className="border-b px-4 py-3 text-sm font-semibold">
          無障礙智慧地圖 AI 助理
        </header>
        <VoiceModeView />
      </section>
      <VoiceSessionHost />
    </main>
  );
}
createRoot(document.getElementById("root")).render(<App />);
window.liveQA = {
  wire,
  async speak(pcmUrl) {
    const raw = await fetch(pcmUrl).then((r) => r.arrayBuffer());
    const pcm = new Int16Array(raw);
    const buffer = audio.createBuffer(1, pcm.length, 16000);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 32768;
    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.connect(microphone);
    await audio.resume();
    source.start();
    return { seconds: buffer.duration };
  },
  snapshot() {
    const voice = useVoiceStore.getState();
    const map = useMapStore.getState();
    return {
      status: voice.status,
      receivedAudioBytes,
      transcripts: voice.transcripts.map(({ role, text }) => ({ role, text })),
      tools: voice.toolActivities.map(({ state, event }) => ({
        name: event.name,
        state,
        ok: event.result?.ok,
        reason: event.result?.reason,
      })),
      routeCount: map.computeRoutes?.length ?? 0,
      selected: map.selectRoute?.route?.routeName,
      location: map.userLocation,
      contextAcks: wire.filter((e) => e.type === "route.context.ack"),
      visibleText: document.getElementById("live-voice-panel").textContent,
    };
  },
  end() {
    useVoiceStore.getState().endSession();
  },
};
