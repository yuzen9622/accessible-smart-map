"use client";

import { create } from "zustand";
import {
  featureForVenuePlace,
  findVenueModel,
  venueBuildingKey,
} from "@/lib/indoor/catalog";
import type { LocalIndoorModel } from "@/lib/indoor/types";
import type { VenuePlaceDetail } from "@/types";
import useMapStore from "./useMapStore";

interface IndoorCatalog {
  models: LocalIndoorModel[];
  activeBuildingKey: string | null;
  activeLevel: number;
  selectedFeatureId: string | null;
  focusVersion: number;
  setModels: (models: LocalIndoorModel[]) => void;
  showPlace: (place: VenuePlaceDetail) => void;
  previewPlace: (place: VenuePlaceDetail) => void;
  showBuilding: (model: LocalIndoorModel) => void;
  setActiveLevel: (ordinal: number) => void;
  setSelectedFeatureId: (id: string | null) => void;
}

/** Catalog and viewing state only. The original map store owns every route session. */
const useIndoorCatalog = create<IndoorCatalog>((set, get) => ({
  models: [],
  activeBuildingKey: null,
  activeLevel: 0,
  selectedFeatureId: null,
  focusVersion: 0,
  setModels: (models) => set({ models }),
  previewPlace: (place) => {
    const model = findVenueModel(get().models, place);
    if (!model || place.sourceVersion !== model.source.sha256) return;
    const state = useMapStore.getState();
    if (
      state.indoorExploring &&
      get().activeBuildingKey === venueBuildingKey(model)
    ) {
      get().showPlace(place);
      return;
    }
    // Searching a destination does not declare that the user has entered it.
    // An explicit building click or the navigation handoff opens the cutaway.
    state.setIndoorExploring(false);
    state.map?.flyTo({
      center: [place.position.lng, place.position.lat],
      zoom: 16.5,
      duration: 800,
    });
  },
  showPlace: (place) => {
    const model = findVenueModel(get().models, place);
    if (!model || place.sourceVersion !== model.source.sha256) return;
    if (place.buildingId === null || place.levelRef === null) {
      const mapState = useMapStore.getState();
      mapState.setIndoorExploring(false);
      mapState.map?.flyTo({
        center: [place.position.lng, place.position.lat],
        zoom: 18.3,
        duration: 800,
      });
      return;
    }
    const level = model.building.levels.find(
      (item) => item.ref === place.levelRef,
    );
    set({
      activeBuildingKey: venueBuildingKey(model),
      activeLevel: level?.ordinal ?? model.building.levels[0].ordinal,
      selectedFeatureId: featureForVenuePlace(model, place.placeId)?.id ?? null,
      focusVersion: get().focusVersion + 1,
    });
    useMapStore.getState().setIndoorExploring(true);
  },
  showBuilding: (model) => {
    const sameBuilding = get().activeBuildingKey === venueBuildingKey(model);
    set({
      activeBuildingKey: venueBuildingKey(model),
      activeLevel: sameBuilding
        ? get().activeLevel
        : model.building.levels[0].ordinal,
      selectedFeatureId: null,
      focusVersion: get().focusVersion + 1,
    });
    useMapStore.getState().setIndoorExploring(true);
  },
  setActiveLevel: (activeLevel) =>
    set({ activeLevel, selectedFeatureId: null }),
  setSelectedFeatureId: (selectedFeatureId) => set({ selectedFeatureId }),
}));

export default useIndoorCatalog;
