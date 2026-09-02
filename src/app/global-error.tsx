"use client";

import {
  AlertTriangle,
  Check,
  Copy,
  Home,
  RefreshCw,
  RotateCcw,
  Terminal,
} from "lucide-react";
import { useEffect, useState } from "react";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  const [copied, setCopied] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  useEffect(() => {
    console.error(
      "[GlobalError] Unhandled error caught in root global error boundary:",
      error,
    );
  }, [error]);

  const handleReset = () => {
    setIsResetting(true);
    try {
      reset();
    } finally {
      setTimeout(() => setIsResetting(false), 500);
    }
  };

  const handleReload = () => {
    if (typeof window !== "undefined") {
      window.location.reload();
    } else {
      reset();
    }
  };

  const handleCopyDebugInfo = async () => {
    const debugText = [
      `=== Taipei Accessible Map Global Error Diagnostic ===`,
      `Time: ${new Date().toISOString()}`,
      `URL: ${typeof window !== "undefined" ? window.location.href : "SSR"}`,
      error?.digest ? `Digest: ${error.digest}` : null,
      `Error Name: ${error?.name || "GlobalError"}`,
      `Message: ${error?.message || "Unknown critical error"}`,
      error?.stack ? `\nStack Trace:\n${error.stack}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    try {
      await navigator.clipboard.writeText(debugText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard fallback
    }
  };

  return (
    <html lang="zh-TW">
      <head>
        <title>系統發生重大錯誤 - 臺北無障礙智慧地圖</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </head>
      <body className="min-h-dvh bg-slate-50 text-slate-900 dark:bg-zinc-950 dark:text-zinc-100 font-sans antialiased m-0 p-0 flex items-center justify-center">
        <main
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
          className="relative flex min-h-dvh w-full items-center justify-center overflow-hidden p-4 sm:p-6 lg:p-8"
        >
          {/* 背景微光裝飾 */}
          <div
            className="pointer-events-none absolute -top-32 left-1/2 -z-10 h-80 w-80 -translate-x-1/2 rounded-full bg-red-500/10 blur-3xl dark:bg-red-500/15"
            aria-hidden="true"
          />
          <div
            className="pointer-events-none absolute -bottom-32 left-1/2 -z-10 h-80 w-80 -translate-x-1/2 rounded-full bg-blue-500/10 blur-3xl dark:bg-blue-500/15"
            aria-hidden="true"
          />

          {/* Shadcn 風格高質感核心卡片 */}
          <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 p-6 sm:p-8 shadow-2xl backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-900/95 transition-all">
            {/* Header 區塊 */}
            <div className="text-center pb-2">
              {/* 核心警示圖示 */}
              <div
                className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 text-red-600 ring-8 ring-red-50 dark:bg-red-950/50 dark:text-red-400 dark:ring-red-950/30"
                aria-hidden="true"
              >
                <AlertTriangle className="h-8 w-8 animate-pulse" />
              </div>

              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-zinc-50">
                系統發生重大錯誤
              </h1>

              <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-zinc-400 max-w-sm mx-auto">
                應用程式核心元件發生未預期的錯誤，請嘗試重新載入整個頁面或返回首頁。
              </p>

              {/* 錯誤代碼 (Digest) */}
              {error?.digest && (
                <div className="mt-3 flex items-center justify-center">
                  <span className="font-mono text-xs rounded-md border border-slate-200 bg-slate-100 px-2.5 py-1 text-slate-600 dark:border-zinc-800 dark:bg-zinc-800 dark:text-zinc-300">
                    錯誤代碼：{error.digest}
                  </span>
                </div>
              )}
            </div>

            {/* 詳細除錯資訊折疊區塊 */}
            {(process.env.NODE_ENV !== "production" ||
              error?.message ||
              error?.digest ||
              error?.stack) && (
              <details className="group my-5 w-full min-w-0 overflow-hidden rounded-xl border border-slate-200/80 bg-slate-50/80 p-2 text-left dark:border-zinc-800 dark:bg-zinc-950/50 transition-colors">
                <summary className="flex cursor-pointer select-none items-center justify-between px-2 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <span className="flex items-center gap-2">
                    <Terminal className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                    <span>詳細錯誤資訊</span>
                  </span>
                  <span className="text-[11px] text-slate-400 group-open:hidden">
                    展開
                  </span>
                </summary>

                <div className="mt-2 space-y-2 pt-1 border-t border-slate-200 dark:border-zinc-800 min-w-0 w-full">
                  <div className="flex items-center justify-between gap-2 px-1 min-w-0">
                    <span
                      className="text-[11px] font-medium text-slate-500 dark:text-zinc-400 truncate shrink min-w-0"
                      title={error?.name || "Global Error Exception"}
                    >
                      {error?.name || "Global Error Exception"}
                    </span>
                    <button
                      type="button"
                      onClick={handleCopyDebugInfo}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-200 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors shrink-0"
                    >
                      {copied ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-500" />
                          <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                            已複製
                          </span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          <span>複製除錯資訊</span>
                        </>
                      )}
                    </button>
                  </div>

                  <div className="max-h-48 w-full min-w-0 overflow-y-auto overflow-x-hidden rounded-lg border border-slate-300 bg-zinc-950 p-3 font-mono text-[11px] leading-relaxed text-zinc-100 dark:border-zinc-800">
                    <div className="text-red-400 font-semibold break-words break-all whitespace-pre-wrap">
                      {error?.message || "未提供詳細錯誤訊息"}
                    </div>
                    {error?.digest && !error?.message && (
                      <div className="text-zinc-400 text-[10px] break-words break-all mt-1">
                        Digest: {error.digest}
                      </div>
                    )}
                    {error?.stack && (
                      <pre className="text-zinc-400 whitespace-pre-wrap break-words break-all text-[10px] m-0 font-mono mt-2 pt-2 border-t border-zinc-800/80">
                        {error.stack}
                      </pre>
                    )}
                  </div>
                </div>
              </details>
            )}

            {/* 操作按鈕組 (Actions) */}
            <div className="mt-6 flex flex-col gap-2.5">
              {/* 主要行動：重新嘗試 */}
              <button
                type="button"
                onClick={handleReset}
                disabled={isResetting}
                className="flex w-full min-h-[44px] items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-500/20 hover:bg-blue-700 active:scale-[0.99] disabled:opacity-50 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:bg-blue-600 dark:hover:bg-blue-500"
              >
                <RotateCcw
                  className={`h-4 w-4 ${isResetting ? "animate-spin" : ""}`}
                />
                <span>重新嘗試</span>
              </button>

              {/* 輔助操作按鈕組 */}
              <div className="grid w-full grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleReload}
                  className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs sm:text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700/80 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400"
                >
                  <RefreshCw className="h-3.5 w-3.5 text-slate-500 dark:text-zinc-400" />
                  <span>重新載入頁面</span>
                </button>

                <a
                  href="/"
                  className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-xs sm:text-sm font-medium text-slate-700 hover:bg-slate-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700/80 transition-colors text-center focus:outline-none focus:ring-2 focus:ring-slate-400"
                >
                  <Home className="h-3.5 w-3.5 text-slate-500 dark:text-zinc-400" />
                  <span>返回首頁</span>
                </a>
              </div>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
