"use client";

import { create } from "zustand";
import { defaultIndoorLevel } from "@/lib/indoor/campusDisplay";
import {
  featureForVenuePlace,
  findVenueModel,
  indoorModelVersion,
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
  /** Change the campus focus without remounting or resetting the camera. */
  setActiveBuilding: (model: LocalIndoorModel) => void;
  setActiveLevel: (ordinal: number) => void;
  setSelectedFeatureId: (id: string | null) => void;
}

function levelForBuilding(model: LocalIndoorModel, current: IndoorCatalog) {
  const previous = current.models.find(
    (item) => venueBuildingKey(item) === current.activeBuildingKey,
  );
  const ref =
    previous?.venueId === model.venueId &&
    indoorModelVersion(previous) === indoorModelVersion(model)
      ? previous.building.levels.find(
          (level) => level.ordinal === current.activeLevel,
        )?.ref
      : undefined;
  return (
    model.building.levels.find((level) => level.ref === ref) ??
    defaultIndoorLevel(model)
  );
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
    if (!model || place.sourceVersion !== indoorModelVersion(model)) return;
    const state = useMapStore.getState();
    if (
      state.indoorExploring &&
      get().models.some(
        (item) =>
          venueBuildingKey(item) === get().activeBuildingKey &&
          item.venueId === model.venueId,
      )
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
    if (!model || place.sourceVersion !== indoorModelVersion(model)) return;
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
      activeLevel: level?.ordinal ?? defaultIndoorLevel(model).ordinal,
      selectedFeatureId: featureForVenuePlace(model, place.placeId)?.id ?? null,
      focusVersion: get().focusVersion + 1,
    });
    useMapStore.getState().setIndoorExploring(true);
  },
  showBuilding: (model) => {
    const level = useMapStore.getState().indoorExploring
      ? levelForBuilding(model, get())
      : defaultIndoorLevel(model);
    set({
      activeBuildingKey: venueBuildingKey(model),
      activeLevel: level.ordinal,
      selectedFeatureId: null,
      focusVersion: get().focusVersion + 1,
    });
    useMapStore.getState().setIndoorExploring(true);
  },
  setActiveBuilding: (model) => {
    if (get().activeBuildingKey !== venueBuildingKey(model))
      set({
        activeBuildingKey: venueBuildingKey(model),
        activeLevel: levelForBuilding(model, get()).ordinal,
        selectedFeatureId: null,
      });
  },
  setActiveLevel: (activeLevel) => {
    if (get().activeLevel !== activeLevel)
      set({ activeLevel, selectedFeatureId: null });
  },
  setSelectedFeatureId: (selectedFeatureId) => set({ selectedFeatureId }),
}));

export default useIndoorCatalog;
