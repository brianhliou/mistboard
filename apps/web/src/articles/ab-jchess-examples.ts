// The numbers behind the AB-JChess post's example games: two of AB-JChess's
// wins from the 2026-09-29 match (run7: 400 games against PikaJieQi at 4 s a
// move), every position scored again by both engines. Data:
// content/ab-jchess-examples.json, reduced from the sweeps in
// mistboard-engine lab/jieqi-abjchess-2026-09-29/examples/ (README there). Pure
// functions only, so the post's charts, its tests and the annotated-study
// builder (scripts/variant-lab/ab-jchess-annotated-study.ts) read one source.
//
// Every score is red's expected score in [0, 1] (a draw is half):
//   AB-JChess  its centipawns through the curve fitted on the match's results,
//              1 / (1 + e^(-0.00985 cp)) (+112 cp = 75%);
//   Pikafish   the fixed build (bcc83f88, after #497) searched fresh at each
//              position, its centipawns through the curve fitted the same way,
//              +709 cp = 75%. Its in-game numbers carry the reveal bug and are
//              kept separately (`ingame`), as what it reported while playing.
// The two engines' centipawns are not on one scale; only these scores compare.

import { moveJudgment, type MoveJudgment } from '@mistboard/game';

export type AbMatchGame = {
  game: number;
  /** The game's room on the site (its review page). */
  room: string;
  abColor: 'red' | 'black';
  winner: 'red' | 'black' | 'draw';
  plies: number;
  /** The start position with the deal (the sixth FEN field). */
  rootFen: string;
  /** The game's moves in Mistboard squares (a1-i10). */
  moves: string[];
  /** The identity a move turned over, or null for a move of a revealed piece. */
  reveals: Array<string | null>;
  /** AB-JChess's score for red at each position 0..plies, and its choice there. */
  ab: Array<number | null>;
  abBest: Array<string | null>;
  /** Fixed Pikafish's score for red at each position (null past the searched range). */
  pk: Array<number | null>;
  pkBest: Array<string | null>;
  /** AB-JChess's score for red of a reveal move, searched from the position
   *  before it (the average over what the piece could be); null otherwise. */
  moveScore: Array<number | null>;
  /** What the mover reported for red when it played the move, in the match. */
  ingame: Array<number | null>;
  lines: AbLine[];
};

/** AB-JChess's alternative to a Pikafish move, with both engines' deep check. */
export type AbLine = {
  /** Plies played before; the line replaces move ply + 1. */
  ply: number;
  /** AB-JChess's line, cut at its first reveal (past it the line assumes an identity). */
  moves: string[];
  played: string;
  /** Red's score of AB-JChess's move and of the played move, by each engine
   *  searching that move alone from the same position. */
  abAlt: number;
  abPlayed: number;
  pkAlt: number;
  pkPlayed: number;
  abDepth: number;
  pkDepth: number;
};

export type AbExamplesData = {
  budgets: { abNodes: number; pkNodes: number; lineAbNodes: number; deepPkNodes: number };
  games: AbMatchGame[];
};

export const AB_K = 0.00985;
export const PIKA_CP_75 = 709;

/** The plies both engines scored (Pikafish's sweep stops before the end of a long game). */
export function chartedPlies(game: AbMatchGame): number {
  let last = 0;
  for (let i = 0; i < game.pk.length; i += 1) {
    if (game.pk[i] != null && game.ab[i] != null) last = i;
    else break;
  }
  return last + 1;
}

/** AB-JChess's expected score as each engine saw it, over the charted plies. */
export function abSideSeries(game: AbMatchGame, engine: 'ab' | 'pk'): number[] {
  const series = engine === 'ab' ? game.ab : game.pk;
  return series
    .slice(0, chartedPlies(game))
    .map((red) => (game.abColor === 'red' ? red! : 1 - red!));
}

export type PikaMoveMark = {
  /** Plies played before the move (the move is number ply + 1). */
  ply: number;
  uci: string;
  abBest: string;
  /** Pikafish's expected score before and after, by AB-JChess's count. */
  before: number;
  after: number;
  mark: Exclude<MoveJudgment, null>;
};

/**
 * Pikafish's weak moves as AB-JChess judges them, on the site's review cutoffs
 * (moveJudgment: 5, 10 and 15 points). The cost is AB-JChess's score before
 * the move against the position after; a reveal is scored on its own search
 * from the position before (moveScore), since the position after already knows
 * which piece came up. A move AB-JChess would have played is never marked.
 */
export function pikaMoveMarks(game: AbMatchGame): PikaMoveMark[] {
  const pikaIsRed = game.abColor === 'black';
  const out: PikaMoveMark[] = [];
  for (let ply = 0; ply < game.moves.length; ply += 1) {
    if ((ply % 2 === 0) !== pikaIsRed) continue;
    const uci = game.moves[ply]!;
    const best = game.abBest[ply];
    const beforeRed = game.ab[ply];
    const afterRed = game.moveScore[ply] ?? game.ab[ply + 1];
    if (!best || best === uci || beforeRed == null || afterRed == null) continue;
    const forPika = (red: number): number => (pikaIsRed ? red : 1 - red);
    const before = forPika(beforeRed);
    const after = forPika(afterRed);
    const mark = moveJudgment(before * 100, after * 100);
    if (mark) out.push({ ply, uci, abBest: best, before, after, mark });
  }
  return out;
}

/** The first charted ply from which `series` stayed at or above `level`. */
export function settledFrom(series: readonly number[], level: number): number | null {
  let from: number | null = null;
  for (let i = series.length - 1; i >= 0; i -= 1) {
    if (series[i]! >= level) from = i;
    else break;
  }
  return from;
}

export const pct = (x: number): string => `${Math.round(x * 100)}%`;
