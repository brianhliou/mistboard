import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test, { type TestContext } from 'node:test';
import type { XiangqiPuzzle } from '@mistboard/game';
import { loadSeedPuzzleRegistry, seedPuzzleContentHash } from '@mistboard/game/puzzle-seed';
import type pg from 'pg';
import { close, getPool, init } from './persistence-db.js';
import { recordPuzzleQualityEvent } from './persistence-puzzle-quality.js';
import { recordPuzzleAttempt } from './persistence-puzzle-ratings.js';
import { seedPuzzleRating } from './puzzle-rating.js';
import { resetPuzzleStoreForTests } from './puzzle-store.js';
import type { HttpApiContext } from './routes/lib.js';
import { tryHandle } from './routes/puzzles.js';

const failedAt = new Date('2026-10-26T12:00:00Z');
const repairedAt = new Date('2026-10-27T12:00:00Z');
const puzzle = (loadSeedPuzzleRegistry('xiangqi') as readonly XiangqiPuzzle[]).find(
  (candidate) => candidate.solution.length >= 3,
)!;
const junglePuzzle = loadSeedPuzzleRegistry('jungle')[0]!;
const qualitySessionId = '00000000-0000-4000-8000-000000000001';
const laterSessionId = '00000000-0000-4000-8000-000000000002';

// Exercise the real transaction and account-session paths offline. The existing
// persistence suite also checks these invariants against PostgreSQL.
function database(
  t: TestContext,
  options: { initiallySolved?: boolean; viewedAt?: Date; unavailableFailures?: boolean } = {},
) {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  let repair: Date | null = null;
  const sessions = new Map<
    unknown,
    { viewedAt: Date; userId: unknown; wrong: number; hints: number; outcome: string | null }
  >();
  const rating = { rating: 1400, rating_deviation: 200, volatility: 0.06 };
  const query = async (sql: string, values: unknown[] = []) => {
    queries.push({ sql, values });
    if (sql.includes('SELECT seed_hash')) return { rows: [{ seed_hash: seedPuzzleContentHash() }] };
    if (sql.includes('SELECT data FROM puzzles')) {
      return {
        rows: [
          { data: puzzle },
          { data: junglePuzzle },
          // Retired rows can remain in the database; the store withholds them.
          { data: { ...puzzle, id: 'retired-puzzle', variant: 'fortress-xiangqi' } },
        ],
      };
    }
    if (sql.includes('SELECT DISTINCT to_char')) return { rows: [] };
    if (sql.includes('UPDATE account_sessions')) {
      return {
        rows: [{ id: 'solver', handle: 'solver', display_name: 'solver', play_disabled_at: null }],
      };
    }
    if (sql.includes('SELECT rating,')) return { rows: [rating] };
    if (sql.includes('INSERT INTO puzzle_quality_sessions')) {
      const session = sessions.get(values[1]);
      if (session) session.userId ??= values[3];
      else {
        sessions.set(values[1], {
          viewedAt: options.viewedAt ?? repairedAt,
          userId: values[3],
          wrong: 0,
          hints: 0,
          outcome: null,
        });
      }
      return { rows: [] };
    }
    if (sql.includes('UPDATE puzzle_quality_sessions')) {
      const session = sessions.get(values[1])!;
      if (session.outcome === null) {
        if (sql.includes('wrong_attempts = wrong_attempts + 1')) session.wrong++;
        if (sql.includes('hint_count = hint_count + 1')) session.hints++;
        if (sql.includes("outcome = 'solved'")) session.outcome = 'solved';
        if (sql.includes("outcome = 'revealed'")) session.outcome = 'revealed';
      }
      return { rows: [] };
    }
    if (sql.includes('INSERT INTO puzzle_attempts')) return { rows: [], rowCount: 0 };
    if (sql.includes('UPDATE puzzle_attempts')) {
      assert.match(sql, /SET repaired_at = now\(\)/);
      assert.match(sql, /user_id = \$1 AND puzzle_id = \$2/);
      assert.match(sql, /solved = FALSE AND repaired_at IS NULL/);
      assert.doesNotMatch(
        sql.split('WHERE')[0]!,
        /(?:solved|rated|user_rating_before|user_rating_after|created_at)\s*=/,
      );
      if (options.initiallySolved || repair) return { rows: [], rowCount: 0 };
      // Model the additional SQL predicate when present. The original query
      // has no visit predicate, so these regressions expose its false repairs.
      if (sql.includes('EXISTS')) {
        const session = sessions.get(values[2]);
        if (
          !session ||
          session.userId !== values[0] ||
          session.viewedAt <= failedAt ||
          session.wrong > 0 ||
          session.hints > 0 ||
          session.outcome !== 'solved'
        ) {
          return { rows: [], rowCount: 0 };
        }
      }
      repair = repairedAt;
      return { rows: [{ repaired_at: repair }], rowCount: 1 };
    }
    if (sql.includes('SELECT repaired_at')) return { rows: [{ repaired_at: repair }] };
    if (sql.includes('FROM puzzle_attempts')) {
      assert.match(sql, /user_id = \$1/);
      assert.match(sql, /solved = FALSE/);
      assert.match(sql, /ORDER BY created_at DESC, puzzle_id/);
      return {
        rows:
          options.initiallySolved || (sql.includes('repaired_at IS NOT NULL') ? !repair : !!repair)
            ? []
            : [
                {
                  puzzle_id: puzzle.id,
                  variant: 'xiangqi',
                  created_at: failedAt,
                  repaired_at: repair,
                },
                ...(options.unavailableFailures
                  ? [
                      { puzzle_id: junglePuzzle.id, variant: 'jungle' },
                      { puzzle_id: 'removed-puzzle', variant: 'xiangqi' },
                      { puzzle_id: 'hidden-puzzle', variant: 'xiangqi' },
                      { puzzle_id: 'retired-puzzle', variant: 'fortress-xiangqi' },
                    ].map((row) => ({ ...row, created_at: failedAt, repaired_at: repair }))
                  : []),
              ].filter((row) => !values[1] || row.variant === values[1]),
      };
    }
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
    if (/INSERT INTO (user_puzzle_ratings|puzzle_ratings)/.test(sql)) return { rows: [] };
    assert.fail(`Unexpected query: ${sql}`);
  };
  resetPuzzleStoreForTests();
  init('postgres://unused:unused@localhost/unused');
  t.mock.method(
    getPool(),
    'connect',
    async () => ({ query, release() {} }) as unknown as pg.PoolClient,
  );
  t.mock.method(getPool(), 'query', query);
  t.after(async () => {
    await close();
    resetPuzzleStoreForTests();
  });
  return queries;
}

const attemptInput = {
  userId: 'solver',
  puzzleId: puzzle.id,
  variant: 'xiangqi',
  solved: true,
  rated: true,
  seedRating: seedPuzzleRating(3),
  qualitySessionId,
};

async function cleanSolveSession() {
  await recordPuzzleQualityEvent({
    puzzleId: puzzle.id,
    sessionId: qualitySessionId,
    variant: puzzle.variant,
    event: 'solve',
    player: { userId: 'solver', deviceId: null },
  });
}

test('a later solve persists repair without changing the failed outcome or either rating', async (t) => {
  const queries = database(t);
  assert.equal((await recordPuzzleAttempt({ ...attemptInput, solved: false }))?.repairedAt, null);
  assert.equal(queries.filter(({ sql }) => sql.includes('UPDATE puzzle_attempts')).length, 0);
  await cleanSolveSession();
  const result = await recordPuzzleAttempt(attemptInput);
  assert.ok(result);
  assert.equal(result.repairedAt, repairedAt.toISOString());
  assert.equal(result.firstAttempt, false);
  assert.equal(result.ratingChanged, false);
  assert.equal(result.userRating, 1400);
  assert.equal(result.userRatingDelta, 0);
  assert.ok(queries.some(({ sql }) => sql === 'COMMIT'));
  assert.equal(
    queries.filter(({ sql }) => /UPDATE (user_puzzle_ratings|puzzle_ratings)/.test(sql)).length,
    0,
  );

  const again = await recordPuzzleAttempt({ ...attemptInput, rated: false });
  assert.equal(again?.repairedAt, repairedAt.toISOString());
  const wrongAgain = await recordPuzzleAttempt({ ...attemptInput, solved: false });
  assert.equal(wrongAgain?.repairedAt, repairedAt.toISOString());
});

test('revisiting an original solve never turns it into a repair', async (t) => {
  const queries = database(t, { initiallySolved: true });
  assert.equal((await recordPuzzleAttempt(attemptInput))?.repairedAt, null);
  assert.equal((await recordPuzzleAttempt({ ...attemptInput, solved: false }))?.repairedAt, null);
  assert.equal(queries.filter(({ sql }) => sql.includes('UPDATE puzzle_attempts')).length, 1);
});

async function route(path: string, signedIn = true, method = 'GET', payload?: unknown) {
  let status = 0;
  let body = '';
  const response = {
    writeHead(code: number) {
      status = code;
      return response;
    },
    end(chunk = '') {
      body += chunk;
      return response;
    },
  };
  const request = {
    method,
    headers: signedIn ? { cookie: 'mistboard_session=solver.test-token' } : {},
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      if (payload !== undefined) yield Buffer.from(JSON.stringify(payload));
    },
  } as unknown as IncomingMessage;
  const url = new URL(path, 'http://localhost');
  const handled = await tryHandle(
    {} as HttpApiContext,
    request,
    response as unknown as ServerResponse,
    url.pathname,
    url,
  );
  assert.equal(handled, true);
  return { status, body: body ? JSON.parse(body) : null };
}

test('failed-puzzle API scopes private results to the session account and validates filters', async (t) => {
  const queries = database(t);
  const guest = await route('/api/puzzles/failed', false);
  assert.equal(guest.status, 401);
  assert.deepEqual(guest.body, { error: 'not_signed_in' });
  assert.equal(queries.length, 0);

  const response = await route('/api/puzzles/failed?variant=xiangqi&userId=someone-else');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    failures: [
      {
        puzzleId: puzzle.id,
        variant: 'xiangqi',
        failedAt: failedAt.toISOString(),
        repairedAt: null,
      },
    ],
  });
  const read = queries.find(({ sql }) => sql.includes('FROM puzzle_attempts'));
  assert.ok(read);
  assert.match(read.sql, /repaired_at IS NULL/);
  assert.match(read.sql, /variant = \$2/);
  assert.deepEqual(read.values, ['solver', 'xiangqi']);

  await cleanSolveSession();
  await recordPuzzleAttempt(attemptInput);
  const repaired = await route('/api/puzzles/failed?repaired=true');
  assert.equal(repaired.status, 200);
  assert.equal(repaired.body.failures[0].repairedAt, repairedAt.toISOString());
  assert.match(queries.at(-1)!.sql, /repaired_at IS NOT NULL/);
  assert.deepEqual(queries.at(-1)!.values, ['solver']);
  assert.deepEqual((await route('/api/puzzles/failed')).body, { failures: [] });

  assert.equal((await route('/api/puzzles/failed?variant=banqi')).status, 400);
  assert.equal((await route('/api/puzzles/failed?repaired=maybe')).status, 400);
  assert.equal((await route('/api/puzzles/failed', true, 'POST')).status, 405);
});

test('attempt API repairs a clean later visit only after a complete validated solve', async (t) => {
  const queries = database(t);
  const path = `/api/puzzles/${puzzle.id}`;
  const incomplete = await route(`${path}/attempt`, true, 'POST', {
    moves: [puzzle.solution[0]],
    qualitySessionId,
  });
  assert.equal(incomplete.status, 200);
  assert.equal(incomplete.body.attempt.complete, false);
  assert.equal(incomplete.body.rating, undefined);
  assert.equal(queries.filter(({ sql }) => sql.includes('UPDATE puzzle_attempts')).length, 0);

  const solved = await route(`${path}/attempt`, true, 'POST', {
    moves: puzzle.solution.filter((_, ply) => ply % 2 === 0),
    rated: false,
    qualitySessionId,
  });
  assert.equal(solved.status, 200);
  assert.equal(solved.body.attempt.ok, true);
  assert.equal(solved.body.attempt.complete, true);
  assert.equal(solved.body.rating.repairedAt, repairedAt.toISOString());
  assert.equal(solved.body.rating.firstAttempt, false);
  assert.equal(solved.body.rating.ratingChanged, false);
  assert.equal(solved.body.rating.delta, 0);
  assert.equal(solved.body.solution, undefined);
  assert.deepEqual(queries.find(({ sql }) => sql.includes('UPDATE puzzle_attempts'))?.values, [
    'solver',
    puzzle.id,
    qualitySessionId,
  ]);
});

for (const failure of ['wrong', 'hint', 'solution'] as const) {
  test(`finishing after ${failure} in the same visit leaves the failure unresolved`, async (t) => {
    database(t);
    const path = `/api/puzzles/${puzzle.id}`;
    const failed =
      failure === 'wrong'
        ? await route(`${path}/attempt`, true, 'POST', {
            moves: [{ from: puzzle.solution[0]!.from, to: puzzle.solution[0]!.from }],
            qualitySessionId,
          })
        : await route(`${path}/reveal`, true, 'POST', { mode: failure, qualitySessionId });
    assert.equal(failed.status, 200);
    if (failure === 'wrong') assert.equal(failed.body.attempt.code, 'incorrect-move');
    const moves = puzzle.solution.filter((_, ply) => ply % 2 === 0);
    const finished = await route(`${path}/attempt`, true, 'POST', { moves, qualitySessionId });
    assert.equal(finished.body.attempt.complete, true);
    assert.equal(finished.body.rating.repairedAt, null);
    assert.equal((await route('/api/puzzles/failed')).body.failures[0].puzzleId, puzzle.id);
    assert.deepEqual((await route('/api/puzzles/failed?repaired=true')).body, { failures: [] });

    const later = await route(`${path}/attempt`, true, 'POST', {
      moves,
      qualitySessionId: laterSessionId,
    });
    assert.equal(later.body.rating.repairedAt, repairedAt.toISOString());
    assert.deepEqual((await route('/api/puzzles/failed')).body, { failures: [] });
  });
}

test('a clean completion of a visit opened before the failure is not a later retry', async (t) => {
  database(t, { viewedAt: new Date(failedAt.getTime() - 1000) });
  const finished = await route(`/api/puzzles/${puzzle.id}/attempt`, true, 'POST', {
    moves: puzzle.solution.filter((_, ply) => ply % 2 === 0),
    qualitySessionId,
  });
  assert.equal(finished.body.rating.repairedAt, null);
});

test('a solve without visit evidence cannot repair a failure', async (t) => {
  database(t);
  const result = await recordPuzzleAttempt({ ...attemptInput, qualitySessionId: undefined });
  assert.equal(result?.repairedAt, null);
});

test('failed API omits removed, hidden and retired puzzles from both queues', async (t) => {
  database(t, { unavailableFailures: true });
  for (const id of ['removed-puzzle', 'hidden-puzzle', 'retired-puzzle']) {
    assert.equal((await route(`/api/puzzles/${id}`)).status, 404);
    assert.equal(
      (await route(`/api/puzzles/${id}/attempt`, true, 'POST', { moves: [] })).status,
      404,
    );
  }
  for (const repaired of [false, true]) {
    if (repaired) {
      await cleanSolveSession();
      await recordPuzzleAttempt(attemptInput);
    }
    const response = await route(`/api/puzzles/failed?repaired=${repaired}`);
    assert.equal(response.status, 200);
    assert.deepEqual(
      response.body.failures.map((failure: { puzzleId: string }) => failure.puzzleId),
      [puzzle.id, junglePuzzle.id],
    );
    const filtered = await route(`/api/puzzles/failed?variant=xiangqi&repaired=${repaired}`);
    assert.deepEqual(
      filtered.body.failures.map((failure: { puzzleId: string }) => failure.puzzleId),
      [puzzle.id],
    );
  }
});
