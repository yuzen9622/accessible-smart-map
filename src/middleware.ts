import { type NextRequest, NextResponse } from "next/server";
import { fallbackLng, languages } from "@/i18n/setting";

export const config = {
  matcher: [
    "/",
    "/((?!api|_next/static|_next/image|assets|favicon.ico|sw.js).*)",
  ],
};

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  if (
    path.includes(".") ||
    path.startsWith("/_next") ||
    path.startsWith("/api") ||
    path.startsWith("/assets")
  ) {
    return NextResponse.next();
  }
  // Keep the public website at / and the default-language application at /map.
  // Old shared links must still open the map with their original query intact.
  if (path === "/") {
    const mapKeys = [
      "loc",
      "place",
      "planToken",
      "sessionId",
      "liff.state",
      "sos",
      "token",
      "a11y",
      "authModal",
      "indoor",
      "mockgeo",
    ];
    if (mapKeys.some((key) => req.nextUrl.searchParams.has(key))) {
      const target = new URL(req.url);
      target.pathname = "/map/";
      return NextResponse.redirect(target);
    }
    return NextResponse.next();
  }
  if (path === "/map" || path === "/map/") {
    return NextResponse.next();
  }
  const legacyLanguage = languages.find(
    (lng) => path === `/${lng}` || path === `/${lng}/`,
  );
  if (legacyLanguage) {
    const target = new URL(req.url);
    target.pathname = `/${legacyLanguage}/map/`;
    return NextResponse.redirect(target);
  }
  // 路徑已經帶語系前綴就 pass
  if (
    languages.some((l: string) => path === `/${l}` || path.startsWith(`/${l}/`))
  ) {
    return NextResponse.next();
  }

  // 否則導向 fallback 或從 userConfig/header 取語言。path 一定要保留 —
  // 之前這裡漏掉 path,任何不帶 locale 前綴的深連結（例如密碼重設信裡的
  // /reset-password?token=...）都會被導到首頁，query string 留著但整個
  // pathname 被吃掉。
  const lng = fallbackLng;
  const redirectUrl = new URL(`/${lng}${path}${req.nextUrl.search}`, req.url);
  return NextResponse.redirect(redirectUrl);
}
