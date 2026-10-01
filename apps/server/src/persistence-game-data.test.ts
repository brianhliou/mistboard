import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import './variant-tenant/register-tenants.js';
import { banqiTenant } from './banqi-tenant.js';
import { ensureDataFile } from './game-data-files.js';
import { resolveGameExport } from './game-export-tenant.js';
import {
  appendRoomEvent,
  getGameSummaries,
  getGameSummary,
  loadRoom,
  loadRoomsEvents,
  recordGameEnd,
} from './persistence.js';
import {
  getStoredDataFile,
  insertDataFileIfAbsent,
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
// biome-ignore lint/suspicious/noExplicitAny: test harness over two tenants with opaque types.
const TENANTS: Record<'xiangqi' | 'banqi', any> = { xiangqi: xiangqiTenant, banqi: banqiTenant };

type SeedOptions = {
  mode?: 'pvp' | 'pve' | 'imported';
  visibility?: 'public' | 'private' | 'link' | 'unlisted';
  endedAt: string;
  userId?: string;
  corpusId?: string | null;
  origin?: Record<string, unknown>;
  variant?: 'xiangqi' | 'banqi';
};

// A finished game from the committed fixture, under a new room id (the xq_ /
// bq_ prefix is what routes its export to the tenant).
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
  await seedXiangqiGame('bq_data_c', { endedAt: '2026-08-15T12:00:00Z', variant: 'banqi' });
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

type CapturedResponse = { status: number; headers: Record<string, string>; body: Buffer };

async function request(pathname: string): Promise<CapturedResponse> {
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
  const req = {
    method: 'GET',
    url: pathname,
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage;
  const handled = await tryHandle({} as HttpApiContext, req, response, pathname);
  assert.equal(handled, true, pathname);
  return captured;
}

definePersistenceTests('game data files', () => {
  test('the listing counts closed months only, without the excluded games', async () => {
    await seedMonth();
    clearDataListingCache();
    const listing = await loadDataListing(new Date('2026-09-15T00:00:00Z'));
    // Only the two counted August games: the operator's game, the private one,
    // the imported one and the aborted one are out, and September is open.
    assert.deepEqual(
      listing.months.map((month) => [month.month, month.variants.map((v) => [v.variant, v.games])]),
      [
        [
          '2026-08',
          [
            ['xiangqi', 2],
            ['banqi', 1],
          ],
        ],
      ],
    );
    // The all-variants file of the month counts both.
    assert.deepEqual(
      listing.months[0]?.files.map((file) => [file.path, file.games]),
      [['/api/data/monthly/2026-08/all.jsonl.gz', 3]],
    );
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
      request('/api/data/monthly/2026-08/xiangqi.jsonl.gz'),
      request('/api/data/monthly/2026-08/xiangqi.jsonl.gz'),
    ]);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.ok(first.body.equals(second.body));
    assert.equal(first.headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.equal(first.headers['x-mistboard-games'], '2');
    const stored = await listStoredDataFiles();
    assert.deepEqual(
      stored.map((file) => file.key),
      ['monthly/2026-08/xiangqi.jsonl.gz'],
    );
    assert.equal(first.headers['x-mistboard-sha256'], stored[0]?.sha256);
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
      request('/api/data/monthly/2026-08/all.jsonl.gz'),
      request('/api/data/monthly/2026-08/all.jsonl.gz'),
    ]);
    assert.equal(first.status, 200);
    assert.ok(first.body.equals(second.body));
    const games = gunzipSync(first.body)
      .toString('utf8')
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line) as { game_id: string; variant: string });
    // Oldest first across variants; the operator, private, imported and
    // aborted games stay out, and the open month's game is not here.
    assert.deepEqual(
      games.map((game) => [game.game_id, game.variant]),
      [
        ['xq_data_a', 'xiangqi'],
        ['bq_data_c', 'banqi'],
        ['xq_data_b', 'xiangqi'],
      ],
    );
    // Each line is still that game's single export.
    const single = resolveGameExport({
      roomId: 'bq_data_c',
      format: 'json',
      summary: await getGameSummary('bq_data_c'),
      events: await loadRoom('bq_data_c'),
    });
    assert.equal(single.status === 200 && single.body, JSON.stringify(games[1]));
    assert.deepEqual(
      (await listStoredDataFiles()).map((file) => [file.key, file.gameCount]),
      [['monthly/2026-08/all.jsonl.gz', 3]],
    );
    // JSONL only: no mixed PGN.
    assert.equal((await request('/api/data/monthly/2026-08/all.pgn.gz')).status, 404);
  });

  test('the collection downloads with its origin, and unknown files fail closed', async () => {
    await seedMonth();
    resetDataDownloadLimiterForTests();
    const collection = await request('/api/data/collections/test-match-2026-08.jsonl.gz');
    assert.equal(collection.status, 200);
    const [line] = gunzipSync(collection.body).toString('utf8').trimEnd().split('\n');
    const game = JSON.parse(line!) as { game_id: string; mode: string; origin?: { event: string } };
    assert.equal(game.game_id, 'xq_data_imported');
    assert.equal(game.mode, 'imported');
    assert.equal(game.origin?.event, 'Test Engine vs Other Engine · 2026-08');

    assert.equal((await request('/api/data/collections/no-such-match.jsonl.gz')).status, 404);
    assert.equal((await request('/api/data/monthly/2026-13/xiangqi.jsonl.gz')).status, 400);
    assert.equal((await request('/api/data/monthly/2026-08/mahjong.jsonl.gz')).status, 404);
    assert.equal((await request('/api/data/monthly/2026-08/jieqi.jsonl.gz')).status, 404);
    // The current month (real clock) is never offered.
    const now = new Date();
    const current = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    assert.equal((await request(`/api/data/monthly/${current}/xiangqi.jsonl.gz`)).status, 404);
    assert.deepEqual(
      (await listStoredDataFiles()).map((file) => file.key),
      ['collections/test-match-2026-08.jsonl.gz'],
    );
  });
});
