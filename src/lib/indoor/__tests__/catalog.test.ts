import { describe, expect, it, vi } from "vitest";
import useIndoorCatalog from "@/stores/useIndoorCatalog";
import useMapStore from "@/stores/useMapStore";
import {
  featureForVenuePlace,
  findVenueModel,
  indoorModelVersion,
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
  it("ranks an exact building-floor anchor ahead of its rooms regardless of letter case", () => {
    const data = model();
    data.places.push({
      ...data.places[0],
      id: "anchor",
      kind: "anchor",
      name: "Building a 1F",
      ref: undefined,
    });
    expect(searchVenuePlaces([data], "Building a 1F")[0].placeId).toBe(
      "anchor",
    );
  });
  it("uses published versions and each place's own building when models share the venue directory", () => {
    const a = model("a"),
      b = model("b");
    for (const value of [a, b]) {
      value.api = { version: 3, importedAt: "test", sourceSha256: "same-file" };
      value.source.sha256 = "same-file";
      value.places.forEach((p) => {
        p.id = `${value.building.id}-${p.id}`;
      });
    }
    const places = [...a.places, ...b.places];
    a.places = places;
    b.places = places;
    b.building.aliases = ["West wing"];
    const matches = searchVenuePlaces([a, b], "101");
    expect(matches).toHaveLength(4);
    expect(
      matches.every((p) => p.buildingName === `Building ${p.buildingId}`),
    ).toBe(true);
    expect(
      matches.every(
        (p) =>
          p.dataSource === "api" && p.sourceVersion === "synthetic-campus:3",
      ),
    ).toBe(true);
    expect(
      searchVenuePlaces([a, b], "West wing").map((p) => p.buildingId),
    ).toEqual(["b", "b"]);
    const saved = matches.find((p) => p.buildingId === "b");
    if (!saved) throw new Error("Expected a B-building result");
    b.api = { version: 4, importedAt: "test", sourceSha256: "same-file" };
    expect(indoorModelVersion(b)).toBe("synthetic-campus:4");
    expect(refreshVenuePlace([a, b], saved)?.sourceVersion).toBe(
      "synthetic-campus:4",
    );
    expect(b.source.sha256).toBe("same-file");
  });
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
  it("uses explicit source links despite duplicate room labels", () => {
    const a = model();
    const duplicate = { ...a.features[0], id: "same-label" };
    a.features.push(duplicate);
    a.places[0].featureId = "shape-0";
    a.places.push({ ...a.places[0], id: "second", featureId: "same-label" });
    expect(featureForVenuePlace(a, "room-0")?.id).toBe("shape-0");
    expect(featureForVenuePlace(a, "second")?.id).toBe("same-label");
    expect(placeForVenueFeature(a, a.features[0])?.id).toBe("room-0");
    expect(placeForVenueFeature(a, duplicate)?.id).toBe("second");
  });
  it("does not reinterpret missing or wrong-context feature links by room label", () => {
    const a = model();
    for (const featureId of ["missing", "shape-1", "foreign"]) {
      a.features.push({ ...a.features[0], id: "foreign", buildingId: "b" });
      a.places[0].featureId = featureId;
      expect(featureForVenuePlace(a, "room-0")).toBeUndefined();
      expect(placeForVenueFeature(a, a.features[0])).toBeUndefined();
      a.features.pop();
    }
    a.places[0].buildingId = "b";
    a.places[0].featureId = "shape-0";
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
