import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { test } from "node:test";
import { promisify } from "node:util";

const fixture = JSON.parse(
  await readFile(
    new URL(
      "../src/lib/indoor/__tests__/fixtures/venue-contract.json",
      import.meta.url,
    ),
  ),
);
const run = promisify(execFile);

// Synthetic HTTP regression only; never represents live campus acceptance.
test("public Venue checks work with production OpenAPI 404 and still reject API failure", async (t) => {
  let unavailable = false;
  let docsRequests = 0;
  const server = createServer(async (req, res) => {
    if (req.url === "/api/v1/openapi.json") {
      docsRequests++;
      res.writeHead(404, { "Content-Type": "text/html" });
      res.end("<h1>Not Found</h1>");
      return;
    }
    const send = (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: status === 200, data }));
    };
    if (unavailable) return send(503, {});
    if (req.url === "/api/v1/a11y/venues") return send(200, [fixture.detail]);
    if (req.method === "GET") return send(200, fixture.detail);
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    if (body.toPlaceId === "hanying@4F" && body.mode === "wheelchair")
      return send(422, { reason: "NO_ACCESSIBLE_ROUTE" });
    return send(200, fixture.routes[`${body.fromPlaceId}>${body.toPlaceId}`]);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const args = [
    "scripts/verify-campus-api.mjs",
    "--base",
    `http://127.0.0.1:${server.address().port}`,
  ];
  const normal = await run(process.execPath, args);
  assert.match(normal.stdout, /PASS \d+ assertions/);
  assert.equal(docsRequests, 0);
  const withDocs = await run(process.execPath, [...args, "--check-openapi"]);
  assert.match(withDocs.stdout, /SKIP OpenAPI/);
  assert.match(withDocs.stdout, /PASS \d+ assertions/);
  assert.equal(docsRequests, 1);
  unavailable = true;
  await assert.rejects(run(process.execPath, args), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /Campus is not imported/);
    return true;
  });
});
