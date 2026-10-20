import { readFile, realpath } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { applyIndoorLabelOverrides } from "./indoor-label-overrides.mjs";

// Local-only adapter. This is intentionally not a production API or a static asset.
const root = resolve(process.argv[2] || ".local/indoor");
const port = Number(process.env.INDOOR_PREVIEW_PORT || 4399);
const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
};
const server = createServer(async (request, response) => {
  const send = (status, body, type = "application/json; charset=utf-8") => {
    response.writeHead(status, { ...headers, "Content-Type": type });
    response.end(body);
  };
  try {
    if (request.method !== "GET")
      return send(405, '{"error":"METHOD_NOT_ALLOWED"}');
    const host = new URL(`http://${request.headers.host}`).hostname;
    if (!["localhost", "127.0.0.1", "[::1]"].includes(host))
      return send(403, '{"error":"LOCAL_ONLY"}');
    if (
      request.headers.origin &&
      !["localhost", "127.0.0.1", "[::1]"].includes(
        new URL(request.headers.origin).hostname,
      )
    )
      return send(403, '{"error":"LOCAL_ONLY"}');
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    if (url.pathname === "/") {
      let model = JSON.parse(
        await readFile(resolve(root, "model.json"), "utf8"),
      );
      try {
        const overrides = JSON.parse(
          await readFile(resolve(root, "label-overrides.json"), "utf8"),
        );
        model = applyIndoorLabelOverrides(model, overrides);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      try {
        const candidate = JSON.parse(
          await readFile(resolve(root, "stair-design.json"), "utf8"),
        );
        if (candidate.sourceSha256 === model.source.sha256)
          model.stairDesign = candidate;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      try {
        const candidates = JSON.parse(
          await readFile(resolve(root, "stair-designs.json"), "utf8"),
        );
        if (
          candidates.sourceSha256 === model.source.sha256 &&
          Array.isArray(candidates.designs)
        )
          model.stairDesigns = candidates.designs.filter(
            (candidate) => candidate.sourceSha256 === model.source.sha256,
          );
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      return send(200, JSON.stringify(model));
    }
    if (
      url.pathname.replace(/\/$/, "") === "/photo" ||
      /^\/photos\/[a-z0-9-]+\/?$/.test(url.pathname)
    ) {
      const id = url.pathname.startsWith("/photos/")
        ? url.pathname.split("/")[2]
        : url.searchParams.get("id");
      const manifest = JSON.parse(
        await readFile(resolve(root, "photos.json"), "utf8"),
      );
      const filename = manifest[id];
      if (typeof filename !== "string")
        return send(404, '{"error":"NOT_FOUND"}');
      const photoRoot = await realpath(resolve(root, "photos"));
      const file = await realpath(resolve(photoRoot, filename));
      if (!file.startsWith(photoRoot + sep))
        return send(403, '{"error":"LOCAL_ONLY"}');
      const mime = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
      }[extname(file).toLowerCase()];
      if (!mime) return send(404, '{"error":"NOT_FOUND"}');
      return send(200, await readFile(file), mime);
    }
    send(404, '{"error":"NOT_FOUND"}');
  } catch (error) {
    send(
      error?.code === "ENOENT" ? 404 : 500,
      '{"error":"LOCAL_PREVIEW_UNAVAILABLE"}',
    );
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Local indoor adapter: http://127.0.0.1:${port}`),
);
