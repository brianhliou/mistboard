import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import { loadAllSeedPuzzles } from '../packages/game/dist/puzzle-seed.js';
import { DEFAULT_TEST_DATABASE_URL, ensureTestDatabase } from './ensure-test-database.mjs';
import {
  executeHoldPlan,
  HOLD_PLAN_FORMAT,
  holdPlanHash,
  puzzleContentHash,
  readHoldPlan,
} from './puzzle-quality-hold.mjs';

const seed = loadAllSeedPuzzles().find((puzzle) => puzzle.variant === 'xiangqi');
function fixture() {
  const rows = ['quality-a', 'quality-b', 'quality-c'].map((id) => ({
    id,
    variant: 'xiangqi',
    source_kind: 'mined',
    hidden_reason: null,
    data: { ...structuredClone(seed), id },
  }));
  const plan = {
    format: HOLD_PLAN_FORMAT,
    auditExecutionId: 'a'.repeat(64),
    servingSnapshotSha256: 'b'.repeat(64),
    entries: rows.map((row) => ({
      id: row.id,
      expectedPuzzleHash: puzzleContentHash(row.data),
      reason: 'mate-not-unique',
      solutionPly: 0,
    })),
  };
  const planText = JSON.stringify(plan);
  return { rows, plan, options: { planText, expectedSha256: holdPlanHash(planText) } };
}

function memoryClient(rows) {
  return {
    rows: structuredClone(rows),
    calls: [],
    transaction: null,
    updatedCount: null,
    async query(sql, args = []) {
      this.calls.push({ sql, args });
      if (sql.startsWith('BEGIN')) this.transaction = structuredClone(this.rows);
      if (sql.startsWith('SELECT'))
        return { rows: this.rows.filter((row) => args[0].includes(row.id)) };
      if (sql.startsWith('UPDATE')) {
        let count = 0;
        for (const row of this.rows) {
          if (args[0].includes(row.id) && row.hidden_reason === args[2]) {
            row.hidden_reason = args[1];
            count++;
          }
        }
        return { rowCount: this.updatedCount ?? count };
      }
      if (sql === 'ROLLBACK') this.rows = this.transaction;
      return { rows: [] };
    },
  };
}

test('default preview is read-only and has no serving-state writes', async () => {
  const f = fixture();
  const db = memoryClient(f.rows);
  const receipt = await executeHoldPlan(db, f.options);
  assert.equal(receipt.changed, 0);
  assert.equal(receipt.eligible, 3);
  assert.deepEqual(db.rows, f.rows);
  assert.equal(db.calls[0].sql, 'BEGIN READ ONLY');
  assert.ok(!db.calls.some(({ sql }) => /UPDATE|DELETE|INSERT|FOR UPDATE/.test(sql)));
});

test('hold changes only active records, preserves other holds and is idempotent', async () => {
  const f = fixture();
  const db = memoryClient(f.rows);
  db.rows[1].hidden_reason = 'reported-puzzle-retired';
  const content = db.rows.map((row) => JSON.stringify(row.data));
  const result = await executeHoldPlan(db, { ...f.options, apply: true });
  assert.equal(result.changed, 2);
  assert.equal(result.preserved, 1);
  assert.equal(db.rows[1].hidden_reason, 'reported-puzzle-retired');
  assert.deepEqual(
    db.rows.map((row) => JSON.stringify(row.data)),
    content,
  );
  assert.ok(db.calls.find(({ sql }) => sql.startsWith('SELECT')).sql.endsWith('FOR UPDATE'));
  const again = await executeHoldPlan(db, { ...f.options, apply: true });
  assert.equal(again.changed, 0);
  assert.equal(db.calls.filter(({ sql }) => sql.startsWith('UPDATE')).length, 1);
});

test('restore releases only this plan marker and cannot clear another editorial hold', async () => {
  const f = fixture();
  const db = memoryClient(f.rows);
  await executeHoldPlan(db, { ...f.options, apply: true });
  db.rows[1].hidden_reason = 'a-later-editorial-decision';
  const restored = await executeHoldPlan(db, { ...f.options, action: 'restore', apply: true });
  assert.equal(restored.changed, 2);
  assert.deepEqual(
    db.rows.map((row) => row.hidden_reason),
    [null, 'a-later-editorial-decision', null],
  );
  const again = await executeHoldPlan(db, { ...f.options, action: 'restore', apply: true });
  assert.equal(again.changed, 0);
});

test('one changed puzzle aborts the whole batch before any update or restore', async () => {
  for (const action of ['hold', 'restore']) {
    const f = fixture();
    const db = memoryClient(f.rows);
    if (action === 'restore') await executeHoldPlan(db, { ...f.options, apply: true });
    db.calls = [];
    db.rows[1].data.title = 'A newly revised puzzle';
    const before = structuredClone(db.rows);
    await assert.rejects(
      executeHoldPlan(db, { ...f.options, action, apply: true }),
      /Stale puzzle content/,
    );
    assert.deepEqual(db.rows, before);
    assert.ok(!db.calls.some(({ sql }) => sql.startsWith('UPDATE')));
    assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
  }
});

test('missing, wrong-variant, seed-owned and wrongly identified rows cannot be changed', async () => {
  for (const change of [
    (rows) => rows.pop(),
    (rows) => {
      rows[1].variant = 'jungle';
    },
    (rows) => {
      rows[1].source_kind = 'seed';
    },
    (rows) => {
      rows[1].data.id = 'different';
    },
  ]) {
    const f = fixture();
    const db = memoryClient(f.rows);
    change(db.rows);
    await assert.rejects(executeHoldPlan(db, { ...f.options, apply: true }));
    assert.ok(!db.calls.some(({ sql }) => sql.startsWith('UPDATE')));
    assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
  }
});

test('wrong plan hashes, duplicate ids, numerical-only reasons and oversized batches fail before SQL', async () => {
  const f = fixture();
  assert.throws(() => readHoldPlan(f.options.planText, '0'.repeat(64)), /Plan hash/);
  for (const change of [
    (plan) => plan.entries.push(plan.entries[0]),
    (plan) => {
      plan.entries[0].reason = 'insufficient-separation';
    },
    (plan) => {
      plan.entries[0].solutionPly = 1;
    },
    (plan) => {
      plan.entries[0].reason = 'no-choice-at-root';
      plan.entries[0].solutionPly = 2;
    },
    (plan) => {
      plan.entries = [];
    },
    (plan) => {
      plan.entries = Array.from({ length: 151 }, (_, i) => ({
        ...plan.entries[0],
        id: `many-${i}`,
      }));
    },
  ]) {
    const plan = structuredClone(f.plan);
    change(plan);
    const planText = JSON.stringify(plan);
    const db = memoryClient(f.rows);
    await assert.rejects(
      executeHoldPlan(db, { planText, expectedSha256: holdPlanHash(planText), apply: true }),
    );
    assert.equal(db.calls.length, 0);
  }
});

test('an unexpected conditional update count rolls back every change', async () => {
  const f = fixture();
  const db = memoryClient(f.rows);
  db.updatedCount = 1;
  await assert.rejects(executeHoldPlan(db, { ...f.options, apply: true }), /Serving state changed/);
  assert.deepEqual(db.rows, f.rows);
  assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
});

test('local Postgres confirms hold/restore and preserves payloads, attempts and ratings', {
  skip: process.env.MISTBOARD_TEST_PUZZLE_HOLD_LOCAL !== '1',
}, async () => {
  await ensureTestDatabase({ databaseUrl: DEFAULT_TEST_DATABASE_URL });
  const client = new pg.Client({ connectionString: DEFAULT_TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query('CREATE TEMP TABLE puzzles (LIKE public.puzzles INCLUDING ALL)');
    await client.query('CREATE TEMP TABLE puzzle_attempts (id text, puzzle_id text, outcome text)');
    await client.query('CREATE TEMP TABLE puzzle_ratings (puzzle_id text, rating integer)');
    const f = fixture();
    for (const [i, row] of f.rows.entries())
      await client.query(
        `INSERT INTO puzzles (id, variant, title, seq, goal_type, solution_plies, data, source_kind)
       VALUES ($1,'xiangqi','Quality fixture',$2,'checkmate',1,$3::json,'mined')`,
        [row.id, i, JSON.stringify(row.data)],
      );
    await client.query(
      "INSERT INTO puzzle_attempts VALUES ('historic-attempt','quality-a','solved')",
    );
    await client.query("INSERT INTO puzzle_ratings VALUES ('quality-a',1600)");
    await client.query(
      "UPDATE puzzles SET hidden_reason = 'unrelated-hold' WHERE id = 'quality-b'",
    );
    const historical = async () => ({
      payloads: (await client.query('SELECT id,data::text FROM puzzles ORDER BY id')).rows,
      attempts: (await client.query('SELECT * FROM puzzle_attempts')).rows,
      ratings: (await client.query('SELECT * FROM puzzle_ratings')).rows,
    });
    const before = await historical();
    const preview = await executeHoldPlan(client, f.options);
    assert.equal(preview.changed, 0);
    assert.equal((await executeHoldPlan(client, { ...f.options, apply: true })).changed, 2);
    assert.equal((await executeHoldPlan(client, { ...f.options, apply: true })).changed, 0);
    assert.deepEqual(await historical(), before);
    assert.equal(
      (await executeHoldPlan(client, { ...f.options, action: 'restore', apply: true })).changed,
      2,
    );
    assert.deepEqual((await client.query('SELECT hidden_reason FROM puzzles ORDER BY id')).rows, [
      { hidden_reason: null },
      { hidden_reason: 'unrelated-hold' },
      { hidden_reason: null },
    ]);
    assert.deepEqual(await historical(), before);
    await client.query(
      "UPDATE puzzles SET data = json_build_object('id',id,'title','changed') WHERE id = 'quality-c'",
    );
    await assert.rejects(
      executeHoldPlan(client, { ...f.options, apply: true }),
      /Stale puzzle content/,
    );
    assert.equal(
      (await client.query('SELECT count(*)::int AS n FROM puzzles WHERE hidden_reason IS NULL'))
        .rows[0].n,
      2,
    );
  } finally {
    await client.end();
  }
});
