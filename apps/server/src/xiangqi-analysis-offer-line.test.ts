// The declined-offer half of `!!` (#315). When a move offers a piece and the
// engine's own line does NOT take it, the classifier cannot settle whether the
// piece comes back, reports `sacrifice-unverified`, and stays silent. The sweep
// therefore searches the position AFTER the capture and stores that line.
//
// This pins the two things that are easy to get wrong: that the extra search is
// rare (it must not fire on quiet plies) and that it is asked for the right
// position — the game so far, plus the accepting capture.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyStandardXiangqiMove,
  createInitialXiangqiState,
  type XiangqiMove,
  xiangqiMoveToPikafishUci,
} from '@mistboard/game';
import { analyzeXiangqiGame, type PlyEval } from './xiangqi-analysis.js';

// 1. b3-e3   quiet cannon move
// 2. h10-g8  black develops the horse. It does NOT yet cover h6: a horse's leg is
//            the orthogonal step, here g7, and g7 still holds a soldier.
// 3. b1-c3   quiet
// 4. g7-g6   the soldier steps off the leg, so g8 now covers h6
// 5. h3-h6   the red cannon steps onto h6, en prise to that horse and undefended
const MOVES: XiangqiMove[] = [
  { from: 'b3', to: 'e3' },
  { from: 'h10', to: 'g8' },
  { from: 'b1', to: 'c3' },
  { from: 'g7', to: 'g6' },
  { from: 'h3', to: 'h6' },
];
const MOVES_UCI = MOVES.map(xiangqiMoveToPikafishUci);
const CAPTURE_UCI = xiangqiMoveToPikafishUci({ from: 'g8', to: 'h6' });

test('the fixture game is legal (a rejected move would make the rest meaningless)', () => {
  let state = createInitialXiangqiState('t');
  for (const move of MOVES) {
    const next = applyStandardXiangqiMove(state, move);
    assert.notEqual(next, state);
    state = next;
  }
});

/** Evals that make ply 3 near-best and quiet-looking, with a PV that DECLINES the
 *  cannon (black develops instead of taking on h6). */
function fakeEvaluate(calls: string[][]) {
  return async (moves: string[]): Promise<PlyEval & { depth: number }> => {
    calls.push([...moves]);
    // The line after the capture: whatever it is, storing it is the point.
    if (moves[moves.length - 1] === CAPTURE_UCI) {
      return { ply: 0, cp: 900, mate: null, best: 'e3e7', pv: ['e3e7', 'g8f6'], depth: 1 };
    }
    // Black's reply declines the offer: it develops instead of taking on h6.
    return { ply: 0, cp: 40, mate: null, best: 'b2e2', pv: ['b9c7'], depth: 1 };
  };
}

test('an offered piece the engine line declines gets a capture-line search, stored on its ply', async () => {
  const calls: string[][] = [];
  const plies = await analyzeXiangqiGame(MOVES_UCI, {
    moves: MOVES,
    evaluate: fakeEvaluate(calls) as never,
  });

  // The offer is ply 5, and the line is stored on the row for the position that
  // move REACHED — the same row that carries its `pv`.
  const offerRow = plies.find((row) => row.ply === 5);
  assert.ok(offerRow?.offerLine, 'ply 5 offered a cannon the line declined; expected an offerLine');
  assert.equal(offerRow.offerLine.capture, CAPTURE_UCI);
  assert.deepEqual(offerRow.offerLine.pv, ['e3e7', 'g8f6']);

  // Asked for the right position: the whole game, then the accepting capture.
  const captureCall = calls.find((moves) => moves[moves.length - 1] === CAPTURE_UCI);
  assert.deepEqual(captureCall, [...MOVES_UCI, CAPTURE_UCI]);

  // And rare: the sweep is one position per ply cursor (0..N), so exactly one
  // extra search on top.
  assert.equal(calls.length, MOVES_UCI.length + 1 + 1);
});

test('quiet plies cost no extra search', async () => {
  // The same opening WITHOUT the cannon stepping onto h6.
  const quiet: XiangqiMove[] = [
    { from: 'b3', to: 'e3' },
    { from: 'h10', to: 'g8' },
    { from: 'b1', to: 'c3' },
    { from: 'g7', to: 'g6' },
  ];
  const quietUci = quiet.map(xiangqiMoveToPikafishUci);
  const calls: string[][] = [];
  const plies = await analyzeXiangqiGame(quietUci, {
    moves: quiet,
    evaluate: fakeEvaluate(calls) as never,
  });
  assert.equal(calls.length, quietUci.length + 1, 'no ply offered a piece; expected sweep only');
  assert.ok(plies.every((row) => row.offerLine === undefined));
});

test('capture-line analysis includes offers after a recorded repetition', async () => {
  const shuffle: XiangqiMove[] = [
    { from: 'h1', to: 'g3' },
    { from: 'h10', to: 'g8' },
    { from: 'g3', to: 'h1' },
    { from: 'g8', to: 'h10' },
  ];
  const moves = [...shuffle, ...shuffle, ...MOVES];
  const ucis = moves.map(xiangqiMoveToPikafishUci);
  const calls: string[][] = [];
  const plies = await analyzeXiangqiGame(ucis, { moves, evaluate: fakeEvaluate(calls) as never });
  assert.equal(plies.find((row) => row.ply === 13)?.offerLine?.capture, CAPTURE_UCI);
  assert.ok(calls.some((line) => line.length === ucis.length + 1 && line.at(-1) === CAPTURE_UCI));
});
