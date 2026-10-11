import { create } from "zustand";
import type { TrackingSnapshot } from "@/lib/transit/busPanelTracking";

const useBusTrackingStore = create<{
  snapshot: TrackingSnapshot | null;
  publish: (snapshot: TrackingSnapshot | null) => void;
}>((set) => ({ snapshot: null, publish: (snapshot) => set({ snapshot }) }));
export default useBusTrackingStore;
