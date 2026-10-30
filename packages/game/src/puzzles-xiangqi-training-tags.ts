// Training tags for standard-xiangqi puzzles: what a player can drill by on
// the themes page (lichess's training/themes), beside the named kill patterns.
//
// Derived from the puzzle record when the server loads its snapshot, never
// read from the `themes` stored at mining time: a rule added or fixed here
// (matein4 was missing from the miner until 2026-10-28) reaches every served
// puzzle on the next load without a re-mine. Each puzzle gets exactly one
// phase, one goal and one length tag, and a mate gets one mate-in-N tag.

import type { XiangqiPuzzle } from './puzzles-xiangqi.js';
import { XIANGQI_ENDGAME_MAX_PIECES } from './puzzles-xiangqi-mining.js';
import { XIANGQI_MOTIF_BY_ID, type XiangqiMotifId } from './puzzles-xiangqi-motifs.js';

export type XiangqiTrainingTagGroup = 'motif' | 'mate' | 'phase' | 'goal' | 'length';

export type XiangqiPuzzleTrainingTag =
  | 'matein1'
  | 'matein2'
  | 'matein3'
  | 'matein4'
  | 'opening'
  | 'middlegame'
  | 'endgame'
  | 'checkmate'
  | 'winning'
  | 'one-move'
  | 'short'
  | 'long'
  | 'very-long';

/** Anything the trainer filters by: a kill pattern or a derived tag. */
export type XiangqiTrainingTagId = XiangqiMotifId | XiangqiPuzzleTrainingTag;

/** The derived tags in display order, each with the themes-page group it sits in. */
export const XIANGQI_TRAINING_TAGS: readonly {
  id: XiangqiPuzzleTrainingTag;
  group: Exclude<XiangqiTrainingTagGroup, 'motif'>;
}[] = [
  { id: 'matein1', group: 'mate' },
  { id: 'matein2', group: 'mate' },
  { id: 'matein3', group: 'mate' },
  { id: 'matein4', group: 'mate' },
  { id: 'opening', group: 'phase' },
  { id: 'middlegame', group: 'phase' },
  { id: 'endgame', group: 'phase' },
  { id: 'checkmate', group: 'goal' },
  { id: 'winning', group: 'goal' },
  { id: 'one-move', group: 'length' },
  { id: 'short', group: 'length' },
  { id: 'long', group: 'length' },
  { id: 'very-long', group: 'length' },
];

const TRAINING_TAG_IDS: ReadonlySet<string> = new Set(XIANGQI_TRAINING_TAGS.map((tag) => tag.id));

/**
 * A puzzle whose position arose within this many plies of the source game's
 * start (ten moves a side) is an opening puzzle, unless it is already an
 * endgame. Puzzles with no source game are never tagged opening.
 */
export const XIANGQI_OPENING_MAX_PLY = 20;

export function isXiangqiTrainingTagId(value: string): value is XiangqiTrainingTagId {
  return TRAINING_TAG_IDS.has(value) || XIANGQI_MOTIF_BY_ID.has(value as XiangqiMotifId);
}

/** The solver's moves in the solution line (lichess's "length" counts these). */
export function xiangqiPuzzlePlayerMoves(puzzle: Pick<XiangqiPuzzle, 'solution'>): number {
  return Math.ceil(puzzle.solution.length / 2);
}

export function xiangqiPuzzleTrainingTags(
  puzzle: Pick<XiangqiPuzzle, 'initial' | 'solution' | 'goal' | 'sourceGame'>,
): XiangqiPuzzleTrainingTag[] {
  const tags: XiangqiPuzzleTrainingTag[] = [];
  const moves = xiangqiPuzzlePlayerMoves(puzzle);
  if (puzzle.goal.type === 'checkmate') {
    if (moves === 1) tags.push('matein1');
    else if (moves === 2) tags.push('matein2');
    else if (moves === 3) tags.push('matein3');
    else if (moves === 4) tags.push('matein4');
  }
  const pieces = Object.keys(puzzle.initial.board).length;
  const ply = puzzle.sourceGame?.ply;
  if (pieces <= XIANGQI_ENDGAME_MAX_PIECES) tags.push('endgame');
  else if (ply !== undefined && ply <= XIANGQI_OPENING_MAX_PLY) tags.push('opening');
  else tags.push('middlegame');
  tags.push(puzzle.goal.type === 'checkmate' ? 'checkmate' : 'winning');
  tags.push(moves <= 1 ? 'one-move' : moves === 2 ? 'short' : moves === 3 ? 'long' : 'very-long');
  return tags;
}
