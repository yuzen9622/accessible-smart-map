import polygonClipping from "polygon-clipping";
import * as THREE from "three";
import {
  type IndoorRouteDisplaySegment,
  type IndoorSceneRouteSegment,
  routeDisplaySegment,
  routeSegmentCoordinates,
} from "./campusRouteSegments";
import {
  facilityIcon,
  type IndoorFacilityArea,
  indoorFacilityAreas,
  indoorFeatureName,
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
import { getIndoorPalette, type IndoorMaterialRole } from "./indoorTheme";
import {
  routeEndpointFeatureIds,
  sampleRoutePresentation,
} from "./routePresentation";
import type { IndoorSceneProps } from "./sceneTypes";
import { buildStairCandidate } from "./stairMesh";
import type { XY, XYZ } from "./types";

/** Light defaults retained for the standalone diagnostic renderer. */
export const indoorPalette = getIndoorPalette();

function themedMaterial<T extends THREE.Material & { color: THREE.Color }>(
  material: T,
  role: IndoorMaterialRole,
): T {
  material.userData.indoorColorRole = role;
  material.color.setHex(indoorPalette.material[role]);
  return material;
}

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
function pathLine(points: XYZ[], role: IndoorMaterialRole, dashed = false) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points.map(v3));
  const material = themedMaterial(
    dashed
      ? new THREE.LineDashedMaterial({ dashSize: 0.45, gapSize: 0.22 })
      : new THREE.LineBasicMaterial(),
    role,
  );
  const line = new THREE.Line(geometry, material);
  if (dashed) line.computeLineDistances();
  return line;
}

/** Product source markings remain planar geometry, never new physical walls.
 * The standalone diagnostic retains the pending/unknown dashed notation. */
function spaceBoundary(
  points: XYZ[],
  role: "pendingOutline" | "unknownOutline" | "pendingPath" | "primary",
  grounded: boolean | undefined,
) {
  const line = pathLine(points, grounded ? "spaceBoundary" : role, !grounded);
  if (grounded) {
    line.material.transparent = true;
    line.material.opacity = 0.55;
    line.material.depthWrite = false;
  }
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
    status: boolean;
    nonStopping: boolean;
    iconElement?: SVGSVGElement;
  }[];
  pickable: THREE.Object3D[];
  featureMeshes: Map<string, THREE.Mesh[]>;
  targets: Map<string, THREE.Vector3>;
}
export function createIndoorContent(): IndoorContentState {
  const marker = new THREE.Group();
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.25, 18, 12),
    themedMaterial(
      new THREE.MeshStandardMaterial({ roughness: 0.5 }),
      "marker",
    ),
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

/** Update styles in place: no geometry, selection identity, or route progress
 * is recreated when the map changes theme. */
export function updateIndoorTheme(s: IndoorContentState, p: IndoorSceneProps) {
  const palette = getIndoorPalette(p.theme);
  for (const group of [s.content, s.routeGroup, s.marker]) {
    group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.material) return;
      for (const material of Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material]) {
        const role = material.userData.indoorColorRole as
          | IndoorMaterialRole
          | undefined;
        if (
          role &&
          "color" in material &&
          material.color instanceof THREE.Color
        )
          material.color.setHex(palette.material[role]);
      }
    });
  }
  for (const [id, meshes] of s.featureMeshes) {
    for (const mesh of meshes) {
      const material = mesh.material as THREE.MeshStandardMaterial;
      const role = material.userData.indoorColorRole as IndoorMaterialRole;
      if (role) mesh.userData.originalColor = palette.material[role];
      material.color.setHex(
        id === p.selectedId ? palette.selection : mesh.userData.originalColor,
      );
    }
  }
  for (const label of s.labels) {
    const selected = label.id === p.selectedId;
    label.element.style.background = selected
      ? palette.labelSelectedBackground
      : palette.labelBackground;
    label.element.style.color = selected
      ? palette.labelSelectedInk
      : palette.labelInk;
    label.element.style.borderColor = selected
      ? palette.labelSelectedBorder
      : label.status
        ? palette.labelPendingBorder
        : palette.labelBorder;
    label.element.style.boxShadow = palette.labelShadow;
    if (label.iconElement)
      label.iconElement.style.background = selected
        ? palette.iconSelectedBackground
        : label.nonStopping
          ? palette.iconMutedBackground
          : palette.iconBackground;
  }
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
    (p.route.context && active.currentBuildingId !== p.model.building.id) ||
    (active.transition &&
      floor !== active.transition.fromLevel &&
      floor !== active.transition.toLevel)
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
  const wallMaterial = themedMaterial(
    new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.9 }),
    "wall",
  );
  const baseMaterial = themedMaterial(
    new THREE.MeshStandardMaterial({ roughness: 1 }),
    "slab",
  );
  const outlineMaterial = themedMaterial(
    new THREE.LineBasicMaterial(),
    "outline",
  );
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
    let iconElement: SVGSVGElement | undefined;
    if (facility) {
      textElement = document.createElement("span");
      textElement.textContent = facility.shortCaption;
      iconElement = facilityIcon(facility.kind, indoorPalette.iconBackground);
      button.appendChild(iconElement);
      button.appendChild(textElement);
    } else button.textContent = caption;
    button.title = caption;
    button.setAttribute("aria-label", `查看 ${caption}`);
    button.style.cssText =
      "position:absolute;left:0;top:0;z-index:2;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:1px solid;border-radius:5px;padding:3px 6px;font:600 11px system-ui;cursor:pointer";
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
      iconElement,
      status,
      nonStopping: facility?.servesLevel === false,
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
      const colorRole: IndoorMaterialRole =
        f.kind === "room"
          ? "room"
          : f.tags.amenity === "toilets"
            ? "toilet"
            : f.kind === "corridor"
              ? "corridor"
              : "unknownArea";
      const color = indoorPalette.material[colorRole];
      if (!opening && (isEnclosed(f) || f.kind === "corridor")) {
        const mesh = solid(
          rings,
          base + 0.004,
          0.018,
          themedMaterial(
            new THREE.MeshStandardMaterial({ roughness: 1 }),
            colorRole,
          ),
        );
        mesh.userData = { id: f.id, originalColor: color };
        s.content.add(mesh);
        s.pickable.push(mesh);
        s.featureMeshes.set(f.id, [mesh]);
      }
      const center = centroid(rings[0]);
      s.targets.set(f.id, v3([center[0], center[1], base]));
      if (opening) {
        const line = spaceBoundary(
          rings[0].map((x) => [x[0], x[1], base + 0.025]),
          "pendingOutline",
          p.grounded,
        );
        s.content.add(line);
        const hit = new THREE.Mesh(
          new THREE.ShapeGeometry(shape(rings)),
          themedMaterial(
            new THREE.MeshBasicMaterial({
              transparent: true,
              opacity: 0.04,
              side: THREE.DoubleSide,
              depthWrite: false,
            }),
            p.grounded ? "spaceBoundary" : "pendingOutline",
          ),
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
                "primary",
              ),
            );
          }
        } else
          label(
            f.id,
            indoorFeatureName(f)?.replace(/^.*樓梯 /, "梯 ") || "梯間",
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
          spaceBoundary(
            rings[0].map((x) => [x[0], x[1], base + 0.02]),
            "unknownOutline",
            p.grounded,
          ),
        );
      }
    }
    for (const facility of facilities) {
      const colorRole: IndoorMaterialRole =
        facility.servesLevel === false
          ? "nonStopping"
          : facility.kind === "elevator"
            ? "elevator"
            : facility.kind === "stairs"
              ? "stairs"
              : "core";
      const color = indoorPalette.material[colorRole];
      const meshes: THREE.Mesh[] = [];
      for (const polygon of facility.polygons) {
        const mesh = solid(
          polygon,
          base + 0.024,
          0.02,
          themedMaterial(
            new THREE.MeshStandardMaterial({ roughness: 1 }),
            colorRole,
          ),
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
              facility.servesLevel === false
                ? "nonStoppingOutline"
                : "facilityOutline",
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
        themedMaterial(
          new THREE.MeshStandardMaterial(),
          stop ? "primary" : "diagnosticInactive",
        ),
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
          spaceBoundary(
            clipped,
            c.heightPending ? "pendingPath" : "primary",
            p.grounded,
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
  updateIndoorTheme(s, p);
  container.dataset.visibleLevels = levelsKey;
  container.dataset.geometry = "shared-enu-metres";
}

/** Current-floor walking and its authored vertical spans. Physical diagnostics
 * retain the active transition; product line animation does not advance floors. */
export function indoorRouteDisplaySegments(
  p: IndoorSceneProps,
): IndoorRouteDisplaySegment[] {
  const level = indoorDisplayLevel(p);
  if (!p.route || !level) return [];
  const context = p.route.context;
  if (
    context &&
    (context.buildingIds.length !== p.route.points.length ||
      context.levelRefs.length !== p.route.points.length)
  )
    return [];
  const active = presentation(p);
  const transition = active?.transition;
  const result: IndoorRouteDisplaySegment[] = [];
  for (let i = 1; i < p.route.points.length; i++) {
    if (
      context &&
      (context.buildingIds[i - 1] !== p.model.building.id ||
        context.buildingIds[i] !== p.model.building.id)
    )
      continue;
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
    const visibleVertical =
      p.grounded && p.routeTour
        ? step &&
          (step.kind === "steps" ||
            step.kind === "elevator" ||
            step.kind === "ramp") &&
          step.fromLevel !== null &&
          step.toLevel !== null &&
          step.fromLevel !== step.toLevel &&
          (step.fromLevel === level.ref || step.toLevel === level.ref) &&
          (step.fromBuildingId === undefined ||
            step.fromBuildingId === p.model.building.id) &&
          (step.toBuildingId === undefined ||
            step.toBuildingId === p.model.building.id)
        : activeVertical;
    // Height alone cannot identify a stair's platform: it belongs to its
    // vertical step, even where it is horizontal at the departure elevation.
    const onFloor = context
      ? context.levelRefs[i - 1] === level.ref &&
        context.levelRefs[i] === level.ref
      : step
        ? step.fromLevel === level.ref && step.toLevel === level.ref
        : Math.abs(a[2] - level.elevationM) < 0.01 &&
          Math.abs(b[2] - level.elevationM) < 0.01;
    if (visibleVertical)
      result.push(routeDisplaySegment(p.route, p.model, i - 1));
    else if (onFloor) {
      const segment = clipSegmentHeight(
        a,
        b,
        level.elevationM - DISPLAY_SLAB_THICKNESS,
        level.elevationM + DISPLAY_WALL_HEIGHT,
      );
      if (segment)
        result.push(routeDisplaySegment(p.route, p.model, i - 1, segment));
    }
  }
  // The route retains its surveyed/research XYZ. Only the map's guidance
  // symbols use the current floor plane, including descending stair segments.
  return p.grounded
    ? result.map((segment) => {
        const [a, b] = segment.coordinates;
        return {
          ...segment,
          coordinates: [
            [a[0], a[1], level.elevationM],
            [b[0], b[1], level.elevationM],
          ] as [XYZ, XYZ],
        };
      })
    : result;
}

/** Existing coordinate-only diagnostic callers do not need renderer metadata. */
export function indoorRouteSegments(p: IndoorSceneProps): [XYZ, XYZ][] {
  return indoorRouteDisplaySegments(p).map((segment) => segment.coordinates);
}

export function rebuildIndoorRoute(s: IndoorContentState, p: IndoorSceneProps) {
  rebuildIndoorRouteSegments(s, p, indoorRouteDisplaySegments(p));
}

/** The caller supplies already-authorized segments. Disconnected segments stay
 * disconnected, and only the display elevation can be flattened by the host. */
export function rebuildIndoorRouteSegments(
  s: IndoorContentState,
  p: IndoorSceneProps,
  segments: IndoorSceneRouteSegment[],
) {
  disposeTree(s.routeGroup);
  s.routeGroup.clear();
  s.routeGroup.renderOrder = p.grounded ? 20 : 0;
  for (const segment of segments) {
    const [a, b] = routeSegmentCoordinates(segment);
    const role =
      !Array.isArray(segment) && segment.accessibleRamp
        ? "accessibleRamp"
        : "primary";
    const from = v3([a[0], a[1], a[2] + 0.09]),
      to = v3([b[0], b[1], b[2] + 0.09]);
    const delta = to.clone().sub(from);
    if (delta.length() < 0.001) continue;
    const tube = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, delta.length(), 8),
      themedMaterial(
        new THREE.MeshBasicMaterial({
          depthTest: !p.grounded,
          depthWrite: !p.grounded,
        }),
        role,
      ),
    );
    tube.position.copy(from).add(to).multiplyScalar(0.5);
    tube.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      delta.normalize(),
    );
    tube.renderOrder = p.grounded ? 20 : 0;
    tube.userData.routeTube = { from, to };
    if (!Array.isArray(segment)) tube.userData.routeSegment = segment;
    s.routeGroup.add(tube);
    if (p.grounded && p.routeTour && delta.length() > 0) {
      const length = from.distanceTo(to);
      // Small directional symbols follow each original straight segment. They
      // never interpolate across a corner, gap, or separate building segment.
      const count = Math.max(1, Math.floor(length / 3));
      for (let index = 0; index < count; index++) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(
            [-0.2, 0, -0.18, 0.2, 0, -0.18, 0, 0, 0.3],
            3,
          ),
        );
        const arrow = new THREE.Mesh(
          geometry,
          themedMaterial(
            new THREE.MeshBasicMaterial({
              depthTest: false,
              depthWrite: false,
              side: THREE.DoubleSide,
            }),
            role,
          ),
        );
        arrow.name = "indoor-route-direction";
        arrow.renderOrder = 22;
        arrow.userData.routeFlow = { from, to, index, count, length };
        if (!Array.isArray(segment)) arrow.userData.routeSegment = segment;
        s.routeGroup.add(arrow);
      }
    }
  }
  updateIndoorRouteFlow(s, p, 0);
  updateIndoorTheme(s, p);
}

/** Time is a display clock, not route progress or a claim that the user moved. */
export function updateIndoorRouteFlow(
  s: IndoorContentState,
  p: IndoorSceneProps,
  elapsedSeconds: number,
) {
  const direction = p.routeDirection ?? 1;
  for (const arrow of s.routeGroup.children) {
    const flow = arrow.userData.routeFlow as
      | {
          from: THREE.Vector3;
          to: THREE.Vector3;
          index: number;
          count: number;
          length: number;
        }
      | undefined;
    if (!flow) continue;
    const offset = (elapsedSeconds * direction * 0.9) / flow.length;
    const raw = ((((flow.index + 0.5) / flow.count + offset) % 1) + 1) % 1;
    const tail = ((direction === 1 ? 0.18 : 0.3) * arrow.scale.z) / flow.length;
    const head = ((direction === 1 ? 0.3 : 0.18) * arrow.scale.z) / flow.length;
    const fraction = Math.max(tail, Math.min(1 - head, raw));
    arrow.position.lerpVectors(flow.from, flow.to, fraction);
    arrow.position.y += 0.04;
    arrow.rotation.y = Math.atan2(
      (flow.to.x - flow.from.x) * direction,
      (flow.to.z - flow.from.z) * direction,
    );
  }
}

/** Size map guidance with its actual perspective, without changing source
 * points or rebuilding buffers. Tube length and segment endpoints stay fixed. */
export function updateIndoorOverlayScale(
  s: IndoorContentState,
  camera: THREE.Camera,
  width: number,
  height: number,
) {
  if (width <= 0 || height <= 0) return;
  const pixelsBetween = (a: THREE.Vector3, b: THREE.Vector3) => {
    const from = a.clone().project(camera),
      to = b.clone().project(camera);
    return Math.hypot(
      ((to.x - from.x) * width) / 2,
      ((to.y - from.y) * height) / 2,
    );
  };
  for (const object of s.routeGroup.children) {
    const tube = object.userData.routeTube as
      | { from: THREE.Vector3; to: THREE.Vector3 }
      | undefined;
    if (tube) {
      const direction = tube.to.clone().sub(tube.from).normalize();
      const side = new THREE.Vector3(-direction.z, 0, direction.x);
      const center = tube.from.clone().add(tube.to).multiplyScalar(0.5);
      const pixelsPerMetre = pixelsBetween(
        center.clone().addScaledVector(side, -0.5),
        center.clone().addScaledVector(side, 0.5),
      );
      if (pixelsPerMetre > 1e-6) {
        const scale = Math.max(1, 4 / (0.14 * pixelsPerMetre));
        object.scale.set(scale, 1, scale);
      }
    }
    const flow = object.userData.routeFlow as
      | { from: THREE.Vector3; to: THREE.Vector3; length: number }
      | undefined;
    if (flow) {
      const lengthPixels = pixelsBetween(flow.from, flow.to);
      if (lengthPixels > 1e-6) {
        const scale = Math.min(
          (flow.length * 0.8) / 0.48,
          Math.max(1, (8 * flow.length) / (0.48 * lengthPixels)),
        );
        object.scale.set(scale, 1, scale);
      }
    }
  }
  const dot = s.marker.children[0];
  if (dot) {
    const center = s.marker.position.clone().add(dot.position);
    const right = new THREE.Vector3(1, 0, 0).transformDirection(
      camera.matrixWorld,
    );
    const pixelsPerMetre = pixelsBetween(
      center.clone().addScaledVector(right, -0.5),
      center.clone().addScaledVector(right, 0.5),
    );
    if (pixelsPerMetre > 1e-6)
      dot.scale.setScalar(Math.max(1, 10 / (0.5 * pixelsPerMetre)));
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
  container.dataset.currentRouteBuilding = active?.currentBuildingId ?? "";
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
  if (
    !active ||
    !level ||
    !displayPoint ||
    !(p.route?.animationSafe || (p.grounded && p.routeTour && p.route)) ||
    (p.route.context && active.currentBuildingId !== p.model.building.id)
  ) {
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
  // Product guidance is the line and its direction flow; the physical
  // diagnostic can still show its own sampled-position cursor.
  if (p.grounded) s.marker.visible = false;
  container.dataset.markerVisible = String(s.marker.visible);
  container.dataset.marker = JSON.stringify(point);
  container.dataset.activeConnection = active.activeConnectionId ?? "";
}

/** Preserve authored outdoor/cross-building position metadata in the main model
 * frame. Product guidance draws direction flow, never a position cursor. */
export function updateCampusTourMarker(
  s: IndoorContentState,
  container: HTMLDivElement,
  p: IndoorSceneProps,
) {
  const active = p.route
    ? sampleRoutePresentation(
        p.model,
        p.route,
        p.progress,
        p.routeDirection ?? 1,
      )
    : null;
  const distances = [0];
  for (let index = 1; index < (p.route?.points.length ?? 0); index++) {
    const a = p.route?.points[index - 1],
      b = p.route?.points[index];
    if (a && b)
      distances.push(
        distances[index - 1] +
          Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]),
      );
  }
  const distance =
    (distances.at(-1) ?? 0) * Math.max(0, Math.min(1, p.progress));
  const reverse = p.routeDirection === -1;
  let sourceIndex = reverse ? 0 : distances.length - 2;
  for (let index = 0; index < distances.length - 1; index++) {
    if (
      reverse
        ? distance > distances[index] && distance <= distances[index + 1]
        : distance >= distances[index] && distance < distances[index + 1]
    ) {
      sourceIndex = index;
      break;
    }
  }
  const sourceFrom = p.route?.points[sourceIndex],
    sourceTo = p.route?.points[sourceIndex + 1];
  const onSegment = (p.campusRouteSegments ?? []).some((segment) => {
    if (!Array.isArray(segment))
      return (
        segment.pathStart === sourceIndex && segment.pathEnd === sourceIndex + 1
      );
    const [a, b] = segment;
    // Membership is by the actual source edge, never proximity to another
    // corridor at the same XY or a crossing on a different floor.
    return (
      sourceFrom &&
      sourceTo &&
      a.every((value, index) => value === sourceFrom[index]) &&
      b.every((value, index) => value === sourceTo[index])
    );
  });
  const onRoute = Boolean(p.routeTour && active && onSegment);
  s.marker.visible = false;
  container.dataset.campusMarkerVisible = String(s.marker.visible);
  if (!active || !onRoute) return;
  s.marker.position.copy(v3([active.position[0], active.position[1], 0]));
  s.marker.traverse((object) => {
    object.renderOrder = 23;
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(object.material)
      ? object.material
      : [object.material]) {
      material.depthTest = false;
      material.depthWrite = false;
    }
  });
  container.dataset.campusMarkerPosition = JSON.stringify(active.position);
  container.dataset.campusDisplayMarkerPosition = JSON.stringify([
    active.position[0],
    active.position[1],
    0,
  ]);
}
