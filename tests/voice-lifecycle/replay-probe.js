// Supplemental regression for the independent review finding.
export async function verifyResumeMetadata() {
  const qa = window.qa;
  await qa.scenario("resume");
  const socket = qa.sockets.at(-1);
  const route = {
    ...qa.stores.map.getState().activeNavigationRoute,
    routeVersion: 3,
    routeToken: "nav-a-t3",
  };
  const step = {
    index: 0,
    instruction: "new replay step",
    legType: "WALK",
    distanceM: 20,
    isTransit: false,
  };
  socket.event({
    type: "nav.route_replaced",
    navigationId: "nav-a",
    previousRouteVersion: 2,
    routeVersion: 3,
    routeToken: "nav-a-t3",
    route,
    steps: [step],
    warnings: ["keep this warning"],
    currentStepIndex: 0,
    reason: "MANUAL",
  });
  socket.event({
    type: "nav.resume_ok",
    navigationId: "nav-a",
    routeVersion: 3,
    routeToken: "nav-a-t3",
    steps: [step],
    currentStepIndex: 0,
    totalSteps: 1,
    onVehicle: false,
  });
  await qa.tick();
  const nav = qa.stores.nav.getState();
  if (
    nav.warnings[0] !== "keep this warning" ||
    nav.lastRerouteReason !== "MANUAL"
  )
    throw new Error("resume erased replacement warnings/reason");
  return {
    passed: true,
    routeVersion: nav.routeVersion,
    warnings: nav.warnings,
    reason: nav.lastRerouteReason,
  };
}
