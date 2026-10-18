import Point from "@mapbox/point-geometry";
import { LngLat } from "maplibre-gl";
import { PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import {
  fitIndoorOverviewZoom,
  type OverviewViewport,
  projectIndoorOverviewAtZoom,
} from "../overviewFit";

// An independent perspective camera makes the near corners larger than far
// corners. These are synthetic building bounds, not a screen-size mock.
const corners = [-90, 90].flatMap((x) =>
  [-180, 180].map((z) => new Vector3(x, 0, z)),
);
function projector(view: OverviewViewport, pitch: number) {
  const camera = new PerspectiveCamera(
    36,
    view.width / view.height,
    0.1,
    50000,
  );
  return (zoom: number) => {
    const distance = 400 * 2 ** (17 - zoom),
      angle = (pitch * Math.PI) / 180;
    camera.position.set(
      0,
      distance * Math.cos(angle),
      distance * Math.sin(angle),
    );
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    camera.projectionMatrix.elements[8] =
      -(view.padding.left - view.padding.right) / view.width;
    camera.projectionMatrix.elements[9] =
      -(view.padding.bottom - view.padding.top) / view.height;
    return corners.map((point) => {
      const projected = point.clone().project(camera);
      return {
        x: ((projected.x + 1) * view.width) / 2,
        y: ((1 - projected.y) * view.height) / 2,
      };
    });
  };
}
function inside(view: OverviewViewport, points: { x: number; y: number }[]) {
  return points.every(
    (point) =>
      point.x >= view.padding.left + 16 &&
      point.x <= view.width - view.padding.right - 16 &&
      point.y >= view.padding.top + 16 &&
      point.y <= view.height - view.padding.bottom - 16,
  );
}

describe("indoor overview perspective fit", () => {
  it("restores the requested center after a prior probe constrained it at low zoom", () => {
    const requestedCenter = new LngLat(15, 30);
    const sourcePoints = [new LngLat(15.001, 30.002)];
    let center = requestedCenter;
    let currentZoom = 18;
    const projection = {
      setZoom(zoom: number) {
        currentZoom = zoom;
        if (zoom < 1) center = new LngLat(center.lng, 0);
      },
      setCenter(value: LngLat) {
        center = currentZoom < 1 ? new LngLat(value.lng, 0) : value;
      },
      locationToScreenPoint(point: LngLat) {
        return new Point(point.lng - center.lng, point.lat - center.lat);
      },
    };
    projectIndoorOverviewAtZoom(projection, 0, requestedCenter, sourcePoints);
    expect(center.lat).toBe(0);
    const result = projectIndoorOverviewAtZoom(
      projection,
      17,
      requestedCenter,
      sourcePoints,
    );
    expect(center).toEqual(requestedCenter);
    expect(result[0].x).toBeCloseTo(0.001);
    expect(result[0].y).toBeCloseTo(0.002);
    expect(sourcePoints[0]).toEqual(new LngLat(15.001, 30.002));
  });

  it.each([
    {
      width: 1440,
      height: 900,
      padding: { left: 470, right: 80, top: 150, bottom: 60 },
      pitch: 48,
    },
    {
      width: 390,
      height: 844,
      padding: { left: 65, right: 75, top: 160, bottom: 320 },
      pitch: 48,
    },
    {
      width: 1440,
      height: 900,
      padding: { left: 90, right: 80, top: 150, bottom: 60 },
      pitch: 0,
    },
  ])(
    "fits all near and far source corners with $width px viewport and pitch $pitch",
    (view) => {
      const project = projector(view, view.pitch);
      expect(inside(view, project(18.4))).toBe(false);
      const source = corners.map((point) => point.toArray());
      const zoom = fitIndoorOverviewZoom(view, 12, 18.4, project);
      expect(zoom).not.toBeNull();
      if (zoom === null) throw new Error("Expected a valid fit");
      expect(inside(view, project(zoom))).toBe(true);
      expect(inside(view, project(zoom + 0.01))).toBe(false);
      expect(corners.map((point) => point.toArray())).toEqual(source);
    },
  );

  it("keeps an already-fitting camera and rejects an impossible or invalid projection", () => {
    const view = {
      width: 1440,
      height: 900,
      padding: { left: 470, right: 80, top: 150, bottom: 60 },
    };
    expect(fitIndoorOverviewZoom(view, 12, 14, projector(view, 48))).toBe(14);
    expect(
      fitIndoorOverviewZoom(view, 12, 18, () => [{ x: Number.NaN, y: 20 }]),
    ).toBeNull();
    expect(
      fitIndoorOverviewZoom(
        { ...view, width: 100 },
        12,
        18,
        projector(view, 48),
      ),
    ).toBeNull();
  });
});
