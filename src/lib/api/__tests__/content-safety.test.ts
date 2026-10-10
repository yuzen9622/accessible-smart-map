import i18n from "i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getNearbyHazardReports, getSafetyHazardReports } from "@/lib/api/a11y";
import {
  blockContentAuthor,
  CONTENT_REPORT_REASONS,
  listBlockedUsers,
  submitContentReport,
  unblockUser,
} from "@/lib/api/content-safety";
import { getPlaceReviews, getReviewSummary } from "@/lib/api/review";
import useAuthStore from "@/stores/useAuthStore";
import useContentSafetyStore, {
  captureSafetyAccount,
} from "@/stores/useContentSafetyStore";
import type { UserDTO } from "@/types/user";

const user: UserDTO = {
  _id: "reporter",
  name: "Reporter",
  email: "test@example.com",
  authProviders: ["local"],
  emailVerified: true,
  tokenVersion: 0,
};
function login(id = "reporter") {
  useAuthStore.setState({
    user: { ...user, _id: id },
    session: { accessToken: `token-${id}` },
  });
}
const receipt = {
  caseNumber: "CR-test",
  receivedAt: "2026-10-10T12:00:00Z",
  confirmationEmail: "queued",
  duplicate: false,
};
function response(data: unknown, code = 200) {
  return new Response(
    JSON.stringify({ ok: code < 400, code, message: "test", data }),
    { status: code },
  );
}
beforeEach(async () => {
  login();
  await i18n.init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: { test: "test" } } },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.setState({ user: null, session: null });
});

describe("content safety transport and account boundaries", () => {
  it.each([401, 403, 200])(
    "discards a personalized read's late %s without affecting the new account",
    async (code) => {
      let release: (value: Response) => void = () => {};
      const fetch = vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      );
      vi.stubGlobal("fetch", fetch);
      const pending = getNearbyHazardReports(25, 121);
      await Promise.resolve();
      login("other");
      release(response({ reports: [] }, code));
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(useAuthStore.getState().session?.accessToken).toBe("token-other");
    },
  );
  it("fences an anonymous → signed-in → anonymous read", async () => {
    useAuthStore.setState({ user: null, session: null });
    let release: (value: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      ),
    );
    const pending = getReviewSummary({ placeId: "p1", placeType: "google" });
    login();
    useAuthStore.setState({ user: null, session: null });
    release(response({ summary: "old public content" }));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
  it("uses the anonymous safety projection endpoint despite a signed-in user's content filters", async () => {
    const signal = new AbortController().signal;
    const fetch = vi.fn().mockResolvedValue(
      response({
        reports: [
          {
            _id: "h1",
            hazardType: "obstacle",
            status: "verified",
            reportedLocation: { type: "Point", coordinates: [121, 25] },
          },
        ],
        total: 1,
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const result = await getSafetyHazardReports(25, 121, 200, signal);
    expect(result.data?.reports).toHaveLength(1);
    expect(fetch.mock.calls[0][0]).toMatch(
      /\/reports\/safety\?lat=25&lng=121&radius=200$/,
    );
    expect(fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
    expect(fetch.mock.calls[0][1].signal).toBe(signal);
  });

  it.each(CONTENT_REPORT_REASONS)(
    "submits %s with UI language and no supplied author or email",
    async (reason) => {
      const fetch = vi.fn().mockResolvedValue(response(receipt));
      vi.stubGlobal("fetch", fetch);
      expect(
        await submitContentReport(
          { targetType: "hazard_report", targetId: "h1" },
          reason,
          " details ",
        ),
      ).toEqual(receipt);
      const [url, options] = fetch.mock.calls[0];
      expect(url).toMatch(/\/api\/v1\/content-reports$/);
      expect(options.headers.Authorization).toBe("Bearer token-reporter");
      expect(JSON.parse(options.body)).toEqual({
        targetType: "hazard_report",
        targetId: "h1",
        reason,
        details: "details",
        language: "en",
      });
      expect(options).not.toHaveProperty("isCurrentSession");
    },
  );
  it("uses opaque block IDs and target-based author resolution", async () => {
    const items = [
      { blockId: "block-1", label: "hazard_report", createdAt: "2026-10-10" },
    ];
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({}))
      .mockResolvedValueOnce(response({ items }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    await blockContentAuthor({ targetType: "review", targetId: "r1" });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      targetType: "review",
      targetId: "r1",
    });
    expect(await listBlockedUsers()).toEqual({ items });
    await unblockUser("block/1");
    expect(fetch.mock.calls[2][0]).toMatch(/\/user\/blocks\/block%2F1$/);
  });
  it("rejects late success after an A → B → A account transition", async () => {
    let release: (value: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      ),
    );
    const result = submitContentReport(
      { targetType: "review", targetId: "r1" },
      "spam",
      "",
    );
    await Promise.resolve();
    login("other");
    login();
    release(response(receipt));
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });
  it("does not replay a late 401 under a different account", async () => {
    let release: (value: Response) => void = () => {};
    const fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const result = blockContentAuthor({ targetType: "review", targetId: "r1" });
    await Promise.resolve();
    login("other");
    release(response({}, 401));
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().user?._id).toBe("other");
  });
  it("does not dispatch if the account changes during token acquisition", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const result = blockContentAuthor({ targetType: "review", targetId: "r1" });
    login("other");
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps a valid session on a business permission failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({}, 403)));
    await expect(
      blockContentAuthor({ targetType: "review", targetId: "r1" }),
    ).rejects.toMatchObject({ code: 403 });
    expect(useAuthStore.getState().session?.accessToken).toBe("token-reporter");
  });
  it("keeps account fences valid during ordinary token refresh but invalidates on logout", () => {
    const current = captureSafetyAccount();
    const epoch = useContentSafetyStore.getState().accountEpoch;
    useAuthStore.getState().setSession({ accessToken: "refreshed" });
    expect(current()).toBe(true);
    expect(useContentSafetyStore.getState().accountEpoch).toBe(epoch);
    useAuthStore.setState({ session: null });
    expect(current()).toBe(false);
  });
  it("personalizes review list, summary and hazards and falls back to public reads after logout", async () => {
    const fetch = vi
      .fn()
      .mockImplementation(async () => response({ items: [] }));
    vi.stubGlobal("fetch", fetch);
    const load = async () => {
      await getPlaceReviews({ placeId: "p1", placeType: "google" });
      await getReviewSummary({ placeId: "p1", placeType: "google" });
      await getNearbyHazardReports(25, 121);
    };
    await load();
    for (const [, options] of fetch.mock.calls)
      expect(options.headers.Authorization).toBe("Bearer token-reporter");
    fetch.mockClear();
    useAuthStore.setState({ session: null, user: null });
    await load();
    for (const [, options] of fetch.mock.calls)
      expect(options.headers.Authorization).toBeUndefined();
  });
});
