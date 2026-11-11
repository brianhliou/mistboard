import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test, { describe, type TestContext } from 'node:test';
import { loadSeedPuzzleRegistry, seedPuzzleContentHash } from '@mistboard/game/puzzle-seed';
import { hashSecret } from './account-session.js';
import { createUser } from './persistence.js';
import { close, getPool, init } from './persistence-db.js';
import { recordPuzzleQualityEvent } from './persistence-puzzle-quality.js';
import * as attempts from './persistence-puzzle-ratings.js';
import { definePersistenceTests } from './persistence-test-support.js';
import * as ratings from './puzzle-rating.js';
import { getPuzzleStore, resetPuzzleStoreForTests } from './puzzle-store.js';
import type { HttpApiContext } from './routes/lib.js';
import { tryHandle } from './routes/puzzles.js';

const xiangqi = loadSeedPuzzleRegistry('xiangqi').slice(0, 5);
const jungle = loadSeedPuzzleRegistry('jungle')[0]!;
const empty = { nb: 0, wins: 0, fixed: 0, puzzleRatingAvg: null };

async function dashboard(query = '', account?: string, method = 'GET') {
  let status = 0;
  let headers: Record<string, string> = {};
  let body = '';
  const url = new URL(`/api/puzzles/dashboard${query}`, 'http://localhost');
  const response = {
    writeHead(code: number, values: Record<string, string>) {
      status = code;
      headers = values;
      return this;
    },
    end(value = '') {
      body = value;
      return this;
    },
  } as unknown as ServerResponse;
  const request = {
    method,
    headers: account ? { cookie: `mistboard_session=${account}.test-token` } : {},
  } as IncomingMessage;
  assert.equal(await tryHandle({} as HttpApiContext, request, response, url.pathname, url), true);
  return { status, headers, body: JSON.parse(body) };
}

function database(t: TestContext) {
  resetPuzzleStoreForTests();
  init('postgres://unused@127.0.0.1:9/never');
  t.after(async () => {
    await close();
    resetPuzzleStoreForTests();
  });
  const reads: unknown[][] = [];
  t.mock.method(getPool(), 'query', async (sql: string, values: unknown[] = []) => {
    if (sql.includes('UPDATE account_sessions')) {
      assert.equal(values[1], hashSecret('test-token'));
      return { rows: ['alice', 'bob'].includes(String(values[0])) ? [{ id: values[0] }] : [] };
    }
    if (sql.includes('SELECT seed_hash')) return { rows: [{ seed_hash: seedPuzzleContentHash() }] };
    if (sql.includes('SELECT data FROM puzzles')) {
      assert.match(sql, /WHERE hidden_reason IS NULL/);
      return {
        rows: [
          ...xiangqi,
          jungle,
          { ...xiangqi[0], id: 'retired', variant: 'fortress-xiangqi' },
        ].map((data) => ({ data })),
      };
    }
    assert.match(sql, /FROM puzzle_attempts/);
    assert.match(sql, /user_id = \$1/);
    assert.match(sql, /created_at >=/);
    assert.match(sql, /INTERVAL '1 day'/);
    assert.match(sql, /puzzle_id = ANY\(/);
    assert.match(sql, /repaired_at IS NOT NULL/);
    reads.push(values);
    return {
      rows: [
        values[0] === 'alice'
          ? { nb: 3, wins: 2, fixed: 1, puzzle_rating_avg: 1600.6 }
          : { nb: 0, wins: 0, fixed: 0, puzzle_rating_avg: null },
      ],
    };
  });
  return reads;
}

test('puzzle dashboard requires sign-in and never caches private responses', async (t) => {
  const reads = database(t);
  for (const account of [undefined, 'expired']) {
    const response = await dashboard('?variant=xiangqi&userId=alice', account);
    assert.equal(response.status, 401);
    assert.deepEqual(response.body, { error: 'not_signed_in' });
    assert.equal(response.headers['cache-control'], 'private, no-store');
  }
  assert.equal(reads.length, 0);
});

test('puzzle dashboard defaults to 30 days and scopes store-filtered counts to the session', async (t) => {
  const reads = database(t);
  const response = await dashboard('?variant=xiangqi&userId=bob', 'alice');
  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], 'private, no-store');
  assert.deepEqual(response.body, { days: 30, nb: 3, wins: 2, fixed: 1, puzzleRatingAvg: 1601 });
  assert.deepEqual(reads[0], ['alice', 30, xiangqi.map((puzzle) => puzzle.id), 'xiangqi']);
  const other = await dashboard('?variant=xiangqi&userId=alice&handle=alice', 'bob');
  assert.deepEqual(other.body, { days: 30, ...empty });
  assert.equal(reads[1]?.[0], 'bob');
});

test('puzzle dashboard accepts exactly the day choices and validates variants and method', async (t) => {
  const reads = database(t);
  for (const days of [1, 2, 3, 7, 10, 14, 21, 30, 60, 90]) {
    const response = await dashboard(`?days=${days}`, 'alice');
    assert.equal(response.status, 200);
    assert.equal(response.body.days, days);
    assert.deepEqual(reads.at(-1), [
      'alice',
      days,
      [...xiangqi, jungle].map((puzzle) => puzzle.id),
      null,
    ]);
  }
  const readCount = reads.length;
  for (const days of [
    '',
    '0',
    '4',
    '31',
    '365',
    '-1',
    '1.5',
    'NaN',
    'Infinity',
    '1e1',
    '0x1',
    '01',
    '+1',
    ' 1',
  ]) {
    const response = await dashboard(`?days=${encodeURIComponent(days)}`, 'alice');
    assert.equal(response.status, 400, days);
    assert.deepEqual(response.body, { error: 'invalid_days' });
    assert.equal(response.headers['cache-control'], 'private, no-store');
  }
  for (const variant of ['banqi', 'fortress-xiangqi', 'unknown']) {
    const response = await dashboard(`?variant=${variant}`, 'alice');
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: 'invalid_variant' });
  }
  assert.equal((await dashboard('', 'alice', 'POST')).status, 405);
  assert.equal(reads.length, readCount);
  assert.equal((await dashboard('?variant=', 'alice')).status, 200);
  assert.equal((await dashboard('?variant=jungle', 'alice')).status, 200);
  assert.deepEqual(reads.at(-1), ['alice', 30, [jungle.id], 'jungle']);
});

test('dashboard arithmetic separates first wins, repairs and unresolved failures', () => {
  assert.deepEqual(
    ratings.puzzleDashboardMetrics({ nb: 6, wins: 4, fixed: 2, puzzleRatingAvg: 1600 }),
    {
      firstWins: 2,
      unfixed: 2,
      failed: 4,
      performance: 1433,
      clear: true,
    },
  );
  assert.deepEqual(ratings.puzzleDashboardMetrics(empty), {
    firstWins: 0,
    unfixed: 0,
    failed: 0,
    performance: null,
    clear: false,
  });
  for (const result of [
    { nb: 5, wins: 3, fixed: 1 },
    { nb: 6, wins: 3, fixed: 2 },
    { nb: 6, wins: 5, fixed: 0 },
  ]) {
    assert.equal(ratings.puzzleDashboardMetrics({ ...result, puzzleRatingAvg: 1600 }).clear, false);
  }
  assert.equal(
    ratings.puzzleDashboardMetrics({ nb: 6, wins: 6, fixed: 2, puzzleRatingAvg: 1600 }).clear,
    true,
  );
});

describe('persistence puzzle-dashboard', () => {
  definePersistenceTests('puzzle-dashboard', () => {
    test('counts distinct first solves, clean repairs and failures within the owner window', async () => {
      const now = new Date();
      for (const id of ['dashboard-owner', 'dashboard-other']) {
        await createUser({
          id,
          email: `${id}@example.com`,
          emailVerifiedAt: now,
          handle: id,
          displayName: id,
          now,
        });
      }
      const store = await getPuzzleStore();
      const attempt = (
        puzzleId: string,
        solved: boolean,
        userId = 'dashboard-owner',
        variant = 'xiangqi',
      ) =>
        attempts.recordPuzzleAttempt({
          userId,
          puzzleId,
          variant,
          solved,
          rated: false,
          seedRating: ratings.seedPuzzleRating(3),
        });
      const [first, fixed, failed, outside, boundary] = xiangqi;
      assert.ok(first && fixed && failed && outside && boundary);
      await attempt(first.id, true);
      await attempt(first.id, false); // Retrying a success never changes its outcome.
      await attempt(fixed.id, false);
      await attempt(failed.id, false);
      await attempt(outside.id, true);
      await attempt(boundary.id, true);
      await attempt(first.id, true, 'dashboard-other');
      await attempt(jungle.id, true, 'dashboard-owner', 'jungle');
      await attempt('removed-from-store', true);
      // Backdate the first failure so the clean visit is unambiguously later.
      await getPool().query(
        `UPDATE puzzle_attempts SET created_at = now() - INTERVAL '1 hour'
         WHERE user_id = $1`,
        ['dashboard-owner'],
      );
      const visit = {
        puzzleId: fixed.id,
        sessionId: randomUUID(),
        variant: 'xiangqi',
        player: { userId: 'dashboard-owner', deviceId: null },
      };
      await recordPuzzleQualityEvent({ ...visit, event: 'solve' });
      const repaired = await attempts.recordPuzzleAttempt({
        userId: 'dashboard-owner',
        puzzleId: fixed.id,
        variant: 'xiangqi',
        solved: true,
        rated: false,
        seedRating: ratings.seedPuzzleRating(3),
        qualitySessionId: visit.sessionId,
      });
      assert.ok(repaired?.repairedAt);
      // A completion without clean-visit evidence stays unresolved.
      await attempt(failed.id, true);
      await getPool().query(
        `UPDATE puzzle_attempts SET created_at = now() - INTERVAL '30 days 1 millisecond'
         WHERE user_id = $1 AND puzzle_id = $2`,
        ['dashboard-owner', outside.id],
      );
      await getPool().query(
        `UPDATE puzzle_attempts SET created_at = now() - INTERVAL '29 days 23 hours'
         WHERE user_id = $1 AND puzzle_id = $2`,
        ['dashboard-owner', boundary.id],
      );
      for (const [puzzleId, rating] of [
        [first.id, 1300],
        [fixed.id, 1600],
        [failed.id, 1802],
        [boundary.id, 1700],
      ] as const) {
        await getPool().query('UPDATE puzzle_ratings SET rating = $2 WHERE puzzle_id = $1', [
          puzzleId,
          rating,
        ]);
      }
      const puzzleIds = xiangqi.map((puzzle) => puzzle.id);
      const result = await attempts.getPuzzleDashboard('dashboard-owner', 30, puzzleIds, 'xiangqi');
      assert.deepEqual(result, { days: 30, nb: 4, wins: 3, fixed: 1, puzzleRatingAvg: 1601 });
      const repairs = await attempts.listFailedPuzzleAttempts('dashboard-owner', {
        variant: 'xiangqi',
        repaired: true,
      });
      assert.equal(
        result.fixed,
        repairs.filter((repair) => puzzleIds.includes(repair.puzzleId)).length,
      );
      assert.deepEqual(
        await attempts.getPuzzleDashboard('dashboard-owner', 1, puzzleIds, 'xiangqi'),
        {
          days: 1,
          nb: 3,
          wins: 2,
          fixed: 1,
          puzzleRatingAvg: 1567,
        },
      );
      assert.deepEqual(
        await attempts.getPuzzleDashboard('dashboard-other', 30, puzzleIds, 'xiangqi'),
        {
          days: 30,
          nb: 1,
          wins: 1,
          fixed: 0,
          puzzleRatingAvg: 1300,
        },
      );
      assert.deepEqual(
        await attempts.getPuzzleDashboard('dashboard-other', 30, [jungle.id], 'jungle'),
        { days: 30, ...empty },
      );
      assert.deepEqual(await attempts.getPuzzleDashboard('dashboard-owner', 30, [], 'xiangqi'), {
        days: 30,
        ...empty,
      });
      const all = await attempts.getPuzzleDashboard(
        'dashboard-owner',
        30,
        store.puzzles.map((puzzle) => puzzle.id),
      );
      assert.equal(all.nb, 5);
      assert.equal(all.wins, 4);
      assert.equal(all.fixed, 1);
    });
  });
});
