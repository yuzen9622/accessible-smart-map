import { beforeEach, describe, expect, it } from "vitest";
import type { RouteDetailStop } from "@/lib/api/transit";
import useMapStore from "@/stores/useMapStore";
import { A11yEnum } from "@/types/index";
import type { BusLeg, ParkingNearbyItem } from "@/types/route";
import type { BusStopSearchResult } from "@/types/transit";

describe("useMapStore mobileSheetSnap", () => {
  beforeEach(() => {
    useMapStore.setState({
      mobileSheetSnap: "peek",
      sheetMode: "home",
      chatOpen: false,
    });
  });

  it("defaults to peek snap", () => {
    expect(useMapStore.getState().mobileSheetSnap).toBe("peek");
  });

  it("updates snap to full when setMobileSheetSnap is called", () => {
    useMapStore.getState().setMobileSheetSnap("full");
    expect(useMapStore.getState().mobileSheetSnap).toBe("full");
  });

  it("updates snap to half when setMobileSheetSnap is called", () => {
    useMapStore.getState().setMobileSheetSnap("half");
    expect(useMapStore.getState().mobileSheetSnap).toBe("half");
  });
});

describe("useMapStore parking state", () => {
  const dummyLot: ParkingNearbyItem = {
    type: "lot",
    _id: "lot-test-1",
    carParkId: "CP01",
    name: "測試停車場",
    city: "台北市",
    location: { type: "Point", coordinates: [121.55, 25.03] },
    importedAt: "2026-08-19T00:00:00.000Z",
  };

  beforeEach(() => {
    useMapStore.setState({
      nearbyParking: [],
      selectedParking: null,
    });
  });

  it("sets and retrieves nearby parking items", () => {
    useMapStore.getState().setNearbyParking([dummyLot]);
    expect(useMapStore.getState().nearbyParking).toHaveLength(1);
    expect(useMapStore.getState().nearbyParking[0]._id).toBe("lot-test-1");
  });

  it("toggles and selects parking item", () => {
    useMapStore.getState().setSelectedParking(dummyLot);
    expect(useMapStore.getState().selectedParking?._id).toBe("lot-test-1");

    // Clicking same item unselects
    useMapStore.getState().setSelectedParking(dummyLot);
    expect(useMapStore.getState().selectedParking).toBeNull();
  });
});

describe("useMapStore transit bus state", () => {
  const dummyStop: BusStopSearchResult = {
    stopUid: "TPE-1001",
    stopName: "台北車站",
    city: "Taipei",
    coordinates: [121.517, 25.047],
    routes: ["307", "299", "忠孝幹線"],
  };

  const dummyRouteStop: RouteDetailStop = {
    seq: 1,
    name: "捷運台北車站",
    lat: 25.047,
    lng: 121.517,
    estimateMinutes: 3,
    statusLabel: "即將到站",
  };

  beforeEach(() => {
    useMapStore.setState({
      nearbyBusStops: [],
      busRouteStops: [],
      selectedBusStop: null,
    });
  });

  it("sets nearby bus stops and route stops", () => {
    useMapStore.getState().setNearbyBusStops([dummyStop]);
    expect(useMapStore.getState().nearbyBusStops).toHaveLength(1);
    expect(useMapStore.getState().nearbyBusStops[0].stopName).toBe("台北車站");

    useMapStore.getState().setBusRouteStops([dummyRouteStop]);
    expect(useMapStore.getState().busRouteStops).toHaveLength(1);
    expect(useMapStore.getState().busRouteStops[0].name).toBe("捷運台北車站");
  });

  it("selects a bus stop", () => {
    useMapStore.getState().setSelectedBusStop(dummyStop);
    expect(useMapStore.getState().selectedBusStop).toEqual(dummyStop);

    useMapStore.getState().setSelectedBusStop(dummyRouteStop);
    expect(useMapStore.getState().selectedBusStop).toEqual(dummyRouteStop);
  });
});

describe("useMapStore a11y filter state", () => {
  beforeEach(() => {
    useMapStore.setState({
      selectedA11yTypes: new Set(),
      a11yDrawerOpen: false,
    });
  });

  it("toggles a11y types in set", () => {
    useMapStore.getState().toggleA11yType(A11yEnum.ELEVATOR);
    expect(
      useMapStore.getState().selectedA11yTypes.has(A11yEnum.ELEVATOR),
    ).toBe(true);
    expect(useMapStore.getState().a11yDrawerOpen).toBe(true);

    useMapStore.getState().toggleA11yType(A11yEnum.ELEVATOR);
    expect(
      useMapStore.getState().selectedA11yTypes.has(A11yEnum.ELEVATOR),
    ).toBe(false);
  });
});

describe("useMapStore activeBusLeg state", () => {
  beforeEach(() => {
    useMapStore.setState({
      activeBusLeg: null,
      liveBusPositions: [],
    });
  });

  it("sets activeBusLeg and clears liveBusPositions", () => {
    useMapStore.setState({
      liveBusPositions: [
        {
          lat: 25.04,
          lng: 121.51,
          plateNumb: "EAA-123",
          speed: 20,
          direction: 0,
          isLowFloor: "1",
          hasLiftOrRamp: "1",
          gpsTime: "2026-09-03T10:00:00Z",
          vehicleClass: "1",
          routeName: "307",
          city: "Taipei",
          isTarget: true,
          estimateTime: 3,
        },
      ],
    });

    const activeLeg = {
      key: "0:1:307:0:台北車站",
      leg: {
        type: "BUS" as const,
        routeName: "307",
        departureStop: "台北車站",
        arrivalStop: "板橋公車站",
        direction: 0 as const,
        polyline: [[121.51, 25.04]],
      } as unknown as BusLeg,
    };

    useMapStore.getState().setActiveBusLeg(activeLeg);
    expect(useMapStore.getState().activeBusLeg).toEqual(activeLeg);
    expect(useMapStore.getState().liveBusPositions).toEqual([]);
  });

  it("clears activeBusLeg when set to null", () => {
    useMapStore.getState().setActiveBusLeg(null);
    expect(useMapStore.getState().activeBusLeg).toBeNull();
    expect(useMapStore.getState().liveBusPositions).toEqual([]);
  });
});

describe("useMapStore route session lifecycle", () => {
  const A_ROUTE = { routeName: "測試路線", totalMinutes: 23 };
  const A_PLACE = {
    kind: "coordinate",
    address: "台北車站",
    position: { lat: 25.0478, lng: 121.5319 },
  };

  const seedSession = () =>
    useMapStore.setState({
      sheetMode: "route",
      activeRailPanel: "search",
      routeSubPanel: "none",
      isNavigating: false,
      origin: A_PLACE as never,
      originName: "起點",
      destination: A_PLACE as never,
      destinationName: "台北車站",
      computeRoutes: [A_ROUTE] as never,
      selectRoute: { index: 0, route: A_ROUTE } as never,
      routeWaypoints: [{ lat: 25, lng: 121 }],
      routeInfoShow: true,
      routeA11y: [{} as never],
      sosNavActive: true,
    });

  it("endRouteSession clears origin/destination too, not just the route", () => {
    // The bug this replaces: four hand-copied clear lists each nulled
    // computeRoutes/selectRoute and none of them touched destination, so the
    // map's destination pin (drawn from `searchPlace ?? destination`)
    // survived every panel switch.
    seedSession();
    useMapStore.getState().endRouteSession();
    const s = useMapStore.getState();
    expect(s.destination).toBeNull();
    expect(s.destinationName).toBe("");
    expect(s.origin).toBeNull();
    expect(s.originName).toBe("");
    expect(s.computeRoutes).toBeNull();
    expect(s.selectRoute).toBeNull();
    expect(s.routeWaypoints).toEqual([]);
    expect(s.routeInfoShow).toBe(false);
    expect(s.routeA11y).toEqual([]);
    expect(s.sosNavActive).toBe(false);
  });

  it("endRouteSession leaves the place-detail surface alone", () => {
    // The pill's ✕ can be pressed while the user is reading an unrelated
    // place; blanking infoShow/searchPlace would empty the panel they're
    // actually looking at.
    seedSession();
    const place = { kind: "coordinate", address: "別的地方" };
    useMapStore.setState({
      sheetMode: "place",
      searchPlace: place as never,
      infoShow: { isOpen: true, kind: "coordinate" } as never,
    });
    useMapStore.getState().endRouteSession();
    expect(useMapStore.getState().searchPlace).toBe(place);
    expect(useMapStore.getState().infoShow.isOpen).toBe(true);
  });

  it("resumeRouteSession returns to the results list when routes exist", () => {
    seedSession();
    useMapStore.setState({ sheetMode: "home", routeSubPanel: "hazard" });
    useMapStore.getState().resumeRouteSession();
    expect(useMapStore.getState().sheetMode).toBe("route");
    // A sub-page the user opened from a previous visit must not hijack the
    // first paint on the way back in.
    expect(useMapStore.getState().routeSubPanel).toBe("none");
  });

  it("resumeRouteSession returns to the form when only a destination was picked", () => {
    seedSession();
    useMapStore.setState({
      sheetMode: "home",
      computeRoutes: null,
      selectRoute: null,
    });
    useMapStore.getState().resumeRouteSession();
    expect(useMapStore.getState().sheetMode).toBe("plan");
  });

  it("switching the rail panel leaves the session untouched", () => {
    // The whole point of the change: a panel switch is no longer destructive,
    // so the route stays planned and the pill is the way back to it.
    seedSession();
    useMapStore.getState().setSheetMode("home");
    useMapStore.getState().setActiveRailPanel("bus");
    const s = useMapStore.getState();
    expect(s.computeRoutes).not.toBeNull();
    expect(s.selectRoute).not.toBeNull();
    expect(s.destination).not.toBeNull();
  });

  it("leaving navigation for a non-route panel still ends the session", () => {
    seedSession();
    useMapStore.setState({ isNavigating: true, sheetMode: "navigation" });
    useMapStore.getState().requestNavExit("bus");
    useMapStore.getState().confirmNavExit();
    const s = useMapStore.getState();
    expect(s.isNavigating).toBe(false);
    expect(s.activeRailPanel).toBe("bus");
    expect(s.destination).toBeNull();
    expect(s.computeRoutes).toBeNull();
  });

  it("leaving navigation back to the plan keeps the session alive", () => {
    seedSession();
    useMapStore.setState({ isNavigating: true, sheetMode: "navigation" });
    useMapStore.getState().requestNavExit("plan");
    useMapStore.getState().confirmNavExit();
    const s = useMapStore.getState();
    expect(s.sheetMode).toBe("plan");
    expect(s.destination).not.toBeNull();
  });

  it("ending navigation normally lands on the route list with no sub-page", () => {
    seedSession();
    useMapStore.setState({ routeSubPanel: "explanation" });
    useMapStore.getState().setIsNavigating(true);
    useMapStore.getState().setIsNavigating(false);
    const s = useMapStore.getState();
    expect(s.sheetMode).toBe("route");
    expect(s.routeSubPanel).toBe("none");
  });
});
