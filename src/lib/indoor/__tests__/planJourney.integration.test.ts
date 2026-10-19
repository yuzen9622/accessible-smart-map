import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import useMapStore from "@/stores/useMapStore";
import type { PlaceDetail } from "@/types";
import type {
  AccessibleRoute,
  AccessibleRouteRequest,
  WalkLeg,
} from "@/types/route";
import { toVenuePlaceDetail } from "../catalog";
import { planVenueJourney } from "../planJourney";
import type { LocalIndoorModel } from "../types";

const config = vi.hoisted(() => ({ endpoint: "" }));
// Only the base URL changes. The planner, API wrapper and fetch all run for real.
vi.mock("@/lib/config", async (original) => ({
  ...(await original<typeof import("@/lib/config")>()),
  get END_POINT() {
    return config.endpoint;
  },
}));

interface RecordedRequest {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: AccessibleRouteRequest;
  responseClosed?: boolean;
}

function syntheticModel(): LocalIndoorModel {
  return {
    schemaVersion: 1,
    venueId: "synthetic-campus",
    name: "Synthetic campus",
    origin: [10, 10],
    source: { sha256: "synthetic-revision", generatedAt: "test", warnings: [] },
    building: {
      id: "synthetic-building",
      name: "Synthetic building",
      footprint: [],
      floorHeightM: 4,
      heightStatus: "estimated",
      geometryStatus: "schematic",
      levels: [{ ordinal: 0, ref: "1F", elevationM: 0 }],
    },
    preview: { levels: [0], gatePlaceIds: ["source-gate"] },
    nodes: [
      {
        id: "gate-node",
        point: [0, 0, 0],
        ordinal: null,
        levelRef: null,
        kind: "entrance",
      },
      {
        id: "room-node",
        point: [20, 0, 0],
        ordinal: 0,
        levelRef: "1F",
        kind: "place",
      },
    ],
    edges: [
      {
        id: "source-path",
        from: "gate-node",
        to: "room-node",
        kind: "corridor",
        lengthM: 20,
        wheelchair: "yes",
        ramp: false,
        heightPending: false,
        geometryStatus: "schematic",
        heightStatus: "estimated",
        tags: {},
        osmRef: "synthetic-path",
      },
    ],
    connections: [],
    features: [],
    walls: [],
    places: [
      {
        id: "source-gate",
        name: "Source gate",
        kind: "entrance",
        buildingId: null,
        nodeId: "gate-node",
        point: [0, 0, 0],
        levelRef: null,
        routeEndpoint: "place",
        doorKnown: false,
        arrivalOnly: false,
        tags: {},
      },
      {
        id: "room",
        name: "Synthetic room",
        kind: "room",
        nodeId: "room-node",
        point: [20, 0, 0],
        levelRef: "1F",
        routeEndpoint: "corridor",
        doorKnown: false,
        arrivalOnly: true,
        tags: {},
      },
    ],
  };
}

const origin: PlaceDetail = {
  kind: "coordinate",
  address: "Original selected origin",
  position: { lat: 9.99, lng: 9.98 },
};

/** Contract-sized HTTP stand-in; POSTMAN_SIMULATION_URL runs these same checks
 * against an independently started local Postman simulation instead. */
function localContractServer() {
  const requests = new Map<string, RecordedRequest[]>();
  return createServer(async (req, res) => {
    const [scenario, ...segments] = (req.url ?? "").slice(1).split("/");
    const path = `/${segments.join("/")}`;
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString();
    res.setHeader("Content-Type", "application/json");
    if (path === "/__reset") {
      requests.set(scenario, []);
      res.end("{}");
      return;
    }
    if (path === "/__requests") {
      res.end(JSON.stringify(requests.get(scenario) ?? []));
      return;
    }
    if (path !== "/api/v1/a11y/accessible-route" || req.method !== "POST") {
      res.statusCode = 501;
      res.end(JSON.stringify({ ok: false, message: "Unmodeled call" }));
      return;
    }
    const body = JSON.parse(raw) as AccessibleRouteRequest;
    const captured: RecordedRequest = {
      method: req.method,
      path,
      headers: req.headers,
      body,
    };
    requests.set(scenario, [...(requests.get(scenario) ?? []), captured]);
    if (scenario === "hanging") {
      res.on("close", () => {
        captured.responseClosed = true;
      });
      return;
    }
    if (scenario === "html-error") {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/html");
      res.end("<html><body>Upstream unavailable</body></html>");
      return;
    }
    if (scenario === "json-error") {
      res.statusCode = 503;
      res.end(
        JSON.stringify({
          ok: false,
          code: 503,
          message: "Route unavailable",
          data: { reason: "ROUTE_PLANNING_FAILED" },
        }),
      );
      return;
    }
    if (scenario === "vehicle-tail-partial" && body.travelMode === "walk") {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ ok: false, message: "Injected candidate failure" }),
      );
      return;
    }
    const from = body.origin as { latitude: number; longitude: number };
    const to = body.destination as { latitude: number; longitude: number };
    const firstLng =
      from.longitude +
      (scenario === "start-gap" || scenario === "origin-and-arrival-gap"
        ? 0.001
        : scenario === "nearby-road-start"
          ? 0.00013
          : 0);
    const finalLng =
      to.longitude +
      (scenario === "gap" ||
      (scenario === "walking-tail" && from.longitude === origin.position.lng) ||
      (["alternate-gate", "origin-and-arrival-gap"].includes(scenario) &&
        to.longitude === 10)
        ? 0.001
        : 0);
    const walk: WalkLeg = {
      type: "WALK",
      from: "Original origin",
      to: "Source gate",
      distanceM: 100,
      minutesEst: 10,
      a11yFacilities: [],
      polyline: [
        [firstLng, from.latitude],
        [finalLng, to.latitude],
      ],
      steps: [
        {
          relativeDirection: "DEPART",
          absoluteDirection: "EAST",
          streetName: "Synthetic path",
          bogusName: false,
          area: false,
          stairs: scenario === "stairs" || scenario === "mixed-stairs",
          steepSlope: false,
          distanceM: 100,
          location: [firstLng, from.latitude],
        },
      ],
    };
    const route: AccessibleRoute = {
      routeId: "synthetic-http-route",
      routeToken:
        body.travelMode === "walk" &&
        !(scenario === "walking-tail" && from.longitude === origin.position.lng)
          ? "walk-token"
          : "travel-token",
      routeName: "Source gate route",
      totalMinutes: 10,
      transferCount: 0,
      accessibilityHighlights: [],
      legs: [walk],
    };
    if (scenario === "malformed-tail")
      walk.polyline[1] = [to.longitude] as unknown as [number, number];
    if (scenario.startsWith("vehicle-tail") && body.travelMode !== "walk") {
      route.legs = [
        {
          type: body.travelMode === "motorcycle" ? "MOTORCYCLE" : "DRIVE",
          from: "Original origin",
          to: "Roadside arrival",
          distanceM: 1000,
          durationMinutes: 5,
          polyline: [
            [from.longitude, from.latitude],
            [to.longitude + 0.00008, to.latitude],
          ],
        },
      ] as AccessibleRoute["legs"];
    }
    if (scenario === "vehicle-tail-gap" && body.travelMode === "walk")
      walk.polyline[0] = [from.longitude + 0.0002, from.latitude];
    if (scenario === "vehicle-tail-stairs" && body.travelMode === "walk")
      walk.steps = walk.steps?.map((step) => ({ ...step, stairs: true }));
    if (scenario === "stairs-warning")
      route.warningDetails = [
        {
          index: 0,
          code: "ROUTE_STAIRS_CONSTRAINT_UNSATISFIED",
          message: "Constraint not met",
        },
      ];
    if (scenario === "stairs-legacy")
      route.warnings = [
        "目前候選路線仍包含無坡道樓梯，無法完全滿足避開樓梯條件",
      ];
    if (scenario === "unknown-stairs") delete walk.steps;
    if (scenario === "zero-length-walk")
      route.legs.unshift({
        ...walk,
        distanceM: 0,
        polyline: [],
        steps: [],
      });
    if (scenario === "transit-stairs-fields")
      route.legs.push({
        type: "BUS",
        routeName: "Synthetic bus",
        departureStop: "Source gate",
        arrivalStop: "Source gate",
        direction: 0,
        waitInfo: { time: 0, source: "schedule" },
        estimatedWaitMinutes: 0,
        polyline: [[finalLng, to.latitude]],
        departureStopA11y: [],
        arrivalStopA11y: [],
      });
    const routes = [route];
    if (scenario === "vehicle-tail-partial")
      routes.unshift({
        ...route,
        routeId: "connected-candidate",
        routeToken: "connected-token",
        legs: [walk],
      });
    if (scenario === "mixed-stairs")
      routes.push({
        ...route,
        routeId: "synthetic-clear-route",
        legs: [
          {
            ...walk,
            steps: walk.steps?.map((step) => ({ ...step, stairs: false })),
          },
        ],
      });
    res.end(
      JSON.stringify({
        ok: true,
        code: 200,
        message: "Success",
        data: {
          origin: { lat: from.latitude, lng: from.longitude },
          destination: { lat: to.latitude, lng: to.longitude },
          city: "Synthetic city",
          travelMode: body.travelMode,
          routes,
        },
      }),
    );
  });
}

describe("venue journey real HTTP integration", () => {
  let server: Server | undefined;
  let baseUrl: string;
  let model: LocalIndoorModel;

  beforeAll(async () => {
    const external = process.env.POSTMAN_SIMULATION_URL;
    if (external) {
      const parsed = new URL(external);
      if (parsed.hostname !== "127.0.0.1" || parsed.protocol !== "http:")
        throw new Error("Integration stand-in must be loopback HTTP");
      baseUrl = external.replace(/\/$/, "");
      return;
    }
    server = localContractServer();
    await new Promise<void>((resolve) =>
      server?.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No local port");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  });
  beforeEach(async () => {
    model = syntheticModel();
    useMapStore.setState(useMapStore.getInitialState(), true);
    await selectScenario("success");
  });
  afterEach(() => vi.restoreAllMocks());

  async function selectScenario(scenario: string) {
    config.endpoint = `${baseUrl}/${scenario}`;
    const response = await fetch(`${config.endpoint}/__reset`, {
      method: "POST",
    });
    expect(response.ok).toBe(true);
  }
  async function recorded(): Promise<RecordedRequest[]> {
    return (await fetch(`${config.endpoint}/__requests`)).json();
  }
  function plan(
    mode: "normal" | "wheelchair" = "normal",
    signal?: AbortSignal,
  ) {
    return planVenueJourney({
      models: [model],
      origin,
      destination: toVenuePlaceDetail(model, model.places[1]),
      mode,
      verticalPreference: "stairs",
      travelMode: "walk",
      language: "en",
      signal,
    });
  }

  it("preserves the real origin and sends only the source gate to the outdoor API", async () => {
    const result = await plan();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.journey.outdoor?.origin).toEqual(origin);
    expect(result.journey.outdoor?.arrival.placeId).toBe("source-gate");
    expect(result.journey.to.placeId).toBe("room");
    expect(result.journey.route.points.at(-1)).toEqual([20, 0, 0]);
    expect(result.journey.outdoor?.routes[0].legs[0].displayLanguage).toBe(
      "en",
    );
    const requests = await recorded();
    expect(requests).toHaveLength(1);
    expect(requests[0].body).toEqual({
      origin: { latitude: 9.99, longitude: 9.98 },
      destination: { latitude: 10, longitude: 10 },
      mode: "normal",
      travelMode: "walk",
      language: "en",
    });
    expect(requests[0].headers.authorization).toBeUndefined();
    expect(requests[0].headers.cookie).toBeUndefined();
    expect(JSON.stringify(requests[0].body)).not.toMatch(
      /venueId|placeId|sourceVersion|Synthetic room/,
    );
    // Planning returns a candidate; only a current form request may publish it.
    expect(useMapStore.getState().venueJourney).toBeNull();
  });

  it("uses another authored gate when the nearest arrival does not connect", async () => {
    model.preview?.gatePlaceIds?.push("second-gate");
    model.nodes.push({
      id: "second-gate-node",
      point: [100, 0, 0],
      ordinal: null,
      levelRef: null,
      kind: "entrance",
    });
    model.places.push({
      ...model.places[0],
      id: "second-gate",
      name: "Second gate",
      nodeId: "second-gate-node",
      point: [100, 0, 0],
    });
    model.edges.push({
      ...model.edges[0],
      id: "second-path",
      from: "second-gate-node",
      lengthM: 80,
    });
    await selectScenario("alternate-gate");
    const result = await plan("wheelchair");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.journey.outdoor?.arrival.placeId).toBe("second-gate");
    expect(result.journey.outdoor?.origin).toEqual(origin);
    expect(result.journey.from.placeId).toBe("second-gate");
    expect(await recorded()).toHaveLength(3);
    expect(result.journey.route.points[0]).toEqual([100, 0, 0]);

    await selectScenario("origin-and-arrival-gap");
    expect(await plan()).toMatchObject({ ok: false, reason: "START_GAP" });
  });

  it("retains the selected off-road origin and the provider's nearby road start as distinct positions", async () => {
    await selectScenario("nearby-road-start");
    const result = await plan();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.journey.outdoor?.origin).toEqual(origin);
    expect(result.journey.outdoor?.routes[0].legs[0].polyline[0]).toEqual([
      origin.position.lng + 0.00013,
      origin.position.lat,
    ]);
    expect((await recorded())[0].body.origin).toEqual({
      latitude: origin.position.lat,
      longitude: origin.position.lng,
    });
    expect(result.journey.outdoor?.routes[0].legs[0].polyline).toHaveLength(2);
  });

  it("does not replace an unavailable indoor API with the valid local graph", async () => {
    const result = await planVenueJourney({
      models: [model],
      routeProvider: "backend",
      origin: toVenuePlaceDetail(model, model.places[0]),
      destination: toVenuePlaceDetail(model, model.places[1]),
      mode: "wheelchair",
    });
    expect(result).toMatchObject({ ok: false, reason: "BACKEND_UNAVAILABLE" });
    expect(useMapStore.getState().venueJourney).toBeNull();
    expect(await recorded()).toHaveLength(0);
  });

  it("keeps wheelchair preference on both halves without falling back to stairs", async () => {
    const result = await plan("wheelchair");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.journey.verticalPreference).toBe("elevator");
    expect(result.journey.route.kinds).not.toContain("steps");
    expect((await recorded())[0].body.mode).toBe("wheelchair");
  });

  it.each([
    ["stairs", "WHEELCHAIR_STAIRS"],
    ["stairs-warning", "WHEELCHAIR_STAIRS"],
    ["stairs-legacy", "WHEELCHAIR_STAIRS"],
    ["unknown-stairs", "NO_ACCESSIBLE_OUTDOOR_ROUTE"],
  ])(
    "rejects HTTP 200 %s for wheelchairs without changing ordinary walking",
    async (scenario, reason) => {
      const destination = toVenuePlaceDetail(model, model.places[1]);
      useMapStore.getState().setOrigin(origin);
      useMapStore.getState().setDestination(destination);
      await selectScenario(scenario);
      expect(await plan("wheelchair")).toMatchObject({ ok: false, reason });
      expect(useMapStore.getState().venueJourney).toBeNull();
      expect(useMapStore.getState().origin).toEqual(origin);
      expect(useMapStore.getState().destination).toEqual(destination);
      expect((await plan("normal")).ok).toBe(true);
      expect(await recorded()).toHaveLength(2);
    },
  );

  it("keeps only the wheelchair candidate whose walking steps explicitly exclude stairs", async () => {
    await selectScenario("mixed-stairs");
    const result = await plan("wheelchair");
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(
        result.journey.outdoor?.routes.map((route) => route.routeId),
      ).toEqual(["synthetic-clear-route"]);
    const ordinary = await plan("normal");
    expect(ordinary.ok && ordinary.journey.outdoor?.routes.length).toBe(2);
  });

  it.each(["zero-length-walk", "transit-stairs-fields"])(
    "does not require non-walking stair fields or nonexistent walking steps (%s)",
    async (scenario) => {
      await selectScenario(scenario);
      expect((await plan("wheelchair")).ok).toBe(true);
    },
  );

  it.each(["elderly", "visual_impaired"] as const)(
    "preserves %s for both route halves and enforces elevators for indoor floor changes",
    async (mode) => {
      for (const verticalPreference of [undefined, "auto"] as const) {
        const result = await planVenueJourney({
          models: [model],
          origin,
          destination: toVenuePlaceDetail(model, model.places[1]),
          mode,
          verticalPreference,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.journey.mode).toBe(mode);
        expect(result.journey.verticalPreference).toBe("elevator");
      }
      expect((await recorded()).map((request) => request.body.mode)).toEqual([
        mode,
        mode,
      ]);
      const local = await planVenueJourney({
        models: [model],
        origin: toVenuePlaceDetail(model, model.places[0]),
        destination: toVenuePlaceDetail(model, model.places[1]),
        mode,
        verticalPreference: "auto",
      });
      expect(local.ok && local.journey.mode).toBe(mode);
      expect(await recorded()).toHaveLength(2);
    },
  );

  it.each(["drive", "motorcycle"] as const)(
    "preserves %s and requests a real walking approach without joining tokens or drawing a straight gap",
    async (travelMode) => {
      await selectScenario("vehicle-tail");
      const result = await planVenueJourney({
        models: [model],
        origin,
        destination: toVenuePlaceDetail(model, model.places[1]),
        mode: "normal",
        travelMode,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const outdoor = result.journey.outdoor;
      expect(outdoor?.travelMode).toBe(travelMode);
      expect(outdoor?.routes[0].legs).toHaveLength(1);
      expect(outdoor?.routes[0].routeToken).toBe("travel-token");
      expect(outdoor?.approachRoutes?.["travel-token"].routeToken).toBe(
        "walk-token",
      );
      const requests = await recorded();
      expect(requests.map((r) => r.body.travelMode)).toEqual([
        travelMode,
        "walk",
      ]);
      expect(requests[1].body.origin).toEqual({
        latitude: 10,
        longitude: 10.00008,
      });
      expect(requests[1].body.destination).toEqual(
        requests[0].body.destination,
      );
    },
  );
  it.each(["walk", "transit"] as const)(
    "connects a %s route's final walking segment using a separately routed path",
    async (travelMode) => {
      await selectScenario("walking-tail");
      const result = await planVenueJourney({
        models: [model],
        origin,
        destination: toVenuePlaceDetail(model, model.places[1]),
        mode: "normal",
        travelMode,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const outdoor = result.journey.outdoor;
      const primary = outdoor?.routes[0];
      const approach = primary?.routeToken
        ? outdoor?.approachRoutes?.[primary.routeToken]
        : undefined;
      expect(primary?.legs.at(-1)?.polyline.at(-1)).toEqual([10.001, 10]);
      expect(approach?.legs[0].polyline).toEqual([
        [10.001, 10],
        [10, 10],
      ]);
      expect(primary?.routeToken).not.toEqual(approach?.routeToken);
      expect(outdoor?.travelMode).toBe(travelMode);
      expect(
        (await recorded()).map((request) => request.body.travelMode),
      ).toEqual([travelMode, "walk"]);
    },
  );
  it("does not request a walking connector from malformed provider coordinates", async () => {
    await selectScenario("malformed-tail");
    expect(await plan()).toMatchObject({ ok: false, reason: "ARRIVAL_GAP" });
    expect(await recorded()).toHaveLength(1);
  });
  it.each(["vehicle-tail-gap", "vehicle-tail-stairs"])(
    "does not publish a wheelchair journey with an unconnected or stair-containing final approach (%s)",
    async (scenario) => {
      await selectScenario(scenario);
      const result = await planVenueJourney({
        models: [model],
        origin,
        destination: toVenuePlaceDetail(model, model.places[1]),
        mode: "wheelchair",
        travelMode: "drive",
      });
      expect(result.ok).toBe(false);
    },
  );

  it("retains a valid candidate when another candidate's walking-tail request fails", async () => {
    await selectScenario("vehicle-tail-partial");
    const result = await planVenueJourney({
      models: [model],
      origin,
      destination: toVenuePlaceDetail(model, model.places[1]),
      mode: "normal",
      travelMode: "drive",
    });
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.journey.outdoor?.routes.map((r) => r.routeId)).toEqual([
        "connected-candidate",
      ]);
  });

  it("cancels a hanging real HTTP request without publishing a journey", async () => {
    await selectScenario("hanging");
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    const pending = plan("normal", controller.signal);
    await vi.waitFor(async () => expect(await recorded()).toHaveLength(1));
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, reason: "ABORTED" });
    expect(useMapStore.getState().venueJourney).toBeNull();
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
    // A proxy may keep its upstream socket; the direct loopback server also
    // verifies that the client actually closed HTTP rather than just ignoring it.
    if (!process.env.POSTMAN_SIMULATION_URL)
      await vi.waitFor(async () =>
        expect((await recorded())[0].responseClosed).toBe(true),
      );
  });

  it("aborts a hanging request at the production 15-second deadline", async () => {
    await selectScenario("hanging");
    const realSetTimeout = globalThis.setTimeout;
    // Accelerate only our 15-second deadline; real HTTP and all client timers
    // continue to run normally. No timeout option is exposed to product callers.
    const timeout = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation(((...args: Parameters<typeof setTimeout>) =>
        realSetTimeout(
          args[0],
          args[1] === 15_000 ? 100 : args[1],
          ...args.slice(2),
        )) as typeof setTimeout);
    const result = await plan();
    expect(result).toMatchObject({ ok: false, reason: "OUTDOOR_TIMEOUT" });
    expect(timeout).toHaveBeenCalledWith(expect.any(Function), 15_000);
    expect(await recorded()).toHaveLength(1);
    expect(useMapStore.getState().venueJourney).toBeNull();
    if (!process.env.POSTMAN_SIMULATION_URL)
      await vi.waitFor(async () =>
        expect((await recorded())[0].responseClosed).toBe(true),
      );
  });

  it("does not send a request when its caller has already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await plan("normal", controller.signal)).toMatchObject({
      ok: false,
      reason: "ABORTED",
    });
    expect(await recorded()).toHaveLength(0);
  });

  it.each([
    ["html-error", "OUTDOOR_UNAVAILABLE"],
    ["json-error", "OUTDOOR_UNAVAILABLE"],
    ["gap", "ARRIVAL_GAP"],
    ["start-gap", "START_GAP"],
  ])(
    "does not publish a journey after %s or restore a cleared old result",
    async (scenario, reason) => {
      const previous = await plan();
      expect(previous.ok).toBe(true);
      if (!previous.ok) return;
      useMapStore.getState().setVenueJourney(previous.journey);
      const originalDraft = {
        origin: useMapStore.getState().origin,
        destination: useMapStore.getState().destination,
      };
      // The existing form action clears old results before a new attempt.
      useMapStore.getState().setVenueJourney(null);
      await selectScenario(scenario);
      const result = await plan();
      expect(result).toMatchObject({ ok: false, reason });
      expect(await recorded()).toHaveLength(scenario === "gap" ? 2 : 1);
      expect((await recorded())[0].body.origin).toEqual({
        latitude: origin.position.lat,
        longitude: origin.position.lng,
      });
      expect(useMapStore.getState().venueJourney).toBeNull();
      expect(useMapStore.getState().origin).toEqual(originalDraft.origin);
      expect(useMapStore.getState().destination).toEqual(
        originalDraft.destination,
      );
    },
  );

  it("refuses missing gate connectivity before any outdoor request", async () => {
    model.edges = [];
    expect(await plan()).toMatchObject({
      ok: false,
      reason: "NO_GATE_CONNECTION",
    });
    expect(await recorded()).toHaveLength(0);
  });

  it("keeps source gate to classroom planning local", async () => {
    const result = await planVenueJourney({
      models: [model],
      origin: toVenuePlaceDetail(model, model.places[0]),
      destination: toVenuePlaceDetail(model, model.places[1]),
      mode: "normal",
    });
    expect(result.ok).toBe(true);
    expect(await recorded()).toHaveLength(0);
  });
});
