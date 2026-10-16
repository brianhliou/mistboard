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
});
