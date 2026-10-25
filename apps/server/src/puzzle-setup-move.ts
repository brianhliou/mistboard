// The setup move a puzzle detail carries so the trainer can show the board one
// move earlier and glide the opponent's move in (#664). Standard xiangqi only:
// the captured piece is derived from the source game, which lives in
// historical_xiangqi_games, so persistence-off (seed only) and any puzzle whose
// source game is missing or disagrees with `initial` get no field, and the
// client keeps showing `initial` at once. Additive and fail-soft: an error
// never fails the detail route.

import {
  deriveXiangqiPuzzleSetupMove,
  type XiangqiMove,
  type XiangqiPuzzle,
  type XiangqiPuzzleSetupMove,
} from '@mistboard/game';

export type SourceGameMovesLoader = (gameId: string) => Promise<readonly XiangqiMove[] | null>;

// Puzzle rows and source games do not change under a served id, so a derived
// answer (null included) is kept for the process lifetime, bounded.
const CACHE_LIMIT = 4096;
const cache = new Map<string, XiangqiPuzzleSetupMove | null>();

export function resetPuzzleSetupMoveCacheForTests(): void {
  cache.clear();
}

export async function puzzleSetupMove(
  puzzle: Pick<XiangqiPuzzle, 'id' | 'initial' | 'sourceGame'>,
  loadMoves: SourceGameMovesLoader,
): Promise<XiangqiPuzzleSetupMove | null> {
  if (!puzzle.sourceGame || !puzzle.initial.lastMove) return null;
  if (cache.has(puzzle.id)) return cache.get(puzzle.id) ?? null;
  let setup: XiangqiPuzzleSetupMove | null;
  try {
    const moves = await loadMoves(puzzle.sourceGame.gameId);
    setup = moves ? deriveXiangqiPuzzleSetupMove(puzzle, moves) : null;
  } catch {
    // Transient (pool, network): answer without the field and retry next time.
    return null;
  }
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(puzzle.id, setup);
  return setup;
}
