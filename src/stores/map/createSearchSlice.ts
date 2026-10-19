"use client";
import type { PlaceDetail } from "@/types";
import type { MapSliceCreator, SearchSlice } from "./types";
import { placeKey } from "./types";

export const createSearchSlice: MapSliceCreator<SearchSlice> = (set, get) => ({
  searchPlace: null,
  setSearchPlace: (place) => set({ searchPlace: place }),
  searchHistory: [],
  initSearchHistory: (history) => {
    const validHistory = history.filter((item) => {
      const name =
        item.kind === "place"
          ? item.place.name || item.place.fullAddress || ""
          : item.address;
      return Boolean(name?.trim());
    });
    const seen = new Set<string>();
    const dedupedHistory = validHistory.filter((item) => {
      const key = placeKey(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    set({ searchHistory: dedupedHistory });
  },
  addSearchHistory: (searchTerm: PlaceDetail) => {
    const name =
      searchTerm.kind === "place"
        ? searchTerm.place.name || searchTerm.place.fullAddress || ""
        : searchTerm.address;
    if (!name?.trim()) return;
    const { searchHistory } = get();
    const key = placeKey(searchTerm);
    const deduped = searchHistory.filter((item) => placeKey(item) !== key);
    const newHistory = [searchTerm, ...deduped.slice(0, 9)];
    localStorage.setItem("searchHistory", JSON.stringify(newHistory));
    set({ searchHistory: newHistory });
  },
  clearSearchHistory: () => {
    try {
      localStorage.removeItem("searchHistory");
    } catch {
      // ignore localStorage failures
    }
    set({ searchHistory: [] });
  },
  savedPlaces: [],
  savedPlaceKeys: new Set<string>(),
  savedPlaceCategories: {},
  initSavedPlaces: (places) => {
    const seen = new Set<string>();
    const validPlaces = places.filter((item) => {
      const name =
        item.kind === "place"
          ? item.place.name || item.place.fullAddress || ""
          : item.address;
      const key = placeKey(item);
      if (!name?.trim() || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    set({
      savedPlaces: validPlaces,
      savedPlaceKeys: new Set(validPlaces.map(placeKey)),
    });
  },
  initSavedPlaceCategories: (cats) => set({ savedPlaceCategories: cats }),
  addSavedPlace: (place) => {
    const name =
      place.kind === "place"
        ? place.place.name || place.place.fullAddress || ""
        : place.address;
    if (!name?.trim()) return;
    const { savedPlaces, savedPlaceKeys } = get();
    const key = placeKey(place);
    if (savedPlaceKeys.has(key)) return;
    const updated = [place, ...savedPlaces];
    const nextKeys = new Set(savedPlaceKeys);
    nextKeys.add(key);
    localStorage.setItem("savedPlaces", JSON.stringify(updated));
    set({ savedPlaces: updated, savedPlaceKeys: nextKeys });
  },
  removeSavedPlace: (place) => {
    const { savedPlaces, savedPlaceKeys, savedPlaceCategories } = get();
    const key = placeKey(place);
    if (!savedPlaceKeys.has(key)) return;
    const updated = savedPlaces.filter((p) => placeKey(p) !== key);
    const nextKeys = new Set(savedPlaceKeys);
    nextKeys.delete(key);
    const nextCats = { ...savedPlaceCategories };
    delete nextCats[key];
    localStorage.setItem("savedPlaces", JSON.stringify(updated));
    localStorage.setItem("savedPlaceCategories", JSON.stringify(nextCats));
    set({
      savedPlaces: updated,
      savedPlaceKeys: nextKeys,
      savedPlaceCategories: nextCats,
    });
  },
  clearSavedPlaces: () => {
    try {
      localStorage.removeItem("savedPlaces");
      localStorage.removeItem("savedPlaceCategories");
    } catch {
      // ignore localStorage failures
    }
    set({
      savedPlaces: [],
      savedPlaceKeys: new Set<string>(),
      savedPlaceCategories: {},
    });
  },
  isSavedPlace: (place) => {
    return get().savedPlaceKeys.has(placeKey(place));
  },
  setSavedPlaceCategory: (place, category) => {
    const { savedPlaceCategories } = get();
    const key = placeKey(place);
    const next = { ...savedPlaceCategories };
    if (category) next[key] = category;
    else delete next[key];
    localStorage.setItem("savedPlaceCategories", JSON.stringify(next));
    set({ savedPlaceCategories: next });
  },
  pendingSearchQuery: "",
  setPendingSearchQuery: (query) => set({ pendingSearchQuery: query }),
  pendingAiQuery: "",
  setPendingAiQuery: (query) => set({ pendingAiQuery: query }),
  chatOpen: false,
  setChatOpen: (v) =>
    // Also un-collapse the desktop sidebar when opening: the AI panel is
    // rendered inside Layer 2, which stays `inert`+off-screen while
    // `sidebarCollapsed` is true (see BottomSheet.tsx) — the rail's own
    // click handler already does this un-collapse, but the several other
    // entry points that open chat directly (home screen mic, floating FAB,
    // onboarding, voice) don't go through that handler, so without this a
    // desktop user with the sidebar collapsed would tap one of those and
    // nothing visibly happens.
    set(v ? { chatOpen: v, sidebarCollapsed: false } : { chatOpen: v }),
  aiResultMarkers: [],
  setAiResultMarkers: (markers) => set({ aiResultMarkers: markers }),
});
