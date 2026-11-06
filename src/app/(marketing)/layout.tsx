import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./marketing.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-landing-latin" });
export const metadata: Metadata = {
  metadataBase: new URL("https://map.yuzen.dev"),
  title: "無障礙智慧地圖｜每一段路，都有你的走法",
  description:
    "依你的需要規劃每一程。探索一般與輪椅模式、大眾運輸、人行道路段與沿途坡度，透過 AI 助理尋找地點，出發前看懂路線。",
  icons: { icon: "/logo.ico" },
  alternates: { canonical: "/" },
  openGraph: {
    title: "無障礙智慧地圖｜每一段路，都有你的走法",
    description: "設施探索、路線規劃、大眾運輸。依你的需要，規劃每一程。",
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
    <html lang="zh-Hant-TW">
      <body className={geist.variable}>{children}</body>
    </html>
  );
}
