import { createRoot } from "react-dom/client";
import VoiceModeView from "@/components/Voice/VoiceModeView";
import useMapStore from "@/stores/useMapStore";
import useVoiceStore from "@/stores/useVoiceStore";
import "@/app/globals.css";

const flights = [];
useMapStore.setState({
  map: { flyTo: (options) => flights.push(options) },
  chatOpen: true,
});
const result = (name, payload) => ({
  id: name,
  state: "done",
  event: {
    type: "result",
    name,
    args: { privateArgument: "DO_NOT_RENDER" },
    result: payload,
    summary: JSON.stringify(payload),
  },
});
const fixtures = {
  success: [
    result("findCampusAccessibility", {
      ok: true,
      campuses: [
        {
          campusId: 62,
          schoolName: "臺中科技大學",
          branchName: "三民校區",
          location: { type: "Point", coordinates: [120.683, 24.15] },
        },
      ],
    }),
    result("findNearbyParking", {
      ok: true,
      parkingSpots: [
        {
          name: "三民校區無障礙停車場",
          address: "三民路校門旁",
          disabledSpaces: 3,
          latitude: 24.151,
          longitude: 120.684,
        },
      ],
    }),
    result("webSearch", {
      ok: true,
      answer: "校門入口設有無障礙坡道，抵達後請留意地面高低差。",
      sources: [
        { title: "校園交通指南", url: "https://example.org/accessibility" },
        { title: "不可執行來源", url: "javascript:alert(1)" },
      ],
    }),
    result("proposeNavigationCandidate", { ok: true, candidates: [] }),
  ],
  pending: [
    {
      id: "loading",
      state: "pending",
      event: {
        type: "call",
        name: "planAccessibleRoute",
        args: { origin: "current_location" },
      },
    },
  ],
  cancelled: [
    result("planAccessibleRoute", {
      ok: false,
      reason: "STALE_SELECTION",
      error: "缺少位置資訊",
    }),
  ],
  failure: [
    result("webSearch", { ok: false, error: "來源暫時不可用，請稍後再試。" }),
  ],
  empty: [result("webSearch", { ok: true, answer: "", sources: [] })],
};
window.parity = {
  setFixture(name) {
    useVoiceStore.setState({
      status: { status: "listening" },
      toolActivities: fixtures[name],
      transcripts: [
        {
          id: 1,
          role: "user",
          text: "三民校區有哪些無障礙設施？",
          raw: "三民校區有哪些無障礙設施？",
          sealed: true,
        },
        {
          id: 2,
          role: "model",
          text: "我幫你整理了校園設施和附近停車場。",
          raw: "我幫你整理了校園設施和附近停車場。",
          sealed: true,
        },
      ],
    });
  },
  inspect() {
    const panel = document.getElementById("voice-parity-panel");
    return {
      text: panel.textContent,
      flights,
      chatOpen: useMapStore.getState().chatOpen,
      width: panel.clientWidth,
      scrollWidth: panel.scrollWidth,
      details: panel.querySelectorAll("details, dl").length,
      links: [...panel.querySelectorAll("a")].map(({ href, rel }) => ({
        href,
        rel,
      })),
    };
  },
};
window.parity.setFixture("success");
createRoot(document.getElementById("root")).render(
  <main
    id="voice-parity-panel"
    className="bg-card border border-border rounded-2xl overflow-hidden flex flex-col"
    style={{
      width: "min(440px, calc(100vw - 24px))",
      height: "min(720px, calc(100dvh - 24px))",
      margin: "12px auto",
    }}
  >
    <h1 className="font-semibold px-4 py-3 border-b">無障礙智慧地圖 AI 助理</h1>
    <VoiceModeView />
  </main>,
);
