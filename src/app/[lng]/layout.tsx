import type { Metadata } from "next";
import "@/app/globals.css";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { Analytics } from "@vercel/analytics/next";
import { dir } from "i18next";
import type { Viewport } from "next";
import { Geist, Geist_Mono, Noto_Sans_TC } from "next/font/google";

import ClientLayout from "@/components/layout/client-layout";
import MapProvider from "@/components/provider/GoogleMapProvider";
import { ThemeProvider } from "@/components/provider/ThemeProvider";
import { Toaster } from "@/components/ui/sonner";
import type { languages } from "@/i18n/setting";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// CJK text falls through Geist to Noto Sans TC — matches the reference
// mockup's rounder, friendlier Chinese type.
const notoSansTC = Noto_Sans_TC({
  variable: "--font-noto-tc",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export function generateStaticParams() {
  return [{ lng: "zh-TW" }, { lng: "en" }];
}

export const metadata: Metadata = {
  metadataBase: new URL("https://map.yuzen.dev"),
  itunes: {
    appId: "6820790448",
  },
  title: "無障礙智慧地圖 - Accessible Smart Map",

  description:
    "無障礙智慧地圖 - Accessible Smart Map 一款專為無障礙設計的地圖，並且支援路線規劃，讓身障人士也能輕鬆找到適合自己的路線。",
  icons: {
    icon: "/logo.ico",
  },
  alternates: {
    canonical: "/",
    languages: {
      "zh-TW": "/zh-TW/",
      en: "/en/",
    },
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  openGraph: {
    title: "無障礙智慧地圖 - Accessible Smart Map",
    description:
      "無障礙智慧地圖 - Accessible Smart Map 一款專為無障礙設計的地圖，支援無障礙設施查詢、即時公車動態與無障礙路線規劃。",
    url: "https://map.yuzen.dev",
    siteName: "無障礙智慧地圖",
    locale: "zh_TW",
    type: "website",
  },
};
// No maximumScale/userScalable lock — that violated WCAG 1.4.4 (low-vision
// users need pinch-to-zoom). It likely existed to dodge iOS Safari's
// auto-zoom-on-focus behavior, but the actual fix for that is keeping every
// input's font-size at 16px+ (see components/ui/input.tsx's `text-base`),
// not disabling zoom for everyone.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};
export default async function RootLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ lng: (typeof languages)[number] }>;
}>) {
  const { lng } = await params;

  return (
    <html suppressHydrationWarning={true} lang={lng} dir={dir(lng)}>
      <head>
        <link
          href="https://fonts.googleapis.com/icon?family=Material+Symbols+Outlined"
          rel="stylesheet"
        ></link>
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${notoSansTC.variable} antialiased`}
      >
        <MapProvider>
          <GoogleOAuthProvider
            clientId={process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID ?? ""}
          >
            <ThemeProvider defaultTheme="system" attribute="class" enableSystem>
              <ClientLayout>
                {children}
                <Analytics />
              </ClientLayout>
            </ThemeProvider>
          </GoogleOAuthProvider>
        </MapProvider>
        <Toaster />
      </body>
    </html>
  );
}
