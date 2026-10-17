import {
  Camera,
  DoubleSide,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Vector3,
} from "three";
import { describe, expect, it } from "vitest";
import {
  groundFloorModelMatrix,
  mapPixelRay,
  updateIndoorMapCamera,
} from "../mapProjection";

/** Independent geographic camera in map units, plus its physical metre view. */
function mapView({
  width = 1200,
  height = 800,
  scale = 1,
  bearing = 0.6,
  altitude = 3.6,
} = {}) {
  const target = new Vector3(8, altitude, -6);
  const offset = new Vector3(18, 32, 36).applyAxisAngle(
    new Vector3(0, 1, 0),
    bearing,
  );
  const mapCamera = new PerspectiveCamera(47, width / height, 0.4, 400);
  mapCamera.position.copy(target).multiplyScalar(scale).add(offset);
  mapCamera.lookAt(target.clone().multiplyScalar(scale));
  mapCamera.updateMatrixWorld();
  const view = mapCamera.matrixWorldInverse
    .clone()
    .multiply(new Matrix4().makeScale(scale, scale, scale));
  const combined = mapCamera.projectionMatrix.clone().multiply(view);
  const physicalCamera = new PerspectiveCamera(
    47,
    width / height,
    0.4 / scale,
    400 / scale,
  );
  physicalCamera.position.copy(mapCamera.position).divideScalar(scale);
  physicalCamera.lookAt(target);
  physicalCamera.updateMatrixWorld();
  return { mapCamera, physicalCamera, combined, width, height, target };
}

function pixel(point: Vector3, camera: Camera, width: number, height: number) {
  const ndc = point.clone().project(camera);
  return { x: ((ndc.x + 1) * width) / 2, y: ((1 - ndc.y) * height) / 2 };
}

function room(point: Vector3, name = "synthetic room") {
  const mesh = new Mesh(
    new PlaneGeometry(0.4, 0.32),
    new MeshBasicMaterial({ side: DoubleSide }),
  );
  mesh.name = name;
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.copy(point);
  mesh.updateMatrixWorld();
  return mesh;
}

function release(mesh: ReturnType<typeof room>) {
  mesh.geometry.dispose();
  mesh.material.dispose();
}

describe("MapLibre indoor camera and picking", () => {
  it("places every floor on the same ground pixels while picking its original source height", () => {
    const fixture = mapView({ altitude: 0, scale: 1.7 });
    const sourceModelMatrix = new Matrix4().makeScale(1.7, 1.7, 1.7);
    const originalMatrix = sourceModelMatrix.clone();
    const groundPoint = new Vector3(10.3, 0, -7.7);
    const expected = pixel(
      groundPoint,
      fixture.physicalCamera,
      fixture.width,
      fixture.height,
    );
    for (const elevation of [0, 3.6, 25.2]) {
      const point = groundPoint.clone().setY(elevation);
      const mesh = room(point);
      const camera = new Camera();
      const combined = fixture.mapCamera.projectionMatrix
        .clone()
        .multiply(fixture.mapCamera.matrixWorldInverse)
        .multiply(groundFloorModelMatrix(sourceModelMatrix, elevation));
      const inverse = updateIndoorMapCamera(
        camera,
        fixture.mapCamera.projectionMatrix.elements,
        combined,
      );
      const actual = pixel(point, camera, fixture.width, fixture.height);
      expect(actual.x).toBeCloseTo(expected.x, 7);
      expect(actual.y).toBeCloseTo(expected.y, 7);
      const hit = mapPixelRay(
        expected,
        fixture.width,
        fixture.height,
        inverse,
      ).intersectObject(mesh)[0];
      expect(hit.object).toBe(mesh);
      expect(hit.point.distanceTo(point)).toBeLessThan(1e-8);
      expect(mesh.position.y).toBe(elevation);
      expect(sourceModelMatrix.equals(originalMatrix)).toBe(true);
      release(mesh);
    }
  });

  it.each([
    { scale: 0.35, bearing: -0.8, altitude: 0 },
    { scale: 1, bearing: 0.6, altitude: 3.6 },
    { scale: 2.8, bearing: 1.5, altitude: 25.2 },
  ])(
    "projects and picks a small elevated room at $scale map units/metre",
    (options) => {
      const fixture = mapView(options);
      const point = fixture.target.clone().add(new Vector3(2.3, 0, -1.7));
      const mesh = room(point);
      const camera = new Camera();
      const inverse = updateIndoorMapCamera(
        camera,
        fixture.mapCamera.projectionMatrix.elements,
        fixture.combined,
      );
      // Match the renderer's actual update condition. Re-enabling automatic
      // world updates would strip the scale and misplace labels/lighting.
      if (camera.parent === null && camera.matrixWorldAutoUpdate)
        camera.updateMatrixWorld();
      const expected = pixel(
        point,
        fixture.physicalCamera,
        fixture.width,
        fixture.height,
      );
      const actual = pixel(point, camera, fixture.width, fixture.height);
      expect(actual.x).toBeCloseTo(expected.x, 7);
      expect(actual.y).toBeCloseTo(expected.y, 7);
      expect(
        camera.position.distanceTo(fixture.physicalCamera.position),
      ).toBeLessThan(1e-9);
      expect(camera.matrixAutoUpdate).toBe(false);
      expect(camera.matrixWorldAutoUpdate).toBe(false);
      const ray = mapPixelRay(expected, fixture.width, fixture.height, inverse);
      const hit = ray.intersectObject(mesh, false)[0];
      expect(hit?.object).toBe(mesh);
      expect(hit.point.distanceTo(point)).toBeLessThan(1e-8);
      expect(ray.ray.direction.length()).toBeCloseTo(1, 12);
      release(mesh);
    },
  );

  it("keeps picking aligned after aspect-ratio and proportional CSS resizing", () => {
    const mesh = room(new Vector3(10.3, 25.2, -7.7));
    for (const [width, height] of [
      [1280, 720],
      [800, 800],
      [320, 900],
    ]) {
      const fixture = mapView({ width, height, altitude: 25.2, scale: 2.1 });
      const camera = new Camera();
      const inverse = updateIndoorMapCamera(
        camera,
        fixture.mapCamera.projectionMatrix.elements,
        fixture.combined,
      );
      const pointer = pixel(
        mesh.position,
        fixture.physicalCamera,
        width,
        height,
      );
      const ray = mapPixelRay(pointer, width, height, inverse);
      const doubled = mapPixelRay(
        { x: pointer.x * 2, y: pointer.y * 2 },
        width * 2,
        height * 2,
        inverse,
      );
      expect(
        ray.intersectObject(mesh)[0]?.point.distanceTo(mesh.position),
      ).toBeLessThan(1e-8);
      expect(
        doubled.intersectObject(mesh)[0]?.point.distanceTo(mesh.position),
      ).toBeLessThan(1e-8);
      expect(doubled.ray.direction.distanceTo(ray.ray.direction)).toBeLessThan(
        1e-12,
      );
    }
    release(mesh);
  });

  it("distinguishes rooms at the same east/north position on different floors", () => {
    const fixture = mapView({ altitude: 12, scale: 0.9 });
    const low = room(new Vector3(10.3, 0, -7.7), "lower room");
    const high = room(new Vector3(10.3, 25.2, -7.7), "upper room");
    const camera = new Camera();
    const inverse = updateIndoorMapCamera(
      camera,
      fixture.mapCamera.projectionMatrix.elements,
      fixture.combined,
    );
    const pixels = [low, high].map((mesh) =>
      pixel(
        mesh.position,
        fixture.physicalCamera,
        fixture.width,
        fixture.height,
      ),
    );
    expect(Math.abs(pixels[0].y - pixels[1].y)).toBeGreaterThan(100);
    for (const [index, mesh] of [low, high].entries()) {
      const hits = mapPixelRay(
        pixels[index],
        fixture.width,
        fixture.height,
        inverse,
      ).intersectObjects([low, high]);
      expect(hits[0]?.object.name).toBe(mesh.name);
      expect(hits[0].point.y).toBeCloseTo(mesh.position.y, 8);
    }
    release(low);
    release(high);
  });

  it("does not select geometry beyond the map's visible far clipping plane", () => {
    const fixture = mapView();
    const camera = new Camera();
    const inverse = updateIndoorMapCamera(
      camera,
      fixture.mapCamera.projectionMatrix.elements,
      fixture.combined,
    );
    const forward = fixture.physicalCamera.getWorldDirection(new Vector3());
    const beyond = room(
      fixture.physicalCamera.position
        .clone()
        .addScaledVector(forward, fixture.physicalCamera.far * 1.5),
    );
    beyond.lookAt(fixture.physicalCamera.position);
    beyond.updateMatrixWorld();
    const ray = mapPixelRay(
      { x: fixture.width / 2, y: fixture.height / 2 },
      fixture.width,
      fixture.height,
      inverse,
    );
    expect(ray.intersectObject(beyond)).toHaveLength(0);
    // The mesh really lies on the ray; only the rendered far plane excludes it.
    ray.far = Infinity;
    expect(ray.intersectObject(beyond).length).toBeGreaterThan(0);
    release(beyond);
  });

  it("preserves input matrices and a prior frame's independent inverse", () => {
    const first = mapView({ bearing: -1, altitude: 0 });
    const second = mapView({ bearing: 1.2, altitude: 25.2, scale: 3 });
    const matrixBefore = first.combined.toArray();
    const projectionBefore = [...first.mapCamera.projectionMatrix.elements];
    const camera = new Camera();
    const inverse = updateIndoorMapCamera(
      camera,
      first.mapCamera.projectionMatrix.elements,
      first.combined,
    );
    updateIndoorMapCamera(
      camera,
      second.mapCamera.projectionMatrix.elements,
      second.combined,
    );
    expect(first.combined.toArray()).toEqual(matrixBefore);
    expect(first.mapCamera.projectionMatrix.elements).toEqual(projectionBefore);
    const mesh = room(first.target);
    const pointer = pixel(
      mesh.position,
      first.physicalCamera,
      first.width,
      first.height,
    );
    expect(
      mapPixelRay(pointer, first.width, first.height, inverse).intersectObject(
        mesh,
      )[0]?.object,
    ).toBe(mesh);
    release(mesh);
  });

  it("rejects zero-sized or nonfinite CSS viewports before producing an invalid ray", () => {
    expect(() => mapPixelRay({ x: 0, y: 0 }, 0, 100, new Matrix4())).toThrow(
      RangeError,
    );
    expect(() =>
      mapPixelRay({ x: Number.NaN, y: 0 }, 100, 100, new Matrix4()),
    ).toThrow(RangeError);
  });
});
