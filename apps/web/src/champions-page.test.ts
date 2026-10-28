import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildChampions, CHAMPIONS, OPEN_TITLES, TITLE_HISTORY, TITLES } from './champions-page.js';
import { mountContribute } from './contribute-page.js';
import { mountCreators } from './creators-page.js';
import { ensureLocaleCatalog, type I18nKey, t } from './i18n/catalog.js';
import { EN_CONTENT } from './i18n/catalogs/content.js';
import type { Locale } from './i18n/locale.js';
import { webVariantTenantForSpecId } from './variant-tenant/registry.js';
import { VARIANTS } from './variants.js';

const LOCALES: readonly Locale[] = ['en', 'zh-Hans', 'zh-Hant'];
const CHAMPION_KEYS = Object.keys(EN_CONTENT).filter((key) =>
  key.startsWith('champions.'),
) as I18nKey[];

function hrefs(root: HTMLElement): string[] {
  return [...root.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
}

// A Misty card with no public repo link, each with its reason. The test fails
// once a listed card gets one, so the list cannot go stale.
const MISTY_WITHOUT_PUBLIC_REPO: Readonly<Record<string, string>> = {
  // github.com/brianhliou/misty is the Fog Chess engine only: "The variant
  // siblings and the research lab stay private" (articles/content/misty.ts).
  // No public repo carries the Fog Xiangqi engine.
  'dark-xiangqi': 'Fog Xiangqi engine not public',
};
const MISTY_REPO = /^https:\/\/github\.com\/brianhliou\/misty(-[a-z]+)*$/;

// "Play the champion" opens computer setup with the holder already picked: the
// deep link landing-play.ts maybeOpenPlayDeepLink reads, whose engineId must be
// one of the bots that variant's setup offers or setup ignores it.
function expectPlaysTheHolder(href: string | null, gameSpecId: string, engineId: string): void {
  const url = new URL(href ?? '', 'https://mistboard.com');
  expect(url.pathname).toBe('/');
  expect(Object.fromEntries(url.searchParams)).toEqual({ play: 'computer', gameSpecId, engineId });
  const offered = webVariantTenantForSpecId(gameSpecId)?.landing?.engineOptions ?? [];
  expect(
    offered.map((engine) => engine.id),
    `${gameSpecId} setup offers ${engineId}`,
  ).toContain(engineId);
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
      'dark-xiangqi',
      'dark-chess',
      'jungle-flip',
      'xiangqi-mahjong',
    ]);
    const holder = (game: string) =>
      page.querySelector<HTMLAnchorElement>(
        `.champions-open[data-game="${game}"] .champions-open-holder a`,
      );
    expect(holder('xiangqi')?.textContent).toBe('Pikafish');
    expect(holder('xiangqi')?.getAttribute('href')).toBe('/bot/pikafish');
    for (const game of ['banqi', 'dark-xiangqi', 'dark-chess', 'jungle-flip', 'xiangqi-mahjong']) {
      expect(holder(game)?.textContent, game).toBe('Misty');
      expect(holder(game)?.getAttribute('href'), game).toBe('/bot/misty');
    }
    for (const game of ['duck-xiangqi', 'crazyhouse-xiangqi']) {
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
      'Took the title from Pikafish Level 8 on 2026-09-30, over 400 games, scoring 64%.',
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
      'Play the champion /?play=computer&gameSpecId=jieqi&engineId=ab-jchess-jieqi',
    ]);
    expect(buttons('jungle')).toEqual([
      'Read the match /blog/katago-jungle',
      'See the games /study/0t8xpyv6',
      'Play the champion /?play=computer&gameSpecId=jungle&engineId=katago-jungle',
    ]);
    const play = (game: string) =>
      card(game).querySelector('.champions-actions a:last-child')?.getAttribute('href') ?? null;
    expectPlaysTheHolder(play('jieqi'), 'jieqi', 'ab-jchess-jieqi');
    expectPlaysTheHolder(play('jungle'), 'jungle', 'katago-jungle');
    // Each champion links its engine's source, and no card plugs another bot.
    expect(hrefs(card('jieqi') as HTMLElement)).toContain('https://github.com/lxsgx23/AB-JChess');
    expect(hrefs(card('jungle') as HTMLElement)).toContain(
      'https://github.com/hzyhhzy/KataGomo/tree/AnimalChess2025',
    );
    expect(card('jungle').querySelector('.champions-about')?.textContent).not.toContain('Misty');
  });

  // The holder's name is its profile link (its bot page), and each engine
  // credits its code and, where it runs one, its network, from the sources the
  // repo already cites (bots.ts botCredits, engine-credits.ts, the fetch scripts).
  it('links each holder to its bot page and credits the code and the network', async () => {
    const credits = (card: Element) =>
      [...card.querySelectorAll('.champions-credit')].map(
        (row) =>
          `${row.querySelector('dt')?.textContent}: ${[...row.querySelectorAll('dd a')]
            .map((a) => `${a.textContent} ${a.getAttribute('href')}`)
            .join(', ')}`,
      );
    const page = buildChampions('en');
    const hero = (game: string) => page.querySelector(`.champions-hero[data-game="${game}"]`)!;
    const open = (game: string) => page.querySelector(`.champions-open[data-game="${game}"]`)!;

    expect(
      [...page.querySelectorAll('.champions-hero h3 a.champions-hero-name-link')].map(
        (a) => `${a.textContent} ${a.getAttribute('href')}`,
      ),
    ).toEqual(['AB-JChess /bot/ab-jchess', 'KataGo-AnimalChess /bot/katago']);

    expect(credits(hero('jieqi'))).toEqual([
      'Code: AB-JChess https://github.com/lxsgx23/AB-JChess, Pikafish https://github.com/official-pikafish/Pikafish',
      'Network: AB-JChess NNUE https://github.com/lxsgx23/AB-JChess/tree/main/abjchess-nnue-pytorch',
    ]);
    expect(credits(hero('jungle'))).toEqual([
      'Code: KataGomo https://github.com/hzyhhzy/KataGomo/tree/AnimalChess2025, KataGo https://github.com/lightvector/KataGo',
      'Network: Dandelion 4 https://github.com/lxsgx23/Dandelion-Chess',
    ]);
    expect(credits(open('xiangqi'))).toEqual([
      'Code: Pikafish https://github.com/official-pikafish/Pikafish',
      'Network: Pikafish NNUE https://www.pikafish.com/en/list.html',
    ]);
    // Fairy-Stockfish plays duck and crazyhouse xiangqi with NNUE off: code only.
    for (const game of ['duck-xiangqi', 'crazyhouse-xiangqi']) {
      expect(credits(open(game)), game).toEqual([
        'Code: Fairy-Stockfish https://github.com/fairy-stockfish/Fairy-Stockfish',
      ]);
    }
    // Misty is ours: each card with a public repo credits it as the code, from
    // the articles that already cite it (banqi-engine, misty,
    // flip-jungle-skill-ceiling). No network row: Misty loads no separate net.
    expect(credits(open('banqi'))).toEqual([
      'Code: misty-banqi https://github.com/brianhliou/misty-banqi',
    ]);
    expect(credits(open('dark-chess'))).toEqual([
      'Code: misty https://github.com/brianhliou/misty',
    ]);
    expect(credits(open('jungle-flip'))).toEqual([
      'Code: misty-flip-jungle https://github.com/brianhliou/misty-flip-jungle',
    ]);
    expect(credits(open('xiangqi-mahjong'))).toEqual([
      'Code: misty-xiangqi-mahjong https://github.com/brianhliou/misty-xiangqi-mahjong',
    ]);
    expect(open('dark-xiangqi').querySelector('.champions-credits')).toBeNull();
    // Every credit opens off-site; the profile links stay on Mistboard.
    for (const a of page.querySelectorAll<HTMLAnchorElement>('.champions-credits a')) {
      expect(a.getAttribute('href')).toMatch(/^https:\/\//);
    }

    for (const locale of ['zh-Hans', 'zh-Hant'] as const) {
      await ensureLocaleCatalog(locale);
      const zh = buildChampions(locale);
      const xiangqi = credits(zh.querySelector('.champions-open[data-game="xiangqi"]')!);
      expect(xiangqi[1], locale).toBe(
        locale === 'zh-Hans'
          ? '神经网络: 皮卡鱼 NNUE https://www.pikafish.com/list.html'
          : '神經網路: 皮卡魚 NNUE https://www.pikafish.com/zh-hant/list.html',
      );
    }
  });

  it('credits our public repo on every Misty card, except the named ones', () => {
    const page = buildChampions('en');
    const mistyGames = TITLES.filter((title) => title.holder === 'Misty').map(
      (title) => title.gameId as string,
    );
    // Every exception is a Misty card that exists.
    for (const game of Object.keys(MISTY_WITHOUT_PUBLIC_REPO)) {
      expect(mistyGames, game).toContain(game);
    }
    for (const game of mistyGames) {
      const card = page.querySelector(`[data-game="${game}"]`)!;
      const codeLinks = [...card.querySelectorAll('.champions-credit')]
        .filter((row) => row.querySelector('dt')?.textContent === 'Code')
        .flatMap((row) => [...row.querySelectorAll('dd a')].map((a) => a.getAttribute('href')));
      const hasRepo = codeLinks.some((href) => MISTY_REPO.test(href ?? ''));
      if (game in MISTY_WITHOUT_PUBLIC_REPO) {
        expect(hasRepo, `${game} links a public repo now: drop it from the exceptions`).toBe(false);
      } else {
        expect(hasRepo, `${game}: a Misty card with no public repo link`).toBe(true);
      }
    }
  });

  // jqe reigns only in a build that offers it (VITE_JQE_ENABLED); until its
  // write-up goes live the card links to the bot and the match games.
  it('hands the jieqi title to jqe when jqe is on, keeping AB-JChess in the history', async () => {
    vi.stubEnv('VITE_JQE_ENABLED', 'true');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-26T12:00:00Z'));
    vi.resetModules();
    try {
      const { buildChampions: build } = await import('./champions-page.js');
      const page = build('en');
      const jieqi = page.querySelector<HTMLElement>('[data-game="jieqi"]')!;
      expect(jieqi.querySelector('h3')?.textContent).toBe('jqe');
      expect(
        [...jieqi.querySelectorAll('.champions-stats dd')].map((dd) => dd.textContent),
      ).toEqual(['171', '15', '114']);
      expect(
        [...jieqi.querySelectorAll<HTMLAnchorElement>('.champions-actions a')].map(
          (a) => `${a.textContent} ${a.getAttribute('href')}`,
        ),
      ).toEqual([
        'See the games /study/3RQbr51i',
        'Play the champion /?play=computer&gameSpecId=jieqi&engineId=jqe-jieqi',
      ]);
      // The registry is re-imported with the flag on, where jieqi setup offers jqe.
      const { webVariantTenantForSpecId: tenantFor } = await import('./variant-tenant/registry.js');
      expect(tenantFor('jieqi')?.landing?.engineOptions?.map((engine) => engine.id)).toContain(
        'jqe-jieqi',
      );
      expect(hrefs(jieqi)).toContain('https://github.com/devinokeefe/jieqi');
      expect(jieqi.querySelector('h3 a')?.getAttribute('href')).toBe('/bot/jqe');
      expect(jieqi.querySelector('.champions-credits')?.textContent).toContain('it014.jqn');
      const lines = [...page.querySelectorAll('.champions-list li')].map(
        (li) => li.textContent ?? '',
      );
      expect(lines[0]).toBe(
        "2026-10-21, Jieqi: jqe, by Devin O'Keefe, took the title from AB-JChess 0.2d, 171-114-15 over 300 games, scoring 60% (games).",
      );
      expect(lines[1]).toMatch(/^2026-09-30, Jieqi: AB-JChess/);
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it('links the jqe write-up once the article is live, on its own date', async () => {
    const { jqeArticle } = await import('./articles/content/jqe.js');
    const { JQE_WRITE_UP } = await import('./champions-page.js');
    expect(JQE_WRITE_UP.publishedAt).toBe(jqeArticle.publishedAt);
    vi.stubEnv('VITE_JQE_ENABLED', 'true');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-27T17:00:00Z'));
    vi.resetModules();
    try {
      const { buildChampions: build } = await import('./champions-page.js');
      const jieqi = build('en').querySelector<HTMLElement>('[data-game="jieqi"]')!;
      expect(
        [...jieqi.querySelectorAll<HTMLAnchorElement>('.champions-actions a')].map(
          (a) => `${a.textContent} ${a.getAttribute('href')}`,
        ),
      ).toEqual([
        'Read the match /blog/jqe',
        'See the games /study/3RQbr51i',
        'Play the champion /?play=computer&gameSpecId=jieqi&engineId=jqe-jieqi',
      ]);
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
      vi.resetModules();
    }
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
    expect(body).toContain('Scoring 55% or better (about +35 Elo) takes the title.');
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
      // Play keeps the reader's language: the home page is a content path.
      expect(
        page
          .querySelector('[data-game="jungle"] .champions-actions a:last-child')
          ?.getAttribute('href'),
      ).toBe(`${prefix}/?play=computer&gameSpecId=jungle&engineId=katago-jungle`);
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
      expect(body).not.toMatch(/luzhanqi|陆战棋|陸戰棋|ten nets/i);
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
