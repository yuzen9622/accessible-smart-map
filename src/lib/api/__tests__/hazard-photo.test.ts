import { afterEach, describe, expect, it, vi } from "vitest";
import { refreshAccessToken } from "@/lib/authRefresh";
import { END_POINT } from "@/lib/config";
import useAuthStore from "@/stores/useAuthStore";
import { getHazardPhoto } from "../hazard-photo";

vi.mock("@/lib/authRefresh", () => ({
  refreshAccessToken: vi.fn(),
  configureAuthState: vi.fn(),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  useAuthStore.setState({ session: null, user: null });
});
describe("backend report photo transport", () => {
  it("requests backend bytes with auth, cancellation and no redirect/storage fallback", async () => {
    useAuthStore.setState({ session: { accessToken: "test-token" } });
    const fetch = vi.fn(
      async () => new Response(new Blob(["photo"], { type: "image/jpeg" })),
    );
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    expect((await getHazardPhoto("report/id", controller.signal)).size).toBe(5);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      `${END_POINT}/api/v1/a11y/reports/report%2Fid/photo`,
      expect.objectContaining({
        signal: controller.signal,
        redirect: "error",
        cache: "no-store",
        credentials: "include",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      }),
    );
  });
  it.each([403, 404, 500])(
    "does not fall back to storage on HTTP %i",
    async (status) => {
      const fetch = vi.fn(async () => new Response("unavailable", { status }));
      vi.stubGlobal("fetch", fetch);
      await expect(
        getHazardPhoto("r", new AbortController().signal),
      ).rejects.toMatchObject({ code: status });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["text/html", "image/svg+xml", "application/json"])(
    "rejects %s instead of displaying it as a photo",
    async (type) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response("invalid", { headers: { "Content-Type": type } }),
        ),
      );
      await expect(
        getHazardPhoto("r", new AbortController().signal),
      ).rejects.toThrow("Unsupported");
    },
  );
  it("retries an expired token once through the shared refresh mechanism", async () => {
    useAuthStore.setState({ session: { accessToken: "old" } });
    vi.mocked(refreshAccessToken).mockImplementationOnce(async () => {
      useAuthStore.setState({ session: { accessToken: "new" } });
      return "new";
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        new Response(new Blob(["photo"], { type: "image/png" })),
      );
    vi.stubGlobal("fetch", fetch);
    await getHazardPhoto("r", new AbortController().signal);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe("Bearer new");
  });
  it("does not refresh or retry a response from a previous session", async () => {
    useAuthStore.setState({ session: { accessToken: "a" } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        useAuthStore.setState({ session: { accessToken: "b" } });
        return new Response(null, { status: 401 });
      }),
    );
    await expect(
      getHazardPhoto("r", new AbortController().signal),
    ).rejects.toMatchObject({ code: 401 });
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });
});
