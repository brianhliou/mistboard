// JSON-LD for the prerendered homepage, one set per interface language (/,
// /zh-hans, /zh-hant). Baked by scripts/prerender-articles.mjs into the page
// head so crawlers read it without running the app; nothing renders it.
//
// Two documents, each in its own script tag like the article pages, so a
// malformed one cannot take the other down:
// - WebSite: the site's name and the URL of this language's home page (what
//   Google's site-name docs ask for on the home page).
// - WebApplication: the play surface. Google documents browser games under
//   Software App (WebApplication), with the enumerated category value
//   GameApplication; offers.price 0 says free. The description is the locale's
//   own homepage meta description, so the two never say different things.
export type HomeStructuredDataInput = {
  /** BCP 47 tag the page declares in <html lang>: en, zh-Hans or zh-Hant. */
  inLanguage: string;
  /** The page's canonical URL. */
  url: string;
  /** The page's meta description. */
  description: string;
};

export function homeStructuredData(input: HomeStructuredDataInput): Record<string, unknown>[] {
  const { inLanguage, url, description } = input;
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'Mistboard',
      url,
      inLanguage,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: 'Mistboard',
      url,
      inLanguage,
      description,
      applicationCategory: 'GameApplication',
      operatingSystem: 'Any',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    },
  ];
}

/** The documents as script tags for a page head; `<` is escaped so no string can close the tag. */
export function homeStructuredDataScripts(input: HomeStructuredDataInput): string {
  return homeStructuredData(input)
    .map(
      (doc) =>
        `<script type="application/ld+json">${JSON.stringify(doc).replace(/</g, '\\u003c')}</script>`,
    )
    .join('');
}
