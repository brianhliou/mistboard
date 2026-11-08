// Sitemap admission follows the route table and the independent crawler contracts.
import { CRAWLER_CONTENT_MANIFEST, type CrawlerContentEntry } from './crawler-content-manifest.js';
import { CLIENT_ROUTE_PATTERNS, isNoindexRoute, legacyPageRedirect } from './server-policy.js';

export type SitemapAlternate = { lang: string; path: string };
export type SitemapEntry = { path: string; lastmod?: string; alternates?: SitemapAlternate[] };

export function sitemapContract(path: string): CrawlerContentEntry | undefined {
  const exact = CRAWLER_CONTENT_MANIFEST.find((entry) => entry.path === path);
  if (exact) return exact;
  // Exact contracts win over broad patterns such as /players/:slug and /rules/*.
  const patterns = CLIENT_ROUTE_PATTERNS.filter((row) => row.test(path));
  return CRAWLER_CONTENT_MANIFEST.find((entry) => patterns.some((row) => row.id === entry.routeId));
}

export function sitemapPathHasBody(path: string): boolean {
  const contract = sitemapContract(path);
  return !!contract && !contract.knownGap && !isNoindexRoute(path) && !legacyPageRedirect(path);
}

export const SITEMAP_STATIC_ROUTES: readonly string[] = CRAWLER_CONTENT_MANIFEST.filter(
  (entry) =>
    (['root', 'analysis', 'editor', 'localized-board'].includes(entry.routeId) ||
      CLIENT_ROUTE_PATTERNS.some((row) => row.id === entry.path && row.test(entry.path))) &&
    // These directories belong to their existing sitemap sections.
    entry.path !== '/players' &&
    entry.path !== '/broadcast/xiangqi' &&
    sitemapPathHasBody(entry.path),
).map((entry) => entry.path);

/** Also used by the server head: one shared group, including x-default. */
export function localeAlternates(basePath: string): SitemapAlternate[] {
  return [
    { lang: 'en', path: basePath },
    { lang: 'zh-Hans', path: `/zh-hans${basePath}` },
    { lang: 'zh-Hant', path: `/zh-hant${basePath}` },
    { lang: 'x-default', path: basePath },
  ];
}

function xml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function sitemapXml(entries: readonly SitemapEntry[], publicHost: string): string {
  const body = entries
    .map(({ path, lastmod, alternates }) => {
      const date = lastmod ? `<lastmod>${xml(lastmod)}</lastmod>` : '';
      const links = (alternates ?? [])
        .map(
          ({ lang, path }) =>
            `<xhtml:link rel="alternate" hreflang="${xml(lang)}" href="${xml(`${publicHost}${path}`)}"/>`,
        )
        .join('');
      return `  <url><loc>${xml(`${publicHost}${path}`)}</loc>${date}${links}</url>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${body}\n</urlset>\n`;
}
