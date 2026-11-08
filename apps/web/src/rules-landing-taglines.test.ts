import { afterEach, expect, it, vi } from 'vitest';
import { crawlerCharCount, crawlerContentText } from '../../../scripts/lib/crawler-text.mjs';
import { CRAWLER_CONTENT_MANIFEST } from '../../server/src/crawler-content-manifest.js';
import { crawlerCopyProblems } from '../scripts/prerender-copy-check.mjs';
import { hasTranslation, translateArticle } from './article-i18n.js';
import { buildRulesIndex } from './articles.js';
import { articles } from './articles-data.js';
import { ensureLocaleCatalog } from './i18n/catalog.js';
import { type Locale, SUPPORTED_LOCALES } from './i18n/locale.js';
import { renderRulesIndexShellForPrerender } from './pages-static.js';

afterEach(() => vi.unstubAllEnvs());

// Inspect actual rendered tiles, so a newly listed game cannot escape this
// contract by being absent from a hand-kept list of slugs.
function taglineProblems(page: ParentNode, locale: Locale): string[] {
  return [...page.querySelectorAll('.rules-landing-tile')].flatMap((tile) => {
    const href = tile.getAttribute('href');
    const text = tile.querySelector('.rules-landing-tile-tagline')?.textContent?.trim();
    if (!text) return [`${href}: missing tagline`];
    if (locale !== 'en' && (!/\p{Script=Han}/u.test(text) || /\p{Script=Latin}/u.test(text)))
      return [`${href}: untranslated tagline`];
    return [];
  });
}

it.each(SUPPORTED_LOCALES)('every %s tile uses its article tagline', async (locale) => {
  await ensureLocaleCatalog(locale);
  const lang = locale === 'en' ? undefined : locale;
  const page = buildRulesIndex(lang);
  const tiles = [...page.querySelectorAll('.rules-landing-tile')];
  expect(tiles.length).toBeGreaterThan(0);
  expect(taglineProblems(page, locale)).toEqual([]);
  for (const tile of tiles) {
    const slug = tile.getAttribute('href')!.split('/').at(-1);
    const source = articles.find((article) => article.kind === 'rules' && article.slug === slug);
    if (source?.kind !== 'rules') throw new Error(`missing rules article: ${slug}`);
    expect(source.tagline?.trim(), slug).toBeTruthy();
    expect(source.tagline!.length, slug).toBeLessThan(70);
    if (lang) expect(hasTranslation(lang, source.tagline!), slug).toBe(true);
    const localized = lang ? translateArticle(source, lang) : source;
    if (localized.kind !== 'rules') throw new Error(`not a rules article: ${slug}`);
    expect(tile.querySelector('.rules-landing-tile-tagline')?.textContent, slug).toBe(
      localized.tagline,
    );
  }
});

it.each(['zh-Hans', 'zh-Hant'] as const)(
  '%s rejects a planted article whose tagline has no zh overlay',
  async (lang) => {
    await ensureLocaleCatalog(lang);
    const source = articles.find((article) => article.slug === 'xiangqi');
    if (source?.kind !== 'rules') throw new Error('missing xiangqi fixture');
    const original = source.tagline;
    try {
      // The real translateArticle fallback retains English when the zh key is
      // missing. Checking non-emptiness alone would silently accept this.
      source.tagline = 'A planted English tagline without a Chinese translation.';
      expect(taglineProblems(buildRulesIndex(lang), lang)).toEqual([
        `/${lang.toLowerCase()}/rules/xiangqi: untranslated tagline`,
      ]);
      delete source.tagline;
      expect(taglineProblems(buildRulesIndex(lang), lang)).toEqual([
        `/${lang.toLowerCase()}/rules/xiangqi: missing tagline`,
      ]);
    } finally {
      source.tagline = original;
    }
  },
);

// The supplied chess and Three Kingdoms copy also needs overlays, although
// these two articles are currently absent from the public picker.
it.each(['chess', 'three-kingdoms-banqi'])(
  '%s has a tagline ready in every locale without changing its listing',
  (slug) => {
    const source = articles.find((article) => article.slug === slug);
    if (source?.kind !== 'rules') throw new Error(`missing rules article: ${slug}`);
    expect(source.tagline?.trim()).toBeTruthy();
    for (const lang of ['zh-Hans', 'zh-Hant'] as const) {
      expect(hasTranslation(lang, source.tagline!)).toBe(true);
      const localized = translateArticle(source, lang);
      if (localized.kind !== 'rules') throw new Error(`not a rules article: ${slug}`);
      expect(localized.tagline).toMatch(/\p{Script=Han}/u);
      expect(localized.tagline).not.toMatch(/\p{Script=Latin}/u);
    }
  },
);

it.each(SUPPORTED_LOCALES)(
  '%s crawler copy contains exactly the screen content and records the higher baseline',
  async (locale) => {
    await ensureLocaleCatalog(locale);
    // Match the production public list, without local-only playtest flags.
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_THREE_KINGDOMS_BANQI_ENABLED', 'false');
    const lang = locale === 'en' ? undefined : locale;
    const client = buildRulesIndex(lang);
    const html = await renderRulesIndexShellForPrerender(lang);
    expect(crawlerCopyProblems(html)).toEqual([]);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const copy = doc.querySelector('.crawler-copy');
    expect(copy).not.toBeNull();
    expect(copy!.querySelector('main')?.outerHTML).toBe(client.outerHTML);
    expect(taglineProblems(copy!, locale)).toEqual([]);
    for (const tile of client.querySelectorAll('.rules-landing-tile-tagline')) {
      expect(copy!.textContent).toContain(tile.textContent);
    }
    const path = `${locale === 'en' ? '' : `/${locale.toLowerCase()}`}/rules`;
    const contract = CRAWLER_CONTENT_MANIFEST.find((entry) => entry.path === path)!;
    const chars = crawlerCharCount(crawlerContentText(html));
    expect(chars, path).toBe(contract.baselineChars);
    expect(chars, path).toBeGreaterThanOrEqual(contract.minChars);
  },
);
