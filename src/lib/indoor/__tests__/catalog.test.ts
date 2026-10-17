import { describe, expect, it, vi } from "vitest";
import useIndoorCatalog from "@/stores/useIndoorCatalog";
import useMapStore from "@/stores/useMapStore";
import {
  featureForVenuePlace,
  findVenueModel,
  placeForVenueFeature,
  refreshVenuePlace,
  searchVenuePlaces,
  toVenuePlaceDetail,
} from "../catalog";
import type { LocalIndoorModel } from "../types";

function model(buildingId = "a"): LocalIndoorModel {
  return {
    schemaVersion: 1,
    venueId: "synthetic-campus",
    name: "Synthetic school",
    source: { sha256: "v1", generatedAt: "test", warnings: [] },
    origin: [0, 0],
    building: {
      id: buildingId,
      name: `Building ${buildingId}`,
      footprint: [],
      levels: [
        { ordinal: 0, ref: "1F", elevationM: 0 },
        { ordinal: 1, ref: "2F", elevationM: 4 },
      ],
      floorHeightM: 4,
      geometryStatus: "schematic",
      heightStatus: "estimated",
    },
    features: [0, 1].map((ordinal) => ({
      id: `shape-${ordinal}`,
      kind: "room" as const,
      buildingId,
      levelRef: `${ordinal + 1}F`,
      ordinal,
      ref: "101",
      name: "Room 101",
      geometry: {
        type: "Polygon" as const,
        coordinates: [
          [
            [0, 0],
            [4, 0],
            [4, 4],
            [0, 0],
          ],
        ],
      },
      tags: {},
      geometryStatus: "schematic",
      heightStatus: "estimated",
    })),
    places: [0, 1].map((ordinal) => ({
      id: `room-${ordinal}`,
      buildingId,
      name: "Room 101",
      ref: "101",
      kind: "room",
      nodeId: `arrival-${ordinal}`,
      point: [3, 0, ordinal * 4],
      levelRef: `${ordinal + 1}F`,
      routeEndpoint: "corridor",
      doorKnown: false,
      arrivalOnly: true,
      tags: {},
    })),
    nodes: [],
    edges: [],
    connections: [],
    walls: [],
  };
}

describe("venue catalog identity", () => {
  it("keeps equal coordinates and room numbers distinct across buildings and floors", () => {
    const a = model("a"),
      b = model("b");
    const matches = searchVenuePlaces([a, b], "101");
    expect(matches).toHaveLength(4);
    expect(
      new Set(matches.map((p) => `${p.buildingId}/${p.levelRef}/${p.placeId}`))
        .size,
    ).toBe(4);
    for (const p of matches)
      expect(findVenueModel([a, b], p)?.building.id).toBe(p.buildingId);
  });
  it("de-duplicates a shared outdoor gate without assigning it to a building", () => {
    const a = model("a"),
      b = model("b");
    const gate = {
      ...a.places[0],
      id: "gate",
      name: "Gate",
      buildingId: null,
      levelRef: null,
    };
    a.places.push(gate);
    b.places.push(gate);
    const matches = searchVenuePlaces([a, b], "Gate");
    expect(matches).toHaveLength(1);
    expect(matches[0].buildingId).toBeNull();
    expect(matches[0].levelRef).toBeNull();
  });
  it("resolves only this floor's arrival and never moves the room to that point", () => {
    const a = model();
    const original = structuredClone(a.features);
    expect(featureForVenuePlace(a, "room-1")?.id).toBe("shape-1");
    expect(placeForVenueFeature(a, a.features[0])?.id).toBe("room-0");
    expect(toVenuePlaceDetail(a, a.places[1]).arrivalKind).toBe("corridor");
    expect(a.features).toEqual(original);
  });
  it("does not infer a route endpoint from an ambiguous label or passing shaft", () => {
    const a = model();
    a.places.push({ ...a.places[0], id: "another-arrival" });
    expect(placeForVenueFeature(a, a.features[0])).toBeUndefined();
    a.features[0].kind = "elevator";
    a.features[0].displayKind = "elevator";
    a.features[0].connectionId = "nonstop-shaft";
    expect(placeForVenueFeature(a, a.features[0])).toBeUndefined();
  });
  it("refreshes a saved room from the current source without changing its identity", () => {
    const a = model();
    const saved = toVenuePlaceDetail(a, a.places[0]);
    a.source.sha256 = "v2";
    a.places[0].name = "Renamed room";
    const refreshed = refreshVenuePlace([a], saved);
    expect(refreshed?.sourceVersion).toBe("v2");
    expect(refreshed?.name).toBe("Renamed room");
    expect(refreshed?.placeId).toBe(saved.placeId);
    expect(saved.sourceVersion).toBe("v1");
  });
  it("does not reinterpret a saved room on another floor or in another building", () => {
    const a = model();
    const saved = toVenuePlaceDetail(a, a.places[0]);
    a.places[0].levelRef = "2F";
    expect(refreshVenuePlace([a], saved)).toBeNull();
    expect(refreshVenuePlace([model("b")], saved)).toBeNull();
    expect(refreshVenuePlace([], saved)).toBeNull();
  });
});

describe("search preview and explicit indoor entry", () => {
  it("keeps a searched classroom on the outside map until an explicit building visit", () => {
    const data = model();
    const place = toVenuePlaceDetail(data, data.places[1]);
    const flyTo = vi.fn();
    useMapStore.setState(useMapStore.getInitialState(), true);
    useMapStore.setState({ map: { flyTo } as unknown as maplibregl.Map });
    useIndoorCatalog.getState().setModels([data]);
    useIndoorCatalog.getState().previewPlace(place);
    expect(useMapStore.getState().indoorExploring).toBe(false);
    expect(useMapStore.getState().is3D).toBe(false);
    expect(flyTo).toHaveBeenCalledWith(
      expect.objectContaining({
        center: [place.position.lng, place.position.lat],
      }),
    );
    useIndoorCatalog.getState().showPlace(place);
    expect(useMapStore.getState().indoorExploring).toBe(true);
    expect(useIndoorCatalog.getState().activeLevel).toBe(1);
    useIndoorCatalog
      .getState()
      .previewPlace(toVenuePlaceDetail(data, data.places[0]));
    expect(useMapStore.getState().indoorExploring).toBe(true);
    expect(useIndoorCatalog.getState().activeLevel).toBe(0);
    useMapStore.getState().setIndoorExploring(false);
    useMapStore.setState(useMapStore.getInitialState(), true);
  });
});
