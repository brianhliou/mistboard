import assert from 'node:assert/strict';
import test from 'node:test';
import type pg from 'pg';
import { collectContentReadout } from './content-readout.js';
import { generateMistboardReadout } from './persistence-mistboard-readout.js';

const now = new Date('2026-11-09T17:23:00Z');
const runtime = {
  revision: null,
  activeGames: 0,
  databaseRequired: false,
  persistence: 'enabled' as const,
  persistenceErrors: { count1m: 0, lastAt: null },
};
const content = await collectContentReadout(now, { apiKey: '' });
function database(options: { existing?: unknown; stored?: unknown } = {}) {
  const statements: string[] = [];
  const query = async (sql: string) => {
    statements.push(sql);
    if (sql.includes('WHERE snapshot_key = $1'))
      return { rows: options.existing ? [{ payload: options.existing }] : [] };
    if (sql.includes("payload->'content'"))
      return { rows: options.stored ? [{ payload: { content: options.stored } }] : [] };
    return { rows: [] };
  };
  const db = { query, connect: async () => ({ query, release() {} }) } as unknown as pg.Pool;
  return { db, statements };
}
test('scheduled reuse returns old snapshots before querying external data or connecting a transaction', async () => {
  const old = {
    kind: 'mistboard-readout',
    schemaVersion: 1,
    snapshotId: 'old',
    decisionFingerprint: 'old',
  };
  const { db, statements } = database({ existing: old });
  let calls = 0;
  const r = await generateMistboardReadout({
    trigger: 'weekly',
    now,
    runtime,
    db,
    contentCollect: async () => {
      calls++;
      return content;
    },
  });
  assert.equal(r.reused, true);
  assert.equal(calls, 0);
  assert.equal(statements.length, 1);
  assert.equal(r.report.content, undefined);
});
test('daily reuses successful stored content with its source timestamp, while bootstrap/weekly fetch outside the transaction', async () => {
  const stored = { ...content, status: 'available' as const, collectedAt: '2026-11-02T17:23:00Z' };
  const { db, statements } = database({ stored });
  let calls = 0;
  const daily = await generateMistboardReadout({
    trigger: 'daily',
    now,
    runtime,
    db,
    contentCollect: async () => {
      calls++;
      return content;
    },
  });
  assert.equal(calls, 0);
  assert.equal(daily.report.content?.collectedAt, stored.collectedAt);
  assert.ok(statements.some((s) => s.startsWith('INSERT')));
  for (const trigger of ['daily', 'weekly'] as const) {
    const fixture = database();
    let invoked = 0;
    await generateMistboardReadout({
      trigger,
      now,
      runtime,
      db: fixture.db,
      contentCollect: async () => {
        invoked++;
        assert.ok(!fixture.statements.includes('BEGIN'));
        return content;
      },
    });
    assert.equal(invoked, 1);
  }
});
test('dry-run collects once outside lock, never persists and remains un-reused', async () => {
  const { db, statements } = database();
  let calls = 0;
  const result = await generateMistboardReadout({
    trigger: 'weekly',
    now,
    runtime,
    db,
    dryRun: true,
    contentCollect: async () => {
      calls++;
      return content;
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.reused, false);
  assert.equal(result.report.content, content);
  assert.ok(!statements.some((s) => /BEGIN|INSERT|advisory/.test(s)));
});
