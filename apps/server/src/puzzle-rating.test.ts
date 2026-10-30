import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_RD, DEFAULT_VOLATILITY, defaultRating } from './glicko.js';
import {
  displayPuzzleRating,
  newPlayerPuzzleRating,
  puzzleServingRating,
  ratePuzzleAttempt,
  seedPuzzleRating,
} from './puzzle-rating.js';

test('seed rating increases with mate depth and starts provisional', () => {
  const mateIn1 = seedPuzzleRating(1); // 1 solver ply
  const mateIn2 = seedPuzzleRating(3); // solver, reply, solver
  const mateIn3 = seedPuzzleRating(5);
  assert.equal(mateIn1.rating, 1300);
  assert.equal(mateIn2.rating, 1600);
  assert.equal(mateIn3.rating, 1900);
  assert.ok(mateIn1.rating < mateIn2.rating && mateIn2.rating < mateIn3.rating);
  assert.equal(mateIn1.rd, DEFAULT_RD);
});

test('seed rating is bounded and handles deeper solutions', () => {
  const deep = seedPuzzleRating(15); // mate in 8 -> 1500 + 7*300 = 3600, capped
  assert.equal(deep.rating, 2400);
});

test('solving raises the user and lowers the puzzle; failing does the reverse', () => {
  const user = defaultRating();
  const puzzle = seedPuzzleRating(3);

  const solved = ratePuzzleAttempt(user, puzzle, true);
  assert.ok(solved.user.rating > user.rating, 'solver gains rating');
  assert.ok(solved.puzzle.rating < puzzle.rating, 'solved puzzle loses rating');

  const failed = ratePuzzleAttempt(user, puzzle, false);
  assert.ok(failed.user.rating < user.rating, 'failer loses rating');
  assert.ok(failed.puzzle.rating > puzzle.rating, 'unsolved puzzle gains rating');
});

test('solving a harder puzzle rewards more than solving an easier one', () => {
  const user = defaultRating();
  const easy = { rating: 1000, rd: 60, volatility: 0.06 };
  const hard = { rating: 2000, rd: 60, volatility: 0.06 };
  const gainEasy = ratePuzzleAttempt(user, easy, true).user.rating - user.rating;
  const gainHard = ratePuzzleAttempt(user, hard, true).user.rating - user.rating;
  assert.ok(gainHard > gainEasy, 'beating a stronger puzzle is worth more');
});

test('display rounds the rating and flags provisional deviation', () => {
  const provisional = displayPuzzleRating({ rating: 1512.7, rd: DEFAULT_RD, volatility: 0.06 });
  assert.deepEqual(provisional, { rating: 1513, provisional: true });
  const settled = displayPuzzleRating({ rating: 1487.2, rd: 80, volatility: 0.06 });
  assert.deepEqual(settled, { rating: 1487, provisional: false });
});

// ── #712 serving rating and new-player start ────────────────────────────────

test('serving rating ranks a long line above a short one the prior put level', () => {
  // The old queue matched on the prior alone, which put this 7-ply line BELOW
  // the 3-ply capture.
  const long = puzzleServingRating({ prior: 1400, solutionPlyCount: 7 });
  const short = puzzleServingRating({ prior: 1450, solutionPlyCount: 3 });
  assert.ok(long > short, `${long} > ${short}`);
});

test('serving rating with no outcomes is the prior averaged with the length seed', () => {
  assert.equal(puzzleServingRating({ prior: 1500, solutionPlyCount: 3 }), 1550);
  assert.equal(
    puzzleServingRating({ prior: 1500, solutionPlyCount: 3, evidence: { finished: 0, clean: 0 } }),
    1550,
  );
});

test('serving rating rises with reveals and falls with clean solves, more with more evidence', () => {
  const prior = { prior: 1600, solutionPlyCount: 3 };
  const base = puzzleServingRating(prior);
  const fewReveals = puzzleServingRating({ ...prior, evidence: { finished: 3, clean: 0 } });
  const manyReveals = puzzleServingRating({ ...prior, evidence: { finished: 40, clean: 2 } });
  const manyClean = puzzleServingRating({ ...prior, evidence: { finished: 40, clean: 38 } });
  assert.ok(fewReveals > base, `${fewReveals} > ${base}`);
  assert.ok(manyReveals > fewReveals, `${manyReveals} > ${fewReveals}`);
  assert.ok(manyClean < base, `${manyClean} < ${base}`);
  assert.ok(manyReveals <= 2800 && manyClean >= 800);
});

test('a new player starts at 1800 with the default deviation', () => {
  assert.deepEqual(newPlayerPuzzleRating(), {
    rating: 1800,
    rd: DEFAULT_RD,
    volatility: DEFAULT_VOLATILITY,
  });
});
