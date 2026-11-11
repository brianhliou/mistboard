import assert from 'node:assert/strict';
import test from 'node:test';
import type pg from 'pg';
import { buildMistboardReadout, type MistboardReadoutV1 } from './mistboard-readout.js';
import { collectReadoutComparison } from './persistence-mistboard-readout.js';

const previous = buildMistboardReadout({
  snapshotId: 'previous_week',
  trigger: 'weekly',
  now: new Date('2026-10-26T17:00:00Z'),
  runtime: {
    revision: null,
    activeGames: 0,
    databaseRequired: true,
    persistence: 'enabled',
    persistenceErrors: { count1m: 0, lastAt: null },
  },
  facts: { product: null, puzzles: null, mining: null, engines: null },
});
function database(payload?: MistboardReadoutV1) {
  return {
    query: async (sql: string, values: Date[]) => {
      assert.match(sql, /trigger = 'weekly' AND period_start = \$1 AND period_end = \$2/);
      assert.deepEqual(
        values.map((value) => value.toISOString()),
        ['2026-10-19T00:00:00.000Z', '2026-10-26T00:00:00.000Z'],
      );
      return { rows: payload ? [{ payload }] : [] };
    },
  } as unknown as Pick<pg.Pool, 'query'>;
}
test('comparison reads exactly the adjacent weekly snapshot, not a recent daily check', async () => {
  const result = await collectReadoutComparison(
    database(previous),
    new Date('2026-11-02T20:00:00Z'),
  );
  assert.equal(result?.periodEnd, '2026-10-26T00:00:00.000Z');
  assert.equal(result?.product, null);
  assert.deepEqual(
    result?.actionKeys,
    previous.actions.map((action) => action.dedupeKey),
  );
});
test('missing or inconsistent stored comparison is unavailable', async () => {
  for (const payload of [
    undefined,
    { ...previous, trigger: 'daily' as const },
    { ...previous, periodEnd: '2026-10-25T00:00:00.000Z' },
  ]) {
    assert.equal(
      await collectReadoutComparison(database(payload), new Date('2026-11-02T20:00:00Z')),
      null,
    );
  }
});

test('snapshot reads bind ids and latest cadence without affecting the generator default', async () => {
  const { latestMistboardReadout, mistboardReadoutById } = await import(
    './persistence-mistboard-readout.js'
  );
  const calls: { sql: string; values: unknown[] }[] = [];
  const db = {
    query: async (sql: string, values: unknown[]) => {
      calls.push({ sql, values });
      return { rows: [{ payload: previous }] };
    },
  } as unknown as Pick<pg.Pool, 'query'>;
  assert.equal((await latestMistboardReadout(db))?.snapshotId, previous.snapshotId);
  assert.deepEqual(calls[0].values, [null]);
  await latestMistboardReadout(db, { trigger: 'weekly' });
  assert.deepEqual(calls[1].values, ['weekly']);
  assert.match(calls[1].sql, /trigger = \$1/);
  await mistboardReadoutById("id' OR 1=1", db);
  assert.deepEqual(calls[2].values, ["id' OR 1=1"]);
  assert.doesNotMatch(calls[2].sql, /OR 1=1/);
});
