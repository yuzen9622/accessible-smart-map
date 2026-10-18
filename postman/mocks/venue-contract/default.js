// Local contract simulation only. Geometry and routes are synthetic, never live evidence.
const http = require("node:http");
const fixture = require("../../../src/lib/indoor/__tests__/fixtures/venue-contract.json");
http
  .createServer(async (req, res) => {
    res.setHeader(
      "Access-Control-Allow-Origin",
      req.headers.origin || "http://localhost:3017",
    );
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    const send = (code, data, reason) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: code === 200,
          code,
          status: code === 200 ? "success" : "error",
          message: reason || "OK",
          data: reason ? { reason, ...data } : data,
        }),
      );
    };
    const path = new URL(req.url, "http://localhost").pathname.replace(
      /\/$/,
      "",
    );
    if (req.method === "GET" && path === "/api/v1/a11y/venues")
      return send(200, [fixture.detail]);
    if (req.method === "GET" && path === "/api/v1/a11y/venues/nutc-sanmin")
      return send(200, fixture.detail);
    if (
      req.method === "POST" &&
      path === "/api/v1/a11y/venues/nutc-sanmin/route"
    ) {
      let body = req.body;
      if (!body) {
        let raw = "";
        for await (const chunk of req) raw += chunk;
        try {
          body = JSON.parse(raw);
        } catch {
          return send(400, {}, "INVALID_REQUEST");
        }
      }
      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch {
          return send(400, {}, "INVALID_REQUEST");
        }
      }
      if (
        Object.keys(body).some(
          (k) => !["fromPlaceId", "toPlaceId", "mode", "language"].includes(k),
        ) ||
        !["wheelchair", "normal", "elderly", "visual_impaired"].includes(
          body.mode,
        )
      )
        return send(400, {}, "INVALID_REQUEST");
      if (
        ![body.fromPlaceId, body.toPlaceId].every((id) =>
          fixture.detail.places.some((p) => p.id === id),
        )
      )
        return send(404, {}, "PLACE_NOT_FOUND");
      if (body.toPlaceId === "hanying@4F" && body.mode === "wheelchair")
        return send(
          422,
          {
            venueAccessibility: {
              venueId: "nutc-sanmin",
              placeId: "hanying@4F",
              levelRef: "4F",
              stepFreeReachable: false,
            },
          },
          "NO_ACCESSIBLE_ROUTE",
        );
      const route = fixture.routes[`${body.fromPlaceId}>${body.toPlaceId}`];
      if (!route) return send(422, {}, "NO_ROUTE");
      return send(200, { ...route, mode: body.mode });
    }
    send(501, {}, "NOT_MODELLED_IN_SYNTHETIC_FIXTURE");
  })
  .listen(process.env.PORT || 4917, "127.0.0.1");
