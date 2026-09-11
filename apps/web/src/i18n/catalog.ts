// App translation catalog. English is statically bundled: it is the fallback
// for every lookup and the compile-time key authority (I18nKey below plus the
// per-domain `satisfies` checks in catalogs/*.zh-*.ts). The zh catalogs ship
// as lazy per-locale chunks (src/i18n/locales/*) so an English-only visitor
// never downloads them; the bootstrap in main.ts awaits ensureLocaleCatalog()
// before first render, after which t() stays fully synchronous.
import { CRITICAL_ACCOUNT_I18N_KEYS, EN_ACCOUNT } from './catalogs/account.js';
import { CRITICAL_COMMUNITY_I18N_KEYS, EN_COMMUNITY } from './catalogs/community.js';
import { CRITICAL_CONTENT_I18N_KEYS, EN_CONTENT } from './catalogs/content.js';
import { CRITICAL_EDITOR_I18N_KEYS, EN_EDITOR } from './catalogs/editor.js';
import { CRITICAL_PLAY_I18N_KEYS, EN_PLAY } from './catalogs/play.js';
import { CRITICAL_REVIEW_I18N_KEYS, EN_REVIEW } from './catalogs/review.js';
import { CRITICAL_SHELL_I18N_KEYS, EN_SHELL } from './catalogs/shell.js';
import { currentLocale, type Locale } from './locale.js';

type I18nParams = Record<string, number | string>;

export type ZhLocale = Exclude<Locale, 'en'>;

export type AppI18nDomain = {
  critical: readonly string[];
  english: Readonly<Record<string, string>>;
  locales: Readonly<Record<ZhLocale, Readonly<Record<string, string>>>>;
  name: string;
  prefixes: readonly string[];
};

type AppI18nDomainDef = Omit<AppI18nDomain, 'locales'> & { name: DomainName };

type DomainName = 'shell' | 'content' | 'account' | 'community' | 'play' | 'review' | 'editor';

const APP_I18N_DOMAIN_DEFS: readonly AppI18nDomainDef[] = [
  {
    name: 'shell',
    prefixes: [
      'nav',
      'home',
      'site',
      'footer',
      'notFound',
      'connection',
      'lag',
      'prefs',
      'homePuzzle',
      'homeForum',
    ],
    english: EN_SHELL,
    critical: CRITICAL_SHELL_I18N_KEYS,
  },
  {
    name: 'content',
    prefixes: [
      'videos',
      'articles',
      'rules',
      'news',
      'patron',
      'contact',
      'about',
      'stats',
      'source',
      'contribute',
      'developers',
      'apiDocs',
      'thanks',
      'faq',
      'terms',
      'privacy',
    ],
    english: EN_CONTENT,
    critical: CRITICAL_CONTENT_I18N_KEYS,
  },
  {
    name: 'account',
    prefixes: ['account'],
    english: EN_ACCOUNT,
    critical: CRITICAL_ACCOUNT_I18N_KEYS,
  },
  {
    name: 'community',
    prefixes: [
      'profile',
      'inbox',
      'friends',
      'following',
      'chat',
      'title',
      'verifyTitle',
      'coach',
      'streamer',
      'challenge',
      'forum',
    ],
    english: EN_COMMUNITY,
    critical: CRITICAL_COMMUNITY_I18N_KEYS,
  },
  {
    name: 'play',
    prefixes: [
      'game',
      'play',
      'lobby',
      'setup',
      'variant',
      'live',
      'result',
      'puzzle',
      'correspondence',
    ],
    english: EN_PLAY,
    critical: CRITICAL_PLAY_I18N_KEYS,
  },
  {
    name: 'review',
    // 'study' and 'analysis' ride the review domain: both surfaces ARE the
    // review shell, so their chrome loads with the same lazy chunk rather than
    // a chunk apiece.
    // 'underboard', 'annotate', 'engine' and 'review' are the board chrome
    // itself (tab strip, annotation editor, local-engine widget, controls),
    // which loads with this same chunk.
    prefixes: [
      'replay',
      'watch',
      // 'games' is the current-games page (/games), a watch surface whose
      // cards mount the same live tenant renderers, so it rides this chunk.
      'games',
      'study',
      // /practice links straight into study chapters and is played in the same
      // shell, so its chrome rides the same lazy chunk rather than a chunk of
      // its own.
      'practice',
      'analysis',
      'historical',
      'broadcast',
      'underboard',
      'annotate',
      'engine',
      'review',
      'summary',
    ],
    english: EN_REVIEW,
    critical: CRITICAL_REVIEW_I18N_KEYS,
  },
  {
    // The board editor (/editor) is its own surface: it has no engine, no
    // move list, and none of the review chrome, so its copy is its own chunk
    // rather than a ride on the review one.
    name: 'editor',
    prefixes: ['editor'],
    english: EN_EDITOR,
    critical: CRITICAL_EDITOR_I18N_KEYS,
  },
];

const EN = {
  ...EN_SHELL,
  ...EN_CONTENT,
  ...EN_ACCOUNT,
  ...EN_COMMUNITY,
  ...EN_PLAY,
  ...EN_REVIEW,
  ...EN_EDITOR,
} as const;

export type I18nKey = keyof typeof EN;

type LocaleDomainCatalogs = Readonly<Record<DomainName, Readonly<Record<string, string>>>>;

// The typed loader table is the only edge to the zh modules, and it is a
// dynamic import: Rollup emits one chunk per locale, fetched only when the
// visitor's locale needs it. The return type checks that each locale module
// covers every domain name.
const LOCALE_LOADERS: Record<ZhLocale, () => Promise<{ domains: LocaleDomainCatalogs }>> = {
  'zh-Hans': () => import('./locales/zh-hans.js'),
  'zh-Hant': () => import('./locales/zh-hant.js'),
};

const loadedDomains: Partial<Record<ZhLocale, LocaleDomainCatalogs>> = {};
const loadedCatalogs: Partial<Record<ZhLocale, Partial<Record<I18nKey, string>>>> = {};
const localeLoads: Partial<Record<ZhLocale, Promise<void>>> = {};

// Under SSR (the prerender and i18n:check scripts load this module through
// ssrLoadModule) and under vitest, register every locale before the module
// graph finishes evaluating: those environments call t() for zh locales
// synchronously, without the browser bootstrap's ensureLocaleCatalog await.
// Both conditions are statically false in the client build, so the branch and
// its top-level await are dead-code-eliminated from the entry chunk (the
// bundle-size guard in catalog.test.ts plus the release smokes would catch a
// regression here).
if (import.meta.env.SSR || import.meta.env.MODE === 'test') {
  await Promise.all(
    (Object.keys(LOCALE_LOADERS) as ZhLocale[]).map((locale) => ensureLocaleCatalog(locale)),
  );
}

// Loads and registers a locale's catalog chunk; resolved (and idempotent) for
// locales already registered, immediate for English. Callers that render
// localized copy must await this once per page load before the first t() call;
// afterwards t() is synchronous. Rejects on a failed chunk fetch (the caller
// picks the fallback policy) and clears the memo so a later call can retry.
export function ensureLocaleCatalog(locale: Locale): Promise<void> {
  if (locale === 'en') return Promise.resolve();
  let pending = localeLoads[locale];
  if (!pending) {
    pending = LOCALE_LOADERS[locale]().then((module) => {
      loadedDomains[locale] = module.domains;
      loadedCatalogs[locale] = mergeDomainCatalogs(module.domains);
    });
    pending.catch(() => {
      if (localeLoads[locale] === pending) delete localeLoads[locale];
    });
    localeLoads[locale] = pending;
  }
  return pending;
}

// Structural view for the i18n checker and catalog tests: the same fully
// populated domain shape the old static APP_I18N_DOMAINS export carried, now
// behind an await of every locale chunk. Runtime lookups should use t() and
// ensureLocaleCatalog instead.
export async function loadAppI18nDomains(): Promise<readonly AppI18nDomain[]> {
  await Promise.all(
    (Object.keys(LOCALE_LOADERS) as ZhLocale[]).map((locale) => ensureLocaleCatalog(locale)),
  );
  return APP_I18N_DOMAIN_DEFS.map((def) => ({
    ...def,
    locales: {
      'zh-Hans': loadedDomains['zh-Hans']?.[def.name] ?? {},
      'zh-Hant': loadedDomains['zh-Hant']?.[def.name] ?? {},
    },
  }));
}

export const CRITICAL_I18N_KEYS = [
  ...CRITICAL_SHELL_I18N_KEYS,
  ...CRITICAL_CONTENT_I18N_KEYS,
  ...CRITICAL_ACCOUNT_I18N_KEYS,
  ...CRITICAL_COMMUNITY_I18N_KEYS,
  ...CRITICAL_PLAY_I18N_KEYS,
  ...CRITICAL_REVIEW_I18N_KEYS,
  ...CRITICAL_EDITOR_I18N_KEYS,
] as const satisfies readonly I18nKey[];

export function t(key: I18nKey, params: I18nParams = {}, locale: Locale = currentLocale()): string {
  const template = translationFor(locale, key);
  return interpolate(template, params);
}

export function hasAppTranslation(locale: Locale, key: I18nKey): boolean {
  if (locale === 'en') return key in EN;
  return loadedCatalogs[locale]?.[key] !== undefined;
}

export function appTranslationKeys(): I18nKey[] {
  return Object.keys(EN) as I18nKey[];
}

function translationFor(locale: Locale, key: I18nKey): string {
  if (locale === 'en') return EN[key];
  // English fallback covers both untranslated keys and a locale chunk that has
  // not been registered yet (bootstrap awaits ensureLocaleCatalog, so the
  // latter only happens when the chunk failed to load).
  return loadedCatalogs[locale]?.[key] ?? EN[key];
}

function mergeDomainCatalogs(domains: LocaleDomainCatalogs): Partial<Record<I18nKey, string>> {
  const merged: Record<string, string> = {};
  for (const catalog of Object.values(domains)) Object.assign(merged, catalog);
  return merged as Partial<Record<I18nKey, string>>;
}

function interpolate(template: string, params: I18nParams): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) =>
    params[name] === undefined ? match : String(params[name]),
  );
}
