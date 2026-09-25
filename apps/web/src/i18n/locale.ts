export type Locale = 'en' | 'zh-Hans' | 'zh-Hant';

export const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'zh-Hans', 'zh-Hant'];

export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_STORAGE_KEY = 'mistboard.locale';

export type LocaleMeta = {
  dateLocale: string;
  displayName: string;
  htmlLang: string;
  pathPrefix: string;
};

export const LOCALE_META: Record<Locale, LocaleMeta> = {
  en: {
    dateLocale: 'en-US',
    displayName: 'English',
    htmlLang: 'en',
    pathPrefix: '',
  },
  'zh-Hans': {
    dateLocale: 'zh-CN',
    displayName: '简体中文',
    htmlLang: 'zh-Hans',
    pathPrefix: '/zh-hans',
  },
  'zh-Hant': {
    dateLocale: 'zh-TW',
    displayName: '繁體中文',
    htmlLang: 'zh-Hant',
    pathPrefix: '/zh-hant',
  },
};

export function isLocale(value: string | null | undefined): value is Locale {
  return SUPPORTED_LOCALES.includes(value as Locale);
}

export function isArticleLocale(
  locale: Locale | null | undefined,
): locale is 'zh-Hans' | 'zh-Hant' {
  return locale === 'zh-Hans' || locale === 'zh-Hant';
}

export function localeFromPath(pathname = currentPathname()): Locale | null {
  const lower = pathname.toLowerCase();
  if (lower === '/zh-hans' || lower.startsWith('/zh-hans/')) return 'zh-Hans';
  if (lower === '/zh-hant' || lower.startsWith('/zh-hant/')) return 'zh-Hant';
  return null;
}

export function storedLocale(): Locale | null {
  try {
    const raw = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function setStoredLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Storage can be unavailable in private mode or tests.
  }
}

export function browserLocale(): Locale | null {
  if (typeof navigator === 'undefined') return null;
  const languages = navigator.languages.length > 0 ? navigator.languages : [navigator.language];
  for (const language of languages) {
    const locale = localeFromLanguageTag(language);
    if (locale) return locale;
  }
  return null;
}

// Regions that pin a script regardless of the language subtag. Neither list is
// exhaustive; an unlisted region falls through to the per-language default.
const ZH_HANT_REGIONS = new Set(['tw', 'hk', 'mo']);
const ZH_HANS_REGIONS = new Set(['cn', 'sg', 'my']);

// Matched against any subtag, not just the script position: `zh-Hant-HK` is the
// canonical BCP-47 tag for Hong Kong Traditional, and the legacy `zh-cht` /
// `zh-chs` forms put the script where a region would normally sit. An earlier
// exact-match allowlist missed both and fell through to Simplified, so a Hong
// Kong reader was served the wrong script.
const ZH_HANT_SCRIPTS = new Set(['hant', 'cht']);
const ZH_HANS_SCRIPTS = new Set(['hans', 'chs']);

// Cantonese resolves to a Chinese locale rather than the English fallback: its
// readers are concentrated in Hong Kong and Macau, and written Cantonese there
// is Traditional. Only the default differs from `zh` — an explicit script or a
// mainland region still decides, so `yue-CN` is Simplified.
const DEFAULT_SCRIPT_BY_LANGUAGE: Record<string, Locale> = {
  yue: 'zh-Hant',
  zh: 'zh-Hans',
};

export function localeFromLanguageTag(language: string | null | undefined): Locale | null {
  if (!language) return null;
  const subtags = language.toLowerCase().split('-');
  const primary = subtags[0];
  if (primary === 'en') return 'en';
  const fallback = primary ? DEFAULT_SCRIPT_BY_LANGUAGE[primary] : undefined;
  if (!fallback) return null;
  // An explicit script wins over the region: `zh-Hans-HK` is Simplified.
  if (subtags.some((subtag) => ZH_HANT_SCRIPTS.has(subtag))) return 'zh-Hant';
  if (subtags.some((subtag) => ZH_HANS_SCRIPTS.has(subtag))) return 'zh-Hans';
  if (subtags.some((subtag) => ZH_HANT_REGIONS.has(subtag))) return 'zh-Hant';
  if (subtags.some((subtag) => ZH_HANS_REGIONS.has(subtag))) return 'zh-Hans';
  return fallback;
}

// Which input decided the locale. Reported with the resolution so we can tell a
// visitor we routed from their browser (a guess we might be getting wrong) apart
// from one who picked a language themselves (a guess they already corrected).
export type LocaleSource = 'path' | 'stored' | 'browser' | 'default';

export type LocaleResolution = {
  browserTag: string | null;
  locale: Locale;
  source: LocaleSource;
};

// The raw first entry of navigator.languages, unmapped. Carried through so the
// tag distribution is visible in telemetry: localeFromLanguageTag above folds
// unknown tags into a supported locale silently, and the raw tag is the only way
// to catch a fold that is wrong.
function primaryBrowserTag(): string | null {
  if (typeof navigator === 'undefined') return null;
  const languages = navigator.languages.length > 0 ? navigator.languages : [navigator.language];
  return languages[0] ?? null;
}

export function resolveLocale(): LocaleResolution {
  const browserTag = primaryBrowserTag();
  const fromPath = localeFromPath();
  if (fromPath) return { browserTag, locale: fromPath, source: 'path' };
  const fromStorage = storedLocale();
  if (fromStorage) return { browserTag, locale: fromStorage, source: 'stored' };
  const fromBrowser = browserLocale();
  if (fromBrowser) return { browserTag, locale: fromBrowser, source: 'browser' };
  return { browserTag, locale: DEFAULT_LOCALE, source: 'default' };
}

export function currentLocale(): Locale {
  return resolveLocale().locale;
}

export function applyAccountLocalePreference(locale: string | null | undefined): boolean {
  if (!locale || localeFromPath()) return false;
  const previous = currentLocale();
  const supportedLocale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  setStoredLocale(supportedLocale);
  applyDocumentLocale(supportedLocale);
  return previous !== supportedLocale;
}

export function initializeLocaleFromCurrentUrl(): Locale {
  const pathLocale = localeFromPath();
  if (pathLocale) setStoredLocale(pathLocale);
  const locale = currentLocale();
  applyDocumentLocale(locale);
  return locale;
}

export function applyDocumentLocale(locale: Locale): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = LOCALE_META[locale].htmlLang;
}

export function localizedHref(path: string, locale = currentLocale()): string {
  if (!path.startsWith('/')) return path;
  const { pathname, suffix } = splitPathSuffix(stripLocalePrefix(path));
  const prefix = contentLocalePrefix(locale);
  if (!prefix || !isContentPath(pathname)) return `${pathname}${suffix}`;
  return `${prefix}${pathname}${suffix}`;
}

export type LocaleSwitchNavigation = { kind: 'navigate'; href: string } | { kind: 'reload' };

// How the language switcher should leave the page once the new locale is
// stored. Only the home page, /rules, /blog and /learn/xiangqi carry a locale
// prefix, so on every other route localizedHref hands back the current URL
// unchanged. Assigning an identical
// URL to location.href normally reloads, but when the URL carries a fragment
// (/feed#id, /learn#/stage, /api-docs#tag) the browser treats it as a
// same-document fragment navigation and reloads nothing, leaving the page in
// the old language until a manual refresh. Reload explicitly in that case.
export function localeSwitchNavigation(
  currentHref: string,
  locale: Locale,
): LocaleSwitchNavigation {
  const href = localizedHref(currentHref, locale);
  const { pathname: nextPath, suffix: nextSuffix } = splitPathSuffix(href);
  const { pathname: currentPath, suffix: currentSuffix } = splitPathSuffix(currentHref);
  const nextSearch = nextSuffix.split('#')[0];
  const currentSearch = currentSuffix.split('#')[0];
  if (nextPath === currentPath && nextSearch === currentSearch) return { kind: 'reload' };
  return { kind: 'navigate', href };
}

export function contentLocalePrefix(locale: Locale): string {
  if (locale === 'zh-Hans' || locale === 'zh-Hant') return LOCALE_META[locale].pathPrefix;
  return '';
}

export function stripLocalePrefix(path: string): string {
  const { pathname, suffix } = splitPathSuffix(path);
  const lower = pathname.toLowerCase();
  for (const locale of SUPPORTED_LOCALES) {
    const prefix = LOCALE_META[locale].pathPrefix;
    if (!prefix) continue;
    if (lower === prefix || lower.startsWith(`${prefix}/`)) {
      const stripped = pathname.slice(prefix.length) || '/';
      return `${stripped}${suffix}`;
    }
  }
  return path;
}

function isContentPath(pathname: string): boolean {
  return (
    pathname === '/' ||
    pathname === '/rules' ||
    pathname.startsWith('/rules/') ||
    pathname === '/blog' ||
    pathname.startsWith('/blog/') ||
    pathname === '/learn/xiangqi' ||
    // 象棋人机对战: the bot directory has Chinese URLs, so a link or the
    // language switcher on it lands a Chinese reader on /zh-hans/bots.
    pathname === '/bots'
  );
}

function splitPathSuffix(path: string): { pathname: string; suffix: string } {
  const match = path.match(/^([^?#]*)(.*)$/);
  return {
    pathname: match?.[1] || '/',
    suffix: match?.[2] || '',
  };
}

function currentPathname(): string {
  return typeof window === 'undefined' ? '/' : window.location.pathname;
}
