import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { indoorFacilityAreas } from "../facilityAreas";
import { area } from "../geometry";
import { samplePath, segmentDistance } from "../route";
import {
  createIndoorContent,
  disposeTree,
  indoorActiveSpanKey,
  indoorRouteSegments,
  rebuildIndoorContent,
  rebuildIndoorRoute,
  updateIndoorLabels,
  updateIndoorMarker,
  v3,
} from "../sceneContent";
import type { IndoorSceneProps } from "../sceneTypes";
import type {
  IndoorRoute,
  IndoorStairDesign,
  LocalIndoorModel,
  XY,
  XYZ,
} from "../types";

// Synthetic spatial fixtures only. DOM labels are minimal test doubles; actual
// Three meshes, clipping planes, geometry, path sampling and routing are used.
const rect = (x: number, y: number): XY[][] => [
  [
    [x, y],
    [x + 2, y],
    [x + 2, y + 2],
    [x, y + 2],
    [x, y],
  ],
];
const points: XYZ[] = [
  [0, 1, 0],
  [1, 1, 0],
  [2, 1, 2],
  [3, 1, 4],
  [5, 1, 4],
  [7, 1, 8],
  [9, 1, 8],
];
const route: IndoorRoute = {
  ok: true,
  fromPlaceId: "room-low",
  toPlaceId: "room-high",
  points,
  kinds: ["corridor", "steps", "steps", "corridor", "steps", "corridor"],
  steps: [
    {
      kind: "corridor",
      name: "Hall",
      fromLevel: "L",
      toLevel: "L",
      startIndex: 0,
      endIndex: 1,
      distanceM: 1,
      heightPending: false,
    },
    {
      kind: "steps",
      name: "Stair",
      fromLevel: "L",
      toLevel: "M",
      connectionId: "stair-low",
      startIndex: 1,
      endIndex: 3,
      distanceM: 5,
      heightPending: false,
    },
    {
      kind: "corridor",
      name: "Hall",
      fromLevel: "M",
      toLevel: "M",
      startIndex: 3,
      endIndex: 4,
      distanceM: 2,
      heightPending: false,
    },
    {
      kind: "steps",
      name: "Stair",
      fromLevel: "M",
      toLevel: "H",
      connectionId: "stair-high",
      startIndex: 4,
      endIndex: 5,
      distanceM: 5,
      heightPending: false,
    },
    {
      kind: "corridor",
      name: "Hall",
      fromLevel: "H",
      toLevel: "H",
      startIndex: 5,
      endIndex: 6,
      distanceM: 2,
      heightPending: false,
    },
  ],
  distanceM: 15,
  animationSafe: true,
  warnings: [],
  edgeIds: [],
};
function design(id: string, lower: number): IndoorStairDesign {
  return {
    schemaVersion: 1,
    id,
    sourceConnectionId: id,
    name: id,
    status: "synthetic",
    sourceSha256: "test",
    sourcePath: [
      [1, 1, lower],
      [3, 1, lower + 4],
    ],
    sourceCore: rect(0, 0),
    dimensions: {
      floorHeightM: 4,
      flightTotalWidthM: 1,
      flightClearWidthM: 0.9,
      risers: [2],
      riserHeightM: 2,
      platformM: [1, 1],
    },
    flights: [],
    platforms: [],
    steps: [
      {
        id: `${id}-step`,
        flightId: "flight",
        index: 0,
        polygon: rect(1, 0),
        elevationM: lower + 2,
        thicknessM: 0.12,
        riserHeightM: 2,
      },
    ],
    animationPath: [
      [1, 1, lower],
      [2, 1, lower + 2],
      [3, 1, lower + 4],
    ],
    animationSegments: [],
    conflicts: [],
    verification: {
      roomToiletOverlapCount: 0,
      shaftOverlapAreaM2: 0,
      outsideCoreAreaM2: 0,
      sourceEndpointsPreserved: true,
      riserSumM: 4,
      platformCount: 0,
      checkLimits: "synthetic",
    },
    assumptions: [],
    sources: [],
  };
}
function model(): LocalIndoorModel {
  const levels = [
    { ordinal: 10, ref: "L", elevationM: 0 },
    { ordinal: 20, ref: "M", elevationM: 4 },
    { ordinal: 30, ref: "H", elevationM: 8 },
  ];
  return {
    schemaVersion: 1,
    venueId: "synthetic",
    name: "Synthetic",
    source: { sha256: "test", generatedAt: "test", warnings: [] },
    origin: [0, 0],
    building: {
      id: "synthetic",
      name: "Building",
      footprint: rect(0, 0),
      levels,
      floorHeightM: 4,
      heightStatus: "estimated",
      geometryStatus: "schematic",
    },
    features: levels.flatMap((level, i) =>
      ["room", "other"].map((kind) => ({
        id:
          kind === "other"
            ? `other-${i}`
            : ["room-low", "room-mid", "room-high"][i],
        kind: "room" as const,
        ordinal: level.ordinal,
        levelRef: level.ref,
        name: `Room ${i}`,
        ref: `R${i}`,
        geometry: {
          type: "Polygon" as const,
          coordinates: rect(i * 4, kind === "other" ? 5 : 0),
        },
        tags: {},
        geometryStatus: "schematic" as const,
        heightStatus: "estimated" as const,
      })),
    ),
    connections: ["stair-low", "stair-high"].map((id, i) => ({
      id,
      kind: "stairs" as const,
      name: "Stair",
      coordinates: design(id, i * 4).sourcePath,
      levelRefs: [levels[i].ref, levels[i + 1].ref],
      wheelchair: "no" as const,
      geometryStatus: "schematic" as const,
      heightStatus: "estimated" as const,
      heightPending: false,
      tags: {},
      osmRef: id,
    })),
    nodes: [],
    edges: [],
    walls: [],
    places: ["room-low", "room-high"].map((id, i) => ({
      id,
      name: id,
      kind: "room",
      nodeId: id,
      point: points[i ? 6 : 0],
      levelRef: i ? "H" : "L",
      routeEndpoint: "door" as const,
      doorKnown: true,
      arrivalOnly: false,
      tags: {},
    })),
    stairDesigns: [design("stair-low", 0), design("stair-high", 4)],
  };
}
function props(overrides: Partial<IndoorSceneProps> = {}): IndoorSceneProps {
  return {
    model: model(),
    visibleLevels: [10],
    view: "perspective",
    selectedId: null,
    onSelect: vi.fn(),
    route,
    progress: 0.25,
    routeDirection: 1,
    exploded: false,
    focusId: null,
    cameraAction: { type: "reset", nonce: 0 },
    showLabels: true,
    ...overrides,
  };
}
function facilityModel() {
  const value = model();
  const core: XY[][] = [
    [
      [20, 0],
      [26, 0],
      [26, 6],
      [20, 6],
      [20, 0],
    ],
  ];
  for (const level of value.building.levels) {
    for (const [id, type, polygon, connectionId] of [
      ["core", "vertical-core", core, "core-lift"],
      ["shaft", "elevator-shaft", rect(30, 0), "shaft-lift"],
      ["stairs", "stairwell", rect(40, 0), "block-stairs"],
    ] as const)
      value.features.push({
        id: `${id}-${level.ref}`,
        kind: "area",
        name: id,
        ordinal: level.ordinal,
        levelRef: level.ref,
        geometry: { type: "Polygon", coordinates: polygon },
        tags: { "a11ymap:area_type": type },
        connectionId,
        displayKind: type === "stairwell" ? "stairs" : "elevator",
        geometryStatus: "schematic",
        heightStatus: "estimated",
      });
  }
  for (const [id, x, kind] of [
    ["core-lift", 23, "elevator"],
    ["shaft-lift", 31, "elevator"],
    ["block-stairs", 41, "stairs"],
  ] as const) {
    value.connections.push({
      id,
      name: id,
      kind,
      coordinates: [
        [x, 3, 0],
        [x, 3, 8],
      ],
      levelRefs: ["L", "H"],
      wheelchair: kind === "elevator" ? "yes" : "no",
      geometryStatus: "schematic",
      heightStatus: "estimated",
      heightPending: false,
      tags: {
        ref: kind === "elevator" ? (id === "core-lift" ? "A" : "2") : "B",
      },
      osmRef: id,
    });
  }
  for (const candidate of value.stairDesigns ?? []) {
    candidate.sourceCore = core;
    candidate.sourceElevatorPoint = [23, 3, 0];
    candidate.shaft = {
      polygon: rect(22, 2),
      innerPolygon: rect(22, 2),
      carPolygon: rect(22, 2),
      baseM: 0,
      heightM: 8,
      door: {
        segment: [
          [22, 2],
          [23, 2],
        ],
        widthM: 1,
        facing: "synthetic",
        status: "synthetic",
      },
    };
  }
  return value;
}
function container() {
  return { appendChild: vi.fn(), dataset: {} } as unknown as HTMLDivElement;
}
beforeEach(() => {
  const element = () => ({
    style: {},
    offsetWidth: 60,
    appendChild: vi.fn(),
    addEventListener: vi.fn(),
    setAttribute: vi.fn(),
    remove: vi.fn(),
  });
  vi.stubGlobal("document", {
    createElement: element,
    createElementNS: element,
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("single-floor scene rendering", () => {
  it("uses source facility blocks, a separate contained research shaft, and the correct floor's span", () => {
    const data = facilityModel();
    const source = JSON.stringify(data);
    const areas = indoorFacilityAreas(data, data.building.levels[1]);
    expect(areas).toHaveLength(4);
    const stairs = areas.find(
      (entry) => entry.sourceFeatureId === "core-M" && entry.kind === "stairs",
    );
    const elevator = areas.find(
      (entry) =>
        entry.sourceFeatureId === "core-M" && entry.kind === "elevator",
    );
    expect(stairs?.selectionId).toBe("stair-high");
    expect(elevator?.selectionId).toBe("core-M");
    const surfaceArea = (polygons: XY[][][]) =>
      polygons.reduce(
        (total, polygon) =>
          total +
          Math.abs(area(polygon[0])) -
          polygon
            .slice(1)
            .reduce((holes, ring) => holes + Math.abs(area(ring)), 0),
        0,
      );
    expect(surfaceArea(stairs?.polygons ?? [])).toBe(32);
    expect(surfaceArea(elevator?.polygons ?? [])).toBe(4);
    expect(stairs?.researchBoundary).toBe(true);
    expect(
      areas.find((entry) => entry.selectionId === "shaft-M")?.servesLevel,
    ).toBe(false);
    expect(
      areas.find((entry) => entry.selectionId === "stairs-M")?.polygons,
    ).toEqual([rect(40, 0)]);
    const top = indoorFacilityAreas(data, data.building.levels[2]);
    expect(
      top.filter((entry) => entry.sourceFeatureId === "core-H"),
    ).toHaveLength(2);
    expect(
      top.find(
        (entry) =>
          entry.kind === "stairs" && entry.sourceFeatureId === "core-H",
      )?.selectionId,
    ).toBe("stair-high");
    expect(JSON.stringify(data)).toBe(source);
  });

  it("does not turn an undivided core or an uncontained/stale research shaft into an elevator footprint", () => {
    const data = facilityModel();
    for (const candidate of data.stairDesigns ?? [])
      candidate.sourceSha256 = "stale";
    const fallback = indoorFacilityAreas(data, data.building.levels[0]).filter(
      (entry) => entry.sourceFeatureId === "core-L",
    );
    expect(fallback).toHaveLength(1);
    expect(fallback[0].kind).toBe("core");
    for (const candidate of data.stairDesigns ?? []) {
      candidate.sourceSha256 = data.source.sha256;
      if (candidate.shaft) candidate.shaft.polygon = rect(25, 5);
    }
    expect(
      indoorFacilityAreas(data, data.building.levels[0])
        .filter((entry) => entry.sourceFeatureId === "core-L")
        .map((entry) => entry.kind),
    ).toEqual(["core"]);
  });

  it.each([
    { rejected: "conflict", storage: "multiple" },
    { rejected: "conflict", storage: "single" },
    { rejected: "stale", storage: "multiple" },
    { rejected: "stale", storage: "single" },
  ])(
    "keeps rejected research geometry out of facility picking and physical meshes: $rejected/$storage",
    ({ rejected, storage }) => {
      const data = facilityModel();
      for (const candidate of data.stairDesigns ?? []) {
        if (rejected === "conflict")
          candidate.conflicts = [{ kind: "room-overlap", areaM2: 1 }];
        else candidate.sourceSha256 = "stale";
      }
      if (storage === "single") {
        data.stairDesign = data.stairDesigns?.[0];
        delete data.stairDesigns;
      }
      const source = JSON.stringify(data);
      const fallback = indoorFacilityAreas(
        data,
        data.building.levels[0],
      ).filter((entry) => entry.sourceFeatureId === "core-L");
      expect(fallback).toHaveLength(1);
      expect(fallback[0]).toMatchObject({
        kind: "core",
        selectionId: "core-L",
        researchBoundary: false,
      });
      expect(fallback[0].polygons).toEqual([
        data.features.find((entry) => entry.id === "core-L")?.geometry
          .coordinates,
      ]);

      const p = props({ model: data, grounded: true });
      const flat = createIndoorContent();
      rebuildIndoorContent(flat, container(), p, p.onSelect);
      flat.content.updateMatrixWorld(true);
      const ray = new THREE.Raycaster(
        v3([23, 3, 3]),
        new THREE.Vector3(0, -1, 0),
      );
      expect(ray.intersectObjects(flat.pickable)[0]?.object.userData.id).toBe(
        "core-L",
      );
      expect(
        flat.pickable.some((mesh) => mesh.userData.id === "stair-low"),
      ).toBe(false);

      // An active transition must not bypass rejection in the physical viewer.
      const physical = createIndoorContent();
      rebuildIndoorContent(
        physical,
        container(),
        { ...p, grounded: false },
        p.onSelect,
      );
      expect(
        physical.content.children.some((child) => child.userData.connectionId),
      ).toBe(false);
      expect(
        physical.content.getObjectByName("candidate-elevator-cabin"),
      ).toBeUndefined();
      expect(
        physical.pickable.some((mesh) => mesh.userData.id === "stair-low"),
      ).toBe(false);
      expect(JSON.stringify(data)).toBe(source);
      disposeTree(flat.content);
      disposeTree(physical.content);
    },
  );

  it("renders flat, selectable source blocks and SVG icons without treads, cabins or elevator discs", () => {
    const p = props({
      model: facilityModel(),
      grounded: true,
      route: null,
      visibleLevels: [20],
      stairPreview: { widthM: 1, risers: [2] },
    });
    const s = createIndoorContent();
    const host = container();
    rebuildIndoorContent(s, host, p, p.onSelect);
    const blocks = s.pickable.filter(
      (mesh) => mesh.name === "indoor-facility-area",
    ) as THREE.Mesh[];
    expect(blocks).toHaveLength(4);
    for (const block of blocks) {
      const bounds = new THREE.Box3().setFromObject(block);
      expect(bounds.min.y).toBeCloseTo(4.024);
      expect(bounds.max.y).toBeCloseTo(4.044);
    }
    expect(
      s.content.getObjectByName("candidate-elevator-cabin"),
    ).toBeUndefined();
    expect(
      s.content.children.some(
        (child) =>
          child instanceof THREE.Mesh &&
          child.geometry instanceof THREE.CylinderGeometry,
      ),
    ).toBe(false);
    s.content.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(
      v3([23, 3, 6]),
      new THREE.Vector3(0, -1, 0),
    );
    expect(ray.intersectObjects(blocks)[0]?.object.userData.id).toBe("core-M");
    ray.set(v3([20.5, 3, 6]), new THREE.Vector3(0, -1, 0));
    expect(ray.intersectObjects(blocks)[0]?.object.userData.id).toBe(
      "stair-high",
    );
    const unavailable = s.labels.find((entry) => entry.id === "shaft-M");
    if (!unavailable) throw new Error("Expected unavailable elevator label");
    expect(unavailable?.caption).toContain("不停靠");
    expect(unavailable?.textElement).toBeDefined();
    expect(vi.mocked(unavailable.element.appendChild)).toHaveBeenCalledTimes(2);
    const click = vi
      .mocked(unavailable.element.addEventListener)
      .mock.calls.find(([kind]) => kind === "click")?.[1] as (event: {
      stopPropagation: () => void;
    }) => void;
    click({ stopPropagation: vi.fn() });
    expect(p.onSelect).toHaveBeenCalledWith("shaft-M");
    updateIndoorLabels(s, { ...p, route });
    expect(
      s.labels
        .filter((entry) => entry.allowed)
        .every((entry) => entry.endpoint),
    ).toBe(true);
    updateIndoorLabels(s, p);
    expect(unavailable.textElement?.textContent).toBe("2");
    expect(unavailable.element.title).toContain("不停靠");
    expect(vi.mocked(unavailable.element.setAttribute)).toHaveBeenCalledWith(
      "aria-label",
      "查看 電梯 2 · 不停靠",
    );
    expect(unavailable.width).toBeLessThan(60);
    expect(vi.mocked(unavailable.element.appendChild)).toHaveBeenCalledTimes(2);
    disposeTree(s.content);
  });

  it.each([
    { grounded: false, direction: 1 as const, ordinal: 10, floor: 0 },
    { grounded: false, direction: -1 as const, ordinal: 30, floor: 8 },
    { grounded: true, direction: 1 as const, ordinal: 10, floor: 0 },
    { grounded: true, direction: -1 as const, ordinal: 30, floor: 8 },
  ])(
    "keeps elevator source height across skipped floors, with a separate grounded display: $grounded/$direction",
    ({ grounded, direction, ordinal, floor }) => {
      const p = props({
        grounded,
        routeDirection: direction,
        visibleLevels: [ordinal],
      });
      const shaft = p.model.stairDesigns?.[0];
      if (!shaft) throw new Error("Expected synthetic candidate");
      shaft.sourceElevatorPoint = [0.5, 0.5, 0];
      shaft.shaft = {
        polygon: rect(0, 0),
        innerPolygon: rect(0, 0),
        carPolygon: rect(0, 0),
        baseM: 0,
        heightM: 8,
        door: {
          segment: [
            [0, 0],
            [1, 0],
          ],
          widthM: 1,
          facing: "synthetic",
          status: "synthetic",
        },
      };
      const upperShaft = p.model.stairDesigns?.[1];
      if (!upperShaft) throw new Error("Expected upper synthetic candidate");
      upperShaft.sourceElevatorPoint = shaft.sourceElevatorPoint;
      upperShaft.shaft = shaft.shaft;
      p.model.connections.push({
        id: "lift",
        name: "Lift",
        kind: "elevator",
        coordinates: [
          [0.5, 0.5, 0],
          [0.5, 0.5, 8],
        ],
        levelRefs: ["L", "H"],
        wheelchair: "yes",
        geometryStatus: "schematic",
        heightStatus: "estimated",
        heightPending: false,
        tags: {},
        osmRef: "lift",
      });
      p.route = {
        ...route,
        points: [
          [0.5, 0.5, 0],
          [0.5, 0.5, 8],
        ],
        kinds: ["elevator"],
        steps: [
          {
            kind: "elevator",
            name: "Lift",
            connectionId: "lift",
            fromLevel: "L",
            toLevel: "H",
            startIndex: 0,
            endIndex: 1,
            distanceM: 8,
            heightPending: false,
          },
        ],
      };
      p.progress = 0.5;
      const sourceModel = JSON.stringify(p.model);
      const sourceRoute = JSON.stringify(p.route);
      const s = createIndoorContent();
      const host = container();
      rebuildIndoorContent(s, host, p, p.onSelect);
      updateIndoorMarker(s, host, p);
      const cabin = s.content.getObjectByName(
        "candidate-elevator-cabin",
      ) as THREE.Mesh;
      const displayHeight = grounded ? floor : 4;
      if (grounded) expect(cabin).toBeUndefined();
      else expect(cabin.position.y).toBe(displayHeight);
      expect(s.marker.position.toArray()).toEqual([0.5, displayHeight, -0.5]);
      expect(host.dataset.markerPosition).toBe(JSON.stringify([0.5, 0.5, 4]));
      expect(host.dataset.displayMarkerPosition).toBe(
        JSON.stringify([0.5, 0.5, displayHeight]),
      );
      if (!grounded) {
        expect(host.dataset.cabinHeight).toBe("4");
        expect(host.dataset.displayCabinHeight).toBe(String(displayHeight));
      }
      expect(s.marker.visible).toBe(true);
      if (!grounded) {
        const material = cabin.material as THREE.Material;
        expect(
          material.clippingPlanes?.every(
            (plane) => plane.distanceToPoint(v3([0.5, 0.5, 4])) >= 0,
          ),
        ).toBe(true);
      }
      expect(indoorRouteSegments(p)).toEqual([
        [
          [0.5, 0.5, grounded ? floor : 0],
          [0.5, 0.5, grounded ? floor : 8],
        ],
      ]);
      expect([...s.featureMeshes.keys()]).toEqual(
        direction === 1 ? ["room-low", "other-0"] : ["room-high", "other-2"],
      );
      expect(JSON.stringify(p.model)).toBe(sourceModel);
      expect(JSON.stringify(p.route)).toBe(sourceRoute);
      disposeTree(s.content);
    },
  );

  it.each([
    { direction: 1 as const, ordinal: 10, floor: 0 },
    { direction: -1 as const, ordinal: 20, floor: 4 },
  ])(
    "projects stair guidance onto the displayed floor without changing upward/downward source progress: $direction",
    ({ direction, ordinal, floor }) => {
      const p = props({
        grounded: true,
        routeDirection: direction,
        visibleLevels: [ordinal],
      });
      const source = JSON.stringify(p.route);
      const point = samplePath(points, p.progress);
      const s = createIndoorContent();
      const host = container();
      rebuildIndoorRoute(s, p);
      updateIndoorMarker(s, host, p);
      expect(s.marker.visible).toBe(true);
      expect(s.marker.position.toArray()).toEqual(
        v3([point[0], point[1], floor]).toArray(),
      );
      expect(host.dataset.markerPosition).toBe(JSON.stringify(point));
      expect(host.dataset.displayMarkerPosition).toBe(
        JSON.stringify([point[0], point[1], floor]),
      );
      expect(
        indoorRouteSegments(p)
          .flat()
          .every((entry) => entry[2] === floor),
      ).toBe(true);
      for (const object of [...s.routeGroup.children, ...s.marker.children]) {
        const material = (object as THREE.Mesh).material as THREE.Material;
        expect(material.depthTest).toBe(false);
        expect(material.depthWrite).toBe(false);
        expect(object.renderOrder).toBeGreaterThan(0);
      }
      // Guidance has the existing 9 cm visual clearance above the floor plane.
      for (const tube of s.routeGroup.children)
        expect(tube.position.y).toBeCloseTo(floor + 0.09);
      expect(JSON.stringify(p.route)).toBe(source);
      updateIndoorMarker(s, host, { ...p, grounded: false });
      expect(s.marker.position.toArray()).toEqual(v3(point).toArray());
      expect(
        ((s.marker.children[0] as THREE.Mesh).material as THREE.Material)
          .depthTest,
      ).toBe(true);
      disposeTree(s.routeGroup);
      disposeTree(s.marker);
    },
  );

  it.each([
    { direction: 1 as const, ordinal: 10, floor: 0 },
    { direction: -1 as const, ordinal: 20, floor: 4 },
  ])(
    "omits physical stair candidates from the grounded map, including active transitions: $direction",
    ({ direction, ordinal }) => {
      const p = props({
        grounded: true,
        routeDirection: direction,
        visibleLevels: [ordinal],
      });
      const source = JSON.stringify(p.model);
      const s = createIndoorContent();
      rebuildIndoorContent(s, container(), p, p.onSelect);
      const meshes = s.pickable.filter(
        (mesh) => mesh.userData.id === "stair-low",
      ) as THREE.Mesh[];
      expect(meshes).toHaveLength(0);
      expect(
        s.content.children.some((child) => child.userData.connectionId),
      ).toBe(false);
      expect(JSON.stringify(p.model)).toBe(source);
      disposeTree(s.content);
    },
  );

  it("retains only the selected floor's own room geometry even if a caller provides two floors", () => {
    const p = props({ visibleLevels: [20, 30], route: null });
    const source = JSON.stringify(p.model);
    const s = createIndoorContent();
    rebuildIndoorContent(s, container(), p, p.onSelect);
    expect([...s.featureMeshes.keys()]).toEqual(["room-mid", "other-1"]);
    expect(JSON.stringify(p.model)).toBe(source);
    const room = s.featureMeshes.get("room-mid")?.[0];
    expect(room).toBeDefined();
    if (!room) throw new Error("Expected selected-floor room mesh");
    const bounds = new THREE.Box3().setFromObject(room);
    expect(bounds.min.x).toBe(4);
    expect(bounds.min.y).toBeCloseTo(4.004);
    disposeTree(s.content);
  });

  it("renders the complete lower span when descending from a middle floor, clipping unrelated spans and their shadows", () => {
    const p = props({ visibleLevels: [20], routeDirection: -1 });
    const s = createIndoorContent();
    rebuildIndoorContent(s, container(), p, p.onSelect);
    const lower = s.pickable.find(
      (mesh) => mesh.userData.id === "stair-low",
    ) as THREE.Mesh;
    const upper = s.pickable.find(
      (mesh) => mesh.userData.id === "stair-high",
    ) as THREE.Mesh;
    expect(lower).toBeDefined();
    const lowerMaterial = lower.material as THREE.Material;
    const upperMaterial = upper.material as THREE.Material;
    expect(
      lowerMaterial.clippingPlanes?.every(
        (plane) => plane.distanceToPoint(v3([2, 1, 2])) >= 0,
      ),
    ).toBe(true);
    expect(
      upperMaterial.clippingPlanes?.some(
        (plane) => plane.distanceToPoint(v3([2, 1, 6])) < 0,
      ),
    ).toBe(true);
    expect(upperMaterial.clipShadows).toBe(true);
    expect([...s.featureMeshes.keys()]).toEqual(["room-mid", "other-1"]);
    disposeTree(s.content);
  });

  it("keeps the marker visible halfway between floors without moving or rebuilding a mesh, including reversal", () => {
    const p = props();
    const s = createIndoorContent();
    const host = container();
    rebuildIndoorContent(s, host, p, p.onSelect);
    const identities = s.content.children.map((child) => child.uuid);
    updateIndoorMarker(s, host, p);
    expect(s.marker.visible).toBe(true);
    expect(s.marker.position.toArray()).toEqual(
      v3(samplePath(points, p.progress)).toArray(),
    );
    const before = s.marker.position.clone();
    updateIndoorMarker(s, host, {
      ...p,
      routeDirection: -1,
      visibleLevels: [20],
    });
    expect(s.marker.visible).toBe(true);
    expect(s.marker.position.equals(before)).toBe(true);
    expect(s.content.children.map((child) => child.uuid)).toEqual(identities);
    expect(indoorActiveSpanKey(p)).toBe(
      indoorActiveSpanKey({ ...p, progress: 0.3 }),
    );
    disposeTree(s.content);
  });

  it("shows current-floor walking and only the active vertical route, in either direction", () => {
    const p = props();
    expect(indoorRouteSegments(p)).toEqual([
      [points[0], points[1]],
      [points[1], points[2]],
      [points[2], points[3]],
    ]);
    expect(
      indoorRouteSegments({ ...p, routeDirection: -1, visibleLevels: [20] }),
    ).toEqual([
      [points[1], points[2]],
      [points[2], points[3]],
      [points[3], points[4]],
    ]);
    expect(indoorRouteSegments({ ...p, visibleLevels: [30] })).toEqual([
      [points[5], points[6]],
    ]);
    const s = createIndoorContent();
    rebuildIndoorRoute(s, p);
    expect(s.routeGroup.children).toHaveLength(3);
    disposeTree(s.routeGroup);
  });

  it("changes display floor at the exact landing while preserving absolute position", () => {
    const total = points
      .slice(1)
      .reduce((sum, point, i) => sum + segmentDistance(points[i], point), 0);
    const landing =
      points
        .slice(1, 4)
        .reduce((sum, point, i) => sum + segmentDistance(points[i], point), 0) /
      total;
    const s = createIndoorContent();
    const p = props({ progress: landing, visibleLevels: [20] });
    updateIndoorMarker(s, container(), p);
    expect(s.marker.position.toArray()).toEqual(v3(points[3]).toArray());
    expect(s.marker.visible).toBe(true);
    expect(indoorActiveSpanKey(p)).toBe("");
    expect(indoorRouteSegments(p)).toEqual([[points[3], points[4]]]);
  });

  it("keeps only endpoint room names during a route without losing other rooms' pickability or focus targets", () => {
    const p = props();
    const s = createIndoorContent();
    rebuildIndoorContent(s, container(), p, p.onSelect);
    expect(
      s.labels.filter((label) => label.allowed).map((label) => label.id),
    ).toEqual(["room-low"]);
    expect(
      s.labels.find((label) => label.id === "room-low")?.element.textContent,
    ).toBe("R0 · Room 0");
    expect(s.pickable.some((mesh) => mesh.userData.id === "other-0")).toBe(
      true,
    );
    expect(s.targets.has("other-0")).toBe(true);
    const before = s.content.children.map((child) => child.uuid);
    updateIndoorLabels(s, { ...p, route: null });
    expect(s.labels.every((label) => label.allowed)).toBe(true);
    expect(s.content.children.map((child) => child.uuid)).toEqual(before);
    disposeTree(s.content);
  });
});
