// #488: the bot-vs-bot scheduler's games are public data, in their own places
// (the Engine games source of /games/search, the engine-game files of /data)
// and in no human one. End to end against the test database: a real scheduler
// tick queues a jieqi game between the two random movers (no engine binary
// needed), the real worker runner plays it, and every surface is read back.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { gunzipSync } from 'node:zlib';
import {
  type HiddenPieceRecord,
  parseHiddenPiecePgn,
  replayHiddenPieceRecord,
} from '@mistboard/game';
import './variant-tenant/register-tenants.js';
import {
  type BotVsBotVariantPlan,
  botVsBotConfigFromEnv,
  botVsBotLiveDeps,
  createBotVsBotScheduler,
} from './bot-vs-bot-scheduler.js';
import {
  claimNextEngineGameTask,
  createEngineGameTask,
  createExperimentJob,
  registerWorkerRun,
} from './engine-experiments.js';
import { upsertBuiltinEngineVersions } from './engine-registry.js';
import { runRandomLegalEngineGame } from './engine-runner.js';
import { JIEQI_RANDOM_ENGINE_ID } from './jieqi-engine.js';
import { seededUnitRng } from './jieqi-eve-adapter.js';
import { getPool } from './persistence-db.js';
import { generateMistboardReadout } from './persistence-mistboard-readout.js';
import { getPublicSiteStats } from './persistence-site-stats.js';
import { assert, definePersistenceTests, test } from './persistence-test-support.js';
import {
  clearDataListingCache,
  tryHandle as dataRoute,
  loadDataListing,
  resetDataDownloadLimiterForTests,
} from './routes/data.js';
import { tryHandle as searchRoute } from './routes/historical-xiangqi-games.js';
import type { HttpApiContext } from './routes/lib.js';
import type { AnyVariantEveAdapter } from './variant-eve.js';
import { eveAdapterFor } from './variant-eve-registry.js';
import { replayTenantEvents } from './variant-tenant/runtime.js';

// Played in August so the month is closed on any clock after it.
const ENDED_AT = '2026-08-20T12:00:00Z';
const READOUT_NOW = new Date('2026-08-24T17:23:00Z'); // its week holds 08-20

const JIEQI_RANDOM_PLAN: BotVsBotVariantPlan = {
  variant: 'jieqi',
  targetActive: 1,
  // High enough that a random game ends on the board (mate, stalemate, the
  // no-capture clock: under 800 plies in 40 seeded runs), so it exports.
  maxPlies: 4000,
  calibrationRatio: 0,
  dailyMax: 2,
  ladder: [JIEQI_RANDOM_ENGINE_ID, JIEQI_RANDOM_ENGINE_ID],
  anchorEngineId: JIEQI_RANDOM_ENGINE_ID,
  requiredCapability: null,
  // The two random movers: the game plays without any engine binary.
  forcedPairing: { redEngineId: JIEQI_RANDOM_ENGINE_ID, blackEngineId: JIEQI_RANDOM_ENGINE_ID },
};

let workerSeq = 0;

// Claim the next queued task and play it the way the engine-worker does.
async function playNextTask(
  capabilities: Record<string, boolean> = { banqi_engine: true, jungle_engine: true },
): Promise<string> {
  workerSeq += 1;
  const worker = await registerWorkerRun(getPool(), {
    id: `worker-eve-public-${workerSeq}`,
    provider: 'local',
  });
  const task = await claimNextEngineGameTask(getPool(), {
    workerRunId: worker.id,
    workerId: 'test-worker',
    provider: 'local',
    capabilities: { engine_games: true, ...capabilities },
  });
  assert.ok(task, 'a queued task');
  const result = await runRandomLegalEngineGame(getPool(), task);
  assert.equal(result.status, 'completed');
  await getPool().query(
    `UPDATE games SET started_at = $2::timestamptz - INTERVAL '5 minutes', ended_at = $2
     WHERE room_id = $1`,
    [result.gameId, ENDED_AT],
  );
  return result.gameId;
}

// One scheduler tick with the live database deps and the random-mover plan.
async function scheduleOne(plans: BotVsBotVariantPlan[] = [JIEQI_RANDOM_PLAN]): Promise<void> {
  const scheduler = createBotVsBotScheduler({
    ...botVsBotLiveDeps,
    enabled: () => true,
    config: () => ({ plans, skipped: [] }),
    log: () => undefined,
  });
  await scheduler.tick();
}

// The real default plans for banqi and jungle (their own ladders, capabilities
// and no anchor), as the scheduler builds them from the environment.
function defaultPlan(variant: string): BotVsBotVariantPlan {
  const plan = botVsBotConfigFromEnv({} as NodeJS.ProcessEnv).plans.find(
    (entry) => entry.variant === variant,
  );
  assert.ok(plan, variant);
  return { ...plan, maxPlies: 3000 };
}

// Swap the adapter's engine call for a seeded random legal move for the length of
// fn: the real scheduler, worker claim, runner and rows, without a minute of
// binary search per ply. The real binaries are exercised in
// data-only-eve-adapters.test.ts.
async function withStubEngine<T>(adapter: AnyVariantEveAdapter, fn: () => Promise<T>): Promise<T> {
  const search = adapter.search;
  const available = adapter.available;
  const rng = seededUnitRng(20261001n);
  adapter.available = () => true;
  adapter.search = async (_engineId, _history, _opts, context) => {
    const state = replayTenantEvents(adapter.tenant, context.events as never[]).state;
    const legal = adapter.legalMoves(state);
    return { best: adapter.moveToUci(legal[Math.floor(rng() * legal.length)]) };
  };
  try {
    return await fn();
  } finally {
    adapter.search = search;
    adapter.available = available;
  }
}

// A lab bake-off import: mode 'eve' and public (import-bakeoff-run.ts's
// default), but no scheduler job behind it. It must stay out of every engine
// game surface.
async function insertBakeoffGame(): Promise<void> {
  await getPool().query(
    `INSERT INTO games (room_id, variant, result, termination, ply_count, started_at, ended_at,
       mode, status, visibility)
     VALUES ('jq_bakeoff_public', 'jieqi', 'red-wins', 'checkmate', 40,
       '2026-08-22T12:00:00Z', '2026-08-22T13:00:00Z', 'eve', 'completed', 'public')`,
  );
}

// A rating-tournament game: the same runner, a task that asks for nothing.
async function playTournamentGame(): Promise<string> {
  await upsertBuiltinEngineVersions(getPool(), [JIEQI_RANDOM_ENGINE_ID]);
  const job = await createExperimentJob(getPool(), {
    purpose: 'calibration',
    targetGames: 1,
    config: { variant: 'jieqi', tournament_id: 'test-tournament' },
  });
  await createEngineGameTask(getPool(), {
    jobId: job.id,
    gameIndex: 0,
    whiteEngineId: JIEQI_RANDOM_ENGINE_ID,
    blackEngineId: JIEQI_RANDOM_ENGINE_ID,
    seed: 7,
    timeControl: { kind: 'none' },
    openingPolicy: { kind: 'standard', seed: '7' },
    config: {
      variant: 'jieqi',
      max_plies: 16,
      white_engine_id: JIEQI_RANDOM_ENGINE_ID,
      black_engine_id: JIEQI_RANDOM_ENGINE_ID,
    },
  });
  return playNextTask();
}

type Captured = { status: number; headers: Record<string, string>; body: Buffer };

type Route = (
  ctx: HttpApiContext,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  parsedUrl: URL,
) => Promise<boolean>;

async function request(route: Route, pathname: string, search = ''): Promise<Captured> {
  const captured: Captured = { status: 0, headers: {}, body: Buffer.alloc(0) };
  const response = {
    writeHead(status: number, headers: Record<string, string> = {}) {
      captured.status = status;
      captured.headers = headers;
      return this;
    },
    setHeader() {},
    end(chunk?: string | Buffer) {
      if (chunk !== undefined) captured.body = Buffer.from(chunk);
    },
  } as unknown as ServerResponse;
  const url = new URL(`http://localhost${pathname}${search}`);
  const req = {
    method: 'GET',
    url: `${pathname}${search}`,
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage;
  const handled = await route({} as HttpApiContext, req, response, url.pathname, url);
  assert.equal(handled, true, pathname);
  return captured;
}

async function download(pathname: string): Promise<Captured> {
  const redirect = await request(dataRoute, pathname);
  assert.equal(redirect.status, 302, `${pathname}: ${redirect.body.toString('utf8')}`);
  return request(dataRoute, redirect.headers.location!);
}

async function withJieqiLaunched<T>(fn: () => Promise<T>): Promise<T> {
  const previous = process.env.MISTBOARD_JIEQI_ENABLED;
  process.env.MISTBOARD_JIEQI_ENABLED = 'true';
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.MISTBOARD_JIEQI_ENABLED;
    else process.env.MISTBOARD_JIEQI_ENABLED = previous;
  }
}

definePersistenceTests('scheduled engine games as public data', () => {
  test('a scheduled game is public, dealt, and paces its own variant only', async () => {
    await scheduleOne();
    const gameId = await playNextTask();
    const { rows } = await getPool().query<{
      mode: string;
      visibility: string;
      variant: string;
      rated: boolean;
    }>(`SELECT mode, visibility, variant, rated FROM games WHERE room_id = $1`, [gameId]);
    assert.deepEqual(rows, [{ mode: 'eve', visibility: 'public', variant: 'jieqi', rated: false }]);

    // The daily cadence is per variant: jieqi just played, xiangqi never has.
    assert.ok((await botVsBotLiveDeps.lastSuccessAt('jieqi')) !== null);
    assert.equal(await botVsBotLiveDeps.lastSuccessAt('xiangqi'), null);
    assert.equal(await botVsBotLiveDeps.lastEnqueueAt('xiangqi'), null);
    // So the next tick inside the 12 h window queues nothing more for jieqi.
    await getPool().query(`UPDATE games SET ended_at = now() WHERE room_id = $1`, [gameId]);
    await scheduleOne();
    const { rows: tasks } = await getPool().query(`SELECT id FROM engine_game_tasks`);
    assert.equal(tasks.length, 1);
  });

  test('a rating-tournament game stays link', async () => {
    const tournament = await playTournamentGame();
    const { rows } = await getPool().query<{ visibility: string }>(
      `SELECT visibility FROM games WHERE room_id = $1`,
      [tournament],
    );
    assert.deepEqual(rows, [{ visibility: 'link' }]);
  });

  test('engine games never enter a human count, readout or rating', async () => {
    await scheduleOne();
    await playNextTask();

    // Public /stats: the counted-game filter (persistence-counted-games.ts).
    const stats = await getPublicSiteStats({ now: new Date('2026-09-01T00:00:00Z') });
    assert.equal(stats.totalCompletedGames, 0);
    assert.equal(stats.publicGames, 0, 'public, but not a human game');

    // The readout's headline numbers.
    const { report } = await generateMistboardReadout({
      trigger: 'manual',
      now: READOUT_NOW,
      dryRun: true,
      runtime: {
        revision: null,
        activeGames: 0,
        databaseRequired: true,
        persistence: 'enabled',
        persistenceErrors: { count1m: 0, lastAt: null },
      },
      db: getPool(),
    });
    assert.equal(report.product?.completedGames, 0);
    assert.equal(report.product?.humanPlayers, 0);
    assert.deepEqual(report.product?.completedGamesByVariant, []);

    // Ratings: nothing rated, no rating row written.
    const { rows } = await getPool().query<{ n: number }>(
      `SELECT count(*)::int AS n FROM user_ratings`,
    );
    assert.equal(rows[0]?.n, 0);
  });

  test('/data lists engine games in their own months and files, never the human ones', async () => {
    await scheduleOne();
    const gameId = await playNextTask();
    // The tournament game is not public: in no file. Nor is a public bake-off.
    await playTournamentGame();
    await insertBakeoffGame();
    // A scheduled game stopped at its ply cap has no finished log: in no file.
    await getPool().query(
      `INSERT INTO games (room_id, variant, result, termination, ply_count, started_at, ended_at,
         mode, status, visibility, rated)
       VALUES ('jq_eve_truncated', 'jieqi', 'draw', 'truncated', 300,
         '2026-08-21T12:00:00Z', '2026-08-21T13:00:00Z', 'eve', 'completed', 'public', false)`,
    );
    clearDataListingCache();
    resetDataDownloadLimiterForTests();

    const listing = await loadDataListing(new Date('2026-09-15T00:00:00Z'));
    assert.deepEqual(listing.months, []);
    assert.deepEqual(
      listing.engineMonths.map((month) => [
        month.month,
        month.games,
        month.variants.map((v) => [v.variant, v.games]),
      ]),
      [['2026-08', 1, [['jieqi', 1]]]],
    );

    // The human files of that month do not exist.
    for (const path of [
      '/api/data/monthly/2026-08/jieqi.jsonl.gz',
      '/api/data/monthly/2026-08/all.jsonl.gz',
    ]) {
      assert.equal((await request(dataRoute, path)).status, 404, path);
    }

    // The engine file holds the game, dealt (#484 format), and it replays.
    const file = await download('/api/data/engine-monthly/2026-08/jieqi.jsonl.gz');
    assert.equal(file.status, 200);
    assert.equal(
      file.headers['content-disposition'],
      'attachment; filename="mistboard_engine_jieqi_2026-08.jsonl.gz"',
    );
    const lines = gunzipSync(file.body).toString('utf8').trimEnd().split('\n');
    assert.equal(lines.length, 1);
    const record = JSON.parse(lines[0]!) as HiddenPieceRecord & {
      game_id: string;
      mode: string;
      deal_fen?: string;
    };
    assert.equal(record.game_id, gameId);
    assert.equal(record.mode, 'eve');
    assert.ok(record.deal_fen, 'a server deal is exported');
    assert.equal(replayHiddenPieceRecord(record).ok, true);

    const all = await download('/api/data/engine-monthly/2026-08/all.jsonl.gz');
    assert.equal(gunzipSync(all.body).toString('utf8').trimEnd().split('\n').length, 1);
  });

  test('/games/search: an Engine games source, off in the mixed feed', async () => {
    await scheduleOne();
    const gameId = await playNextTask();
    await playTournamentGame();
    await insertBakeoffGame();
    await withJieqiLaunched(async () => {
      const read = async (search: string) => {
        const response = await request(searchRoute, '/api/historical-xiangqi/games', search);
        assert.equal(response.status, 200, response.body.toString('utf8'));
        return JSON.parse(response.body.toString('utf8')) as {
          games: Array<{ id: string; kind: string; sourceSlug: string; variant: string }>;
          total: number;
        };
      };
      // Not in the default feed, nor in the games played here.
      assert.equal((await read('?variant=jieqi')).total, 0);
      assert.equal((await read('?variant=jieqi&source=mistboard')).total, 0);
      // Asked for: the public scheduled game only, never the tournament one or
      // the public bake-off import.
      const engine = await read('?variant=jieqi&source=engine-game');
      assert.deepEqual(
        engine.games.map((game) => [game.id, game.kind, game.sourceSlug, game.variant]),
        [[gameId, 'engine-game', 'engine-game', 'jieqi']],
      );
      assert.equal(engine.total, 1);
      // Nor is it an imported engine match.
      assert.equal((await read('?variant=jieqi&source=engine-match')).total, 0);
    });
  });

  test('banqi and jungle: queued for a worker with the binary, played, public, in files and search', async () => {
    const banqi = eveAdapterFor('banqi')!;
    const jungle = eveAdapterFor('jungle')!;
    await withStubEngine(banqi, () =>
      withStubEngine(jungle, async () => {
        await scheduleOne([defaultPlan('banqi'), defaultPlan('jungle')]);
        // A worker without the binaries claims neither: the games wait.
        workerSeq += 1;
        const bare = await registerWorkerRun(getPool(), {
          id: `worker-eve-bare-${workerSeq}`,
          provider: 'local',
        });
        const none = await claimNextEngineGameTask(getPool(), {
          workerRunId: bare.id,
          workerId: 'bare-worker',
          provider: 'local',
          capabilities: { engine_games: true },
        });
        assert.equal(none, null);
        const played = [await playNextTask(), await playNextTask()];
        const { rows } = await getPool().query<{
          room_id: string;
          variant: string;
          visibility: string;
          rated: boolean;
          white_name: string;
          black_name: string;
        }>(
          `SELECT room_id, variant, visibility, rated, white_name, black_name FROM games
           WHERE room_id = ANY($1) ORDER BY variant`,
          [played],
        );
        assert.deepEqual(
          rows.map((row) => [row.variant, row.visibility, row.rated]),
          [
            ['banqi', 'public', false],
            ['jungle', 'public', false],
          ],
        );
        // Banqi is MistyBanqi against itself.
        assert.deepEqual([rows[0]!.white_name, rows[0]!.black_name], ['MistyBanqi', 'MistyBanqi']);
        // No job of either carries a rating_policy: nothing reaches the Elo report.
        const { rows: jobs } = await getPool().query<{ n: number }>(
          `SELECT count(*)::int AS n FROM eve_jobs WHERE config ? 'rating_policy'`,
        );
        assert.equal(jobs[0]?.n, 0);
      }),
    );

    clearDataListingCache();
    resetDataDownloadLimiterForTests();
    const listing = await loadDataListing(new Date('2026-09-15T00:00:00Z'));
    assert.deepEqual(
      listing.engineMonths[0]?.variants.map((v) => [v.variant, v.games]),
      [
        ['banqi', 1],
        ['jungle', 1],
      ],
    );
    // Banqi replays from the download alone, in both formats (#484).
    const jsonl = await download('/api/data/engine-monthly/2026-08/banqi.jsonl.gz');
    const record = JSON.parse(
      gunzipSync(jsonl.body).toString('utf8').trim(),
    ) as HiddenPieceRecord & {
      deal_fen?: string;
      mode: string;
    };
    assert.equal(record.mode, 'eve');
    assert.ok(record.deal_fen, 'banqi engine games carry their deal');
    assert.equal(replayHiddenPieceRecord(record).ok, true);
    const pgn = await download('/api/data/engine-monthly/2026-08/banqi.pgn.gz');
    const parsed = parseHiddenPiecePgn(gunzipSync(pgn.body).toString('utf8'));
    assert.ok(parsed.ok);
    assert.equal(replayHiddenPieceRecord(parsed.record).ok, true);
    assert.equal((await download('/api/data/engine-monthly/2026-08/jungle.jsonl.gz')).status, 200);

    // Both are in the Engine games source.
    const previous = {
      banqi: process.env.MISTBOARD_BANQI_ENABLED,
      jungle: process.env.MISTBOARD_JUNGLE_ENABLED,
    };
    process.env.MISTBOARD_BANQI_ENABLED = 'true';
    process.env.MISTBOARD_JUNGLE_ENABLED = 'true';
    try {
      for (const variant of ['banqi', 'jungle']) {
        const response = await request(
          searchRoute,
          '/api/historical-xiangqi/games',
          `?variant=${variant}&source=engine-game`,
        );
        assert.equal(response.status, 200, response.body.toString('utf8'));
        const body = JSON.parse(response.body.toString('utf8')) as { total: number };
        assert.equal(body.total, 1, variant);
      }
    } finally {
      for (const [key, value] of [
        ['MISTBOARD_BANQI_ENABLED', previous.banqi],
        ['MISTBOARD_JUNGLE_ENABLED', previous.jungle],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
