import type { Metadata, Viewport } from "next";
import {
  Geist,
  Instrument_Serif,
  Noto_Sans_TC,
  Noto_Serif_TC,
} from "next/font/google";
import { ThemeProvider } from "@/components/provider/ThemeProvider";
import "./marketing.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const notoSansTC = Noto_Sans_TC({
  subsets: ["latin"],
  variable: "--font-noto-tc",
  weight: ["400", "500", "700"],
});
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument",
});
const notoSerifTC = Noto_Serif_TC({
  subsets: ["latin"],
  variable: "--font-noto-serif-tc",
  weight: ["500", "700"],
  preload: false,
});
export const metadata: Metadata = {
  metadataBase: new URL("https://map.yuzen.dev"),
  title: "無障礙智慧地圖｜每一段路，都有你的走法",
  description:
    "無障礙智慧地圖 App，把適合自己的走法帶在身邊。探索一般與輪椅路線、語音導航、即時公車與語音助理，也能直接使用網頁版。",
  icons: { icon: "/logo.ico" },
  alternates: { canonical: "/" },
  openGraph: {
    title: "無障礙智慧地圖｜每一段路，都有你的走法",
    description:
      "無障礙智慧地圖 App，整合設施探索、路線規劃、語音導航、即時公車與語音助理。依你的需要，規劃每一程。",
    url: "/",
    siteName: "無障礙智慧地圖",
    locale: "zh_TW",
    type: "website",
    images: [
      {
        url: "/landing/route-desktop.webp",
        width: 1440,
        height: 1000,
        alt: "無障礙智慧地圖實際路線規劃畫面",
      },
    ],
  },
  robots: { index: true, follow: true },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-Hant-TW" suppressHydrationWarning>
      <body
        className={`${geist.variable} ${notoSansTC.variable} ${instrumentSerif.variable} ${notoSerifTC.variable}`}
      >
        <ThemeProvider defaultTheme="system" attribute="class" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
