import { beforeEach, describe, expect, it, vi } from "vitest";
import { authenticatedRequest, fetchRequest } from "@/lib/fetch";
import { getPublicSosSession, rotateSosShareToken } from "../sos";

vi.mock("@/lib/fetch", () => ({
  authenticatedRequest: vi.fn(),
  fetchRequest: vi.fn(),
}));

const mockAuthenticatedRequest = vi.mocked(authenticatedRequest);
const mockFetchRequest = vi.mocked(fetchRequest);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SOS API contract", () => {
  it("rotates the owner's share token through the dedicated POST endpoint", async () => {
    mockAuthenticatedRequest.mockResolvedValue({
      ok: true,
      status: "success",
      code: 200,
      message: "ok",
      data: { sessionId: "session / 1", shareToken: "ab".repeat(16) },
    });

    const response = await rotateSosShareToken("session / 1");

    expect(mockAuthenticatedRequest).toHaveBeenCalledWith(
      expect.stringMatching(
        /\/api\/v1\/sos\/sessions\/session%20%2F%201\/share-token$/,
      ),
      { method: "POST" },
    );
    expect(response.data?.shareToken).toBe("ab".repeat(16));
  });

  it("uses the opaque share token for public tracking reads", async () => {
    mockFetchRequest.mockResolvedValue({
      ok: true,
      status: "success",
      code: 200,
      message: "ok",
      data: {
        type: "body",
        status: "resolved",
        resolvedAt: "2026-10-13T02:00:00.000Z",
      },
    });

    const token = "cd".repeat(16);
    const response = await getPublicSosSession(token);

    expect(mockFetchRequest).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`/sessions/${token}/public$`)),
      { method: "GET" },
    );
    expect(response.data?.status).toBe("resolved");
  });
});
