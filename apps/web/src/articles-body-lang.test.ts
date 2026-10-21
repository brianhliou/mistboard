import { afterEach, describe, expect, it } from 'vitest';
import { buildArticlePage } from './articles.js';
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

// A Vietnamese page is left out of the blog index by design, so the link
// between the two pages of a pair is the only crawlable path to it; until
// 2026-10-21 /blog/lai-ly-huynh-co-tuong had none (articles/language-pairs.ts).
describe('cross-language link', () => {
  it('links the English article to its Vietnamese page, named in Vietnamese', () => {
    useUiLocale('en');
    const link =
      buildArticlePage('lai-ly-huynh').querySelector<HTMLAnchorElement>('.article-meta-language');
    expect(link?.getAttribute('href')).toBe('/blog/lai-ly-huynh-co-tuong');
    expect(link?.getAttribute('hreflang')).toBe('vi');
    expect(link?.textContent).toBe('Tiếng Việt');
  });

  it('links the Vietnamese page back to English', () => {
    useUiLocale('en');
    const link =
      buildArticlePage('lai-ly-huynh-co-tuong').querySelector<HTMLAnchorElement>(
        '.article-meta-language',
      );
    expect(link?.getAttribute('href')).toBe('/blog/lai-ly-huynh');
    expect(link?.textContent).toBe('English');
  });

  it('draws no language link on an article without a partner', () => {
    useUiLocale('en');
    expect(buildArticlePage(SLUG).querySelector('.article-meta-language')).toBeNull();
  });
});
