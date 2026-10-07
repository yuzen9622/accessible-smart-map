import { type Policy, policyRevision } from "@/content/policies";
import {
  getOperatorDetails,
  type PolicyLocale,
  policyHref,
  policyLocales,
  policyUi,
} from "@/content/policy-localization";

export default function PolicyDocument({
  policy,
  locale,
}: {
  policy: Policy;
  locale: PolicyLocale;
}) {
  const ui = policyUi[locale];
  const kind = policy.path.endsWith("terms-of-use")
    ? "terms-of-use"
    : "privacy-policy";
  const otherKind = kind === "terms-of-use" ? "privacy-policy" : "terms-of-use";
  return (
    <main id="policy-content" className="policy-main" tabIndex={-1}>
      <nav className="policy-languages" aria-label={ui.languages}>
        {policyLocales.map((language) => (
          <a
            key={language}
            href={policyHref(language, kind)}
            lang={language}
            hrefLang={language}
            aria-current={language === locale ? "page" : undefined}
          >
            {language === "en" ? "English" : "繁體中文"}
          </a>
        ))}
      </nav>
      <div className="policy-heading">
        <p className="policy-eyebrow">
          {ui.brand} / {ui.documents}
        </p>
        <h1>{policy.title}</h1>
        {locale === "zh-TW" && (
          <p className="policy-english" lang="en">
            {policy.englishTitle}
          </p>
        )}
        <p className="policy-version">
          {ui.updated}
          <time dateTime={policyRevision}>{policyRevision}</time>
        </p>
        <p className="policy-intro">{policy.introduction}</p>
      </div>

      <dl className="policy-operator">
        {getOperatorDetails(locale).map(({ label, value, href }) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{href ? <a href={href}>{value}</a> : value}</dd>
          </div>
        ))}
      </dl>

      <div className="policy-grid">
        <nav
          className="policy-toc"
          aria-label={`${policy.title}: ${ui.contents}`}
        >
          <p>{ui.contents}</p>
          <ol>
            {policy.sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`}>{section.title}</a>
              </li>
            ))}
          </ol>
        </nav>

        <article className="policy-article" aria-label={policy.title}>
          {policy.sections.map((section) => (
            <section key={section.id} id={section.id}>
              <h2>{section.title}</h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              {section.table && (
                <section
                  className="policy-table-scroll"
                  aria-label={`${section.title}: ${ui.table}`}
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard focus enables scrolling this overflow region.
                  tabIndex={0}
                >
                  <table>
                    <caption>{section.title}</caption>
                    <thead>
                      <tr>
                        {section.table.headings.map((heading) => (
                          <th key={heading} scope="col">
                            {heading}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {section.table.rows.map((row) => (
                        <tr key={row[0]}>
                          {row.map((cell, index) =>
                            index === 0 ? (
                              <th key={cell} scope="row">
                                {cell}
                              </th>
                            ) : (
                              <td key={cell}>{cell}</td>
                            ),
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}
              {section.items && (
                <ul>
                  {section.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
          <div className="policy-related">
            <p>{ui.related}</p>
            <a href={policyHref(locale, otherKind)}>
              {otherKind === "privacy-policy" ? ui.readPrivacy : ui.readTerms}
            </a>
          </div>
        </article>
      </div>
    </main>
  );
}
