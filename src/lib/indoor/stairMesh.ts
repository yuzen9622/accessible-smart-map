import * as THREE from "three";
import { guardSegments } from "./geometry";
import type { IndoorStairDesign, XY, XYZ } from "./types";

const vector = (p: XYZ) => new THREE.Vector3(p[0], p[2], -p[1]);
function block(
  polygon: XY[][],
  base: number,
  height: number,
  material: THREE.Material,
) {
  const shape = new THREE.Shape(polygon[0].map((p) => new THREE.Vector2(...p)));
  shape.holes = polygon
    .slice(1)
    .map((r) => new THREE.Path(r.map((p) => new THREE.Vector2(...p))));
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, base, 0);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
function rail(a: XYZ, b: XYZ, material: THREE.Material, radius = 0.022) {
  const start = vector(a),
    end = vector(b),
    delta = end.clone().sub(start);
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, delta.length(), 8),
    material,
  );
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    delta.normalize(),
  );
  mesh.castShadow = true;
  return mesh;
}

/** The candidate has explicit treads, platform polygons and shaft bounds. It is
 * not an extrusion of a navigation line. All dimensions/provenance live in the
 * private local design record; source room polygons remain untouched.
 */
export function buildStairCandidate(
  design: IndoorStairDesign,
  visibleLevels: number[],
  floorHeights: number[],
  exploded: boolean,
  options: { includeShaft?: boolean; includeCabin?: boolean } = {},
) {
  const group = new THREE.Group();
  const stepMaterial = new THREE.MeshStandardMaterial({
    color: 0xfafafa,
    roughness: 0.85,
  });
  const railMaterial = new THREE.MeshStandardMaterial({
    color: 0x787878,
    metalness: 0.3,
    roughness: 0.65,
  });
  const shaftMaterial = new THREE.MeshStandardMaterial({
    color: 0xe2e2e2,
    roughness: 0.9,
  });
  const highestFloor = Math.max(
    ...visibleLevels.map((ordinal) => floorHeights[ordinal]),
  );
  const cutHeight =
    highestFloor +
    (visibleLevels.length === 1 ? design.dimensions.floorHeightM : 0.85);
  if (!exploded) {
    // The roof cut applies to the physical stair surfaces too. Coordinates
    // stay unchanged when a neighbouring span continues beyond this view.
    const cut = new THREE.Plane(new THREE.Vector3(0, -1, 0), cutHeight);
    for (const material of [stepMaterial, railMaterial, shaftMaterial]) {
      material.clippingPlanes = [cut];
      material.clipShadows = true;
    }
  }
  const shaftBlock = (polygon: XY[][], base: number, height: number) => {
    const mesh = block(polygon, base, height, shaftMaterial);
    mesh.userData.facility = "elevator";
    return mesh;
  };
  const offset = (height: number) =>
    exploded ? (height / design.dimensions.floorHeightM) * 7 : 0;
  for (const step of design.steps) {
    const base = step.elevationM - step.riserHeightM - step.thicknessM;
    group.add(
      block(
        step.polygon,
        base + offset(step.elevationM),
        step.riserHeightM + step.thicknessM,
        stepMaterial,
      ),
    );
  }
  for (const platform of [...design.platforms, ...(design.approaches ?? [])]) {
    group.add(
      block(
        platform.polygon,
        platform.elevationM - platform.thicknessM + offset(platform.elevationM),
        platform.thicknessM,
        stepMaterial,
      ),
    );
  }
  if (!exploded) {
    for (const flight of design.flights) {
      const [a, b] = [flight.start, flight.end];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n: XY = [-(b[1] - a[1]) / length, (b[0] - a[0]) / length];
      for (const side of [-1, 1]) {
        const w = (flight.widthM / 2 - 0.025) * side;
        const start: XYZ = [a[0] + n[0] * w, a[1] + n[1] * w, a[2] + 0.9];
        const end: XYZ = [b[0] + n[0] * w, b[1] + n[1] * w, b[2] + 0.9];
        group.add(rail(start, end, railMaterial));
        const count = Math.ceil(length);
        for (let i = 0; i <= count; i++) {
          const t = i / count,
            x = start[0] + (end[0] - start[0]) * t,
            y = start[1] + (end[1] - start[1]) * t;
          const support =
            a[2] + Math.ceil(t * flight.risers) * flight.riserHeightM;
          group.add(
            rail(
              [x, y, support],
              [x, y, a[2] + (b[2] - a[2]) * t + 0.9],
              railMaterial,
              0.018,
            ),
          );
        }
      }
    }
    for (const platform of design.platforms) {
      const ring = platform.polygon[0];
      const openings = design.flights.flatMap((flight) =>
        [flight.start, flight.end]
          .filter((point) => Math.abs(point[2] - platform.elevationM) < 0.02)
          .map((point) => ({
            point: [point[0], point[1]] as XY,
            width: flight.widthM,
          })),
      );
      for (const point of design.animationPath) {
        if (Math.abs(point[2] - platform.elevationM) < 0.02)
          openings.push({
            point: [point[0], point[1]],
            width: design.dimensions.flightTotalWidthM,
          });
      }
      for (let i = 1; i < ring.length; i++) {
        for (const { a, b } of guardSegments(ring[i - 1], ring[i], openings)) {
          group.add(
            rail(
              [a[0], a[1], platform.elevationM + 0.9],
              [b[0], b[1], platform.elevationM + 0.9],
              railMaterial,
            ),
          );
          group.add(
            rail(
              [a[0], a[1], platform.elevationM],
              [a[0], a[1], platform.elevationM + 0.9],
              railMaterial,
              0.018,
            ),
          );
        }
      }
    }
  }
  // The shaft walls have an explicit candidate doorway, rather than routing
  // through a closed perimeter or silently hiding a source wall.
  const shaft = design.shaft;
  for (const ordinal of options.includeShaft === false || !shaft
    ? []
    : visibleLevels) {
    if (!shaft) continue;
    const height = floorHeights[ordinal];
    if (height === undefined) continue;
    const base = height + offset(height);
    // Fixed thresholds stop at the cabin edge; the well stays open vertically.
    for (const polygon of shaft.thresholdPolygons ?? [])
      group.add(shaftBlock(polygon, base - 0.12, 0.12));
    const wallHeight =
      visibleLevels.includes(ordinal + 1) && !exploded
        ? floorHeights[ordinal + 1] - height
        : 0.85;
    for (const polygon of shaft.wallPolygons ?? [])
      group.add(shaftBlock(polygon, base, wallHeight));
    if (wallHeight > (shaft.doorHeightM ?? 2.1)) {
      const doorHeight = shaft.doorHeightM ?? 2.1;
      for (const polygon of shaft.doorHeaderPolygons ?? [])
        group.add(
          shaftBlock(polygon, base + doorHeight, wallHeight - doorHeight),
        );
    }
  }
  // One cabin floor moves with an elevator traversal. Duplicating a solid car
  // at every stop would put a false floor across the vertical animation path.
  if (options.includeCabin !== false && shaft) {
    const cabin = shaftBlock(shaft.carPolygon, -0.12, 0.12);
    cabin.name = "candidate-elevator-cabin";
    const level = floorHeights[visibleLevels[0]] ?? 0;
    cabin.position.y = level + offset(level);
    group.add(cabin);
  }
  return group;
}
