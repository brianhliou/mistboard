import { afterEach, describe, expect, it } from 'vitest';
import { buildChampions, CHAMPIONS, TITLE_HISTORY } from './champions-page.js';
import { mountContribute } from './contribute-page.js';
import { mountCreators } from './creators-page.js';
import { ensureLocaleCatalog, type I18nKey, t } from './i18n/catalog.js';
import { EN_CONTENT } from './i18n/catalogs/content.js';
import type { Locale } from './i18n/locale.js';

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

  // One card per game with a bot on prod (`npm run variants -- --prod`): the
  // reigning champion is the bot you play; a house engine holds an open title.
  it('has one card per game naming its champion or open-title holder', () => {
    const page = buildChampions('en');
    const cards = [...page.querySelectorAll<HTMLElement>('.champions-card')];
    expect(cards).toHaveLength(CHAMPIONS.length);
    expect(cards.map((card) => card.querySelector('h3')?.textContent)).toEqual([
      'Jieqi',
      'Banqi',
      'Jungle Chess',
      'Flip Jungle',
    ]);
    const holder = (game: string) =>
      page.querySelector(`.champions-card[data-game="${game}"] .champions-holder`)?.textContent;
    expect(holder('jieqi')).toBe('Reigning champion: AB-JChess');
    expect(holder('jungle')).toBe('Reigning champion: KataGo-AnimalChess');
    expect(holder('banqi')).toBe('Holder: MistyBanqi (house engine, title open)');
    expect(holder('jungle-flip')).toBe('Holder: Misty (house engine, title open)');
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

  it('says how each reigning champion took its title, with the games and write-up', () => {
    const page = buildChampions('en');
    const jieqi = page.querySelector('.champions-card[data-game="jieqi"]')?.textContent ?? '';
    expect(jieqi).toContain(
      'Took the title on 2026-09-30 from Pikafish Level 8, 248-136-16 over 400 games (write-up, games).',
    );
    const jungle = page.querySelector('.champions-card[data-game="jungle"]')?.textContent ?? '';
    expect(jungle).toContain(
      'Took the title on 2026-09-22 from MistyJungle, 82-0 with 118 draws over 200 games at 1,000 visits a move',
    );
    for (const game of ['banqi', 'jungle-flip']) {
      const card = page.querySelector(`.champions-card[data-game="${game}"]`);
      expect(card?.textContent, game).not.toContain('Took the title');
    }
  });

  it('lists the title history newest first, then the challenge rules', () => {
    const page = buildChampions('en');
    const headings = [...page.querySelectorAll('h2')].map((h) => h.textContent);
    expect(headings).toEqual(['Title history', 'Challenge for a title']);
    const history = [...page.querySelectorAll('h2 + .champions-list')][0]!;
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
      for (const key of CHAMPION_KEYS) {
        const text = t(key, {}, locale);
        expect(text, `${locale}:${key}`).not.toMatch(/—/);
        if (locale !== 'en' && !/(Separator|paren)/.test(key)) {
          expect(text, `${locale}:${key} is untranslated`).not.toBe(t(key, {}, 'en'));
        }
      }
      const body = buildChampions(locale).textContent ?? '';
      expect(body).not.toMatch(/mahjong|luzhanqi|麻将|麻將|陆战棋|陸戰棋|Fairy-Stockfish/i);
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
