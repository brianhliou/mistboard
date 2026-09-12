// Server-side source of the SERVED puzzle corpus (#183).
//
// Puzzle content lives in the `puzzles` table (see migrations/105_puzzles.sql);
// the committed seed assets in packages/game/seed/ are synced into it here, on
// first use, gated on a content hash. That makes deploys zero-manual-ops: a
// `git push` that changes the seed re-syncs on the next puzzle request, an
// unchanged deploy is a no-op, and miner-appended rows (source_kind='mined')
// are never touched by the reconciliation.
//
// Persistence-off runtimes (dev:memory, unit tests) serve the seed directly —
// the same corpus, the same order — so the puzzle surface behaves identically
// without Postgres.
//
// Serving order is the `seq` column (registry concatenation order, matching
// the pre-#183 in-memory aggregation); the snapshot caches rows in memory with
// a short TTL so routes stay array-shaped and miner inserts show up without a
// restart. Rows whose variant is not a known puzzle variant are SKIPPED with a
// warning (fail-closed: unknown variants never reach dispatch).

import {
  deriveXiangqiPuzzleDifficulty,
  detectXiangqiPuzzleMotifs,
  FORTRESS_XIANGQI_SPEC_ID,
  type FortressXiangqiPuzzle,
  isRetiredGameSpec,
  JUNGLE_SPEC_ID,
  type JunglePuzzle,
  XIANGQI_SPEC_ID,
  type XiangqiMotifId,
  type XiangqiPuzzle,
} from '@mistboard/game';
import {
  loadAllSeedPuzzles,
  loadSeedSourceGames,
  seedPuzzleContentHash,
} from '@mistboard/game/puzzle-seed';
import type pg from 'pg';
import { getPool, isInitialized, withTransaction } from './persistence-db.js';

export type StoredPuzzle = FortressXiangqiPuzzle | JunglePuzzle | XiangqiPuzzle;

export type PuzzleStoreSnapshot = {
  // Every stored puzzle (including hidden-from-discovery variants), seq order.
  puzzles: readonly StoredPuzzle[];
  byId: ReadonlyMap<string, StoredPuzzle>;
  // Offline difficulty prior per standard-xiangqi puzzle, derived here rather
  // than stored. It is a pure function of the puzzle record, so deriving it
  // alongside the snapshot cannot drift from the content the way a column
  // would, and every future mined batch gets a difficulty without the
  // publication path having to remember to populate one. Measured at 0.073ms
  // per puzzle, ~120ms for the whole 1,605-puzzle corpus, once per snapshot.
  //
  // A real `difficulty` column is still wanted the day selection moves
  // server-side and needs a SQL band query (#302); until then this is the same
  // number with none of the backfill surface.
  difficultyById: ReadonlyMap<string, number>;
  // Named kill patterns (杀法) per standard-xiangqi checkmate puzzle, derived
  // the same way and for the same reasons (#324): a pure function of the
  // solution line, 0.17ms per puzzle, so it can never disagree with the
  // record it describes. The column #302 anticipates arrives with the SQL
  // band query that needs it. Only puzzles with at least one motif appear.
  motifsById: ReadonlyMap<string, readonly XiangqiMotifId[]>;
  source: 'database' | 'seed';
};

const KNOWN_PUZZLE_VARIANTS: ReadonlySet<string> = new Set([
  FORTRESS_XIANGQI_SPEC_ID,
  JUNGLE_SPEC_ID,
  XIANGQI_SPEC_ID,
]);

const SEED_SYNC_SLOT = 'puzzles';
const SEED_SYNC_LOCK_KEY = 'mistboard:puzzle-seed-sync';
// Short enough that miner-appended rows show up without a redeploy, long
// enough that the row scan never sits on the request hot path.
const SNAPSHOT_TTL_MS = 5 * 60_000;

let snapshot: PuzzleStoreSnapshot | null = null;
let snapshotLoadedAt = 0;
let seedSyncChecked = false;
let inFlight: Promise<PuzzleStoreSnapshot> | null = null;

export function resetPuzzleStoreForTests(): void {
  snapshot = null;
  snapshotLoadedAt = 0;
  seedSyncChecked = false;
  inFlight = null;
}

export async function getPuzzleStore(): Promise<PuzzleStoreSnapshot> {
  if (!isInitialized()) {
    if (snapshot?.source !== 'seed') {
      snapshot = buildSnapshot(loadAllSeedPuzzles() as readonly StoredPuzzle[], 'seed');
    }
    return snapshot;
  }
  if (
    snapshot &&
    snapshot.source === 'database' &&
    Date.now() - snapshotLoadedAt < SNAPSHOT_TTL_MS
  ) {
    return snapshot;
  }
  if (!inFlight) {
    inFlight = loadFromDatabase().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function loadFromDatabase(): Promise<PuzzleStoreSnapshot> {
  if (!seedSyncChecked) {
    await ensureSeedSynced();
    seedSyncChecked = true;
  }
  // hidden_reason IS NULL is the serving set. A puzzle is withheld rather than
  // deleted (migration 129): the set this hides asks the solver nothing, which
  // no rating can fix, but re-mining to recover one is expensive and the reason
  // string is worth keeping. Clearing the column serves it again.
  const { rows } = await getPool().query<{ data: StoredPuzzle }>(
    'SELECT data FROM puzzles WHERE hidden_reason IS NULL ORDER BY seq, id',
  );
  const puzzles: StoredPuzzle[] = [];
  for (const row of rows) {
    // Fail-closed: a row with an unknown variant (bad insert, future variant
    // deployed out of order) is withheld from serving, never dispatched.
    if (!KNOWN_PUZZLE_VARIANTS.has(row.data.variant)) {
      console.warn(`puzzle-store: skipping puzzle ${row.data.id} with unknown variant`, {
        variant: row.data.variant,
      });
      continue;
    }
    puzzles.push(row.data);
  }
  snapshot = buildSnapshot(puzzles, 'database');
  snapshotLoadedAt = Date.now();
  return snapshot;
}

function buildSnapshot(
  puzzles: readonly StoredPuzzle[],
  source: PuzzleStoreSnapshot['source'],
): PuzzleStoreSnapshot {
  const difficultyById = new Map<string, number>();
  const motifsById = new Map<string, readonly XiangqiMotifId[]>();
  for (const puzzle of puzzles) {
    if (puzzle.variant !== XIANGQI_SPEC_ID) continue;
    try {
      difficultyById.set(puzzle.id, deriveXiangqiPuzzleDifficulty(puzzle).score);
      const motifs = detectXiangqiPuzzleMotifs(puzzle);
      if (motifs.length > 0) motifsById.set(puzzle.id, motifs);
    } catch (error) {
      // A puzzle whose line will not replay still has to serve; it simply
      // falls back to the depth-only seed rating at the call site.
      console.warn(`puzzle-store: difficulty derivation failed for ${puzzle.id}`, {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    puzzles,
    byId: new Map(puzzles.map((puzzle) => [puzzle.id, puzzle])),
    difficultyById,
    motifsById,
    source,
  };
}

// Upsert the committed seed corpus into the puzzles/puzzle_source_games tables.
// Hash-gated (a no-op on every boot after an unchanged deploy) and fully
// reconciling when the seed changed: seed-owned rows are upserted AND removed
// when they left the seed, miner-owned rows are never touched. Runs inside one
// transaction under an advisory lock so concurrent first requests (or several
// server processes) cannot interleave.
/** The hidden_reason a retired variant's puzzles carry (matches migration 143). */
export const RETIRED_VARIANT_HIDDEN_REASON = 'retired-variant';

async function ensureSeedSynced(): Promise<void> {
  const seedHash = seedPuzzleContentHash();
  const current = await readSyncedHash(getPool());
  if (current === seedHash) return;

  await withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [SEED_SYNC_LOCK_KEY]);
    // Another process may have completed the sync while we waited on the lock.
    if ((await readSyncedHash(client)) === seedHash) return;

    const puzzles = loadAllSeedPuzzles();
    for (const [index, puzzle] of puzzles.entries()) {
      // A seed puzzle of a retired variant (docs-private/variant-retirement-
      // plan.md, #396) is stored withheld, whatever order the migration that
      // withholds existing rows (143) and this sync run in: a fresh database
      // seeds after migrating, and without this the retired puzzles came back.
      // A reason already on the row is never cleared; the seed's rows go in
      // Stage 2 of the plan.
      const hiddenReason = isRetiredGameSpec(puzzle.variant) ? RETIRED_VARIANT_HIDDEN_REASON : null;
      await client.query(
        `INSERT INTO puzzles (id, variant, title, seq, goal_type, themes, solution_plies, data, source_kind, hidden_reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'seed', $9)
         ON CONFLICT (id) DO UPDATE SET
           variant = EXCLUDED.variant,
           title = EXCLUDED.title,
           seq = EXCLUDED.seq,
           goal_type = EXCLUDED.goal_type,
           themes = EXCLUDED.themes,
           solution_plies = EXCLUDED.solution_plies,
           data = EXCLUDED.data,
           source_kind = 'seed',
           hidden_reason = COALESCE(puzzles.hidden_reason, EXCLUDED.hidden_reason)`,
        [
          puzzle.id,
          puzzle.variant,
          puzzle.title,
          index,
          puzzle.goal.type,
          [...puzzle.themes],
          puzzle.solution.length,
          JSON.stringify(puzzle),
          hiddenReason,
        ],
      );
    }
    await client.query(
      `DELETE FROM puzzles WHERE source_kind = 'seed' AND NOT (id = ANY($1::text[]))`,
      [puzzles.map((puzzle) => puzzle.id)],
    );

    const sourceGames = loadSeedSourceGames();
    const games = [...sourceGames.jungle, ...sourceGames.fortressXiangqi];
    for (const game of games) {
      await client.query(
        `INSERT INTO puzzle_source_games (id, variant, data, source_kind)
         VALUES ($1, $2, $3, 'seed')
         ON CONFLICT (id) DO UPDATE SET
           variant = EXCLUDED.variant,
           data = EXCLUDED.data,
           source_kind = 'seed'`,
        [game.id, game.variant, JSON.stringify(game)],
      );
    }
    await client.query(
      `DELETE FROM puzzle_source_games WHERE source_kind = 'seed' AND NOT (id = ANY($1::text[]))`,
      [games.map((game) => game.id)],
    );

    await client.query(
      `INSERT INTO puzzle_seed_sync (slot, seed_hash, synced_at)
       VALUES ($1, $2, now())
       ON CONFLICT (slot) DO UPDATE SET seed_hash = EXCLUDED.seed_hash, synced_at = now()`,
      [SEED_SYNC_SLOT, seedHash],
    );
    console.log(
      `puzzle-store: seed sync applied (${puzzles.length} puzzles, ${games.length} source games, hash ${seedHash.slice(0, 12)})`,
    );
  });
}

type Queryable = {
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<pg.QueryResult<T>>;
};

async function readSyncedHash(db: Queryable): Promise<string | null> {
  const { rows } = await db.query<{ seed_hash: string }>(
    'SELECT seed_hash FROM puzzle_seed_sync WHERE slot = $1',
    [SEED_SYNC_SLOT],
  );
  return rows[0]?.seed_hash ?? null;
}
