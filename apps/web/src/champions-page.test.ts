import { afterEach, describe, expect, it } from 'vitest';
import { buildChampions, CHAMPIONS, OPEN_TITLES, TITLE_HISTORY, TITLES } from './champions-page.js';
import { mountContribute } from './contribute-page.js';
import { mountCreators } from './creators-page.js';
import { ensureLocaleCatalog, type I18nKey, t } from './i18n/catalog.js';
import { EN_CONTENT } from './i18n/catalogs/content.js';
import type { Locale } from './i18n/locale.js';
import { VARIANTS } from './variants.js';

const LOCALES: readonly Locale[] = ['en', 'zh-Hans', 'zh-Hant'];
const CHAMPION_KEYS = Object.keys(EN_CONTENT).filter((key) =>
  key.startsWith('champions.'),
) as I18nKey[];

function hrefs(root: HTMLElement): string[] {
  return [...root.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
}

describe('/champions', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  // One title per game with a bot on prod (`npm run variants -- --prod` and
  // /api/bots): a title won in a match is a hero card; the rest are open.
  it('shows the won titles as hero cards and every other game with a bot as open', () => {
    const page = buildChampions('en');
    const heroes = [...page.querySelectorAll<HTMLElement>('.champions-hero')];
    expect(heroes.map((card) => card.dataset.game)).toEqual(['jieqi', 'jungle']);
    expect(heroes.map((card) => card.querySelector('h3')?.textContent)).toEqual([
      'AB-JChess',
      'KataGo-AnimalChess',
    ]);
    expect(heroes.map((card) => card.querySelector('.champions-hero-game')?.textContent)).toEqual([
      'Jieqi',
      'Jungle Chess',
    ]);
    for (const card of heroes) {
      expect(card.querySelector('.champions-crown svg.ui-icon-title-champion')).not.toBeNull();
      expect(card.querySelector('.champions-crown')?.textContent).toBe('Champion');
      expect(card.querySelector('.variant-marker')).not.toBeNull();
    }

    const open = [...page.querySelectorAll<HTMLElement>('.champions-open')];
    expect(open.map((card) => card.dataset.game)).toEqual([
      'xiangqi',
      'banqi',
      'duck-xiangqi',
      'crazyhouse-xiangqi',
      'fortress-xiangqi',
      'dark-xiangqi',
      'dark-chess',
      'jungle-flip',
    ]);
    const holder = (game: string) =>
      page.querySelector<HTMLAnchorElement>(
        `.champions-open[data-game="${game}"] .champions-open-holder a`,
      );
    expect(holder('xiangqi')?.textContent).toBe('Pikafish');
    expect(holder('xiangqi')?.getAttribute('href')).toBe('/bot/pikafish');
    for (const game of ['banqi', 'dark-xiangqi', 'dark-chess', 'jungle-flip']) {
      expect(holder(game)?.textContent, game).toBe('Misty');
      expect(holder(game)?.getAttribute('href'), game).toBe('/bot/misty');
    }
    for (const game of ['duck-xiangqi', 'crazyhouse-xiangqi', 'fortress-xiangqi']) {
      expect(holder(game)?.textContent, game).toBe('Fairy-Stockfish Level 8');
      expect(holder(game)?.getAttribute('href'), game).toBe('/bot/fairy-stockfish-level-8');
    }
    for (const card of open) {
      expect(card.querySelector('.champions-open-badge')?.textContent).toBe('Title open');
      const cta = card.querySelector<HTMLAnchorElement>('a.champions-btn');
      expect(cta?.textContent).toBe('Challenge for this title');
      expect(cta?.getAttribute('href')).toBe('#challenge');
    }
    expect(page.querySelector('h2#challenge')?.textContent).toBe('Challenge for a title');
    expect(TITLES).toHaveLength(CHAMPIONS.length + OPEN_TITLES.length);
  });

  it('keeps the titles in the canonical variant order', () => {
    const canonical = VARIANTS.map((variant) => variant.miniId);
    const order = TITLES.map((title) => canonical.indexOf(title.gameId));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('gives each champion its match score, how it took the title, and its buttons', () => {
    const page = buildChampions('en');
    const card = (game: string) => page.querySelector(`.champions-hero[data-game="${game}"]`)!;
    const stats = (game: string) =>
      [...card(game).querySelectorAll('.champions-stat')].map(
        (stat) =>
          `${stat.querySelector('dd')?.textContent} ${stat.querySelector('dt')?.textContent}`,
      );
    // AB-JChess won 248, lost 136, drew 16 (the write-up's 64% score).
    expect(stats('jieqi')).toEqual(['248 wins', '16 draws', '136 losses']);
    expect(stats('jungle')).toEqual(['82 wins', '118 draws', '0 losses']);
    expect(card('jieqi').querySelector('.champions-bar')?.getAttribute('aria-label')).toBe(
      '248 wins, 16 draws, 136 losses',
    );
    // A zero count draws no segment.
    expect(card('jungle').querySelectorAll('.champions-bar > span')).toHaveLength(2);
    expect(card('jieqi').querySelector('.champions-took')?.textContent).toBe(
      'Took the title from Pikafish Level 8 on 2026-09-30, over 400 games, a 0.64 score.',
    );
    expect(card('jungle').querySelector('.champions-took')?.textContent).toContain(
      'from MistyJungle on 2026-09-22, over 200 games at 1,000 visits a move',
    );
    const buttons = (game: string) =>
      [...card(game).querySelectorAll<HTMLAnchorElement>('.champions-actions a')].map(
        (a) => `${a.textContent} ${a.getAttribute('href')}`,
      );
    expect(buttons('jieqi')).toEqual([
      'Read the match /blog/ab-jchess',
      'See the games /data',
      'Play the champion /bot/ab-jchess',
    ]);
    expect(buttons('jungle')).toEqual([
      'Read the match /blog/katago-jungle',
      'See the games /study/0t8xpyv6',
      'Play the champion /bot/katago',
    ]);
    expect(hrefs(card('jungle') as HTMLElement)).toContain(
      'https://github.com/brianhliou/misty-jungle',
    );
  });

  it('lists the title history newest first, then the challenge rules', () => {
    const page = buildChampions('en');
    const headings = [...page.querySelectorAll('h2')].map((h) => h.textContent);
    expect(headings).toEqual(['Open titles', 'Title history', 'Challenge for a title']);
    const history = page.querySelector('.champions-list')!;
    const lines = [...history.querySelectorAll('li')].map((li) => li.textContent ?? '');
    expect(lines).toHaveLength(TITLE_HISTORY.length);
    expect(lines[0]).toMatch(/^2026-09-30, Jieqi: AB-JChess/);
    expect(lines[1]).toMatch(/^2026-09-22, Jungle Chess: KataGo-AnimalChess/);
    const links = hrefs(page);
    for (const href of ['/blog/ab-jchess', '/blog/katago-jungle', '/data', '/study/0t8xpyv6']) {
      expect(links, href).toContain(href);
    }
    const body = page.textContent ?? '';
    expect(body).toContain('A match may be extended past 200 games.');
    expect(body).toContain('A score of 0.55 or better (about +35 Elo) takes the title.');
    expect(body).toContain('within two weeks of a submission and post the result either way');
    // The "What has been tried" section is gone (Brian, 2026-10-07).
    expect(body).not.toMatch(/What has been tried|ten nets|CLAP_CDC/);
  });

  it('renders in Chinese with locale-prefixed content links', async () => {
    for (const locale of ['zh-Hans', 'zh-Hant'] as const) {
      await ensureLocaleCatalog(locale);
      const page = buildChampions(locale);
      const prefix = locale === 'zh-Hans' ? '/zh-hans' : '/zh-hant';
      expect(page.querySelector('h1')?.textContent).toBe(
        locale === 'zh-Hans' ? '引擎冠军' : '引擎冠軍',
      );
      const links = hrefs(page);
      expect(links).toContain(`${prefix}/blog/ab-jchess`);
      expect(links).toContain('/bot/ab-jchess');
      const zhName = (game: string) =>
        page.querySelector(`[data-game="${game}"] h3`)?.textContent ?? '';
      expect(zhName('xiangqi')).toBe('象棋');
      expect(
        page.querySelector('[data-game="xiangqi"] .champions-open-holder a')?.textContent,
      ).toBe(locale === 'zh-Hans' ? '皮卡鱼' : '皮卡魚');
      expect(page.querySelector('[data-game="jieqi"] .champions-hero-game')?.textContent).toBe(
        '揭棋',
      );
    }
  });

  // Public copy: no em dashes, nothing translated left blank, and none of the
  // asks the brianhliou.com page carried (mahjong reader, later variants).
  // Fairy-Stockfish is named now: it holds three open titles.
  it('keeps every string translated, em-dash free, and free of asks', async () => {
    for (const locale of LOCALES) {
      if (locale !== 'en') await ensureLocaleCatalog(locale);
      for (const key of CHAMPION_KEYS) {
        const text = t(key, {}, locale);
        expect(text, `${locale}:${key}`).not.toMatch(/—/);
        if (locale !== 'en' && !/(Separator|paren)/.test(key)) {
          expect(text, `${locale}:${key} is untranslated`).not.toBe(t(key, {}, 'en'));
        }
      }
      const body = buildChampions(locale).textContent ?? '';
      expect(body).not.toMatch(/mahjong|luzhanqi|麻将|麻將|陆战棋|陸戰棋|ten nets/i);
    }
  });

  it('is linked from /creators and /contribute', () => {
    for (const mount of [mountCreators, mountContribute]) {
      const root = document.createElement('div');
      document.body.append(root);
      mount(root);
      expect(root.querySelector('.static-prose a[href="/champions"]'), mount.name).not.toBeNull();
      expect(root.querySelector('a[href="/challenges"]'), mount.name).toBeNull();
      root.remove();
    }
  });
});
