import type { Metadata } from "next";
import type { ReactNode } from "react";
import {
  getPolicyLocale,
  policyHref,
  policyLocales,
  policyUi,
} from "@/content/policy-localization";
import "../policies.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://map.yuzen.dev"),
  robots: { index: true, follow: true },
};

export function generateStaticParams() {
  return policyLocales.map((lng) => ({ lng }));
}

export const dynamicParams = false;

export default async function LegalLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ lng: string }>;
}) {
  const locale = getPolicyLocale((await params).lng);
  const ui = policyUi[locale];
  return (
    <html lang={locale === "en" ? "en" : "zh-Hant-TW"}>
      <body className="policy-body">
        <a className="policy-skip" href="#policy-content">
          {ui.skip}
        </a>
        <header className="policy-header">
          <a className="policy-brand" href={`/${locale}/`}>
            {ui.brand}
          </a>
          <nav aria-label={ui.documents}>
            <a href={policyHref(locale, "privacy-policy")}>{ui.privacy}</a>
            <a href={policyHref(locale, "terms-of-use")}>{ui.terms}</a>
          </nav>
        </header>
        {children}
        <footer className="policy-footer">
          <span>
            {ui.brand} · {ui.documents}
          </span>
          <a href="#policy-content">{ui.backToTop}</a>
        </footer>
      </body>
    </html>
  );
}
