import { afterEach, describe, expect, it, vi } from "vitest";
import { streamChatWithAgent } from "../ai";

vi.mock("@/lib/fetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fetch")>()),
  getAccessToken: async () => null,
}));
afterEach(() => vi.unstubAllGlobals());
function respond(events: [string, unknown][]) {
  const content = events
    .map(
      ([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
    )
    .join("");
  // Split inside JSON and UTF-8 characters to exercise the stream decoder.
  const bytes = new TextEncoder().encode(content);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              for (let i = 0; i < bytes.length; i += 7)
                controller.enqueue(bytes.slice(i, i + 7));
              controller.close();
            },
          }),
        ),
    ),
  );
}
describe("SSE correlation and cancellation", () => {
  it("pairs same-name calls by callId and preserves summary", async () => {
    respond([
      [
        "tool_call",
        { name: "planAccessibleRoute", callId: "a", args: { query: "第一條" } },
      ],
      [
        "tool_call",
        { name: "planAccessibleRoute", callId: "b", args: { query: "第二條" } },
      ],
      [
        "tool_result",
        {
          name: "planAccessibleRoute",
          callId: "a",
          result: { ok: true },
          summary: "第一條摘要",
        },
      ],
    ]);
    const onTool = vi.fn();
    await streamChatWithAgent(
      { messages: [], routeContractVersion: 1, routeContext: null },
      vi.fn(),
      onTool,
    );
    expect(onTool.mock.calls[2]).toEqual([
      "planAccessibleRoute",
      '{"query":"第一條"}',
      true,
      { ok: true },
      { callId: "a", summary: "第一條摘要", language: "zh-TW" },
    ]);
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.routeContext).toBeNull();
    expect(body.routeContractVersion).toBe(1);
  });
  it("stops all buffered text after a route consumer rejects the result", async () => {
    respond([
      ["tool_result", { name: "planAccessibleRoute", callId: "a", result: {} }],
      ["token", { text: "不應顯示" }],
    ]);
    const onText = vi.fn();
    await expect(
      streamChatWithAgent({ messages: [] }, onText, () => {
        throw new Error("route invalid");
      }),
    ).rejects.toThrow("route invalid");
    expect(onText).not.toHaveBeenCalled();
  });
  it("discards buffered tokens after abort", async () => {
    respond([
      ["token", { text: "first" }],
      ["token", { text: "late" }],
    ]);
    const abort = new AbortController();
    const onText = vi.fn(() => abort.abort());
    await expect(
      streamChatWithAgent({ messages: [] }, onText, undefined, abort.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(onText).toHaveBeenCalledTimes(1);
  });
  it("reads SSE data.reason without interpreting numeric code as a domain reason", async () => {
    respond([
      [
        "error",
        { code: 422, message: "failure", data: { reason: "NO_ROUTE" } },
      ],
    ]);
    await expect(
      streamChatWithAgent({ messages: [] }, vi.fn()),
    ).rejects.toMatchObject({
      code: 422,
      reason: "NO_ROUTE",
      message: "failure",
    });
  });
  it("preserves HTTP data.reason before the SSE stream opens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            code: 400,
            message: "Invalid location",
            data: { reason: "LOCATION_REQUIRED" },
          },
          { status: 400 },
        ),
      ),
    );
    await expect(
      streamChatWithAgent({ messages: [] }, vi.fn()),
    ).rejects.toMatchObject({
      code: 400,
      reason: "LOCATION_REQUIRED",
      message: "Invalid location",
    });
  });
  it("falls back to HTTP status for non-JSON failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Bad gateway", { status: 502 })),
    );
    await expect(
      streamChatWithAgent({ messages: [] }, vi.fn()),
    ).rejects.toMatchObject({
      code: 502,
      reason: undefined,
    });
  });
  it("keeps a tool result's reason at its own top level", async () => {
    const result = {
      ok: false,
      reason: "NO_ACCESSIBLE_ROUTE",
      message: "Unavailable",
    };
    respond([
      ["tool_result", { name: "planAccessibleRoute", callId: "a", result }],
    ]);
    const onTool = vi.fn();
    await streamChatWithAgent({ messages: [] }, vi.fn(), onTool);
    expect(onTool.mock.calls[0][3]).toEqual(result);
  });
});
