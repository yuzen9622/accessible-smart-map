#!/usr/bin/env node
// Read-only route checks. Never imports OSM, touches MongoDB, or changes deployment.
import assert from "node:assert/strict";

const args = process.argv.slice(2);
const base = args[args.indexOf("--base") + 1];
if (!args.includes("--base") || !/^https?:\/\//.test(base ?? "")) {
  console.error(
    "Usage: node scripts/verify-campus-api.mjs --base http://localhost:8000",
  );
  process.exit(2);
}
let detail;
let assertions = 0;
const check = (value, message) => {
  assert.ok(value, message);
  assertions++;
};
async function request(path, body) {
  const response = await fetch(`${base.replace(/\/$/, "")}${path}`, {
    method: body ? "POST" : "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await response.text();
  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch {
    envelope = null;
  }
  return { status: response.status, envelope };
}
async function refresh() {
  const response = await request("/api/v1/a11y/venues/nutc-sanmin");
  check(
    response.status === 200 && response.envelope.ok,
    "Venue detail GET failed",
  );
  detail = response.envelope.data;
  check(
    Array.isArray(detail.walkways) &&
      Object.hasOwn(detail, "sourceSha256") &&
      detail.buildings.every((b) => b.levels.every((l) => l.coverage)),
    "Backend is missing the new display contract",
  );
}
async function route(from, to, mode = "wheelchair") {
  check(
    [from, to].every((id) => detail.places.some((p) => p.id === id)),
    `Missing official endpoint ${from}/${to}`,
  );
  for (let retry = 0; retry < 2; retry++) {
    const response = await request("/api/v1/a11y/venues/nutc-sanmin/route", {
      fromPlaceId: from,
      toPlaceId: to,
      mode,
      language: "zh-TW",
    });
    if (
      response.status !== 200 ||
      response.envelope.data.venueVersion === detail.version
    )
      return response;
    await refresh();
  }
  throw new Error(
    "Venue version keeps changing; rerun when the import has settled",
  );
}
try {
  // Production intentionally does not publish OpenAPI. Public Venue responses
  // below are the acceptance evidence; optional development docs are separate.
  if (args.includes("--check-openapi")) {
    const spec = await request("/api/v1/openapi.json");
    if (spec.status === 404) {
      console.log(
        "SKIP OpenAPI: not published; continuing public Venue checks.",
      );
    } else {
      const paths = spec.envelope?.paths ?? {};
      check(
        spec.status === 200 &&
          Object.values(paths).some((path) =>
            Object.values(path).some((operation) =>
              operation?.tags?.includes("Venue"),
            ),
          ),
        "Development OpenAPI does not expose the Venue tag",
      );
    }
  }
  const list = await request("/api/v1/a11y/venues");
  check(
    list.status === 200 &&
      list.envelope.data?.some((v) => v.venueId === "nutc-sanmin"),
    "Campus is not imported",
  );
  await refresh();
  check(
    detail.buildings
      .map((b) => b.id)
      .sort()
      .join() === ["info", "zk", "changming", "hanying"].sort().join(),
    "Unexpected publication scope",
  );
  const reps = ["info@3F", "zk@5F", "changming@3F", "hanying@2F"];
  for (const from of reps)
    for (const to of reps.filter((id) => id !== from)) {
      const response = await route(from, to);
      check(
        response.status === 200 && response.envelope.ok,
        `Route failed: ${from} → ${to}`,
      );
      const r = response.envelope.data;
      check(
        !r.steps.some((s) => ["stairs", "steps", "escalator"].includes(s.type)),
        "Prohibited wheelchair step",
      );
      check(
        r.path.coordinates.length === r.path.buildingIds.length &&
          r.path.coordinates.length === r.path.levelRefs.length,
        "Path context length mismatch",
      );
      console.log(
        `PASS ${from} → ${to} version=${r.venueVersion} steps=${r.steps.length}`,
      );
    }
  const bridge = (await route("changming@2F", "hanying@2F")).envelope.data;
  check(
    bridge?.path?.buildingIds.includes("changming") &&
      bridge.path.buildingIds.includes("hanying") &&
      bridge.path.levelRefs.every((ref) => ref === "2F"),
    "Missing second-floor building connection",
  );
  const transfer = (await route("info@3F", "zk@5F")).envelope.data;
  check(
    transfer?.steps?.some((s) => s.type === "elevator") &&
      transfer.steps.some((s) => s.type === "ramp"),
    "Missing elevator/ramp",
  );
  const inaccessible = await route("info@1F", "hanying@4F");
  check(
    inaccessible.status === 422 &&
      inaccessible.envelope.data?.reason === "NO_ACCESSIBLE_ROUTE",
    "Expected NO_ACCESSIBLE_ROUTE at Hanying 4F",
  );
  check(
    (await route("info@1F", "hanying@4F", "normal")).status === 200,
    "Expected normal walking route",
  );
  for (const ref of ["B1", "B2"]) {
    const level = detail.buildings
      .find((b) => b.id === "zk")
      .levels.find((l) => l.ref === ref);
    check(
      level && Object.values(level.coverage).every((value) => value === false),
      `Unexpected coverage at ${ref}`,
    );
    check(
      !detail.places.some(
        (p) =>
          p.buildingId === "zk" && p.levelRef === ref && p.kind === "anchor",
      ),
      `Unexpected anchor at ${ref}`,
    );
  }
  console.log(
    `PASS ${assertions} assertions against ${base}; venue version=${detail.version}. No geometry saved.`,
  );
} catch (error) {
  console.error(
    `BLOCKED/FAIL ${base}: ${error.message}${error.cause?.code ? ` (${error.cause.code})` : ""}. Passed assertions=${assertions}.`,
  );
  process.exitCode = 1;
}
