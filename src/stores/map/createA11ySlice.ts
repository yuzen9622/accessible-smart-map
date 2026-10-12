"use client";
import type { Marker } from "@/types";
import { A11yEnum } from "@/types/index";
import type { A11ySlice, MapSliceCreator } from "./types";

export const createA11ySlice: MapSliceCreator<A11ySlice> = (set, get) => ({
  routeA11y: [],
  setRouteA11y: (a11y) => {
    const deduped = Array.from(
      new Map(a11y.map((m) => [m.id, m])).values(),
    ) as Marker[];
    set({ routeA11y: deduped });
  },
  addRouteA11y: (a11y) => set({ routeA11y: [...get().routeA11y, ...a11y] }),
  selectedA11yTypes: new Set<A11yEnum>(),
  toggleA11yType: (type: A11yEnum) => {
    const { selectedA11yTypes } = get();
    if (type === A11yEnum.NONE) {
      set({ selectedA11yTypes: new Set(), a11yDrawerOpen: false });
      return;
    }
    const next = new Set(selectedA11yTypes);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    set({ selectedA11yTypes: next, a11yDrawerOpen: next.size > 0 });
  },
  setSelectedA11yTypes: (types: Set<A11yEnum>) => {
    set({ selectedA11yTypes: types, a11yDrawerOpen: types.size > 0 });
  },
  a11yFilterEnabled: false,
  setA11yFilterEnabled: (enabled) => set({ a11yFilterEnabled: enabled }),
  a11yDrawerOpen: false,
  setA11yDrawerOpen: (open) => set({ a11yDrawerOpen: open }),
  selectA11yPlace: null,
  setSelectA11yPlace: (place) => {
    if (place?.id === get().selectA11yPlace?.id) {
      set({ selectA11yPlace: null });
      return;
    }
    set({ selectA11yPlace: place });
  },
  a11yPlaces: null,
  setA11yPlaces: (places) => {
    const state = get();
    const selected = state.selectA11yPlace;
    const selectedMarker = selected
      ? (places?.find((place) => place.id === selected.id) ??
        (selected.content && selected.canonicalTitle !== undefined
          ? {
              ...selected,
              content: { ...selected.content, title: selected.canonicalTitle },
            }
          : selected))
      : null;
    const addressFor = (id: string | number, fallback: string) => {
      const marker = places?.find((place) => place.id === id);
      if (!marker?.content) return fallback;
      const { title, desc } = marker.content;
      return desc ? `${title} (${desc})` : title;
    };
    // Update only projections explicitly owned by a facility ID. A translated
    // title or coincident coordinates cannot identify an unrelated place.
    const info = state.infoShow;
    const search = state.searchPlace;
    set({
      a11yPlaces: places,
      selectA11yPlace: selectedMarker,
      infoShow:
        info.kind === "coordinate" && info.facilityId !== undefined
          ? {
              ...info,
              address: addressFor(
                info.facilityId,
                info.canonicalAddress ?? info.address,
              ),
            }
          : info,
      searchPlace:
        search?.kind === "coordinate" && search.facilityId !== undefined
          ? {
              ...search,
              address: addressFor(
                search.facilityId,
                search.canonicalAddress ?? search.address,
              ),
            }
          : search,
    });
  },
  nearbyParking: [],
  nearbyParkingLanguage: undefined,
  setNearbyParking: (items, language) => {
    const selected = get().selectedParking;
    set({
      nearbyParking: items,
      nearbyParkingLanguage: language,
      // Selection is identified by ID, but its display belongs to this payload.
      selectedParking: selected
        ? (items.find((item) => item._id === selected._id) ?? null)
        : null,
    });
  },
  selectedParking: null,
  setSelectedParking: (item) => {
    if (item?._id === get().selectedParking?._id) {
      set({ selectedParking: null });
      return;
    }
    set({ selectedParking: item });
  },
  pendingReportContext: null,
});
