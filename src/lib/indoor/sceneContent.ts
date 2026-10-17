import polygonClipping from "polygon-clipping";
import * as THREE from "three";
import {
  facilityIcon,
  type IndoorFacilityArea,
  indoorFacilityAreas,
  isUsableStairCandidate,
} from "./facilityAreas";
import {
  centroid,
  clipSegmentHeight,
  DISPLAY_SLAB_THICKNESS,
  DISPLAY_WALL_HEIGHT,
  floorGeometry,
  isEnclosed,
  isOpening,
  segmentRectangle,
  wallGeometry,
} from "./geometry";
import {
  routeEndpointFeatureIds,
  sampleRoutePresentation,
} from "./routePresentation";
import type { IndoorSceneProps } from "./sceneTypes";
import { buildStairCandidate } from "./stairMesh";
import type { XY, XYZ } from "./types";

export const indoorPalette = {
  primary: 0x2563eb,
  primaryCss: "#2563eb",
  selection: 0xbfdbfe,
  labelInk: "#334155",
  labelBackground: "rgba(255,255,255,.94)",
} as const;

export const v3 = (p: XYZ) => new THREE.Vector3(p[0], p[2], -p[1]);
function shape(rings: XY[][]) {
  const result = new THREE.Shape(rings[0].map((p) => new THREE.Vector2(...p)));
  result.holes = rings
    .slice(1)
    .map((r) => new THREE.Path(r.map((p) => new THREE.Vector2(...p))));
  return result;
}
function solid(
  rings: XY[][],
  base: number,
  height: number,
  material: THREE.Material,
) {
  const geometry = new THREE.ExtrudeGeometry(shape(rings), {
    depth: height,
    bevelEnabled: false,
    curveSegments: 1,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, base, 0);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
function pathLine(points: XYZ[], color: number, dashed = false) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points.map(v3));
  const material = dashed
    ? new THREE.LineDashedMaterial({ color, dashSize: 0.45, gapSize: 0.22 })
    : new THREE.LineBasicMaterial({ color });
  const line = new THREE.Line(geometry, material);
  if (dashed) line.computeLineDistances();
  return line;
}
export function disposeTree(group: THREE.Object3D) {
  const materials = new Set<THREE.Material>();
  group.traverse((obj) => {
    if (obj instanceof THREE.DirectionalLight || obj instanceof THREE.SpotLight)
      obj.shadow.dispose();
    const m = obj as THREE.Mesh;
    m.geometry?.dispose();
    if (m.material)
      for (const material of Array.isArray(m.material)
        ? m.material
        : [m.material])
        materials.add(material);
  });
  for (const material of materials) material.dispose();
}

export interface IndoorContentState {
  content: THREE.Group;
  routeGroup: THREE.Group;
  marker: THREE.Group;
  labels: {
    element: HTMLButtonElement;
    point: THREE.Vector3;
    floor: number;
    id: string;
    width: number;
    caption: string;
    allowed: boolean;
    endpoint: boolean;
    textElement?: HTMLSpanElement;
    displayCaption?: string;
    description?: string;
  }[];
  pickable: THREE.Object3D[];
  featureMeshes: Map<string, THREE.Mesh[]>;
  targets: Map<string, THREE.Vector3>;
}
export function createIndoorContent(): IndoorContentState {
  const marker = new THREE.Group();
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.25, 18, 12),
    new THREE.MeshStandardMaterial({
      color: indoorPalette.primary,
      roughness: 0.5,
    }),
  );
  dot.position.y = 0.45;
  marker.add(dot);
  marker.visible = false;
  return {
    content: new THREE.Group(),
    routeGroup: new THREE.Group(),
    marker,
    labels: [],
    pickable: [],
    featureMeshes: new Map(),
    targets: new Map(),
  };
}

/** Rendering a floor never changes source coordinates or clones another floor. */
export function indoorDisplayLevel(p: IndoorSceneProps) {
  return p.model.building.levels.find(
    (level) => level.ordinal === p.visibleLevels[0],
  );
}

function presentation(p: IndoorSceneProps) {
  if (!p.route) return null;
  const active = sampleRoutePresentation(
    p.model,
    p.route,
    p.progress,
    p.routeDirection ?? 1,
  );
  const floor = indoorDisplayLevel(p)?.ref;
  if (
    active.transition &&
    floor !== active.transition.fromLevel &&
    floor !== active.transition.toLevel
  )
    return { ...active, activeConnectionId: null, transition: null };
  return active;
}

/** A stable geometry key: ordinary progress changes only the marker transform. */
export function indoorActiveSpanKey(p: IndoorSceneProps) {
  const active = presentation(p);
  return active?.transition
    ? JSON.stringify([
        active.activeConnectionId,
        ...[active.transition.fromLevel, active.transition.toLevel].sort(),
      ])
    : "";
}

export function updateIndoorLabels(s: IndoorContentState, p: IndoorSceneProps) {
  const endpoints = p.route ? routeEndpointFeatureIds(p.model, p.route) : null;
  for (const label of s.labels) {
    const feature = p.model.features.find((f) => f.id === label.id);
    label.endpoint = Boolean(
      endpoints &&
        feature?.kind === "room" &&
        (label.id === endpoints.fromFeatureId ||
          label.id === endpoints.toFeatureId),
    );
    label.allowed = !p.route || label.endpoint;
    const caption = label.endpoint
      ? [feature?.ref, feature?.name]
          .filter((value, index, all) => value && all.indexOf(value) === index)
          .join(" · ") || label.caption
      : label.caption;
    const displayed = label.displayCaption ?? caption;
    (label.textElement ?? label.element).textContent = displayed;
    label.element.title = [caption, label.description]
      .filter(Boolean)
      .join(" · ");
    label.element.setAttribute("aria-label", `查看 ${caption}`);
    // Hidden labels measure zero; use the actual width once they are displayed.
    label.width = Math.min(
      150,
      Math.max(36, displayed.length * 11 + 12 + (label.textElement ? 27 : 0)),
    );
    if (!label.allowed) label.element.style.display = "none";
  }
}

export function rebuildIndoorContent(
  s: IndoorContentState,
  container: HTMLDivElement,
  p: IndoorSceneProps,
  onSelect: (id: string) => void,
) {
  const { model } = p;
  const displayLevel = indoorDisplayLevel(p);
  const visibleLevels = displayLevel ? [displayLevel.ordinal] : [];
  const levelsKey = visibleLevels.join(",");
  const active = presentation(p);
  disposeTree(s.content);
  s.content.clear();
  for (const label of s.labels) label.element.remove();
  s.labels.length = 0;
  s.pickable.length = 0;
  s.featureMeshes.clear();
  s.targets.clear();
  p.onGeometryStatus?.({ collisionCount: 0 });
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: 0xfafafa,
    side: THREE.DoubleSide,
    roughness: 0.9,
  });
  const baseMaterial = new THREE.MeshStandardMaterial({
    color: 0xd6d6d6,
    roughness: 1,
  });
  const outlineMaterial = new THREE.LineBasicMaterial({ color: 0xbababa });
  const label = (
    id: string,
    text: string,
    point: XYZ,
    floor: number,
    status = false,
    facility?: IndoorFacilityArea,
  ) => {
    const button = document.createElement("button");
    button.type = "button";
    const caption = text;
    let textElement: HTMLSpanElement | undefined;
    if (facility) {
      textElement = document.createElement("span");
      textElement.textContent = facility.shortCaption;
      button.appendChild(
        facilityIcon(
          facility.kind,
          facility.servesLevel === false ? "#64748b" : indoorPalette.primaryCss,
        ),
      );
      button.appendChild(textElement);
    } else button.textContent = caption;
    button.title = caption;
    button.setAttribute("aria-label", `查看 ${caption}`);
    button.style.cssText = `position:absolute;left:0;top:0;z-index:2;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:1px solid ${status ? "#c9aa75" : "#d1d5db"};border-radius:5px;padding:3px 6px;font:600 11px system-ui;box-shadow:0 1px 3px #0f172a12;cursor:pointer`;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      onSelect(id);
    });
    container.appendChild(button);
    s.labels.push({
      element: button,
      point: v3(point),
      floor,
      id,
      width: button.offsetWidth,
      caption,
      allowed: true,
      endpoint: false,
      textElement,
      displayCaption: facility?.shortCaption,
      description: facility?.researchBoundary
        ? "研究邊界，非實測；區塊表示設施範圍，不代表可行走踏面"
        : undefined,
    });
    s.targets.set(id, v3(point));
  };
  for (const ordinal of visibleLevels) {
    const level = model.building.levels.find((l) => l.ordinal === ordinal);
    if (!level) continue;
    const base = level.elevationM;
    const features = model.features.filter((f) => f.ordinal === ordinal);
    const facilities = p.grounded ? indoorFacilityAreas(model, level) : [];
    const facilityFeatureIds = new Set(
      facilities.map((entry) => entry.sourceFeatureId),
    );
    for (const polygon of floorGeometry(model, ordinal))
      s.content.add(
        solid(
          polygon,
          base - DISPLAY_SLAB_THICKNESS,
          DISPLAY_SLAB_THICKNESS,
          baseMaterial,
        ),
      );
    for (const f of features) {
      if (f.geometry.type !== "Polygon") continue;
      if (facilityFeatureIds.has(f.id)) continue;
      const rings = f.geometry.coordinates;
      const opening = isOpening(f);
      const color =
        f.kind === "room"
          ? 0xf2f2f2
          : f.tags.amenity === "toilets"
            ? 0xe8e8e8
            : f.kind === "corridor"
              ? 0xdfdfdf
              : 0xe5e5e5;
      if (!opening && (isEnclosed(f) || f.kind === "corridor")) {
        const mesh = solid(
          rings,
          base + 0.004,
          0.018,
          new THREE.MeshStandardMaterial({ color, roughness: 1 }),
        );
        mesh.userData = { id: f.id, originalColor: color };
        s.content.add(mesh);
        s.pickable.push(mesh);
        s.featureMeshes.set(f.id, [mesh]);
      }
      const center = centroid(rings[0]);
      s.targets.set(f.id, v3([center[0], center[1], base]));
      if (opening) {
        const line = pathLine(
          rings[0].map((x) => [x[0], x[1], base + 0.025]),
          0xb68e51,
          true,
        );
        s.content.add(line);
        const hit = new THREE.Mesh(
          new THREE.ShapeGeometry(shape(rings)),
          new THREE.MeshBasicMaterial({
            transparent: true,
            opacity: 0.04,
            color: 0xb68e51,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
        hit.rotation.x = -Math.PI / 2;
        hit.position.y = base + 0.03;
        hit.userData.id = f.id;
        s.content.add(hit);
        s.pickable.push(hit);
        if (f.tags["a11ymap:area_type"] === "elevator-shaft") {
          // A boundary is known, but door positions are not. Open corner
          // markers express a shaft without inventing closed walls across
          // the source approach path.
          for (const point of rings[0].slice(0, -1)) {
            s.content.add(
              pathLine(
                [
                  [point[0], point[1], base],
                  [point[0], point[1], base + 0.65],
                ],
                indoorPalette.primary,
              ),
            );
          }
        } else
          label(
            f.id,
            f.name?.replace(/^.*樓梯 /, "梯 ") || "梯間",
            [center[0], center[1], base + 0.35],
            ordinal,
            true,
          );
      } else if (isEnclosed(f)) {
        label(
          f.id,
          f.ref || f.name || "空間",
          [center[0], center[1], base + 0.16],
          ordinal,
        );
      } else if (f.kind === "area") {
        s.content.add(
          pathLine(
            rings[0].map((x) => [x[0], x[1], base + 0.02]),
            0xb4b4b4,
            true,
          ),
        );
        label(
          f.id,
          "未標示空間",
          [center[0], center[1], base + 0.1],
          ordinal,
          true,
        );
      }
    }
    for (const facility of facilities) {
      const color =
        facility.servesLevel === false
          ? 0xe5e7eb
          : facility.kind === "elevator"
            ? 0xbfdbfe
            : facility.kind === "stairs"
              ? 0xdbeafe
              : 0xe2e8f0;
      const meshes: THREE.Mesh[] = [];
      for (const polygon of facility.polygons) {
        const mesh = solid(
          polygon,
          base + 0.024,
          0.02,
          new THREE.MeshStandardMaterial({ color, roughness: 1 }),
        );
        mesh.name = "indoor-facility-area";
        mesh.userData = {
          id: facility.selectionId,
          originalColor: color,
          facilityKind: facility.kind,
          sourceFeatureId: facility.sourceFeatureId,
          researchBoundary: facility.researchBoundary,
        };
        meshes.push(mesh);
        s.content.add(mesh);
        s.pickable.push(mesh);
        for (const ring of polygon)
          s.content.add(
            pathLine(
              ring.map((point): XYZ => [point[0], point[1], base + 0.05]),
              facility.servesLevel === false ? 0x94a3b8 : 0x93a9c9,
            ),
          );
      }
      s.featureMeshes.set(facility.selectionId, meshes);
      label(
        facility.selectionId,
        `${facility.name}${facility.servesLevel === false ? " · 不停靠" : ""}`,
        [facility.anchor[0], facility.anchor[1], base + 0.12],
        ordinal,
        false,
        facility,
      );
    }
    const walls = wallGeometry(model, ordinal);
    for (const polygon of walls.polygons)
      s.content.add(solid(polygon, base, DISPLAY_WALL_HEIGHT, wallMaterial));
    for (const { a, b } of walls.boundaryWalls) {
      // Source lines between two walk surfaces have no surveyed thickness.
      // Keep their full wall face at its source position instead of either
      // deleting the wall or consuming either corridor with invented width.
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const wall = new THREE.Mesh(
        new THREE.PlaneGeometry(length, DISPLAY_WALL_HEIGHT),
        wallMaterial,
      );
      wall.rotation.y = Math.atan2(b[1] - a[1], b[0] - a[0]);
      wall.position.copy(
        v3([
          (a[0] + b[0]) / 2,
          (a[1] + b[1]) / 2,
          base + DISPLAY_WALL_HEIGHT / 2,
        ]),
      );
      wall.castShadow = true;
      wall.receiveShadow = true;
      s.content.add(wall);
    }
    const outline = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(
        model.building.footprint[0].map((x) => v3([x[0], x[1], base + 0.025])),
      ),
      outlineMaterial,
    );
    s.content.add(outline);
    for (const connection of model.connections.filter(
      (c) => !p.grounded && c.kind === "elevator",
    )) {
      const source = connection.coordinates[0];
      const stop = connection.levelRefs.includes(level.ref);
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(0.48, 0.48, 0.08, 28),
        new THREE.MeshStandardMaterial({
          color: stop ? indoorPalette.primary : 0xc8c8c8,
        }),
      );
      disc.position.copy(v3([source[0], source[1], base + 0.12]));
      disc.userData.id = connection.id;
      s.content.add(disc);
      s.pickable.push(disc);
      const title = connection.tags.ref
        ? `電梯 ${connection.tags.ref} 號`
        : connection.name.replace(model.building.name, "").trim();
      label(
        connection.id,
        `${title}${stop ? "" : " · 不停靠"}`,
        [source[0], source[1], base + 0.4],
        ordinal,
        !stop,
      );
    }
  }
  const allDesigns = (
    model.stairDesigns?.length
      ? model.stairDesigns
      : model.stairDesign
        ? [model.stairDesign]
        : []
  ).filter((design) => isUsableStairCandidate(model, design));
  const lowHeight = displayLevel?.elevationM ?? 0;
  const highHeight = lowHeight;
  const visibleDesigns = p.grounded
    ? []
    : allDesigns.filter((design) => {
        if (!displayLevel) return false;
        if (
          active?.transition &&
          design.sourceConnectionId === active.activeConnectionId
        )
          return true;
        const heights = design.sourcePath.map((point) => point[2]);
        const lower = Math.min(...heights),
          upper = Math.max(...heights);
        if (Math.abs(lower - lowHeight) < 0.001) return true;
        if (Math.abs(upper - lowHeight) > 0.001) return false;
        const name = model.connections.find(
          (connection) => connection.id === design.sourceConnectionId,
        )?.name;
        return !allDesigns.some(
          (next) =>
            Math.abs(
              Math.min(...next.sourcePath.map((point) => point[2])) - lowHeight,
            ) < 0.001 &&
            model.connections.find(
              (connection) => connection.id === next.sourceConnectionId,
            )?.name === name,
        );
      });
  const floorHeights: number[] = [];
  for (const level of model.building.levels)
    floorHeights[level.ordinal] = level.elevationM;
  const drawnShafts = new Set<string>();
  for (const design of p.stairPreview ? [] : visibleDesigns) {
    const elevatorPoint = design.sourceElevatorPoint;
    const shaftKey = JSON.stringify(design.shaft?.polygon);
    const includeShaft = Boolean(design.shaft) && !drawnShafts.has(shaftKey);
    if (includeShaft) drawnShafts.add(shaftKey);
    const candidate = buildStairCandidate(
      design,
      visibleLevels,
      floorHeights,
      false,
      { includeShaft, includeCabin: includeShaft },
    );
    const elevator = model.connections.find(
      (c) =>
        c.kind === "elevator" &&
        elevatorPoint &&
        c.coordinates.some(
          (point) =>
            Math.hypot(
              point[0] - elevatorPoint[0],
              point[1] - elevatorPoint[1],
            ) < 0.02,
        ),
    );
    const activeStair = Boolean(
      active?.transition &&
        design.sourceConnectionId === active.activeConnectionId,
    );
    const activeElevator = Boolean(
      active?.transition?.kind === "elevator" &&
        elevator?.id === active.activeConnectionId,
    );
    const transitionHeights = active?.transition
      ? model.building.levels
          .filter(
            (l) =>
              l.ref === active.transition?.fromLevel ||
              l.ref === active.transition?.toLevel,
          )
          .map((l) => l.elevationM)
      : [];
    candidate.userData.connectionId = design.sourceConnectionId;
    candidate.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        const isElevator = object.userData.facility === "elevator";
        object.userData.id = isElevator
          ? elevator?.id
          : design.sourceConnectionId;
        const fullSpan =
          !p.grounded && (isElevator ? activeElevator : activeStair);
        const heights = fullSpan
          ? isElevator
            ? transitionHeights
            : design.sourcePath.map((point) => point[2])
          : [lowHeight];
        const low = Math.min(...heights) - DISPLAY_SLAB_THICKNESS;
        const high =
          Math.max(...heights) + (fullSpan ? 1 : DISPLAY_WALL_HEIGHT);
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material]) {
          material.clippingPlanes = [
            new THREE.Plane(new THREE.Vector3(0, 1, 0), -low),
            new THREE.Plane(new THREE.Vector3(0, -1, 0), high),
          ];
          material.clipShadows = true;
        }
        s.pickable.push(object);
      }
    });
    s.content.add(candidate);
    const sourceMiddle =
      design.animationPath[Math.floor(design.animationPath.length / 2)];
    const middle: XYZ = [...sourceMiddle];
    s.targets.set(design.sourceConnectionId, v3(middle));
    const connection = model.connections.find(
      (c) => c.id === design.sourceConnectionId,
    );
    if (sourceMiddle[2] >= lowHeight && sourceMiddle[2] <= highHeight + 0.85)
      label(
        design.sourceConnectionId,
        connection?.name.replace(model.building.name, "").trim() ??
          "樓梯假設版",
        [middle[0], middle[1], middle[2] + 0.6],
        visibleLevels[0],
        true,
      );
  }
  // Existing source topology remains separate from the named research candidate.
  for (const c of model.connections.filter(
    (c) => c.kind !== "elevator" && (!p.grounded || c.kind === "ramp"),
  )) {
    if (
      !p.stairPreview &&
      allDesigns.some((design) => c.id === design.sourceConnectionId)
    )
      continue;
    const first = c.coordinates[0],
      last = c.coordinates.at(-1);
    if (!last) continue;
    const levelOrd =
      model.building.levels.find(
        (l) => Math.abs(l.elevationM - first[2]) < 0.01,
      )?.ordinal ?? 0;
    const targetOrd =
      model.building.levels.find((l) => Math.abs(l.elevationM - last[2]) < 0.01)
        ?.ordinal ?? levelOrd;
    if (!visibleLevels.includes(levelOrd) && !visibleLevels.includes(targetOrd))
      continue;
    if (
      c.kind === "stairs" &&
      c.id !== model.preview?.demoConnectionId &&
      !c.heightPending
    )
      continue;
    const transformed = c.coordinates.map(
      (x): XYZ => [x[0], x[1], x[2] + 0.07],
    );
    const fullSpan =
      !p.grounded && active?.transition && c.id === active.activeConnectionId;
    for (let i = 1; i < transformed.length; i++) {
      const clipped = fullSpan
        ? [transformed[i - 1], transformed[i]]
        : clipSegmentHeight(
            transformed[i - 1],
            transformed[i],
            lowHeight - DISPLAY_SLAB_THICKNESS,
            highHeight + DISPLAY_WALL_HEIGHT,
          );
      if (clipped)
        s.content.add(
          pathLine(
            clipped,
            c.heightPending ? 0xb5834c : indoorPalette.primary,
            true,
          ),
        );
    }
    s.targets.set(c.id, v3(transformed[Math.floor(transformed.length / 2)]));
    if (c.heightPending)
      label(
        c.id,
        `${c.name.replace(model.building.name, "").trim()} · 高差待確認`,
        transformed[Math.floor(transformed.length / 2)],
        levelOrd,
        true,
      );
    if (
      !p.grounded &&
      c.id === model.preview?.demoConnectionId &&
      p.stairPreview
    ) {
      const { widthM, risers } = p.stairPreview;
      const material = new THREE.MeshStandardMaterial({
        color: 0xd4c7a8,
        roughness: 0.9,
      });
      if (p.grounded) {
        material.clippingPlanes = [
          new THREE.Plane(
            new THREE.Vector3(0, 1, 0),
            -(lowHeight - DISPLAY_SLAB_THICKNESS),
          ),
          new THREE.Plane(
            new THREE.Vector3(0, -1, 0),
            highHeight + DISPLAY_WALL_HEIGHT,
          ),
        ];
        material.clipShadows = true;
      }
      let flightIndex = 0;
      for (let i = 1; i < c.coordinates.length; i++) {
        const a = c.coordinates[i - 1],
          b = c.coordinates[i];
        const dz = b[2] - a[2];
        if (Math.abs(dz) < 0.001) {
          const rect = segmentRectangle([a[0], a[1]], [b[0], b[1]], widthM);
          if (rect.length)
            s.content.add(solid([rect], a[2] - 0.12, 0.12, material));
        } else {
          const steps = risers[flightIndex++];
          if (!Number.isInteger(steps) || steps < 1 || steps > 60) continue;
          for (let n = 0; n < steps; n++) {
            const aa: XY = [
              a[0] + ((b[0] - a[0]) * n) / steps,
              a[1] + ((b[1] - a[1]) * n) / steps,
            ];
            const bb: XY = [
              a[0] + ((b[0] - a[0]) * (n + 1)) / steps,
              a[1] + ((b[1] - a[1]) * (n + 1)) / steps,
            ];
            const rect = segmentRectangle(aa, bb, widthM);
            if (rect.length)
              s.content.add(
                solid(
                  [rect],
                  a[2] + (dz * n) / steps - 0.12,
                  dz / steps + 0.12,
                  material,
                ),
              );
          }
        }
      }
      // Report collisions instead of moving or clipping rooms to hide them.
      const footprint = c.coordinates
        .slice(1)
        .map((b, i) =>
          segmentRectangle(
            [c.coordinates[i][0], c.coordinates[i][1]],
            [b[0], b[1]],
            widthM,
          ),
        )
        .filter((r) => r.length);
      let collisionCount = 0;
      for (const f of model.features.filter(
        (f) =>
          visibleLevels.includes(f.ordinal ?? -1) &&
          isEnclosed(f) &&
          f.geometry.type === "Polygon",
      )) {
        if (f.geometry.type !== "Polygon") continue;
        for (const r of footprint) {
          const overlap = polygonClipping.intersection(
            [r],
            f.geometry.coordinates,
          );
          if (overlap.length) {
            collisionCount++;
            for (const poly of overlap)
              s.content.add(
                solid(
                  poly,
                  (model.building.levels.find((l) => l.ordinal === f.ordinal)
                    ?.elevationM ?? 0) + 0.05,
                  0.06,
                  new THREE.MeshBasicMaterial({ color: 0xda614a }),
                ),
              );
          }
        }
      }
      container.dataset.stairCollisions = String(collisionCount);
      p.onGeometryStatus?.({ collisionCount });
    }
  }
  updateIndoorLabels(s, p);
  container.dataset.visibleLevels = levelsKey;
  container.dataset.geometry = "shared-enu-metres";
}

/** Current-floor walking segments plus the one active vertical source step. */
export function indoorRouteSegments(p: IndoorSceneProps): [XYZ, XYZ][] {
  const level = indoorDisplayLevel(p);
  if (!p.route || !level) return [];
  const active = presentation(p);
  const transition = active?.transition;
  const result: [XYZ, XYZ][] = [];
  for (let i = 1; i < p.route.points.length; i++) {
    const a = p.route.points[i - 1],
      b = p.route.points[i];
    const step = p.route.steps.find(
      (entry) => i > entry.startIndex && i <= entry.endIndex,
    );
    const activeVertical =
      transition &&
      step &&
      step.kind === transition.kind &&
      step.connectionId === transition.connectionId &&
      ((step.fromLevel === transition.fromLevel &&
        step.toLevel === transition.toLevel) ||
        (step.fromLevel === transition.toLevel &&
          step.toLevel === transition.fromLevel));
    // Height alone cannot identify a stair's platform: it belongs to its
    // vertical step, even where it is horizontal at the departure elevation.
    const onFloor = step
      ? step.fromLevel === level.ref && step.toLevel === level.ref
      : Math.abs(a[2] - level.elevationM) < 0.01 &&
        Math.abs(b[2] - level.elevationM) < 0.01;
    if (activeVertical) result.push([a, b]);
    else if (onFloor) {
      const segment = clipSegmentHeight(
        a,
        b,
        level.elevationM - DISPLAY_SLAB_THICKNESS,
        level.elevationM + DISPLAY_WALL_HEIGHT,
      );
      if (segment) result.push(segment);
    }
  }
  // The route retains its surveyed/research XYZ. Only the map's guidance
  // symbols use the current floor plane, including descending stair segments.
  return p.grounded
    ? result.map(([a, b]) => [
        [a[0], a[1], level.elevationM],
        [b[0], b[1], level.elevationM],
      ])
    : result;
}

export function rebuildIndoorRoute(s: IndoorContentState, p: IndoorSceneProps) {
  disposeTree(s.routeGroup);
  s.routeGroup.clear();
  s.routeGroup.renderOrder = p.grounded ? 20 : 0;
  for (const [a, b] of indoorRouteSegments(p)) {
    const from = v3([a[0], a[1], a[2] + 0.09]),
      to = v3([b[0], b[1], b[2] + 0.09]);
    const delta = to.clone().sub(from);
    if (delta.length() < 0.001) continue;
    const tube = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, delta.length(), 8),
      new THREE.MeshBasicMaterial({
        color: indoorPalette.primary,
        depthTest: !p.grounded,
        depthWrite: !p.grounded,
      }),
    );
    tube.position.copy(from).add(to).multiplyScalar(0.5);
    tube.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      delta.normalize(),
    );
    tube.renderOrder = p.grounded ? 20 : 0;
    s.routeGroup.add(tube);
  }
}

export function updateIndoorMarker(
  s: IndoorContentState,
  container: HTMLDivElement,
  p: IndoorSceneProps,
) {
  const active = presentation(p);
  const level = indoorDisplayLevel(p);
  container.dataset.activeConnectionId = active?.activeConnectionId ?? "";
  container.dataset.currentRouteFloor = active?.currentLevelRef ?? "";
  container.dataset.markerPosition = active
    ? JSON.stringify(active.position)
    : "";
  const displayPoint: XYZ | null =
    active && level
      ? p.grounded
        ? [active.position[0], active.position[1], level.elevationM]
        : active.position
      : null;
  container.dataset.displayMarkerPosition = displayPoint
    ? JSON.stringify(displayPoint)
    : "";
  if (!active || !level || !displayPoint || !p.route?.animationSafe) {
    s.marker.visible = false;
    container.dataset.markerVisible = "false";
    return;
  }
  const point = active.position;
  s.content.traverse((object) => {
    if (object.name !== "candidate-elevator-cabin") return;
    const riding =
      active.transition?.kind === "elevator" &&
      object.userData.id === active.activeConnectionId;
    object.position.y = riding && !p.grounded ? point[2] : level.elevationM;
    if (riding) {
      container.dataset.cabinHeight = String(point[2]);
      container.dataset.displayCabinHeight = String(object.position.y);
    }
  });
  s.marker.position.copy(v3(displayPoint));
  s.marker.traverse((object) => {
    object.renderOrder = p.grounded ? 21 : 0;
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(object.material)
      ? object.material
      : [object.material]) {
      material.depthTest = !p.grounded;
      material.depthWrite = !p.grounded;
    }
  });
  s.marker.visible =
    Boolean(
      active.transition &&
        (level.ref === active.transition.fromLevel ||
          level.ref === active.transition.toLevel),
    ) ||
    (point[2] >= level.elevationM - 0.01 &&
      point[2] <= level.elevationM + DISPLAY_WALL_HEIGHT);
  container.dataset.markerVisible = String(s.marker.visible);
  container.dataset.marker = JSON.stringify(point);
  container.dataset.activeConnection = active.activeConnectionId ?? "";
}
