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
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAppTranslation } from "@/i18n/client";
import { fallbackLng, languages } from "@/i18n/setting";
import { cn } from "@/lib/utils";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorPage({ error, reset }: ErrorProps) {
  const { t } = useAppTranslation();
  const pathname = usePathname();

  const [copied, setCopied] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  // 取得當前語系，確保返回首頁時包含正確前綴（如 /zh-TW 或 /en）
  const currentLng = useMemo(() => {
    const pathSegment = pathname?.split("/")[1];
    if (pathSegment && languages.includes(pathSegment)) {
      return pathSegment;
    }
    return fallbackLng;
  }, [pathname]);

  const isDev = process.env.NODE_ENV !== "production";

  useEffect(() => {
    console.error(
      "[RouteError] Unhandled error caught in route error boundary:",
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
    }
  };

  const handleCopyDebugInfo = async () => {
    const debugText = [
      `=== Taipei Accessible Map Error Diagnostic ===`,
      `Time: ${new Date().toISOString()}`,
      `URL: ${typeof window !== "undefined" ? window.location.href : "SSR"}`,
      `Language: ${currentLng}`,
      error.digest ? `Digest: ${error.digest}` : null,
      `Error Name: ${error.name || "Error"}`,
      `Message: ${error.message || "Unknown error"}`,
      error.stack ? `\nStack Trace:\n${error.stack}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    try {
      await navigator.clipboard.writeText(debugText);
      setCopied(true);
      toast.success(t("errorCopiedToast", "除錯資訊已複製至剪貼簿"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(
        t("errorCopyFailedToast", "無法複製至剪貼簿，請手動選取複製"),
      );
    }
  };

  return (
    <main
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      className="relative flex min-h-dvh w-full items-center justify-center overflow-hidden bg-background p-4 sm:p-6 lg:p-8 selection:bg-primary/20"
    >
      {/* 背景無障礙裝飾微光與光斑 */}
      <div
        className="pointer-events-none absolute -top-40 left-1/2 -z-10 h-96 w-96 -translate-x-1/2 rounded-full bg-destructive/10 blur-3xl dark:bg-destructive/15"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -bottom-40 left-1/2 -z-10 h-96 w-96 -translate-x-1/2 rounded-full bg-primary/10 blur-3xl dark:bg-primary/15"
        aria-hidden="true"
      />

      <Card className="relative w-full max-w-lg overflow-hidden border-border/80 bg-card/95 shadow-xl backdrop-blur-md transition-all duration-300 sm:rounded-2xl">
        <CardHeader className="text-center pb-4 pt-6 sm:pt-8">
          {/* 核心圖示容器 */}
          <div
            className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-destructive/10 text-destructive ring-8 ring-destructive/5 dark:bg-destructive/20 dark:ring-destructive/10"
            aria-hidden="true"
          >
            <AlertTriangle className="h-8 w-8 animate-pulse" />
          </div>

          <CardTitle className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
            {t("errorTitle", "發生未預期錯誤")}
          </CardTitle>

          <CardDescription className="text-sm text-muted-foreground mt-2 max-w-sm mx-auto leading-relaxed">
            {t(
              "errorDescription",
              "應用程式遇到未預期的問題，請嘗試重新載入或返回首頁。",
            )}
          </CardDescription>

          {/* 錯誤代碼 (Digest) */}
          {error.digest && (
            <div className="mt-3 flex items-center justify-center gap-2">
              <Badge
                variant="secondary"
                className="font-mono text-xs text-muted-foreground border border-border/50 px-2 py-0.5"
              >
                {t("statusErrorCode", { code: error.digest }) ||
                  `Digest: ${error.digest}`}
              </Badge>
            </div>
          )}
        </CardHeader>

        <CardContent className="space-y-4 px-6 min-w-0 w-full">
          {/* 詳細除錯資訊折疊區塊 */}
          {(isDev || error.message || error.digest || error.stack) && (
            <details className="group w-full min-w-0 overflow-hidden rounded-xl border border-border/60 bg-muted/40 p-2.5 text-left transition-colors">
              <summary className="flex cursor-pointer select-none items-center justify-between px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-w-0">
                <span className="flex items-center gap-2">
                  <Terminal className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span>{t("errorDetails", "詳細錯誤資訊")}</span>
                </span>
                <span className="text-[11px] text-muted-foreground/80 group-open:hidden">
                  {t("expand", "展開")}
                </span>
              </summary>

              <div className="mt-2 space-y-2 pt-1 border-t border-border/40 min-w-0 w-full">
                <div className="flex items-center justify-between gap-2 px-1 min-w-0">
                  <span
                    className="text-[11px] font-medium text-muted-foreground truncate shrink min-w-0"
                    title={error.name || "Error"}
                  >
                    {error.name || "Error"}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleCopyDebugInfo}
                    className="h-7 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground shrink-0"
                  >
                    {copied ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-500" />
                        <span>{t("copied", "已複製")}</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        <span>{t("copyDebugInfo", "複製除錯資訊")}</span>
                      </>
                    )}
                  </Button>
                </div>

                <div className="max-h-48 w-full min-w-0 overflow-y-auto overflow-x-hidden rounded-lg border border-border/60 bg-zinc-950 p-3 font-mono text-[11px] leading-relaxed text-zinc-100 dark:bg-black">
                  <div className="text-red-400 font-semibold break-words break-all whitespace-pre-wrap">
                    {error.message || t("errorNoMessage", "未提供詳細錯誤訊息")}
                  </div>
                  {error.digest && !error.message && (
                    <div className="text-zinc-400 text-[10px] break-words break-all mt-1">
                      Digest: {error.digest}
                    </div>
                  )}
                  {error.stack && (
                    <pre className="text-zinc-400 whitespace-pre-wrap break-words break-all text-[10px] font-mono mt-2 pt-2 border-t border-zinc-800/80">
                      {error.stack}
                    </pre>
                  )}
                </div>
              </div>
            </details>
          )}
        </CardContent>

        <CardFooter className="flex flex-col gap-2.5 px-6 pb-6 pt-2">
          {/* 主要行動：重新嘗試 */}
          <Button
            type="button"
            size="lg"
            onClick={handleReset}
            disabled={isResetting}
            className="w-full min-h-[44px] gap-2 font-medium shadow-md shadow-primary/20 transition-transform active:scale-[0.99]"
          >
            <RotateCcw
              className={cn(
                "h-4 w-4",
                isResetting && "animate-spin text-primary-foreground",
              )}
            />
            <span>{t("errorRetry", "重新嘗試")}</span>
          </Button>

          {/* 輔助操作按鈕組 */}
          <div className="grid w-full grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              size="default"
              onClick={handleReload}
              className="min-h-[44px] gap-1.5 text-xs sm:text-sm font-normal"
            >
              <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
              <span>{t("reloadPage", "重新載入頁面")}</span>
            </Button>

            <Button
              variant="secondary"
              size="default"
              asChild
              className="min-h-[44px] gap-1.5 text-xs sm:text-sm font-normal"
            >
              <Link href={`/${currentLng}`}>
                <Home className="h-3.5 w-3.5 text-muted-foreground" />
                <span>{t("errorGoHome", "返回首頁")}</span>
              </Link>
            </Button>
          </div>
        </CardFooter>
      </Card>
    </main>
  );
}
