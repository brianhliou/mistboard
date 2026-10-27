import type { IncomingMessage, ServerResponse } from 'node:http';
import { listBotRatingSnapshots, promoteBotRatingSnapshots } from './bot-rating-snapshots.js';
import { getPublicBotProfile, listPublicBots, recordGameEnd } from './persistence.js';
import {
  assert,
  definePersistenceTests,
  pg,
  TEST_DATABASE_URL,
  test,
} from './persistence-test-support.js';
import { tryHandle as tryHandleBotsRoute } from './routes/bots.js';

type ResponseCapture = {
  body: string;
  headers: Record<string, string | string[]>;
  status: number | null;
};

definePersistenceTests('bot profiles', () => {
  test('splits a multi-variant bot record and recent games per game spec', async () => {
    // The pikafish bug (2026-09-04): one aggregate GROUP BY bot id meant the
    // profile could only ever show lifetime numbers, and the flat games list
    // was "most recent N across all variants" -- which for pikafish was 100%
    // jieqi, so the xiangqi view showed an all-jieqi list.
    await insertBotProfile('multi-bot', 'Multi Bot', 'public', {
      gameSpecId: 'xiangqi',
      supportedGameSpecIds: ['xiangqi', 'jieqi', 'banqi'],
    });

    const endGame = async (
      roomId: string,
      variant: string,
      result: 'black-wins' | 'white-wins' | 'draw',
      endedAt: Date,
    ) => {
      await recordGameEnd(roomId, {
        variant,
        mode: 'pve',
        result,
        termination: result === 'draw' ? 'draw' : 'king-captured',
        plyCount: 20,
        startedAt: new Date('2026-01-01T00:00:00Z'),
        endedAt,
        whiteClient: 'human-client',
        blackClient: 'python-v2-v1.5',
        whiteName: null,
        blackName: 'Multi Bot',
        corpusId: null,
        rated: false,
        visibility: 'public',
        initialMs: 180_000,
        incrementMs: 2_000,
        participants: [
          {
            color: 'white',
            displayName: 'Guest',
            subjectType: 'guest',
            subjectId: null,
            visibility: 'public',
          },
          {
            color: 'black',
            displayName: 'Multi Bot',
            subjectType: 'bot',
            subjectId: 'multi-bot',
            visibility: 'public',
          },
        ],
      });
    };

    // The bot plays black. Two xiangqi (1 win, 1 loss), three jieqi (2 wins,
    // 1 draw), no banqi. The jieqi games are the MOST RECENT, reproducing the
    // shape that hid xiangqi behind a global row cap.
    await endGame('mb-xq-1', 'xiangqi', 'black-wins', new Date('2026-01-01T01:00:00Z'));
    await endGame('mb-xq-2', 'xiangqi', 'white-wins', new Date('2026-01-01T02:00:00Z'));
    await endGame('mb-jq-1', 'jieqi', 'black-wins', new Date('2026-01-01T03:00:00Z'));
    await endGame('mb-jq-2', 'jieqi', 'black-wins', new Date('2026-01-01T04:00:00Z'));
    await endGame('mb-jq-3', 'jieqi', 'draw', new Date('2026-01-01T05:00:00Z'));

    const profile = await getPublicBotProfile('multi-bot');

    // The lifetime figures are unchanged -- the /bots directory card reads them.
    assert.equal(profile?.gamesTotal, 5);
    assert.deepEqual(profile?.record, { games: 5, wins: 3, losses: 1, draws: 1 });

    // ...and each variant now carries its own, including a supported variant
    // with no games at all, which must be a real 0-0-0 and not a missing key.
    assert.deepEqual(profile?.recordsByGameSpecId, {
      xiangqi: { games: 2, wins: 1, losses: 1, draws: 0 },
      jieqi: { games: 3, wins: 2, losses: 0, draws: 1 },
      banqi: { games: 0, wins: 0, losses: 0, draws: 0 },
    });

    // The per-variant lists are partitioned server-side, so xiangqi is NOT
    // empty even though every one of the most recent games is jieqi.
    assert.deepEqual(
      profile?.gamesByGameSpecId.xiangqi?.map((game) => game.roomId),
      ['mb-xq-2', 'mb-xq-1'],
    );
    assert.deepEqual(
      profile?.gamesByGameSpecId.jieqi?.map((game) => game.roomId),
      ['mb-jq-3', 'mb-jq-2', 'mb-jq-1'],
    );
    assert.deepEqual(profile?.gamesByGameSpecId.banqi, []);

    // The flat list is still newest-first across variants; this is exactly the
    // list a client-side filter would wrongly narrow.
    assert.deepEqual(
      profile?.games.slice(0, 3).map((game) => game.roomId),
      ['mb-jq-3', 'mb-jq-2', 'mb-jq-1'],
    );
  });

  test('lists public bot profiles with public recent games', async () => {
    await insertBotProfile('test-bot', 'Test Bot', 'public');
    await insertBotProfile('private-bot', 'Private Bot', 'private');
    await insertBotRatingSnapshot('test-bot', {
      rating: 1812,
      ratingDeviation: 92,
      games: 48,
      source: 'eve-anchor',
      sourceRef: 'eve-report-2026-01-01',
      published: true,
      createdAt: new Date('2026-01-01T00:02:00Z'),
    });
    await insertBotRatingSnapshot('test-bot', {
      rating: 1675,
      ratingDeviation: 110,
      games: 16,
      source: 'eve-anchor',
      sourceRef: 'banqi-report-2026-01-01',
      published: true,
      createdAt: new Date('2026-01-01T00:02:30Z'),
      gameSpecId: 'banqi',
      timeClass: 'rapid',
    });
    await insertBotRatingSnapshot('test-bot', {
      rating: 2200,
      ratingDeviation: 80,
      games: 64,
      source: 'manual',
      sourceRef: 'draft-calibration',
      published: false,
      createdAt: new Date('2026-01-01T00:03:00Z'),
    });

    const startedAt = new Date('2026-01-01T00:00:00Z');
    const publicEndedAt = new Date('2026-01-01T00:04:00Z');
    const privateEndedAt = new Date('2026-01-01T00:05:00Z');

    await recordGameEnd('test-bot-public-game', {
      variant: 'dark-chess',
      mode: 'pve',
      result: 'black-wins',
      termination: 'king-captured',
      plyCount: 20,
      startedAt,
      endedAt: publicEndedAt,
      whiteClient: 'human-client',
      blackClient: 'python-v2-v1.5',
      whiteName: null,
      blackName: 'Test Bot',
      corpusId: null,
      rated: false,
      visibility: 'public',
      initialMs: 180_000,
      incrementMs: 2_000,
      participants: [
        {
          color: 'white',
          displayName: 'Guest',
          subjectType: 'guest',
          subjectId: null,
          visibility: 'public',
        },
        {
          color: 'black',
          displayName: 'Test Bot',
          subjectType: 'bot',
          subjectId: 'test-bot',
          visibility: 'public',
        },
      ],
    });

    await recordGameEnd('test-bot-private-game', {
      variant: 'dark-chess',
      mode: 'pve',
      result: 'black-wins',
      termination: 'king-captured',
      plyCount: 22,
      startedAt,
      endedAt: privateEndedAt,
      whiteClient: 'human-client-2',
      blackClient: 'python-v2-v1.5',
      whiteName: null,
      blackName: 'Test Bot',
      corpusId: null,
      rated: false,
      visibility: 'private',
      participants: [
        {
          color: 'white',
          displayName: 'Guest',
          subjectType: 'guest',
          subjectId: null,
          visibility: 'private',
        },
        {
          color: 'black',
          displayName: 'Test Bot',
          subjectType: 'bot',
          subjectId: 'test-bot',
          visibility: 'public',
        },
      ],
    });

    const bots = await listPublicBots();
    assert.deepEqual(
      bots.map((bot) => bot.id),
      ['test-bot'],
    );
    assert.equal(bots[0]?.gamesTotal, 1);
    assert.deepEqual(bots[0]?.record, {
      games: 1,
      wins: 1,
      losses: 0,
      draws: 0,
    });
    assert.equal(bots[0]?.rating?.rating, 1812);
    assert.equal(bots[0]?.rating?.ratingDeviation, 92);
    assert.equal(bots[0]?.rating?.games, 48);
    assert.equal(bots[0]?.rating?.source, 'eve-anchor');
    assert.equal(bots[0]?.rating?.sourceRef, 'eve-report-2026-01-01');
    assert.equal(bots[0]?.rating?.provisional, false);
    assert.deepEqual(
      bots[0]?.ratings.map((rating) => [rating.gameSpecId, rating.timeClass, rating.rating]),
      [
        ['banqi', 'rapid', 1675],
        ['dark-chess', 'blitz', 1812],
      ],
    );
    assert.equal(bots[0]?.play.engineId, 'python-v2-v1.5');

    const profile = await getPublicBotProfile('test-bot');
    assert.equal(profile?.gamesTotal, 1);
    assert.deepEqual(profile?.record, {
      games: 1,
      wins: 1,
      losses: 0,
      draws: 0,
    });
    assert.equal(profile?.rating?.rating, 1812);
    assert.equal(profile?.ratings.length, 2);
    assert.equal(profile?.games.length, 1);
    assert.equal(profile?.games[0]?.roomId, 'test-bot-public-game');
    assert.equal(profile?.games[0]?.playerColor, 'black');
    assert.equal(profile?.games[0]?.participants[1]?.subjectType, 'bot');
    assert.equal(profile?.games[0]?.participants[1]?.subjectId, 'test-bot');

    assert.equal(await getPublicBotProfile('private-bot'), null);
  });

  test('bot API routes expose public directory and profile payloads', async () => {
    await insertBotProfile('route-bot', 'Route Bot', 'public');
    await insertBotProfile('hidden-variant-bot', 'Hidden Variant Bot', 'public', {
      gameSpecId: 'dark-mini-xiangqi',
    });

    const listResponse = await routeGet('/api/bots');
    assert.equal(listResponse.status, 200);
    const listPayload = JSON.parse(listResponse.body) as { bots: Array<{ id: string }> };
    assert.deepEqual(
      listPayload.bots.map((bot) => bot.id),
      ['route-bot'],
    );

    const profileResponse = await routeGet('/api/bots/route-bot');
    assert.equal(profileResponse.status, 200);
    const profilePayload = JSON.parse(profileResponse.body) as { bot: { id: string } };
    assert.equal(profilePayload.bot.id, 'route-bot');

    const invalidResponse = await routeGet('/api/bots/bad%2Fid');
    assert.equal(invalidResponse.status, 400);

    const missingResponse = await routeGet('/api/bots/missing-bot');
    assert.equal(missingResponse.status, 404);

    const hiddenVariantResponse = await routeGet('/api/bots/hidden-variant-bot');
    assert.equal(hiddenVariantResponse.status, 404);
  });

  test('bot games route pages one variant past the profile cap (#550)', async () => {
    // The profile payload carries only the newest 10 games per variant; the
    // bot page had no way to reach older ones. This route is its "Load more".
    await insertBotProfile('pager-bot', 'Pager Bot', 'public', {
      supportedGameSpecIds: ['dark-chess', 'banqi'],
    });
    await insertBotProfile('private-pager-bot', 'Private Pager Bot', 'private');
    for (let index = 1; index <= 12; index += 1) {
      const hour = String(index).padStart(2, '0');
      await endBotGame('pager-bot', `pg-dc-${hour}`, 'dark-chess', `2026-01-01T${hour}:00:00Z`);
    }
    // Newer than every dark-chess game, so a missing variant filter would
    // put it on the page.
    await endBotGame('pager-bot', 'pg-bq-1', 'banqi', '2026-01-01T13:00:00Z');
    await endBotGame('private-pager-bot', 'pg-private-1', 'dark-chess', '2026-01-01T01:00:00Z');

    const page = await routeGet('/api/bots/pager-bot/games?variant=dark-chess&offset=10&limit=15');
    assert.equal(page.status, 200);
    const payload = JSON.parse(page.body) as {
      games: Array<{ roomId: string; variant: string; playerColor: string }>;
    };
    assert.deepEqual(
      payload.games.map((game) => game.roomId),
      ['pg-dc-02', 'pg-dc-01'],
    );
    assert.equal(payload.games[0]?.playerColor, 'black');

    const first = await routeGet('/api/bots/pager-bot/games?variant=dark-chess&offset=0&limit=3');
    assert.deepEqual(
      (JSON.parse(first.body) as { games: Array<{ roomId: string }> }).games.map(
        (game) => game.roomId,
      ),
      ['pg-dc-12', 'pg-dc-11', 'pg-dc-10'],
    );

    assert.equal((await routeGet('/api/bots/pager-bot/games')).status, 400);
    assert.equal((await routeGet('/api/bots/pager-bot/games?variant=no-such')).status, 400);
    // A spec on no public surface is not listed on a public bot page.
    assert.equal((await routeGet('/api/bots/pager-bot/games?variant=chess')).status, 404);
    assert.equal(
      (await routeGet('/api/bots/private-pager-bot/games?variant=dark-chess')).status,
      404,
    );
    assert.equal((await routeGet('/api/bots/missing-bot/games?variant=dark-chess')).status, 404);
  });

  test('bot cursor survives a newer finish and orders tied timestamps (#630)', async () => {
    await insertBotProfile('cursor-bot', 'Cursor Bot', 'public');
    for (const id of ['03', '02', '01', '00']) {
      await endBotGame(
        'cursor-bot',
        `cursor-${id}`,
        'dark-chess',
        id === '00' ? '2026-01-01T00:00:00Z' : '2026-01-01T01:00:00Z',
      );
    }
    const base = '/api/bots/cursor-bot/games?variant=dark-chess&limit=2';
    const first = JSON.parse((await routeGet(base)).body).games as Array<{
      roomId: string;
      endedAt: string;
    }>;
    assert.deepEqual(
      first.map((game) => game.roomId),
      ['cursor-03', 'cursor-02'],
    );
    await endBotGame('cursor-bot', 'cursor-04', 'dark-chess', '2026-01-01T02:00:00Z');
    const last = first[first.length - 1];
    const before = encodeURIComponent(JSON.stringify([last.endedAt, last.roomId]));
    const second = JSON.parse((await routeGet(`${base}&offset=99&before=${before}`)).body)
      .games as Array<{ roomId: string }>;
    assert.deepEqual(
      [...first, ...second].map((game) => game.roomId),
      ['cursor-03', 'cursor-02', 'cursor-01', 'cursor-00'],
    );
    assert.equal((await routeGet(`${base}&before=bad`)).status, 400);
  });

  test('bot rating snapshot audit query separates latest, public, and history views', async () => {
    await insertBotProfile('audit-bot', 'Audit Bot', 'public');
    await insertBotRatingSnapshot('audit-bot', {
      rating: 1800,
      ratingDeviation: 95,
      games: 24,
      source: 'eve-anchor',
      sourceRef: 'published-report',
      published: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    await insertBotRatingSnapshot('audit-bot', {
      rating: 1900,
      ratingDeviation: 88,
      games: 30,
      source: 'manual',
      sourceRef: 'draft-report',
      published: false,
      createdAt: new Date('2026-01-02T00:00:00Z'),
    });

    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      const latest = await listBotRatingSnapshots(client, { botId: 'audit-bot' });
      assert.equal(latest.length, 1);
      assert.equal(latest[0]?.rating, 1900);
      assert.equal(latest[0]?.published, false);
      assert.equal(latest[0]?.publishedAt, null);

      const published = await listBotRatingSnapshots(client, {
        botId: 'audit-bot',
        visibility: 'published',
      });
      assert.equal(published.length, 1);
      assert.equal(published[0]?.rating, 1800);
      assert.equal(published[0]?.published, true);
      assert.equal(published[0]?.publishedAt?.toISOString(), '2026-01-01T00:00:00.000Z');

      const history = await listBotRatingSnapshots(client, {
        botId: 'audit-bot',
        history: true,
      });
      assert.deepEqual(
        history.map((snapshot) => snapshot.rating),
        [1900, 1800],
      );
    } finally {
      await client.end();
    }
  });

  test('bot rating promotion publishes an exact draft snapshot for public bot pages', async () => {
    await insertBotProfile('promote-bot', 'Promote Bot', 'public');
    await insertBotRatingSnapshot('promote-bot', {
      rating: 1700,
      ratingDeviation: 120,
      games: 10,
      source: 'eve-anchor',
      sourceRef: 'old-report',
      published: true,
      createdAt: new Date('2026-01-03T00:00:00Z'),
    });
    const draftId = await insertBotRatingSnapshot('promote-bot', {
      rating: 1850,
      ratingDeviation: 82,
      games: 40,
      source: 'eve-anchor',
      sourceRef: 'reviewed-report',
      published: false,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });

    const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
    try {
      const promoted = await promoteBotRatingSnapshots(pool, {
        snapshotId: draftId,
        at: new Date('2026-01-04T00:00:00Z'),
      });
      assert.equal(promoted.length, 1);
      assert.equal(promoted[0]?.snapshotId, draftId);
      assert.equal(promoted[0]?.published, true);
      assert.equal(promoted[0]?.publishedAt?.toISOString(), '2026-01-04T00:00:00.000Z');
    } finally {
      await pool.end();
    }

    const bots = await listPublicBots();
    assert.equal(bots[0]?.id, 'promote-bot');
    assert.equal(bots[0]?.rating?.rating, 1850);
  });
});

async function routeGet(path: string): Promise<ResponseCapture> {
  const response = captureResponse();
  const parsedUrl = new URL(path, 'http://localhost');
  const handled = await tryHandleBotsRoute(
    {},
    { method: 'GET', headers: {} } as unknown as IncomingMessage,
    response,
    parsedUrl.pathname,
    parsedUrl,
  );
  assert.equal(handled, true);
  return response;
}

// One completed public PvE game with the bot in the black seat.
async function endBotGame(
  botId: string,
  roomId: string,
  variant: string,
  endedAt: string,
): Promise<void> {
  await recordGameEnd(roomId, {
    variant,
    mode: 'pve',
    result: 'black-wins',
    termination: 'king-captured',
    plyCount: 20,
    startedAt: new Date('2026-01-01T00:00:00Z'),
    endedAt: new Date(endedAt),
    whiteClient: 'human-client',
    blackClient: 'python-v2-v1.5',
    whiteName: null,
    blackName: botId,
    corpusId: null,
    rated: false,
    visibility: 'public',
    initialMs: 180_000,
    incrementMs: 2_000,
    participants: [
      {
        color: 'white',
        displayName: 'Guest',
        subjectType: 'guest',
        subjectId: null,
        visibility: 'public',
      },
      {
        color: 'black',
        displayName: botId,
        subjectType: 'bot',
        subjectId: botId,
        visibility: 'public',
      },
    ],
  });
}

function captureResponse(): ServerResponse & ResponseCapture {
  const capture = {
    body: '',
    headers: {} as Record<string, string | string[]>,
    status: null as number | null,
    writeHead(status: number, headers?: Record<string, string | string[]>) {
      capture.status = status;
      capture.headers = headers ?? {};
      return capture;
    },
    end(chunk?: string) {
      capture.body += chunk ?? '';
      return capture;
    },
  };
  return capture as unknown as ServerResponse & ResponseCapture;
}

async function insertBotProfile(
  id: string,
  displayName: string,
  visibility: 'private' | 'unlisted' | 'public',
  opts: { gameSpecId?: string; supportedGameSpecIds?: string[] } = {},
): Promise<void> {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  const defaultGameSpecId = opts.gameSpecId ?? 'dark-chess';
  try {
    await client.query(
      `INSERT INTO bot_profiles
         (id, display_name, bio, owner_type, active_engine_id, default_game_spec_id,
          supported_game_spec_ids, play_initial_ms, play_increment_ms, visibility)
       VALUES ($1, $2, '', 'system', 'python-v2-v1.5', $3,
               $5, 180000, 2000, $4)`,
      [
        id,
        displayName,
        defaultGameSpecId,
        visibility,
        opts.supportedGameSpecIds ?? [defaultGameSpecId],
      ],
    );
  } finally {
    await client.end();
  }
}

async function insertBotRatingSnapshot(
  botId: string,
  opts: {
    rating: number;
    ratingDeviation: number | null;
    games: number;
    source: 'manual' | 'eve-anchor' | 'import';
    sourceRef: string | null;
    published: boolean;
    createdAt: Date;
    gameSpecId?: string;
    timeClass?: 'bullet' | 'blitz' | 'rapid';
  },
): Promise<number> {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO bot_rating_snapshots
         (bot_id, game_spec_id, time_class, rating, rating_deviation, games,
          source, source_ref, published, published_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
               CASE WHEN $9::boolean THEN $10::timestamptz ELSE NULL::timestamptz END, $10)
       RETURNING id::text`,
      [
        botId,
        opts.gameSpecId ?? 'dark-chess',
        opts.timeClass ?? 'blitz',
        opts.rating,
        opts.ratingDeviation,
        opts.games,
        opts.source,
        opts.sourceRef,
        opts.published,
        opts.createdAt,
      ],
    );
    return Number(rows[0]?.id ?? 0);
  } finally {
    await client.end();
  }
}
