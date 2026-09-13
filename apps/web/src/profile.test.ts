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

  it('shows soft-launch profile rows before rated games', async () => {
    // Pin prod semantics so dev-on variants (jieqi/banqi) don't add extra rows.
    vi.stubEnv('DEV', false);
    const { buildProfileRatings } = await import('./profile.js');

    const section = buildProfileRatings([]);

    expect(section.textContent).toContain('Fog Chess');
    // Fortress + Duck + Flip Jungle + Jungle + Dark Chess (always-on) = 5 rows.
    expect(section.querySelectorAll('.profile-rating-row-empty')).toHaveLength(5);
  });

  it('localizes Traditional Chinese profile ratings rows', async () => {
    vi.stubEnv('DEV', false);
    const { buildProfileRatings } = await import('./profile.js');

    // Xiangqi pivot: Drop Mini is off the rating grids; localize an on-grid row
    // (Fortress Xiangqi) instead.
    const section = buildProfileRatings(
      [
        {
          variant: 'fortress_xiangqi',
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
    expect(section.textContent).toContain('堡壘象棋');
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

    expect(fetchSpy).toHaveBeenCalledWith('/api/users/dev-testing/profile');
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
    const { profileRatingVariants } = await import('./variants.js');
    expect(railRows.map((row) => row.dataset.variant)).toEqual(
      profileRatingVariants.map((variant) => variant.id),
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
        variant: 'fortress_xiangqi',
        timeClass: 'blitz',
        eloRating: 1520,
        ratedGamesPlayed: 2,
        totalGamesPlayed: 2,
        provisional: false,
      },
    ]);

    const rows = [...section.querySelectorAll<HTMLElement>('.profile-rating-row')];
    // Canonical registry order throughout (fortress before fog), with played
    // rows undimmed and every never-played row dimmed.
    const { profileRatingVariants } = await import('./variants.js');
    expect(rows.map((row) => row.dataset.variant)).toEqual(
      profileRatingVariants.map((variant) => variant.id),
    );
    const played = new Set(['fog', 'fortress_xiangqi']);
    for (const row of rows) {
      expect(row.classList.contains('profile-rating-row-empty')).toBe(
        !played.has(row.dataset.variant ?? ''),
      );
    }
    // A played-but-unrated row shows its casual games count.
    const fogRow = rows.find((row) => row.dataset.variant === 'fog');
    expect(fogRow?.textContent).toContain('Unrated');
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
  function stubLeaderboardFetch(options?: {
    ladders?: { variant: string; leaderboard: unknown[] }[];
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
      const body = url.includes('/api/players/online')
        ? {
            players: (options?.players ?? []).map((p) => ({ rating: null, playing: false, ...p })),
            count: options?.players?.length ?? 0,
            anonymousOnline: options?.anonymousOnline ?? 0,
          }
        : {
            timeClass: 'blitz',
            ladders: options?.ladders ?? [],
            activePlayers: options?.activePlayers ?? [],
          };
      return new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    });
  }

  // One populated ladder, so the all-empty collapse doesn't swallow the grid
  // that these gating assertions count panels in.
  const ONE_POPULATED_LADDER = [
    {
      variant: 'fog',
      leaderboard: [
        { rank: 1, handle: 'misty', displayName: 'Misty', eloRating: 1710, provisional: false },
      ],
    },
  ];

  it('keeps Drop Mini off the leaderboard panels', async () => {
    vi.stubEnv('DEV', false);
    const fetchSpy = stubLeaderboardFetch({ ladders: ONE_POPULATED_LADDER });
    const root = document.createElement('div');
    const { mountLeaderboard } = await import('./profile.js');

    await mountLeaderboard(root);

    // Xiangqi pivot: Drop Mini is off the grids; Fortress is an always-on ladder.
    expect(root.textContent).not.toContain('Drop Mini Xiangqi');
    expect(root.textContent).toContain('Fortress Xiangqi');
    expect(root.textContent).toContain('Human blitz ladders');
    // 5 rated ladders (Dark Chess + always-on Jungle, Flip Jungle, Fortress,
    // Duck).
    expect(root.querySelectorAll('.leaderboard-panel')).toHaveLength(5);
    expect(root.textContent).not.toContain('Active players');
    expect(fetchSpy).toHaveBeenCalledWith('/api/leaderboard/summary?limit=10&timeClass=blitz');
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
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/player',
      '/player/rating-stats',
      '/bots',
    ]);
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

  it('renders ladders in canonical variant order regardless of which are populated', async () => {
    vi.stubEnv('DEV', false);
    // Populate Dark Chess ('fog') to prove a populated ladder no longer floats
    // to the front (#137):
    // the leaderboard keys off CANONICAL_VARIANT_ORDER like the picker/profile/
    // rail, so Fortress still leads with no data and Dark Chess keeps its slot
    // between Fortress and the Jungle pair.
    stubLeaderboardFetch({
      ladders: [
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

    const row = root.querySelector('.leaderboard-table tbody tr');
    expect(row?.textContent).toContain('Misty');
    expect(row?.querySelector('a')?.getAttribute('href')).toBe('/@/misty');
    // Presence circle fills for players in the online set.
    expect(row?.querySelector('.leaderboard-presence-online')).not.toBeNull();
    // Ladders absent from the summary render the no-rated-games state.
    expect(root.textContent).toContain('No rated games yet.');

    // Canonical filtered order: Fortress, Duck, Fog Chess, Jungle, Flip Jungle.
    const titles = [...root.querySelectorAll('.leaderboard-panel-title')].map(
      (el) => el.textContent,
    );
    expect(titles).toEqual([
      'Fortress Xiangqi',
      'Duck Xiangqi',
      'Fog Chess',
      'Jungle Chess',
      'Flip Jungle',
    ]);
    const panels = [...root.querySelectorAll('.leaderboard-panel')];
    // Fog Chess is the one ladder the summary populates. Found BY NAME, not by
    // index: this used to be panels[1], which silently became a different
    // ladder the moment a variant was inserted ahead of it.
    const fogPanel = panels.find((panel) =>
      panel.querySelector('.leaderboard-panel-title')?.textContent?.includes('Fog Chess'),
    );
    expect(fogPanel?.textContent).toContain('1520');
    for (const panel of panels.filter((panel) => panel !== fogPanel)) {
      expect(panel.textContent).toContain('No rated games yet.');
    }
  });

  it('localizes Traditional Chinese leaderboard chrome', async () => {
    window.history.replaceState(null, '', '/zh-hant/player');
    vi.stubEnv('DEV', false);
    // (Fortress Xiangqi) instead.
    stubLeaderboardFetch({
      ladders: [
        {
          variant: 'fortress_xiangqi',
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
    expect(root.textContent).toContain('Mistboard 公開變體的人類快棋排行榜。');
    expect(root.textContent).toContain('堡壘象棋');
    expect(root.textContent).toContain('還沒有計分對局。');
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
    expect(root.querySelector('.leaderboard-awaiting a')?.getAttribute('href')).toBe('/play');
    // The online-players column still renders beside it.
    expect(root.textContent).toContain('Online players');
  });

  it('keeps every ladder panel when at least one ladder has a rated game', async () => {
    vi.stubEnv('DEV', false);
    stubLeaderboardFetch({ ladders: ONE_POPULATED_LADDER });
    const root = document.createElement('div');
    const { mountLeaderboard } = await import('./profile.js');

    await mountLeaderboard(root);

    expect(root.querySelectorAll('.leaderboard-panel').length).toBeGreaterThan(1);
    // Partial emptiness keeps the per-variant line: it is legible next to a
    // ladder that has rows.
    expect(root.textContent).toContain('No rated games yet.');
    expect(root.textContent).toContain('Misty');
  });

  it('renders rating stats from leaderboard data', async () => {
    vi.stubEnv('DEV', false);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          bucket: { variant: 'fog', timeClass: 'blitz' },
          leaderboard: [
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
          ],
        }),
        { headers: { 'content-type': 'application/json' }, status: 200 },
      ),
    );
    const root = document.createElement('div');
    const { mountRatingStats } = await import('./profile.js');

    await mountRatingStats(root);

    const rail = root.querySelector('.community-rail');
    expect(rail?.querySelector('a[aria-current="page"]')?.textContent).toBe('Rating stats');
    expect(root.querySelector('.rating-stats-heading')?.textContent).toContain('Weekly');
    expect(root.querySelector('.rating-stats-heading')?.textContent).toContain(
      'rating distribution',
    );
    expect(root.querySelector<HTMLSelectElement>('.rating-stats-select')?.value).toBe('fog');
    expect(root.querySelector('.rating-stats-summary')?.textContent).toBe(
      '2 rated Fog Chess players. Average rating is 1500.',
    );
    expect(root.querySelectorAll('.rating-stats-bar').length).toBeGreaterThan(0);
    expect(fetchSpy).toHaveBeenCalledWith('/api/leaderboard?variant=fog&limit=500');
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
});
