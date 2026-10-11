import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteAccount,
  loginWithEmail,
  loginWithGoogle,
  reauthenticateDeletionWithEmail,
  reauthenticateDeletionWithGoogle,
} from "@/lib/api/auth";
import { ApiError } from "@/lib/fetch";
import useAuthStore from "@/stores/useAuthStore";

afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.setState({ session: null, user: null });
});
describe("isolated deletion endpoint transport", () => {
  it("isolates both reauth providers while ordinary login keeps cookies", async () => {
    const fetch = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ ok: true, code: 200, data: { config: null } }),
    });
    vi.stubGlobal("fetch", fetch);
    await reauthenticateDeletionWithEmail("a@example.test", "secret");
    await reauthenticateDeletionWithGoogle("idToken");
    await loginWithEmail("a@example.test", "secret");
    await loginWithGoogle("idToken");
    expect(fetch.mock.calls.map(([, init]) => init.credentials)).toEqual([
      "omit",
      "omit",
      "include",
      "include",
    ]);
    expect(fetch.mock.calls[0][0]).toMatch(/\/api\/v1\/user\/auth\/login$/);
    expect(fetch.mock.calls[0][1].body).toBe(
      JSON.stringify({ email: "a@example.test", password: "secret" }),
    );
    expect(fetch.mock.calls[1][0]).toMatch(/\/api\/v1\/user\/auth\/google$/);
    expect(fetch.mock.calls[1][1].body).toBe(
      JSON.stringify({ idToken: "idToken" }),
    );
    expect(fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
    expect(fetch.mock.calls[1][1].headers.Authorization).toBeUndefined();
  });
  it("retry uses explicit fresh Authorization without replacing store or refreshing", async () => {
    useAuthStore.setState({ session: { accessToken: "old" } });
    const before = useAuthStore.getState().session;
    const fetch = vi.fn().mockResolvedValue({
      status: 401,
      json: async () => ({ ok: false, code: 401, message: "" }),
    });
    vi.stubGlobal("fetch", fetch);
    expect((await deleteAccount(() => true, undefined, "fresh")).code).toBe(
      401,
    );
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1]).toMatchObject({
      credentials: "omit",
      method: "DELETE",
      headers: { Authorization: "Bearer fresh" },
    });
    expect(useAuthStore.getState().session).toBe(before);
  });
  it("sends only DELETE /user with {} and does not refresh genuine401", async () => {
    useAuthStore.setState({ session: { accessToken: "captured" } });
    const fetch = vi.fn().mockResolvedValue({
      status: 401,
      json: async () => ({ ok: false, code: 401, message: "" }),
    });
    vi.stubGlobal("fetch", fetch);
    expect((await deleteAccount(() => true)).code).toBe(401);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/user$/);
    expect(init).toMatchObject({
      method: "DELETE",
      body: "{}",
      credentials: "omit",
      headers: { Authorization: "Bearer captured" },
    });
    expect(useAuthStore.getState().session?.accessToken).toBe("captured");
  });
  it("business403 preserves session and reason; no refresh", async () => {
    useAuthStore.setState({ session: { accessToken: "captured" } });
    const fetch = vi.fn().mockResolvedValue({
      status: 403,
      json: async () => ({
        ok: false,
        code: 403,
        message: "",
        data: { reason: "REAUTH_REQUIRED" },
      }),
    });
    vi.stubGlobal("fetch", fetch);
    await expect(deleteAccount(() => true)).rejects.toMatchObject({
      code: 403,
      reason: "REAUTH_REQUIRED",
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(useAuthStore.getState().session?.accessToken).toBe("captured");
  });
  it("stale explicit-bearer retry never reaches network", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      deleteAccount(() => false, undefined, "fresh"),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("stale request never reaches network", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(deleteAccount(() => false)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("guard rechecks after token await and after response before classifying errors", async () => {
    const guard = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(deleteAccount(guard)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(fetch).not.toHaveBeenCalled();
    let current = true;
    fetch.mockImplementation(async () => {
      current = false;
      return {
        status: 404,
        json: async () => ({
          ok: false,
          code: 404,
          data: { reason: "NOT_FOUND" },
        }),
      };
    });
    await expect(deleteAccount(() => current)).rejects.not.toBeInstanceOf(
      ApiError,
    );
  });
});
