import { describe, expect, it } from "vitest";
import { resolvePublicHazardPhotoUrl } from "@/lib/public-hazard-photo";

const path = "/api/v1/a11y/reports/6670abc123def4567890abcd/photo/public";
describe("public report photo URL contract", () => {
  it.each([
    "https://backend.test",
    "https://backend.test/api/v1",
    "https://backend.test/api/v1/",
  ])(
    "resolves an existing API path against the backend origin (%s)",
    (backend) => {
      expect(resolvePublicHazardPhotoUrl(path, backend)).toBe(
        `https://backend.test${path}`,
      );
      expect(resolvePublicHazardPhotoUrl(path.slice(1), backend)).toBe(
        `https://backend.test${path}`,
      );
    },
  );
  it("preserves a backend absolute URL without duplicating the API prefix", () => {
    expect(
      resolvePublicHazardPhotoUrl(
        `https://backend.test${path}`,
        "https://backend.test/api/v1",
      ),
    ).toBe(`https://backend.test${path}`);
  });
  it.each([
    null,
    undefined,
    "",
    "/api/v1/a11y/reports/abc/photo",
    "https://storage.test/photo.jpg",
    `https://elsewhere.test${path}`,
    `https://user:secret@backend.test${path}`,
    "javascript:alert(1)",
    "data:image/png;base64,abc",
    "blob:https://backend.test/local",
  ])("does not load null, private, storage or unsafe URLs (%s)", (value) => {
    expect(
      resolvePublicHazardPhotoUrl(value, "https://backend.test"),
    ).toBeNull();
  });
  it("supports a local backend with an explicit port", () => {
    expect(
      resolvePublicHazardPhotoUrl(path, "http://localhost:8000/api/v1"),
    ).toBe(`http://localhost:8000${path}`);
  });
});
