// Supplemental regression, not a replacement for frozen acceptance.
import { createRoot } from "react-dom/client";
import useNavigation from "@/hook/useNavigation";
import useMapStore from "@/stores/useMapStore";
import useNavStore from "@/stores/useNavStore";

function Engine() {
  useNavigation();
  return null;
}
export async function verifyNavigationContinues() {
  const qa = window.qa;
  await qa.reset();
  const fetch = window.fetch;
  // An unavailable instructions service must not freeze carried voice steps.
  window.fetch = (input, options) =>
    String(input).includes("/instructions")
      ? new Promise(() => {})
      : fetch(input, options);
  const rootElement = document.createElement("div");
  document.body.append(rootElement);
  const root = createRoot(rootElement);
  try {
    const s = await qa.ready();
    const route = {
      routeId: "probe",
      navigationId: "probe-nav",
      routeVersion: 1,
      routeToken: "probe-token",
      routeName: "Probe walk",
      totalMinutes: 5,
      transferCount: 0,
      accessibilityHighlights: [],
      legs: [
        {
          type: "WALK",
          from: "A",
          to: "B",
          distanceM: 210,
          minutesEst: 5,
          a11yFacilities: [],
          polyline: [
            [121.56, 25.03],
            [121.561, 25.03],
            [121.562, 25.03],
          ],
        },
      ],
    };
    useMapStore.setState({
      selectRoute: { index: 0, route },
      computeRoutes: [route],
      userLocation: { lat: 25.03, lng: 121.56 },
    });
    s.event({
      type: "nav.start",
      steps: [0, 1, 2].map((index) => ({
        index,
        instruction: `probe step ${index}`,
        legType: "WALK",
        distanceM: 100,
        isTransit: false,
      })),
      currentStepIndex: 0,
      totalSteps: 3,
    });
    await qa.tick();
    root.render(<Engine />);
    await qa.tick();
    s.event({ type: "session.ending", reason: "assistant-end" });
    s.closed(1000, "assistant-end");
    await qa.tick(150);
    if (
      !useMapStore.getState().isNavigating ||
      useMapStore.getState().activeNavigationRoute !== route
    )
      throw new Error("navigation route/UI cleared");
    if (useNavStore.getState().navigationSource !== "local")
      throw new Error("local engine did not take over");
    useMapStore.setState({ userLocation: { lat: 25.03, lng: 121.561 } });
    await qa.tick(150);
    if (useNavStore.getState().currentStepIndex < 1)
      throw new Error(
        "GPS did not advance carried instructions after graceful voice end",
      );
    if (
      s.sent.some(
        (data) =>
          typeof data === "string" &&
          ["nav.cancel", "session.end"].includes(JSON.parse(data).type),
      )
    )
      throw new Error("backend snapshot cancelled");
    return {
      passed: true,
      step: useNavStore.getState().currentStepIndex,
      navigating: useMapStore.getState().isNavigating,
      routeToken: useMapStore.getState().activeNavigationRoute.routeToken,
    };
  } finally {
    root.unmount();
    rootElement.remove();
    window.fetch = fetch;
  }
}
