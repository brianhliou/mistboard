// Opening shapes for study recipes. An opening is a set of piece placements that
// must all hold after N plies, not a move sequence: 屏风马 is "both black horses
// on c8 and g8", however the player ordered them, and the central cannon is "a
// red cannon on e3" whether it came from b3 or h3. The whole set is tested as
// written and then mirrored across the central file as one unit, so a shape
// never matches half-mirrored.

import {
  applyStandardXiangqiMove,
  createInitialXiangqiState,
  type XiangqiColor,
  type XiangqiGameState,
  type XiangqiMove,
  type XiangqiPieceRole,
  type XiangqiSquare,
} from '@mistboard/game';
import { mirrorSquare } from '../xiangqi-opening-mirror.js';
import type { StudyRecipeOpening } from './recipes.js';

const ROLE_BY_LETTER: Record<string, XiangqiPieceRole> = {
  K: 'general',
  A: 'advisor',
  E: 'elephant',
  H: 'horse',
  R: 'chariot',
  C: 'cannon',
  P: 'soldier',
};

export type Placement = { color: XiangqiColor; role: XiangqiPieceRole; square: XiangqiSquare };

/** "C@e3" for red -> { color: 'red', role: 'cannon', square: 'e3' }. */
export function parsePlacement(color: XiangqiColor, text: string): Placement {
  const [letter, square] = text.split('@');
  const role = letter ? ROLE_BY_LETTER[letter] : undefined;
  if (!role || !square) throw new Error(`bad placement ${JSON.stringify(text)}`);
  return { color, role, square: square as XiangqiSquare };
}

export function openingPlacements(opening: StudyRecipeOpening): Placement[] {
  return [
    ...(opening.red ?? []).map((p) => parsePlacement('red', p)),
    ...(opening.black ?? []).map((p) => parsePlacement('black', p)),
  ];
}

/** Replay the first `plies` moves (fewer if the game is shorter or a move is
 *  refused); returns the resulting state and how many plies actually applied. */
export function replayPlies(
  moves: readonly XiangqiMove[],
  plies: number,
): { state: XiangqiGameState; applied: number } {
  let state = createInitialXiangqiState('study-curator-opening');
  let applied = 0;
  for (const move of moves.slice(0, plies)) {
    const next = applyStandardXiangqiMove(state, move);
    if (next === state) break;
    state = next;
    applied += 1;
  }
  return { state, applied };
}

function holds(state: XiangqiGameState, placements: readonly Placement[], mirrored: boolean) {
  return placements.every((p) => {
    const square = (mirrored ? mirrorSquare(p.square) : p.square) as XiangqiSquare;
    const piece = state.board[square];
    return piece !== undefined && piece.color === p.color && piece.role === p.role;
  });
}

/** True when the game reaches the opening's shape by `byPly`, in either mirror. */
export function matchesOpening(
  moves: readonly XiangqiMove[],
  opening: StudyRecipeOpening,
): boolean {
  if (moves.length < opening.byPly) return false;
  const { state, applied } = replayPlies(moves, opening.byPly);
  if (applied < opening.byPly) return false;
  const placements = openingPlacements(opening);
  return holds(state, placements, false) || holds(state, placements, true);
}
