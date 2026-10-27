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
      play: '下迷霧國際象棋',
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

  // The page is for "play xiangqi against the computer": the ladder leads, named
  // by level, Pikafish is its top rung, the first-timer level says Start here,
  // and Misty (no xiangqi) follows under Other games.
  // General Blunder plays xiangqi but is off the ladder: it goes below Level 1,
  // never in the top-rung slot that reads Strongest.
  it('puts General Blunder below Level 1, not as a top rung', async () => {
    const payload = rosterPayload();
    payload.bots.push(
      pikafish({
        id: 'general-blunder',
        displayName: 'General Blunder',
        bio: 'Plays the worst move it can find.',
        activeEngineId: 'fairy-stockfish-xiangqi-worst',
        supportedGameSpecIds: ['xiangqi'],
        playOptions: [
          { gameSpecId: 'xiangqi', engineId: 'fairy-stockfish-xiangqi-worst', playable: true },
        ],
      }),
    );
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(payload));
    const root = document.createElement('div');
    const { mountBots } = await import('./bots.js');

    await mountBots(root);

    const names = [
      ...root.querySelectorAll(
        '.bot-roster-section:nth-of-type(1) .profile-summary-card .profile-summary-card-name',
      ),
    ].map((el) => el.textContent);
    expect(names[0]).toBe('General Blunder');
    expect(names.at(-1)).toBe('Pikafish');
    expect(
      root.querySelector(
        '.profile-summary-card[data-bot-id="general-blunder"] .profile-summary-card-badge',
      )?.textContent,
    ).not.toBe('Strongest');
  });

  it('leads with the xiangqi ladder by level, Pikafish on top, Misty in her own section', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(rosterPayload()));
    const root = document.createElement('div');
    const { mountBots } = await import('./bots.js');

    await mountBots(root);

    expect(root.querySelector('h1')?.textContent).toBe('Play xiangqi against the computer');
    expect(
      [...root.querySelectorAll('.bot-roster-section h2')].map((el) => el.textContent),
    ).toEqual(['Xiangqi, level by level', 'Misty, the house bot']);
    // Community rail is shared with /player; Online bots is the active entry.
    expect(root.querySelector('.community-rail a[aria-current="page"]')?.textContent).toBe(
      'Online bots',
    );

    const sectionNames = (index: number) =>
      [
        ...root.querySelectorAll(
          `.bot-roster-section:nth-of-type(${index}) .profile-summary-card .profile-summary-card-name`,
        ),
      ].map((el) => el.textContent);
    expect(sectionNames(1)).toEqual([
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((level) => `Level ${level}`),
      'Pikafish',
    ]);
    expect(sectionNames(2)).toEqual(['Misty']);
    // The stored bios are English-only; the page carries its own localized lines.
    expect(root.textContent).toContain("Mistboard's own engine for Fog Chess");
    expect(root.textContent).not.toContain('Searches hidden positions');
    // Misty plays two variants, so her card has a row per variant (rating,
    // games, record, Play) and no lifetime footer summing them.
    const mistyCard = root.querySelector('.profile-summary-card[data-bot-id="misty"]');
    const mistyRow = (gameSpecId: string) =>
      mistyCard?.querySelector(`.profile-summary-card-variant[data-game-spec-id="${gameSpecId}"]`);
    expect(
      mistyRow('dark-chess')?.querySelector('.profile-summary-card-rating-value')?.textContent,
    ).toBe('1,812');
    expect(mistyRow('dark-chess')?.textContent).toContain('12 games · 8-3-1');
    expect(mistyRow('banqi')?.textContent).toContain('0 games');
    expect(mistyRow('banqi')?.textContent).not.toContain('0-0-0');
    expect(
      mistyRow('banqi')?.querySelector('.profile-summary-card-rating-value')?.textContent,
    ).toBe('1,620');
    expect(mistyCard?.querySelector('.profile-summary-card-footer')).toBeNull();

    const badge = (botId: string) =>
      root.querySelector(
        `.profile-summary-card[data-bot-id="${botId}"] .profile-summary-card-badge`,
      )?.textContent;
    expect(badge('fairy-stockfish-level-2')).toBe('Start here');
    expect(badge('fairy-stockfish-level-1')).toBe('BOT');
    expect(badge('pikafish')).toBe('Strongest');
    // Each rung leads with its xiangqi row, whose Play is the one filled button.
    const firstRow = root.querySelector(
      '.profile-summary-card[data-bot-id="fairy-stockfish-level-1"] .profile-summary-card-variant',
    );
    expect(firstRow?.getAttribute('data-game-spec-id')).toBe('xiangqi');
    const primary = firstRow?.querySelector('.profile-summary-card-action');
    expect(primary?.textContent).toBe('Play');
    expect(primary?.getAttribute('aria-label')).toBe('Play Xiangqi');
    expect(primary?.classList.contains('profile-summary-card-action-primary')).toBe(true);
    expect(
      root.querySelectorAll(
        '.profile-summary-card[data-bot-id="fairy-stockfish-level-1"] .profile-summary-card-action-primary',
      ),
    ).toHaveLength(1);

    const ladderCards = [
      ...root.querySelectorAll('.profile-summary-card[data-bot-id^="fairy-stockfish-level-"]'),
    ];
    expect(ladderCards).toHaveLength(8);
    expect(
      ladderCards.map((card) =>
        card.querySelector<HTMLAnchorElement>('.profile-summary-card-name')?.getAttribute('href'),
      ),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((level) => `/bot/fairy-stockfish-level-${level}`));
    for (const card of ladderCards) {
      expect(card.getAttribute('data-subject-kind')).toBe('bot');
      expect(card.querySelector('.profile-summary-card-avatar')).not.toBeNull();
      expect(card.querySelector('.profile-summary-card-bio')).toBeNull();
      expect(
        [...card.querySelectorAll('.profile-summary-card-variant')].map((row) =>
          row.getAttribute('data-game-spec-id'),
        ),
      ).toEqual(['xiangqi', 'fortress-xiangqi']);
    }
    // Pikafish (xiangqi + jieqi) leads with xiangqi in the xiangqi section.
    expect(
      root
        .querySelector(
          '.profile-summary-card[data-bot-id="pikafish"] .profile-summary-card-variant',
        )
        ?.getAttribute('data-game-spec-id'),
    ).toBe('xiangqi');
  });

  it('shows the xiangqi blitz rating per FSF card, dash and ?-suffix included', async () => {
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

    const ratings = [
      ...root.querySelectorAll('.profile-summary-card[data-bot-id^="fairy-stockfish-level-"]'),
    ].map(
      (card) =>
        card.querySelector('[data-game-spec-id="xiangqi"] .profile-summary-card-rating-value')
          ?.textContent || '—',
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
    const root = document.createElement('div');
    const { mountBots } = await import('./bots.js');

    await mountBots(root);
    const fogChip = root.querySelector<HTMLButtonElement>(
      '[data-game-spec-id="dark-chess"] button.profile-summary-card-action',
    );
    expect(fogChip?.getAttribute('aria-label')).toBe('Play Fog Chess');
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
    const root = document.createElement('div');
    const { mountBots } = await import('./bots.js');

    await mountBots(root);
    const offChip = root.querySelector<HTMLElement>('.profile-summary-card-action-unavailable');
    expect(offChip?.closest('[data-game-spec-id]')?.getAttribute('data-game-spec-id')).toBe(
      'fortress-xiangqi',
    );
    expect(offChip?.textContent).toBe('Play');
    expect(offChip?.title).toBe('Not available right now');
    expect(offChip?.tagName).not.toBe('BUTTON');
    offChip?.click();
    await flushPromises();

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
            { gameSpecId: 'banqi', engineId: 'misty-banqi', playable: true, version: '0.2.7' },
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
      'Fairy-Stockfish · Version 1b5bdd40',
    );
    // A one-variant bot keeps the compact card: one Play sized to its label, a footer.
    expect(level1?.querySelector('.profile-summary-card-variants')).toBeNull();
    expect(level1?.querySelectorAll('.profile-summary-card-action')).toHaveLength(1);
    expect(level1?.querySelector('.profile-summary-card-footer')).not.toBeNull();

    const mistyCard = card('misty');
    expect(mistyCard?.querySelector('.profile-summary-card-version')).toBeNull();
    const rowText = (gameSpecId: string) =>
      mistyCard?.querySelector(`[data-game-spec-id="${gameSpecId}"]`)?.textContent ?? '';
    expect(rowText('dark-chess')).toContain('Version 1.6');
    expect(rowText('banqi')).toContain('Version 0.2.7');
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

    await mountBots(root);

    const rows = [...root.querySelectorAll('.profile-summary-card-variant')];
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
        { gameSpecId: 'banqi', engineId: 'misty-banqi', playable: true, version: '0.2.7' },
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
    expect(version()).toBe('0.2.7');
  });
});
