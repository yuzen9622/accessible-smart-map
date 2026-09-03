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
  nearbyBusStops: [],
  setNearbyBusStops: (stops) => set({ nearbyBusStops: stops }),
  busRouteStops: [],
  setBusRouteStops: (stops) => set({ busRouteStops: stops }),
  selectedBusStop: null,
  setSelectedBusStop: (stop) => set({ selectedBusStop: stop }),
});
