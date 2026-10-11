import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReview, updateReview } from "@/lib/api/review";
import { fromReviewEvidence, toEvidencePayload } from "@/lib/reviewEvidence";
import useAuthStore from "@/stores/useAuthStore";
import type { UserDTO } from "@/types/user";

const user: UserDTO = {
  _id: "u",
  name: "U",
  email: "u@example.com",
  authProviders: ["local"],
  emailVerified: true,
  tokenVersion: 0,
};
const ratings = {
  passageWidthRating: 1,
  toiletRating: 2,
  elevatorRating: 3,
  serviceRating: 4,
};
beforeEach(() =>
  useAuthStore.setState({ user, session: { accessToken: "token-u" } }),
);
afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.setState({ user: null, session: null });
});
describe("review POST/PATCH wire contract", () => {
  it("POST sends four mandatory ratings and observed false; no null, unset or response-only score", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetch);
    await createReview({
      placeId: "p",
      placeType: "osm",
      ...ratings,
      ...toEvidencePayload(fromReviewEvidence({ toiletTurningRoom: false })),
      comment: undefined,
    });
    expect(fetch.mock.calls[0][0]).toMatch(/\/api\/v1\/a11y\/reviews$/);
    expect(fetch.mock.calls[0][1].method).toBe("POST");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      placeId: "p",
      placeType: "osm",
      ...ratings,
      toiletTurningRoom: false,
    });
  });
  it("PATCH omits originally unset fields and preserves explicitly false values", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetch);
    await updateReview("r", {
      ...ratings,
      ...toEvidencePayload(
        fromReviewEvidence({
          adequateAisleWidth: false,
          staffHelpfulnessRating: 1,
        }),
      ),
      comment: "detail",
    });
    expect(fetch.mock.calls[0][0]).toMatch(/\/reviews\/r$/);
    expect(fetch.mock.calls[0][1].method).toBe("PATCH");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      ...ratings,
      adequateAisleWidth: false,
      staffHelpfulnessRating: 1,
      comment: "detail",
    });
  });
  it("does not dispatch a mutation for an expired form session", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(updateReview("r", ratings, () => false)).rejects.toMatchObject(
      { name: "AbortError" },
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
