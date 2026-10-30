// planSeedSync is the dry run of the boot-time seed sync (#712). The planted
// case: prod holds a seed row the candidate seed no longer names, which the
// real sync would DELETE. The plan must report that delete and issue no write.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { seedPuzzleContentHash } from '@mistboard/game/puzzle-seed';
import type pg from 'pg';
import {
  planSeedSync,
  type SeedSyncInput,
  type SeedSyncQueryable,
  seedSyncContentHash,
} from './puzzle-seed-sync-plan.js';

type Row = {
  id: string;
  variant: string;
  seq: number;
  source_kind: string;
  hidden_reason: string | null;
  data: string;
};

function puzzle(id: string, title = id) {
  return {
    id,
    variant: 'xiangqi',
    title,
    initial: {},
    solution: [{ from: 1, to: 2 }],
    goal: { type: 'material' },
    themes: [],
  };
}

function fakeDb(rows: Row[], sideTables: Record<string, string[]> = {}) {
  const writes: string[] = [];
  const db: SeedSyncQueryable = {
    async query<T extends pg.QueryResultRow>(text: string, values: readonly unknown[] = []) {
      const sql = text.trim();
      if (!/^SELECT\b/i.test(sql)) {
        writes.push(sql);
        throw new Error(`write attempted: ${sql}`);
      }
      const result = (r: unknown[]) => ({ rows: r }) as unknown as pg.QueryResult<T>;
      if (sql.includes('FROM puzzle_seed_sync')) return result([{ seed_hash: 'old' }]);
      if (sql.includes('FROM puzzle_source_games')) return result([]);
      const ids = (values[0] as string[]) ?? [];
      if (sql.includes("source_kind = 'seed' AND NOT")) {
        return result(rows.filter((row) => row.source_kind === 'seed' && !ids.includes(row.id)));
      }
      if (sql.includes("source_kind <> 'seed'")) {
        const n = rows.filter(
          (row) =>
            row.source_kind !== 'seed' && !ids.includes(row.id) && row.seq < Number(values[1]),
        ).length;
        return result([{ n: String(n) }]);
      }
      if (sql.includes('FROM puzzles WHERE id = ANY')) {
        return result(rows.filter((row) => ids.includes(row.id)));
      }
      const table = /FROM (\w+) WHERE puzzle_id/.exec(sql)?.[1];
      if (table) {
        const n = (sideTables[table] ?? []).filter((id) => ids.includes(id)).length;
        return result([{ n: String(n) }]);
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  return { db, writes };
}

const emptyJungle = JSON.stringify({ registry: 'jungle', puzzles: [] });
const noGames = JSON.stringify({ games: [] });

function input(puzzles: unknown[]): SeedSyncInput {
  return {
    registries: [
      { registry: 'jungle', text: emptyJungle },
      { registry: 'xiangqi', text: JSON.stringify({ registry: 'xiangqi', puzzles }) },
    ],
    sourceGamesText: noGames,
  };
}

test('planted dropped seed row: the plan reports the delete and writes nothing', async () => {
  const kept = puzzle('xq-mined-kept');
  const rows: Row[] = [
    // Unchanged: same data and seq.
    {
      id: kept.id,
      variant: 'xiangqi',
      seq: 0,
      source_kind: 'seed',
      hidden_reason: null,
      data: JSON.stringify(kept),
    },
    // Planted: a seed row a re-mine did not re-find. The real sync deletes it.
    {
      id: 'xq-mined-gone',
      variant: 'xiangqi',
      seq: 1,
      source_kind: 'seed',
      hidden_reason: null,
      data: '{}',
    },
    // Moved: content changed, still in the seed, and already withheld.
    {
      id: 'xq-mined-moved',
      variant: 'xiangqi',
      seq: 9,
      source_kind: 'seed',
      hidden_reason: 'already-won-free-capture',
      data: '{}',
    },
    // A pilot-published row the seed now also names.
    {
      id: 'xq-mined-pilot',
      variant: 'xiangqi',
      seq: 500,
      source_kind: 'mined',
      hidden_reason: null,
      data: '{}',
    },
    // A pilot row the seed does not name, sitting inside the seed's seq range.
    {
      id: 'xq-mined-other',
      variant: 'xiangqi',
      seq: 2,
      source_kind: 'mined',
      hidden_reason: null,
      data: '{}',
    },
  ];
  const { db, writes } = fakeDb(rows, {
    puzzle_quality_sessions: ['xq-mined-gone', 'xq-mined-gone', 'xq-mined-kept'],
    puzzle_attempts: ['xq-mined-gone'],
  });

  const plan = await planSeedSync(
    db,
    input([
      kept,
      puzzle('xq-mined-moved', 'new title'),
      puzzle('xq-mined-pilot'),
      puzzle('xq-mined-new'),
    ]),
  );

  assert.deepEqual(writes, [], 'a dry run issues no write');
  assert.equal(plan.wouldRun, true);
  assert.deepEqual(
    plan.puzzles.delete.map((row) => row.id),
    ['xq-mined-gone'],
  );
  assert.deepEqual(plan.puzzles.insert, ['xq-mined-new']);
  assert.deepEqual(plan.puzzles.skip, ['xq-mined-kept']);
  assert.deepEqual(plan.puzzles.update, [
    { id: 'xq-mined-moved', changes: ['data', 'seq'] },
    { id: 'xq-mined-pilot', changes: ['data', 'seq', 'source_kind'] },
  ]);
  assert.deepEqual(plan.puzzles.withhold, [
    { id: 'xq-mined-moved', reason: 'already-won-free-capture' },
  ]);
  assert.deepEqual(plan.claimsNonSeed, ['xq-mined-pilot']);
  assert.equal(plan.nonSeedSeqInsideSeedRange, 1);
  assert.deepEqual(plan.deleteFallout, {
    qualitySessionsCascaded: 2,
    attemptsOrphaned: 1,
    ratingsOrphaned: 0,
  });
});

test('the plan refuses a non-SELECT even if the database would accept it', async () => {
  const executed: string[] = [];
  const permissive: SeedSyncQueryable = {
    async query<T extends pg.QueryResultRow>(text: string) {
      executed.push(text);
      return { rows: [] } as unknown as pg.QueryResult<T>;
    },
  };
  await planSeedSync(permissive, input([puzzle('xq-mined-a')]));
  for (const sql of executed) assert.match(sql.trim(), /^SELECT\b/i);
});

test('the plan hashes the committed seed exactly as the sync gate does', () => {
  const seedDir = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    'packages',
    'game',
    'seed',
  );
  const read = (rel: string) => readFileSync(join(seedDir, rel), 'utf-8');
  const committed: SeedSyncInput = {
    registries: ['jungle', 'xiangqi'].map((registry) => ({
      registry,
      text: read(`puzzles/${registry}.json`),
    })),
    sourceGamesText: read('source-games/jungle.json'),
  };
  assert.equal(seedSyncContentHash(committed), seedPuzzleContentHash());
});
