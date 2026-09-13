import { afterEach, describe, expect, it, vi } from 'vitest';

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
      misty(),
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

  it('renders featured and Fairy-Stockfish opponents with one uniform card UI', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(rosterPayload()));
    const root = document.createElement('div');
    const { mountBots } = await import('./bots.js');

    await mountBots(root);

    expect(
      [...root.querySelectorAll('.bot-roster-section h2')].map((el) => el.textContent),
    ).toEqual(['Featured opponents', 'Fairy-Stockfish ladder']);
    // Community rail is shared with /player; Online bots is the active entry.
    expect(root.querySelector('.community-rail a[aria-current="page"]')?.textContent).toBe(
      'Online bots',
    );

    const featuredNames = [
      ...root.querySelectorAll(
        '.bot-roster-section:first-of-type .profile-summary-card .profile-summary-card-name',
      ),
    ].map((el) => el.textContent);
    expect(featuredNames).toEqual(['Misty', 'Pikafish']);
    expect(
      root.querySelector<HTMLAnchorElement>('.profile-summary-card .profile-summary-card-name')
        ?.href,
    ).toContain('/bot/misty');
    expect(root.textContent).toContain('Searches hidden positions');
    expect(root.querySelector('.profile-summary-card-rating-value')?.textContent).toBe('1,812');
    expect(root.querySelector('.profile-summary-card-footer')?.textContent).toContain('12 games');

    const ladderCards = [
      ...root.querySelectorAll('.profile-summary-card[data-bot-id^="fairy-stockfish-level-"]'),
    ];
    expect(ladderCards).toHaveLength(8);
    expect(
      ladderCards.map((card) => card.querySelector('.profile-summary-card-name')?.textContent),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((level) => `Fairy-Stockfish Level ${level}`));
    expect(
      ladderCards.map((card) =>
        card.querySelector<HTMLAnchorElement>('.profile-summary-card-name')?.getAttribute('href'),
      ),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((level) => `/bot/fairy-stockfish-level-${level}`));
    for (const card of ladderCards) {
      expect(card.getAttribute('data-subject-kind')).toBe('bot');
      expect(card.querySelector('.profile-summary-card-avatar')).not.toBeNull();
      expect(card.querySelector('.profile-summary-card-bio')).not.toBeNull();
      expect(card.querySelector('.profile-summary-card-actions')).not.toBeNull();
      expect(card.querySelector('.profile-summary-card-footer')).not.toBeNull();
    }
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
    ].map((card) => card.querySelector('.profile-summary-card-rating-value')?.textContent ?? '—');
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
    const fogChip = [
      ...root.querySelectorAll<HTMLButtonElement>('button.profile-summary-card-action'),
    ].find((chip) => chip.textContent?.includes('Fog Chess'));
    expect(fogChip).toBeDefined();
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
    expect(offChip?.textContent).toContain('Fortress Xiangqi');
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
    expect(root.querySelector('.profile-overview-side')?.textContent).toContain('python-v2-v1.5');

    // Recent games ride the same tab card and game rows.
    expect(root.querySelector('.profile-tab[aria-selected="true"]')?.textContent).toBe(
      'Recent games',
    );
    expect(root.querySelectorAll('.profile-game-list .profile-game-row')).toHaveLength(1);
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
});
