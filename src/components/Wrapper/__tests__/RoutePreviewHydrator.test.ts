import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";
import { expect, it } from "vitest";

it("real browser component + parser + Zustand handoff regression", async () => {
  const root = process.cwd();
  const dir = "src/components/Wrapper/__tests__";
  const server = await createServer({
    configFile: false,
    root,
    resolve: {
      alias: [
        {
          find: "next/navigation",
          replacement: path.join(
            root,
            dir,
            "routePreviewNavigation.fixture.ts",
          ),
        },
        { find: "@", replacement: path.join(root, "src") },
      ],
    },
    oxc: { jsx: { runtime: "automatic" } },
    css: { postcss: { plugins: [] } },
    plugins: [
      {
        name: "handoff-browser-entry",
        configureServer(vite) {
          vite.middlewares.use("/handoff-test", (_req, res) => {
            res.setHeader("Content-Type", "text/html");
            res.end(
              `<html><body>RUNNING<script>window.process={env:{NODE_ENV:'development',NEXT_PUBLIC_END_POINT:'http://fixture.invalid'}}</script><script type="module" src="/${dir}/RoutePreviewHydrator.browser.tsx"></script></body></html>`,
            );
          });
        },
      },
    ],
    server: { host: "127.0.0.1", port: 0, watch: { ignored: ["**/.pi/**"] } },
  });
  const notes = path.join(root, ".pi/notes/line-liff-route-handoff");
  await mkdir(notes, { recursive: true });
  const profile = await mkdtemp(path.join(notes, "chrome-"));
  let chrome: ReturnType<typeof spawn> | undefined;
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === "string")
      throw new Error("missing test server");
    chrome = spawn(
      process.env.CHROME_BIN ??
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      [
        "--headless",
        "--disable-gpu",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-sync",
        "--no-first-run",
        "--no-default-browser-check",
        `--user-data-dir=${profile}`,
        "--remote-debugging-port=0",
        "about:blank",
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    const wsUrl = await new Promise<string>((resolve, reject) => {
      chrome?.stderr?.on("data", (chunk) => {
        const match = String(chunk).match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) resolve(match[1]);
      });
      chrome?.once("error", reject);
      chrome?.once("exit", () =>
        reject(new Error("Chrome exited before ready")),
      );
    });
    const socket = new WebSocket(wsUrl);
    await new Promise<void>((resolve) =>
      socket.addEventListener("open", () => resolve(), { once: true }),
    );
    let id = 0;
    const calls = new Map<number, (value: Record<string, unknown>) => void>();
    socket.addEventListener("message", (event) => {
      const value = JSON.parse(String(event.data));
      calls.get(value.id)?.(value);
      if (value.method === "Runtime.exceptionThrown")
        console.log(JSON.stringify(value.params));
    });
    const send = <T>(method: string, params: object = {}, sessionId?: string) =>
      new Promise<{ result: T }>((resolve) => {
        const key = ++id;
        calls.set(key, (message) => resolve(message as { result: T }));
        socket.send(JSON.stringify({ id: key, method, params, sessionId }));
      });
    try {
      const target = await send<{ targetId: string }>("Target.createTarget", {
        url: "about:blank",
      });
      const attached = await send<{ sessionId: string }>(
        "Target.attachToTarget",
        { targetId: target.result.targetId, flatten: true },
      );
      const session = attached.result.sessionId;
      await send("Runtime.enable", {}, session);
      await send(
        "Page.navigate",
        { url: `http://127.0.0.1:${address.port}/handoff-test` },
        session,
      );
      let output = "";
      for (let i = 0; i < 200; i++) {
        const result = await send<{ result: { value?: string } }>(
          "Runtime.evaluate",
          {
            expression:
              "JSON.stringify({done:document.body?.dataset.done,text:document.body?.innerText})",
            returnByValue: true,
          },
          session,
        );
        const value = JSON.parse(result.result.result.value ?? "{}");
        output = value.text ?? "";
        if (value.done) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      console.log(output);
      expect(output).toContain("PASS direct planToken");
      expect(output).not.toContain("FAIL");
      expect(output.split("PASS ").length - 1).toBe(17);
    } finally {
      socket.close();
    }
  } finally {
    chrome?.kill();
    await server.close();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await rm(profile, { recursive: true, force: true });
  }
}, 60000);
