import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('profile ratings rail', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('shows public Fanfanqi activity after Banqi with counts and results, never ratings', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_FFQ_BANQI_ENABLED', 'true');
    vi.stubEnv('VITE_BANQI_ENABLED', 'true');
    const { mountProfile } = await import('./profile.js');
    const requests: URL[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input), 'http://localhost');
      requests.push(url);
      return new Response(
        JSON.stringify(
          url.pathname.endsWith('/profile')
            ? {
                profile: {
                  user: {
                    handle: 'alice',
                    displayName: 'Alice',
                    accountRole: 'player',
                    profileVisibility: 'public',
                    createdAt: '2026-01-01T00:00:00Z',
                  },
                  ratings: [],
                  activity: [
                    { variant: 'ffq-banqi', totalGamesPlayed: 23, wins: 12, draws: 3, losses: 8 },
                  ],
                  games: [],
                  gamesTotal: 23,
                },
              }
            : { games: [], total: 23, players: [] },
        ),
      );
    });
    const root = document.createElement('main');
    await mountProfile(root, 'alice');
    const row = root.querySelector<HTMLButtonElement>(
      '.profile-rating-row[data-variant="ffq-banqi"]',
    );
    expect(row).not.toBeNull();
    expect(row?.previousElementSibling?.getAttribute('data-variant')).toBe('banqi');
    expect(row?.textContent).toContain('Fanfanqi');
    expect(row?.textContent).toContain('23 games');
    expect(row?.classList.contains('profile-rating-row-empty')).toBe(false);
    expect(
      row?.querySelector('.profile-rating-value, .profile-rating-pace, .champion-crown'),
    ).toBeNull();
    row?.click();
    await vi.waitFor(() =>
      expect(
        requests.some(
          (url) =>
            url.pathname.endsWith('/games') && url.searchParams.get('variant') === 'ffq-banqi',
        ),
      ).toBe(true),
    );
    const spotlight = root.querySelector('.profile-rating-spotlight');
    expect(spotlight?.textContent).toContain('12 wins');
    expect(spotlight?.textContent).toContain('3 draws');
    expect(spotlight?.textContent).toContain('8 losses');
    expect(spotlight?.querySelector('.profile-rating-chart, .profile-chart-ranges')).toBeNull();
    expect(
      requests.some(
        (url) =>
          url.pathname.endsWith('/rating-history') &&
          url.searchParams.get('variant') === 'ffq-banqi',
      ),
    ).toBe(false);
    root.querySelector<HTMLButtonElement>('[data-result="win"]')?.click();
    await vi.waitFor(() =>
      expect(
        requests.some(
          (url) =>
            url.pathname.endsWith('/games') &&
            url.searchParams.get('variant') === 'ffq-banqi' &&
            url.searchParams.get('result') === 'win',
        ),
      ).toBe(true),
    );
    const { leaderboardVariants } = await import('./variants.js');
    expect(leaderboardVariants.some((variant) => variant.gameSpecId === 'ffq-banqi')).toBe(false);
    const { RATING_VARIANT_LABEL_KEY } = await import('./champion-crowns.js');
    expect(Object.keys(RATING_VARIANT_LABEL_KEY)).not.toContain('ffq_banqi');
  });

  it('omits the Fanfanqi row when its spec is hidden, even with activity in the payload', async () => {
    vi.resetModules();
    const { gameSpecForId } = await import('@mistboard/game');
    const spec = gameSpecForId('ffq-banqi');
    const surface = spec.publicSurface;
    try {
      spec.publicSurface = 'hidden';
      vi.stubEnv('VITE_FFQ_BANQI_ENABLED', 'true');
      const { buildProfileRatings } = await import('./profile.js');
      const section = buildProfileRatings([], 'en', {
        activity: [{ variant: 'ffq-banqi', totalGamesPlayed: 23, wins: 12, draws: 3, losses: 8 }],
      });
      expect(section.querySelector('[data-variant="ffq-banqi"]')).toBeNull();
    } finally {
      spec.publicSurface = surface;
    }
  });

  it.each([
    ['en', ['Xiangqi blitz champion', 'Flip Jungle correspondence champion']],
    ['zh-Hans', ['象棋闪电冠军', '翻翻兽棋通信对局冠军']],
    ['zh-Hant', ['象棋閃電冠軍', '翻翻獸棋通信對局冠軍']],
  ] as const)('shows labelled profile champion ladders in %s', async (locale, labels) => {
    const { ensureLocaleCatalog } = await import('./i18n/catalog.js');
    await ensureLocaleCatalog(locale);
    const { buildProfileOverview } = await import('./profile.js');
    const profile: Parameters<typeof buildProfileOverview>[0] = {
      user: {
        handle: 'alice',
        displayName: 'Alice',
        accountRole: 'player',
        profileVisibility: 'public',
        createdAt: '2026-01-01T00:00:00Z',
        champions: [
          { variant: 'xiangqi', timeClass: 'blitz' },
          { variant: 'jungle_flip', timeClass: 'correspondence' },
        ],
      },
      ratings: [],
      games: [],
      gamesTotal: 0,
    };
    const overview = buildProfileOverview(profile, document.createElement('div'), locale);
    const items = [...overview.querySelectorAll('.profile-championship')];
    expect(items.map((item) => item.textContent)).toEqual(labels);
    expect(items.map((item) => item.querySelector('img')?.getAttribute('alt'))).toEqual(labels);
    for (const champions of [undefined, []]) {
      profile.user.champions = champions;
      const empty = buildProfileOverview(profile, document.createElement('div'), locale);
      expect(empty.querySelector('.profile-championships')).toBeNull();
      expect(empty.textContent).not.toContain('vacant');
    }
  });

  it('shows one champion crown beside an online player who holds titles', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input), 'http://localhost');
      return new Response(
        JSON.stringify(
          url.pathname === '/api/players/online'
            ? {
                players: [
                  {
                    handle: 'alice',
                    displayName: 'Alice',
                    rating: null,
                    champions: [
                      { variant: 'xiangqi', timeClass: 'blitz' },
                      { variant: 'banqi', timeClass: 'rapid' },
                    ],
                  },
                  { handle: 'bob', displayName: 'Bob', rating: null, champions: [] },
                  { handle: 'cara', displayName: 'Cara', rating: null },
                ],
                count: 3,
              }
            : { ladders: [] },
        ),
      );
    });
    const { mountLeaderboard } = await import('./profile.js');
    const root = document.createElement('main');
    await mountLeaderboard(root);
    const links = [...root.querySelectorAll('.leaderboard-online-list a')];
    expect(links).toHaveLength(3);
    const crowns = [...links[0]!.querySelectorAll<HTMLImageElement>('.champion-crown')];
    expect(crowns.map((icon) => icon.alt)).toEqual([
      'Xiangqi blitz champion, Banqi rapid champion',
    ]);
    expect(crowns[0]!.width).toBe(16);
    expect(links[1]!.querySelector('.champion-crowns')).toBeNull();
    expect(links[2]!.querySelector('.champion-crowns')).toBeNull();
  });

  it('carries multiple champion crowns from leaderboard summaries into variant rows', async () => {
    vi.stubEnv('VITE_XIANGQI_ENABLED', 'true');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input), 'http://localhost');
      return new Response(
        JSON.stringify(
          url.pathname === '/api/leaderboard/summary'
            ? {
                ladders: [
                  {
                    variant: 'xiangqi',
                    leaderboard: [
                      {
                        rank: 1,
                        handle: 'alice',
                        displayName: 'Alice',
                        eloRating: 2000,
                        provisional: false,
                        champions: [
                          { variant: 'xiangqi', timeClass: 'blitz' },
                          { variant: 'banqi', timeClass: 'rapid' },
                        ],
                      },
                      {
                        rank: 2,
                        handle: 'bob',
                        displayName: 'Bob',
                        eloRating: 1900,
                        provisional: false,
                        champions: [],
                      },
                      {
                        rank: 3,
                        handle: 'guest',
                        displayName: 'Guest',
                        eloRating: 1800,
                        provisional: false,
                      },
                    ],
                  },
                ],
              }
            : { players: [] },
        ),
      );
    });
    const { mountLeaderboard } = await import('./profile.js');
    const root = document.createElement('main');
    await mountLeaderboard(root);
    const rows = [
      ...root.querySelectorAll(
        '.leaderboard-variant-section[data-variant="xiangqi"] .leaderboard-panel[data-time-class="blitz"] .leaderboard-table tr',
      ),
    ];
    expect(rows).toHaveLength(3);
    const crowns = [...rows[0]!.querySelectorAll<HTMLImageElement>('.champion-crown')];
    expect(crowns.map((icon) => icon.alt)).toEqual([
      'Xiangqi blitz champion, Banqi rapid champion',
    ]);
    expect(crowns.map((icon) => icon.width)).toEqual([16]);
    expect(crowns.map((icon) => icon.title)).toEqual(
      crowns.map((icon) => icon.getAttribute('aria-label')),
    );
    expect(rows[1]!.querySelector('.champion-crowns')).toBeNull();
    expect(rows[2]!.querySelector('.champion-crowns')).toBeNull();
  });

  it('shows the correspondence ladders when the rated switch lands during the first fetches', async () => {
    const { setRatedModeEnabled } = await import('./rated-flag.js');
    const requested: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input), 'http://localhost');
      if (url.pathname === '/api/leaderboard/summary') {
        const timeClass = url.searchParams.get('timeClass') ?? '';
        requested.push(timeClass);
        // /api/server-status answers while the first ladders are in flight.
        if (requested.length === 1) setRatedModeEnabled(true, true);
        return new Response(
          JSON.stringify({
            ladders: [
              {
                variant: 'xiangqi',
                leaderboard: [
                  {
                    rank: 1,
                    handle: `top-${timeClass}`,
                    displayName: `Top ${timeClass}`,
                    eloRating: 1720,
                    provisional: true,
                  },
                ],
              },
            ],
          }),
        );
      }
      return new Response(JSON.stringify({ players: [] }));
    });
    const { mountLeaderboard } = await import('./profile.js');
    const root = document.createElement('main');
    await mountLeaderboard(root);
    await vi.waitFor(() =>
      expect(
        root.querySelector(
          '.leaderboard-variant-section[data-variant="xiangqi"] .leaderboard-panel[data-time-class="correspondence"]',
        ),
      ).not.toBeNull(),
    );
    expect(requested).toContain('correspondence');
    expect(root.textContent).toContain('Top correspondence');
  });

  it.each([
    ['/player', '/'],
    ['/zh-hans', '/zh-hans/'],
    ['/zh-hant', '/zh-hant/'],
  ])('links the empty leaderboard directly to the lobby at %s', async (path, href) => {
    window.history.replaceState(null, '', path);
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response(JSON.stringify({ ladders: [], players: [] })),
    );
    const { mountLeaderboard } = await import('./profile.js');
    const root = document.createElement('main');
    await mountLeaderboard(root);

    expect(root.querySelector('.leaderboard-awaiting a')?.getAttribute('href')).toBe(href);
  });

  it.each([
    ['en', 'Title verification'],
    ['zh-Hans', '头衔认证'],
    ['zh-Hant', '頭銜認證'],
  ] as const)('leaves title verification to settings in %s', async (locale, label) => {
    const { buildProfileOverview } = await import('./profile.js');
    const profile: Parameters<typeof buildProfileOverview>[0] = {
      isViewer: true,
      relation: null,
      user: {
        handle: 'player',
        displayName: 'Player',
        profileVisibility: 'public',
        accountRole: 'player',
        createdAt: '2026-05-01T00:00:00.000Z',
      },
      ratings: [],
      games: [],
      gamesTotal: 0,
    };
    for (const title of [null, 'xgm']) {
      profile.user.title = title;
      const overview = buildProfileOverview(profile, document.createElement('div'), locale);
      expect(overview.querySelector('a[href="/verify-title"]'), label).toBeNull();
      expect(overview.querySelector('a[href="/account/settings"]')).not.toBeNull();
      expect(overview.querySelector('a[href="/coach/edit"]') !== null).toBe(title === 'xgm');
    }

    profile.isViewer = false;
    for (const relation of [null, { following: false, blocked: false }]) {
      profile.relation = relation;
      const overview = buildProfileOverview(profile, document.createElement('div'), locale);
      expect(overview.querySelector('a[href="/verify-title"]')).toBeNull();
    }
  });

  it.each([
    ['brianhliou-dev', 'admin', true, ['Admin', 'Founder']],
    ['another-admin', 'admin', false, ['Admin']],
    ['player', 'player', false, []],
  ] as const)(
    'renders only server-assigned badges for %s',
    async (handle, accountRole, isFounder, labels) => {
      const { buildProfileOverview } = await import('./profile.js');
      const profile: Parameters<typeof buildProfileOverview>[0] = {
        user: {
          handle,
          displayName: handle,
          accountRole,
          isFounder,
          profileVisibility: 'public',
          createdAt: '2026-01-01T00:00:00Z',
        },
        ratings: [],
        games: [],
        gamesTotal: 0,
      };
      const overview = buildProfileOverview(profile, document.createElement('div'), 'en');
      expect(
        [...overview.querySelectorAll('.profile-role-badge')].map((badge) => badge.textContent),
      ).toEqual(labels);
      expect(
        overview
          .querySelector('.profile-role-founder')
          ?.previousElementSibling?.classList.contains('profile-role-admin') ?? false,
      ).toBe(isFounder);
    },
  );

  it.each([
    ['en', 'Founder'],
    ['zh-Hans', '创始人'],
    ['zh-Hant', '創辦人'],
  ] as const)('localizes the founder badge in %s', async (locale, label) => {
    const { buildProfileOverview } = await import('./profile.js');
    const overview = buildProfileOverview(
      {
        user: {
          handle: 'brianhliou-dev',
          displayName: 'Brian',
          accountRole: 'admin',
          isFounder: true,
          profileVisibility: 'public',
          createdAt: '2026-01-01T00:00:00Z',
        },
        ratings: [],
        games: [],
        gamesTotal: 0,
      },
      document.createElement('div'),
      locale,
    );
    expect(overview.querySelector('.profile-role-founder')?.textContent).toBe(label);
  });

  it.each([
    [false, false, '', true],
    [true, false, '', true],
    [false, true, '', false],
    [false, false, '?variant=xiangqi', false],
  ] as const)(
    'opens the puzzle chart with viewer=%s rated=%s url=%s',
    async (isViewer, rated, search, opensPuzzle) => {
      window.history.replaceState(null, '', `/@/solver${search}`);
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = new URL(String(input), 'http://localhost');
        if (url.pathname.endsWith('/profile'))
          return new Response(
            JSON.stringify({
              profile: {
                isViewer,
                user: {
                  handle: 'solver',
                  displayName: 'Solver',
                  accountRole: 'player',
                  profileVisibility: 'public',
                  createdAt: '2026-01-01T00:00:00Z',
                },
                ratings: [
                  {
                    variant: 'xiangqi',
                    timeClass: 'blitz',
                    eloRating: rated ? 1500 : null,
                    ratedGamesPlayed: rated ? 3 : 0,
                    totalGamesPlayed: 5,
                    provisional: false,
                  },
                ],
                puzzleRatings: [
                  {
                    variant: 'jungle',
                    rating: 1700,
                    provisional: false,
                    solved: 100,
                    attempts: 110,
                  },
                  {
                    variant: 'fortress-xiangqi',
                    rating: 1700,
                    provisional: false,
                    solved: 100,
                    attempts: 110,
                  },
                  { variant: 'xiangqi', rating: 1520, provisional: false, solved: 2, attempts: 3 },
                ],
                games: [],
                gamesTotal: 0,
              },
            }),
          );
        if (url.pathname.endsWith('/puzzle-rating-history'))
          return new Response(
            JSON.stringify({
              points: [
                {
                  variant: 'xiangqi',
                  createdAt: '2026-11-01T12:00:00Z',
                  ratingBefore: 1500,
                  ratingAfter: 1520,
                  startsSegment: true,
                },
              ],
            }),
          );
        return new Response(
          JSON.stringify({
            history: { points: [] },
            attempts: [],
            nextOffset: null,
            players: [],
            games: [],
          }),
        );
      });
      const { mountProfile } = await import('./profile.js');
      const root = document.createElement('div');
      await mountProfile(root, 'solver');
      expect(root.querySelector('.profile-chart-variant')?.textContent?.includes('Puzzles')).toBe(
        opensPuzzle,
      );
      expect(root.querySelector('.profile-puzzle-ratings')?.textContent).not.toMatch(
        /Jungle|Fortress/,
      );
      expect(
        root.querySelector('.profile-rating-row[data-variant="xiangqi"]')?.textContent,
      ).not.toContain('Unrated');
      if (opensPuzzle) {
        await vi.waitFor(() =>
          expect(root.querySelectorAll('.profile-rating-chart-dot')).toHaveLength(1),
        );
        expect(root.querySelector('.profile-rating-chart')?.outerHTML).not.toMatch(
          /puzzleId|solved|roomId/,
        );
        expect(root.textContent).not.toContain('Only you can see');
      } else if (!rated) {
        expect(root.querySelector('.profile-chart-value')).toBeNull();
        expect(root.querySelector('.profile-chart-detail')?.textContent).toBe('5 games');
      }
      expect(
        fetchSpy.mock.calls.some(([url]) => String(url).startsWith('/api/puzzles/history')),
      ).toBe(isViewer);
      expect(
        fetchSpy.mock.calls.some(([url]) => String(url).endsWith('/puzzle-rating-history')),
      ).toBe(opensPuzzle);
    },
  );

  it('opens on the puzzle rating only when there is no game rating to show', async () => {
    const { openingPuzzleSpotlight } = await import('./profile.js');
    type Ratings = Parameters<typeof openingPuzzleSpotlight>[0];
    const puzzles = [
      { variant: 'fortress-xiangqi', rating: 1500, provisional: true, solved: 90, attempts: 90 },
      { variant: 'jungle', rating: 1500, provisional: true, solved: 80, attempts: 80 },
      { variant: 'xiangqi', rating: 1673, provisional: true, solved: 56, attempts: 102 },
    ];
    const unrated = {
      variant: 'banqi',
      eloRating: null,
      ratedGamesPlayed: 0,
      totalGamesPlayed: 92,
    };
    const rated = { variant: 'banqi', eloRating: 1500, ratedGamesPlayed: 3, totalGamesPlayed: 92 };

    expect(openingPuzzleSpotlight([unrated] as Ratings, puzzles)?.variant).toBe('xiangqi');
    expect(openingPuzzleSpotlight([rated] as Ratings, puzzles)).toBeNull();
    expect(openingPuzzleSpotlight([unrated] as Ratings, [])).toBeNull();
    expect(openingPuzzleSpotlight([unrated] as Ratings, puzzles.slice(0, 2))).toBeNull();
  });

  it('writes activity results in the plural past one', async () => {
    const { profileGameActivityRow } = await import('./profile.js');
    const summary = (wins: number, draws: number, losses: number) =>
      ({
        key: 'k',
        day: 'Today',
        variant: 'Banqi',
        time: 0,
        count: wins + draws + losses,
        wins,
        draws,
        losses,
      }) as Parameters<typeof profileGameActivityRow>[0];
    const pills = (s: Parameters<typeof profileGameActivityRow>[0], locale: 'en' | 'zh-Hans') =>
      profileGameActivityRow(s, locale).pills.map((pill) => pill.text);

    expect(pills(summary(2, 3, 4), 'en')).toEqual(['2 wins', '3 draws', '4 losses']);
    expect(pills(summary(1, 1, 1), 'en')).toEqual(['1 win', '1 draw', '1 loss']);
    expect(pills(summary(0, 0, 3), 'zh-Hans')).toEqual(['3 负']);
  });

  it('shows soft-launch profile rows before rated games', async () => {
    // Pin prod semantics so dev-on variants (jieqi/banqi) don't add extra rows.
    vi.stubEnv('DEV', false);
    const { buildProfileRatings } = await import('./profile.js');

    const section = buildProfileRatings([]);

    expect(section.textContent).toContain('Fog Chess');
    // Duck + Crazyhouse + Flip Jungle + Jungle + Dark Chess (always-on) +
    // Xiangqi Mahjong (launched 2026-10-25) + Gomoku + Fanfanqi activity = 8 rows. Fortress and Atomic Xiangqi retired on 2026-10-11: their pools are
    // kept but no profile lists them.
    expect(section.querySelectorAll('.profile-rating-row-empty')).toHaveLength(8);
    expect(section.textContent).toContain('Xiangqi Mahjong');
    expect(section.textContent).toContain('Gomoku');
    expect(section.textContent).not.toContain('Fortress Xiangqi');
    expect(section.textContent).not.toContain('Atomic Xiangqi');
  });

  it('localizes Traditional Chinese profile ratings rows', async () => {
    vi.stubEnv('DEV', false);
    const { buildProfileRatings } = await import('./profile.js');

    // Xiangqi pivot: Drop Mini is off the rating grids; localize an on-grid row
    // (Crazyhouse Xiangqi) instead.
    const section = buildProfileRatings(
      [
        {
          variant: 'crazyhouse_xiangqi',
          timeClass: 'blitz',
          eloRating: 1520,
          ratedGamesPlayed: 2,
          totalGamesPlayed: 3,
          provisional: false,
        },
      ],
      'zh-Hant',
    );

    expect(section.querySelector('h2')?.textContent).toBe('評分');
    expect(section.textContent).toContain('瘋狂屋象棋');
    expect(section.textContent).toContain('2 局計分對局');
  });

  it('localizes Traditional Chinese profile game rows', async () => {
    const { buildProfileGameRow } = await import('./profile-ui.js');

    const row = buildProfileGameRow(
      {
        roomId: 'room-1',
        variant: 'dark-mini-xiangqi',
        mode: 'pvp',
        rated: true,
        result: 'red-wins',
        termination: 'resignation',
        plyCount: 12,
        whiteName: null,
        blackName: null,
        corpusId: null,
        endedAt: '2026-06-01T12:00:00.000Z',
        participants: [
          {
            color: 'red',
            displayName: 'Misty',
            subjectType: 'user',
            subjectId: 'user-red',
            visibility: 'public',
          },
          {
            color: 'black',
            displayName: 'Opponent',
            subjectType: 'user',
            subjectId: 'user-black',
            visibility: 'public',
          },
        ],
        playerColor: 'red',
      },
      { locale: 'zh-Hant', timeOnly: true },
    );

    expect(row.textContent).toContain('勝');
    expect(row.textContent).toContain('對 Opponent');
    expect(row.textContent).toContain('迷霧迷你象棋');
    expect(row.textContent).toContain('紅方');
    expect(row.textContent).toContain('計分');
    expect(row.textContent).toContain('人類對人類');
    expect(row.textContent).toContain('12 手');
  });

  it.each([false, true])(
    'pages profile games past a new finish, filtered=%s (#630)',
    async (filtered) => {
      if (filtered)
        window.history.replaceState(null, '', '/@/pager?variant=xiangqi&result=win&vs=bob');
      const game = (index: number) => ({
        roomId: `room_${String(index).padStart(3, '0')}`,
        variant: 'xiangqi',
        mode: 'pvp',
        rated: false,
        result: 'red-wins',
        termination: 'resignation',
        plyCount: 20,
        whiteName: null,
        blackName: null,
        corpusId: null,
        endedAt: '2026-07-01T12:00:00.000Z',
        participants: [],
        playerColor: 'red',
      });
      const original = Array.from({ length: 31 }, (_, i) => game(31 - i));
      const dataset = [...original];
      const requests: URL[] = [];
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = new URL(String(input), 'http://localhost');
        if (url.pathname.endsWith('/rating-history')) return json({ points: [] });
        if (url.pathname.endsWith('/games')) {
          requests.push(url);
          const before = url.searchParams.get('before');
          const rows = before
            ? dataset.filter((row) => row.roomId < JSON.parse(before)[1])
            : dataset.slice(Number(url.searchParams.get('offset') ?? 0));
          return json({ games: rows.slice(0, 15), total: dataset.length });
        }
        return json({
          profile: {
            isViewer: false,
            relation: null,
            user: {
              handle: 'pager',
              displayName: 'pager',
              bio: '',
              profileVisibility: 'public',
              accountRole: 'player',
              createdAt: '2026-05-01T00:00:00.000Z',
            },
            ratings: [],
            puzzleRatings: [],
            games: original.slice(0, 15),
            gamesTotal: 31,
          },
        });
      });
      const root = document.createElement('div');
      const { mountProfile } = await import('./profile.js');
      await mountProfile(root, 'pager');
      const links = () =>
        Array.from(root.querySelectorAll('.profile-games .profile-game-row-open'), (row) =>
          row.getAttribute('href'),
        );
      await vi.waitFor(() => expect(links()).toHaveLength(15));
      dataset.unshift(game(32));
      const more = () =>
        root.querySelector<HTMLButtonElement>('.profile-games .profile-games-more-btn');
      more()?.click();
      await vi.waitFor(() => expect(links()).toHaveLength(30));
      expect(more()).not.toBeNull();
      more()?.click();
      await vi.waitFor(() => expect(more()).toBeNull());
      expect(links()).toEqual(original.map((row) => `/xiangqi/game/${row.roomId}`));
      const older = requests.filter((url) => url.searchParams.has('before'));
      expect(older).toHaveLength(2);
      expect(JSON.parse(older[1].searchParams.get('before') ?? 'null')).toEqual([
        original[29].endedAt,
        original[29].roomId,
      ]);
      for (const url of older) {
        expect(url.searchParams.has('offset')).toBe(false);
        if (filtered) {
          expect(url.searchParams.get('variant')).toBe('xiangqi');
          expect(url.searchParams.get('result')).toBe('win');
          expect(url.searchParams.get('vs')).toBe('bob');
        }
      }
    },
  );

  it('mounts the profile dashboard with activity and games tabs', async () => {
    vi.stubEnv('DEV', false);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/players/online')) {
        return new Response(
          JSON.stringify({
            players: [{ handle: 'dev-testing', displayName: 'dev-testing', rating: null }],
            count: 1,
            anonymousOnline: 0,
          }),
          { headers: { 'content-type': 'application/json' }, status: 200 },
        );
      }
      if (url.includes('/rating-history')) {
        return new Response(
          JSON.stringify({
            history: {
              variant: 'jungle_flip',
              timeClass: 'blitz',
              points: [
                {
                  roomId: 'jgf-profile-1',
                  endedAt: '2026-07-05T07:17:00.000Z',
                  ratingBefore: 1648,
                  ratingAfter: 1662,
                },
                {
                  roomId: 'jgf-profile-2',
                  endedAt: '2026-07-05T07:18:00.000Z',
                  ratingBefore: 1662,
                  ratingAfter: 1655,
                },
              ],
            },
          }),
          { headers: { 'content-type': 'application/json' }, status: 200 },
        );
      }
      if (url.includes('/api/games/favorites')) {
        return new Response(
          JSON.stringify({
            games: [
              {
                roomId: 'saved-xiangqi-1',
                variant: 'xiangqi',
                mode: 'pvp',
                rated: false,
                result: 'red-wins',
                termination: 'resignation',
                plyCount: 48,
                whiteName: null,
                blackName: null,
                corpusId: null,
                endedAt: '2026-07-01T12:00:00.000Z',
                participants: [
                  {
                    color: 'red',
                    displayName: 'Red Player',
                    subjectType: 'user',
                    subjectId: 'u_red',
                    visibility: 'public',
                  },
                  {
                    color: 'black',
                    displayName: 'Black Player',
                    subjectType: 'user',
                    subjectId: 'u_black',
                    visibility: 'public',
                  },
                ],
              },
            ],
            total: 1,
          }),
          { headers: { 'content-type': 'application/json' }, status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          profile: {
            isViewer: true,
            relation: null,
            user: {
              handle: 'dev-testing',
              displayName: 'dev-testing',
              bio: 'Learning hidden-information xiangqi.',
              location: 'Taipei',
              profileLinks: ['https://example.com/xiangqi'],
              profileVisibility: 'public',
              accountRole: 'player',
              patronSince: '2026-06-15T00:00:00.000Z',
              createdAt: '2026-05-01T00:00:00.000Z',
            },
            ratings: [
              {
                variant: 'jungle_flip',
                timeClass: 'blitz',
                eloRating: 1662,
                ratedGamesPlayed: 4,
                totalGamesPlayed: 7,
                provisional: false,
              },
            ],
            puzzleRatings: [
              {
                variant: 'xiangqi',
                rating: 1575,
                provisional: false,
                solved: 12,
                attempts: 18,
              },
              {
                variant: 'fortress-xiangqi',
                rating: 1510,
                provisional: true,
                solved: 3,
                attempts: 7,
              },
              {
                variant: 'jungle',
                rating: 1490,
                provisional: false,
                solved: 5,
                attempts: 9,
              },
            ],
            games: [
              {
                roomId: 'jgf-profile-1',
                variant: 'jungle-flip',
                mode: 'pve',
                rated: false,
                result: 'draw',
                termination: 'agreement',
                plyCount: 21,
                whiteName: null,
                blackName: null,
                corpusId: null,
                endedAt: '2026-07-05T07:17:00.000Z',
                participants: [
                  {
                    color: 'red',
                    displayName: 'MistyJungleFlip',
                    subjectType: 'engine-version',
                    subjectId: 'container-jungle-flip-v1',
                    visibility: 'public',
                  },
                  {
                    color: 'black',
                    displayName: 'dev-testing',
                    subjectType: 'user',
                    subjectId: 'u_dev',
                    visibility: 'public',
                  },
                ],
                playerColor: 'black',
              },
              {
                roomId: 'jgf-profile-2',
                variant: 'jungle-flip',
                mode: 'pve',
                rated: false,
                result: 'red-wins',
                termination: 'resignation',
                plyCount: 32,
                whiteName: null,
                blackName: null,
                corpusId: null,
                endedAt: '2026-07-05T07:16:00.000Z',
                participants: [
                  {
                    color: 'red',
                    displayName: 'MistyJungleFlip',
                    subjectType: 'engine-version',
                    subjectId: 'container-jungle-flip-v1',
                    visibility: 'public',
                  },
                  {
                    color: 'black',
                    displayName: 'dev-testing',
                    subjectType: 'user',
                    subjectId: 'u_dev',
                    visibility: 'public',
                  },
                ],
                playerColor: 'black',
              },
            ],
            gamesTotal: 2,
          },
        }),
        { headers: { 'content-type': 'application/json' }, status: 200 },
      );
    });
    const root = document.createElement('div');
    const { mountProfile } = await import('./profile.js');

    await mountProfile(root, 'dev-testing');

    // The profile request carries the viewer's calendar for the play streak.
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\/api\/users\/dev-testing\/profile\?tz=[^&]+$/),
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/users/dev-testing/rating-history?variant=jungle_flip&timeClass=blitz',
    );
    await vi.waitFor(() => {
      expect(root.querySelector('.profile-rating-chart-line')).not.toBeNull();
    });
    expect(root.querySelector('.profile-rating-chart-empty')).toBeNull();
    expect(root.querySelector('.profile-rating-spotlight')?.textContent).toContain('1662');
    expect(root.querySelector('.profile-overview')?.textContent).toContain('@dev-testing');
    const patronBadge = root.querySelector<HTMLAnchorElement>('.profile-role-patron');
    expect(patronBadge?.getAttribute('href')).toBe('/patron');
    expect(patronBadge?.querySelector('.profile-patron-icon')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
    expect(root.querySelector('.profile-info-card')).toBeNull();
    expect(root.querySelector('.profile-rating-row-selected')?.textContent).toContain(
      'Flip Jungle',
    );
    expect(root.querySelector('.profile-activity-summary-row')?.textContent).toContain(
      'Played 2 Flip Jungle games',
    );
    expect(root.querySelector('.profile-activity-summary-row')?.textContent).toContain('1 draw');
    expect(root.querySelector('.profile-activity-summary-row')?.textContent).toContain('1 loss');
    const puzzleRatings = root.querySelector('.profile-puzzle-ratings');
    expect(puzzleRatings?.textContent).toContain('Xiangqi');
    expect(puzzleRatings?.textContent).not.toContain('Fortress Xiangqi');
    expect(puzzleRatings?.textContent).not.toContain('Jungle');

    // Lichess-style identity block: presence dot ahead of the handle (filled
    // once /api/players/online confirms), the join date in the side column, and
    // an Edit profile action on your own profile.
    expect(root.querySelector('.profile-overview-side')?.textContent).toContain('Member since');
    expect(root.querySelector('.profile-side-bio')?.textContent).toBe(
      'Learning hidden-information xiangqi.',
    );
    expect(root.querySelector('.profile-overview-side')?.textContent).toContain('Taipei');
    expect(root.querySelector<HTMLAnchorElement>('.profile-side-links a')?.href).toBe(
      'https://example.com/xiangqi',
    );
    expect(root.querySelector('h1 .profile-presence')).not.toBeNull();
    await vi.waitFor(() => {
      expect(root.querySelector('.profile-presence-online')).not.toBeNull();
    });
    expect(root.querySelector('.profile-presence-online')?.getAttribute('aria-label')).toBe(
      'Online',
    );
    const edit = root.querySelector<HTMLAnchorElement>('.profile-owner-actions a');
    expect(edit?.getAttribute('href')).toBe('/account/settings');
    expect(edit?.textContent).toBe('Edit profile');

    // Counts strip under the name: total games + rated games (sum across buckets).
    const counts = root.querySelector('.profile-counts');
    expect(counts?.textContent).toContain('Rated games');
    expect(counts?.textContent).toContain('4');

    // Canonical ordering: the rail reads in the shared registry order (xiangqi
    // first) regardless of activity; played rows stand out by not dimming.
    const railRows = [...root.querySelectorAll<HTMLElement>('.profile-rating-row')];
    const { profileRatingVariants, profileActivityVariants } = await import('./variants.js');
    const { canonicalVariantOrderIndex } = await import('@mistboard/game');
    expect(railRows.map((row) => row.dataset.variant)).toEqual(
      [...profileRatingVariants, ...profileActivityVariants]
        .sort(
          (a, b) =>
            canonicalVariantOrderIndex(a.gameSpecId) - canonicalVariantOrderIndex(b.gameSpecId),
        )
        .map((variant) => variant.id),
    );
    const flipRow = railRows.find((row) => row.dataset.variant === 'jungle_flip');
    expect(flipRow?.classList.contains('profile-rating-row-empty')).toBe(false);

    // Activity / Games are the primary tabs. Saved is private to the profile
    // owner and lives as a second-level choice inside Games.
    const tabs = [...root.querySelectorAll<HTMLButtonElement>('.profile-tab')];
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Activity', 'Games 2']);
    expect(tabs[1]?.querySelector('.profile-tab-count')?.textContent).toBe('2');
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    expect(root.querySelector('.profile-activity-panel h2')).toBeNull();
    expect(root.querySelector('.profile-games h2')).toBeNull();
    expect(root.querySelector<HTMLElement>('.profile-activity-panel')?.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>('.profile-games-group')?.hidden).toBe(true);
    tabs[1]?.click();
    expect(tabs[1]?.getAttribute('aria-selected')).toBe('true');
    expect(root.querySelector<HTMLElement>('.profile-activity-panel')?.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>('.profile-games-group')?.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>('.profile-games')?.hidden).toBe(false);

    await vi.waitFor(() => {
      expect(root.querySelector('.profile-games-subtab-count')?.textContent).toBe('2');
    });
    const gameSubtabs = [...root.querySelectorAll<HTMLButtonElement>('.profile-games-subtab')];
    expect(
      gameSubtabs.map((tab) => tab.querySelector('.profile-games-subtab-label')?.textContent),
    ).toEqual(['Games', 'Saved']);
    expect(gameSubtabs[0]?.querySelector('.profile-games-subtab-count')?.textContent).toBe('2');
    await vi.waitFor(() => {
      expect(gameSubtabs[1]?.querySelector('.profile-games-subtab-count')?.textContent).toBe('1');
    });
    expect(gameSubtabs[0]?.getAttribute('aria-selected')).toBe('true');

    gameSubtabs[1]?.click();
    expect(gameSubtabs[1]?.getAttribute('aria-selected')).toBe('true');
    expect(
      root.querySelector<HTMLElement>('.profile-games:not(.profile-saved-games)')?.hidden,
    ).toBe(true);
    expect(root.querySelector<HTMLElement>('.profile-saved-games')?.hidden).toBe(false);
    expect(root.querySelector('.profile-saved-games')?.textContent).toContain(
      'Red Player vs Black Player',
    );
    expect(root.querySelector('.profile-saved-games .profile-game-outcome')?.textContent).toBe('★');
    expect(fetchSpy).toHaveBeenCalledWith('/api/games/favorites?offset=0&limit=15');

    // Compact game rows: the date is its own trailing column on the row link.
    const gameRow = root.querySelector('.profile-game-row');
    expect(gameRow?.lastElementChild?.classList.contains('profile-game-date')).toBe(true);
  });

  it('keeps the ratings rail in canonical order with never-played variants dimmed', async () => {
    vi.stubEnv('DEV', false);
    const { buildProfileRatings } = await import('./profile.js');

    const section = buildProfileRatings([
      {
        variant: 'fog',
        timeClass: 'blitz',
        eloRating: null,
        ratedGamesPlayed: 0,
        totalGamesPlayed: 5,
        provisional: false,
      },
      {
        variant: 'crazyhouse_xiangqi',
        timeClass: 'blitz',
        eloRating: 1520,
        ratedGamesPlayed: 2,
        totalGamesPlayed: 2,
        provisional: false,
      },
    ]);

    const rows = [...section.querySelectorAll<HTMLElement>('.profile-rating-row')];
    // Canonical registry order throughout (crazyhouse before fog), with played
    // rows undimmed and every never-played row dimmed.
    const { profileRatingVariants, profileActivityVariants } = await import('./variants.js');
    const { canonicalVariantOrderIndex } = await import('@mistboard/game');
    expect(rows.map((row) => row.dataset.variant)).toEqual(
      [...profileRatingVariants, ...profileActivityVariants]
        .sort(
          (a, b) =>
            canonicalVariantOrderIndex(a.gameSpecId) - canonicalVariantOrderIndex(b.gameSpecId),
        )
        .map((variant) => variant.id),
    );
    const played = new Set(['fog', 'crazyhouse_xiangqi']);
    for (const row of rows) {
      expect(row.classList.contains('profile-rating-row-empty')).toBe(
        !played.has(row.dataset.variant ?? ''),
      );
    }
    // A played-but-unrated row shows its casual games count.
    const fogRow = rows.find((row) => row.dataset.variant === 'fog');
    expect(fogRow?.textContent).not.toContain('Unrated');
    expect(fogRow?.querySelector('.profile-rating-value')).toBeNull();
    expect(fogRow?.querySelector('.profile-rating-games')?.textContent).toBe('5 games');
    expect(fogRow?.textContent).toContain('5 games');
  });

  it('distinguishes unavailable profile data from a missing profile', async () => {
    vi.stubEnv('DEV', false);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'persistence_disabled' }), { status: 503 }),
    );
    const root = document.createElement('div');
    const { mountProfile } = await import('./profile.js');

    await mountProfile(root, 'dev-testing');

    expect(root.textContent).toContain('Profile unavailable');
    expect(root.textContent).toContain('This profile could not be loaded right now.');
    expect(root.textContent).not.toContain('Profile not found');
  });

  it('keeps the not-found state for private or missing profiles', async () => {
    vi.stubEnv('DEV', false);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'not_found' }), { status: 404 }),
    );
    const root = document.createElement('div');
    const { mountProfile } = await import('./profile.js');

    await mountProfile(root, 'missing');

    expect(root.textContent).toContain('Profile not found');
    expect(root.textContent).toContain('This profile is private or does not exist.');
  });

  // Summary + online-players fetch stub for the leaderboard page. Ladders are
  // keyed by rating-pool name (the summary endpoint's vocabulary).
  // `ladders` answers the blitz summary; `byTimeClass` sets any pace. The other
  // paces come back empty.
  function stubLeaderboardFetch(options?: {
    ladders?: { variant: string; leaderboard: unknown[] }[];
    byTimeClass?: Record<string, { variant: string; leaderboard: unknown[] }[]>;
    // Paces whose summary request answers 500.
    failTimeClasses?: string[];
    activePlayers?: unknown[];
    players?: {
      handle: string;
      displayName: string;
      title?: string | null;
      rating?: unknown;
      playing?: boolean;
    }[];
    anonymousOnline?: number;
  }) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      const failedPace = new URL(url, 'https://mistboard.test').searchParams.get('timeClass');
      if (
        url.includes('/api/leaderboard/summary') &&
        options?.failTimeClasses?.includes(failedPace ?? '')
      ) {
        return new Response('{}', { headers: { 'content-type': 'application/json' }, status: 500 });
      }
      const body = url.includes('/api/players/online')
        ? {
            players: (options?.players ?? []).map((p) => ({ rating: null, playing: false, ...p })),
            count: options?.players?.length ?? 0,
            anonymousOnline: options?.anonymousOnline ?? 0,
          }
        : (() => {
            const timeClass = new URL(url, 'https://mistboard.test').searchParams.get('timeClass');
            const byPace = options?.byTimeClass ?? { blitz: options?.ladders ?? [] };
            return {
              timeClass,
              ladders: byPace[timeClass ?? ''] ?? [],
              activePlayers: options?.activePlayers ?? [],
            };
          })();
      return new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    });
  }

  // One ladder with a player.
  const ONE_POPULATED_LADDER = [
    {
      variant: 'fog',
      leaderboard: [
        { rank: 1, handle: 'misty', displayName: 'Misty', eloRating: 1710, provisional: false },
      ],
    },
  ];
  // Every rated ladder in the test registry populated, so the gating and order
  // assertions see a panel per ladder (empty ladders get none).
  const EVERY_LADDER = [
    'fog',
    'jungle',
    'jungle_flip',
    'fortress_xiangqi',
    'duck_xiangqi',
    'atomic_xiangqi',
    'crazyhouse_xiangqi',
    'drop_mini',
  ].map((variant) => ({
    variant,
    leaderboard: [
      {
        rank: 1,
        handle: `p-${variant}`,
        displayName: `P ${variant}`,
        eloRating: 1500,
        provisional: true,
      },
    ],
  }));

  it('keeps Drop Mini off the leaderboard panels', async () => {
    vi.stubEnv('DEV', false);
    const fetchSpy = stubLeaderboardFetch({ ladders: EVERY_LADDER });
    const root = document.createElement('div');
    const { mountLeaderboard } = await import('./profile.js');

    await mountLeaderboard(root);

    // Xiangqi pivot: Drop Mini is off the grids even with a ladder row, and so
    // are the retired Fortress and Atomic Xiangqi pools (2026-10-11).
    expect(root.textContent).not.toContain('Drop Mini Xiangqi');
    expect(root.textContent).not.toContain('Fortress Xiangqi');
    expect(root.textContent).not.toContain('Atomic Xiangqi');
    expect(root.textContent).toContain('Crazyhouse Xiangqi');
    expect(root.textContent).toContain('Rated ladders across Mistboard variants.');
    // One section per launched leaderboard variant; each with a player has a
    // panel per live pace (correspondence is off here), the rest collapse to
    // one line. Drop Mini gets no section.
    const sections = [...root.querySelectorAll<HTMLElement>('.leaderboard-variant-section')];
    expect(sections.map((section) => section.dataset.variant)).not.toContain('drop_mini');
    const populated = sections.filter(
      (section) => !section.classList.contains('leaderboard-variant-section-empty'),
    );
    expect(populated.map((section) => section.dataset.variant)).toEqual(
      expect.arrayContaining(['fog', 'jungle', 'jungle_flip', 'duck_xiangqi']),
    );
    for (const section of populated) {
      expect(
        [...section.querySelectorAll<HTMLElement>('.leaderboard-panel')].map(
          (panel) => panel.dataset.timeClass,
        ),
      ).toEqual(['bullet', 'blitz', 'rapid']);
    }
    expect(root.querySelectorAll('.leaderboard-panel')).toHaveLength(populated.length * 3);
    expect(root.textContent).not.toContain('Active players');
    // One summary per live pace; correspondence stays off while its rated
    // switch is off.
    for (const pace of ['bullet', 'blitz', 'rapid']) {
      expect(fetchSpy).toHaveBeenCalledWith(`/api/leaderboard/summary?limit=10&timeClass=${pace}`);
    }
    expect(fetchSpy).not.toHaveBeenCalledWith(
      '/api/leaderboard/summary?limit=10&timeClass=correspondence',
    );
    expect(fetchSpy).toHaveBeenCalledWith('/api/players/online');
  });

  it('renders the community rail and the online players column', async () => {
    vi.stubEnv('DEV', false);
    stubLeaderboardFetch({
      players: [
        {
          handle: 'misty',
          displayName: 'Misty',
          rating: { variant: 'fog', eloRating: 1710, provisional: true },
          playing: true,
        },
      ],
      anonymousOnline: 3,
    });
    const root = document.createElement('div');
    const { mountLeaderboard } = await import('./profile.js');

    await mountLeaderboard(root);

    const rail = root.querySelector('.community-rail');
    expect(rail).not.toBeNull();
    const links = [...(rail?.querySelectorAll('a') ?? [])];
    // Rating stats is unlisted (2026-11-25): the rail no longer links it.
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/player', '/bots']);
    expect(root.querySelector('a[href*="rating-stats"]')).toBeNull();
    expect(rail?.querySelector('a[aria-current="page"]')?.textContent).toBe('Leaderboard');

    expect(root.querySelector('.leaderboard-online-heading')?.textContent).toBe('Online players');
    const onlineLink = root.querySelector('.leaderboard-online-list a');
    expect(onlineLink?.getAttribute('href')).toBe('/@/misty');
    expect(onlineLink?.textContent).toContain('Misty');
    const rating = onlineLink?.querySelector('.leaderboard-online-rating');
    expect(rating?.textContent).toBe('1710?');
    expect(rating?.getAttribute('title')).toBe('Fog Chess');
    expect(onlineLink?.querySelector('.leaderboard-online-playing')?.getAttribute('title')).toBe(
      'Playing now',
    );
    expect(root.querySelector('.leaderboard-online-anon')?.textContent).toBe('+3 anonymous online');
  });

  it('badges titled players in the ladder rows and the online rail', async () => {
    vi.stubEnv('DEV', false);
    stubLeaderboardFetch({
      ladders: [
        {
          variant: 'fog',
          leaderboard: [
            {
              rank: 1,
              handle: 'misty',
              displayName: 'Misty',
              title: 'xgm',
              eloRating: 1710,
              provisional: false,
            },
            {
              rank: 2,
              handle: 'plain',
              displayName: 'Plain',
              title: null,
              eloRating: 1500,
              provisional: false,
            },
          ],
        },
      ],
      players: [{ handle: 'misty', displayName: 'Misty', title: 'gm' }],
    });
    const root = document.createElement('div');
    const { mountLeaderboard } = await import('./profile.js');

    await mountLeaderboard(root);

    const rows = [...root.querySelectorAll('.leaderboard-table tbody tr')];
    const badge = rows[0]?.querySelector('.title-badge');
    expect(badge?.textContent).toBe('XGM');
    // Presence dot stays leftmost; the badge sits between it and the name.
    expect(badge?.previousElementSibling?.className).toContain('leaderboard-presence');
    expect(badge?.nextElementSibling?.className).toBe('leaderboard-player-name');
    expect(rows[1]?.querySelector('.title-badge')).toBeNull();

    const onlineBadge = root.querySelector('.leaderboard-online-list .title-badge');
    expect(onlineBadge?.textContent).toBe('GM');
    expect(onlineBadge?.getAttribute('title')).toBe('Grandmaster');
  });

  it('shows the empty online state when nobody is online', async () => {
    vi.stubEnv('DEV', false);
    stubLeaderboardFetch();
    const root = document.createElement('div');
    const { mountLeaderboard } = await import('./profile.js');

    await mountLeaderboard(root);

    expect(root.querySelector('.leaderboard-online-empty')?.textContent).toBe('No players online.');
  });

  it('renders one section per variant in canonical order', async () => {
    vi.stubEnv('DEV', false);
    // The leaderboard keys off CANONICAL_VARIANT_ORDER like the picker/profile/
    // rail (#137), not the order the summary happens to list ladders in.
    stubLeaderboardFetch({
      ladders: [
        ...EVERY_LADDER.filter((ladder) => ladder.variant !== 'fog').reverse(),
        {
          variant: 'fog',
          leaderboard: [
            {
              rank: 1,
              handle: 'misty',
              displayName: 'Misty',
              eloRating: 1520,
              gamesPlayed: 3,
              provisional: false,
            },
          ],
        },
      ],
      players: [{ handle: 'misty', displayName: 'Misty' }],
    });
    const root = document.createElement('div');
    const { mountLeaderboard } = await import('./profile.js');

    await mountLeaderboard(root);

    const headings = [...root.querySelectorAll('.leaderboard-variant-heading')].map(
      (el) => el.textContent,
    );
    // The populated variants keep their canonical relative order.
    expect(
      headings.filter((name) =>
        ['Duck Xiangqi', 'Crazyhouse Xiangqi', 'Fog Chess', 'Jungle Chess', 'Flip Jungle'].includes(
          name ?? '',
        ),
      ),
    ).toEqual(['Duck Xiangqi', 'Crazyhouse Xiangqi', 'Fog Chess', 'Jungle Chess', 'Flip Jungle']);
    const fogPanel = root.querySelector(
      '.leaderboard-variant-section[data-variant="fog"] .leaderboard-panel[data-time-class="blitz"]',
    );
    expect(fogPanel?.querySelector('.leaderboard-panel-title')?.textContent).toBe('Blitz');
    const row = fogPanel?.querySelector('.leaderboard-table tbody tr');
    expect(row?.textContent).toContain('1520');
    expect(row?.querySelector('a')?.getAttribute('href')).toBe('/@/misty');
    // Presence circle fills for players in the online set.
    expect(row?.querySelector('.leaderboard-presence-online')).not.toBeNull();
  });

  it('shows every rated pool under its variant, with a placeholder when empty', async () => {
    vi.stubEnv('DEV', false);
    // Prod, 2026-10-04: the only rated games were jieqi bullet, and the page
    // opened on an empty Blitz tab.
    stubLeaderboardFetch({
      byTimeClass: {
        bullet: ONE_POPULATED_LADDER,
        rapid: [EVERY_LADDER.find((ladder) => ladder.variant === 'jungle')!],
      },
    });
    const root = document.createElement('div');
    const { mountLeaderboard } = await import('./profile.js');

    await mountLeaderboard(root);

    const panelText = (variant: string, pace: string) =>
      root.querySelector(
        `.leaderboard-variant-section[data-variant="${variant}"] .leaderboard-panel[data-time-class="${pace}"]`,
      )?.textContent ?? '';
    expect(panelText('fog', 'bullet')).toContain('Misty');
    expect(panelText('fog', 'blitz')).toContain('No rated players yet.');
    expect(panelText('fog', 'rapid')).toContain('No rated players yet.');
    expect(panelText('jungle', 'rapid')).toContain('P jungle');
    expect(panelText('jungle', 'bullet')).toContain('No rated players yet.');
    const fogSection = root.querySelector('.leaderboard-variant-section[data-variant="fog"]');
    expect(fogSection?.querySelector('.leaderboard-variant-heading')?.textContent).toBe(
      'Fog Chess',
    );
    expect(
      [...(fogSection?.querySelectorAll('.leaderboard-panel-title') ?? [])].map(
        (el) => el.textContent,
      ),
    ).toEqual(['Bullet', 'Blitz', 'Rapid']);
    // No pace pills.
    expect(root.querySelector('.leaderboard-paces')).toBeNull();
  });

  const sectionFor = (root: HTMLElement, variant: string) =>
    root.querySelector<HTMLElement>(`.leaderboard-variant-section[data-variant="${variant}"]`);

  it('collapses a variant with no player in any pool to one line', async () => {
    vi.stubEnv('DEV', false);
    stubLeaderboardFetch({ byTimeClass: { bullet: ONE_POPULATED_LADDER } });
    const root = document.createElement('div');
    const { mountLeaderboard } = await import('./profile.js');

    await mountLeaderboard(root);

    const jungle = sectionFor(root, 'jungle');
    expect(jungle?.classList.contains('leaderboard-variant-section-empty')).toBe(true);
    expect(jungle?.querySelectorAll('.leaderboard-panel')).toHaveLength(0);
    expect(jungle?.querySelector('.leaderboard-grid')).toBeNull();
    expect(jungle?.querySelector('.leaderboard-variant-heading')?.textContent).toBe('Jungle Chess');
    expect(jungle?.querySelector('.leaderboard-variant-thumb')).not.toBeNull();
    expect(jungle?.querySelector('.leaderboard-variant-empty')?.textContent).toBe(
      'No rated players yet.',
    );
    // Collapsed variants keep their canonical place among the full sections.
    const order = [...root.querySelectorAll<HTMLElement>('.leaderboard-variant-section')].map(
      (section) => section.dataset.variant,
    );
    const { groupLeaderboardByVariant } = await import('./profile.js');
    expect(order).toEqual(
      groupLeaderboardByVariant([], false)
        .map((group) => group.variant)
        .filter((variant) => order.includes(variant)),
    );
    expect(order.length).toBeGreaterThan(1);
  });

  it('keeps every panel for a variant with one populated pool', async () => {
    vi.stubEnv('DEV', false);
    stubLeaderboardFetch({ byTimeClass: { bullet: ONE_POPULATED_LADDER } });
    const root = document.createElement('div');
    const { mountLeaderboard } = await import('./profile.js');

    await mountLeaderboard(root);

    const fog = sectionFor(root, 'fog');
    expect(fog?.classList.contains('leaderboard-variant-section-empty')).toBe(false);
    expect(
      [...(fog?.querySelectorAll<HTMLElement>('.leaderboard-panel') ?? [])].map(
        (panel) => panel.dataset.timeClass,
      ),
    ).toEqual(['bullet', 'blitz', 'rapid']);
    expect(fog?.querySelector('.leaderboard-variant-empty')).toBeNull();
    expect(
      fog?.querySelector('.leaderboard-panel[data-time-class="blitz"]')?.textContent,
    ).toContain('No rated players yet.');
  });

  it('keeps the panels of a variant whose pool failed to load', async () => {
    vi.stubEnv('DEV', false);
    stubLeaderboardFetch({
      byTimeClass: { bullet: ONE_POPULATED_LADDER },
      failTimeClasses: ['rapid'],
    });
    const root = document.createElement('div');
    const { mountLeaderboard } = await import('./profile.js');

    await mountLeaderboard(root);

    // Jungle has no player in the pools that loaded, but rapid is unknown.
    const jungle = sectionFor(root, 'jungle');
    expect(jungle?.classList.contains('leaderboard-variant-section-empty')).toBe(false);
    expect(jungle?.querySelectorAll('.leaderboard-panel')).toHaveLength(3);
    expect(
      jungle?.querySelector('.leaderboard-panel[data-time-class="rapid"]')?.textContent,
    ).toContain('Could not load ratings.');
    expect(
      jungle?.querySelector('.leaderboard-panel[data-time-class="bullet"]')?.textContent,
    ).toContain('No rated players yet.');
  });

  it('localizes Traditional Chinese leaderboard chrome', async () => {
    window.history.replaceState(null, '', '/zh-hant/player');
    vi.stubEnv('DEV', false);
    // (Crazyhouse Xiangqi) instead.
    stubLeaderboardFetch({
      ladders: [
        {
          variant: 'crazyhouse_xiangqi',
          leaderboard: [
            {
              rank: 1,
              handle: 'misty',
              displayName: 'Misty',
              eloRating: 1520,
              gamesPlayed: 3,
              provisional: false,
            },
          ],
        },
      ],
    });
    const root = document.createElement('div');
    const { mountLeaderboard } = await import('./profile.js');

    await mountLeaderboard(root);

    expect(root.querySelector('h1')?.textContent).toBe('排行榜');
    expect(root.textContent).toContain('Mistboard 各變體的等級分排行榜。');
    expect(root.textContent).toContain('瘋狂屋象棋');
    expect(root.querySelector('.leaderboard-variant-heading')?.textContent).toBeTruthy();
    expect(root.textContent).toContain('還沒有計分玩家。');
    expect(root.textContent).not.toContain('活躍玩家');
    expect(root.querySelector('.leaderboard-online-heading')?.textContent).toBe('線上玩家');
    expect(root.textContent).toContain('目前沒有玩家在線上。');
  });

  it('collapses the ladder grid to one line when no ladder has a rated game', async () => {
    vi.stubEnv('DEV', false);
    stubLeaderboardFetch({ ladders: [] });
    const root = document.createElement('div');
    const { mountLeaderboard } = await import('./profile.js');

    await mountLeaderboard(root);

    // The repeated per-variant "No rated games yet." panels are gone, replaced
    // by a single line pointing at the thing a visitor can do about it.
    expect(root.querySelectorAll('.leaderboard-panel')).toHaveLength(0);
    expect(root.textContent).not.toContain('No rated games yet.');
    expect(root.textContent).toContain('The ladders open with the first rated game.');
    expect(root.querySelector('.leaderboard-awaiting a')?.getAttribute('href')).toBe('/');
    // The online-players column still renders beside it.
    expect(root.textContent).toContain('Online players');
  });

  it('renders rating stats from leaderboard data', async () => {
    vi.stubEnv('DEV', false);
    const entries = [
      {
        rank: 1,
        handle: 'misty',
        displayName: 'Misty',
        eloRating: 1540,
        gamesPlayed: 12,
        provisional: false,
      },
      {
        rank: 2,
        handle: 'foggy',
        displayName: 'Foggy',
        eloRating: 1460,
        gamesPlayed: 9,
        provisional: false,
      },
    ];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input), 'https://mistboard.test');
      const timeClass = url.searchParams.get('timeClass');
      return new Response(
        JSON.stringify({
          bucket: { variant: url.searchParams.get('variant'), timeClass },
          leaderboard: timeClass === 'blitz' ? entries : [],
        }),
        { headers: { 'content-type': 'application/json' }, status: 200 },
      );
    });
    const root = document.createElement('div');
    const { mountRatingStats } = await import('./profile.js');

    await mountRatingStats(root);

    // Unlisted (2026-11-25): reachable by URL, but the rail has no link to it.
    const rail = root.querySelector('.community-rail');
    expect(rail).not.toBeNull();
    expect(rail?.querySelector('a[href*="rating-stats"]')).toBeNull();
    expect(root.querySelector('.rating-stats-heading')?.textContent).toContain('Weekly');
    expect(root.querySelector('.rating-stats-heading')?.textContent).toContain(
      'rating distribution',
    );
    expect(root.querySelector<HTMLSelectElement>('.rating-stats-select')?.value).toBe('fog');
    expect(root.querySelector('.rating-stats-summary')?.textContent).toBe(
      '2 rated Fog Chess players. Average rating is 1500.',
    );
    expect(root.querySelectorAll('.rating-stats-bar').length).toBeGreaterThan(0);
    expect(fetchSpy).toHaveBeenCalledWith('/api/leaderboard?variant=fog&timeClass=blitz&limit=500');
  });

  it('offers one chip per rated pace and opens on the pool with the most players', async () => {
    vi.stubEnv('DEV', false);
    const player = (handle: string, eloRating: number) => ({
      rank: 1,
      handle,
      displayName: handle,
      eloRating,
      gamesPlayed: 5,
      provisional: true,
    });
    const pools: Record<string, ReturnType<typeof player>[]> = {
      bullet: [player('a', 1500), player('b', 1600), player('c', 1700)],
      blitz: [player('d', 1500)],
      rapid: [],
    };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input), 'https://mistboard.test');
      const timeClass = url.searchParams.get('timeClass') ?? 'blitz';
      return new Response(
        JSON.stringify({ bucket: { variant: 'fog', timeClass }, leaderboard: pools[timeClass] }),
        { headers: { 'content-type': 'application/json' }, status: 200 },
      );
    });
    const root = document.createElement('div');
    const { mountRatingStats } = await import('./profile.js');

    await mountRatingStats(root);

    const chips = [...root.querySelectorAll<HTMLButtonElement>('.rating-stats-pace')];
    expect(chips.map((chip) => chip.textContent)).toEqual(['Bullet', 'Blitz', 'Rapid']);
    const pressed = () =>
      root.querySelector<HTMLButtonElement>('.rating-stats-pace[aria-pressed="true"]')?.dataset
        .timeClass;
    expect(pressed()).toBe('bullet');
    expect(root.querySelector('.rating-stats-summary')?.textContent).toBe(
      '3 rated Fog Chess players. Average rating is 1600.',
    );

    // An empty pool says so and links to Find opponent for this variant.
    chips[2]!.click();
    await vi.waitFor(() =>
      expect(root.querySelector('.rating-stats-empty')?.textContent).toContain(
        'No rated games at this time control yet.',
      ),
    );
    expect(pressed()).toBe('rapid');
    expect(root.querySelector('.rating-stats-bar')).toBeNull();
    const cta = root.querySelector<HTMLAnchorElement>('.rating-stats-empty-cta');
    expect(cta?.textContent).toBe('Find opponent');
    expect(cta?.getAttribute('href')).toBe('/?play=lobby&gameSpecId=dark-chess');
  });

  it('picks blitz when every pool ties', async () => {
    const { ratingStatsDefaultPace } = await import('./profile.js');
    expect(
      ratingStatsDefaultPace([
        { timeClass: 'bullet', players: 0 },
        { timeClass: 'blitz', players: 0 },
        { timeClass: 'rapid', players: 0 },
      ]),
    ).toBe('blitz');
    expect(
      ratingStatsDefaultPace([
        { timeClass: 'bullet', players: 2 },
        { timeClass: 'blitz', players: 1 },
        { timeClass: 'rapid', players: 2 },
      ]),
    ).toBe('bullet');
  });

  it('localizes the empty pool state', async () => {
    vi.stubEnv('DEV', false);
    window.history.replaceState(null, '', '/zh-hant/player/rating-stats');
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify({ bucket: {}, leaderboard: [] }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
    );
    const root = document.createElement('div');
    const { mountRatingStats } = await import('./profile.js');
    await mountRatingStats(root);
    expect(root.querySelector('.rating-stats-empty')?.textContent).toContain(
      '這個用時還沒有計分對局。',
    );
    expect(root.querySelector('.rating-stats-empty-cta')?.textContent).toBe('尋找對手');
  });

  it('scopes the games list to the variant picked in the rating rail, and can clear it', async () => {
    // Before this, picking a variant moved the rating spotlight while the games
    // list kept showing every variant -- the list is paginated, so the filter
    // has to be a server query, not a narrowing of the page already in hand.
    const game = (roomId: string, variant: string) => ({
      roomId,
      variant,
      mode: 'pvp' as const,
      rated: false,
      result: 'red-wins',
      termination: 'resignation',
      plyCount: 20,
      whiteName: null,
      blackName: null,
      corpusId: null,
      endedAt: '2026-07-01T12:00:00.000Z',
      participants: [],
      playerColor: 'red',
    });
    const gamesRequests: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        });
      if (url.includes('/rating-history')) return json({ points: [] });
      if (url.includes('/games?')) {
        gamesRequests.push(url);
        return json(
          url.includes('variant=jieqi')
            ? { games: [game('jq-1', 'jieqi')], total: 1 }
            : { games: [game('xq-1', 'xiangqi'), game('jq-1', 'jieqi')], total: 2 },
        );
      }
      return json({
        profile: {
          isViewer: false,
          relation: null,
          user: {
            handle: 'railfilter',
            displayName: 'railfilter',
            bio: '',
            profileVisibility: 'public',
            accountRole: 'player',
            createdAt: '2026-05-01T00:00:00.000Z',
          },
          ratings: [
            {
              variant: 'xiangqi',
              timeClass: 'blitz',
              eloRating: null,
              ratedGamesPlayed: 0,
              totalGamesPlayed: 1,
              provisional: false,
            },
            {
              variant: 'jieqi',
              timeClass: 'blitz',
              eloRating: null,
              ratedGamesPlayed: 0,
              totalGamesPlayed: 1,
              provisional: false,
            },
          ],
          puzzleRatings: [],
          games: [game('xq-1', 'xiangqi'), game('jq-1', 'jieqi')],
          gamesTotal: 2,
        },
      });
    });

    const root = document.createElement('div');
    const { mountProfile } = await import('./profile.js');
    await mountProfile(root, 'railfilter');

    const rowIds = () =>
      Array.from(root.querySelectorAll('.profile-games .profile-game-row-open'), (a) =>
        a.getAttribute('href'),
      );
    const filterBar = () => root.querySelector<HTMLElement>('.profile-games-filter');

    // Unfiltered: both variants, no chip, and no games fetch (the profile
    // payload already carried the first page).
    expect(rowIds()).toHaveLength(2);
    expect(filterBar()?.hidden).toBe(true);
    expect(gamesRequests).toHaveLength(0);

    root.querySelector<HTMLElement>('.profile-rating-row[data-variant="jieqi"]')?.click();
    await vi.waitFor(() => {
      expect(rowIds()).toHaveLength(1);
    });
    expect(gamesRequests.some((url) => url.includes('variant=jieqi'))).toBe(true);
    expect(filterBar()?.hidden).toBe(false);
    expect(filterBar()?.textContent).toContain('Jieqi');
    // The tab badge stays the LIFETIME total; the chip states what is shown.
    expect(root.querySelector('.profile-tab-count')?.textContent).toBe('2');

    filterBar()?.querySelector<HTMLElement>('.profile-games-filter-clear')?.click();
    await vi.waitFor(() => {
      expect(rowIds()).toHaveLength(2);
    });
    expect(filterBar()?.hidden).toBe(true);
  });

  it('holds result and opponent filters in the URL and sends them to the games query', async () => {
    window.history.replaceState(null, '', '/@/urlfilter?result=win&vs=bob');
    const game = (roomId: string) => ({
      roomId,
      variant: 'xiangqi',
      mode: 'pvp' as const,
      rated: false,
      result: 'red-wins',
      termination: 'resignation',
      plyCount: 20,
      whiteName: null,
      blackName: null,
      corpusId: null,
      endedAt: '2026-07-01T12:00:00.000Z',
      participants: [
        {
          color: 'red',
          displayName: 'me',
          subjectType: 'user',
          subjectId: 'u1',
          visibility: 'public',
          handle: 'urlfilter',
        },
        {
          color: 'black',
          displayName: 'Bob',
          subjectType: 'user',
          subjectId: 'u2',
          visibility: 'public',
          handle: 'bob',
        },
      ],
      playerColor: 'red',
    });
    const gamesRequests: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        });
      if (url.includes('/rating-history')) return json({ points: [] });
      if (url.includes('/games?')) {
        gamesRequests.push(url);
        return json({ games: [game('xq-win')], total: 1 });
      }
      return json({
        profile: {
          isViewer: false,
          relation: null,
          user: {
            handle: 'urlfilter',
            displayName: 'urlfilter',
            bio: '',
            profileVisibility: 'public',
            accountRole: 'player',
            createdAt: '2026-05-01T00:00:00.000Z',
          },
          ratings: [],
          puzzleRatings: [],
          games: [game('xq-win'), game('xq-2')],
          gamesTotal: 2,
        },
      });
    });

    const root = document.createElement('div');
    const { mountProfile } = await import('./profile.js');
    await mountProfile(root, 'urlfilter');

    // The link opens on the filtered Games tab, already queried.
    await vi.waitFor(() => expect(gamesRequests).toHaveLength(1));
    expect(gamesRequests[0]).toContain('result=win');
    expect(gamesRequests[0]).toContain('vs=bob');
    const chip = root.querySelector<HTMLElement>('.profile-games-filter');
    expect(chip?.hidden).toBe(false);
    expect(chip?.textContent).toContain('Wins · vs @bob');
    expect(
      root
        .querySelector<HTMLButtonElement>('.profile-games-result[data-result="win"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('true');
    expect(root.querySelector<HTMLInputElement>('.profile-games-opponent-input')?.value).toBe(
      'bob',
    );

    root.querySelector<HTMLButtonElement>('.profile-games-result[data-result="loss"]')?.click();
    await vi.waitFor(() => expect(gamesRequests).toHaveLength(2));
    expect(gamesRequests[1]).toContain('result=loss');
    expect(window.location.search).toBe('?result=loss&vs=bob');

    chip?.querySelector<HTMLButtonElement>('.profile-games-filter-clear')?.click();
    expect(window.location.search).toBe('');
    expect(chip?.hidden).toBe(true);
    window.history.replaceState(null, '', '/');
  });
});

describe('leaderboard grouping by variant', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('lists bullet, blitz and rapid for every variant, and correspondence only where it rates', async () => {
    const { leaderboardPoolsForVariant } = await import('./profile.js');
    expect(leaderboardPoolsForVariant('xiangqi', true)).toEqual([
      'bullet',
      'blitz',
      'rapid',
      'correspondence',
    ]);
    expect(leaderboardPoolsForVariant('xiangqi', false)).toEqual(['bullet', 'blitz', 'rapid']);
    // Gomoku and Three Kingdoms Banqi correspondence stays casual.
    expect(leaderboardPoolsForVariant('gomoku', true)).toEqual(['bullet', 'blitz', 'rapid']);
    expect(leaderboardPoolsForVariant('three-kingdoms-banqi', true)).toEqual([
      'bullet',
      'blitz',
      'rapid',
    ]);
  });

  it('groups pools under each variant in canonical order, empty as [] and failed as null', async () => {
    vi.stubEnv('VITE_XIANGQI_ENABLED', 'true');
    const { groupLeaderboardByVariant } = await import('./profile.js');
    const { leaderboardVariants } = await import('./variants.js');
    const entry = {
      rank: 1,
      handle: 'a',
      displayName: 'A',
      eloRating: 1600,
      gamesPlayed: 4,
      provisional: false,
    };
    const groups = groupLeaderboardByVariant(
      [
        {
          timeClass: 'bullet',
          summary: { ladders: [{ variant: 'xiangqi', leaderboard: [entry] }] },
        },
        { timeClass: 'blitz', summary: { ladders: [] } },
        // A pace whose summary failed to load.
        { timeClass: 'rapid', summary: null },
      ],
      false,
    );
    expect(groups.map((group) => group.variant)).toEqual(
      leaderboardVariants.map((variant) => variant.id),
    );
    // Go (admin-only) and retired variants never get a section.
    expect(groups.map((group) => group.variant)).not.toContain('go');
    expect(groups.map((group) => group.variant)).not.toContain('fortress_xiangqi');
    const xiangqi = groups.find((group) => group.variant === 'xiangqi');
    expect(xiangqi?.pools).toEqual([
      { timeClass: 'bullet', entries: [entry] },
      { timeClass: 'blitz', entries: [] },
      { timeClass: 'rapid', entries: null },
    ]);
  });
});

describe('profile puzzle mode rows', () => {
  afterEach(() => {
    vi.resetModules();
    document.body.innerHTML = '';
  });

  it('adds a row only for a mode with stored numbers', async () => {
    const { profilePuzzleModeRows } = await import('./profile.js');
    expect(profilePuzzleModeRows(null, null, 'en')).toEqual([]);
    expect(
      profilePuzzleModeRows(
        { storm: { best: 0, runs: 0 }, streak: { best: 0, runs: 0 } },
        { current: 0, best: 0 },
        'en',
      ),
    ).toEqual([]);
    const rows = profilePuzzleModeRows(
      { storm: { best: 14, runs: 3 }, streak: { best: 5, runs: 1 } },
      { current: 2, best: 7 },
      'en',
    );
    expect(rows.map((row) => [row.id, row.name, row.score, row.count, row.href])).toEqual([
      ['storm', 'Puzzle Storm', 14, '3 runs', '/puzzles?mode=storm'],
      ['streak', 'Puzzle Streak', 5, '1 run', '/puzzles?mode=streak'],
      ['days', 'Days in a row', 2, 'best 7 days', null],
    ]);
    // Storm played, Streak never: only the Storm row.
    expect(
      profilePuzzleModeRows(
        { storm: { best: 4, runs: 1 }, streak: { best: 0, runs: 0 } },
        null,
        'en',
      ).map((row) => row.id),
    ).toEqual(['storm']);
  });

  it('shows the day streak as a row, not on the Puzzles heading line', async () => {
    const { appendProfilePuzzleRatings } = await import('./profile.js');
    const section = document.createElement('section');
    appendProfilePuzzleRatings(section, [], { current: 3, best: 9 }, 'en', undefined, {
      storm: { best: 21, runs: 2 },
      streak: { best: 0, runs: 0 },
    });
    expect(section.querySelector('.profile-puzzle-ratings h2')?.textContent).toBe('Puzzles');
    expect(section.querySelector('.profile-puzzle-streak')).toBeNull();
    const rows = [...section.querySelectorAll<HTMLElement>('.profile-puzzle-mode-row')];
    expect(rows.map((row) => row.dataset.puzzleMode)).toEqual(['storm', 'days']);
    expect(rows[0]?.getAttribute('href')).toBe('/puzzles?mode=storm');
    expect(rows[0]?.querySelector('.ui-icon-puzzle-storm')).not.toBeNull();
    expect(rows[0]?.querySelector('.profile-puzzle-value')?.textContent).toBe('21');
    expect(rows[1]?.querySelector('.profile-puzzle-value')?.textContent).toBe('3');
    expect(rows[1]?.querySelector('.profile-puzzle-games')?.textContent).toBe('best 9 days');
    // Exactly one streak figure on the block: no duplicate on the heading.
    expect(section.textContent?.match(/9 days/g)).toHaveLength(1);
  });

  it('renders nothing for a player with no puzzle history', async () => {
    const { appendProfilePuzzleRatings } = await import('./profile.js');
    const section = document.createElement('section');
    appendProfilePuzzleRatings(section, [], { current: 0, best: 0 }, 'en', undefined, {
      storm: { best: 0, runs: 0 },
      streak: { best: 0, runs: 0 },
    });
    expect(section.children).toHaveLength(0);
  });

  it('localizes the mode rows in Simplified and Traditional Chinese', async () => {
    const { profilePuzzleModeRows } = await import('./profile.js');
    const modes = { storm: { best: 3, runs: 2 }, streak: { best: 4, runs: 1 } };
    expect(profilePuzzleModeRows(modes, null, 'zh-Hans').map((row) => row.name)).toEqual([
      '限时解题',
      '连续解题',
    ]);
    expect(profilePuzzleModeRows(modes, null, 'zh-Hant').map((row) => row.name)).toEqual([
      '限時解題',
      '連續解題',
    ]);
  });
});
