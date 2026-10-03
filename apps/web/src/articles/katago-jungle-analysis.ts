// The numbers behind the KataGo post: both engines' evaluations of every
// position of a few games from the 2026-09-21 match (KataGo-AnimalChess vs
// MistyJungle), read against how each game ended. Data:
// content/katago-jungle-evals.json, reduced from the runs of
// scripts/variant-lab/jungle-katago-evals.ts by
// scripts/variant-lab/jungle-katago-evals-reduce.ts. Pure functions only, so the
// post's charts, its tests and the annotated-study builder read one source.
//
// Every number is black's expected score in [0, 1] (a win 1, a draw 0.5, a
// loss 0):
//   KataGo  its own `winrate` for black, which already counts a draw as half
//           (win + draw/2);
//   Misty   its centipawns for black through the curve the site's analysis
//           board uses (winPercent: 1 / (1 + e^(-0.00368 cp)), cp clamped at
//           ±1000), and a forced result it found as exactly 0 or 1.

import { moveJudgment, type MoveJudgment, winPercent } from '@mistboard/game';

export type MatchResult = 'red' | 'black' | 'draw';

/** One game, every position scored (index = plies played, 0 = the start). */
export type EvaluatedGame = {
  game: number;
  /** Which engine played red. */
  red: 'katago' | 'misty';
  result: MatchResult;
  plies: number;
  /** The game's moves in Mistboard coordinates. */
  moves: string[];
  /** KataGo's expected score for black at each position 0..plies-1. */
  kata: number[];
  /** KataGo's preferred move at each position (its search's first move). */
  kataBest: string[];
  /** Misty's score for black in centipawns; ±1,000,000 range = a forced result. */
  misty: Array<number | null>;
};

export type EvalsData = { games: EvaluatedGame[] };

const FORCED = 900_000;

/** Misty's centipawns for black as black's expected score. */
export function mistyExpected(cpBlack: number | null): number {
  if (cpBlack == null) return 0.5;
  if (cpBlack >= FORCED) return 1;
  if (cpBlack <= -FORCED) return 0;
  return winPercent(cpBlack, null) / 100;
}

/** The engine-for-black series of one game, as expected scores. */
export function seriesFor(game: EvaluatedGame, engine: 'kata' | 'misty'): number[] {
  return engine === 'kata' ? game.kata : game.misty.map(mistyExpected);
}

/**
 * For a decisive game: the first position from which this engine's expected
 * score for the eventual winner stayed at or above `threshold` to the end.
 * Returns that ply, or null if it never settled there.
 */
export function settledPly(
  winnerScores: readonly number[],
  threshold: number,
): number | null {
  let from: number | null = null;
  for (let i = winnerScores.length - 1; i >= 0; i -= 1) {
    if (winnerScores[i]! >= threshold) from = i;
    else break;
  }
  return from;
}

/** Winner-POV series for a decisive game; null for a draw. */
export function winnerSeries(
  game: Pick<EvaluatedGame, 'result'>,
  blackSeries: readonly number[],
): number[] | null {
  if (game.result === 'draw') return null;
  return game.result === 'black' ? [...blackSeries] : blackSeries.map((x) => 1 - x);
}

export type MistyMoveMark = {
  /** Plies played before the move (the move is number ply + 1). */
  ply: number;
  uci: string;
  /** KataGo's preferred move in the same position. */
  kataBest: string;
  /** Misty's expected score before and after, by KataGo's count. */
  before: number;
  after: number;
  mark: Exclude<MoveJudgment, null>;
};

/**
 * Misty's weak moves as KataGo judges them: what each Misty move cost Misty by
 * KataGo's expected score (the position before, against the position after),
 * graded with the site's review cutoffs (moveJudgment: 5, 10 and 15 points).
 * A move KataGo would have played itself is never marked: the two searches
 * differ by a few points of noise, and a move it agrees with is no mistake.
 */
export function mistyMoveMarks(game: EvaluatedGame): MistyMoveMark[] {
  const mistyIsRed = game.red === 'misty';
  const out: MistyMoveMark[] = [];
  for (let ply = 0; ply + 1 < game.kata.length; ply += 1) {
    const redToMove = ply % 2 === 0;
    if (redToMove !== mistyIsRed) continue;
    const uci = game.moves[ply]!;
    if (uci === game.kataBest[ply]) continue;
    const forMisty = (black: number): number => (mistyIsRed ? 1 - black : black);
    const before = forMisty(game.kata[ply]!);
    const after = forMisty(game.kata[ply + 1]!);
    const mark = moveJudgment(before * 100, after * 100);
    if (mark) out.push({ ply, uci, kataBest: game.kataBest[ply]!, before, after, mark });
  }
  return out;
}

export const MARK_GLYPH: Record<Exclude<MoveJudgment, null>, '??' | '?' | '?!'> = {
  blunder: '??',
  mistake: '?',
  inaccuracy: '?!',
};
