import { describe, expect, it } from "vitest";
import { filterIncidentsAlongRoute, pointToPolylineDistanceM } from "@/lib/geo";
import type { DriveIncident } from "@/types/route";

describe("pointToPolylineDistanceM", () => {
  const polyline: [number, number][] = [
    [121.5, 25.0],
    [121.51, 25.0],
  ];

  it("returns 0 for points directly on the polyline", () => {
    const dist = pointToPolylineDistanceM(
      { lat: 25.0, lng: 121.505 },
      polyline,
    );
    expect(dist).toBeLessThan(1);
  });

  it("calculates perpendicular distance accurately", () => {
    // 0.001 deg lat is ~111 meters
    const dist = pointToPolylineDistanceM(
      { lat: 25.001, lng: 121.505 },
      polyline,
    );
    expect(dist).toBeGreaterThan(100);
    expect(dist).toBeLessThan(125);
  });

  it("returns Infinity for empty polyline", () => {
    expect(pointToPolylineDistanceM({ lat: 25.0, lng: 121.5 }, [])).toBe(
      Infinity,
    );
  });
});

describe("filterIncidentsAlongRoute", () => {
  // A route in Taichung: passing through 120.6946, 24.1455
  const taichungPolyline: [number, number][] = [
    [120.694, 24.145],
    [120.695, 24.146],
    [120.696, 24.147],
  ];

  const sampleIncidents: DriveIncident[] = [
    {
      incidentId: "tc-1",
      title: "道路施工",
      description: "大樁建設總部大樓新建工程",
      location: { lat: 24.1455, lng: 120.6946 }, // directly along route (~15m away)
      severity: "advisory",
    },
    {
      incidentId: "tc-far",
      title: "道路施工",
      description: "遠處施工",
      location: { lat: 24.1816, lng: 120.7025 }, // ~5.5 km away in North Taichung
      severity: "advisory",
    },
    {
      incidentId: "taipei-1",
      title: "道路施工",
      description: "台北車站道路維護",
      location: { lat: 25.0459, lng: 121.5031 }, // ~130 km away in Taipei
      severity: "advisory",
    },
    {
      incidentId: "bad-loc",
      title: "錯誤座標",
      description: "無效資料",
      location: { lat: Number.NaN, lng: 120.694 },
      severity: "advisory",
    },
  ];

  it("retains only incidents within 150m of the polyline", () => {
    const filtered = filterIncidentsAlongRoute(
      sampleIncidents,
      taichungPolyline,
      150,
    );

    expect(filtered.map((i) => i.incidentId)).toEqual(["tc-1"]);
    expect(filtered.some((i) => i.incidentId === "taipei-1")).toBe(false);
    expect(filtered.some((i) => i.incidentId === "tc-far")).toBe(false);
    expect(filtered.some((i) => i.incidentId === "bad-loc")).toBe(false);
  });

  it("handles empty or undefined inputs gracefully", () => {
    expect(filterIncidentsAlongRoute(undefined, taichungPolyline)).toEqual([]);
    expect(filterIncidentsAlongRoute(sampleIncidents, undefined)).toEqual([]);
    expect(filterIncidentsAlongRoute([], [])).toEqual([]);
  });
});
