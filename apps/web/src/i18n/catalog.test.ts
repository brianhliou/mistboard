import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type AppI18nDomain,
  appTranslationKeys,
  CRITICAL_I18N_KEYS,
  hasAppTranslation,
  loadAppI18nDomains,
  t,
} from './catalog.js';
import { CRITICAL_PLAY_I18N_KEYS } from './catalogs/play.js';
import { SUPPORTED_LOCALES } from './locale.js';

describe('app i18n catalog', () => {
  // Loading the domains also registers every lazy zh locale chunk, so the
  // synchronous t()/hasAppTranslation assertions below see full catalogs.
  let domains: readonly AppI18nDomain[] = [];
  beforeAll(async () => {
    domains = await loadAppI18nDomains();
  });

  it('has an English source string for every app key', () => {
    const missing = appTranslationKeys().filter((key) => t(key, {}, 'en').trim() === '');
    expect(missing).toEqual([]);
  });

  it('has every critical key translated in outreach locales', () => {
    const locales = SUPPORTED_LOCALES.filter((locale) => locale !== 'en');
    const missing: string[] = [];
    for (const locale of locales) {
      for (const key of CRITICAL_I18N_KEYS) {
        if (!hasAppTranslation(locale, key)) missing.push(`${locale}:${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  describe('Gomoku bot copy', () => {
    const keys = [
      'live.gomokuBotThinking',
      'live.gomokuBotFailed',
      'live.gomokuBotPaused',
      'live.gomokuBotRetry',
      'live.gomokuBotSource',
    ] as const;

    it.each(keys)('%s stays in critical play coverage', (key) => {
      expect(CRITICAL_PLAY_I18N_KEYS).toContain(key);
    });

    describe.each(['zh-Hans', 'zh-Hant'] as const)('%s', (locale) => {
      it.each(keys)('%s has Chinese copy without English fallback', (key) => {
        expect(hasAppTranslation(locale, key)).toBe(true);
        expect(t(key, {}, locale)).not.toBe(t(key, {}, 'en'));
        expect(t(key, {}, locale)).toMatch(/\p{Script=Han}/u);
      });
    });
  });

  it('keeps every key in exactly one domain with locale and critical keys in bounds', () => {
    const owners = new Map<string, string>();

    for (const domain of domains) {
      for (const key of Object.keys(domain.english)) {
        expect(domain.prefixes, `${key} belongs to the ${domain.name} domain`).toContain(
          key.split('.')[0],
        );
        expect(owners.get(key), `${key} is owned by more than one domain`).toBeUndefined();
        owners.set(key, domain.name);
      }

      for (const locale of Object.values(domain.locales)) {
        expect(Object.keys(locale).filter((key) => !(key in domain.english))).toEqual([]);
      }
      expect(domain.critical.filter((key) => !(key in domain.english))).toEqual([]);
    }

    expect([...owners.keys()].sort()).toEqual(appTranslationKeys().sort());
  });

  it('interpolates params and falls back to English for non-critical gaps', () => {
    expect(t('play.playingNow', { count: 3 }, 'zh-Hant')).toBe('3 局正在進行');
    expect(t('play.unavailable', {}, 'en')).toBe('Unavailable');
  });

  it('keeps Patron support separate from future paid products', () => {
    const patronCopy = [
      t('patron.heroTitle', {}, 'en'),
      t('patron.intro', {}, 'en'),
      t('patron.perk', {}, 'en'),
      t('patron.faqPerkAnswer', {}, 'en'),
    ].join(' ');

    expect(patronCopy).toContain('Core play and learning stay free');
    expect(patronCopy).toContain('Separate paid tools or products may exist later');
    expect(patronCopy).not.toMatch(/games are free\. forever|nothing .*locked behind/i);
  });

  // Guards the bundle-size win: the zh catalogs must only be reachable through
  // the dynamic imports in catalog.ts. One static `import ... from` edge from
  // any module in src/ puts ~110 KB of zh strings back in the entry chunk for
  // every visitor, and nothing else would fail.
  it('keeps zh catalog modules out of the static import graph', () => {
    // Vitest rewrites import.meta.url to an http URL under happy-dom; the
    // workspace root (apps/web) is the test cwd, so resolve src/ from there.
    const srcRoot = join(process.cwd(), 'src');
    // The per-locale aggregators are the intended owners of the static edges
    // to the per-domain zh files; they are only ever loaded via import().
    const allowed = new Set([
      join(srcRoot, 'i18n', 'locales', 'zh-hans.ts'),
      join(srcRoot, 'i18n', 'locales', 'zh-hant.ts'),
    ]);
    const staticZhImport = /from\s+['"][^'"]*zh-han[st](?:\.js)?['"]/;

    const offenders: string[] = [];
    for (const entry of readdirSync(srcRoot, { recursive: true, encoding: 'utf-8' })) {
      if (!entry.endsWith('.ts')) continue;
      const filePath = join(srcRoot, entry);
      if (allowed.has(filePath)) continue;
      if (staticZhImport.test(readFileSync(filePath, 'utf-8'))) offenders.push(entry);
    }
    expect(offenders).toEqual([]);
  });
});
