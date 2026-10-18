import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getStandardXiangqiLegalMoves, parseStandardXiangqiFen } from '@mistboard/game';
import { guardXiangqiEngineMoveFor, isXiangqiEngineClientId } from './server-xiangqi-engine.js';
import type { UciMultiPvLine } from './uci-engine-harness.js';
import {
  XIANGQI_DEFAULT_ENGINE_ID,
  XIANGQI_PICKER_ENGINES,
  XIANGQI_PUBLIC_ENGINES,
  xiangqiEngineTierFor,
  xiangqiMoveToPikafishUci,
} from './xiangqi-engine-catalog.js';
import { pickWorstLine, XIANGQI_WORST_ENGINE_ID } from './xiangqi-worst-engine.js';

function line(move: string, score: { cp?: number; mate?: number }): UciMultiPvLine {
  return {
    index: 1,
    move,
    cp: score.cp ?? null,
    mate: score.mate ?? null,
    depth: 8,
    bound: null,
    pv: [move],
  };
}

test('getting mated soonest is the worst move, ahead of any material loss', () => {
  const picked = pickWorstLine([
    line('a', { cp: 40 }),
    line('b', { cp: -900 }),
    line('c', { mate: -3 }),
    line('d', { mate: -1 }),
  ]);
  assert.equal(picked?.move, 'd');
});

test('a move that mates the opponent is the last choice', () => {
  const picked = pickWorstLine([line('mates', { mate: 1 }), line('even', { cp: 0 })]);
  assert.equal(picked?.move, 'even');
  // With only winning lines left, the slowest win is the least bad for the player.
  assert.equal(pickWorstLine([line('m1', { mate: 1 }), line('m5', { mate: 5 })])?.move, 'm5');
});

test('centipawns order from lowest, and exact ties break at random', () => {
  const lines = [line('x', { cp: -300 }), line('y', { cp: -300 }), line('z', { cp: 10 })];
  assert.equal(pickWorstLine(lines, () => 0)?.move, 'x');
  assert.equal(pickWorstLine(lines, () => 0.99)?.move, 'y');
});

test('a table with no move picks nothing', () => {
  assert.equal(pickWorstLine([]), null);
  assert.equal(pickWorstLine([line('', { cp: 0 })]), null);
});

// Black to move: red threatens a back-rank chariot mate, and the black chariot
// on b0 can stop it (b0a0 takes a chariot) or wander off (b0h0).
test('the immediate-loss guard spares every bot but the worst-move bot', () => {
  const parsed = parseStandardXiangqiFen('3k5/8R/9/9/9/9/9/9/4K4/Rr7 b - - 0 1');
  assert.ok(parsed.ok);
  const state = parsed.state;
  const legal = getStandardXiangqiLegalMoves(state);
  const blunder = legal.find((m) => xiangqiMoveToPikafishUci(m) === 'b0h0');
  assert.ok(blunder);
  // Planted: the guard does replace this move for a normal bot.
  assert.notEqual(
    guardXiangqiEngineMoveFor(XIANGQI_DEFAULT_ENGINE_ID, state, blunder, legal),
    blunder,
  );
  assert.equal(guardXiangqiEngineMoveFor(XIANGQI_WORST_ENGINE_ID, state, blunder, legal), blunder);
});

test('the worst-move bot is in the picker but not on the strength ladder', () => {
  assert.ok(xiangqiEngineTierFor(XIANGQI_WORST_ENGINE_ID));
  // The room-create gate (xiangqiTenant.engine.isEngineClientId) seats it.
  assert.ok(isXiangqiEngineClientId(XIANGQI_WORST_ENGINE_ID));
  assert.ok(XIANGQI_PICKER_ENGINES.some((tier) => tier.id === XIANGQI_WORST_ENGINE_ID));
  assert.ok(!XIANGQI_PUBLIC_ENGINES.some((tier) => tier.id === XIANGQI_WORST_ENGINE_ID));
});
