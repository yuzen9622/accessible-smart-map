import type { Metadata } from "next";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lng: string }>;
}): Promise<Metadata> {
  const { lng } = await params;
  const canonical = lng === "en" ? "/en/map/" : "/map/";
  return {
    alternates: { canonical, languages: { "zh-TW": "/map/", en: "/en/map/" } },
    openGraph: { url: canonical },
  };
}

export default function MapLayout({ children }: { children: React.ReactNode }) {
  return children;
}
