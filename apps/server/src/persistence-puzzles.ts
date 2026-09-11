import { createHash } from 'node:crypto';
import {
  FORTRESS_XIANGQI_SPEC_ID,
  type FortressXiangqiPuzzle,
  type MiniXiangqiPuzzle,
  XIANGQI_SPEC_ID,
  type XiangqiPuzzle,
} from '@mistboard/game';
import type pg from 'pg';
import { getPool, isInitialized } from './persistence-db.js';
import { getPuzzleStore, type PuzzleStoreSnapshot } from './puzzle-store.js';

export const DAILY_PUZZLE_HOMEPAGE_SLOT = 'homepage';

// A daily puzzle can be drawn from any surfaced variant; the candidate content
// comes from the puzzle store (#183: the `puzzles` table backed by the
// committed seed, or the seed alone when persistence is off). Ids are
// prefix-disjoint across the registries, so resolution dispatches on the
// stored variant.
type DailyPuzzle = MiniXiangqiPuzzle | FortressXiangqiPuzzle | XiangqiPuzzle;

export type DailyPuzzleSlot = typeof DAILY_PUZZLE_HOMEPAGE_SLOT;

export type DailyPuzzleSelection = {
  day: string;
  persisted: boolean;
  puzzleId: string;
  selectedAt: string | null;
  slot: DailyPuzzleSlot;
  source: string;
  variant: string;
};

export type DailyPuzzleResult = DailyPuzzleSelection & {
  puzzle: DailyPuzzle;
};

type DailyPuzzleSelectionRow = {
  day: string;
  puzzle_id: string;
  selected_at: string;
  slot: string;
  source: string;
  variant: string;
};

type Queryable = {
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<pg.QueryResult<T>>;
};

// The daily rotation draws from standard xiangqi. Fortress is hidden while the
// variant is demoted and its puzzles await a re-mine with the per-ply
// uniqueness gate (they ship the engine's top PV verbatim, so some "solutions"
// are unforced). Restore the Fortress variant here when the re-mined corpus
// lands. Add more variants to broaden the rotation; a variant with no stored
// puzzles simply contributes nothing.
const DAILY_PUZZLE_VARIANTS: readonly string[] = [XIANGQI_SPEC_ID];

// Variants a persisted daily row may resolve against. Broader than the current
// rotation on purpose (Jungle was never a daily variant, so it stays out,
// matching the pre-#183 resolution). Mini and Drop Mini rows used to be here
// for the days that predate the standard-xiangqi rotation; both variants are
// retired and their puzzles withheld (migration 143), so such a row resolves
// to nothing now, the same as any other withheld puzzle.
const DAILY_RESOLVABLE_VARIANTS: ReadonlySet<string> = new Set([
  FORTRESS_XIANGQI_SPEC_ID,
  XIANGQI_SPEC_ID,
]);

function isCurrentDailyVariant(variant: string): boolean {
  return DAILY_PUZZLE_VARIANTS.includes(variant);
}

function dailyPuzzleById(store: PuzzleStoreSnapshot, id: string): DailyPuzzle | null {
  const puzzle = store.byId.get(id);
  if (!puzzle || !DAILY_RESOLVABLE_VARIANTS.has(puzzle.variant)) return null;
  return puzzle as DailyPuzzle;
}

export function currentDailyPuzzleDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function parseDailyPuzzleSlot(value: string | null): DailyPuzzleSlot | null {
  if (value === null || value === '' || value === DAILY_PUZZLE_HOMEPAGE_SLOT) {
    return DAILY_PUZZLE_HOMEPAGE_SLOT;
  }
  return null;
}

export async function getOrCreateDailyPuzzleSelection(
  day: string,
  slot: DailyPuzzleSlot,
): Promise<DailyPuzzleResult> {
  const store = await getPuzzleStore();
  if (!isInitialized()) return ephemeralDailyPuzzleSelection(store, day, slot);

  const pool = getPool();
  const existing = await readDailyPuzzleSelection(pool, day, slot);
  // Keep a persisted selection only if it is still a currently-offered variant;
  // a stale (now-hidden) daily is re-selected to the featured variant.
  const existingPuzzle =
    existing && isCurrentDailyVariant(existing.variant)
      ? dailyPuzzleById(store, existing.puzzle_id)
      : null;
  if (existing && existingPuzzle) return selectionResult(existing, existingPuzzle, true);

  const candidate = selectDailyPuzzleCandidate(store, day, slot);
  const source = existing ? 'auto-recovered' : 'auto';
  const row = existing
    ? await updateDailyPuzzleSelection(pool, day, slot, candidate, source)
    : await insertDailyPuzzleSelection(pool, day, slot, candidate, source);
  const puzzle = dailyPuzzleById(store, row.puzzle_id);
  if (!puzzle) {
    throw new Error(`daily puzzle selection points at missing puzzle ${row.puzzle_id}`);
  }
  return selectionResult(row, puzzle, true);
}

function ephemeralDailyPuzzleSelection(
  store: PuzzleStoreSnapshot,
  day: string,
  slot: DailyPuzzleSlot,
): DailyPuzzleResult {
  const candidate = selectDailyPuzzleCandidate(store, day, slot);
  return {
    day,
    persisted: false,
    puzzle: candidate,
    puzzleId: candidate.id,
    selectedAt: null,
    slot,
    source: 'ephemeral',
    variant: candidate.variant,
  };
}

function selectDailyPuzzleCandidate(
  store: PuzzleStoreSnapshot,
  day: string,
  slot: DailyPuzzleSlot,
): DailyPuzzle {
  const candidates = store.puzzles
    .filter((puzzle) => isCurrentDailyVariant(puzzle.variant))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (candidates.length === 0) throw new Error('no daily puzzle candidates available');
  const seed = createHash('sha256').update(`${day}|${slot}|daily-puzzle-v1`).digest();
  const index = seed.readUInt32BE(0) % candidates.length;
  return candidates[index] as DailyPuzzle;
}

async function readDailyPuzzleSelection(
  db: Queryable,
  day: string,
  slot: DailyPuzzleSlot,
): Promise<DailyPuzzleSelectionRow | null> {
  const { rows } = await db.query<DailyPuzzleSelectionRow>(
    `SELECT day::text, slot, variant, puzzle_id, source, selected_at::text
       FROM puzzle_daily_selections
      WHERE day = $1::date AND slot = $2`,
    [day, slot],
  );
  return rows[0] ?? null;
}

async function insertDailyPuzzleSelection(
  db: Queryable,
  day: string,
  slot: DailyPuzzleSlot,
  puzzle: DailyPuzzle,
  source: string,
): Promise<DailyPuzzleSelectionRow> {
  const inserted = await db.query<DailyPuzzleSelectionRow>(
    `INSERT INTO puzzle_daily_selections (day, slot, variant, puzzle_id, source)
     VALUES ($1::date, $2, $3, $4, $5)
     ON CONFLICT (day, slot) DO NOTHING
     RETURNING day::text, slot, variant, puzzle_id, source, selected_at::text`,
    [day, slot, puzzle.variant, puzzle.id, source],
  );
  if (inserted.rows[0]) return inserted.rows[0];

  const existing = await readDailyPuzzleSelection(db, day, slot);
  if (existing && dailyPuzzleById(await getPuzzleStore(), existing.puzzle_id)) return existing;
  return updateDailyPuzzleSelection(db, day, slot, puzzle, 'auto-recovered');
}

async function updateDailyPuzzleSelection(
  db: Queryable,
  day: string,
  slot: DailyPuzzleSlot,
  puzzle: DailyPuzzle,
  source: string,
): Promise<DailyPuzzleSelectionRow> {
  const { rows } = await db.query<DailyPuzzleSelectionRow>(
    `INSERT INTO puzzle_daily_selections (day, slot, variant, puzzle_id, source)
     VALUES ($1::date, $2, $3, $4, $5)
     ON CONFLICT (day, slot) DO UPDATE SET
       variant = EXCLUDED.variant,
       puzzle_id = EXCLUDED.puzzle_id,
       source = EXCLUDED.source,
       selected_at = now()
     RETURNING day::text, slot, variant, puzzle_id, source, selected_at::text`,
    [day, slot, puzzle.variant, puzzle.id, source],
  );
  return rows[0]!;
}

function selectionResult(
  row: DailyPuzzleSelectionRow,
  puzzle: DailyPuzzle,
  persisted: boolean,
): DailyPuzzleResult {
  return {
    day: row.day,
    persisted,
    puzzle,
    puzzleId: row.puzzle_id,
    selectedAt: row.selected_at,
    slot: row.slot === DAILY_PUZZLE_HOMEPAGE_SLOT ? row.slot : DAILY_PUZZLE_HOMEPAGE_SLOT,
    source: row.source,
    variant: row.variant,
  };
}
