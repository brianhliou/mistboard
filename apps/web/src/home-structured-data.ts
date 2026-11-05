// JSON-LD for the prerendered homepage, one set per interface language (/,
// /zh-hans, /zh-hant). Baked by scripts/prerender-articles.mjs into the page
// head so crawlers read it without running the app; nothing renders it.
//
// Three documents, each in its own script tag like the article pages, so a
// malformed one cannot take the other down:
// - WebSite: the site's name and the URL of this language's home page (what
//   Google's site-name docs ask for on the home page).
// - WebApplication: the play surface. Google documents browser games under
//   Software App (WebApplication), with the enumerated category value
//   GameApplication; offers.price 0 says free. The description is the locale's
//   own homepage meta description, so the two never say different things.
// - Organization: one site-wide identity, logo and official profiles, shared
//   by every locale. Search images use the existing card in their own frames;
//   the wide social card stays in og:image and twitter:image.
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
  const origin = new URL(url).origin;
  const organizationId = `${origin}/#organization`;
  const image = [
    { aspect: '1x1', width: 1200, height: 1200 },
    { aspect: '4x3', width: 1600, height: 1200 },
    { aspect: '16x9', width: 1920, height: 1080 },
  ].map(({ aspect, width, height }) => ({
    '@type': 'ImageObject',
    url: `${origin}/home-card-${aspect}.png`,
    width,
    height,
  }));
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'Mistboard',
      url,
      inLanguage,
      image,
      publisher: { '@id': organizationId },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: 'Mistboard',
      url,
      inLanguage,
      description,
      image,
      publisher: { '@id': organizationId },
      applicationCategory: 'GameApplication',
      operatingSystem: 'Any',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      '@id': organizationId,
      name: 'Mistboard',
      url: `${origin}/`,
      logo: `${origin}/logo-512.png`,
      sameAs: [
        'https://www.youtube.com/@Mistboard',
        'https://x.com/Mistboard',
        'https://github.com/brianhliou/mistboard',
      ],
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
