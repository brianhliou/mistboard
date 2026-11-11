import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test, { type TestContext } from 'node:test';
import { hashSecret } from './account-session.js';
import { close, getPool, init } from './persistence-db.js';
import { tryHandle } from './routes/users.js';

const date = new Date('2026-11-01T12:00:00Z');
const row = (before: number | null, after: number | null, variant = 'xiangqi') => ({
  variant,
  created_at: date,
  user_rating_before: before,
  user_rating_after: after,
  // Deliberately overfetch at the mocked DB boundary. No field may hitchhike
  // through the public serializer, even if a later query selects more columns.
  puzzle_id: 'private-puzzle-id',
  puzzleId: 'private-puzzle-id',
  solved: false,
  result: 'private-attempt-result',
  solve_time_ms: 12345,
});

function database(t: TestContext, visibility = 'public', attempts = [row(1500, 1520)]) {
  init('postgres://mistboard@127.0.0.1:9/never');
  t.after(close);
  return t.mock.method(getPool(), 'query', async (sql: string, values: unknown[] = []) => {
    if (sql.includes('UPDATE account_sessions')) {
      assert.equal(values[1], hashSecret('test-token'));
      return { rows: [{ id: String(values[0]), handle: String(values[0]) }] };
    }
    if (sql.includes('FROM users') && sql.includes('lower(handle) = lower($1)')) {
      const handle = String(values[0]);
      return {
        rows:
          handle === 'missing'
            ? []
            : [
                {
                  id: handle.toLowerCase(),
                  handle,
                  display_name: handle,
                  profile_visibility: visibility,
                  account_role: handle === 'player' ? 'player' : 'admin',
                  bio: '',
                  location: '',
                  profile_links: [],
                  title: null,
                  flair: null,
                  patron_since: null,
                  created_at: date,
                },
              ],
      };
    }
    if (sql.includes('FROM puzzle_attempts') && sql.includes('AND rated = TRUE')) {
      assert.equal(values[0], 'solver');
      assert.match(sql, /SELECT variant, created_at, user_rating_before, user_rating_after\s+FROM/);
      assert.match(sql, /ORDER BY created_at ASC, puzzle_id ASC/);
      return { rows: attempts };
    }
    if (
      sql.includes('FROM game_participants') ||
      sql.includes('FROM user_ratings') ||
      sql.includes('FROM user_puzzle_ratings') ||
      sql.includes('FROM user_achievements') ||
      (sql.includes('FROM puzzle_attempts') && sql.includes('AND solved'))
    ) {
      return { rows: [] };
    }
    assert.fail(`Unexpected query: ${sql}`);
  });
}

async function read(path: string, account?: string, method = 'GET') {
  let status = 0;
  let body = '';
  let headers: Record<string, string> = {};
  const request = {
    method,
    headers: account ? { cookie: `mistboard_session=${account}.test-token` } : {},
  } as IncomingMessage;
  const response = {
    writeHead(code: number, values: Record<string, string>) {
      status = code;
      headers = values;
    },
    end(value = '') {
      body = value;
    },
  } as unknown as ServerResponse;
  const url = new URL(path, 'http://localhost');
  assert.equal(await tryHandle({}, request, response, url.pathname, url), true);
  return { status, headers, serialized: body, body: JSON.parse(body) };
}

const point = (before: number, after: number, startsSegment: boolean, variant = 'xiangqi') => ({
  variant,
  createdAt: date.toISOString(),
  ratingBefore: before,
  ratingAfter: after,
  startsSegment,
});

test('public puzzle chart serializes only rating points, for visitors and the owner', async (t) => {
  database(t);
  for (const viewer of [undefined, 'other-admin', 'solver']) {
    const response = await read('/api/users/solver/puzzle-rating-history?userId=other', viewer);
    assert.equal(response.status, 200);
    assert.equal(response.headers['cache-control'], 'private, no-store');
    // Check the WHOLE serialized response, including its envelope. Adding any
    // attempt field anywhere fails this allowlist assertion.
    assert.deepEqual(JSON.parse(response.serialized), { points: [point(1500, 1520, true)] });
    assert.doesNotMatch(
      response.serialized,
      /puzzle.?id|private-puzzle-id|solved|result|solve.?time|12345/i,
    );
  }
});

test('public puzzle chart preserves missing snapshots and per-variant segment boundaries', async (t) => {
  database(t, 'public', [
    row(1500, 1520),
    row(1300, 1310, 'jungle'),
    row(1520, 1530),
    row(null, null),
    row(1530, 1540),
    row(1600, 1610),
    row(1310, 1320, 'jungle'),
  ]);
  const response = await read('/api/users/solver/puzzle-rating-history');
  assert.deepEqual(response.body, {
    points: [
      point(1500, 1520, true),
      point(1300, 1310, true, 'jungle'),
      point(1520, 1530, false),
      point(1530, 1540, true),
      point(1600, 1610, true),
      point(1310, 1320, false, 'jungle'),
    ],
  });
});

test('public puzzle chart enforces profile privacy and missing-profile gates', async (t) => {
  const query = database(t, 'private');
  for (const viewer of [undefined, 'other-admin']) {
    const response = await read('/api/users/solver/puzzle-rating-history', viewer);
    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: 'not_found' });
  }
  assert.equal(
    query.mock.calls.some(({ arguments: [sql] }) => String(sql).includes('FROM puzzle_attempts')),
    false,
  );
  assert.equal((await read('/api/users/solver/puzzle-rating-history', 'solver')).status, 200);
  assert.equal((await read('/api/users/missing/puzzle-rating-history')).status, 404);
});

test('unlisted profiles retain public chart access and empty histories stay empty', async (t) => {
  database(t, 'unlisted', []);
  const response = await read('/api/users/solver/puzzle-rating-history');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { points: [] });
});

test('public puzzle chart rejects invalid handles and methods', async (t) => {
  const query = database(t);
  assert.equal((await read('/api/users/bad!handle/puzzle-rating-history')).status, 400);
  assert.equal(
    (await read('/api/users/solver/puzzle-rating-history', undefined, 'POST')).status,
    405,
  );
  assert.equal(query.mock.callCount(), 0);
});

test('profile founder boolean depends only on the founder username', async (t) => {
  database(t);
  for (const [handle, isFounder, accountRole] of [
    ['brianhliou-dev', true, 'admin'],
    ['BRIANHLIOU-DEV', true, 'admin'],
    ['other-admin', false, 'admin'],
    ['player', false, 'player'],
  ] as const) {
    const response = await read(`/api/users/${handle}/profile`);
    assert.equal(response.status, 200);
    assert.equal(response.body.profile.user.isFounder, isFounder, handle);
    assert.equal(response.body.profile.user.accountRole, accountRole, handle);
  }
});
