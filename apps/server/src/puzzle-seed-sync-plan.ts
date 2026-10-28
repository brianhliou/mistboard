// Read-only plan of the puzzle seed sync (#712).
//
// The seed sync in puzzle-store.ts (ensureSeedSynced) is the deploy route for
// committed puzzles: on the first puzzle request after a push that changed
// packages/game/seed/, it upserts every seed puzzle AND deletes every
// source_kind='seed' row the seed no longer names. A miner run with
// --emit-seed rewrites the whole xq-mined-* section of the xiangqi seed, so a
// re-mine committed this way silently deletes every mined seed row it did not
// re-find, together with their puzzle_quality_sessions (ON DELETE CASCADE).
//
// planSeedSync answers "what would that sync do to this database" with SELECTs
// only. It mirrors ensureSeedSynced's semantics: seq is the index across all
// registries in SEED_PUZZLE_REGISTRIES order, a row already present is claimed
// as source_kind='seed', an existing hidden_reason is kept (COALESCE) and a
// retired variant's puzzle is stored withheld. puzzle-seed-sync-plan.test.ts
// pins the hash against seedPuzzleContentHash so the two cannot drift on what
// counts as a seed change.
//
// CLI: puzzle-seed-sync-dry-run.ts.

import { createHash } from 'node:crypto';
import { isRetiredGameSpec } from '@mistboard/game';
import type pg from 'pg';

export const SEED_SYNC_SLOT = 'puzzles';
const RETIRED_VARIANT_HIDDEN_REASON = 'retired-variant';

export type SeedSyncQueryable = {
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<pg.QueryResult<T>>;
};

type SeedPuzzleLike = {
  id: string;
  variant: string;
  title: string;
  goal: { type: string };
  themes: readonly string[];
  solution: readonly unknown[];
};

type SeedGameLike = { id: string; variant: string };

/** The raw seed files, exactly the bytes seedPuzzleContentHash reads, in
 *  SEED_PUZZLE_REGISTRIES order. Raw text, so a candidate seed (a re-mine not
 *  yet committed) can be planned without writing it into the repo. */
export type SeedSyncInput = {
  registries: readonly { registry: string; text: string }[];
  sourceGamesText: string;
};

export type SeedSyncPlan = {
  seedHash: string;
  syncedHash: string | null;
  /** False when prod already synced this exact seed: the sync is a no-op. */
  wouldRun: boolean;
  seedPuzzles: number;
  puzzles: {
    insert: string[];
    update: { id: string; changes: ('data' | 'seq' | 'source_kind')[] }[];
    skip: string[];
    /** Seed puzzles that would be stored with a hidden_reason (not served). */
    withhold: { id: string; reason: string }[];
    /** source_kind='seed' rows the seed no longer names. */
    delete: { id: string; variant: string; hiddenReason: string | null }[];
  };
  /** Rows owned by the miner or the pilot publish that the upsert would claim
   *  as seed rows (and so a later seed change could delete). */
  claimsNonSeed: string[];
  /** Non-seed rows whose seq falls inside the seed's 0..N-1 range: their
   *  serving position moves relative to the seed rows. */
  nonSeedSeqInsideSeedRange: number;
  /** Rows the deletes would take with them or leave pointing at nothing. */
  deleteFallout: {
    qualitySessionsCascaded: number;
    attemptsOrphaned: number;
    ratingsOrphaned: number;
  };
  sourceGames: { insert: string[]; update: string[]; skip: string[]; delete: string[] };
};

export function seedSyncContentHash(input: SeedSyncInput): string {
  const hash = createHash('sha256');
  for (const { text } of input.registries) hash.update(text);
  hash.update(input.sourceGamesText);
  return hash.digest('hex');
}

function parsePuzzles(input: SeedSyncInput): SeedPuzzleLike[] {
  return input.registries.flatMap(({ registry, text }) => {
    const parsed = JSON.parse(text) as { registry?: string; puzzles?: SeedPuzzleLike[] };
    if (parsed.registry !== registry || !Array.isArray(parsed.puzzles)) {
      throw new Error(`seed ${registry} has unexpected format/registry`);
    }
    return parsed.puzzles;
  });
}

function assertSelect(sql: string): string {
  // The plan is a dry run: nothing here may write, whatever a caller passes.
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error(`seed sync plan issued a non-SELECT: ${sql}`);
  return sql;
}

export async function planSeedSync(
  db: SeedSyncQueryable,
  input: SeedSyncInput,
): Promise<SeedSyncPlan> {
  const q = <T extends pg.QueryResultRow>(sql: string, values?: readonly unknown[]) =>
    db.query<T>(assertSelect(sql), values);

  const seedHash = seedSyncContentHash(input);
  const synced = await q<{ seed_hash: string }>(
    'SELECT seed_hash FROM puzzle_seed_sync WHERE slot = $1',
    [SEED_SYNC_SLOT],
  );
  const syncedHash = synced.rows[0]?.seed_hash ?? null;

  const puzzles = parsePuzzles(input);
  const ids = puzzles.map((puzzle) => puzzle.id);
  if (new Set(ids).size !== ids.length) throw new Error('seed has duplicate puzzle ids');

  const existing = await q<{
    id: string;
    seq: number;
    source_kind: string;
    hidden_reason: string | null;
    data: string;
  }>(
    `SELECT id, seq, source_kind, hidden_reason, data::text AS data
       FROM puzzles WHERE id = ANY($1::text[])`,
    [ids],
  );
  const byId = new Map(existing.rows.map((row) => [row.id, row]));

  const plan: SeedSyncPlan['puzzles'] = {
    insert: [],
    update: [],
    skip: [],
    withhold: [],
    delete: [],
  };
  const claimsNonSeed: string[] = [];
  for (const [index, puzzle] of puzzles.entries()) {
    const row = byId.get(puzzle.id);
    const reason =
      row?.hidden_reason ??
      (isRetiredGameSpec(puzzle.variant) ? RETIRED_VARIANT_HIDDEN_REASON : null);
    if (reason) plan.withhold.push({ id: puzzle.id, reason });
    if (!row) {
      plan.insert.push(puzzle.id);
      continue;
    }
    const changes: ('data' | 'seq' | 'source_kind')[] = [];
    if (row.data !== JSON.stringify(puzzle)) changes.push('data');
    if (Number(row.seq) !== index) changes.push('seq');
    if (row.source_kind !== 'seed') {
      changes.push('source_kind');
      claimsNonSeed.push(puzzle.id);
    }
    if (changes.length === 0) plan.skip.push(puzzle.id);
    else plan.update.push({ id: puzzle.id, changes });
  }

  const deletes = await q<{ id: string; variant: string; hidden_reason: string | null }>(
    `SELECT id, variant, hidden_reason FROM puzzles
      WHERE source_kind = 'seed' AND NOT (id = ANY($1::text[]))
      ORDER BY seq, id`,
    [ids],
  );
  plan.delete = deletes.rows.map((row) => ({
    id: row.id,
    variant: row.variant,
    hiddenReason: row.hidden_reason,
  }));

  const interleave = await q<{ n: string }>(
    `SELECT count(*)::text AS n FROM puzzles
      WHERE source_kind <> 'seed' AND NOT (id = ANY($1::text[])) AND seq < $2`,
    [ids, puzzles.length],
  );

  const deleteIds = plan.delete.map((row) => row.id);
  const countFor = async (table: string): Promise<number> => {
    if (deleteIds.length === 0) return 0;
    const { rows } = await q<{ n: string }>(
      `SELECT count(*)::text AS n FROM ${table} WHERE puzzle_id = ANY($1::text[])`,
      [deleteIds],
    );
    return Number(rows[0]?.n ?? 0);
  };

  const games = (JSON.parse(input.sourceGamesText) as { games?: SeedGameLike[] }).games ?? [];
  const gameIds = games.map((game) => game.id);
  const gameRows = await q<{ id: string; source_kind: string; data: string }>(
    `SELECT id, source_kind, data::text AS data FROM puzzle_source_games
      WHERE id = ANY($1::text[]) OR source_kind = 'seed'`,
    [gameIds],
  );
  const gameById = new Map(gameRows.rows.map((row) => [row.id, row]));
  const gameIdSet = new Set(gameIds);
  const sourceGames: SeedSyncPlan['sourceGames'] = { insert: [], update: [], skip: [], delete: [] };
  for (const game of games) {
    const row = gameById.get(game.id);
    if (!row) sourceGames.insert.push(game.id);
    else if (row.source_kind !== 'seed' || row.data !== JSON.stringify(game)) {
      sourceGames.update.push(game.id);
    } else sourceGames.skip.push(game.id);
  }
  for (const row of gameRows.rows) {
    if (row.source_kind === 'seed' && !gameIdSet.has(row.id)) sourceGames.delete.push(row.id);
  }

  return {
    seedHash,
    syncedHash,
    wouldRun: seedHash !== syncedHash,
    seedPuzzles: puzzles.length,
    puzzles: plan,
    claimsNonSeed,
    nonSeedSeqInsideSeedRange: Number(interleave.rows[0]?.n ?? 0),
    deleteFallout: {
      qualitySessionsCascaded: await countFor('puzzle_quality_sessions'),
      attemptsOrphaned: await countFor('puzzle_attempts'),
      ratingsOrphaned: await countFor('puzzle_ratings'),
    },
    sourceGames,
  };
}
