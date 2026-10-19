import { type Camera, Matrix4, Raycaster, Vector3 } from "three";

/** Present one floor on the map ground, retaining all source metre coordinates. */
export function groundFloorModelMatrix(
  modelMatrix: Matrix4,
  floorElevation: number,
): Matrix4 {
  return modelMatrix
    .clone()
    .multiply(new Matrix4().makeTranslation(0, -floorElevation, 0));
}

/**
 * C maps the shared (east, up, -north) metre space to clip space. Separate
 * C = P * V so Three's lighting and clipping use the actual geographic view.
 */
export function updateIndoorMapCamera(
  camera: Camera,
  projection: ArrayLike<number>,
  combined: Matrix4,
): Matrix4 {
  // Three 0.186's camera world update removes scale from the view matrix.
  // MapLibre's view includes metres-to-map-units scale; retain it verbatim.
  camera.matrixAutoUpdate = false;
  camera.matrixWorldAutoUpdate = false;
  camera.projectionMatrix.fromArray(projection);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  camera.matrixWorldInverse
    .copy(camera.projectionMatrixInverse)
    .multiply(combined);
  camera.matrixWorld.copy(camera.matrixWorldInverse).invert();
  camera.position.setFromMatrixPosition(camera.matrixWorld);
  return combined.clone().invert();
}

/** Map-relative CSS pixels; dimensions must use the same CSS pixel space. */
export function mapPixelRay(
  point: { x: number; y: number },
  width: number,
  height: number,
  inverse: Matrix4,
): Raycaster {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y)
  )
    throw new RangeError(
      "Map picking requires finite CSS pixels and a positive viewport.",
    );

  const x = (point.x / width) * 2 - 1;
  const y = 1 - (point.y / height) * 2;
  const near = new Vector3(x, y, -1).applyMatrix4(inverse);
  const far = new Vector3(x, y, 1).applyMatrix4(inverse);
  const direction = far.sub(near);
  const distance = direction.length();
  // Restrict picking to the rendered clip volume, not an infinite ray that
  // could select invisible geometry beyond the map's far clipping plane.
  return new Raycaster(near, direction.normalize(), 0, distance);
}
