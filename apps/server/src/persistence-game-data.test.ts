import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import {
  type HiddenPieceRecord,
  parseHiddenPiecePgn,
  replayHiddenPieceRecord,
} from '@mistboard/game';
import './variant-tenant/register-tenants.js';
import { banqiTenant } from './banqi-tenant.js';
import { ensureDataFile } from './game-data-files.js';
import { resolveGameExport } from './game-export-tenant.js';
import { jungleTenant } from './jungle-tenant.js';
import {
  appendRoomEvent,
  getGameSummaries,
  getGameSummary,
  loadRoom,
  loadRoomsEvents,
  recordGameEnd,
} from './persistence.js';
import {
  countPublishedGamesByMonth,
  getStoredDataFile,
  insertDataFileIfAbsent,
  listPublishedRoomIds,
  listStoredDataFiles,
} from './persistence-game-data.js';
import {
  assert,
  definePersistenceTests,
  pg,
  TEST_DATABASE_URL,
  test,
} from './persistence-test-support.js';
import {
  clearDataListingCache,
  loadDataListing,
  resetDataDownloadLimiterForTests,
  tryHandle,
} from './routes/data.js';
import type { HttpApiContext } from './routes/lib.js';
import { buildTenantGameSummary } from './variant-tenant/events.js';
import { createTenantRuntimeRoomFromEvents } from './variant-tenant/runtime.js';
import { xiangqiTenant } from './xiangqi-tenant.js';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/variant-postgame');
type SeedVariant = 'xiangqi' | 'banqi' | 'jungle';
// biome-ignore lint/suspicious/noExplicitAny: test harness over three tenants with opaque types.
const TENANTS: Record<SeedVariant, any> = {
  xiangqi: xiangqiTenant,
  banqi: banqiTenant,
  jungle: jungleTenant,
};

type SeedOptions = {
  mode?: 'pvp' | 'pve' | 'imported';
  visibility?: 'public' | 'private' | 'link' | 'unlisted';
  endedAt: string;
  userId?: string;
  corpusId?: string | null;
  origin?: Record<string, unknown>;
  variant?: SeedVariant;
};

// A finished game from the committed fixture, under a new room id (the xq_ /
// bq_ / jgl_ prefix is what routes its export to the tenant).
async function seedXiangqiGame(roomId: string, options: SeedOptions): Promise<void> {
  const variant = options.variant ?? 'xiangqi';
  const tenant = TENANTS[variant];
  const template = readFileSync(`${FIXTURES}/${variant}.jsonl`, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const events = template.map((event, index) => ({
    ...event,
    roomId,
    ...(index === 0 && options.origin ? { origin: options.origin } : {}),
  }));
  const hydration = createTenantRuntimeRoomFromEvents(tenant, events as never[]);
  assert.ok(hydration.ok);
  for (const [seq, event] of events.entries()) {
    await appendRoomEvent(roomId, seq, event as never);
  }
  const summary = buildTenantGameSummary(tenant, hydration.room);
  const ended = new Date(options.endedAt);
  const [first, second] = tenant.colors as ['red', 'black'];
  await recordGameEnd(roomId, {
    ...summary,
    mode: options.mode ?? 'pvp',
    visibility: options.visibility ?? 'public',
    rated: false,
    startedAt: new Date(ended.getTime() - 10 * 60 * 1000),
    endedAt: ended,
    corpusId: options.corpusId ?? null,
    initialMs: 300_000,
    incrementMs: 3_000,
    participants: [
      options.userId
        ? {
            color: first,
            displayName: 'Operator',
            subjectType: 'user',
            subjectId: options.userId,
            visibility: 'public',
          }
        : {
            color: first,
            displayName: 'Guest',
            subjectType: 'guest',
            subjectId: `device-${roomId}`,
            visibility: 'public',
          },
      {
        color: second,
        displayName: 'Guest',
        subjectType: 'guest',
        subjectId: `device-b-${roomId}`,
        visibility: 'public',
      },
    ],
  });
}

const DEPS = { getGameSummaries, loadRoomsEvents, getStoredDataFile, insertDataFileIfAbsent };
const AUGUST_XIANGQI_JSONL = {
  kind: 'monthly',
  month: '2026-08',
  variant: 'xiangqi',
  format: 'jsonl',
} as const;

async function seedMonth(): Promise<void> {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO users (id, email, handle, display_name, stats_excluded_at)
       VALUES ('data-operator', 'op@example.com', 'dataop', 'Operator', now())`,
    );
  } finally {
    await client.end();
  }
  await seedXiangqiGame('xq_data_a', { endedAt: '2026-08-10T12:00:00Z' });
  await seedXiangqiGame('xq_data_b', { endedAt: '2026-08-20T12:00:00Z', mode: 'pve' });
  await seedXiangqiGame('jgl_data_c', { endedAt: '2026-08-15T12:00:00Z', variant: 'jungle' });
  // A hidden-piece game: offered since its export replays (#484).
  await seedXiangqiGame('bq_data_d', { endedAt: '2026-08-16T12:00:00Z', variant: 'banqi' });
  // Each of these is left out of the August file for its own reason.
  await seedXiangqiGame('xq_data_operator', {
    endedAt: '2026-08-11T12:00:00Z',
    userId: 'data-operator',
  });
  await seedXiangqiGame('xq_data_private', {
    endedAt: '2026-08-12T12:00:00Z',
    visibility: 'private',
  });
  await seedXiangqiGame('xq_data_imported', {
    endedAt: '2026-08-13T12:00:00Z',
    mode: 'imported',
    corpusId: 'test-match-2026-08',
    origin: {
      kind: 'imported',
      event: 'Test Engine vs Other Engine · 2026-08',
      credit: {
        work: 'Test Engine',
        authors: ['A. Author'],
        url: 'https://example.com/test-engine',
        permission: true,
      },
    },
  });
  // A September game: its month is still open on the test's clock.
  await seedXiangqiGame('xq_data_open_month', { endedAt: '2026-09-03T12:00:00Z' });
  // An aborted row in August.
  const client2 = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client2.connect();
  try {
    await client2.query(
      `INSERT INTO games (room_id, variant, result, termination, ply_count, started_at, ended_at,
         mode, status, visibility)
       VALUES ('xq_data_aborted', 'xiangqi', NULL, 'abandoned', 0,
         '2026-08-14T12:00:00Z', '2026-08-14T12:01:00Z', 'pvp', 'aborted', 'public')`,
    );
  } finally {
    await client2.end();
  }
}

async function sqlQuery(text: string): Promise<void> {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query(text);
  } finally {
    await client.end();
  }
}

type CapturedResponse = { status: number; headers: Record<string, string>; body: Buffer };

async function request(
  pathname: string,
  headers: Record<string, string> = {},
): Promise<CapturedResponse> {
  const captured: CapturedResponse = { status: 0, headers: {}, body: Buffer.alloc(0) };
  const response = {
    writeHead(status: number, headers: Record<string, string> = {}) {
      captured.status = status;
      captured.headers = headers;
      return this;
    },
    end(chunk?: string | Buffer) {
      if (chunk !== undefined) captured.body = Buffer.from(chunk);
    },
  } as unknown as ServerResponse;
  const url = new URL(`http://localhost${pathname}`);
  const req = {
    method: 'GET',
    url: pathname,
    headers,
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage;
  const handled = await tryHandle({} as HttpApiContext, req, response, url.pathname, url);
  assert.equal(handled, true, pathname);
  return captured;
}

// What a browser does with a /data link: the plain URL answers with a redirect
// to the build's own URL, which answers with the bytes.
async function download(pathname: string): Promise<CapturedResponse & { location: string }> {
  const redirect = await request(pathname);
  assert.equal(redirect.status, 302, pathname);
  assert.equal(redirect.headers['cache-control'], 'public, max-age=60');
  const location = redirect.headers.location!;
  return { ...(await request(location)), location };
}

definePersistenceTests('game data files', () => {
  test('bot monthly counts include the full month beyond the profile page limit', async () => {
    await sqlQuery(`INSERT INTO games
      (room_id, variant, result, termination, ply_count, started_at, ended_at, mode, status, visibility)
      SELECT 'xq_bot_page_' || n, 'xiangqi', 'red-wins', 'resignation', 20,
        '2026-08-10T10:00:00Z'::timestamptz, '2026-08-10T10:10:00Z'::timestamptz,
        'pve', 'completed', 'public' FROM generate_series(1, 20) AS n`);
    await sqlQuery(`INSERT INTO game_participants
      (game_id, color, subject_type, subject_id, display_name, visibility)
      SELECT 'xq_bot_page_' || n, 'red', 'bot', 'page-bot', 'Page Bot', 'public'
      FROM generate_series(1, 20) AS n`);
    const to = new Date('2026-09-01');
    assert.deepEqual(await countPublishedGamesByMonth(['xiangqi'], to, 'human', 'page-bot'), [
      { month: '2026-08', variant: 'xiangqi', games: 20 },
    ]);
    assert.equal(
      (await listPublishedRoomIds(['xiangqi'], new Date('2026-08-01'), to, 'human', 'page-bot'))
        .length,
      20,
    );
  });

  test('bot downloads use stable public identities in either seat and fail closed', async () => {
    await seedMonth();
    await sqlQuery(`INSERT INTO bot_profiles
      (id, display_name, bio, owner_type, active_engine_id, default_game_spec_id,
       supported_game_spec_ids, play_initial_ms, play_increment_ms, visibility)
      VALUES ('data-bot', 'Renamed Engine', '', 'system', 'test-engine', 'xiangqi', ARRAY['xiangqi','banqi'], 300000, 3000, 'public'),
       ('private-bot', 'Private Engine', '', 'system', 'test-engine', 'xiangqi', ARRAY['xiangqi'], 300000, 3000, 'private'),
       ('empty-bot', 'No games', '', 'system', 'test-engine', 'xiangqi', ARRAY['xiangqi'], 300000, 3000, 'public'),
       ('hidden-bot', 'Hidden Engine', '', 'system', 'test-engine', 'ffq-banqi', ARRAY['ffq-banqi'], 300000, 3000, 'public')`);
    // One game in the first seat, one in the second, and the excluded rows.
    await sqlQuery(`UPDATE game_participants SET subject_type = 'bot', subject_id = 'data-bot', display_name = 'Old Name'
      WHERE (game_id IN ('xq_data_a','xq_data_private','xq_data_operator','xq_data_imported','xq_data_open_month') AND color = 'red')
         OR (game_id = 'xq_data_b' AND color = 'black')`);
    // Both seats in one game still yield just one row. Another game merely
    // borrowing the bot's display name must not match its stable identity.
    await sqlQuery(`UPDATE game_participants SET subject_type = 'bot', subject_id = 'data-bot', display_name = 'Another Old Name'
      WHERE game_id = 'xq_data_a' AND color = 'black'`);
    await sqlQuery(
      `UPDATE game_participants SET display_name = 'Renamed Engine' WHERE game_id = 'bq_data_d'`,
    );
    // Keep the operator as the other seat so the stats exclusion still applies.
    await sqlQuery(
      `UPDATE game_participants SET subject_type = 'bot', subject_id = 'data-bot' WHERE game_id = 'xq_data_operator' AND color = 'black'`,
    );
    await sqlQuery(
      `UPDATE game_participants SET subject_type = 'user', subject_id = 'data-operator' WHERE game_id = 'xq_data_operator' AND color = 'red'`,
    );

    const from = new Date('2026-08-01');
    const to = new Date('2026-09-01');
    assert.deepEqual(
      await listPublishedRoomIds(['xiangqi', 'banqi'], from, to, 'human', 'data-bot'),
      ['xq_data_a', 'xq_data_b'],
    );
    assert.deepEqual(
      await countPublishedGamesByMonth(['xiangqi', 'banqi'], to, 'human', 'data-bot'),
      [{ month: '2026-08', variant: 'xiangqi', games: 2 }],
    );
    clearDataListingCache();
    const listing = await loadDataListing(new Date('2026-09-15'), 'data-bot');
    assert.equal(listing.months[0]?.games, 2);
    assert.equal(
      (await loadDataListing(new Date('2026-09-15'))).months[0]?.games,
      4,
      'bot cache never replaces unfiltered counts',
    );
    assert.equal(
      listing.months[0]?.files[0]?.path,
      '/api/data/bots/data-bot/monthly/2026-08/all.jsonl.gz',
    );
    assert.deepEqual(listing.collections, []);
    assert.equal(
      listing.bots?.some((bot) => bot.id === 'private-bot' || bot.id === 'hidden-bot'),
      false,
    );
    assert.deepEqual((await loadDataListing(new Date('2026-09-15'), 'empty-bot')).months, []);
    resetDataDownloadLimiterForTests();
    const file = await download('/api/data/bots/data-bot/monthly/2026-08/xiangqi.jsonl.gz');
    const lines = gunzipSync(file.body).toString('utf8').trimEnd().split('\n');
    assert.deepEqual(
      lines.map((line) => JSON.parse(line).game_id),
      ['xq_data_a', 'xq_data_b'],
    );
    const single = resolveGameExport({
      roomId: 'xq_data_a',
      format: 'json',
      summary: await getGameSummary('xq_data_a'),
      events: await loadRoom('xq_data_a'),
    });
    assert.equal(single.status === 200 && single.body, lines[0]);
    for (const bot of ['unknown-bot', 'private-bot', 'hidden-bot']) {
      assert.equal((await request(`/api/data?bot=${bot}`)).status, 404);
      assert.equal(
        (await request(`/api/data/bots/${bot}/monthly/2026-08/xiangqi.jsonl.gz`)).status,
        404,
      );
    }
    assert.equal((await request('/api/data?bot=bad%2Fid')).status, 400);
    assert.equal(
      (await request('/api/data/bots/data-bot/monthly/2026-08/jungle.jsonl.gz')).status,
      404,
    );
    assert.equal(
      (await request('/api/data/bots/data-bot/monthly/2026-08/xiangqi.jsonl.gz?bot=other')).status,
      400,
    );
    // An already-built file becomes inaccessible when its bot becomes private.
    await sqlQuery(`UPDATE bot_profiles SET visibility = 'private' WHERE id = 'data-bot'`);
    assert.equal((await request(file.location)).status, 404);
    assert.equal(
      (await request('/api/data?bot=data-bot')).status,
      404,
      'warm listing cache still checks public visibility',
    );
  });

  test('an opponent filter unions every public level, and old and exact bot links keep working', async () => {
    await seedMonth();
    await sqlQuery(`INSERT INTO bot_profiles
      (id, display_name, bio, owner_type, active_engine_id, default_game_spec_id,
       supported_game_spec_ids, play_initial_ms, play_increment_ms, visibility)
      VALUES ('fairy-stockfish-level-1', 'Fairy-Stockfish Level 1', '', 'system', 'test-engine', 'xiangqi', ARRAY['xiangqi'], 300000, 3000, 'public'),
       ('fairy-stockfish-level-2', 'Fairy-Stockfish Level 2', '', 'system', 'test-engine', 'xiangqi', ARRAY['xiangqi','jungle'], 300000, 3000, 'public'),
       ('fairy-stockfish-level-3', 'Fairy-Stockfish Level 3', '', 'system', 'test-engine', 'xiangqi', ARRAY['xiangqi','banqi'], 300000, 3000, 'private'),
       ('jqe', 'jqe', '', 'system', 'test-engine', 'jieqi', ARRAY['jieqi'], 300000, 3000, 'public')
      ON CONFLICT (id) DO UPDATE SET supported_game_spec_ids = EXCLUDED.supported_game_spec_ids,
        visibility = EXCLUDED.visibility`);
    // Level 1 in one game, level 2 under its old id in another, level 3
    // (private) in the banqi game, and a pvp game with no bot.
    await sqlQuery(`UPDATE game_participants SET subject_type = 'bot', subject_id = 'fairy-stockfish-level-1'
      WHERE game_id = 'xq_data_a' AND color = 'black'`);
    await sqlQuery(`UPDATE game_participants SET subject_type = 'bot', subject_id = 'fairy-stockfish-xiangqi-level-2'
      WHERE game_id = 'xq_data_b' AND color = 'black'`);
    await sqlQuery(`UPDATE game_participants SET subject_type = 'bot', subject_id = 'fairy-stockfish-level-3'
      WHERE game_id = 'bq_data_d' AND color = 'black'`);
    clearDataListingCache();

    const response = await request('/api/data?opponent=fairy-stockfish');
    assert.equal(response.status, 200);
    const listing = JSON.parse(response.body.toString('utf8')) as Awaited<
      ReturnType<typeof loadDataListing>
    >;
    assert.equal(listing.opponentId, 'fairy-stockfish');
    assert.equal(listing.botId, undefined);
    // Only the public levels' variants; the private level's banqi is not offered.
    assert.deepEqual(listing.offeredVariants, ['xiangqi', 'jungle']);
    assert.deepEqual(listing.unavailableVariants, []);
    assert.deepEqual(listing.collections, []);
    assert.deepEqual(
      listing.months.map((month) => [month.month, month.variants.map((v) => [v.variant, v.games])]),
      [['2026-08', [['xiangqi', 2]]]],
    );
    assert.equal(
      listing.months[0]?.variants[0]?.files[0]?.path,
      '/api/data/opponents/fairy-stockfish/monthly/2026-08/xiangqi.pgn.gz',
    );
    // The whole payload never names a private level or a hidden variant.
    const wire = response.body.toString('utf8');
    for (const word of ['fairy-stockfish-level-3', 'ffq', 'bq_data_d'])
      assert.ok(!wire.includes(word), word);

    resetDataDownloadLimiterForTests();
    const file = await download(
      '/api/data/opponents/fairy-stockfish/monthly/2026-08/xiangqi.jsonl.gz',
    );
    assert.deepEqual(
      gunzipSync(file.body)
        .toString('utf8')
        .trimEnd()
        .split('\n')
        .map((line) => JSON.parse(line).game_id),
      ['xq_data_a', 'xq_data_b'],
    );
    assert.match(
      file.headers['content-disposition'] ?? '',
      /mistboard_fairy-stockfish-all-levels_xiangqi_2026-08\.jsonl\.gz/,
    );
    // Not a variant any public level plays, an unknown opponent, a one-bot
    // opponent's second URL, or a bad id: all fail closed.
    for (const path of [
      '/api/data/opponents/fairy-stockfish/monthly/2026-08/banqi.jsonl.gz',
      '/api/data/opponents/no-such/monthly/2026-08/xiangqi.jsonl.gz',
      '/api/data/opponents/jqe/monthly/2026-08/jieqi.jsonl.gz',
    ])
      assert.equal((await request(path)).status, 404, path);
    assert.equal((await request('/api/data?opponent=no-such')).status, 404);
    assert.equal((await request('/api/data?opponent=Bad%2Fid')).status, 400);
    assert.equal((await request('/api/data?opponent=fairy-stockfish&bot=jqe')).status, 400);

    // One level: the exact link and the bot's old id give the same listing.
    clearDataListingCache();
    const exact = JSON.parse(
      (await request('/api/data?bot=fairy-stockfish-level-2')).body.toString('utf8'),
    );
    const legacy = JSON.parse(
      (await request('/api/data?bot=fairy-stockfish-xiangqi-level-2')).body.toString('utf8'),
    );
    assert.equal(exact.botId, 'fairy-stockfish-level-2');
    assert.deepEqual(legacy, exact);
    assert.equal(exact.months[0]?.games, 1);
    // A one-bot opponent is that bot's listing.
    const one = JSON.parse((await request('/api/data?opponent=jqe')).body.toString('utf8'));
    assert.equal(one.botId, 'jqe');
    assert.equal(one.opponentId, undefined);

    // An already-built opponent file stops serving when every level goes private.
    await sqlQuery(
      `UPDATE bot_profiles SET visibility = 'private' WHERE id LIKE 'fairy-stockfish-level-%'`,
    );
    assert.equal((await request(file.location)).status, 404);
  });

  test('a variant whose first month is still open says when its first file comes', async () => {
    await seedMonth();
    // Jungle's only game moves into the open month.
    await sqlQuery(
      `UPDATE games SET ended_at = '2026-09-05T12:00:00Z' WHERE room_id = 'jgl_data_c'`,
    );
    clearDataListingCache();
    const listing = await loadDataListing(new Date('2026-09-15T00:00:00Z'));
    assert.deepEqual(listing.firstArchives, [{ variant: 'jungle', month: '2026-09' }]);
    assert.ok(!listing.variants.includes('jungle'));
    assert.ok(listing.offeredVariants.includes('jungle'));
    assert.ok(listing.months.every((month) => month.month !== '2026-09'));
    assert.deepEqual(listing.unavailableVariants, []);
  });

  test('the listing counts closed months only, without the excluded games', async () => {
    await seedMonth();
    clearDataListingCache();
    const listing = await loadDataListing(new Date('2026-09-15T00:00:00Z'));
    // Only the counted August games: the operator's game, the private one, the
    // imported one and the aborted one are out, and September is open.
    assert.deepEqual(
      listing.months.map((month) => [month.month, month.variants.map((v) => [v.variant, v.games])]),
      [
        [
          '2026-08',
          [
            ['xiangqi', 2],
            ['banqi', 1],
            ['jungle', 1],
          ],
        ],
      ],
    );
    // The all-variants file of the month counts every variant.
    assert.deepEqual(
      listing.months[0]?.files.map((file) => [file.path, file.games]),
      [['/api/data/monthly/2026-08/all.jsonl.gz', 4]],
    );
    assert.deepEqual(listing.variants, ['xiangqi', 'banqi', 'jungle']);
    assert.deepEqual(
      listing.collections.map((collection) => [collection.id, collection.event, collection.games]),
      [['test-match-2026-08', 'Test Engine vs Other Engine · 2026-08', 1]],
    );
    assert.equal(listing.collections[0]?.credit?.work, 'Test Engine');
  });

  test('a built JSONL line equals that game single export, and PGN games match export.pgn', async () => {
    await seedMonth();
    const roomIds = ['xq_data_a', 'xq_data_b'];
    const jsonl = await ensureDataFile(AUGUST_XIANGQI_JSONL, async () => roomIds, DEPS);
    const lines = gunzipSync(jsonl.content).toString('utf8').trimEnd().split('\n');
    assert.equal(lines.length, 2);
    assert.equal(jsonl.gameCount, 2);
    for (const [index, roomId] of roomIds.entries()) {
      const single = resolveGameExport({
        roomId,
        format: 'json',
        summary: await getGameSummary(roomId),
        events: await loadRoom(roomId),
      });
      assert.equal(single.status, 200);
      assert.equal(lines[index], single.status === 200 ? single.body : null);
    }
    const pgn = await ensureDataFile(
      { ...AUGUST_XIANGQI_JSONL, format: 'pgn' },
      async () => roomIds,
      DEPS,
    );
    const singlePgn = resolveGameExport({
      roomId: 'xq_data_a',
      format: 'pgn',
      summary: await getGameSummary('xq_data_a'),
      events: await loadRoom('xq_data_a'),
    });
    assert.equal(singlePgn.status, 200);
    const pgnText = gunzipSync(pgn.content).toString('utf8');
    assert.ok(singlePgn.status === 200 && pgnText.startsWith(`${singlePgn.body}\n[Event`));
  });

  test('two concurrent first requests store one file with one checksum', async () => {
    await seedMonth();
    resetDataDownloadLimiterForTests();
    const [first, second] = await Promise.all([
      download('/api/data/monthly/2026-08/xiangqi.jsonl.gz'),
      download('/api/data/monthly/2026-08/xiangqi.jsonl.gz'),
    ]);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(first.location, second.location);
    assert.ok(first.body.equals(second.body));
    assert.equal(first.headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.equal(first.headers['x-mistboard-games'], '2');
    const stored = await listStoredDataFiles();
    assert.deepEqual(
      stored.map((file) => file.key),
      ['monthly/2026-08/xiangqi.jsonl.gz'],
    );
    assert.equal(first.headers['x-mistboard-sha256'], stored[0]?.sha256);
    // The URL names the bytes it serves.
    assert.equal(
      first.location,
      `/api/data/monthly/2026-08/xiangqi.${stored[0]?.sha256.slice(0, 12)}.jsonl.gz`,
    );
    assert.equal(
      first.headers['content-disposition'],
      'attachment; filename="mistboard_xiangqi_2026-08.jsonl.gz"',
    );
    // The file is the counted games only.
    const ids = gunzipSync(first.body)
      .toString('utf8')
      .trimEnd()
      .split('\n')
      .map((line) => (JSON.parse(line) as { game_id: string }).game_id);
    assert.deepEqual(ids, ['xq_data_a', 'xq_data_b']);
  });

  test('the all-variants file mixes every variant, with the same exclusions, built once', async () => {
    await seedMonth();
    resetDataDownloadLimiterForTests();
    const [first, second] = await Promise.all([
      download('/api/data/monthly/2026-08/all.jsonl.gz'),
      download('/api/data/monthly/2026-08/all.jsonl.gz'),
    ]);
    assert.equal(first.status, 200);
    assert.ok(first.body.equals(second.body));
    const games = gunzipSync(first.body)
      .toString('utf8')
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line) as { game_id: string; variant: string });
    // Oldest first across variants; the operator, private, imported and
    // aborted games stay out, and so does the open month's game.
    assert.deepEqual(
      games.map((game) => [game.game_id, game.variant]),
      [
        ['xq_data_a', 'xiangqi'],
        ['jgl_data_c', 'jungle'],
        ['bq_data_d', 'banqi'],
        ['xq_data_b', 'xiangqi'],
      ],
    );
    // Each line is still that game's single export.
    const single = resolveGameExport({
      roomId: 'jgl_data_c',
      format: 'json',
      summary: await getGameSummary('jgl_data_c'),
      events: await loadRoom('jgl_data_c'),
    });
    assert.equal(single.status === 200 && single.body, JSON.stringify(games[1]));
    assert.deepEqual(
      (await listStoredDataFiles()).map((file) => [file.key, file.gameCount]),
      [['monthly/2026-08/all.jsonl.gz', 4]],
    );
    // JSONL only: no mixed PGN.
    assert.equal((await request('/api/data/monthly/2026-08/all.pgn.gz')).status, 404);
  });

  test('the collection downloads with its origin, and unknown files fail closed', async () => {
    await seedMonth();
    resetDataDownloadLimiterForTests();
    const collection = await download('/api/data/collections/test-match-2026-08.jsonl.gz');
    assert.match(
      collection.location,
      /^\/api\/data\/collections\/test-match-2026-08\.[0-9a-f]{12}\.jsonl\.gz$/,
    );
    assert.equal(collection.status, 200);
    const [line] = gunzipSync(collection.body).toString('utf8').trimEnd().split('\n');
    const game = JSON.parse(line!) as { game_id: string; mode: string; origin?: { event: string } };
    assert.equal(game.game_id, 'xq_data_imported');
    assert.equal(game.mode, 'imported');
    assert.equal(game.origin?.event, 'Test Engine vs Other Engine · 2026-08');

    assert.equal((await request('/api/data/collections/no-such-match.jsonl.gz')).status, 404);
    assert.equal((await request('/api/data/monthly/2026-13/xiangqi.jsonl.gz')).status, 400);
    assert.equal((await request('/api/data/monthly/2026-08/mahjong.jsonl.gz')).status, 404);
    // A hidden-piece variant's month downloads like any other since #484, in
    // both formats, and every game in it replays from the file alone.
    for (const format of ['jsonl', 'pgn'] as const) {
      const banqi = await download(`/api/data/monthly/2026-08/banqi.${format}.gz`);
      assert.equal(banqi.status, 200, format);
      const text = gunzipSync(banqi.body).toString('utf8');
      if (format === 'jsonl') {
        const [line] = text.trimEnd().split('\n');
        const record = JSON.parse(line!) as HiddenPieceRecord & { deal_fen?: string };
        assert.ok(record.deal_fen, 'a site game carries its deal');
        assert.equal(replayHiddenPieceRecord(record).ok, true);
      } else {
        const parsed = parseHiddenPiecePgn(text);
        assert.ok(parsed.ok);
        assert.ok(parsed.tags.DealFEN);
        assert.equal(replayHiddenPieceRecord(parsed.record).ok, true);
      }
    }
    // The current month (real clock) is never offered.
    const now = new Date();
    const current = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    assert.equal((await request(`/api/data/monthly/${current}/xiangqi.jsonl.gz`)).status, 404);
    assert.deepEqual(
      (await listStoredDataFiles()).map((file) => file.key),
      [
        'collections/test-match-2026-08.jsonl.gz',
        'monthly/2026-08/banqi.jsonl.gz',
        'monthly/2026-08/banqi.pgn.gz',
      ],
    );
  });

  // Migration 154 rebuilt September's all-variants file and Cloudflare kept
  // serving the old bytes, because the plain URL was marked immutable. Now only
  // a hashed URL is, and a rebuilt file's old hash answers 404, never old bytes.
  test('a rebuilt file gets a new URL, and the old hashed URL stops serving', async () => {
    await seedMonth();
    resetDataDownloadLimiterForTests();
    clearDataListingCache();
    const plain = '/api/data/monthly/2026-08/xiangqi.jsonl.gz';
    const first = await download(plain);
    assert.equal(first.status, 200);

    // The listing now links the build itself.
    clearDataListingCache();
    const listing = await loadDataListing(new Date('2026-09-15T00:00:00Z'));
    const xiangqi = listing.months[0]?.variants.find((entry) => entry.variant === 'xiangqi');
    const jsonl = xiangqi?.files.find((file) => file.format === 'jsonl');
    const pgn = xiangqi?.files.find((file) => file.format === 'pgn');
    assert.equal(jsonl?.path, first.location);
    assert.equal(pgn?.path, '/api/data/monthly/2026-08/xiangqi.pgn.gz', 'unbuilt: the plain URL');

    // A revalidation of the hashed URL is a 304 with the same immutable headers.
    const revalidated = await request(first.location, {
      'if-none-match': `"${first.headers['x-mistboard-sha256']}"`,
    });
    assert.equal(revalidated.status, 304);
    assert.equal(revalidated.headers['cache-control'], 'public, max-age=31536000, immutable');

    // Rebuild with different contents (what a migration does): delete the row,
    // drop a game, and ask again.
    await sqlQuery(
      `DELETE FROM game_data_files WHERE file_key = 'monthly/2026-08/xiangqi.jsonl.gz'`,
    );
    await sqlQuery(`UPDATE games SET visibility = 'private' WHERE room_id = 'xq_data_b'`);
    const second = await download(plain);
    assert.equal(second.status, 200);
    assert.notEqual(second.location, first.location);
    assert.equal(gunzipSync(second.body).toString('utf8').trimEnd().split('\n').length, 1);

    const stale = await request(first.location);
    assert.equal(stale.status, 404);
    assert.equal(stale.headers['cache-control'], 'no-store');
    assert.deepEqual(JSON.parse(stale.body.toString('utf8')), {
      error: 'stale_hash',
      current: second.location,
    });
    // A hash for a file never built is a 404 too, and not cached.
    const never = await request('/api/data/monthly/2026-08/jungle.0123456789ab.jsonl.gz');
    assert.equal(never.status, 404);
    assert.deepEqual(JSON.parse(never.body.toString('utf8')), { error: 'not_built' });
  });

  test('a query string on a file URL is refused, so it cannot mint a second cached copy', async () => {
    await seedMonth();
    resetDataDownloadLimiterForTests();
    const plain = await request('/api/data/monthly/2026-08/xiangqi.jsonl.gz?v=2');
    assert.equal(plain.status, 400);
    assert.deepEqual(JSON.parse(plain.body.toString('utf8')), { error: 'unexpected_query' });
    const first = await download('/api/data/monthly/2026-08/xiangqi.jsonl.gz');
    const hashed = await request(`${first.location}?cachebust=1`);
    assert.equal(hashed.status, 400);
    assert.equal(hashed.headers['cache-control'], 'no-store');
  });
});
