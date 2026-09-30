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
import { writeImportedEngineMatchGame } from './import-engine-match.js';
import {
  getGameSummary,
  getPublicSiteStats,
  listEngineVersionStats,
  listRecentPublicGames,
  listWatchUnlockedGames,
} from './persistence.js';
import { withTransaction } from './persistence-db.js';
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

function builtGames(): ImportedEngineMatchGame[] {
  const rows = parseEnrichedMatchJsonl(
    readFileSync(join(FIXTURES, 'run7-sample.enriched.jsonl'), 'utf8'),
  );
  return rows.map((row) => {
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
