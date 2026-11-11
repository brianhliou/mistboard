import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  analyzeXiangqiGame,
  XIANGQI_ANALYSIS_ENGINE_ID,
  XIANGQI_ANALYSIS_ENGINE_VERSION,
} from './xiangqi-analysis.js';

test('analyzeXiangqiGame evaluates one point per ply cursor (0..N)', async () => {
  const seen: string[][] = [];
  const evals = await analyzeXiangqiGame(['h2e2', 'h9g7', 'b2e2'], {
    depth: 4,
    evaluate: async (moves) => {
      seen.push([...moves]);
      return { cp: moves.length * 10, mate: null, best: 'x0x0', depth: 4 };
    },
  });
  // N=3 plies -> 4 evals (startpos + after each move).
  assert.equal(evals.length, 4);
  assert.deepEqual(
    evals.map((e) => e.ply),
    [0, 1, 2, 3],
  );
  // Each eval sees the truncated prefix of the move list.
  assert.deepEqual(seen, [[], ['h2e2'], ['h2e2', 'h9g7'], ['h2e2', 'h9g7', 'b2e2']]);
  // Series carries the evaluator's Red-POV score through unchanged.
  assert.deepEqual(
    evals.map((e) => e.cp),
    [0, 10, 20, 30],
  );
});

test('analyzeXiangqiGame handles an empty game (start position only)', async () => {
  const evals = await analyzeXiangqiGame([], {
    evaluate: async () => ({ cp: 25, mate: null, best: 'h2e2', depth: 4 }),
  });
  assert.equal(evals.length, 1);
  assert.deepEqual(evals[0], { ply: 0, cp: 25, mate: null, best: 'h2e2' });
});

test('CC0 analysis uses cache version @6', () => {
  assert.equal(XIANGQI_ANALYSIS_ENGINE_VERSION, 6);
  assert.equal(XIANGQI_ANALYSIS_ENGINE_ID, 'pikafish-xiangqi-analysis@6');
});
