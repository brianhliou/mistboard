import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureLocaleCatalog } from './i18n/catalog.js';
import * as localeModule from './i18n/locale.js';

function ratingSnapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    gameSpecId: 'dark-chess',
    timeClass: 'blitz',
    rating: 1812,
    ratingDeviation: 92,
    games: 48,
    source: 'eve-anchor',
    sourceRef: 'report-1',
    createdAt: '2026-06-01T00:00:00.000Z',
    provisional: false,
    ...overrides,
  };
}

function misty(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const primaryRating = ratingSnapshot();
  return {
    id: 'misty',
    displayName: 'Misty',
    bio: 'Searches hidden positions with the Mistboard engine.',
    ownerType: 'system',
    ownerUserId: null,
    activeEngineId: 'python-v2-v1.5',
    defaultGameSpecId: 'dark-chess',
    supportedGameSpecIds: ['dark-chess', 'banqi'],
    play: {
      mode: 'pve',
      gameSpecId: 'dark-chess',
      engineId: 'python-v2-v1.5',
      timeControl: { initialMs: 180_000, incrementMs: 2_000 },
      preferredColor: 'random',
    },
    playOptions: [
      { gameSpecId: 'dark-chess', engineId: 'python-v2-v1.5', playable: true },
      { gameSpecId: 'banqi', engineId: 'misty-banqi', playable: true },
    ],
    gamesTotal: 12,
    record: { games: 12, wins: 8, losses: 3, draws: 1 },
    rating: primaryRating,
    ratings: [
      primaryRating,
      ratingSnapshot({ gameSpecId: 'banqi', timeClass: 'rapid', rating: 1620, games: 12 }),
    ],
    games: [],
    ...overrides,
  };
}

function pikafish(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return misty({
    id: 'pikafish',
    displayName: 'Pikafish',
    bio: 'Full-strength Pikafish.',
    activeEngineId: 'pikafish',
    defaultGameSpecId: 'xiangqi',
    supportedGameSpecIds: ['xiangqi', 'jieqi'],
    playOptions: [
      { gameSpecId: 'xiangqi', engineId: 'pikafish', playable: true },
      { gameSpecId: 'jieqi', engineId: 'pikafish-jieqi', playable: true },
    ],
    rating: null,
    ratings: [],
    ...overrides,
  });
}

function ladderBot(
  level: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return misty({
    id: `fairy-stockfish-level-${level}`,
    displayName: `Fairy-Stockfish Level ${level}`,
    bio: `Fairy-Stockfish at level ${level}.`,
    activeEngineId: `fairy-stockfish-xiangqi-level-${level}`,
    defaultGameSpecId: 'xiangqi',
    supportedGameSpecIds: ['xiangqi', 'fortress-xiangqi'],
    playOptions: [
      {
        gameSpecId: 'xiangqi',
        engineId: `fairy-stockfish-xiangqi-level-${level}`,
        playable: true,
      },
      {
        gameSpecId: 'fortress-xiangqi',
        engineId: `fairy-stockfish-fortress-xiangqi-level-${level}`,
        playable: false,
      },
    ],
    rating: null,
    ratings: [],
    ...overrides,
  });
}

function rosterPayload(): { bots: Record<string, unknown>[] } {
  return {
    bots: [
      misty({
        recordsByGameSpecId: {
          'dark-chess': { games: 12, wins: 8, losses: 3, draws: 1 },
          banqi: { games: 0, wins: 0, losses: 0, draws: 0 },
        },
      }),
      pikafish(),
      // Out of order on purpose: the directory sorts the ladder by level.
      ...[3, 1, 2, 4, 5, 6, 7, 8].map((level) => ladderBot(level)),
    ],
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status: 200,
    ...init,
  });
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('bot pages', () => {
  it('credits only AB-JChess on its own page; jqe keeps its credit on the jqe page', async () => {
    const { botCredits } = await import('./bots.js');
    expect(botCredits('ab-jchess').map((credit) => credit.href)).toEqual([
      'https://github.com/lxsgx23/AB-JChess',
    ]);
    expect(botCredits('jqe').map((credit) => credit.href)).toEqual([
      'https://github.com/devinokeefe/jieqi',
    ]);
  });

  it('lists all Rapfi levels and renders their unmeasured profiles with engine credits', async () => {
    vi.stubEnv('VITE_GOMOKU_ENABLED', 'true');
    try {
      const { mountBots, mountBotProfile } = await import('./bots.js');
      const { buildProfileGameRow } = await import('./profile-ui.js');
      const bots = Array.from({ length: 8 }, (_, index) => {
        const level = index + 1;
        const id = `rapfi-level-${level}`;
        return misty({
          id,
          displayName: `Rapfi Level ${level}`,
          bio: `Rapfi plays freestyle Gomoku at level ${level} of 8.`,
          activeEngineId: id,
          defaultGameSpecId: 'gomoku',
          supportedGameSpecIds: ['gomoku'],
          play: {
            mode: 'pve',
            gameSpecId: 'gomoku',
            engineId: id,
            timeControl: { initialMs: 600_000, incrementMs: 5_000 },
            preferredColor: 'random',
          },
          playOptions: [{ gameSpecId: 'gomoku', engineId: id, playable: true }],
          rating: null,
          ratings: [],
          gamesTotal: 0,
          record: { games: 0, wins: 0, losses: 0, draws: 0 },
        });
      });
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ bots }));
      const root = document.createElement('div');
      window.history.replaceState(null, '', '/bots?game=gomoku');
      await mountBots(root);
      window.history.replaceState(null, '', '/');
      // One Rapfi card; every level is in its picker and the card opens on Level 1.
      expect(root.querySelectorAll('.profile-summary-card')).toHaveLength(1);
      expect(root.querySelector('.profile-summary-card-name')?.getAttribute('href')).toBe(
        '/bot/rapfi-level-1',
      );
      expect(
        Array.from(
          root.querySelectorAll<HTMLOptionElement>('.bot-level-select option'),
          (option) => option.value,
        ),
      ).toEqual(bots.map((bot) => bot.id));
      for (const bot of bots) {
        const row = buildProfileGameRow({
          roomId: `gmk_${bot.id}`,
          variant: 'gomoku',
          mode: 'pve',
          rated: false,
          result: 'white-wins',
          termination: 'race',
          plyCount: 30,
          whiteName: null,
          blackName: null,
          corpusId: null,
          playerColor: 'black',
          endedAt: '2026-11-06T00:00:00Z',
          participants: [
            {
              color: 'black',
              displayName: 'Guest',
              subjectType: 'guest',
              subjectId: null,
              visibility: 'public',
            },
            {
              color: 'white',
              displayName: String(bot.displayName),
              subjectType: 'bot',
              subjectId: String(bot.id),
              visibility: 'public',
            },
          ],
        });
        expect(row.querySelector('.profile-game-opponent-name')?.getAttribute('href')).toBe(
          `/bot/${bot.id}`,
        );
        fetchMock.mockResolvedValue(jsonResponse({ bot }));
        await mountBotProfile(root, String(bot.id));
        expect(root.querySelector('h1')?.textContent).toBe(bot.displayName);
        expect(root.querySelector('.profile-chart-detail')?.textContent).toBe(
          'No published rating yet',
        );
        expect(root.querySelector('.profile-chart-value-empty')).not.toBeNull();
        expect(root.querySelector('.profile-rating-q')).toBeNull();
        expect(root.querySelector('.bot-profile-actions button')?.textContent).toBe('Play Gomoku');
        expect(
          Array.from(root.querySelectorAll('.bot-profile-credits a'), (link) =>
            link.getAttribute('href'),
          ),
        ).toEqual(['https://github.com/dhbloo/rapfi', 'https://github.com/brianhliou/rapfi-wasm']);
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('links the reigning champion badge to the title record, scoped to the selected variant', async () => {
    const { mountBotProfile } = await import('./bots.js');
    const profile = misty({
      id: 'ab-jchess',
      displayName: 'AB-JChess',
      defaultGameSpecId: 'jieqi',
      supportedGameSpecIds: ['jieqi'],
      playOptions: [{ gameSpecId: 'jieqi', engineId: 'ab-jchess-jieqi', playable: true }],
      rating: null,
      ratings: [],
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ bot: profile }));
    const root = document.createElement('div');
    await mountBotProfile(root, 'ab-jchess');
    expect(root.querySelector('.bot-champion-title')?.textContent).toBe('Jieqi Champion');
    expect(root.querySelector('.bot-champion-title')?.getAttribute('href')).toBe('/champions');
    expect(root.querySelector('.profile-header-badges .bot-champion-title')).toBeNull();
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ bot: { ...profile, id: 'jqe' } }));
    await mountBotProfile(root, 'jqe');
    expect(root.querySelector('.bot-champion-title')).toBeNull();
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        bot: {
          ...profile,
          playOptions: [{ gameSpecId: 'xiangqi', engineId: 'ab-jchess-jieqi', playable: true }],
          defaultGameSpecId: 'xiangqi',
          supportedGameSpecIds: ['xiangqi'],
        },
      }),
    );
    await mountBotProfile(root, 'ab-jchess');
    expect(root.querySelector('.bot-champion-title')).toBeNull();
  });

  afterEach(() => {
    document.body.replaceChildren();
    window.history.replaceState(null, '', '/');
    vi.restoreAllMocks();
  });

  describe.each([
    {
      locale: 'en',
      botTitle: 'Bot',
      owner: 'First-party',
      ratings: 'Ratings',
      games: 'Games here',
      record: 'Record here',
      variants: 'Variants',
      recent: 'Recent games',
      sample: 'Elo from 48 engine games',
      railSample: '48 engine games',
      play: 'Play Fog Chess',
      random: 'random side',
      pending: 'Starting...',
      retry: 'Try again',
      unavailable: 'Unavailable',
      offline: 'Currently offline',
      noRating: 'No published rating yet',
      empty: 'No completed Banqi games yet.',
      notFound: 'Bot not found',
      notFoundBody: 'This bot profile is not public.',
      failed: 'Bots unavailable',
      failedBody: 'This bot profile could not load.',
      community: 'Community',
      levelBio: 'Level 2',
      worstBio: 'A strong engine trying its hardest to lose.',
    },
    {
      locale: 'zh-Hans',
      botTitle: '机器人',
      owner: '官方',
      ratings: '等级分',
      games: '本站对局',
      record: '本站战绩',
      variants: '棋种',
      recent: '最近对局',
      sample: 'Elo 来自 48 局引擎对局',
      railSample: '48 局引擎对局',
      play: '下迷雾国际象棋',
      random: '随机执方',
      pending: '正在开始...',
      retry: '重试',
      unavailable: '暂时不可用',
      offline: '目前离线',
      noRating: '尚无公开等级分',
      empty: '尚无已完成的暗棋对局。',
      notFound: '未找到机器人',
      notFoundBody: '此机器人资料未公开。',
      failed: '机器人暂不可用',
      failedBody: '无法加载此机器人资料。',
      community: '社区',
      levelBio: '第 2 级',
      worstBio: '一个竭尽全力求败的强大引擎。',
    },
    {
      locale: 'zh-Hant',
      botTitle: '機器人',
      owner: '官方',
      ratings: '等級分',
      games: '本站對局',
      record: '本站戰績',
      variants: '棋種',
      recent: '最近對局',
      sample: 'Elo 來自 48 局引擎對局',
      railSample: '48 局引擎對局',
      play: '下迷霧西洋棋',
      random: '隨機執方',
      pending: '正在開始...',
      retry: '重試',
      unavailable: '暫時無法使用',
      offline: '目前離線',
      noRating: '尚無公開等級分',
      empty: '尚無已完成的暗棋對局。',
      notFound: '找不到機器人',
      notFoundBody: '此機器人資料未公開。',
      failed: '機器人暫時無法使用',
      failedBody: '無法載入此機器人資料。',
      community: '社群',
      levelBio: '第 2 級',
      worstBio: '一個竭盡全力求敗的強大引擎。',
    },
  ] as const)('$locale bot profile localization', (copy) => {
    async function mount(profile = misty()): Promise<HTMLElement> {
      await ensureLocaleCatalog(copy.locale);
      vi.spyOn(localeModule, 'currentLocale').mockReturnValue(copy.locale);
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ bot: profile }));
      const root = document.createElement('div');
      const { mountBotProfile } = await import('./bots.js');
      await mountBotProfile(root, String(profile.id));
      return root;
    }

    it('localizes the successful profile and controls rebuilt on variant selection', async () => {
      const root = await mount(
        misty({
          ratings: [ratingSnapshot()],
          playOptions: [
            { gameSpecId: 'dark-chess', engineId: 'python-v2-v1.5', playable: true },
            { gameSpecId: 'banqi', engineId: 'misty-banqi', playable: false },
          ],
        }),
      );
      expect(document.title).toBe(`Misty · ${copy.botTitle} · Mistboard`);
      expect(root.querySelector('.profile-role-owner')?.textContent).toBe(copy.owner);
      expect(root.querySelector('.profile-ratings-heading')?.textContent).toBe(copy.ratings);
      expect(
        [...root.querySelectorAll('.profile-count-label')].map((el) => el.textContent),
      ).toEqual([copy.games, copy.record, copy.variants]);
      expect(root.querySelector('.profile-tab')?.textContent).toBe(copy.recent);
      expect(root.querySelector('.profile-chart-detail')?.textContent).toBe(copy.sample);
      expect(root.querySelector('.profile-rating-games')?.textContent).toBe(copy.railSample);
      expect(root.querySelector('.bot-profile-actions button')?.textContent).toBe(copy.play);
      expect(root.querySelector('.bot-rating-spotlight-clock')?.textContent).toContain(copy.random);

      root.querySelector<HTMLButtonElement>('[data-game-spec-id="banqi"]')!.click();
      const button = root.querySelector<HTMLButtonElement>('.bot-profile-actions button');
      expect(button?.textContent).toBe(copy.unavailable);
      expect(button?.disabled).toBe(true);
      expect(root.querySelector('.bot-rating-spotlight-title')?.textContent).toBe(copy.offline);
      expect(root.querySelector('.profile-chart-detail')?.textContent).toBe(copy.noRating);
      expect(root.querySelector('.landing-games-empty')?.textContent).toBe(copy.empty);
      expect(
        [...root.querySelectorAll('.profile-count-label')].map((el) => el.textContent),
      ).toEqual([copy.games, copy.record, copy.variants]);
    });

    it.each([404, 503, 'network'] as const)(
      'localizes error state %s and its document title',
      async (status) => {
        await ensureLocaleCatalog(copy.locale);
        vi.spyOn(localeModule, 'currentLocale').mockReturnValue(copy.locale);
        const fetch = vi.spyOn(globalThis, 'fetch');
        if (status === 'network') fetch.mockRejectedValue(new Error('offline'));
        else fetch.mockResolvedValue(jsonResponse({}, { status }));
        const root = document.createElement('div');
        const { mountBotProfile } = await import('./bots.js');
        document.title = 'Previous page';
        await mountBotProfile(root, 'missing');
        const title = status === 404 ? copy.notFound : copy.failed;
        expect(document.title).toBe(`${title} · Mistboard`);
        expect(root.textContent).toContain(title);
        expect(root.textContent).toContain(status === 404 ? copy.notFoundBody : copy.failedBody);
      },
    );

    it('localizes pending and retry labels on a rebuilt play control', async () => {
      const root = await mount();
      root.querySelector<HTMLButtonElement>('[data-game-spec-id="banqi"]')!.click();
      let fail!: (response: Response) => void;
      vi.mocked(globalThis.fetch).mockReturnValue(
        new Promise((resolve) => {
          fail = resolve;
        }),
      );
      const button = root.querySelector<HTMLButtonElement>('.bot-profile-actions button')!;
      button.click();
      expect(button.textContent).toBe(copy.pending);
      expect(button.disabled).toBe(true);
      fail(jsonResponse({}, { status: 400 }));
      await vi.waitFor(() => expect(button.textContent).toBe(copy.retry));
      expect(button.disabled).toBe(false);
    });

    it('localizes system descriptions while preserving engine names and community biographies', async () => {
      for (const profile of [ladderBot(2), pikafish({ id: 'pikafish-level-2' })]) {
        const root = await mount(profile);
        expect(root.querySelector('h1')?.textContent).toBe(profile.displayName);
        expect(root.querySelector('.profile-side-bio')?.textContent).toContain(copy.levelBio);
        expect(root.querySelector('.profile-side-bio')?.textContent).toContain(
          String(profile.id).startsWith('fairy') ? 'Fairy-Stockfish' : 'Pikafish',
        );
      }
      const worst = await mount(pikafish({ id: 'general-blunder' }));
      expect(worst.querySelector('.profile-side-bio')?.textContent).toContain(copy.worstBio);
      // Ownership, rather than a matching system id, decides whether prose is ours.
      const community = await mount(misty({ ownerType: 'user', bio: 'My own engine biography.' }));
      expect(community.querySelector('.profile-side-bio')?.textContent).toBe(
        'My own engine biography.',
      );
      expect(community.querySelector('.profile-role-owner')?.textContent).toBe(copy.community);
    });
  });

  // /bots picks the game first (the rail, ?game=), then lists one card per
  // opponent for it. A ladder is one card with a level picker; General Blunder
  // runs on Fairy-Stockfish but is its own card, never a rung (bot-opponents.ts).
  function cardFor(root: HTMLElement, opponentId: string): HTMLElement | null {
    return root.querySelector<HTMLElement>(
      `.profile-summary-card[data-opponent-id="${opponentId}"]`,
    );
  }

  function pickLevel(root: HTMLElement, opponentId: string, botId: string): HTMLElement {
    const select = cardFor(root, opponentId)?.querySelector<HTMLSelectElement>('.bot-level-select');
    expect(select).toBeTruthy();
    select!.value = botId;
    select!.dispatchEvent(new Event('change'));
    return cardFor(root, opponentId)!;
  }

  function generalBlunder(): Record<string, unknown> {
    return pikafish({
      id: 'general-blunder',
      displayName: 'General Blunder',
      bio: 'Plays the worst move it can find.',
      activeEngineId: 'fairy-stockfish-xiangqi-worst',
      supportedGameSpecIds: ['xiangqi'],
      playOptions: [
        { gameSpecId: 'xiangqi', engineId: 'fairy-stockfish-xiangqi-worst', playable: true },
      ],
    });
  }

  it('puts General Blunder in its own card ahead of the ladder, never Strongest', async () => {
    const payload = rosterPayload();
    payload.bots.push(generalBlunder());
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(payload));
    const root = document.createElement('div');
    const { mountBots } = await import('./bots.js');

    await mountBots(root);

    const cards = [
      ...root.querySelectorAll<HTMLElement>('.bot-roster-section .profile-summary-card'),
    ];
    expect(cards.map((card) => card.dataset.opponentId)).toEqual([
      'general-blunder',
      'fairy-stockfish',
      'pikafish',
    ]);
    expect(cardFor(root, 'general-blunder')?.querySelector('.bot-level-select')).toBeNull();
    expect(
      [
        ...(cardFor(root, 'fairy-stockfish')?.querySelectorAll('.bot-level-select option') ?? []),
      ].map((option) => (option as HTMLOptionElement).value),
    ).not.toContain('general-blunder');
    expect(
      cardFor(root, 'general-blunder')?.querySelector('.profile-summary-card-badge')?.textContent,
    ).not.toBe('Strongest');
  });

  it('opens on xiangqi: one ladder card with a level picker, Pikafish strongest, one game per card', async () => {
    window.history.replaceState(null, '', '/bots');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(rosterPayload()));
    const root = document.createElement('div');
    document.body.append(root);
    const { mountBots } = await import('./bots.js');

    await mountBots(root);

    expect(root.querySelector('h1')?.textContent).toBe('Play against the computer');
    // Community rail is shared with /player; Bots is the active entry.
    expect(root.querySelector('.community-rail a[aria-current="page"]')?.textContent).toBe('Bots');
    // The game rail: every game a listed bot offers, in shelf order, xiangqi active.
    const railLinks = [...root.querySelectorAll<HTMLAnchorElement>('.bots-game-rail a')];
    expect(railLinks.map((link) => link.dataset.gameSpecId).sort()).toEqual(
      ['banqi', 'dark-chess', 'fortress-xiangqi', 'jieqi', 'xiangqi'].sort(),
    );
    expect(root.querySelector('.bots-game-rail a[aria-current="page"]')?.getAttribute('href')).toBe(
      '/bots',
    );
    expect(
      railLinks.find((link) => link.dataset.gameSpecId === 'jieqi')?.getAttribute('href'),
    ).toBe('/bots?game=jieqi');
    expect(
      [...root.querySelectorAll('.bot-roster-section h2')].map((el) => el.textContent),
    ).toEqual(['Xiangqi']);

    const ladder = cardFor(root, 'fairy-stockfish')!;
    expect(ladder.querySelector('.profile-summary-card-name')?.textContent).toBe('Fairy-Stockfish');
    // Opens on the first-game level, which says Start here, and links that bot.
    expect(ladder.querySelector('.profile-summary-card-name')?.getAttribute('href')).toBe(
      '/bot/fairy-stockfish-level-2',
    );
    expect(ladder.querySelector('.profile-summary-card-badge')?.textContent).toBe('Start here');
    expect(
      [...ladder.querySelectorAll<HTMLOptionElement>('.bot-level-select option')].map((option) => [
        option.value,
        option.textContent,
      ]),
    ).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8].map((level) => [`fairy-stockfish-level-${level}`, `Level ${level}`]),
    );
    // Only xiangqi: one Play button, no fortress row.
    expect(ladder.querySelector('[data-game-spec-id="fortress-xiangqi"]')).toBeNull();
    expect(ladder.querySelector('.profile-summary-card-variants')).toBeNull();
    const play = ladder.querySelectorAll('.profile-summary-card-action');
    expect(play).toHaveLength(1);
    expect(play[0]?.textContent).toBe('Play Xiangqi');
    // The ladder card carries its level's bio, and the level select and Play
    // share the bottom row: select first, Play last.
    expect(ladder.querySelector('.profile-summary-card-bio')?.textContent).toContain('2');
    const playRow = ladder.querySelector('.bot-card-foot .profile-summary-card-bot-actions');
    expect(playRow?.firstElementChild?.matches('select.site-select.bot-level-select')).toBe(true);
    expect(playRow?.lastElementChild?.textContent).toBe('Play Xiangqi');
    expect(ladder.lastElementChild?.classList.contains('bot-card-foot')).toBe(true);

    // Picking a level swaps the bot the card plays and links, and keeps one card.
    const level1 = pickLevel(root, 'fairy-stockfish', 'fairy-stockfish-level-1');
    expect(level1.dataset.botId).toBe('fairy-stockfish-level-1');
    expect(level1.querySelector('.profile-summary-card-name')?.getAttribute('href')).toBe(
      '/bot/fairy-stockfish-level-1',
    );
    expect(level1.querySelector('.profile-summary-card-badge')?.textContent).toBe('BOT');
    expect(
      root.querySelectorAll('.profile-summary-card[data-opponent-id="fairy-stockfish"]'),
    ).toHaveLength(1);
    expect(document.activeElement).toBe(level1.querySelector('.bot-level-select'));

    // Pikafish plays xiangqi and jieqi; here it shows xiangqi only, as the top.
    const top = cardFor(root, 'pikafish')!;
    expect(top.querySelector('.bot-level-select')).toBeNull();
    expect(top.querySelector('.profile-summary-card-badge')?.textContent).toBe('Strongest');
    expect(top.querySelector('.profile-summary-card-action')?.textContent).toBe('Play Xiangqi');
    expect(top.querySelector('[data-game-spec-id="jieqi"]')).toBeNull();
  });

  it('switches game from the rail and reads ?game= on load', async () => {
    window.history.replaceState(null, '', '/bots?game=dark-chess');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        bots: [
          ...rosterPayload().bots,
          misty({ id: 'my-engine', displayName: 'My Engine', ownerType: 'user', bio: 'Mine.' }),
        ],
      }),
    );
    const root = document.createElement('div');
    // Attached: a detached page ignores popstate (it has been navigated away).
    document.body.append(root);
    const { mountBots } = await import('./bots.js');

    await mountBots(root);

    expect(
      [...root.querySelectorAll('.bot-roster-section h2')].map((el) => el.textContent),
    ).toEqual(['Fog Chess', 'Community bots']);
    const mistyCard = cardFor(root, 'misty')!;
    // Her Fog Chess record only, not the lifetime sum across her variants.
    expect(mistyCard.querySelector('.profile-summary-card-rating-value')?.textContent).toBe(
      '1,812',
    );
    expect(mistyCard.querySelector('.profile-summary-card-footer')?.textContent).toContain('8-3-1');
    expect(mistyCard.querySelector('[data-game-spec-id="banqi"]')).toBeNull();
    // The stored bios are English-only; the page carries its own localized lines.
    expect(root.textContent).toContain("Mistboard's own Fog Chess engine.");
    expect(root.textContent).not.toContain('Searches hidden positions');
    // A community bot keeps its own name and bio.
    expect(cardFor(root, 'my-engine')?.textContent).toContain('Mine.');

    root.querySelector<HTMLAnchorElement>('.bots-game-rail a[data-game-spec-id="jieqi"]')!.click();
    expect(window.location.search).toBe('?game=jieqi');
    expect(
      [...root.querySelectorAll<HTMLElement>('.bot-roster-section .profile-summary-card')].map(
        (card) => card.dataset.opponentId,
      ),
    ).toEqual(['pikafish']);
    expect(
      cardFor(root, 'pikafish')?.querySelector('.profile-summary-card-action')?.textContent,
    ).toBe('Play Jieqi');

    window.history.replaceState(null, '', '/bots?game=nope');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(
      root
        .querySelector('.bots-game-rail a[aria-current="page"]')
        ?.getAttribute('data-game-spec-id'),
    ).toBe('xiangqi');
    window.history.replaceState(null, '', '/');
  });

  // Grouping is presentation only, so no bot may fall out of it: every bot in
  // the payload is reachable from /bots, as a card or a level, in every game
  // it plays, including a system bot the map does not know yet.
  it('reaches every listed bot in every game it plays', async () => {
    const { directoryGames, directoryOpponents } = await import('./bots.js');
    const bots = [
      ...rosterPayload().bots,
      generalBlunder(),
      pikafish({
        id: 'pikafish-level-3',
        playOptions: [{ gameSpecId: 'jieqi', engineId: 'p3', playable: true }],
      }),
      misty({ id: 'new-system-bot', displayName: 'New' }),
      misty({ id: 'my-engine', ownerType: 'user' }),
    ] as unknown as Parameters<typeof directoryGames>[0];
    for (const bot of bots) {
      for (const option of bot.playOptions ?? []) {
        const reached = directoryOpponents(bots, option.gameSpecId).flatMap((opponent) =>
          opponent.members.map((member) => member.bot.id),
        );
        expect(reached, `${bot.id} in ${option.gameSpecId}`).toContain(bot.id);
      }
    }
    const jieqi = directoryOpponents(bots, 'jieqi').find((opponent) => opponent.key === 'pikafish');
    expect(jieqi?.members.map((member) => [member.bot.id, member.level])).toEqual([
      ['pikafish-level-3', 3],
      ['pikafish', 8],
    ]);
  });

  it('shows the xiangqi blitz rating of the picked level, dash and ?-suffix included', async () => {
    const payload = {
      bots: [
        ladderBot(1, {
          ratings: [
            ratingSnapshot({ gameSpecId: 'xiangqi', timeClass: 'blitz', rating: 1450, games: 30 }),
          ],
        }),
        ladderBot(2, {
          ratings: [
            ratingSnapshot({
              gameSpecId: 'xiangqi',
              timeClass: 'blitz',
              rating: 1710,
              games: 4,
              provisional: true,
            }),
          ],
        }),
        ladderBot(3),
      ],
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(payload));
    const root = document.createElement('div');
    const { mountBots } = await import('./bots.js');

    await mountBots(root);

    const ratings = [1, 2, 3].map(
      (level) =>
        pickLevel(root, 'fairy-stockfish', `fairy-stockfish-level-${level}`).querySelector(
          '.profile-summary-card-rating-value',
        )?.textContent || '—',
    );
    expect(ratings).toEqual(['1,450', '1,710?', '—']);
  });

  it('starts a game directly when a playable chip is clicked', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input: RequestInfo | URL) => {
        if (String(input) === '/api/bots') return jsonResponse({ bots: [misty()] });
        if (String(input) === '/api/rooms') return jsonResponse({ url: '/room/bot_fog' });
        return jsonResponse({}, { status: 404 });
      });
    window.history.replaceState(null, '', '/bots?game=dark-chess');
    const root = document.createElement('div');
    const { mountBots } = await import('./bots.js');

    await mountBots(root);
    const fogChip = root.querySelector<HTMLButtonElement>('button.profile-summary-card-action');
    expect(fogChip?.textContent).toBe('Play Fog Chess');
    fogChip?.click();
    // The chip itself shows the starting state while the room is created.
    expect(fogChip?.textContent).toContain('Starting...');
    expect(fogChip?.disabled).toBe(true);
    await flushPromises();

    const roomCall = fetchMock.mock.calls.find(([input]) => String(input) === '/api/rooms');
    expect(roomCall).toBeDefined();
    const roomInit = roomCall?.[1] as RequestInit | undefined;
    expect(JSON.parse(String(roomInit?.body))).toEqual({
      mode: 'pve',
      botId: 'misty',
      gameSpecId: 'dark-chess',
      preferredColor: 'random',
      rated: false,
    });
    expect(window.location.pathname).toBe('/room/bot_fog');
  });

  it('renders playable=false chips muted and inert (no fetch on click)', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ bots: [ladderBot(4)] }));
    window.history.replaceState(null, '', '/bots?game=fortress-xiangqi');
    const root = document.createElement('div');
    const { mountBots } = await import('./bots.js');

    await mountBots(root);
    const offChip = root.querySelector<HTMLElement>('.profile-summary-card-action-unavailable');
    expect(offChip?.textContent).toBe('Play Fortress Xiangqi');
    expect(offChip?.title).toBe('Not available right now');
    expect(offChip?.tagName).not.toBe('BUTTON');
    offChip?.click();
    await flushPromises();
    window.history.replaceState(null, '', '/');

    // Only the roster fetch; the muted chip never creates a room.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/bots');
  });

  it('renders the bot profile on the shared profile shell with a play row per option', async () => {
    const profile = misty({
      games: [
        {
          roomId: 'room_recent',
          variant: 'dark-chess',
          mode: 'pve',
          rated: false,
          result: 'white-wins',
          termination: 'checkmate',
          plyCount: 44,
          whiteName: 'Misty',
          blackName: 'challenger',
          corpusId: null,
          endedAt: '2026-07-01T00:00:00.000Z',
          playerColor: 'white',
        },
      ],
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ bot: profile }));
    const root = document.createElement('div');
    const { mountBotProfile } = await import('./bots.js');

    await mountBotProfile(root, 'misty');

    // Bots use the same dashboard, overview, rating rail, and tabs as players.
    expect(root.querySelector('.profile-overview .profile-identity-handle')?.textContent).toBe(
      'Misty',
    );
    expect(root.querySelector('.profile-role-bot')?.textContent).toBe('BOT');
    expect(root.querySelector('.profile-role-owner')?.textContent).toBe('First-party');
    expect(root.querySelector('.profile-body > .profile-ratings')).not.toBeNull();
    expect(root.querySelector('.profile-center > .profile-overview')).not.toBeNull();
    expect(root.querySelector('.profile-center > .profile-tabs')).not.toBeNull();
    const countValues = [...root.querySelectorAll('.profile-count-value')].map(
      (el) => el.textContent,
    );
    expect(countValues).toEqual(['12', '8-3-1', '2']);

    // The selected rating drives the shared overview and its bot-only Play fork.
    const ratingRows = [...root.querySelectorAll('.profile-rating-row')];
    expect(ratingRows).toHaveLength(2);
    expect(ratingRows[0]?.textContent).toContain('1,812');
    // eve-anchor sample: named as engine games, not "rated" games -- these
    // never entered the human pool (PvE is unrated).
    expect(ratingRows[0]?.textContent).toContain('48 engine games');
    expect(root.querySelector('.profile-chart-variant')?.textContent).toBe('Fog Chess');
    expect(root.querySelector('.bot-profile-actions button')?.textContent).toBe('Play Fog Chess');
    expect(root.querySelector('.bot-rating-spotlight-title')?.textContent).toBe(
      'Play against Misty',
    );
    // The engine id is an internal name; the page never prints it.
    expect(root.querySelector('.profile-overview-side')?.textContent).not.toContain(
      'python-v2-v1.5',
    );

    // Recent games ride the same tab card and game rows.
    expect(root.querySelector('.profile-tab[aria-selected="true"]')?.textContent).toBe(
      'Recent games',
    );
    expect(root.querySelectorAll('.profile-game-list .profile-game-row')).toHaveLength(1);
  });

  it("credits jqe's author with a link and shows the localized bio, not the stored one", async () => {
    const profile = misty({
      id: 'jqe',
      displayName: 'jqe',
      bio: 'Stored bio: github.com/devinokeefe/jieqi',
      activeEngineId: 'jqe-jieqi',
      defaultGameSpecId: 'jieqi',
      supportedGameSpecIds: ['jieqi'],
      playOptions: [
        {
          gameSpecId: 'jieqi',
          engineId: 'jqe-jieqi',
          playable: true,
          version: '331a6e61 · it014',
        },
      ],
      rating: null,
      ratings: [],
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ bot: profile }));
    const root = document.createElement('div');
    const { mountBotProfile } = await import('./bots.js');

    await mountBotProfile(root, 'jqe');

    // Bio and credits sit full width under the header, not in the side column.
    const about = root.querySelector('.profile-overview-top + .bot-profile-about');
    expect(about?.querySelector('.profile-side-bio')?.textContent).toContain(
      "An open-source jieqi engine by Devin O'Keefe",
    );
    const credit = about?.querySelector<HTMLAnchorElement>('.bot-profile-credits a');
    expect(credit?.textContent).toBe("jqe by Devin O'Keefe");
    expect(credit?.href).toBe('https://github.com/devinokeefe/jieqi');
    const side = root.querySelector('.profile-overview-side');
    expect(side?.querySelector('.profile-side-bio')).toBeNull();
    expect(root.textContent).not.toContain('jqe-jieqi');
    // Match results are against one build, so the page names it, as the server sends it.
    const stats = [...(side?.querySelectorAll('.profile-side-stat') ?? [])].map((stat) => [
      stat.querySelector('.profile-side-stat-label')?.textContent,
      stat.querySelector('.profile-side-stat-value')?.textContent,
    ]);
    expect(stats).toContainEqual(['Version', '331a6e61 · it014']);
  });

  it('describes an eve-anchor sample as engine games, never as rated games or a time class', async () => {
    // The two numbers on this page count different populations: the header's
    // Games/Record are casual PvE games against people, while rating.games is
    // the engine-vs-engine ladder sample behind the Elo. Printing the latter as
    // "36 rated games · Blitz" beside "12 Games" claimed both that those games
    // were rated (PvE is unrated by decision) and that they were blitz (the
    // ladder is run clockless -- sourceRef carries time=untimed).
    const profile = pikafish({
      recordsByGameSpecId: {
        xiangqi: { games: 12, wins: 12, losses: 0, draws: 0 },
        jieqi: { games: 0, wins: 0, losses: 0, draws: 0 },
      },
      gamesByGameSpecId: { xiangqi: [], jieqi: [] },
      rating: ratingSnapshot({ gameSpecId: 'xiangqi', rating: 2334, games: 36 }),
      ratings: [ratingSnapshot({ gameSpecId: 'xiangqi', rating: 2334, games: 36 })],
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ bot: profile }));
    const root = document.createElement('div');
    const { mountBotProfile } = await import('./bots.js');

    await mountBotProfile(root, 'pikafish');

    const spotlight = root.querySelector('.profile-chart-detail')?.textContent ?? '';
    expect(spotlight).toBe('Elo from 36 engine games');
    expect(spotlight).not.toMatch(/rated/i);
    expect(spotlight).not.toMatch(/blitz/i);

    // The rail is a narrow cell, so it carries the bare sample -- the longer
    // spotlight wording overflowed it into an ellipsis.
    const railRow =
      root.querySelector('.bot-rating-row[data-game-spec-id="xiangqi"] .profile-rating-games')
        ?.textContent ?? '';
    expect(railRow).toBe('36 engine games');
    expect(railRow).not.toMatch(/rated/i);
  });

  it('keeps the plain rated-games wording for a non-eve rating source', async () => {
    // The eve-anchor rewrite is scoped to that source, so a rating that really
    // did come from a rated pool still reads as one.
    const imported = ratingSnapshot({
      gameSpecId: 'xiangqi',
      rating: 2100,
      games: 1,
      source: 'import',
      timeClass: 'rapid',
    });
    const profile = pikafish({ rating: imported, ratings: [imported] });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ bot: profile }));
    const root = document.createElement('div');
    const { mountBotProfile } = await import('./bots.js');

    await mountBotProfile(root, 'pikafish');

    // Singular, and the time class rides along in the spotlight only.
    expect(root.querySelector('.profile-chart-detail')?.textContent).toBe('1 rated game · Rapid');
    expect(
      root.querySelector('.bot-rating-row[data-game-spec-id="xiangqi"] .profile-rating-games')
        ?.textContent,
    ).toBe('1 rated game');
  });

  it('scopes Games, Record and the recent-games list to the selected variant', async () => {
    // The regression this pins (2026-09-04): pikafish's header read 100 games /
    // 82-18-0 and an all-jieqi games list in BOTH rail states, because the
    // header was built from lifetime totals and the games panel was built once
    // outside the click handler.
    const game = (roomId: string, variant: string) => ({
      roomId,
      variant,
      mode: 'pve',
      rated: false,
      result: 'white-wins',
      termination: 'checkmate',
      plyCount: 30,
      whiteName: 'Pikafish',
      blackName: 'challenger',
      corpusId: null,
      endedAt: '2026-07-01T00:00:00.000Z',
      playerColor: 'white',
    });
    const profile = pikafish({
      gamesTotal: 100,
      record: { games: 100, wins: 82, losses: 18, draws: 0 },
      recordsByGameSpecId: {
        xiangqi: { games: 64, wins: 50, losses: 14, draws: 0 },
        jieqi: { games: 36, wins: 32, losses: 4, draws: 0 },
      },
      // The flat list is all-jieqi, exactly as prod served it: a client-side
      // filter over THIS would leave xiangqi empty, which is why the server
      // partitions instead.
      games: [game('room_j1', 'jieqi')],
      gamesByGameSpecId: {
        xiangqi: [game('room_x1', 'xiangqi')],
        jieqi: [game('room_j1', 'jieqi')],
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ bot: profile }));
    const root = document.createElement('div');
    const { mountBotProfile } = await import('./bots.js');

    await mountBotProfile(root, 'pikafish');

    const counts = () =>
      Array.from(root.querySelectorAll('.profile-counts .profile-count'), (el) =>
        el.textContent?.replace(/\s+/g, ' ').trim(),
      );
    const gameLinks = () =>
      Array.from(root.querySelectorAll('.bot-profile-games .profile-game-row-open'), (el) =>
        el.getAttribute('href'),
      );
    const railRow = (gameSpecId: string) =>
      root.querySelector<HTMLElement>(`.bot-rating-row[data-game-spec-id="${gameSpecId}"]`);

    // Xiangqi is the default (it is the bot's default game spec).
    expect(counts()).toEqual(['64Games here', '50-14-0Record here', '2Variants']);
    expect(gameLinks()).toEqual(['/xiangqi/game/room_x1']);

    railRow('jieqi')?.click();

    expect(counts()).toEqual(['36Games here', '32-4-0Record here', '2Variants']);
    expect(gameLinks()).toEqual(['/jieqi/game/room_j1']);

    // ...and back, so the swap is not one-way.
    railRow('xiangqi')?.click();
    expect(counts()).toEqual(['64Games here', '50-14-0Record here', '2Variants']);
    expect(gameLinks()).toEqual(['/xiangqi/game/room_x1']);
  });

  it('reaches every older bot game once when a game finishes between pages (#630)', async () => {
    const game = (index: number) => ({
      roomId: `room_${String(index).padStart(3, '0')}`,
      variant: 'xiangqi',
      mode: 'pve',
      rated: false,
      result: 'white-wins',
      termination: 'checkmate',
      plyCount: 30,
      whiteName: 'Pikafish',
      blackName: 'challenger',
      corpusId: null,
      endedAt: '2026-07-01T00:00:00.000Z',
      playerColor: 'white',
    });
    const original = Array.from({ length: 25 }, (_, i) => game(25 - i));
    const dataset = [...original];
    const requests: URL[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input), 'http://localhost');
      if (!url.pathname.endsWith('/games'))
        return jsonResponse({
          bot: pikafish({
            recordsByGameSpecId: { xiangqi: { games: 25, wins: 25, losses: 0, draws: 0 } },
            gamesByGameSpecId: { xiangqi: original.slice(0, 10) },
          }),
        });
      requests.push(url);
      const before = url.searchParams.get('before');
      const rows = before
        ? dataset.filter((row) => row.roomId < JSON.parse(before)[1])
        : dataset.slice(Number(url.searchParams.get('offset') ?? 0));
      return jsonResponse({ games: rows.slice(0, 15) });
    });
    const root = document.createElement('div');
    const { mountBotProfile } = await import('./bots.js');
    await mountBotProfile(root, 'pikafish');
    dataset.unshift(game(26));
    const more = () =>
      root.querySelector<HTMLButtonElement>('.bot-profile-games .profile-games-more-btn');
    more()?.click();
    await vi.waitFor(() =>
      expect(root.querySelectorAll('.bot-profile-games .profile-game-row-open')).toHaveLength(25),
    );
    expect(
      Array.from(root.querySelectorAll('.bot-profile-games .profile-game-row-open'), (row) =>
        row.getAttribute('href'),
      ),
    ).toEqual(original.map((row) => `/xiangqi/game/${row.roomId}`));
    expect(more()).not.toBeNull();
    expect(requests[0]?.searchParams.get('offset')).toBeNull();
    expect(JSON.parse(requests[0]?.searchParams.get('before') ?? 'null')).toEqual([
      original[9].endedAt,
      original[9].roomId,
    ]);
    more()?.click();
    await vi.waitFor(() => expect(more()).toBeNull());
    expect(JSON.parse(requests[1]?.searchParams.get('before') ?? 'null')).toEqual([
      original[24].endedAt,
      original[24].roomId,
    ]);
  });

  it('pages older games of the selected variant past the profile cap (#550)', async () => {
    const game = (index: number) => ({
      roomId: `room_x${index}`,
      variant: 'xiangqi',
      mode: 'pve',
      rated: false,
      result: 'white-wins',
      termination: 'checkmate',
      plyCount: 30,
      whiteName: 'Pikafish',
      blackName: 'challenger',
      corpusId: null,
      endedAt: '2026-07-01T00:00:00.000Z',
      playerColor: 'white',
    });
    const firstPage = Array.from({ length: 10 }, (_, index) => game(12 - index));
    const profile = pikafish({
      recordsByGameSpecId: {
        xiangqi: { games: 12, wins: 12, losses: 0, draws: 0 },
        jieqi: { games: 0, wins: 0, losses: 0, draws: 0 },
      },
      gamesByGameSpecId: { xiangqi: firstPage, jieqi: [] },
    });
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ bot: profile }))
      .mockResolvedValueOnce(jsonResponse({ games: [game(2), game(1)] }));
    const root = document.createElement('div');
    const { mountBotProfile } = await import('./bots.js');

    await mountBotProfile(root, 'pikafish');

    const rows = () => root.querySelectorAll('.bot-profile-games .profile-game-row-open').length;
    expect(rows()).toBe(10);
    const more = root.querySelector<HTMLButtonElement>(
      '.bot-profile-games .profile-games-more-btn',
    );
    expect(more).not.toBeNull();

    more?.click();
    await flushPromises();
    await flushPromises();

    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      `/api/bots/pikafish/games?${new URLSearchParams({ variant: 'xiangqi', before: JSON.stringify(['2026-07-01T00:00:00.000Z', 'room_x3']), limit: '15' })}`,
    );
    expect(rows()).toBe(12);
    // Every game of the variant is on the page, so the control goes away.
    expect(root.querySelector('.bot-profile-games .profile-games-more')).toBeNull();

    // A variant with nothing past the first page never offers the control.
    root.querySelector<HTMLElement>('.bot-rating-row[data-game-spec-id="jieqi"]')?.click();
    expect(root.querySelector('.bot-profile-games .profile-games-more-btn')).toBeNull();
  });

  it('names the variant when the selected one has no games, and never shows lifetime numbers under it', async () => {
    const profile = pikafish({
      gamesTotal: 64,
      record: { games: 64, wins: 50, losses: 14, draws: 0 },
      // A supported variant the bot has never played arrives as a real 0-0-0,
      // so the lifetime fallback must not fire for it.
      recordsByGameSpecId: {
        xiangqi: { games: 64, wins: 50, losses: 14, draws: 0 },
        jieqi: { games: 0, wins: 0, losses: 0, draws: 0 },
      },
      games: [],
      gamesByGameSpecId: { xiangqi: [], jieqi: [] },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ bot: profile }));
    const root = document.createElement('div');
    const { mountBotProfile } = await import('./bots.js');

    await mountBotProfile(root, 'pikafish');
    root.querySelector<HTMLElement>('.bot-rating-row[data-game-spec-id="jieqi"]')?.click();

    expect(
      Array.from(root.querySelectorAll('.profile-counts .profile-count'), (el) =>
        el.textContent?.replace(/\s+/g, ' ').trim(),
      ),
    ).toEqual(['0Games here', '0-0-0Record here', '2Variants']);
    expect(root.querySelector('.bot-profile-games .landing-games-empty')?.textContent).toContain(
      'Jieqi',
    );
  });

  it('marks unplayable variants on the profile and posts the row variant on Play', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input: RequestInfo | URL) => {
        if (String(input) === '/api/bots/fairy-stockfish-level-4') {
          return jsonResponse({ bot: ladderBot(4) });
        }
        if (String(input) === '/api/rooms') return jsonResponse({ url: '/room/bot_xq' });
        return jsonResponse({}, { status: 404 });
      });
    const root = document.createElement('div');
    const { mountBotProfile } = await import('./bots.js');

    await mountBotProfile(root, 'fairy-stockfish-level-4');

    const offRow = root.querySelector<HTMLElement>(
      '.profile-rating-row[data-game-spec-id="fortress-xiangqi"]',
    );
    expect(offRow?.textContent).toContain('Fortress Xiangqi');
    expect(offRow?.textContent).toContain('Unavailable');
    offRow?.click();
    const unavailable = root.querySelector<HTMLButtonElement>('.bot-profile-actions button');
    expect(unavailable?.textContent).toBe('Unavailable');
    expect(unavailable?.disabled).toBe(true);

    root.querySelector<HTMLElement>('.profile-rating-row[data-game-spec-id="xiangqi"]')?.click();
    root.querySelector<HTMLButtonElement>('.bot-profile-actions button')?.click();
    await flushPromises();

    const roomCall = fetchMock.mock.calls.find(([input]) => String(input) === '/api/rooms');
    expect(roomCall).toBeDefined();
    const roomInit = roomCall?.[1] as RequestInit | undefined;
    expect(JSON.parse(String(roomInit?.body))).toEqual({
      mode: 'pve',
      botId: 'fairy-stockfish-level-4',
      gameSpecId: 'xiangqi',
      preferredColor: 'random',
      rated: false,
    });
    expect(window.location.pathname).toBe('/room/bot_xq');
  });

  it('names each engine build from the payload: one on the subtitle, else one per row', async () => {
    const payload = {
      bots: [
        // One build across its variants: the subtitle carries it.
        ladderBot(1, {
          playOptions: [
            {
              gameSpecId: 'xiangqi',
              engineId: 'fairy-stockfish-xiangqi-level-1',
              playable: true,
              version: '1b5bdd40',
            },
          ],
          supportedGameSpecIds: ['xiangqi'],
        }),
        // Different builds per variant, one with none recorded: each row names its own.
        misty({
          playOptions: [
            {
              gameSpecId: 'dark-chess',
              engineId: 'python-v2-v1.6',
              playable: true,
              version: '1.6',
            },
            { gameSpecId: 'banqi', engineId: 'misty-banqi', playable: true, version: '0.3.0' },
            { gameSpecId: 'xiangqi-mahjong', engineId: 'misty-xiangqi-mahjong', playable: true },
          ],
        }),
      ],
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(payload));
    const root = document.createElement('div');
    const { mountBots } = await import('./bots.js');

    await mountBots(root);

    const card = (botId: string) =>
      root.querySelector(`.profile-summary-card[data-bot-id="${botId}"]`);
    const level1 = card('fairy-stockfish-level-1');
    expect(level1?.querySelector('.profile-summary-card-subtitle')?.textContent).toBe(
      'Hosted bot · Version 1b5bdd40',
    );
    // A one-variant bot keeps the compact card: one Play sized to its label, a footer.
    expect(level1?.querySelector('.profile-summary-card-variants')).toBeNull();
    expect(level1?.querySelectorAll('.profile-summary-card-action')).toHaveLength(1);
    expect(level1?.querySelector('.profile-summary-card-footer')).not.toBeNull();

    // A card that lists several variants (the hover card; /bots shows one game).
    const { buildBotSummaryCard } = await import('./profile-summary-card.js');
    const mistyCard = buildBotSummaryCard(payload.bots[1] as never);
    expect(mistyCard?.querySelector('.profile-summary-card-version')).toBeNull();
    const rowText = (gameSpecId: string) =>
      mistyCard?.querySelector(`[data-game-spec-id="${gameSpecId}"]`)?.textContent ?? '';
    expect(rowText('dark-chess')).toContain('Version 1.6');
    expect(rowText('banqi')).toContain('Version 0.3.0');
    // No recorded version: nothing, never a guess.
    expect(rowText('xiangqi-mahjong')).not.toContain('Version');
  });

  it('leaves out a variant the bot no longer offers, whatever its record', async () => {
    const payload = {
      bots: [
        misty({
          playOptions: [
            { gameSpecId: 'dark-chess', engineId: 'python-v2-v1.6', playable: true },
            { gameSpecId: 'dark-xiangqi', engineId: 'python-fdx-v1.2', playable: true },
          ],
          recordsByGameSpecId: {
            'dark-chess': { games: 9, wins: 6, losses: 2, draws: 1 },
            banqi: { games: 3, wins: 2, losses: 1, draws: 0 },
          },
        }),
      ],
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(payload));
    const root = document.createElement('div');
    const { mountBots } = await import('./bots.js');
    const { buildBotSummaryCard } = await import('./profile-summary-card.js');

    await mountBots(root);
    // The /bots rail offers only what the bot plays (in shelf order); banqi's
    // old record adds no game.
    expect(
      [...root.querySelectorAll<HTMLElement>('.bots-game-rail a')].map((a) => a.dataset.gameSpecId),
    ).toEqual(['dark-xiangqi', 'dark-chess']);

    const rows = [
      ...buildBotSummaryCard(payload.bots[0] as never).querySelectorAll(
        '.profile-summary-card-variant',
      ),
    ];
    expect(rows.map((row) => row.getAttribute('data-game-spec-id'))).toEqual([
      'dark-chess',
      'dark-xiangqi',
    ]);
  });

  it('shows the whole bio on a card: no line clamp in the card stylesheet', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const css = readFileSync(resolve(__dirname, 'profile-summary-card.css'), 'utf8');
    const bioRule = /\.profile-summary-card-bio\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(bioRule).not.toBe('');
    expect(bioRule).not.toMatch(/line-clamp|text-overflow|max-height/);
  });

  it("shows the selected variant's engine build on the profile", async () => {
    const profile = misty({
      playOptions: [
        { gameSpecId: 'dark-chess', engineId: 'python-v2-v1.6', playable: true, version: '1.6' },
        { gameSpecId: 'banqi', engineId: 'misty-banqi', playable: true, version: '0.3.0' },
      ],
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ bot: profile }));
    const root = document.createElement('div');
    const { mountBotProfile } = await import('./bots.js');

    await mountBotProfile(root, 'misty');

    const version = () =>
      [...root.querySelectorAll('.profile-overview-side .profile-side-stat')]
        .find((stat) => stat.querySelector('.profile-side-stat-label')?.textContent === 'Version')
        ?.querySelector('.profile-side-stat-value')?.textContent;
    expect(version()).toBe('1.6');
    root.querySelector<HTMLElement>('.profile-rating-row[data-game-spec-id="banqi"]')?.click();
    expect(version()).toBe('0.3.0');
  });
});

describe('/bots covers every launched bot variant', () => {
  afterEach(() => {
    document.body.replaceChildren();
    window.history.replaceState(null, '', '/');
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  const FLAGS = [
    'XIANGQI',
    'JUNGLE_FLIP',
    'XIANGQI_MAHJONG',
    'GOMOKU',
    'THREE_KINGDOMS_BANQI',
    'FFQ_BANQI',
    'MAHJONG',
  ];

  async function serverFixtures() {
    const { FIRST_PARTY_BOT_PROFILES } = await import('../../server/src/first-party-bots.js');
    const { THREE_KINGDOMS_BANQI_PLAYABLE_ENGINES } = await import(
      '../../server/src/three-kingdoms-banqi-engine.js'
    );
    const { maybeGameSpecForId } = await import('@mistboard/game');
    // As /api/bots serves them: every first-party bot, every spec it has an
    // engine for (all playable), hidden specs dropped as botPlayOptions does.
    const bots = FIRST_PARTY_BOT_PROFILES.map((bot) => {
      const specs = Object.keys(bot.engines).filter(
        (id) => maybeGameSpecForId(id)?.publicSurface !== 'hidden',
      );
      return misty({
        id: bot.id,
        displayName: bot.displayName,
        defaultGameSpecId: specs[0],
        supportedGameSpecIds: specs,
        playOptions: specs.map((gameSpecId) => ({
          gameSpecId,
          engineId: bot.engines[gameSpecId],
          playable: true,
        })),
        rating: null,
        ratings: [],
        recordsByGameSpecId: {},
      });
    });
    return { FIRST_PARTY_BOT_PROFILES, THREE_KINGDOMS_BANQI_PLAYABLE_ENGINES, bots };
  }

  function stubFetch(bots: readonly unknown[], tkEngines: readonly unknown[]) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/bots') return jsonResponse({ bots });
      if (String(input) === '/api/engines/playable') {
        return jsonResponse({ threeKingdomsBanqiEngines: tkEngines });
      }
      if (String(input) === '/api/rooms') return jsonResponse({ url: '/room/bot_tk' });
      return jsonResponse({}, { status: 404 });
    });
  }

  function railGames(root: HTMLElement): (string | undefined)[] {
    return [...root.querySelectorAll<HTMLElement>('.bots-game-rail a')].map(
      (a) => a.dataset.gameSpecId,
    );
  }

  it('lists a game for every live public variant a first-party bot or engine plays, never FFQ', async () => {
    for (const flag of FLAGS) vi.stubEnv(`VITE_${flag}_ENABLED`, 'true');
    const { FIRST_PARTY_BOT_PROFILES, THREE_KINGDOMS_BANQI_PLAYABLE_ENGINES, bots } =
      await serverFixtures();
    const { GAME_SPECS, isPublicGameSpec } = await import('@mistboard/game');
    stubFetch(bots, THREE_KINGDOMS_BANQI_PLAYABLE_ENGINES);
    window.history.replaceState(null, '', '/bots');
    const root = document.createElement('div');
    const { mountBots } = await import('./bots.js');
    await mountBots(root);

    // Engine-only bots (TK) have no bot profile: count their engine catalog too,
    // or a profile omission hides the missing game again.
    const botSpecs = new Set([
      ...FIRST_PARTY_BOT_PROFILES.flatMap((bot) => Object.keys(bot.engines)),
      ...THREE_KINGDOMS_BANQI_PLAYABLE_ENGINES.map(() => 'three-kingdoms-banqi'),
    ]);
    const expected = GAME_SPECS.filter(
      (spec) => spec.runtimeStatus === 'live' && isPublicGameSpec(spec.id) && botSpecs.has(spec.id),
    ).map((spec) => spec.id);
    const rail = railGames(root);
    expect([...rail].sort()).toEqual([...expected].sort());
    expect(rail).toContain('three-kingdoms-banqi');
    expect(rail).toContain('jungle-flip');
    expect(rail).not.toContain('ffq-banqi');
    expect(root.textContent).not.toMatch(/FFQ|Fu Fu Qi/i);
  });

  it('shows Misty on Three Kingdoms Banqi with its levels, opening on Level 4, playing by engine id', async () => {
    vi.stubEnv('VITE_THREE_KINGDOMS_BANQI_ENABLED', 'true');
    const { THREE_KINGDOMS_BANQI_PLAYABLE_ENGINES } = await serverFixtures();
    const fetchMock = stubFetch([misty()], THREE_KINGDOMS_BANQI_PLAYABLE_ENGINES);
    window.history.replaceState(null, '', '/bots?game=three-kingdoms-banqi');
    const root = document.createElement('div');
    const { mountBots } = await import('./bots.js');
    await mountBots(root);

    const card = root.querySelector<HTMLElement>(
      '.profile-summary-card[data-opponent-id="misty-three-kingdoms-banqi"]',
    );
    expect(card?.querySelector('.profile-summary-card-name')?.textContent).toBe('Misty');
    const select = card?.querySelector<HTMLSelectElement>('select.bot-level-select');
    expect(select?.value).toBe('misty-three-kingdoms-banqi-level-4');
    expect(card?.querySelector('.profile-summary-card-bio')?.textContent).toContain(
      'Three Kingdoms Banqi',
    );
    // Misty's profile games are not TK's: no "0 games" footer.
    expect(card?.querySelector('.profile-summary-card-footer')).toBeNull();
    const play = card?.querySelector<HTMLButtonElement>('button.profile-summary-card-action');
    expect(play?.textContent).toBe('Play Three Kingdoms Banqi');
    play?.click();
    await flushPromises();
    const roomCall = fetchMock.mock.calls.find(([input]) => String(input) === '/api/rooms');
    expect(JSON.parse(String((roomCall?.[1] as RequestInit | undefined)?.body))).toEqual({
      mode: 'pve',
      engineId: 'misty-three-kingdoms-banqi-level-4',
      gameSpecId: 'three-kingdoms-banqi',
      preferredColor: 'random',
      rated: false,
    });
  });

  it('a visitor without the TK flag sees no TK game and the page asks for no TK roster', async () => {
    vi.stubEnv('VITE_THREE_KINGDOMS_BANQI_ENABLED', 'false');
    const fetchMock = stubFetch([misty()], []);
    window.history.replaceState(null, '', '/bots');
    const root = document.createElement('div');
    const { mountBots } = await import('./bots.js');
    await mountBots(root);
    expect(railGames(root)).not.toContain('three-kingdoms-banqi');
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual(['/api/bots']);
  });
});
