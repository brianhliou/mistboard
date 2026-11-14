#!/usr/bin/env node
// Preview a bounded reviewed hold; mutations require --apply and the exact
// externally approved plan hash. No content, attempts or ratings are edited.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { closeSync, fsyncSync, openSync, readFileSync, writeSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import pg from 'pg';

export const HOLD_PLAN_FORMAT = 'puzzle-quality-hold-v1';
const HASH = /^[a-f0-9]{64}$/;
const REASONS = new Set(['no-choice-at-root', 'mate-not-unique']);
export const puzzleContentHash = (puzzle) =>
  createHash('sha256').update(JSON.stringify(puzzle)).digest('hex');
export const holdPlanHash = (text) => createHash('sha256').update(text).digest('hex');

export function readHoldPlan(text, expectedSha256) {
  assert.match(expectedSha256 ?? '', HASH, 'Exact plan SHA-256 required');
  assert.equal(holdPlanHash(text), expectedSha256, 'Plan hash mismatch');
  const plan = JSON.parse(text);
  assert.equal(plan.format, HOLD_PLAN_FORMAT, 'Unsupported plan format');
  assert.match(plan.auditExecutionId ?? '', HASH, 'Missing audit execution identity');
  assert.match(plan.servingSnapshotSha256 ?? '', HASH, 'Missing serving snapshot identity');
  assert.ok(
    Array.isArray(plan.entries) && plan.entries.length > 0 && plan.entries.length <= 150,
    'Plan must contain 1 to 150 reviewed entries',
  );
  const ids = new Set();
  for (const entry of plan.entries) {
    assert.ok(
      typeof entry.id === 'string' && entry.id.length > 0 && entry.id.length <= 200,
      'Invalid puzzle id',
    );
    assert.ok(!ids.has(entry.id), 'Duplicate plan id');
    ids.add(entry.id);
    assert.match(entry.expectedPuzzleHash ?? '', HASH, 'Missing expected puzzle content hash');
    assert.ok(REASONS.has(entry.reason), 'Unreviewed hold reason');
    assert.ok(
      Number.isInteger(entry.solutionPly) && entry.solutionPly >= 0 && entry.solutionPly % 2 === 0,
      'Missing solver-turn location',
    );
    if (entry.reason === 'no-choice-at-root')
      assert.equal(entry.solutionPly, 0, 'Forced-start holds require the root');
  }
  return { plan, marker: `puzzle-quality-policy:${expectedSha256}` };
}

/** The caller supplies a connection, never an arbitrary SQL statement. All
 * records are checked before the one conditional update; a mismatch rolls
 * back the entire batch. Restore releases only this exact plan's own holds. */
export async function executeHoldPlan(
  client,
  { planText, expectedSha256, apply = false, action = 'hold' },
) {
  assert.ok(action === 'hold' || action === 'restore', 'Unknown action');
  assert.equal(typeof apply, 'boolean', 'Apply must be an explicit boolean');
  const { plan, marker } = readHoldPlan(planText, expectedSha256);
  await client.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');
  try {
    await client.query("SET LOCAL statement_timeout = '20s'");
    await client.query("SET LOCAL lock_timeout = '5s'");
    const { rows } = await client.query(
      `SELECT id, variant, source_kind, data, hidden_reason FROM puzzles
       WHERE id = ANY($1::text[]) ORDER BY id${apply ? ' FOR UPDATE' : ''}`,
      [plan.entries.map((entry) => entry.id)],
    );
    const byId = new Map(rows.map((row) => [row.id, row]));
    assert.equal(byId.size, plan.entries.length, 'A selected puzzle is missing');
    const entries = plan.entries.map((entry) => {
      const row = byId.get(entry.id);
      assert.equal(row.variant, 'xiangqi', `Wrong variant: ${entry.id}`);
      assert.equal(row.source_kind, 'mined', `Wrong source ownership: ${entry.id}`);
      assert.equal(
        puzzleContentHash(row.data),
        entry.expectedPuzzleHash,
        `Stale puzzle content: ${entry.id}`,
      );
      assert.equal(row.data.id, entry.id, `Wrong payload identity: ${entry.id}`);
      assert.ok(
        entry.solutionPly < row.data.solution.length,
        `Wrong solver-turn location: ${entry.id}`,
      );
      const eligible =
        action === 'hold' ? row.hidden_reason === null : row.hidden_reason === marker;
      return {
        id: entry.id,
        expectedPuzzleHash: entry.expectedPuzzleHash,
        beforeHiddenReason: row.hidden_reason,
        afterHiddenReason: eligible ? (action === 'hold' ? marker : null) : row.hidden_reason,
        eligible,
      };
    });
    const selected = entries.filter((entry) => entry.eligible).map((entry) => entry.id);
    if (apply && selected.length) {
      const updated = await client.query(
        `UPDATE puzzles SET hidden_reason = $2
         WHERE id = ANY($1::text[]) AND variant = 'xiangqi' AND source_kind = 'mined'
           AND hidden_reason IS NOT DISTINCT FROM $3 RETURNING id`,
        [selected, action === 'hold' ? marker : null, action === 'hold' ? null : marker],
      );
      assert.equal(updated.rowCount, selected.length, 'Serving state changed during the batch');
    }
    await client.query('COMMIT');
    return {
      format: 'puzzle-quality-hold-receipt-v1',
      at: new Date().toISOString(),
      planSha256: expectedSha256,
      auditExecutionId: plan.auditExecutionId,
      marker,
      action,
      applied: apply,
      selected: entries.length,
      eligible: selected.length,
      changed: apply ? selected.length : 0,
      preserved: entries.length - selected.length,
      entries,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      plan: { type: 'string' },
      'plan-sha256': { type: 'string' },
      out: { type: 'string' },
      action: { type: 'string', default: 'hold' },
      apply: { type: 'boolean', default: false },
    },
  });
  assert.ok(
    values.plan && values.out,
    '--plan PATH --plan-sha256 SHA --out NEW_RECEIPT.jsonl required',
  );
  const planText = readFileSync(values.plan, 'utf8');
  readHoldPlan(planText, values['plan-sha256']);
  // Reserve and fsync the receipt before any database work. If acknowledgment
  // is lost after commit, the plan marker supports a safe idempotent recheck.
  const fd = openSync(values.out, 'wx', 0o600);
  const journal = (event) => {
    writeSync(fd, `${JSON.stringify(event)}\n`);
    fsyncSync(fd);
  };
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    journal({
      phase: 'prepared',
      planSha256: values['plan-sha256'],
      action: values.action,
      apply: values.apply,
      at: new Date().toISOString(),
    });
    await client.connect();
    const receipt = await executeHoldPlan(client, {
      planText,
      expectedSha256: values['plan-sha256'],
      apply: values.apply,
      action: values.action,
    });
    journal({ phase: 'transaction-completed', ...receipt });
    const { entries: _, ...summary } = receipt;
    console.log(JSON.stringify({ ...summary, receipt: resolve(values.out) }));
  } catch (error) {
    journal({ phase: 'failed-or-unconfirmed', code: error.code ?? error.name });
    throw error;
  } finally {
    await client.end().catch(() => {});
    closeSync(fd);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(JSON.stringify({ failedOrUnconfirmed: true, code: error.code ?? error.name }));
    process.exitCode = 1;
  });
}
