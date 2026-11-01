import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test, { type TestContext } from 'node:test';
import {
  type JunglePuzzle,
  jungleStateToEngineFen,
  standardXiangqiEngineFen,
  type XiangqiPuzzle,
} from '@mistboard/game';
import { loadSeedPuzzleRegistry, seedPuzzleContentHash } from '@mistboard/game/puzzle-seed';
import { hashSecret } from './account-session.js';
import { close, getPool, init } from './persistence-db.js';
import { getPuzzleStore, resetPuzzleStoreForTests } from './puzzle-store.js';
import type { HttpApiContext } from './routes/lib.js';
import { tryHandle } from './routes/puzzles.js';

async function history(query = '?variant=xiangqi', account?: string, method = 'GET') {
  let status = 0;
  let headers: Record<string, string> = {};
  let body = '';
  const url = new URL(`/api/puzzles/history${query}`, 'http://localhost');
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

const rows = [
  {
    puzzle_id: 'first',
    variant: 'xiangqi',
    solved: true,
    rated: true,
    user_rating_before: 1500,
    user_rating_after: 1623,
    created_at: new Date('2026-10-25T12:00:00Z'),
  },
  {
    puzzle_id: 'second',
    variant: 'xiangqi',
    solved: false,
    rated: true,
    user_rating_before: 1623,
    user_rating_after: 1512,
    created_at: new Date('2026-10-26T12:00:00Z'),
  },
  {
    puzzle_id: 'third',
    variant: 'xiangqi',
    solved: false,
    rated: false,
    user_rating_before: 1512,
    user_rating_after: 1512,
    created_at: new Date('2026-10-27T12:00:00Z'),
  },
];

const xiangqi = loadSeedPuzzleRegistry('xiangqi')
  .filter((puzzle): puzzle is XiangqiPuzzle => puzzle.variant === 'xiangqi')
  .slice(0, 2);
const jungle = loadSeedPuzzleRegistry('jungle').find(
  (puzzle): puzzle is JunglePuzzle => puzzle.variant === 'jungle',
)!;
const thumbnailFields = (index: number) => ({
  fen: standardXiangqiEngineFen(xiangqi[index]!.initial),
  sideToMove:
    xiangqi[index]!.initial.status.type === 'playing' ? xiangqi[index]!.initial.status.turn : null,
});

// Real session resolution and persistence serialization; only the pg boundary
// is mocked. Fail on unknown reads so auth or owner checks cannot pass silently.
function database(t: TestContext) {
  resetPuzzleStoreForTests();
  init('postgres://mistboard@127.0.0.1:9/never');
  t.after(async () => {
    await close();
    resetPuzzleStoreForTests();
  });
  return t.mock.method(getPool(), 'query', async (sql: string, values: unknown[] = []) => {
    if (sql.includes('SELECT seed_hash')) return { rows: [{ seed_hash: seedPuzzleContentHash() }] };
    if (sql.includes('SELECT data FROM puzzles'))
      return {
        rows: [{ ...xiangqi[0], id: 'first' }, { ...xiangqi[1], id: 'second' }, jungle].map(
          (data) => ({ data }),
        ),
      };
    if (sql.includes('UPDATE account_sessions')) {
      assert.equal(values[1], hashSecret('test-token'));
      return {
        rows: ['alice', 'bob'].includes(String(values[0]))
          ? [{ id: values[0], handle: values[0], display_name: values[0] }]
          : [],
      };
    }
    if (sql.includes('FROM user_puzzle_ratings')) {
      assert.match(sql, /user_id = \$1 AND variant = \$2/);
      assert.equal(values[1], 'xiangqi');
      return {
        rows:
          values[0] === 'alice'
            ? [
                {
                  rating: 1512.4,
                  rating_deviation: 200,
                  volatility: 0.06,
                  solved: 1,
                  attempts: 3,
                },
              ]
            : [],
      };
    }
    if (sql.includes('FROM puzzle_attempts')) {
      assert.match(sql, /WHERE user_id = \$1 AND \(\$2::text IS NULL OR variant = \$2\)/);
      const descending = sql.includes('ORDER BY created_at DESC, puzzle_id DESC');
      if (!descending) assert.match(sql, /ORDER BY created_at ASC, puzzle_id ASC/);
      assert.match(sql, /LIMIT \$3 OFFSET \$4/);
      assert.ok(values[1] === 'xiangqi' || values[1] === null);
      const offset = Number(values[3]);
      const ordered = descending ? [...rows].reverse() : rows;
      return {
        rows: values[0] === 'alice' ? ordered.slice(offset, offset + Number(values[2])) : [],
      };
    }
    assert.fail('unexpected database query');
  });
}

test('puzzle history requires sign-in, even with a supplied account id', async () => {
  const response = await history('?variant=xiangqi&userId=alice');
  assert.equal(response.status, 401);
  assert.deepEqual(response.body, { error: 'authentication_required' });
  assert.equal(response.headers['cache-control'], 'private, no-store');
});

test('puzzle history returns stored outcomes and rating changes in chronological pages', async (t) => {
  database(t);
  const first = await history('?variant=xiangqi&limit=2', 'alice');
  assert.equal(first.status, 200);
  assert.equal(first.headers['cache-control'], 'private, no-store');
  assert.deepEqual(first.body, {
    attempts: [
      {
        puzzleId: 'first',
        variant: 'xiangqi',
        solved: true,
        rated: true,
        ratingBefore: 1500,
        ratingAfter: 1623,
        ratingDelta: 123,
        createdAt: '2026-10-25T12:00:00.000Z',
        ...thumbnailFields(0),
      },
      {
        puzzleId: 'second',
        variant: 'xiangqi',
        solved: false,
        rated: true,
        ratingBefore: 1623,
        ratingAfter: 1512,
        ratingDelta: -111,
        createdAt: '2026-10-26T12:00:00.000Z',
        ...thumbnailFields(1),
      },
    ],
    nextOffset: 2,
    progress: { rating: 1512, provisional: true, solved: 1, attempts: 3 },
  });
  const last = await history('?variant=xiangqi&limit=2&offset=2', 'alice');
  assert.deepEqual(last.body.attempts, [
    {
      puzzleId: 'third',
      variant: 'xiangqi',
      solved: false,
      rated: false,
      ratingBefore: 1512,
      ratingAfter: 1512,
      ratingDelta: 0,
      createdAt: '2026-10-27T12:00:00.000Z',
      fen: null,
      sideToMove: null,
    },
  ]);
  assert.equal(last.body.nextOffset, null);
  const pastEnd = await history('?variant=xiangqi&offset=3', 'alice');
  assert.deepEqual(pastEnd.body.attempts, []);
  assert.equal(pastEnd.body.nextOffset, null);
});

test('another account cannot select private puzzle activity using query parameters', async (t) => {
  database(t);
  const response = await history('?variant=xiangqi&userId=alice&handle=alice', 'bob');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { attempts: [], nextOffset: null, progress: null });
  assert.equal(JSON.stringify(response.body).includes('first'), false);
  const invalidSession = await history('?variant=xiangqi&userId=alice', 'expired');
  assert.equal(invalidSession.status, 401);
  assert.deepEqual(invalidSession.body, { error: 'authentication_required' });
});

test('puzzle history rejects unsupported variants and invalid pagination', async (t) => {
  database(t);
  for (const query of ['?variant=banqi', '?variant=fortress-xiangqi']) {
    const response = await history(query, 'alice');
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: 'invalid_variant' });
  }
  for (const page of [
    'limit=0',
    'limit=101',
    'limit=-1',
    'limit=1.5',
    'limit=',
    'offset=-1',
    'offset=NaN',
    'offset=1e2',
    'offset=9007199254740992',
    'order=invalid',
  ]) {
    const response = await history(`?variant=xiangqi&${page}`, 'alice');
    assert.equal(response.status, 400, page);
    assert.deepEqual(response.body, { error: 'invalid_pagination' });
  }
  assert.equal((await history('?variant=xiangqi', 'alice', 'POST')).status, 405);
});

test('puzzle history preserves missing legacy rating snapshots', async (t) => {
  const query = database(t);
  await getPuzzleStore();
  query.mock.restore();
  t.mock.method(getPool(), 'query', async (sql: string) => {
    if (sql.includes('UPDATE account_sessions')) return { rows: [{ id: 'alice' }] };
    if (sql.includes('FROM user_puzzle_ratings')) return { rows: [] };
    assert.match(sql, /FROM puzzle_attempts/);
    return { rows: [{ ...rows[0], user_rating_before: null, user_rating_after: null }] };
  });
  const response = await history('?variant=xiangqi', 'alice');
  assert.equal(response.status, 200);
  assert.equal(response.body.attempts[0].ratingBefore, null);
  assert.equal(response.body.attempts[0].ratingAfter, null);
  assert.equal(response.body.attempts[0].ratingDelta, null);
});

test('history offers newest-first offset pages without changing profile chronological defaults', async (t) => {
  database(t);
  const first = await history('?order=newest&limit=2', 'alice');
  assert.equal(first.status, 200);
  assert.deepEqual(
    first.body.attempts.map((entry: { puzzleId: string }) => entry.puzzleId),
    ['third', 'second'],
  );
  assert.equal(first.body.progress, null);
  assert.equal(first.body.nextOffset, 2);
  const last = await history('?order=newest&limit=2&offset=2', 'alice');
  assert.equal(last.body.attempts[0].puzzleId, 'first');
  assert.equal(last.body.nextOffset, null);
});

test('history serializes only thumbnail fields for public variants and withholds unknown or mismatched views', async (t) => {
  const query = database(t);
  await getPuzzleStore();
  query.mock.restore();
  const privateState = { hiddenRole: 'PRIVATE_FACE_DOWN_ROLE' };
  const mockRows = [
    { ...rows[0], puzzle_id: jungle.id, variant: 'jungle' },
    {
      ...rows[0],
      puzzle_id: 'hidden',
      variant: 'banqi',
      initial: privateState,
      solution: privateState,
    },
    { ...rows[0], puzzle_id: 'first', variant: 'banqi' },
  ];
  t.mock.method(getPool(), 'query', async (sql: string) => {
    if (sql.includes('UPDATE account_sessions')) return { rows: [{ id: 'alice' }] };
    assert.match(sql, /FROM puzzle_attempts/);
    return { rows: mockRows };
  });
  const response = await history('?order=newest', 'alice');
  assert.equal(response.status, 200);
  assert.equal(response.body.attempts[0].fen, jungleStateToEngineFen(jungle.initial));
  assert.equal(
    response.body.attempts[0].sideToMove,
    jungle.initial.status.type === 'playing' ? jungle.initial.status.turn : null,
  );
  for (const entry of response.body.attempts.slice(1)) {
    assert.equal(entry.fen, null);
    assert.equal(entry.sideToMove, null);
  }
  const payload = JSON.stringify(response.body);
  for (const forbidden of ['PRIVATE_FACE_DOWN_ROLE', 'initial', 'solution', 'board'])
    assert.equal(payload.includes(forbidden), false, forbidden);
});
