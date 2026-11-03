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
