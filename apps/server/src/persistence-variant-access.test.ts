import assert from 'node:assert/strict';
import test from 'node:test';
import type pg from 'pg';

import {
  ALLOWLISTED_GAME_SPEC_IDS,
  isAllowlistedGameSpec,
  mayPlayVariant,
} from './persistence-variant-access.js';

// A fake `pg` surface: enough to prove the query path without Postgres. The
// Postgres-backed behaviour (the table, the upsert) is covered by the
// persistent suite; what matters here is the fail-closed decision tree, which
// is the part that can silently let a stranger in.
function db(rowCount: number | null) {
  const calls: { text: string; values: unknown[] }[] = [];
  const pool = {
    query: async (text: string, values: unknown[]) => {
      calls.push({ text, values });
      return { rowCount, rows: [] };
    },
  } as unknown as pg.Pool;
  return { calls, pool };
}

test('mahjong is allowlisted and a normal variant is not', () => {
  assert.equal(isAllowlistedGameSpec('mahjong'), true);
  assert.equal(isAllowlistedGameSpec('xiangqi'), false);
  assert.equal(isAllowlistedGameSpec('not-a-spec'), false);
  assert.deepEqual([...ALLOWLISTED_GAME_SPEC_IDS], ['mahjong']);
});

test('a non-allowlisted variant is allowed without touching the database', async () => {
  // Every other variant sits on this path on every seat assignment, so it must
  // not cost a query.
  const { pool, calls } = db(0);
  assert.equal(await mayPlayVariant('user-1', 'xiangqi', pool), true);
  assert.equal(await mayPlayVariant(null, 'xiangqi', pool), true);
  assert.deepEqual(calls, []);
});

test('the short-circuit paths never reach for a pool', async () => {
  // Passing no database at all is the case the other tests cannot see: a
  // default argument would resolve getPool() here and throw "persistence not
  // initialized", which is exactly what happened to every in-memory ws test
  // when this call was first added to seat assignment.
  assert.equal(await mayPlayVariant('user-1', 'xiangqi'), true);
  assert.equal(await mayPlayVariant(null, 'xiangqi'), true);
  assert.equal(await mayPlayVariant(null, 'mahjong'), false);
});

test('a signed-out visitor is refused an allowlisted variant, without a query', async () => {
  // A grant is per account, so there is nothing to look up for a guest.
  const { pool, calls } = db(1);
  assert.equal(await mayPlayVariant(null, 'mahjong', pool), false);
  assert.deepEqual(calls, []);
});

test('an account is allowed only when a grant row exists', async () => {
  const granted = db(1);
  assert.equal(await mayPlayVariant('user-1', 'mahjong', granted.pool), true);
  assert.equal(granted.calls.length, 1);
  assert.deepEqual(granted.calls[0]?.values, ['user-1', 'mahjong']);

  const ungranted = db(0);
  assert.equal(await mayPlayVariant('user-2', 'mahjong', ungranted.pool), false);
});

test('a null rowCount reads as no grant, not as access', async () => {
  // node-postgres types rowCount as nullable. Treating null as truthy here
  // would be the difference between a closed variant and an open one.
  const { pool } = db(null);
  assert.equal(await mayPlayVariant('user-1', 'mahjong', pool), false);
});
