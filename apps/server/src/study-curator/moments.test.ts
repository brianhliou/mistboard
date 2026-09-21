import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evalsOf } from './fixtures.js';
import { findDecisiveMoment, judgeGame, scoreModelGame, topMoments } from './moments.js';

const MOVES = ['h3e3', 'h10g8', 'h1g3', 'i10h10', 'i1h1', 'b10c8'];

test('judgeGame reads mover-POV drops off a Red-POV series', () => {
  // Position 3 -> 4: black's move, eval (Red POV) goes 20 -> 320. Black gave up a lot.
  const game = judgeGame(MOVES, evalsOf([10, 20, 20, 20, 320, 300, 300], { 3: { best: 'b10c8' } }));
  const black4 = game.verdicts.find((v) => v.ply === 4);
  assert.ok(black4);
  assert.equal(black4.mover, 'black');
  assert.equal(black4.judgment, 'blunder');
  assert.ok(black4.drop > 15);
  assert.equal(black4.playedBest, false);
  // Red's moves that held the eval judge nothing.
  assert.equal(game.verdicts.find((v) => v.ply === 1)?.judgment, null);
  assert.ok(game.accuracy.red > game.accuracy.black);
});

test('judgeGame skips plies without an eval row on either side', () => {
  const rows = evalsOf([0, 0, 0, 0, 0, 0, 0]).filter((row) => row.ply !== 2);
  const game = judgeGame(MOVES, rows);
  assert.deepEqual(
    game.verdicts.map((v) => v.ply),
    [1, 4, 5, 6],
  );
});

test('scoreModelGame rewards a clean winner and a concentrated loss', () => {
  // Red wins; black gives everything up in one move (ply 4).
  const clean = judgeGame(MOVES, evalsOf([10, 20, 20, 20, 320, 300, 300]));
  // Red wins, but black bleeds in two places and red also errs at ply 5.
  const messy = judgeGame(MOVES, evalsOf([10, 20, 20, 160, 320, 100, 300]));
  const a = scoreModelGame('1-0', clean);
  const b = scoreModelGame('1-0', messy);
  assert.ok(a && b);
  assert.ok(a.score > b.score, `${a.score} > ${b.score}`);
  assert.equal(a.winnerJudged, 0);
  assert.equal(a.clarity, 1);
  assert.equal(scoreModelGame('1/2-1/2', clean), null);
});

test('scoreModelGame is zero when the loser never gave anything up', () => {
  const flat = judgeGame(MOVES, evalsOf([0, 0, 0, 0, 0, 0, 0]));
  assert.equal(scoreModelGame('1-0', flat)?.score, 0);
});

test('findDecisiveMoment picks the largest open give-away with an engine answer', () => {
  // Black loses. Ply 2: black gives up ~25 points from level. Ply 4: black gives
  // up more again, but from a position already lost (Red POV 300 = black ~25%).
  const game = judgeGame(
    MOVES,
    evalsOf([0, 0, 300, 300, 500, 500, 900], {
      1: { best: 'b10c8', pv: ['b10c8', 'h1g3'] },
      3: { best: 'b10c8', pv: ['b10c8'] },
    }),
  );
  const moment = findDecisiveMoment('1-0', game);
  assert.ok(moment);
  assert.equal(moment.verdict.ply, 2);
});

test('findDecisiveMoment needs a line to play against', () => {
  const game = judgeGame(MOVES, evalsOf([0, 0, 150, 150, 150, 150, 150]));
  assert.equal(findDecisiveMoment('1-0', game), null);
});

test('topMoments caps and returns in game order', () => {
  const game = judgeGame(MOVES, evalsOf([0, 0, 150, 150, 500, 500, 900]));
  const top = topMoments(game, 1);
  assert.equal(top.length, 1);
  assert.equal(top[0]?.ply, 4);
  assert.deepEqual(
    topMoments(game, 5).map((v) => v.ply),
    [2, 4, 6],
  );
});
