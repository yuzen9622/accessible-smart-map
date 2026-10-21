import { createRoot } from "react-dom/client";
import NavigationHUD from "@/components/Navigation/NavigationHUD";

function assert(value, message) {
  if (!value) throw new Error(message);
}

export async function verifyToolPresentation() {
  const qa = window.qa;
  await qa.reset();
  const socket = await qa.ready();
  const call = (callId, name, turnId = "tools-turn") =>
    socket.event({ type: "tool_call", callId, name, turnId });
  const result = (callId, name, payload, ok = true) =>
    socket.event({
      type: "tool_result",
      callId,
      name,
      turnId: "tools-turn",
      ok,
      durationMs: 21,
      result: payload,
    });
  call("p1", "findNearbyParking");
  call("p2", "findNearbyParking");
  await qa.tick();
  assert(
    qa.stores.voice
      .getState()
      .toolActivities.filter((item) => item.state === "pending").length === 2,
    "simultaneous same-tool calls not independently pending",
  );
  result("p2", "findNearbyParking", {
    ok: true,
    parkingSpots: [
      {
        name: "市府地下停車場測試",
        address: "市府路測試入口",
        disabledSpaces: 8,
        latitude: 25.03,
        longitude: 121.56,
      },
    ],
    total: 1,
  });
  await qa.tick();
  assert(
    document.body.textContent.includes("市府地下停車場測試"),
    "full parking result not rendered in voice UI",
  );
  assert(
    qa.stores.map
      .getState()
      .aiResultMarkers.some((marker) =>
        marker.title.includes("市府地下停車場測試"),
      ),
    "parking tool did not update map markers",
  );
  const markerBefore = qa.stores.map.getState().aiResultMarkers;
  result("p1", "findNearbyParking", {
    ok: false,
    error: "停車查詢暫時失敗測試",
  });
  await qa.tick();
  assert(
    document.body.textContent.includes("停車查詢暫時失敗測試"),
    "inner failure not shown",
  );
  assert(
    qa.stores.map.getState().aiResultMarkers === markerBefore,
    "failed tool cleared existing markers",
  );
  call("r1", "planAccessibleRoute");
  result("r1", "planAccessibleRoute", {
    ok: false,
    reason: "LOCATION_REQUIRED",
    error: "需要位置測試",
  });
  await qa.tick();
  assert(
    qa.stores.voice.getState().status.status === "listening",
    "LOCATION_REQUIRED terminated voice",
  );
  call("w1", "webSearch");
  result("w1", "webSearch", {
    answer: "無障礙入口查詢測試答案",
    sources: [
      { title: "官方測試來源", url: "https://example.org/a11y" },
      { title: "不可執行來源", url: "javascript:alert(1)" },
    ],
  });
  await qa.tick();
  for (const detail of document.querySelectorAll(
    '[data-testid="voice-panel"] details',
  ))
    detail.open = true;
  await qa.tick();
  assert(
    document.body.textContent.includes("無障礙入口查詢測試答案"),
    "web answer lost",
  );
  assert(
    document.querySelector('a[href="https://example.org/a11y"]'),
    "safe source is not linked",
  );
  assert(
    !document.querySelector('a[href^="javascript:"]'),
    "unsafe source made clickable",
  );
  call("pending", "getAirQuality");
  socket.event({ type: "interrupted" });
  await qa.tick();
  assert(
    !qa.stores.voice
      .getState()
      .toolActivities.some((item) => item.state === "pending"),
    "interruption left a permanent loading",
  );
  const before = qa.stores.voice.getState().toolActivities;
  result("pending", "getAirQuality", { ok: true, pm25: 12 });
  await qa.tick();
  assert(
    qa.stores.voice.getState().toolActivities === before,
    "late interrupted result was applied",
  );
  return {
    passed: true,
    activities: before.length,
    mapMarkers: markerBefore.length,
  };
}

export async function verifyPlanAdoption() {
  const qa = window.qa;
  await qa.reset();
  const socket = await qa.ready();
  const route = (routeId) => ({
    routeId,
    routeName: routeId,
    routeToken: `plan-${routeId}-token`,
    navigationId: `plan-${routeId}-nav`,
    routeVersion: 1,
    totalMinutes: 15,
    transferCount: 0,
    accessibilityHighlights: [],
    warnings: ["測試路段提醒"],
    legs: [
      {
        type: "BUS",
        routeName: "307",
        departureStop: "市府",
        arrivalStop: "公館",
        polyline: [
          [121.5, 25],
          [121.51, 25.01],
        ],
        waitInfo: { source: "unavailable", time: null },
        estimatedWaitMinutes: 0,
        direction: 0,
        departureStopA11y: [],
        arrivalStopA11y: [],
      },
    ],
  });
  const plan = {
    ok: true,
    routeContractVersion: 1,
    planId: "voice-plan",
    selectedRouteId: "b",
    origin: { name: "起點", lat: 25, lng: 121.5 },
    destination: { name: "終點", lat: 25.01, lng: 121.51 },
    effectivePreferences: {
      mode: "wheelchair",
      travelMode: "transit",
      transitPreference: "bus",
      maxTransfers: 2,
      avoidStairs: true,
      requireElevator: true,
    },
    routes: [route("a"), route("b")],
  };
  const originalFetch = window.fetch;
  const requests = [];
  window.fetch = (input, options) => {
    requests.push(String(input));
    return originalFetch(input, options);
  };
  try {
    socket.event({
      type: "tool_call",
      name: "planAccessibleRoute",
      callId: "plan-call",
      turnId: "plan-turn",
    });
    socket.event({
      type: "tool_result",
      name: "planAccessibleRoute",
      callId: "plan-call",
      turnId: "plan-turn",
      ok: true,
      durationMs: 21,
      result: plan,
    });
    await qa.tick();
    const map = qa.stores.map.getState();
    assert(
      map.computeRoutes.length === 2 && map.selectRoute.route.routeId === "b",
      "full candidates/selectedRouteId not adopted",
    );
    assert(
      map.selectRoute.route.routeToken === "plan-b-token",
      "routeToken lost",
    );
    assert(
      JSON.stringify(map.selectRoute.route.legs[0].polyline) ===
        JSON.stringify(plan.routes[1].legs[0].polyline),
      "geometry changed",
    );
    assert(
      map.selectRoute.route.legs[0].routeName === "307",
      "bus metadata lost",
    );
    assert(
      !map.isNavigating && !map.activeNavigationRoute,
      "a planning result started navigation without nav.start",
    );
    assert(
      !requests.some((url) => /accessible|compute|plan|reroute/.test(url)),
      "planning tool caused a second planning request",
    );
    return {
      passed: true,
      candidates: map.computeRoutes.length,
      selectedRouteId: map.selectRoute.route.routeId,
      planningRequests: requests,
    };
  } finally {
    window.fetch = originalFetch;
  }
}

export async function verifyExplicitNavStart() {
  const qa = window.qa;
  await qa.scenario("start");
  const routes = qa.stores.map.getState().computeRoutes;
  await qa.reset();
  const socket = await qa.ready();
  qa.stores.map.setState({
    computeRoutes: routes,
    selectRoute: { index: 1, route: routes[1] },
  });
  socket.event({
    type: "tool_call",
    name: "startNavigation",
    callId: "start-selected",
    turnId: "start-turn",
  });
  socket.event({
    type: "nav.start",
    steps: [
      {
        index: 0,
        instruction: "選中路線測試",
        legType: "WALK",
        distanceM: 100,
        isTransit: false,
      },
    ],
    currentStepIndex: 0,
    totalSteps: 1,
  });
  await qa.tick();
  assert(
    qa.stores.map.getState().activeNavigationRoute?.routeToken ===
      routes[1].routeToken,
    "explicit start did not use its armed route",
  );
  assert(
    qa.stores.map.getState().selectRoute.index === 1,
    "selected route index was overwritten",
  );
  return { passed: true, routeToken: routes[1].routeToken };
}

export async function verifyResumeSnapshot() {
  const qa = window.qa;
  await qa.scenario("start");
  const socket = qa.sockets.at(-1);
  qa.stores.nav.setState({
    currentStepIndex: 0,
    distanceToNextM: 6,
    remainingM: 80,
    remainingDurationSec: 60,
    estimatedArrivalAt: Date.now() + 60000,
    etaSource: "realtime",
  });
  socket.event({
    type: "nav.resume_ok",
    navigationId: "nav-a",
    routeVersion: 1,
    routeToken: "nav-a-t1",
    currentStepIndex: 1,
    totalSteps: 2,
    onVehicle: true,
    steps: [
      {
        index: 0,
        instruction: "前往站牌",
        type: "depart",
        legType: "WALK",
        distanceM: 40,
        isTransit: false,
      },
      {
        index: 1,
        instruction: "搭乘藍7",
        type: "transit_board",
        legType: "BUS",
        distanceM: null,
        isTransit: true,
      },
    ],
  });
  await qa.tick();
  const nav = qa.stores.nav.getState();
  assert(
    nav.currentStepIndex === 1 && nav.instructions[1].text === "搭乘藍7",
    "resume did not adopt authoritative steps/index",
  );
  assert(nav.voiceTransit?.onVehicle === true, "resume dropped onVehicle");
  assert(
    nav.distanceToNextM === null &&
      nav.remainingM === null &&
      nav.remainingDurationSec === null &&
      nav.estimatedArrivalAt === null,
    "resume retained stale pre-disconnect progress",
  );
  return {
    passed: true,
    step: nav.currentStepIndex,
    onVehicle: nav.voiceTransit.onVehicle,
  };
}

export async function verifyVoiceTransit() {
  const qa = window.qa;
  await qa.scenario("start");
  const socket = qa.sockets.at(-1);
  socket.event({
    type: "nav.transit",
    leg: {
      mode: "BUS",
      from: "市政府站測試",
      to: "松山車站測試",
      routeName: "藍7測試",
    },
  });
  await qa.tick();
  const element = document.createElement("section");
  document.body.append(element);
  const root = createRoot(element);
  try {
    root.render(<NavigationHUD />);
    await qa.tick(100);
    assert(
      element.textContent.includes("市政府站測試"),
      "nav.transit boarding stop not rendered by HUD",
    );
    assert(
      element.textContent.includes("松山車站測試"),
      "nav.transit alighting stop not rendered by HUD",
    );
    assert(
      element.textContent.includes("藍7測試"),
      "nav.transit route name not rendered by HUD",
    );
    return { passed: true, transit: qa.stores.nav.getState().voiceTransit };
  } finally {
    root.unmount();
    element.remove();
  }
}
