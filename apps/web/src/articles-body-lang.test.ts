import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';
import { isArticleTranslationPublished } from './article-i18n.js';
import { CROSS_LANGUAGE_PAIRS } from './articles/language-pairs.js';
import { buildArticlePage } from './articles.js';
import { articles } from './articles-data.js';
import { LOCALE_STORAGE_KEY } from './i18n/locale.js';

// The page chrome (table of contents, dates, <html lang>) follows the site UI
// language by design (5c2385b3), so an English article can sit in a zh-Hant
// shell. The article's own text carries its language on the element, so screen
// readers, browser translate and hyphenation read English as English there,
// and Chinese as Chinese under an English UI.

function useUiLocale(locale: string): void {
  const data = new Map<string, string>([[LOCALE_STORAGE_KEY, locale]]);
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
      clear: () => data.clear(),
      key: () => null,
      length: data.size,
    },
  });
}

afterEach(() => {
  Object.defineProperty(window, 'localStorage', { configurable: true, value: undefined });
});

const SLUG = 'cao-yanlei';

describe('article content language', () => {
  it('marks an English article lang="en" under a zh-Hant site', () => {
    useUiLocale('zh-Hant');
    const page = buildArticlePage(SLUG);
    // The chrome stays in the UI language...
    expect(page.querySelector('.article-toc-title')?.textContent).toBe('本頁內容');
    // ...and the article's text says it is English.
    expect(page.querySelector('.article-body')?.getAttribute('lang')).toBe('en');
    expect(page.querySelector('.article-title')?.getAttribute('lang')).toBe('en');
  });

  it('marks a zh-Hant article lang="zh-Hant" under an English site', () => {
    useUiLocale('en');
    const page = buildArticlePage(SLUG, 'zh-Hant');
    expect(page.querySelector('.article-body')?.getAttribute('lang')).toBe('zh-Hant');
    expect(page.querySelector('.article-title')?.getAttribute('lang')).toBe('zh-Hant');
  });

  it('marks a zh-Hans article lang="zh-Hans"', () => {
    useUiLocale('en');
    const page = buildArticlePage(SLUG, 'zh-Hans');
    expect(page.querySelector('.article-body')?.getAttribute('lang')).toBe('zh-Hans');
  });

  it('marks a Vietnamese article lang="vi", not the en it is derived from', () => {
    useUiLocale('en');
    const page = buildArticlePage('lai-ly-huynh-co-tuong');
    expect(page.querySelector('.article-title')?.getAttribute('lang')).toBe('vi');
    expect(page.querySelector('.article-body')?.getAttribute('lang')).toBe('vi');
  });
});

describe('cross-language link', () => {
  it.each(CROSS_LANGUAGE_PAIRS)('omits the Vietnamese link on $en', ({ en }) => {
    useUiLocale('en');
    expect(buildArticlePage(en).querySelector('.article-meta-language')).toBeNull();
  });

  it.each(CROSS_LANGUAGE_PAIRS)('links $vi back to English in its byline', ({ en, vi }) => {
    useUiLocale('en');
    const page = buildArticlePage(vi!);
    const link = page.querySelector<HTMLAnchorElement>('.article-meta-language');
    const target = articles.find((article) => article.slug === en)!;
    expect(link?.getAttribute('href')).toBe(`/${target.kind === 'rules' ? 'rules' : 'blog'}/${en}`);
    expect(link?.getAttribute('hreflang')).toBe('en');
    expect(link?.getAttribute('lang')).toBe('en');
    expect(link?.textContent).toBe('English');
    const byline = page.querySelector('.article-meta-byline');
    expect(link?.parentElement).toBe(byline);
    expect(byline?.textContent).toMatch(/ · English$/);
  });

  it('draws no language link on an article without a partner', () => {
    useUiLocale('en');
    expect(buildArticlePage(SLUG).querySelector('.article-meta-language')).toBeNull();
  });

  it('keeps the prerendered hreflang group for the English and Vietnamese pages', () => {
    // Exercise the unchanged build-time group builder without running the entire
    // site build. Its dependencies are the real catalog and language-pair table.
    const prerender = readFileSync('scripts/prerender-articles.mjs', 'utf8');
    const groupBuilder = prerender.slice(
      prerender.indexOf('  const englishRootOf = new Map();'),
      prerender.indexOf('  let count = 0;'),
    );
    expect(groupBuilder).toContain('const translationGroupLinks =');
    const links = runInNewContext(
      `${groupBuilder}\n[translationGroupLinks(publishedBySlug.get('jieqi-platform')), translationGroupLinks(publishedBySlug.get('co-up'))]`,
      {
        CROSS_LANGUAGE_PAIRS,
        publishedBySlug: new Map(articles.map((article) => [article.slug, article])),
        host: 'https://mistboard.test',
        isArticleTranslationPublished,
      },
    );
    const expected = [
      ['en', '/blog/jieqi-platform'],
      ['zh-Hans', '/zh-hans/blog/jieqi-platform'],
      ['zh-Hant', '/zh-hant/blog/jieqi-platform'],
      ['vi', '/blog/co-up'],
      ['x-default', '/blog/jieqi-platform'],
    ]
      .map(
        ([lang, path]) =>
          `<link rel="alternate" hreflang="${lang}" href="https://mistboard.test${path}" />`,
      )
      .join('');
    expect(links).toEqual([expected, expected]);
  });
});
