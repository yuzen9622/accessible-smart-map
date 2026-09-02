import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ErrorPage from "@/app/[lng]/error";
import GlobalError from "@/app/global-error";

// Mock next/navigation for App Router
vi.mock("next/navigation", () => ({
  usePathname: () => "/zh-TW/some-page",
  redirect: vi.fn(),
}));

describe("Route ErrorPage ([lng]/error.tsx)", () => {
  it("renders status page error layout with accessible role and title", () => {
    const error = new Error("Failed to load transit data") as Error & {
      digest?: string;
    };
    error.digest = "TRANSIT_500";
    const resetMock = vi.fn();

    const html = renderToStaticMarkup(
      <ErrorPage error={error} reset={resetMock} />,
    );

    // Verify accessibility and error status
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain('aria-atomic="true"');
    expect(html).toContain("發生未預期錯誤");
    expect(html).toContain("重新嘗試");
    expect(html).toContain("返回首頁");
    expect(html).toContain("TRANSIT_500");
    expect(html).toContain("詳細錯誤資訊");
    expect(html).toContain("Failed to load transit data");
    expect(html).toContain("break-words break-all");

    // Verify removed badges are no longer rendered
    expect(html).not.toContain("安全防護攔截");
    expect(html).not.toContain("臺北無障礙智慧地圖</span>");
  });

  it("handles empty error message with fallback text", () => {
    const error = new Error("") as Error & { digest?: string };
    const resetMock = vi.fn();

    const html = renderToStaticMarkup(
      <ErrorPage error={error} reset={resetMock} />,
    );

    expect(html).toContain("未提供詳細錯誤訊息");
  });
});

describe("GlobalError (global-error.tsx)", () => {
  it("renders complete html and body document with accessible alert layout", () => {
    const error = new Error("Fatal root layout failure") as Error & {
      digest?: string;
    };
    error.digest = "ROOT_PANIC_999";
    const resetMock = vi.fn();

    const html = renderToStaticMarkup(
      <GlobalError error={error} reset={resetMock} />,
    );

    // Verify complete HTML document structure
    expect(html).toContain("<html");
    expect(html).toContain('lang="zh-TW"');
    expect(html).toContain("<body");
    expect(html).toContain("<main");
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain('aria-atomic="true"');
    expect(html).toContain("系統發生重大錯誤");
    expect(html).toContain(
      "應用程式核心元件發生未預期的錯誤，請嘗試重新載入整個頁面或返回首頁。",
    );
    expect(html).toContain("ROOT_PANIC_999");
    expect(html).toContain("重新載入頁面");
    expect(html).toContain("返回首頁");
    expect(html).toContain("詳細錯誤資訊");
    expect(html).toContain("Fatal root layout failure");
    expect(html).toContain("break-words break-all");

    // Verify removed badges are no longer rendered
    expect(html).not.toContain("全域防護攔截");
    expect(html).not.toContain("臺北無障礙智慧地圖</span>");
  });

  it("handles empty error message with fallback text", () => {
    const error = new Error("") as Error & { digest?: string };
    const resetMock = vi.fn();

    const html = renderToStaticMarkup(
      <GlobalError error={error} reset={resetMock} />,
    );

    expect(html).toContain("未提供詳細錯誤訊息");
  });
});
