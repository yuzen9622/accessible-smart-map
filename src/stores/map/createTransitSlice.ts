"use client";
import type { MapSliceCreator, TransitSlice } from "./types";

export const createTransitSlice: MapSliceCreator<TransitSlice> = (set) => ({
  liveBusPositions: [],
  setLiveBusPositions: (positions) => set({ liveBusPositions: positions }),
  activeBusLeg: null,
  // Clearing the vehicles in the same set() keeps the map marker from lingering
  // on the previous leg's bus until the next poll lands.
  setActiveBusLeg: (active) =>
    set({ activeBusLeg: active, liveBusPositions: [] }),
  setBoardReadiness: (key, readyInSeconds) =>
    set((state) => {
      const active = state.activeBusLeg;
      const context = active?.leg.planContext;
      if (active?.key !== key || !context) return state;
      if ((context.readyInSeconds ?? null) === readyInSeconds) return state;
      const { readyInSeconds: _previous, ...rest } = context;
      return {
        activeBusLeg: {
          ...active,
          leg: {
            ...active.leg,
            planContext:
              readyInSeconds === null ? rest : { ...rest, readyInSeconds },
          },
        },
      };
    }),
  nearbyBusStops: [],
  setNearbyBusStops: (stops) => set({ nearbyBusStops: stops }),
  busRouteStops: [],
  busRoutePolyline: [],
  setBusRouteStops: (stops, polyline = []) =>
    set({ busRouteStops: stops, busRoutePolyline: polyline }),
  selectedBusStop: null,
  setSelectedBusStop: (stop) => set({ selectedBusStop: stop }),
});
