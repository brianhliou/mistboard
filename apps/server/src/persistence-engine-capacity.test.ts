import assert from 'node:assert/strict';
import test from 'node:test';
import type pg from 'pg';
import type { EngineAlertEmailPayload } from './engine-alert-email.js';
import {
  deliverEnginePoolWaitDigestOn,
  poolWaitDayWarrantsDigest,
  recordEnginePoolWaitOn,
} from './persistence-engine-capacity.js';

const now = new Date('2026-10-31T00:01:00Z');
const rows = [
  { day: '2026-10-30', pool: 'jieqi', wait_count: 12, max_wait_ms: 1_500, max_queue_depth: 2 },
  {
    day: '2026-10-30',
    pool: 'katago-jungle',
    wait_count: 1,
    max_wait_ms: 1_100,
    max_queue_depth: 1,
  },
];

function database(responses: unknown[][]) {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  return {
    queries,
    db: {
      query: async (sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return { rows: responses.shift() ?? [] };
      },
    } as unknown as Pick<pg.PoolClient, 'query'>,
  };
}

test('a slow wait atomically increments its durable UTC day, preserving the maxima', async () => {
  const { db, queries } = database([]);
  await recordEnginePoolWaitOn(db, 'jieqi', 1_123.7, 2, now);
  assert.deepEqual(queries[0]!.params, ['2026-10-31', 'jieqi', 1_124, 2]);
  assert.match(queries[0]!.sql, /ON CONFLICT \(day, pool\) DO UPDATE/);
  assert.match(queries[0]!.sql, /wait_count = engine_pool_wait_days.wait_count \+ 1/);
  assert.match(queries[0]!.sql, /GREATEST/);
});

test('a new process delivers the stored completed day and only then marks it sent', async () => {
  // No process-local accumulator is populated: these rows survived a restart.
  const { db, queries } = database([[{ locked: true }], rows]);
  const alerts: EngineAlertEmailPayload[] = [];
  const result = await deliverEnginePoolWaitDigestOn(
    db,
    async (alert) => {
      assert.equal(queries.length, 2, 'delivery precedes the sent marker');
      alerts.push(alert);
      return { status: 'sent' };
    },
    now,
  );
  assert.deepEqual(result, { status: 'sent' });
  assert.equal(alerts[0]!.wait_count, 13);
  assert.equal(alerts[0]!.day, '2026-10-30');
  assert.match(String(alerts[0]!.pools), /jieqi: count=12/);
  assert.match(String(alerts[0]!.pools), /katago-jungle: count=1/);
  assert.match(queries[1]!.sql, /day < \$1 AND digest_sent_at IS NULL/);
  assert.deepEqual(queries[1]!.params, ['2026-10-31']);
  assert.match(queries[2]!.sql, /UPDATE engine_pool_wait_days SET digest_sent_at/);
  assert.deepEqual(queries[2]!.params, ['2026-10-30', now]);
  assert.match(queries[3]!.sql, /digest_sent_at IS NOT NULL/);
});

for (const status of ['failed', 'disabled', 'throttled'] as const) {
  test(`a ${status} digest remains unsent for a later retry`, async () => {
    const { db, queries } = database([[{ locked: true }], rows]);
    const result = await deliverEnginePoolWaitDigestOn(
      db,
      async () => {
        if (status === 'throttled') return { status, suppressed: 1 };
        return { status };
      },
      now,
    );
    assert.equal(result?.status, status);
    assert.equal(queries.length, 2, 'neither mark nor prune an undelivered summary');
  });
}

test('an overlapping digest sender cannot send the same completed day', async () => {
  const { db, queries } = database([[{ locked: false }]]);
  assert.equal(
    await deliverEnginePoolWaitDigestOn(
      db,
      async () => {
        assert.fail('another transaction owns delivery');
      },
      now,
    ),
    null,
  );
  assert.equal(queries.length, 1);
});

test('a completed day without slow waits sends no email', async () => {
  const { db } = database([[{ locked: true }], []]);
  assert.equal(
    await deliverEnginePoolWaitDigestOn(
      db,
      async () => {
        assert.fail('there were no waits');
      },
      now,
    ),
    null,
  );
});

test('the digest bar: ten waits in a day, or one wait of five seconds', () => {
  assert.equal(poolWaitDayWarrantsDigest([{ count: 1, maxWaitMs: 1_000 }]), false);
  assert.equal(
    poolWaitDayWarrantsDigest([
      { count: 5, maxWaitMs: 4_999 },
      { count: 4, maxWaitMs: 2_000 },
    ]),
    false,
    'nine short waits across pools stay under the bar',
  );
  assert.equal(
    poolWaitDayWarrantsDigest([
      { count: 5, maxWaitMs: 1_000 },
      { count: 5, maxWaitMs: 1_000 },
    ]),
    true,
    'the count is the day total across pools',
  );
  assert.equal(poolWaitDayWarrantsDigest([{ count: 1, maxWaitMs: 5_000 }]), true);
});

test('a planted completed day under the bar is settled without an email', async () => {
  const quiet = [
    {
      day: '2026-11-08',
      pool: 'xiangqi-fsf',
      wait_count: 1,
      max_wait_ms: 1_000,
      max_queue_depth: 1,
    },
  ];
  const { db, queries } = database([[{ locked: true }], quiet]);
  const result = await deliverEnginePoolWaitDigestOn(
    db,
    async () => {
      assert.fail('one short wait is not an alert');
    },
    new Date('2026-11-09T00:01:00Z'),
  );
  assert.equal(result, null);
  assert.match(queries[2]!.sql, /UPDATE engine_pool_wait_days SET digest_sent_at/);
  assert.equal(queries[2]!.params?.[0], '2026-11-08', 'the day is settled, so it is not retried');
  assert.match(queries[3]!.sql, /digest_sent_at IS NOT NULL/);
});
