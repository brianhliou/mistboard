// Dry run of the puzzle seed sync (#712): print what the boot-time sync in
// puzzle-store.ts would insert, update, skip, withhold and DELETE if the given
// seed were committed and deployed. Writes nothing: every query runs inside a
// READ ONLY transaction that is rolled back, and planSeedSync refuses any
// statement that is not a SELECT.
//
//   npm run prod:db -- npx tsx apps/server/src/puzzle-seed-sync-dry-run.ts
//       (the committed seed, as the next deploy would sync it)
//   ... --mined <run>.seed.json
//       (the seed a miner `--emit-seed` of that run would write: curated
//        entries kept, the whole xq-mined-* section replaced)
//   ... --xiangqi-seed <file>   (a complete candidate xiangqi seed file)
//   ... --json                  (the full plan, every id)

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { planSeedSync, type SeedSyncInput } from './puzzle-seed-sync-plan.js';

const SEED_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'packages',
  'game',
  'seed',
);
const REGISTRIES = ['jungle', 'xiangqi'] as const;

// Same bytes the miner's renderXiangqiSeedFile writes, so the planned hash is
// the hash the committed file would have.
function renderXiangqiSeedFile(puzzles: readonly unknown[]): string {
  const lines = puzzles.map((puzzle) => `    ${JSON.stringify(puzzle)}`);
  return `{\n  "format": "mistboard-puzzle-seed-v1",\n  "registry": "xiangqi",\n  "puzzles": [\n${lines.join(
    ',\n',
  )}\n  ]\n}\n`;
}

const { values } = parseArgs({
  options: {
    mined: { type: 'string' },
    'xiangqi-seed': { type: 'string' },
    json: { type: 'boolean', default: false },
  },
});

const committed = (registry: string) =>
  readFileSync(join(SEED_DIR, 'puzzles', `${registry}.json`), 'utf-8');

let xiangqiText = committed('xiangqi');
if (values['xiangqi-seed']) {
  xiangqiText = readFileSync(resolve(values['xiangqi-seed']), 'utf-8');
} else if (values.mined) {
  const curated = (JSON.parse(xiangqiText) as { puzzles: { id: string }[] }).puzzles.filter(
    (puzzle) => !puzzle.id.startsWith('xq-mined-'),
  );
  const mined = (JSON.parse(readFileSync(resolve(values.mined), 'utf-8')) as { puzzles: unknown[] })
    .puzzles;
  xiangqiText = renderXiangqiSeedFile([...curated, ...mined]);
}

const input: SeedSyncInput = {
  registries: REGISTRIES.map((registry) => ({
    registry,
    text: registry === 'xiangqi' ? xiangqiText : committed(registry),
  })),
  sourceGamesText: readFileSync(join(SEED_DIR, 'source-games', 'jungle.json'), 'utf-8'),
};

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required (run through npm run prod:db)');
const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query('BEGIN TRANSACTION READ ONLY');
  const plan = await planSeedSync(client, input);
  await client.query('ROLLBACK');
  if (values.json) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  } else {
    const p = plan.puzzles;
    const changeCounts: Record<string, number> = {};
    for (const row of p.update) {
      for (const change of row.changes) changeCounts[change] = (changeCounts[change] ?? 0) + 1;
    }
    const lines = [
      `dry run: nothing written`,
      `seed hash ${plan.seedHash.slice(0, 12)}, prod synced ${plan.syncedHash?.slice(0, 12) ?? 'never'}: ${plan.wouldRun ? 'the sync WOULD run' : 'no-op, prod already has this seed'}`,
      `seed puzzles: ${plan.seedPuzzles}`,
      `insert ${p.insert.length}, update ${p.update.length} ${JSON.stringify(changeCounts)}, skip ${p.skip.length}, withhold ${p.withhold.length}, DELETE ${p.delete.length}`,
      `withheld reasons: ${JSON.stringify(countBy(p.withhold.map((row) => row.reason)))}`,
      `deleted rows by variant: ${JSON.stringify(countBy(p.delete.map((row) => row.variant)))}; of them served now: ${p.delete.filter((row) => !row.hiddenReason).length}`,
      `delete fallout: ${JSON.stringify(plan.deleteFallout)}`,
      `non-seed rows the upsert would claim as seed: ${plan.claimsNonSeed.length}`,
      `non-seed rows with seq inside the seed range: ${plan.nonSeedSeqInsideSeedRange}`,
      `source games: insert ${plan.sourceGames.insert.length}, update ${plan.sourceGames.update.length}, skip ${plan.sourceGames.skip.length}, delete ${plan.sourceGames.delete.length}`,
      ...p.delete
        .slice(0, 10)
        .map(
          (row) => `  delete ${row.id}${row.hiddenReason ? ` (hidden: ${row.hiddenReason})` : ''}`,
        ),
      ...(p.delete.length > 10 ? [`  ... ${p.delete.length - 10} more (--json for all)`] : []),
    ];
    process.stdout.write(`${lines.join('\n')}\n`);
  }
} finally {
  await client.end();
}

function countBy(keys: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of keys) out[key] = (out[key] ?? 0) + 1;
  return out;
}
