// What a puzzle detail carries from its stored source game (standard xiangqi
// mined puzzles, whose source lives in historical_xiangqi_games):
//
// - `setupMove`: the opponent's setup move with the piece it captured, so the
//   trainer can show the board one move earlier and glide it in (#664).
// - `history`: the game's moves BEFORE the setup move, so the move list can
//   show how the game reached the puzzle, as lichess does. Never a move at or
//   past the puzzle's start: the game's continuation is the solution (or the
//   blunder's refutation) and would spoil it.
// - `sourceGame` with the row's player names and `hosted: true`, so the "From
//   game" card names the players the game page names and links to that page.
//   The names stored on the puzzle are copied at mine time, and the source
//   dump re-pseudonymizes players on each release, so the row is the truth.
//
// One query per source game, cached for the process lifetime (puzzle rows and
// source games do not change under a served id). Persistence off (seed only),
// a missing row, or a row that disagrees with `initial` give no setup move and
// no history; the puzzle works as before. A private row (the by-id game route
// 404s it) gives neither history nor names nor a link. Additive and fail-soft:
// an error never fails the detail route.

import {
  deriveXiangqiPuzzleSetupMove,
  type XiangqiMove,
  type XiangqiPuzzle,
  type XiangqiPuzzleSetupMove,
} from '@mistboard/game';
import type { HistoricalXiangqiVisibility } from './persistence-historical-xiangqi.js';

export type PuzzleSourceGameRow = {
  moves: readonly XiangqiMove[];
  redNameRaw: string | null;
  blackNameRaw: string | null;
  visibility: HistoricalXiangqiVisibility;
};

export type SourceGameLoader = (gameId: string) => Promise<PuzzleSourceGameRow | null>;

type SourceGame = NonNullable<XiangqiPuzzle['sourceGame']>;

export type PuzzleDetailSourceFields = {
  sourceGame?: SourceGame & { hosted?: true };
  setupMove?: XiangqiPuzzleSetupMove;
  history?: XiangqiMove[];
};

type SourceContext = {
  setupMove: XiangqiPuzzleSetupMove | null;
  history: XiangqiMove[] | null;
  // The row's names, when the row exists and is not private.
  names: { redName: string | null; blackName: string | null } | null;
};

// Bounded well above the mined corpus (1,589 puzzles on 2026-10-28). An entry
// holds at most one game's moves before its puzzle, a few KB.
const CACHE_LIMIT = 4096;
const cache = new Map<string, SourceContext>();

export function resetPuzzleSetupMoveCacheForTests(): void {
  cache.clear();
}

async function sourceContext(
  puzzle: Pick<XiangqiPuzzle, 'id' | 'initial' | 'sourceGame'>,
  load: SourceGameLoader,
): Promise<SourceContext | null> {
  const source = puzzle.sourceGame;
  if (!source) return null;
  const cached = cache.get(puzzle.id);
  if (cached) return cached;
  let row: PuzzleSourceGameRow | null;
  try {
    row = await load(source.gameId);
  } catch {
    // Transient (pool, network): answer without the fields and retry next time.
    return null;
  }
  const setupMove =
    row && puzzle.initial.lastMove ? deriveXiangqiPuzzleSetupMove(puzzle, row.moves) : null;
  const listed = row !== null && row.visibility !== 'private';
  const context: SourceContext = {
    setupMove,
    // Only behind a verified setup move: the first `ply` moves then replay
    // legally from the opening to exactly `initial`, and the history is the
    // first `ply - 1` of them, one short of the puzzle position.
    history: row && setupMove && listed ? row.moves.slice(0, source.ply - 1).map(copyMove) : null,
    names: row && listed ? { redName: row.redNameRaw, blackName: row.blackNameRaw } : null,
  };
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(puzzle.id, context);
  return context;
}

function copyMove(move: XiangqiMove): XiangqiMove {
  return { from: move.from, to: move.to };
}

/**
 * The source-game fields of a standard-xiangqi puzzle detail. `load` is null
 * when nothing is stored (persistence off): the stored attribution then goes
 * out as it is, unlinked.
 */
export async function puzzleDetailSourceFields(
  puzzle: Pick<XiangqiPuzzle, 'id' | 'initial' | 'sourceGame'>,
  load: SourceGameLoader | null,
): Promise<PuzzleDetailSourceFields> {
  const stored = puzzle.sourceGame;
  if (!stored) return {};
  const context = load ? await sourceContext(puzzle, load) : null;
  const fields: PuzzleDetailSourceFields = { sourceGame: stored };
  if (!context) return fields;
  if (context.names) {
    const { redName: _staleRed, blackName: _staleBlack, ...rest } = stored;
    fields.sourceGame = {
      ...rest,
      ...(context.names.redName ? { redName: context.names.redName } : {}),
      ...(context.names.blackName ? { blackName: context.names.blackName } : {}),
      hosted: true,
    };
  }
  if (context.setupMove) fields.setupMove = context.setupMove;
  if (context.history && context.history.length > 0) fields.history = context.history;
  return fields;
}
