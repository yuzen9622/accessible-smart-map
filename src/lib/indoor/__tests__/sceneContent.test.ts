import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { A11Y_FEATURE_COLOR } from "@/types/route";
import { indoorFacilityAreas } from "../facilityAreas";
import { area } from "../geometry";
import { getIndoorPalette } from "../indoorTheme";
import { samplePath, segmentDistance } from "../route";
import {
  createIndoorContent,
  disposeTree,
  indoorActiveSpanKey,
  indoorRouteDisplaySegments,
  indoorRouteSegments,
  rebuildIndoorContent,
  rebuildIndoorRoute,
  rebuildIndoorRouteSegments,
  updateCampusTourMarker,
  updateIndoorLabels,
  updateIndoorMarker,
  updateIndoorOverlayScale,
  updateIndoorRouteFlow,
  updateIndoorTheme,
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
  it("colors only the source-confirmed accessible ramp tube and arrows green in both themes and travel directions", () => {
    const value = model();
    const rampPoints: XYZ[] = [
      [0, 1, 0],
      [2, 1, 0],
      [5, 1, 0.5],
      [7, 1, 0.5],
    ];
    value.connections.push({
      ...value.connections[0],
      id: "accessible-ramp",
      kind: "ramp",
      wheelchair: "yes",
      coordinates: rampPoints.slice(1, 3),
      levelRefs: ["L", "L"],
    });
    const rampRoute: IndoorRoute = {
      ...route,
      points: rampPoints,
      kinds: ["corridor", "ramp", "corridor"],
      steps: [
        { ...route.steps[0], startIndex: 0, endIndex: 1 },
        {
          ...route.steps[0],
          kind: "ramp",
          connectionId: "accessible-ramp",
          startIndex: 1,
          endIndex: 2,
        },
        { ...route.steps[0], startIndex: 2, endIndex: 3 },
      ],
    };
    const source = JSON.stringify(rampRoute);
    const p = props({
      model: value,
      route: rampRoute,
      grounded: true,
      routeTour: true,
    });
    const s = createIndoorContent();
    rebuildIndoorRoute(s, p);
    const tubes = s.routeGroup.children.filter(
      (child) => child.userData.routeTube,
    );
    expect(tubes).toHaveLength(3);
    for (const theme of ["light", "dark"] as const)
      for (const routeDirection of [1, -1] as const) {
        updateIndoorTheme(s, { ...p, theme });
        updateIndoorRouteFlow(s, { ...p, routeDirection }, 1.25);
        const ramps = s.routeGroup.children.filter((child) => {
          const material = (child as THREE.Mesh)
            .material as THREE.MeshBasicMaterial;
          return material.userData.indoorColorRole === "accessibleRamp";
        });
        expect(ramps.length).toBeGreaterThan(1);
        for (const child of ramps)
          expect(
            (
              (child as THREE.Mesh).material as THREE.MeshBasicMaterial
            ).color.getHexString(),
          ).toBe(A11Y_FEATURE_COLOR.ramp.slice(1));
        for (const child of [tubes[0], tubes[2]])
          expect(
            (
              (child as THREE.Mesh).material as THREE.MeshBasicMaterial
            ).color.getHex(),
          ).toBe(getIndoorPalette(theme).material.primary);
      }
    expect(JSON.stringify(rampRoute)).toBe(source);
    disposeTree(s.routeGroup);
    disposeTree(s.marker);
  });

  it("renders floor coverage only as a neutral slab below known rooms, without selection or outlines", () => {
    const value = model();
    value.features = [
      value.features[0],
      {
        ...value.features[0],
        id: "display-floor",
        kind: "area",
        name: "Display coverage",
        ref: "not-a-room",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [8, 0],
              [8, 4],
              [0, 4],
              [0, 0],
            ],
          ],
        },
        tags: { "a11ymap:area_type": "indoor-floor-base" },
      },
    ];
    value.connections = [];
    value.stairDesigns = [];
    const source = JSON.stringify(value);
    for (const grounded of [true, false]) {
      const p = props({ model: value, route: null, grounded });
      const s = createIndoorContent();
      rebuildIndoorContent(s, container(), p, p.onSelect);
      s.content.updateMatrixWorld(true);
      const ray = new THREE.Raycaster(
        v3([6, 2, 10]),
        new THREE.Vector3(0, -1, 0),
      );
      const hits = ray
        .intersectObjects(s.content.children, true)
        .filter((hit) => hit.object instanceof THREE.Mesh);
      expect(hits.length).toBeGreaterThan(0);
      const floor = hits[0].object as THREE.Mesh<
        THREE.BufferGeometry,
        THREE.MeshStandardMaterial
      >;
      expect(floor.material.userData.indoorColorRole).toBe("slab");
      expect(hits[0].point.y).toBeCloseTo(0);
      expect(ray.intersectObjects(s.pickable)).toEqual([]);
      expect(s.featureMeshes.has("display-floor")).toBe(false);
      expect(s.targets.has("display-floor")).toBe(false);
      expect(s.labels.map((label) => label.id)).toEqual(["room-low"]);
      // Only the established building outline remains, with no floor-base edge.
      expect(
        s.content.children.filter((child) => child instanceof THREE.Line),
      ).toHaveLength(1);
      const room = s.featureMeshes.get("room-low")?.[0];
      expect(room).toBeDefined();
      room?.geometry.computeBoundingBox();
      expect(room?.geometry.boundingBox?.min.y).toBeGreaterThan(
        hits[0].point.y,
      );
      expect(p.onSelect).not.toHaveBeenCalled();
      disposeTree(s.content);
      disposeTree(s.marker);
    }
    expect(JSON.stringify(value)).toBe(source);
  });

  it("keeps source space boundaries subtle and solid on the product map while retaining diagnostic dashes and picking", () => {
    const value = model();
    value.features.push(
      {
        ...value.features[0],
        id: "pending-void",
        kind: "area",
        geometry: { type: "Polygon", coordinates: rect(12, 0) },
        tags: { "a11ymap:area_type": "void", fixme: "位置待確認" },
      },
      {
        ...value.features[0],
        id: "unclassified-area",
        kind: "area",
        geometry: { type: "Polygon", coordinates: rect(16, 0) },
      },
    );
    const source = JSON.stringify(value);
    for (const grounded of [true, false]) {
      const p = props({ model: value, route: null, grounded });
      const s = createIndoorContent();
      rebuildIndoorContent(s, container(), p, p.onSelect);
      const boundaries = s.content.children.filter(
        (child) =>
          child instanceof THREE.Line &&
          child.geometry.getAttribute("position").getX(0) >= 12,
      ) as THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>[];
      expect(boundaries).toHaveLength(2);
      for (const boundary of boundaries) {
        expect(boundary.material instanceof THREE.LineDashedMaterial).toBe(
          !grounded,
        );
        if (grounded) {
          expect(boundary.material.transparent).toBe(true);
          expect(boundary.material.opacity).toBeLessThan(0.65);
        }
      }
      expect(
        s.pickable.some((child) => child.userData.id === "pending-void"),
      ).toBe(true);
      expect(
        s.labels.find((label) => label.id === "pending-void")?.status,
      ).toBe(true);
      disposeTree(s.content);
      disposeTree(s.marker);
    }
    expect(JSON.stringify(value)).toBe(source);
  });

  it("retains ramp source indices through height clipping and floor projection without changing the route", () => {
    const value = model();
    const sourcePoints: XYZ[] = [
      [0, 0, 0],
      [1, 0, 0],
      [5, 0, 2],
      [6, 0, 2],
    ];
    const sourceRoute: IndoorRoute = {
      ...route,
      points: sourcePoints,
      context: {
        buildingIds: sourcePoints.map(() => value.building.id),
        levelRefs: sourcePoints.map(() => "L"),
      },
      kinds: ["corridor", "ramp", "corridor"],
      steps: [
        { ...route.steps[0], startIndex: 0, endIndex: 1 },
        {
          ...route.steps[0],
          kind: "ramp",
          connectionId: "clipped-ramp",
          startIndex: 1,
          endIndex: 2,
        },
        { ...route.steps[0], startIndex: 2, endIndex: 3 },
      ],
    };
    value.connections.push({
      ...value.connections[0],
      id: "clipped-ramp",
      kind: "ramp",
      wheelchair: "yes",
      coordinates: sourcePoints.slice(1, 3),
      levelRefs: ["L", "L"],
    });
    const snapshot = JSON.stringify({ sourceRoute, value });
    for (const grounded of [false, true]) {
      const p = props({
        model: value,
        route: sourceRoute,
        grounded,
        routeTour: true,
      });
      const segments = indoorRouteDisplaySegments(p);
      expect(segments).toHaveLength(2);
      expect(segments[1]).toMatchObject({
        pathStart: 1,
        pathEnd: 2,
        kind: "ramp",
        connectionId: "clipped-ramp",
        accessibleRamp: true,
      });
      const [from, to] = segments[1].coordinates;
      expect(from).toEqual(sourcePoints[1]);
      expect(to[0]).toBeLessThan(sourcePoints[2][0]);
      expect(to[2]).toBeCloseTo(grounded ? 0 : 0.85);
      const s = createIndoorContent();
      rebuildIndoorRouteSegments(s, p, segments);
      const tube = s.routeGroup.children.find(
        (child) => child.userData.routeSegment?.pathStart === 1,
      );
      expect(tube?.userData.routeSegment).toMatchObject({
        pathStart: 1,
        pathEnd: 2,
        accessibleRamp: true,
      });
      expect(
        (
          (tube as THREE.Mesh).material as THREE.MeshBasicMaterial
        ).color.getHexString(),
      ).toBe(A11Y_FEATURE_COLOR.ramp.slice(1));
      disposeTree(s.routeGroup);
      disposeTree(s.marker);
    }
    expect(JSON.stringify({ sourceRoute, value })).toBe(snapshot);
  });

  it("does not project an authored cross-floor ramp onto either endpoint floor", () => {
    const value = model();
    const sourcePoints: XYZ[] = [
      [0, 0, 0],
      [1, 0, 0],
      [3, 0, 2],
      [5, 0, 4],
      [6, 0, 4],
    ];
    const sourceRoute: IndoorRoute = {
      ...route,
      points: sourcePoints,
      context: {
        buildingIds: sourcePoints.map(() => value.building.id),
        levelRefs: ["L", "L", null, "M", "M"],
      },
      kinds: ["corridor", "ramp", "ramp", "corridor"],
      steps: [
        { ...route.steps[0], startIndex: 0, endIndex: 1 },
        {
          ...route.steps[0],
          kind: "ramp",
          connectionId: "floor-ramp",
          toLevel: "M",
          startIndex: 1,
          endIndex: 3,
        },
        {
          ...route.steps[0],
          fromLevel: "M",
          toLevel: "M",
          startIndex: 3,
          endIndex: 4,
        },
      ],
    };
    value.connections.push({
      ...value.connections[0],
      id: "floor-ramp",
      kind: "ramp",
      wheelchair: "yes",
      coordinates: sourcePoints.slice(1, 4),
      levelRefs: ["L", null, "M"],
    });
    const snapshot = JSON.stringify(sourceRoute);
    for (const ordinal of [10, 20] as const)
      for (const routeDirection of [1, -1] as const) {
        const segments = indoorRouteDisplaySegments(
          props({
            model: value,
            route: sourceRoute,
            grounded: true,
            routeTour: true,
            visibleLevels: [ordinal],
            routeDirection,
          }),
        );
        expect(segments.filter((segment) => segment.accessibleRamp)).toEqual(
          [],
        );
      }
    expect(JSON.stringify(sourceRoute)).toBe(snapshot);
  });

  it("keeps pending source ramp topology as a subtle solid line on the product map and dashed in diagnostics", () => {
    const value = model();
    value.connections.push({
      ...value.connections[0],
      id: "pending-source-ramp",
      kind: "ramp",
      wheelchair: "unknown",
      coordinates: [
        [12, 0, 0],
        [18, 0, 0.3],
      ],
      levelRefs: ["L", "L"],
      heightPending: true,
    });
    const snapshot = JSON.stringify(value);
    for (const grounded of [true, false]) {
      const p = props({ model: value, grounded, route: null });
      const s = createIndoorContent();
      rebuildIndoorContent(s, container(), p, p.onSelect);
      const line = s.content.children.find(
        (child) =>
          child instanceof THREE.Line &&
          child.geometry.getAttribute("position").getX(0) === 12,
      ) as THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
      expect(line).toBeDefined();
      expect(line.material instanceof THREE.LineDashedMaterial).toBe(!grounded);
      if (grounded) {
        expect(line.material.userData.indoorColorRole).toBe("spaceBoundary");
        expect(line.material.opacity).toBeLessThan(0.65);
        expect(
          s.content.children.some(
            (child) =>
              child instanceof THREE.Line &&
              child.material instanceof THREE.LineDashedMaterial,
          ),
        ).toBe(false);
      }
      expect(
        s.labels.find((label) => label.id === "pending-source-ramp"),
      ).toMatchObject({
        status: true,
        caption: expect.stringContaining("高差待確認"),
      });
      disposeTree(s.content);
      disposeTree(s.marker);
    }
    expect(JSON.stringify(value)).toBe(snapshot);
  });

  it("keeps product cursors hidden while direction arrows move and source coordinates stay unchanged", () => {
    const p = props({ grounded: true, routeTour: true, routePlaying: true });
    const s = createIndoorContent(),
      host = container();
    const source = JSON.stringify(p.route);
    rebuildIndoorRouteSegments(s, p, [
      [
        [0, 0, 0],
        [6, 0, 0],
      ],
    ]);
    const arrow = s.routeGroup.children.find(
      (object) => object.userData.routeFlow,
    );
    if (!arrow) throw new Error("Expected route direction arrow");
    updateIndoorRouteFlow(s, p, 0);
    const before = arrow.position.clone();
    updateIndoorRouteFlow(s, p, 1);
    expect(arrow.position.equals(before)).toBe(false);
    for (const routeTour of [true, false])
      for (const routePlaying of [true, false]) {
        updateIndoorMarker(s, host, { ...p, routeTour, routePlaying });
        expect(s.marker.visible).toBe(false);
        expect(JSON.parse(host.dataset.markerPosition ?? "null")).toEqual(
          samplePath(points, p.progress),
        );
        expect(
          JSON.parse(host.dataset.displayMarkerPosition ?? "null")[2],
        ).toBe(0);
      }
    const campus = {
      ...p,
      progress: 0.99,
      campusRouteSegments: [[points[5], points[6]]] as [XYZ, XYZ][],
    };
    updateCampusTourMarker(s, host, campus);
    expect(s.marker.visible).toBe(false);
    expect(JSON.parse(host.dataset.campusMarkerPosition ?? "null")).toEqual(
      samplePath(points, campus.progress),
    );
    expect(s.marker.position.y).toBe(0);
    expect(JSON.stringify(p.route)).toBe(source);
    expect(p.progress).toBe(0.25);
    updateIndoorMarker(s, host, { ...p, grounded: false });
    expect(s.marker.visible).toBe(true);
    disposeTree(s.routeGroup);
    disposeTree(s.marker);
  });

  it("keeps route thickness visible at campus scale without moving segment endpoints or rebuilding buffers", () => {
    const p = props({ grounded: true, routeTour: true });
    const s = createIndoorContent();
    const segments: [XYZ, XYZ][] = [
      [
        [0, 0, 0],
        [30, 0, 0],
      ],
      [
        [30, 0, 0],
        [30, 0.2, 0],
      ],
    ];
    rebuildIndoorRouteSegments(s, p, segments);
    const snapshots = s.routeGroup.children.map((child) => ({
      object: child,
      geometry: (child as THREE.Mesh).geometry,
    }));
    const camera = new THREE.PerspectiveCamera(40, 1440 / 900, 0.1, 5000);
    camera.position.set(0, 260, 280);
    camera.lookAt(15, 0, 0);
    camera.updateMatrixWorld();
    const pixel = (point: THREE.Vector3) => {
      const projected = point.clone().project(camera);
      return new THREE.Vector2(
        (projected.x + 1) * 720,
        (1 - projected.y) * 450,
      );
    };
    updateIndoorOverlayScale(s, camera, 1440, 900);
    updateIndoorRouteFlow(s, p, 1.2);
    for (const object of s.routeGroup.children) {
      const tube = object.userData.routeTube;
      if (tube) {
        expect(object.scale.y).toBe(1);
        object.updateMatrix();
        const length = tube.from.distanceTo(tube.to);
        const actualStart = new THREE.Vector3(0, -length / 2, 0).applyMatrix4(
          object.matrix,
        );
        const actualEnd = new THREE.Vector3(0, length / 2, 0).applyMatrix4(
          object.matrix,
        );
        expect(actualStart.distanceTo(tube.from)).toBeLessThan(1e-8);
        expect(actualEnd.distanceTo(tube.to)).toBeLessThan(1e-8);
        const side = new THREE.Vector3(
          -(tube.to.z - tube.from.z),
          0,
          tube.to.x - tube.from.x,
        ).normalize();
        const half = 0.07 * object.scale.x;
        expect(
          pixel(object.position.clone().addScaledVector(side, half)).distanceTo(
            pixel(object.position.clone().addScaledVector(side, -half)),
          ),
        ).toBeGreaterThan(3.95);
      }
      const flow = object.userData.routeFlow;
      if (flow) {
        expect(object.scale.z * 0.48).toBeLessThanOrEqual(
          flow.length * 0.8 + 1e-10,
        );
        expect(
          new THREE.Line3(flow.from, flow.to)
            .closestPointToPoint(object.position, true, new THREE.Vector3())
            .distanceTo(object.position),
        ).toBeCloseTo(0.04);
      }
    }
    expect(s.marker.children[0].scale.x).toBeGreaterThan(1);
    for (const snapshot of snapshots)
      expect((snapshot.object as THREE.Mesh).geometry).toBe(snapshot.geometry);
    expect(s.marker.position.toArray()).toEqual([0, 0, 0]);
    disposeTree(s.routeGroup);
    disposeTree(s.marker);
  });

  it("retains planar tour position metadata without showing a cursor or claiming physical safety", () => {
    const unsafe = { ...route, animationSafe: false };
    const source = JSON.stringify(unsafe);
    const p = props({ route: unsafe, grounded: true, visibleLevels: [20] });
    const s = createIndoorContent(),
      host = container();
    updateIndoorMarker(s, host, p);
    expect(s.marker.visible).toBe(false);
    updateIndoorMarker(s, host, { ...p, routeTour: true });
    expect(s.marker.visible).toBe(false);
    expect(s.marker.position.y).toBe(4);
    expect(JSON.parse(host.dataset.markerPosition ?? "null")).toEqual(
      samplePath(unsafe.points, p.progress),
    );
    updateIndoorMarker(s, host, { ...p, grounded: false, routeTour: true });
    expect(s.marker.visible).toBe(false);
    expect(JSON.stringify(unsafe)).toBe(source);
    disposeTree(s.marker);
  });

  it("flows through connected corners without bridging disconnected route paths", () => {
    const p = props({ grounded: true, routeTour: true, routePlaying: true });
    const segments: [XYZ, XYZ][] = [
      [
        [0, 0, 4],
        [6, 0, 4],
      ],
      [
        [6, 0, 4],
        [6, 6, 4],
      ],
      [
        [20, 20, 4],
        [23, 20, 4],
      ],
    ];
    const source = JSON.stringify(segments);
    const s = createIndoorContent();
    rebuildIndoorRouteSegments(s, p, segments);
    const identities = s.routeGroup.children.map((child) => child.uuid);
    const arrows = s.routeGroup.children.filter(
      (child) => child.name === "indoor-route-direction",
    );
    expect(arrows.length).toBeGreaterThan(0);
    const flowChains = new Set(
      arrows.map((arrow) => arrow.userData.routeFlow.sections),
    );
    expect(flowChains.size).toBe(2);
    expect(
      arrows.some((arrow) => arrow.userData.routeFlow.sections.length === 2),
    ).toBe(true);
    expect(
      s.routeGroup.children.filter((child) => child.userData.routeJoint),
    ).toHaveLength(1);
    for (const direction of [1, -1] as const)
      for (const seconds of [0, 1.3, 30]) {
        updateIndoorRouteFlow(s, { ...p, routeDirection: direction }, seconds);
        for (const arrow of arrows) {
          const { from, to } = arrow.userData.routeFlow as {
            from: THREE.Vector3;
            to: THREE.Vector3;
          };
          expect(
            new THREE.Line3(from, to)
              .closestPointToPoint(arrow.position, true, new THREE.Vector3())
              .distanceTo(arrow.position),
          ).toBeCloseTo(0.04);
          const displayedDirection = new THREE.Vector3(0, 0, 1).applyEuler(
            arrow.rotation,
          );
          expect(
            displayedDirection.dot(to.clone().sub(from).normalize()) *
              direction,
          ).toBeCloseTo(1);
        }
      }
    for (const object of s.routeGroup.children) {
      const material = (object as THREE.Mesh).material as THREE.Material;
      expect(material.depthTest).toBe(false);
      expect(material.depthWrite).toBe(false);
    }
    expect(s.routeGroup.children.map((child) => child.uuid)).toEqual(
      identities,
    );
    expect(JSON.stringify(segments)).toBe(source);
    disposeTree(s.routeGroup);
  });

  it("records campus tour position only on an authored link while keeping its cursor hidden", () => {
    const p = props({
      routeTour: true,
      progress: 0.99,
      campusRouteSegments: [[points[5], points[6]]],
    });
    const source = JSON.stringify(p.route);
    const s = createIndoorContent(),
      host = container();
    updateCampusTourMarker(s, host, p);
    expect(s.marker.visible).toBe(false);
    expect(s.marker.position.y).toBe(0);
    expect(JSON.parse(host.dataset.campusMarkerPosition ?? "null")[2]).toBe(8);
    updateCampusTourMarker(s, host, {
      ...p,
      campusRouteSegments: [[points[0], points[1]]],
    });
    expect(s.marker.visible).toBe(false);
    updateCampusTourMarker(s, host, { ...p, routeTour: false });
    expect(s.marker.visible).toBe(false);
    expect(JSON.stringify(p.route)).toBe(source);
    disposeTree(s.marker);
  });

  it("changes theme in place without replacing geometry, selection targets or route progress", () => {
    const p = props({
      model: facilityModel(),
      grounded: true,
      visibleLevels: [20],
      selectedId: "stairs-M",
    });
    const source = JSON.stringify({ model: p.model, route: p.route });
    const s = createIndoorContent(),
      host = container();
    rebuildIndoorContent(s, host, p, p.onSelect);
    rebuildIndoorRoute(s, p);
    updateIndoorMarker(s, host, p);
    const geometries: {
      object: THREE.Object3D;
      geometry: THREE.BufferGeometry;
      positions: number[];
      matrix: number[];
    }[] = [];
    for (const group of [s.content, s.routeGroup, s.marker])
      group.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.geometry) return;
        object.updateMatrix();
        geometries.push({
          object,
          geometry: mesh.geometry,
          positions: Array.from(mesh.geometry.getAttribute("position").array),
          matrix: object.matrix.toArray(),
        });
      });
    const labels = s.labels.map((entry) => entry.element);
    const targets = [...s.targets.entries()];
    const markerPosition = s.marker.position.toArray();
    const markerSource = host.dataset.markerPosition;
    const markerDisplay = host.dataset.displayMarkerPosition;
    const selected = s.featureMeshes.get("stairs-M")?.[0];
    if (!selected) throw new Error("Expected selected facility");
    const material = (object: THREE.Object3D) =>
      (object as THREE.Mesh).material as THREE.MeshStandardMaterial;

    const dark = getIndoorPalette("dark");
    updateIndoorTheme(s, { ...p, theme: "dark" });
    expect(material(selected).color.getHex()).toBe(dark.selection);
    expect(selected.userData.originalColor).toBe(dark.material.stairs);
    expect(material(s.routeGroup.children[0]).color.getHex()).toBe(
      dark.material.primary,
    );
    expect(material(s.marker.children[0]).color.getHex()).toBe(
      dark.material.marker,
    );
    expect(
      s.labels.find((entry) => entry.id === "stairs-M")?.element.style,
    ).toMatchObject({
      background: dark.labelSelectedBackground,
      color: dark.labelSelectedInk,
      borderColor: dark.labelSelectedBorder,
    });
    expect(
      s.labels.find((entry) => entry.id === "stairs-M")?.iconElement?.style
        .background,
    ).toBe(dark.iconSelectedBackground);
    expect(
      s.labels.find((entry) => entry.id === "shaft-M")?.iconElement?.style
        .background,
    ).toBe(dark.iconMutedBackground);
    expect(
      s.labels.find((entry) => entry.id === "room-mid")?.element.style,
    ).toMatchObject({
      background: dark.labelBackground,
      color: dark.labelInk,
      borderColor: dark.labelBorder,
      boxShadow: dark.labelShadow,
    });

    // Deselection restores the current theme, not the original light colour.
    updateIndoorTheme(s, { ...p, theme: "dark", selectedId: null });
    expect(material(selected).color.getHex()).toBe(dark.material.stairs);
    updateIndoorTheme(s, p);
    expect(material(selected).color.getHex()).toBe(
      getIndoorPalette().selection,
    );
    expect(material(s.marker.children[0]).color.getHex()).toBe(
      getIndoorPalette().material.marker,
    );
    for (const entry of geometries) {
      const mesh = entry.object as THREE.Mesh;
      expect(mesh.geometry).toBe(entry.geometry);
      expect(Array.from(mesh.geometry.getAttribute("position").array)).toEqual(
        entry.positions,
      );
      expect(entry.object.matrix.toArray()).toEqual(entry.matrix);
    }
    expect(s.featureMeshes.get("stairs-M")?.[0]).toBe(selected);
    expect(s.labels.map((entry) => entry.element)).toEqual(labels);
    expect([...s.targets.entries()]).toEqual(targets);
    expect(s.marker.position.toArray()).toEqual(markerPosition);
    expect(host.dataset.markerPosition).toBe(markerSource);
    expect(host.dataset.displayMarkerPosition).toBe(markerDisplay);
    expect(JSON.stringify({ model: p.model, route: p.route })).toBe(source);
    for (const group of [s.content, s.routeGroup, s.marker]) disposeTree(group);
  });

  it("recreates the current dark materials and selection after a layer rebuild", () => {
    const p = props({
      model: facilityModel(),
      grounded: true,
      visibleLevels: [20],
      selectedId: "room-mid",
      theme: "dark",
    });
    const s = createIndoorContent(),
      host = container();
    rebuildIndoorContent(s, host, p, p.onSelect);
    rebuildIndoorRoute(s, p);
    updateIndoorMarker(s, host, p);
    const palette = getIndoorPalette("dark");
    const roles = new Set<string>();
    for (const group of [s.content, s.routeGroup, s.marker])
      group.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.material || Array.isArray(mesh.material)) return;
        const material = mesh.material as THREE.MeshStandardMaterial;
        const role = material.userData.indoorColorRole as
          | keyof typeof palette.material
          | undefined;
        if (!role) return;
        roles.add(role);
        expect(material.color.getHex()).toBe(
          mesh.userData.id === p.selectedId
            ? palette.selection
            : palette.material[role],
        );
      });
    for (const role of ["wall", "slab", "room", "marker", "primary"])
      expect(roles.has(role)).toBe(true);
    expect(host.dataset.currentRouteFloor).toBe("L");
    expect(host.dataset.displayMarkerPosition).toBe(
      JSON.stringify([samplePath(points, p.progress)[0], 1, 4]),
    );
    expect(
      s.labels.find((entry) => entry.id === "room-mid")?.element.style.color,
    ).toBe(palette.labelSelectedInk);
    for (const group of [s.content, s.routeGroup, s.marker]) disposeTree(group);
  });

  it("keeps same-named floors in other buildings out of this cutaway", () => {
    const sourceRoute: IndoorRoute = {
      ...route,
      points: [
        [0, 0, 0],
        [2, 0, 0],
        [4, 0, 0],
        [6, 0, 0],
      ],
      context: {
        buildingIds: ["other", "other", "synthetic", "synthetic"],
        levelRefs: ["L", "L", "L", "L"],
      },
      kinds: ["corridor", "corridor", "corridor"],
      steps: [
        {
          kind: "corridor",
          name: "Shared floor name",
          fromLevel: "L",
          toLevel: "L",
          startIndex: 0,
          endIndex: 3,
          distanceM: 6,
          heightPending: false,
        },
      ],
      distanceM: 6,
    };
    const snapshot = JSON.stringify(sourceRoute);
    const p = props({ route: sourceRoute, grounded: true, progress: 0.1 });
    expect(indoorRouteSegments(p)).toEqual([
      [sourceRoute.points[2], sourceRoute.points[3]],
    ]);
    const s = createIndoorContent(),
      host = container();
    updateIndoorMarker(s, host, p);
    expect(s.marker.visible).toBe(false);
    expect(host.dataset.currentRouteBuilding).toBe("other");
    expect(JSON.parse(host.dataset.markerPosition ?? "null")).toEqual(
      samplePath(sourceRoute.points, 0.1),
    );
    updateIndoorMarker(s, host, { ...p, progress: 0.9 });
    expect(s.marker.visible).toBe(false);
    expect(JSON.stringify(sourceRoute)).toBe(snapshot);
    disposeTree(s.marker);
  });

  it("does not fill missing context with another floor's or building's line", () => {
    const p = props({
      route: {
        ...route,
        context: { buildingIds: ["synthetic"], levelRefs: ["L"] },
      },
      grounded: true,
    });
    expect(indoorRouteSegments(p)).toEqual([]);
  });

  it("shows only each selected floor's walking edges without borrowing vertical spans or another building", () => {
    const sourceRoute: IndoorRoute = {
      ...route,
      context: {
        buildingIds: points.map(() => "synthetic"),
        levelRefs: ["L", "L", null, "M", "M", "H", "H"],
      },
    };
    const source = JSON.stringify(sourceRoute);
    for (const [ordinal, floor, indices] of [
      [10, 0, [1]],
      [20, 4, [4]],
      [30, 8, [6]],
    ] as const) {
      const p = props({
        route: sourceRoute,
        grounded: true,
        routeTour: true,
        visibleLevels: [ordinal],
        progress: 0,
      });
      const expected = indices.map((index) => [
        [points[index - 1][0], points[index - 1][1], floor],
        [points[index][0], points[index][1], floor],
      ]);
      expect(indoorRouteSegments(p)).toEqual(expected);
      expect(
        indoorRouteSegments({ ...p, progress: 1, routeDirection: -1 }),
      ).toEqual(expected);
      expect(
        indoorRouteSegments({
          ...p,
          route: {
            ...sourceRoute,
            context: {
              levelRefs: sourceRoute.context?.levelRefs ?? [],
              buildingIds: points.map(() => "another-building"),
            },
          },
        }),
      ).toEqual([]);
    }
    expect(JSON.stringify(sourceRoute)).toBe(source);
  });

  it("does not display a passing elevator span on an unserved intermediate floor", () => {
    const lift: IndoorRoute = {
      ...route,
      points: [
        [0, 0, 0],
        [0, 0, 8],
      ],
      kinds: ["elevator"],
      steps: [
        {
          kind: "elevator",
          name: "Lift",
          fromLevel: "L",
          toLevel: "H",
          startIndex: 0,
          endIndex: 1,
          distanceM: 8,
          heightPending: false,
        },
      ],
      context: {
        buildingIds: ["synthetic", "synthetic"],
        levelRefs: ["L", "H"],
      },
    };
    expect(
      indoorRouteSegments(
        props({
          route: lift,
          grounded: true,
          routeTour: true,
          visibleLevels: [20],
          progress: 0.5,
        }),
      ),
    ).toEqual([]);
  });

  it("keeps context-based vertical navigation on a single display plane in both directions", () => {
    const sourceRoute: IndoorRoute = {
      ...route,
      context: {
        buildingIds: points.map(() => "synthetic"),
        levelRefs: ["L", "L", null, "M", "M", null, "H"],
      },
    };
    const source = JSON.stringify(sourceRoute);
    for (const [direction, ordinal, level, elevation] of [
      [1, 10, "L", 0],
      [-1, 20, "M", 4],
    ] as const) {
      const p = props({
        route: sourceRoute,
        grounded: true,
        routeDirection: direction,
        visibleLevels: [ordinal],
      });
      const s = createIndoorContent(),
        host = container();
      const segments = indoorRouteSegments(p);
      expect(segments.length).toBeGreaterThan(0);
      expect(segments.flat().every((point) => point[2] === elevation)).toBe(
        true,
      );
      updateIndoorMarker(s, host, p);
      expect(host.dataset.currentRouteFloor).toBe(level);
      expect(s.marker.visible).toBe(false);
      expect(JSON.parse(host.dataset.markerPosition ?? "null")).toEqual(
        samplePath(sourceRoute.points, p.progress),
      );
      expect(JSON.parse(host.dataset.displayMarkerPosition ?? "null")[2]).toBe(
        elevation,
      );
      disposeTree(s.marker);
    }
    expect(JSON.stringify(sourceRoute)).toBe(source);
  });

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
      expect(s.marker.visible).toBe(!grounded);
      if (!grounded) {
        const material = cabin.material as THREE.Material;
        expect(
          material.clippingPlanes?.every(
            (plane) => plane.distanceToPoint(v3([0.5, 0.5, 4])) >= 0,
          ),
        ).toBe(true);
      }
      expect(indoorRouteSegments(p)).toEqual(
        grounded
          ? []
          : [
              [
                [0.5, 0.5, 0],
                [0.5, 0.5, 8],
              ],
            ],
      );
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
      expect(s.marker.visible).toBe(false);
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
    expect(
      s.routeGroup.children.filter((child) => child.userData.routeTube),
    ).toHaveLength(3);
    expect(
      s.routeGroup.children.filter((child) => child.userData.routeJoint),
    ).toHaveLength(2);
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
