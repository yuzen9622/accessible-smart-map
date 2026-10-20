import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
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
  const profile = await mkdtemp(path.join(tmpdir(), "route-preview-chrome-"));
  let chrome: ReturnType<typeof spawn> | undefined;
  let chromeClosed: Promise<void> | undefined;
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === "string")
      throw new Error("missing test server");
    chrome = spawn(
      process.env.CHROME_BIN ??
        (process.platform === "darwin"
          ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
          : "google-chrome"),
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
        "--remote-debugging-pipe",
        "about:blank",
      ],
      { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] },
    );
    chromeClosed = new Promise((resolve) =>
      chrome?.once("close", () => resolve()),
    );
    chrome.stderr?.resume();
    const input = chrome.stdio[3] as Writable;
    const messages = chrome.stdio[4] as Readable;
    let id = 0;
    const calls = new Map<
      number,
      { resolve: (value: unknown) => void; reject: (error: Error) => void }
    >();
    const failPending = (error: Error) => {
      for (const call of calls.values()) call.reject(error);
      calls.clear();
    };
    chrome.once("error", failPending);
    chrome.once("close", (code, signal) =>
      failPending(new Error(`Chrome closed: ${code ?? signal}`)),
    );
    input.on("error", failPending);
    messages.on("error", failPending);
    let buffer = "";
    messages.setEncoding("utf8");
    messages.on("data", (chunk: string) => {
      buffer += chunk;
      let end = buffer.indexOf("\0");
      while (end !== -1) {
        const value = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        const call = calls.get(value.id);
        calls.delete(value.id);
        if (value.error) call?.reject(new Error(JSON.stringify(value.error)));
        else call?.resolve(value);
        if (value.method === "Runtime.exceptionThrown")
          console.log(JSON.stringify(value.params));
        end = buffer.indexOf("\0");
      }
    });
    const send = async <T>(
      method: string,
      params: object = {},
      sessionId?: string,
    ): Promise<{ result: T }> => {
      const key = ++id;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        return await new Promise((resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`CDP timed out: ${method}`)),
            10000,
          );
          calls.set(key, {
            resolve: (value) => resolve(value as { result: T }),
            reject,
          });
          input.write(
            `${JSON.stringify({ id: key, method, params, sessionId })}\0`,
          );
        });
      } finally {
        clearTimeout(timeout);
        calls.delete(key);
      }
    };
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
    if (chrome) {
      const browser = chrome;
      const forceKill = setTimeout(() => browser.kill("SIGKILL"), 5000);
      try {
        if (browser.exitCode === null && browser.signalCode === null)
          browser.kill();
        await chromeClosed;
      } finally {
        clearTimeout(forceKill);
      }
    }
    try {
      await server.close();
    } finally {
      await rm(profile, { recursive: true, force: true, maxRetries: 3 });
    }
  }
}, 60000);
