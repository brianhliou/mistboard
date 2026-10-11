// The article and rules pages' card URLs, as the prerender writes them into
// og:image and the Article JSON-LD. The server draws the cards
// (apps/server/src/og-image.ts) and cannot be imported from the web build, so
// the three facts the URLs depend on are mirrored here and pinned to the server's
// copies by og-image.test.ts: a bump on one side that misses the other ships a
// card scrapers never refetch, or an aspect URL the server answers with a 404.

/** Mirrors ARTICLE_OG_IMAGE_VERSION in apps/server/src/og-image.ts. Scrapers
 *  hold a card under its URL with a year-long immutable max-age, so the LOOK of
 *  a card can only change behind a new ?v=. */
export const ARTICLE_OG_IMAGE_VERSION = 5;

/** The shapes Google asks for in an Article's `image` (it crops a single wide
 *  card to a square in some surfaces, which cut the caption), widest first. */
export const ARTICLE_OG_ASPECTS = ['16x9', '4x3', '1x1'] as const;

/** Mirrors the keys of CUSTOM_ARTICLE_OG_SVGS in apps/server/src/og-image.ts:
 *  hand-drawn cards (charts, timelines, photos, art compositions) that have no
 *  board to re-frame, so they have no aspect versions and keep the one wide
 *  card in their JSON-LD. */
export const ARTICLE_OG_WIDE_ONLY_SLUGS: readonly string[] = [
  'server-enforced-fog',
  'skill-vs-luck',
  'shogi4',
  'misty',
  'yin-sheng',
  'cao-yanlei',
  'lai-ly-huynh',
  'tony-fung-ga-zen',
  'xiangqi-champions',
  'xiangqi-world-championship',
  'how-puzzle-mining-works',
  'banqi-statistics',
  'one-thousand-games',
];

/** Mirrors ARTICLE_OG_ZH_SLUGS in apps/server/src/og-image.ts: pages whose
 *  card is a xiangqi-family board, which their zh pages show in the traditional
 *  (hanzi) set, as the site draws the pieces for a zh reader, captioned with
 *  the page's own zh title. Any other slug's `lang=` URL is a 404. */
export const ARTICLE_OG_ZH_SLUGS: readonly string[] = [
  'xiangqi',
  'fog-xiangqi',
  'jieqi',
  'banqi',
  'fortress-xiangqi',
  'duck-xiangqi',
  'atomic-xiangqi',
  'crazyhouse-xiangqi',
  'pikafish',
];

/** The card language a page in `lang` (an html lang or a route prefix:
 *  zh-Hans, zh-hant, en, vi, or none) shows for `slug`: its script's zh card,
 *  or null for the English one. */
function zhCardLang(slug: string, lang?: string | null): 'zh-hans' | 'zh-hant' | null {
  const prefix = lang?.toLowerCase();
  if (prefix !== 'zh-hans' && prefix !== 'zh-hant') return null;
  return ARTICLE_OG_ZH_SLUGS.includes(slug) ? prefix : null;
}

/** The wide 2400x1260 card: og:image and twitter:image. */
export function articleOgImageUrl(host: string, slug: string, lang?: string | null): string {
  const base = `${host}/og/article/${encodeURIComponent(slug)}.png?v=${ARTICLE_OG_IMAGE_VERSION}`;
  const zh = zhCardLang(slug, lang);
  return zh ? `${base}&lang=${zh}` : base;
}

/** The Article JSON-LD `image`: the 16:9, 4:3 and 1:1 cards, or the one wide
 *  card for a slug whose card has no aspect versions. */
export function articleStructuredDataImage(
  host: string,
  slug: string,
  lang?: string | null,
): string | string[] {
  const wide = articleOgImageUrl(host, slug, lang);
  if (ARTICLE_OG_WIDE_ONLY_SLUGS.includes(slug)) return wide;
  return ARTICLE_OG_ASPECTS.map((aspect) => `${wide}&aspect=${aspect}`);
}
