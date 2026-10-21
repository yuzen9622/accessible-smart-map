import { mountVoicePanel } from "./ui-regression-probe";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

export async function replayRealVoiceCapture(capture, pcm) {
  const qa = window.qa;
  await qa.reset();
  qa.stores.map.setState({
    userLocation: { lat: 24.1306588, lng: 120.6373201 },
  });
  const socket = await qa.ready();
  await mountVoicePanel();
  const frames = capture.frames;
  for (const frame of frames) {
    if (
      [
        "transcript",
        "transcript.correction",
        "tool_call",
        "tool_result",
        "turn.complete",
      ].includes(frame.type)
    ) {
      socket.event(frame);
      await qa.tick(5);
      const pendingContext = socket.sent
        .filter((value) => typeof value === "string")
        .map((value) => JSON.parse(value))
        .findLast((value) => value.type === "route.context.set");
      if (pendingContext)
        socket.event({
          type: "route.context.ack",
          requestId: pendingContext.requestId,
          selectionVersion: pendingContext.selectionVersion,
          ok: true,
        });
    }
  }
  if (pcm) {
    socket.event(pcm);
    await qa.tick(100);
    assert(
      qa.contexts.some((context) => context.state === "running"),
      "Real browser AudioContext did not run",
    );
  }
  const map = qa.stores.map.getState();
  const voice = qa.stores.voice.getState();
  const plan = frames.find(
    (frame) =>
      frame.type === "tool_result" && frame.name === "planAccessibleRoute",
  );
  assert(
    plan?.result?.ok === true,
    "Capture does not contain successful real plan",
  );
  assert(
    map.computeRoutes.length === plan.result.routes.length,
    "Client lost real route candidates",
  );
  assert(
    map.selectRoute?.route?.routeToken ===
      plan.result.routes.find(
        (route) => route.routeId === plan.result.selectedRouteId,
      )?.routeToken,
    "Client lost selected route identity",
  );
  assert(
    map.computeRoutes.every((route) =>
      route.legs.some((leg) => leg.polyline?.length),
    ),
    "Client lost real route geometry",
  );
  assert(
    voice.transcripts.some(
      (entry) => entry.role === "model" && entry.text.includes("公車"),
    ),
    "Client lost spoken bus answer",
  );
  const panel = document.getElementById("voice-ui-regression");
  const text = panel.textContent;
  assert(
    !/planAccessibleRoute|STALE_SELECTION|current_location|完整結果與查詢條件/.test(
      text,
    ),
    "Technical tool diagnostics leaked into user UI",
  );
  const end = [...panel.querySelectorAll("button")].find((button) =>
    button.textContent.includes("結束語音"),
  );
  assert(
    end &&
      end.getBoundingClientRect().bottom <=
        panel.getBoundingClientRect().bottom,
    "End control overflow",
  );
  assert(
    panel.scrollWidth <= panel.clientWidth + 1,
    "Panel horizontal overflow",
  );
  return {
    passed: true,
    realRouteCount: map.computeRoutes.length,
    selected: map.selectRoute.route.routeName,
    transcripts: voice.transcripts.map((entry) => ({
      role: entry.role,
      text: entry.text,
    })),
    audioContexts: qa.contexts.map((context) => context.state),
    panelWidth: panel.clientWidth,
  };
}

export async function verifyNavigationToolRoundTrip() {
  const { verifyExplicitNavStart } = await import("./tool-coverage-probe");
  await verifyExplicitNavStart();
  const qa = window.qa;
  const socket = qa.sockets.at(-1);
  socket.event({
    type: "tool_result",
    name: "startNavigation",
    callId: "start-selected",
    turnId: "start-turn",
    ok: true,
    result: { ok: true, message: "已開始導航" },
  });
  await qa.tick();
  assert(
    qa.stores.voice
      .getState()
      .toolActivities.find(
        (activity) => activity.event.callId === "start-selected",
      )?.state === "done",
    "Server nav.start echo cancelled its own successful tool result",
  );
  socket.event({ type: "turn.complete" });
  await qa.tick();
  const pending = socket.sent
    .filter((value) => typeof value === "string")
    .map((value) => JSON.parse(value))
    .findLast((value) => value.type === "route.context.set");
  assert(pending, "Route context was never synchronized after turn completion");
  socket.event({
    type: "route.context.ack",
    requestId: pending.requestId,
    selectionVersion: pending.selectionVersion,
    ok: true,
  });
  socket.event({
    type: "tool_call",
    name: "findNearbyParking",
    callId: "manual-superseded",
    turnId: "manual-turn",
  });
  const map = qa.stores.map.getState();
  qa.stores.map.setState({
    selectRoute: { index: 0, route: map.computeRoutes[0] },
    routeGeneration: map.routeGeneration + 1,
  });
  socket.event({
    type: "tool_result",
    name: "findNearbyParking",
    callId: "manual-superseded",
    turnId: "manual-turn",
    ok: true,
    result: {
      ok: true,
      parkingSpots: [
        { name: "Must not be adopted", latitude: 25, longitude: 121 },
      ],
    },
  });
  await qa.tick();
  assert(
    qa.stores.voice
      .getState()
      .toolActivities.find(
        (activity) => activity.event.callId === "manual-superseded",
      )?.state === "cancelled",
    "Manual route selection failed to cancel the old request",
  );
  assert(
    qa.stores.map.getState().aiResultMarkers === map.aiResultMarkers,
    "Manual superseded result changed map markers",
  );
  return {
    passed: true,
    ownNavigationResult: "done",
    manualSupersededResult: "cancelled",
  };
}

export async function verifyPendingStartSupersession() {
  const qa = window.qa;
  await qa.scenario("start");
  const routes = qa.stores.map.getState().computeRoutes;
  const results = [];
  for (const order of ["select-before-event", "event-before-select"]) {
    await qa.reset();
    qa.stores.map.setState({
      computeRoutes: routes,
      selectRoute: { index: 0, route: routes[0] },
    });
    const socket = await qa.ready();
    socket.event({
      type: "tool_call",
      name: "startNavigation",
      callId: "stale-start",
      turnId: "stale-turn",
    });
    const start = {
      type: "nav.start",
      steps: [
        {
          index: 0,
          instruction: "Old route must not start",
          legType: "WALK",
          distanceM: 100,
          isTransit: false,
        },
      ],
      currentStepIndex: 0,
      totalSteps: 1,
    };
    if (order === "event-before-select") socket.event(start);
    qa.stores.map.getState().setRouteSelect({ index: 1, route: routes[1] });
    if (order === "select-before-event") socket.event(start);
    await qa.tick();
    socket.event({
      type: "tool_result",
      name: "startNavigation",
      callId: "stale-start",
      turnId: "stale-turn",
      ok: true,
      result: { ok: true },
    });
    socket.event({ type: "nav.stop" });
    await qa.tick();
    const map = qa.stores.map.getState();
    assert(
      map.selectRoute?.route.routeToken === routes[1].routeToken,
      `${order}: stale start overwrote manual route selection`,
    );
    assert(
      !map.isNavigating && !map.activeNavigationRoute,
      `${order}: stale start activated navigation`,
    );
    assert(
      qa.stores.voice
        .getState()
        .toolActivities.find(
          (activity) => activity.event.callId === "stale-start",
        )?.state !== "done",
      `${order}: stale start reported success`,
    );
    assert(
      socket.sent.some(
        (value) =>
          typeof value === "string" && JSON.parse(value).type === "nav.cancel",
      ),
      `${order}: backend navigation was not cancelled`,
    );
    results.push({ order, passed: true });
  }
  return results;
}

export async function replayRealToolResults(results) {
  const qa = window.qa;
  await qa.reset();
  const socket = await qa.ready();
  await mountVoicePanel();
  const checks = [];
  for (const [index, entry] of results.entries()) {
    const event = entry.frames.find((frame) => frame.type === "tool_result");
    assert(
      event?.type === "tool_result",
      `Missing actual result frame at ${index}`,
    );
    for (const frame of entry.frames) {
      socket.event(frame);
      await qa.tick(5);
    }
    const activity = qa.stores.voice
      .getState()
      .toolActivities.find((item) => item.event.callId === event.callId);
    if (event.name === "endVoiceSession") {
      assert(
        !activity,
        "Internal farewell tool should not become a result card",
      );
      assert(
        qa.stores.voice.getState().status.status === "assistant-ending",
        "Farewell did not enter ending lifecycle",
      );
    } else {
      assert(activity, `Client did not receive ${event.name}`);
      assert(
        activity.state === "done",
        `Real successful ${event.name} did not complete`,
      );
    }
    if (event.name === "startNavigation")
      assert(
        qa.stores.map.getState().isNavigating,
        "Real nav.start did not start UI navigation",
      );
    if (event.name === "confirmNavigationCandidateSwitch")
      assert(
        qa.stores.nav.getState().routeVersion > 1,
        "Real candidate switch did not advance UI route version",
      );
    if (event.name === "stopNavigation")
      assert(
        !qa.stores.map.getState().isNavigating,
        "Real nav.stop did not stop UI navigation",
      );
    const panel = document.getElementById("voice-ui-regression");
    assert(
      !panel.textContent.includes(event.name),
      `Raw tool name exposed for ${event.name}`,
    );
    assert(
      !panel.querySelector("details"),
      `Raw technical details exposed for ${event.name}`,
    );
    assert(
      !panel.querySelector('a[href^="javascript:"]'),
      `Unsafe link in ${event.name}`,
    );
    checks.push({
      tool: event.name,
      clientState: activity?.state ?? qa.stores.voice.getState().status.status,
      panelOverflow: panel.scrollWidth > panel.clientWidth + 1,
    });
    socket.event({ type: "turn.complete" });
    await qa.tick(5);
    const pendingContext = socket.sent
      .filter((value) => typeof value === "string")
      .map((value) => JSON.parse(value))
      .findLast((value) => value.type === "route.context.set");
    if (pendingContext)
      socket.event({
        type: "route.context.ack",
        requestId: pendingContext.requestId,
        selectionVersion: pendingContext.selectionVersion,
        ok: true,
      });
  }
  assert(
    checks.every((check) => !check.panelOverflow),
    "A real tool response overflowed the voice panel",
  );
  return checks;
}
