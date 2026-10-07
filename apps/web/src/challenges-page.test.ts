import { afterEach, describe, expect, it } from 'vitest';
import { buildChallenges, CHALLENGE_SEATS } from './challenges-page.js';
import { mountContribute } from './contribute-page.js';
import { mountCreators } from './creators-page.js';
import { ensureLocaleCatalog, type I18nKey, t } from './i18n/catalog.js';
import { EN_CONTENT } from './i18n/catalogs/content.js';
import type { Locale } from './i18n/locale.js';

const LOCALES: readonly Locale[] = ['en', 'zh-Hans', 'zh-Hant'];
const CHALLENGE_KEYS = Object.keys(EN_CONTENT).filter((key) =>
  key.startsWith('challenges.'),
) as I18nKey[];

function hrefs(root: HTMLElement): string[] {
  return [...root.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
}

describe('/challenges', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  // A scoreboard, not an ask list: one row per game with a bot on prod
  // (`npm run variants -- --prod`), each naming the holder and what takes it.
  it('has one seat row per game, each linking its rules and its current bot', () => {
    const page = buildChallenges('en');
    const rows = [...page.querySelectorAll('.challenges-table tbody tr')];
    expect(rows.map((row) => row.querySelector('th')?.textContent)).toEqual([
      'Jieqi',
      'Banqi',
      'Jungle Chess',
      'Flip Jungle',
    ]);
    expect(rows).toHaveLength(CHALLENGE_SEATS.length);
    for (const row of rows) expect(row.querySelectorAll('td')).toHaveLength(2);
    const links = hrefs(page);
    for (const href of [
      '/rules/jieqi',
      '/rules/banqi',
      '/rules/jungle',
      '/rules/jungle-flip',
      '/bot/ab-jchess',
      '/bot/katago',
      'https://github.com/brianhliou/misty-banqi',
      'https://github.com/brianhliou/misty-jungle',
      'https://github.com/brianhliou/misty-flip-jungle',
    ]) {
      expect(links, href).toContain(href);
    }
  });

  it('links each won match to its write-up and games on mistboard', () => {
    const page = buildChallenges('en');
    const links = hrefs(page);
    for (const href of ['/blog/ab-jchess', '/blog/katago-jungle', '/data', '/study/0t8xpyv6']) {
      expect(links, href).toContain(href);
    }
    expect(page.textContent).toContain('248-136-16 over 400 games');
    expect(page.textContent).toContain('82-0 with 118 draws over 200 games at 1,000 visits');
    expect(page.textContent).toContain('A match may be extended past 200 games.');
  });

  it('renders in Chinese with locale-prefixed content links', async () => {
    for (const locale of ['zh-Hans', 'zh-Hant'] as const) {
      await ensureLocaleCatalog(locale);
      const page = buildChallenges(locale);
      const prefix = locale === 'zh-Hans' ? '/zh-hans' : '/zh-hant';
      expect(page.querySelector('h1')?.textContent).toBe(t('challenges.heading', {}, locale));
      expect(page.querySelector('h1')?.textContent).not.toBe('Engine challenges');
      const links = hrefs(page);
      expect(links).toContain(`${prefix}/rules/jieqi`);
      expect(links).toContain(`${prefix}/blog/ab-jchess`);
      expect(links).toContain('/bot/ab-jchess');
    }
  });

  // Public copy: no em dashes, nothing translated left blank, and none of the
  // asks the brianhliou.com page carried (mahjong reader, later variants).
  it('keeps every string translated, em-dash free, and free of asks', async () => {
    for (const locale of LOCALES) {
      if (locale !== 'en') await ensureLocaleCatalog(locale);
      for (const key of CHALLENGE_KEYS) {
        const text = t(key, {}, locale);
        expect(text, `${locale}:${key}`).not.toMatch(/—/);
        if (locale !== 'en' && !/(Separator|paren)/.test(key)) {
          expect(text, `${locale}:${key} is untranslated`).not.toBe(t(key, {}, 'en'));
        }
      }
      const body = buildChallenges(locale).textContent ?? '';
      expect(body).not.toMatch(/mahjong|luzhanqi|麻将|麻將|陆战棋|陸戰棋|Fairy-Stockfish/i);
    }
  });

  it('is linked from /creators and /contribute', () => {
    for (const mount of [mountCreators, mountContribute]) {
      const root = document.createElement('div');
      document.body.append(root);
      mount(root);
      expect(root.querySelector('.static-prose a[href="/challenges"]'), mount.name).not.toBeNull();
      root.remove();
    }
  });
});
