// Puzzle rating math, layered on the shared Glicko-2 engine (glicko.ts).
//
// A rated attempt is a single "game" between the user and the puzzle: solving is
// a win for the user (and a loss for the puzzle), failing is the reverse. Both
// sides update symmetrically via the same `rate` used for the live ladder, so
// puzzle ratings self-calibrate exactly like player ratings do.

import { PUZZLE_NEW_PLAYER_RATING } from '@mistboard/game';
import {
  DEFAULT_RATING,
  DEFAULT_RD,
  DEFAULT_VOLATILITY,
  type Glicko2,
  isProvisional,
  rate,
} from './glicko.js';

// A player's first puzzle rating (#712): higher than the Glicko default, with
// the default deviation so a few misses bring a weak player down quickly.
export function newPlayerPuzzleRating(): Glicko2 {
  return { rating: PUZZLE_NEW_PLAYER_RATING, rd: DEFAULT_RD, volatility: DEFAULT_VOLATILITY };
}

// Seed a puzzle's initial rating from its mate depth (solution plies -> full
// moves). The value only needs to be roughly ordered by difficulty; Glicko then
// self-calibrates as users attempt it, so we start provisional (default RD) and
// let real outcomes pull it to its true strength.
const SEED_BY_MATE_DEPTH: Readonly<Record<number, number>> = { 1: 1300, 2: 1600, 3: 1900 };
const SEED_BASE = 1500;
const SEED_STEP = 300;
const SEED_MAX = 2400;

// `derivedDifficulty` is the offline prior from deriveXiangqiPuzzleDifficulty:
// mate depth plus whether the key move is quiet, material conceded and not
// recovered, and how many replies the defence has. Mate depth alone gives four
// values across the whole corpus -- 943 of 1,605 puzzles seeded to exactly the
// same number -- which makes rating-adaptive selection a coin flip among
// hundreds of ties. The derived prior gives 402. Passed through unclamped by
// SEED_MAX, which exists to stop the crude depth extrapolation running away and
// has no business truncating a measured value.
export function seedPuzzleRating(solutionPlyCount: number, derivedDifficulty?: number): Glicko2 {
  if (derivedDifficulty !== undefined && Number.isFinite(derivedDifficulty)) {
    return {
      rating: Math.round(derivedDifficulty),
      rd: DEFAULT_RD,
      volatility: DEFAULT_VOLATILITY,
    };
  }
  const mateDepth = Math.max(1, Math.ceil(solutionPlyCount / 2));
  const seeded = SEED_BY_MATE_DEPTH[mateDepth] ?? SEED_BASE + (mateDepth - 1) * SEED_STEP;
  return {
    rating: Math.min(SEED_MAX, seeded),
    rd: DEFAULT_RD,
    volatility: DEFAULT_VOLATILITY,
  };
}

export type PuzzleRatingChange = {
  user: Glicko2;
  puzzle: Glicko2;
};

// Apply one rated attempt outcome, returning the post-attempt ratings for both
// the user and the puzzle. `solved` = the user found the solution without a wrong
// move (lichess counts the first attempt only; idempotency is enforced upstream
// by the puzzle_attempts primary key, not here).
export function ratePuzzleAttempt(
  user: Glicko2,
  puzzle: Glicko2,
  solved: boolean,
): PuzzleRatingChange {
  const userScore = solved ? 1 : 0;
  return {
    user: rate(user, [{ opponentRating: puzzle.rating, opponentRd: puzzle.rd, score: userScore }]),
    puzzle: rate(puzzle, [
      { opponentRating: user.rating, opponentRd: user.rd, score: 1 - userScore },
    ]),
  };
}

// Display helpers so callers agree on rounding + the provisional marker.
export function displayPuzzleRating(r: Glicko2): { rating: number; provisional: boolean } {
  return { rating: Math.round(r.rating), provisional: isProvisional(r.rd) };
}

// ── Serving rating (#712) ───────────────────────────────────────────────────
//
// The number the queue matches a player against. It is NOT the displayed
// rating: that stays the stored Glicko value (or the seeded prior), because it
// is what a rated attempt moves. The serving rating folds in two things the
// prior alone misses:
//
// 1. Solution length. The derived prior is mostly about the key move, and it
//    put long lines next to 3-ply captures; averaging it with the depth seed
//    pulls the long ones up.
// 2. What players did. Every finished session (clean solve, solve with a slip,
//    reveal, or abandon after moving) is evidence. The clean-solve rate is
//    shrunk toward what the base rating predicts for a typical player with
//    SERVING_PRIOR_SESSIONS pseudo-sessions, then turned back into a rating,
//    so two reveals on a fresh puzzle nudge it and thirty move it.
const SERVING_PRIOR_SESSIONS = 5;
const SERVING_RATING_MIN = 800;
const SERVING_RATING_MAX = 2800;

export type PuzzleServingEvidence = {
  /** Sessions that started (a move was made) and reached an outcome. */
  finished: number;
  /** Of those, solved with no wrong move and no hint. */
  clean: number;
};

/** Rating of the move-depth seed alone (no derived prior). */
export function puzzleLengthRating(solutionPlyCount: number): number {
  return seedPuzzleRating(solutionPlyCount).rating;
}

function expectedSolveRate(puzzleRating: number): number {
  return 1 / (1 + 10 ** ((puzzleRating - DEFAULT_RATING) / 400));
}

export function puzzleServingRating(input: {
  /** The stored Glicko rating, else the seeded prior: what was served before. */
  prior: number;
  solutionPlyCount: number;
  evidence?: PuzzleServingEvidence | null;
}): number {
  const base = (input.prior + puzzleLengthRating(input.solutionPlyCount)) / 2;
  const finished = Math.max(0, input.evidence?.finished ?? 0);
  const clean = Math.min(finished, Math.max(0, input.evidence?.clean ?? 0));
  let rating = base;
  if (finished > 0) {
    const rate =
      (clean + SERVING_PRIOR_SESSIONS * expectedSolveRate(base)) /
      (finished + SERVING_PRIOR_SESSIONS);
    rating = DEFAULT_RATING + 400 * Math.log10((1 - rate) / rate);
  }
  return Math.round(Math.min(SERVING_RATING_MAX, Math.max(SERVING_RATING_MIN, rating)));
}
