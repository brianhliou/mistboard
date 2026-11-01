import { afterEach, describe, expect, it, vi } from 'vitest';
import { enabledEngineCredits } from './engine-credits.js';
import { ensureLocaleCatalog } from './i18n/catalog.js';
import { buildThanks, fillEngineStats, type ThanksBot } from './thanks-page.js';

const bot = (over: Partial<ThanksBot> & { id: string }): ThanksBot => ({
  displayName: over.id,
  ownerType: 'system',
  supportedGameSpecIds: ['xiangqi'],
  gamesTotal: 0,
  ...over,
});

describe('thanks page', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ['en', 'Gomoku', 'networks', 'Browser build by Brian H. Liou'],
    ['zh-Hans', '五子棋', '神经网络', '浏览器构建：Brian H. Liou'],
    ['zh-Hant', '五子棋', '神經網路', '瀏覽器建置：Brian H. Liou'],
  ] as const)(
    'credits Rapfi, its networks and browser build in %s when enabled',
    async (locale, game, networks, build) => {
      await ensureLocaleCatalog(locale);
      vi.stubEnv('VITE_GOMOKU_ENABLED', 'true');
      const page = buildThanks(locale);
      const row = page.querySelector('[data-engine="rapfi"]');
      expect(row).not.toBeNull();
      expect(row?.textContent).toContain('dhbloo');
      expect(row?.textContent).toContain(game);
      expect(row?.textContent).toContain(networks);
      expect(row?.textContent).toContain(build);
      expect(row?.querySelector('.thanks-engine-by a')?.getAttribute('href')).toBe(
        'https://github.com/dhbloo/rapfi',
      );
      expect(
        row?.querySelector('a[href="https://github.com/brianhliou/rapfi-wasm"]'),
      ).not.toBeNull();
      expect(row?.querySelector('.thanks-engine-name a')?.getAttribute('href')).toBe(
        'https://github.com/dhbloo/rapfi',
      );

      fillEngineStats(
        page,
        Array.from({ length: 5 }, (_, i) =>
          bot({
            id: `rapfi-level-${i + 1}`,
            supportedGameSpecIds: ['gomoku'],
            gamesTotal: i + 1,
          }),
        ),
        locale,
      );
      expect(row?.querySelector('.thanks-engine-stat-games dd')?.textContent).toBe('15');
      expect(row?.querySelector('.thanks-engine-stat-rating dd')?.textContent).toBe('');
    },
  );

  it.each([false, true])(
    'hides Rapfi with the flag off, including bot enrichment (DEV=%s)',
    (dev) => {
      vi.stubEnv('DEV', dev);
      for (const flag of [undefined, 'false']) {
        vi.stubEnv('VITE_GOMOKU_ENABLED', flag);
        for (const locale of ['en', 'zh-Hans', 'zh-Hant'] as const) {
          const page = buildThanks(locale);
          fillEngineStats(
            page,
            [
              bot({
                id: 'rapfi-level-1',
                displayName: 'Rapfi',
                supportedGameSpecIds: ['gomoku'],
                gamesTotal: 15,
              }),
              bot({
                id: 'community-rapfi',
                displayName: 'Community Rapfi',
                ownerType: 'user',
                supportedGameSpecIds: ['gomoku'],
                gamesTotal: 4,
              }),
            ],
            locale,
          );
          expect(page.outerHTML).not.toMatch(/rapfi|gomoku|五子棋/i);
          expect(page.querySelector('[data-engine="pikafish"]')).not.toBeNull();
        }
      }
    },
  );

  it('gives every engine a row with its bot page, its authors and the variants it plays', () => {
    const page = buildThanks('en');
    const rows = [...page.querySelectorAll<HTMLElement>('.thanks-engine')];
    expect(rows.map((row) => row.dataset.engine)).toEqual(enabledEngineCredits().map((c) => c.id));
    for (const row of rows) {
      const credit = enabledEngineCredits().find((c) => c.id === row.dataset.engine)!;
      expect(row.querySelector('.thanks-engine-name a')?.getAttribute('href')).toBe(
        credit.href ?? `/bot/${credit.botIds[0]}`,
      );
      const authors = [...row.querySelectorAll<HTMLAnchorElement>('.thanks-engine-by a')];
      expect(authors.map((a) => a.getAttribute('href'))).toEqual(credit.authors.map((a) => a.href));
      for (const a of authors) {
        expect(a.target).toBe('_blank');
        expect(a.rel).toContain('noopener');
      }
      const variants = [...row.querySelectorAll('.thanks-engine-variants li')];
      expect(variants.length).toBe(credit.gameSpecIds.length);
      for (const item of variants) expect(item.textContent).not.toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(row.querySelector('.thanks-engine-mark .variant-marker')).not.toBeNull();
    }
  });

  it('sums games over every bot an engine runs and shows its best rating in its main variant', () => {
    const page = buildThanks('en');
    fillEngineStats(
      page,
      [
        bot({
          id: 'pikafish',
          gamesTotal: 790,
          ratings: [
            { gameSpecId: 'jieqi', rating: 2226 },
            { gameSpecId: 'xiangqi', rating: 2334 },
          ],
        }),
        bot({
          id: 'pikafish-level-4',
          gamesTotal: 473,
          ratings: [{ gameSpecId: 'jieqi', rating: 2400 }],
        }),
        bot({ id: 'katago', gamesTotal: 22 }),
        bot({ id: 'misty', gamesTotal: 903 }),
      ],
      'en',
    );
    const pikafish = page.querySelector('[data-engine="pikafish"]')!;
    expect(pikafish.querySelector('.thanks-engine-stat-games')?.textContent).toBe(
      '1,263games on Mistboard',
    );
    // The jieqi 2400 is a different variant's scale and must not win.
    expect(pikafish.querySelector('.thanks-engine-stat-rating dd')?.textContent).toBe('2334');
    expect(pikafish.querySelector('.thanks-engine-stat-rating dt')?.textContent).toContain(
      'Xiangqi',
    );
    const katago = page.querySelector('[data-engine="katago-jungle"]')!;
    expect(katago.querySelector('.thanks-engine-stat-rating')?.textContent).toBe('not rated yet');
    // An engine whose bots are missing from the list keeps an empty stats column.
    expect(
      page.querySelector('[data-engine="ab-jchess"] .thanks-engine-stats')?.children.length,
    ).toBe(0);
    expect(page.querySelector('[data-engine="community-misty"]')).toBeNull();
  });

  it('lists a community developer’s bot as its own row, and only those', () => {
    const page = buildThanks('en');
    fillEngineStats(
      page,
      [
        bot({ id: 'misty', gamesTotal: 903 }),
        bot({ id: 'river-bot', displayName: 'River Bot', ownerType: 'user', gamesTotal: 12 }),
      ],
      'en',
    );
    const rows = page.querySelectorAll('.thanks-engine');
    expect(rows.length).toBe(enabledEngineCredits().length + 1);
    const row = page.querySelector('[data-engine="community-river-bot"]')!;
    expect(row.querySelector('.thanks-engine-name a')?.getAttribute('href')).toBe('/bot/river-bot');
    expect(row.textContent).toContain('River Bot');
    expect(row.querySelector('.thanks-engine-stat-games dd')?.textContent).toBe('12');
  });

  it('keeps the page whole when the bot list is unavailable', () => {
    const page = buildThanks('en');
    fillEngineStats(page, [], 'en');
    expect(page.querySelectorAll('.thanks-engine-stat').length).toBe(0);
    expect(page.querySelectorAll('.thanks-engine').length).toBe(enabledEngineCredits().length);
  });

  it('points at /source for licenses and at the contact form for engine authors and players', () => {
    const hrefs = [...buildThanks('en').querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/source');
    expect(hrefs.filter((href) => href === '/contact?about=/thanks').length).toBe(2);
  });

  it('marks its ?about= contact links nofollow, so crawlers do not mint contact URLs', () => {
    const about = [...buildThanks('en').querySelectorAll('a')].filter(
      (a) => a.getAttribute('href') === '/contact?about=/thanks',
    );
    expect(about.map((a) => a.getAttribute('rel'))).toEqual(['nofollow', 'nofollow']);
  });

  it('closes by thanking lichess, after the players and before the licence pointer', () => {
    const page = buildThanks('en');
    const lichess = page.querySelector('.thanks-lichess') as HTMLElement;
    const engines = page.querySelector('.thanks-engines') as HTMLElement;
    expect(
      lichess.compareDocumentPosition(engines) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
    expect(lichess.textContent).toContain('Glicko-2');
    const links = [...lichess.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'https://lichess.org/',
      'https://github.com/lichess-org/lila/graphs/contributors',
    ]);
    for (const link of links) expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('has no em dashes in its copy', () => {
    expect(buildThanks('en').textContent).not.toContain('—');
  });
});
