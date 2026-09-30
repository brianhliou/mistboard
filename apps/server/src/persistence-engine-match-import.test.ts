import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildImportedJieqiGame,
  ENGINE_MATCH_EVALS_ARTIFACT,
  type EngineMatchManifest,
  type ImportedEngineMatchGame,
  parseEnrichedMatchJsonl,
} from './engine-match-import.js';
import { guardPoolConnectionErrors, writeImportedEngineMatchGame } from './import-engine-match.js';
import {
  getGameSummary,
  getPublicSiteStats,
  listEngineVersionStats,
  listRecentPublicGames,
  listWatchUnlockedGames,
} from './persistence.js';
import { getPool, withTransaction } from './persistence-db.js';
import {
  assert,
  definePersistenceTests,
  pg,
  TEST_DATABASE_URL,
  test,
} from './persistence-test-support.js';
import { jieqiPostgameForApi } from './routes/jieqi-games.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', 'src', 'fixtures', 'engine-match');
const MANIFEST = JSON.parse(
  readFileSync(join(FIXTURES, 'run7-sample.match.json'), 'utf8'),
) as EngineMatchManifest;

// `withoutMovetime` builds the games as the first import wrote them, before
// the origin carried the lab's think time.
function builtGames({ withoutMovetime = false } = {}): ImportedEngineMatchGame[] {
  const rows = parseEnrichedMatchJsonl(
    readFileSync(join(FIXTURES, 'run7-sample.enriched.jsonl'), 'utf8'),
  );
  return rows.map((row) => {
    if (withoutMovetime) delete row.movetime;
    const result = buildImportedJieqiGame(MANIFEST, row, 400);
    if (!result.ok) throw new Error(result.error);
    return result.value;
  });
}

async function writeAll(games: ImportedEngineMatchGame[], replace = false) {
  const outcomes: string[] = [];
  for (const game of games) {
    const { outcome } = await withTransaction((client) =>
      writeImportedEngineMatchGame(client, game, { replace }),
    );
    outcomes.push(outcome);
  }
  return outcomes;
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{ n: string }>(sql, params);
    return Number(rows[0]?.n ?? 0);
  } finally {
    await client.end();
  }
}

definePersistenceTests('engine match import', () => {
  test('persistence engine match import writes finished jieqi games the review page replays', async () => {
    const games = builtGames();
    assert.deepEqual(await writeAll(games), ['imported', 'imported', 'imported']);

    for (const game of games) {
      const summary = await getGameSummary(game.roomId);
      assert.equal(summary?.mode, 'imported');
      assert.equal(summary?.corpusId, MANIFEST.slug);
      assert.equal(summary?.rated, false);
      assert.deepEqual(
        summary?.participants.map((p) => [p.color, p.displayName, p.subjectType]),
        [
          ['red', game.summary.whiteName, 'imported'],
          ['black', game.summary.blackName, 'imported'],
        ],
      );
      const payload = await jieqiPostgameForApi(game.roomId);
      assert.ok(payload, game.roomId);
      assert.equal(payload.state.status.type, 'finished');
      assert.equal(
        payload.timeline.filter((entry) => entry.type === 'move-played').length,
        game.summary.plyCount,
      );
    }
    assert.equal(
      await count(`SELECT count(*) AS n FROM game_debug_artifacts WHERE artifact_type = $1`, [
        ENGINE_MATCH_EVALS_ARTIFACT,
      ]),
      3,
    );
    assert.equal(
      await count(`SELECT count(*) AS n FROM games WHERE corpus_id = $1`, [MANIFEST.slug]),
      3,
    );
  });

  test('persistence engine match import is idempotent and never overwrites another game', async () => {
    const games = builtGames();
    await writeAll(games);
    const eventsBefore = await count(`SELECT count(*) AS n FROM events`);
    assert.deepEqual(await writeAll(games), ['unchanged', 'unchanged', 'unchanged']);
    assert.equal(await count(`SELECT count(*) AS n FROM events`), eventsBefore);
    assert.deepEqual(await writeAll(games, true), ['replaced', 'replaced', 'replaced']);
    assert.equal(await count(`SELECT count(*) AS n FROM events`), eventsBefore);
    assert.equal(await count(`SELECT count(*) AS n FROM game_debug_artifacts`), 3);

    // A room id held by a game that is not this match's import is never touched.
    const game = games[0]!;
    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query(`UPDATE games SET mode = 'pvp' WHERE room_id = $1`, [game.roomId]);
    } finally {
      await client.end();
    }
    const { outcome } = await withTransaction((c) =>
      writeImportedEngineMatchGame(c, game, { replace: true }),
    );
    assert.equal(outcome, 'conflict');
    assert.equal(
      await count(`SELECT count(*) AS n FROM games WHERE room_id = $1 AND mode = 'pvp'`, [
        game.roomId,
      ]),
      1,
    );
  });

  test('persistence engine match import --replace adds the movetime to games imported without it', async () => {
    assert.deepEqual(await writeAll(builtGames({ withoutMovetime: true })), [
      'imported',
      'imported',
      'imported',
    ]);
    const games = builtGames();
    const origins = async () => {
      const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
      await client.connect();
      try {
        const { rows } = await client.query<{ movetime: number | null }>(
          `SELECT (payload->'origin'->>'movetimeMs')::int AS movetime FROM events
            WHERE seq = 0 AND room_id = ANY($1) ORDER BY room_id`,
          [games.map((game) => game.roomId)],
        );
        return rows.map((row) => row.movetime);
      } finally {
        await client.end();
      }
    };
    assert.deepEqual(await origins(), [null, null, null]);

    // A plain re-run sees the stored games differ and leaves them alone.
    const plain = [];
    for (const game of games) {
      plain.push(await withTransaction((c) => writeImportedEngineMatchGame(c, game)));
    }
    assert.deepEqual(
      plain.map((r) => [r.outcome, r.detail]),
      games.map(() => ['conflict', 'differs from the stored game (use --replace)']),
    );
    assert.deepEqual(await origins(), [null, null, null]);

    assert.deepEqual(await writeAll(games, true), ['replaced', 'replaced', 'replaced']);
    assert.deepEqual(await origins(), [4000, 4000, 4000]);
    const payload = await jieqiPostgameForApi(games[0]!.roomId);
    assert.equal(payload?.game.origin?.movetimeMs, 4000);
    assert.deepEqual(await writeAll(games), ['unchanged', 'unchanged', 'unchanged']);
  });

  test('persistence engine match import survives its idle connection being dropped', async () => {
    const warnings: string[] = [];
    const detach = guardPoolConnectionErrors(getPool(), (message) => warnings.push(message));
    try {
      const pid = await withTransaction(async (c) => {
        const { rows } = await c.query<{ pid: number }>(`SELECT pg_backend_pid() AS pid`);
        return rows[0]!.pid;
      });
      // The client is idle in the pool now; end its session from outside, as a
      // remote database or proxy closing the connection would. Without the
      // guard the pool re-emits the error with no listener and the process dies.
      const killer = new pg.Client({ connectionString: TEST_DATABASE_URL });
      await killer.connect();
      try {
        await killer.query(`SELECT pg_terminate_backend($1)`, [pid]);
      } finally {
        await killer.end();
      }
      for (let i = 0; i < 50 && warnings.length === 0; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(warnings.length, 1);
      assert.match(warnings[0]!, /idle connection closed \(terminating connection/);
      // The pool dropped that client; the next game connects afresh.
      assert.deepEqual(await writeAll(builtGames().slice(0, 1)), ['imported']);
    } finally {
      detach();
    }
  });

  test('persistence engine match import --replace never touches another match import', async () => {
    const games = builtGames();
    await writeAll(games);
    // Same room id, but filed under a different match: an import, not ours.
    const game = games[1]!;
    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query(
        `UPDATE games SET corpus_id = 'another-match-2026-09' WHERE room_id = $1`,
        [game.roomId],
      );
    } finally {
      await client.end();
    }
    const eventsBefore = await count(`SELECT count(*) AS n FROM events WHERE room_id = $1`, [
      game.roomId,
    ]);
    const { outcome, detail } = await withTransaction((c) =>
      writeImportedEngineMatchGame(c, game, { replace: true }),
    );
    assert.equal(outcome, 'conflict');
    assert.match(detail ?? '', /another-match-2026-09/);
    assert.equal(
      await count(`SELECT count(*) AS n FROM games WHERE room_id = $1 AND corpus_id = $2`, [
        game.roomId,
        'another-match-2026-09',
      ]),
      1,
    );
    assert.equal(
      await count(`SELECT count(*) AS n FROM events WHERE room_id = $1`, [game.roomId]),
      eventsBefore,
    );
  });

  test('persistence engine match import stays out of counts, feeds and engine records', async () => {
    const games = builtGames();
    await writeAll(games);
    // The games sit on 2026-09-30; read every surface from just after.
    const now = new Date('2026-09-30T20:00:00Z');

    const stats = await getPublicSiteStats({ now });
    assert.equal(stats.totalCompletedGames, 0);
    assert.equal(stats.last30dCompletedGames, 0);

    assert.deepEqual(await listRecentPublicGames(50), []);
    assert.deepEqual(await listWatchUnlockedGames({ now }), []);
    assert.deepEqual(await listWatchUnlockedGames({ now, modes: ['eve'] }), []);
    assert.deepEqual(await listEngineVersionStats(), []);
    assert.equal(await count(`SELECT count(*) AS n FROM user_ratings`), 0);
  });
});
