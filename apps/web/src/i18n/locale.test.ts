import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyAccountLocalePreference,
  currentLocale,
  initializeLocaleFromCurrentUrl,
  LOCALE_STORAGE_KEY,
  localeFromLanguageTag,
  localeFromPath,
  localeSwitchNavigation,
  localizedHref,
  resolveLocale,
  stripLocalePrefix,
} from './locale.js';

describe('locale helpers', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: memoryStorage(),
    });
  });

  afterEach(() => {
    window.localStorage.removeItem(LOCALE_STORAGE_KEY);
    window.history.replaceState(null, '', '/');
    vi.restoreAllMocks();
  });

  it('detects locales from current path prefixes', () => {
    expect(localeFromPath('/zh-hans/rules/banqi')).toBe('zh-Hans');
    expect(localeFromPath('/zh-hant/blog')).toBe('zh-Hant');
    expect(localeFromPath('/ja')).toBeNull();
    expect(localeFromPath('/rules/banqi')).toBeNull();
  });

  it('maps browser language tags to supported locales', () => {
    expect(localeFromLanguageTag('zh-TW')).toBe('zh-Hant');
    expect(localeFromLanguageTag('zh-CN')).toBe('zh-Hans');
    expect(localeFromLanguageTag('ja-JP')).toBeNull();
    expect(localeFromLanguageTag('fr-FR')).toBeNull();
  });

  // Regression: these all fell through an exact-match allowlist to Simplified.
  // zh-Hant-HK is the canonical BCP-47 tag for Hong Kong Traditional, so the
  // readers most likely to notice the wrong script were the ones getting it.
  it('reads the Traditional script from any subtag position', () => {
    expect(localeFromLanguageTag('zh-Hant-HK')).toBe('zh-Hant');
    expect(localeFromLanguageTag('zh-Hant-MO')).toBe('zh-Hant');
    expect(localeFromLanguageTag('zh-Hant')).toBe('zh-Hant');
    expect(localeFromLanguageTag('zh-cht')).toBe('zh-Hant');
    expect(localeFromLanguageTag('zh-HK')).toBe('zh-Hant');
    expect(localeFromLanguageTag('zh-MO')).toBe('zh-Hant');
  });

  it('prefers an explicit script over the region', () => {
    expect(localeFromLanguageTag('zh-Hans-HK')).toBe('zh-Hans');
    expect(localeFromLanguageTag('zh-Hant-CN')).toBe('zh-Hant');
  });

  it('defaults unmarked Chinese tags to Simplified', () => {
    expect(localeFromLanguageTag('zh')).toBe('zh-Hans');
    expect(localeFromLanguageTag('zh-SG')).toBe('zh-Hans');
    expect(localeFromLanguageTag('zh-MY')).toBe('zh-Hans');
    expect(localeFromLanguageTag('zh-Hans-CN')).toBe('zh-Hans');
  });

  // Cantonese readers are concentrated in HK/MO, where the written form is
  // Traditional. Bare `yue` therefore defaults the opposite way to bare `zh`.
  it('routes Cantonese to Chinese rather than the English fallback', () => {
    expect(localeFromLanguageTag('yue')).toBe('zh-Hant');
    expect(localeFromLanguageTag('yue-HK')).toBe('zh-Hant');
    expect(localeFromLanguageTag('yue-Hant-HK')).toBe('zh-Hant');
  });

  it('lets an explicit script or mainland region override the Cantonese default', () => {
    expect(localeFromLanguageTag('yue-Hans')).toBe('zh-Hans');
    expect(localeFromLanguageTag('yue-CN')).toBe('zh-Hans');
  });

  it('maps English tags including irregular suffixes', () => {
    expect(localeFromLanguageTag('en')).toBe('en');
    expect(localeFromLanguageTag('en-GB-oxendict')).toBe('en');
    expect(localeFromLanguageTag('en-US@posix')).toBe('en');
  });

  it('reports which input decided the locale', () => {
    stubBrowserLanguages(['zh-Hant-HK']);

    expect(resolveLocale()).toEqual({
      browserTag: 'zh-Hant-HK',
      locale: 'zh-Hant',
      source: 'browser',
    });

    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'zh-Hans');
    expect(resolveLocale().source).toBe('stored');
    expect(resolveLocale().locale).toBe('zh-Hans');

    window.history.replaceState(null, '', '/zh-hant/blog');
    expect(resolveLocale().source).toBe('path');
    expect(resolveLocale().locale).toBe('zh-Hant');
  });

  it('reports the default source when nothing matches', () => {
    stubBrowserLanguages(['fr-FR']);

    expect(resolveLocale()).toEqual({
      browserTag: 'fr-FR',
      locale: 'en',
      source: 'default',
    });
  });

  it('persists a locale from localized content URLs', () => {
    window.history.replaceState(null, '', '/zh-hant/rules/banqi');

    expect(initializeLocaleFromCurrentUrl()).toBe('zh-Hant');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('zh-Hant');
    expect(document.documentElement.lang).toBe('zh-Hant');
  });

  it('falls back from a dormant stored locale outside localized content URLs', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'ja');

    expect(currentLocale()).toBe('en');
  });

  it('falls back from a dormant account locale preference', () => {
    expect(applyAccountLocalePreference('ja')).toBe(false);
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('applies account locale preferences on unprefixed URLs', () => {
    expect(applyAccountLocalePreference('zh-Hant')).toBe(true);
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('zh-Hant');
    expect(document.documentElement.lang).toBe('zh-Hant');
    expect(currentLocale()).toBe('zh-Hant');
  });

  it('does not let account locale override explicit URL prefixes', () => {
    window.history.replaceState(null, '', '/zh-hans/rules/banqi');

    expect(applyAccountLocalePreference('zh-Hant')).toBe(false);
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
    expect(currentLocale()).toBe('zh-Hans');
  });

  it('keeps localized article and rules hrefs in supported content locales', () => {
    expect(localizedHref('/rules/banqi?play=1', 'zh-Hant')).toBe('/zh-hant/rules/banqi?play=1');
    expect(localizedHref('/blog/misty', 'zh-Hans')).toBe('/zh-hans/blog/misty');
    expect(localizedHref('/account?tab=login', 'zh-Hant')).toBe('/account?tab=login');
  });

  it('strips existing locale prefixes before rebuilding hrefs', () => {
    expect(stripLocalePrefix('/zh-hant/rules/banqi#top')).toBe('/rules/banqi#top');
    expect(localizedHref('/zh-hans/rules/banqi', 'zh-Hant')).toBe('/zh-hant/rules/banqi');
  });

  it('reloads instead of navigating when the localized URL differs only by fragment', () => {
    // /feed has no locale prefix, so the target URL equals the current one;
    // assigning it to location.href with a hash is a fragment navigation and
    // never reloads, so the switcher must reload explicitly.
    expect(localeSwitchNavigation('/feed#2026-09-02-embed', 'zh-Hant')).toEqual({ kind: 'reload' });
    expect(localeSwitchNavigation('/puzzles#daily', 'zh-Hans')).toEqual({
      kind: 'reload',
    });
    // The course carries a locale prefix since 2026-09-22 (the Chinese course
    // had no indexable URL before), so the switcher navigates, fragment intact.
    expect(localeSwitchNavigation('/learn/xiangqi#/openings/3', 'zh-Hans')).toEqual({
      kind: 'navigate',
      href: '/zh-hans/learn/xiangqi#/openings/3',
    });
    expect(localeSwitchNavigation('/api-docs?x=1#tag-games', 'zh-Hant')).toEqual({
      kind: 'reload',
    });
    expect(localeSwitchNavigation('/feed', 'zh-Hant')).toEqual({ kind: 'reload' });
    expect(localeSwitchNavigation('/zh-hant/rules/banqi#setup', 'zh-Hant')).toEqual({
      kind: 'reload',
    });
  });

  it('navigates when the locale changes the path prefix, keeping the fragment', () => {
    expect(localeSwitchNavigation('/rules/banqi#setup', 'zh-Hant')).toEqual({
      kind: 'navigate',
      href: '/zh-hant/rules/banqi#setup',
    });
    expect(localeSwitchNavigation('/zh-hans/blog/misty?ref=x#top', 'en')).toEqual({
      kind: 'navigate',
      href: '/blog/misty?ref=x#top',
    });
  });
});

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

function stubBrowserLanguages(languages: string[]): void {
  Object.defineProperty(window.navigator, 'languages', {
    configurable: true,
    value: languages,
  });
  Object.defineProperty(window.navigator, 'language', {
    configurable: true,
    value: languages[0] ?? '',
  });
}
