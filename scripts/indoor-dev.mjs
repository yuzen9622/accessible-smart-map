import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

if (!existsSync(".local/indoor/model.json")) {
  console.error(
    "Missing .local/indoor/model.json. Export the private survey before starting the preview.",
  );
  process.exit(1);
}
const env = {
  ...process.env,
  INDOOR_PREVIEW_PORT: process.env.INDOOR_PREVIEW_PORT || "4399",
  NEXT_PUBLIC_INDOOR_PREVIEW: "1",
};
const adapter = spawn(process.execPath, ["scripts/indoor-serve.mjs"], {
  env,
  stdio: "inherit",
});
const app = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    process.env.PORT || "3000",
  ],
  { env, stdio: "inherit" },
);
let stopping = false;
const stop = (code = 0) => {
  if (stopping) return;
  stopping = true;
  adapter.kill("SIGTERM");
  app.kill("SIGTERM");
  process.exitCode = code;
};
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
for (const child of [adapter, app]) {
  child.on("error", () => stop(1));
  child.on("exit", (code) => stop(code || 0));
}
