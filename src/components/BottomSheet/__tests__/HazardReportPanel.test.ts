import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mockMapState = vi.hoisted(() => ({
  userLocation: { lat: 25.033, lng: 121.5654 },
  pendingReportContext: null as null | {
    description: string;
    location: { lat: number; lng: number };
  },
  setPendingReportContext: vi.fn(),
}));

vi.mock("@/i18n/client", () => ({
  useAppTranslation: () => ({
    t: (key: string, fallback?: string | { defaultValue?: string }) =>
      typeof fallback === "string" ? fallback : fallback?.defaultValue || key,
    i18n: { language: "zh-TW" },
  }),
}));
vi.mock("@/stores/useMapStore", () => ({
  default: vi.fn((selector: (state: typeof mockMapState) => unknown) =>
    selector(mockMapState),
  ),
}));
vi.mock("@/stores/useAuthStore", () => ({
  default: vi.fn(
    (
      selector: (state: {
        user: null;
        requestAuthDialog: () => void;
      }) => unknown,
    ) => selector({ user: null, requestAuthDialog: vi.fn() }),
  ),
}));

import {
  ALLOWED_REPORT_PHOTO_TYPES,
  default as HazardReportPanel,
  MAX_REPORT_PHOTO_SIZE_BYTES,
  validateHazardPhoto,
} from "@/components/BottomSheet/HazardReportPanel";

describe("HazardReportPanel report location", () => {
  it("uses the selected place instead of the user's GPS after a place handoff", () => {
    mockMapState.pendingReportContext = {
      description: "無障礙坡道：測試地點",
      location: { lat: 25.0123, lng: 121.5432 },
    };

    const html = renderToStaticMarkup(
      React.createElement(HazardReportPanel, { onClose: () => undefined }),
    );

    expect(html).toContain("25.01230, 121.54320");
    expect(html).not.toContain("25.03300, 121.56540");
  });

  it("falls back to the user's GPS for a generic report entry", () => {
    mockMapState.pendingReportContext = null;

    const html = renderToStaticMarkup(
      React.createElement(HazardReportPanel, { onClose: () => undefined }),
    );

    expect(html).toContain("25.03300, 121.56540");
  });
});

describe("HazardReportPanel photo validation (P2-5)", () => {
  it("offers every allowed MIME type in the file picker", () => {
    mockMapState.pendingReportContext = null;

    const html = renderToStaticMarkup(
      React.createElement(HazardReportPanel, { onClose: () => undefined }),
    );

    expect(html).toContain(
      'accept="image/jpeg,image/png,image/webp,image/heic,image/heif"',
    );
  });

  it("defines 5MB size limit and allowed MIME types", () => {
    expect(MAX_REPORT_PHOTO_SIZE_BYTES).toBe(5 * 1024 * 1024);
    expect(ALLOWED_REPORT_PHOTO_TYPES).toContain("image/jpeg");
    expect(ALLOWED_REPORT_PHOTO_TYPES).toContain("image/png");
    expect(ALLOWED_REPORT_PHOTO_TYPES).toContain("image/webp");
    expect(ALLOWED_REPORT_PHOTO_TYPES).toContain("image/heic");
    expect(ALLOWED_REPORT_PHOTO_TYPES).toContain("image/heif");
  });

  it("accepts valid JPEG, PNG, WebP, HEIC, and HEIF images within 5MB", () => {
    const jpeg = { size: 1024 * 1024, type: "image/jpeg" }; // 1MB
    const png = { size: 3 * 1024 * 1024, type: "image/png" }; // 3MB
    const webp = { size: 500 * 1024, type: "image/webp" };
    const heic = { size: 2 * 1024 * 1024, type: "image/heic" };
    const heif = { size: 2 * 1024 * 1024, type: "image/heif" };

    expect(validateHazardPhoto(jpeg)).toEqual({ valid: true });
    expect(validateHazardPhoto(png)).toEqual({ valid: true });
    expect(validateHazardPhoto(webp)).toEqual({ valid: true });
    expect(validateHazardPhoto(heic)).toEqual({ valid: true });
    expect(validateHazardPhoto(heif)).toEqual({ valid: true });
  });

  it("rejects unlisted types (BMP, PDF, text, executable, video)", () => {
    const bmp = { size: 500 * 1024, type: "image/bmp" };
    const pdf = { size: 1024 * 1024, type: "application/pdf" };
    const text = { size: 500, type: "text/plain" };
    const exe = { size: 2048, type: "application/x-msdownload" };
    const video = { size: 2 * 1024 * 1024, type: "video/mp4" };

    expect(validateHazardPhoto(bmp)).toEqual({
      valid: false,
      error: "INVALID_IMAGE_TYPE",
    });
    expect(validateHazardPhoto(pdf)).toEqual({
      valid: false,
      error: "INVALID_IMAGE_TYPE",
    });
    expect(validateHazardPhoto(text)).toEqual({
      valid: false,
      error: "INVALID_IMAGE_TYPE",
    });
    expect(validateHazardPhoto(exe)).toEqual({
      valid: false,
      error: "INVALID_IMAGE_TYPE",
    });
    expect(validateHazardPhoto(video)).toEqual({
      valid: false,
      error: "INVALID_IMAGE_TYPE",
    });
  });
});
