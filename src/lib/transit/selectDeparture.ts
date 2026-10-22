import { selectBusDeparture } from "@/lib/api/a11y";
import { busLegKey } from "@/lib/transit/busLegStops";
import useMapStore from "@/stores/useMapStore";

let pending: AbortController | null = null;

export async function adoptBusDeparture(
  routeToken: string,
  legIndex: number,
  candidateId: string,
): Promise<boolean> {
  const initial = useMapStore.getState();
  if (
    initial.isNavigating ||
    initial.selectRoute?.route.routeToken !== routeToken ||
    initial.selectRoute.route.legs[legIndex]?.type !== "BUS"
  )
    return false;
  pending?.abort();
  const controller = new AbortController();
  pending = controller;
  const selection = { routeToken, legIndex, candidateId };
  const isCurrent = () => {
    const state = useMapStore.getState();
    return (
      pending === controller &&
      !controller.signal.aborted &&
      !state.isNavigating &&
      state.routeGeneration === initial.routeGeneration &&
      state.selectRoute?.route.routeToken === routeToken
    );
  };
  useMapStore.setState({ busSelection: { ...selection, status: "pending" } });
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const result = await selectBusDeparture(selection, controller.signal);
    if (controller.signal.aborted) throw new Error("Bus selection cancelled");
    if (!isCurrent()) return false;
    if (!result.ok || !result.data?.route)
      throw new Error("Bus selection failed");
    const state = useMapStore.getState();
    const selected = state.selectRoute;
    if (!selected) return false;
    const route = result.data.route;
    const openContext = state.activeBusLeg?.leg.planContext;
    const openIndex =
      openContext?.routeToken === routeToken ? openContext.legIndex : undefined;
    const openLeg = openIndex === undefined ? undefined : route.legs[openIndex];
    const updatedOpenLeg =
      openLeg?.type === "BUS" && route.routeToken && openIndex !== undefined
        ? {
            ...openLeg,
            planContext: { routeToken: route.routeToken, legIndex: openIndex },
          }
        : null;
    const replace = (entry: typeof route) =>
      entry.routeToken === routeToken ? route : entry;
    const outdoor = state.venueJourney?.outdoor;
    const approachRoutes = { ...outdoor?.approachRoutes };
    if (route.routeToken && approachRoutes[routeToken]) {
      approachRoutes[route.routeToken] = approachRoutes[routeToken];
      delete approachRoutes[routeToken];
    }
    useMapStore.setState({
      busSelection: null,
      routeGeneration: state.routeGeneration + 1,
      computeRoutes: state.computeRoutes?.map(replace) ?? null,
      selectRoute: { index: selected.index, route },
      selectedRouteId: route.routeId ?? null,
      activeBusLeg: updatedOpenLeg
        ? {
            key: busLegKey(`${selected.index}:${openIndex}`, updatedOpenLeg),
            leg: updatedOpenLeg,
          }
        : null,
      liveBusPositions: [],
      ...(outdoor && state.venueJourney
        ? {
            venueJourney: {
              ...state.venueJourney,
              outdoor: {
                ...outdoor,
                routes: outdoor.routes.map(replace),
                ...(outdoor.approachRoutes ? { approachRoutes } : {}),
              },
            },
          }
        : {}),
    });
    return true;
  } catch {
    const state = useMapStore.getState();
    if (
      pending === controller &&
      state.routeGeneration === initial.routeGeneration &&
      state.selectRoute?.route.routeToken === routeToken &&
      !state.isNavigating
    )
      useMapStore.setState({ busSelection: { ...selection, status: "error" } });
    return false;
  } finally {
    clearTimeout(timeout);
    if (pending === controller) pending = null;
  }
}
