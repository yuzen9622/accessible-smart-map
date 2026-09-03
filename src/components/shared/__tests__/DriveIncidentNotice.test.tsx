import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/zh-TW",
  redirect: () => {},
}));
vi.mock("@/stores/useAuthStore", () => ({
  default: () => ({
    userConfig: { language: "zh-TW" },
    updateUserConfig: vi.fn(),
  }),
}));

import { DriveIncidentNotice } from "@/components/shared/RouteCard/DriveIncidentNotice";
import type { DriveIncident } from "@/types/route";

describe("DriveIncidentNotice component", () => {
  const polyline: [number, number][] = [
    [121.5, 25.0],
    [121.51, 25.0],
    [121.52, 25.0],
  ];

  const nearbyIncident: DriveIncident = {
    incidentId: "inc-nearby",
    title: "道路施工",
    description: "大樁建設總部大樓新建工程",
    severity: "advisory",
    location: { lat: 25.0, lng: 121.505 }, // along route
  };

  const farIncident: DriveIncident = {
    incidentId: "inc-far",
    title: "道路施工",
    description: "遠方施工",
    severity: "advisory",
    location: { lat: 24.145, lng: 120.694 }, // ~130km away
  };

  it("returns null if no incidents are within 150m of the polyline", () => {
    const html = renderToStaticMarkup(
      React.createElement(DriveIncidentNotice, {
        incidents: [farIncident],
        polyline,
      }),
    );
    expect(html).toBe("");
  });

  it("renders notice header and count when an incident is along the route", () => {
    const html = renderToStaticMarkup(
      React.createElement(DriveIncidentNotice, {
        incidents: [nearbyIncident, farIncident],
        polyline,
      }),
    );

    expect(html).toContain("沿線道路施工 (1 處)");
    expect(html).toContain("大樁建設總部大樓新建工程");
    expect(html).not.toContain("遠方施工");
  });

  it("indicates road closure when severity is closure", () => {
    const closureIncident: DriveIncident = {
      ...nearbyIncident,
      severity: "closure",
      title: "道路施工",
    };

    const html = renderToStaticMarkup(
      React.createElement(DriveIncidentNotice, {
        incidents: [closureIncident],
        polyline,
      }),
    );

    expect(html).toContain("道路封閉");
  });
});
