export function lineRoadPlanFixture(mode: "drive" | "motorcycle" = "drive") {
  const polyline = [
    [121.56, 25.03],
    [121.517, 25.0478],
  ];
  return {
    ok: true,
    routeContractVersion: 1,
    planId: "2a0f8f9c-1e14-4a60-bc57-74790655cf71",
    selectedRouteId: `${mode}-0`,
    origin: { lat: 25.03, lng: 121.56, name: "起點" },
    destination: { lat: 25.0478, lng: 121.517, name: "終點" },
    city: "Taipei",
    travelMode: mode,
    mode: "normal",
    transitPreference: "none",
    effectivePreferences: {
      mode: "normal",
      travelMode: mode,
      transitPreference: "none",
      maxTransfers: 2,
      avoidStairs: false,
      requireElevator: false,
      needsAccessibleToilet: false,
      needsHandrail: false,
    },
    routes: [
      {
        routeId: `${mode}-0`,
        routeToken: "trusted-road-route",
        routeName: mode === "drive" ? "開車路線" : "機車路線",
        totalMinutes: 12,
        transferCount: 0,
        accessibilityHighlights: [],
        legs: [
          {
            type: mode === "drive" ? "DRIVE" : "MOTORCYCLE",
            from: { lat: 25.03, lng: 121.56 },
            to: { lat: 25.0478, lng: 121.517 },
            distanceM: 3900,
            durationMin: 12,
            polyline,
            steps: [
              {
                instruction: "直行",
                distanceM: 3900,
                durationMin: 12,
                polyline,
              },
            ],
            maneuvers: [
              {
                instruction: "直行",
                type: 1,
                lengthKm: 3.9,
                timeSec: 720,
                beginShapeIndex: 0,
                endShapeIndex: 1,
                streetNames: ["市民大道"],
                highway: false,
                stairs: false,
              },
            ],
            trafficSegments: [
              {
                fromIndex: 0,
                toIndex: 1,
                trafficLevel: "unknown",
                congestionLevel: -99,
              },
            ],
          },
        ],
      },
    ],
  };
}
