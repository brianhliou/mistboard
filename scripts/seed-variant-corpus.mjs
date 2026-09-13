// Seed SEVERAL games per variant into the local database, instead of the single
// committed fixture each variant ships with.
//
// Why this exists: fixtures/variant-postgame/<spec>.jsonl is one game's event
// log, so a normal `db:seed:qa` leaves most variants with exactly one finished
// game locally. One game renders a board fine, but it cannot exercise anything
// that aggregates — a games list is a single row, a crosstable has no repeat
// opponent, an opening explorer has nothing to count. Those surfaces then look
// broken locally while being fine in production.
//
// Nothing new is committed. generate-variant-fixtures is deterministic and takes
// a seed, and the room id it derives embeds that seed
// (`<prefix>sample_<seed padded>`), so a different seed is a different game with
// a different id. We generate into a scratch directory, seed it, and delete it.
//
// Safe to re-run: seeding is idempotent per room id, and the seeder's prune only
// removes corpus rows for RETIRED VARIANTS, not for other seeds — so games from
// earlier runs survive rather than being replaced.
//
//   node scripts/seed-variant-corpus.mjs [--games 8]
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = join(repoRoot, 'apps', 'server');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const games = Number.parseInt(arg('games', '8'), 10);
if (!Number.isFinite(games) || games < 1) throw new Error('--games must be a positive integer');

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://mistboard:mistboard@localhost:5435/mistboard';

// Seed 1 is what the committed fixtures already use, so start past it and leave
// the committed corpus alone rather than re-deriving it.
const FIRST_SEED = 101;

function run(label, command, args, env) {
  const result = spawnSync(command, args, {
    cwd: serverDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    throw new Error(`${label} failed (exit ${result.status})`);
  }
  return result.stdout ?? '';
}

const scratch = mkdtempSync(join(tmpdir(), 'mistboard-variant-corpus-'));
let seeded = 0;
try {
  for (let i = 0; i < games; i += 1) {
    const seed = FIRST_SEED + i;
    const outDir = join(scratch, `seed-${seed}`);
    run('generate', 'npx', [
      'tsx',
      'src/generate-variant-fixtures.ts',
      '--seed',
      String(seed),
      '--out',
      outDir,
    ]);
    const out = run('seed', 'npx', ['tsx', 'src/seed-variant-fixtures.ts', '--dir', outDir], {
      DATABASE_URL: databaseUrl,
    });
    const ok = (out.match(/^ {2}ok /gm) ?? []).length;
    seeded += ok;
    console.log(`seed ${seed}: ${ok} variant game(s)`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log(`\ndone. ${seeded} game(s) seeded across ${games} generation(s).`);
