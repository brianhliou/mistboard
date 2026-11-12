// Contract pin for the SHARED xiangqi uniqueness-gate plumbing (#185).
//
// The miner's verify pass and the puzzle audit both judge a solver ply through
// scripts/variant-lab/xiangqi-pikafish-uci.ts. These tests pin that pipeline
// end-to-end — raw UCI `info` lines -> parse -> shared score normalization ->
// isXiangqiSolverMoveUnique — at the shared DEFAULT knobs, so any future edit
// to the gate, the normalization, or the defaults shows up here instead of as
// silent miner/audit drift. (The gate's scalar edge cases are further covered
// in packages/game/src/puzzles-xiangqi-mining.test.ts.)
//
// Engine-free by design: the shared module takes canned UCI output and a fake
// analyzeFen, so this runs everywhere (no Pikafish install required).
//
// Run: node_modules/.bin/tsx --test scripts/variant-lab/xiangqi-uniqueness-gate.test.ts

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createInitialXiangqiState,
  isXiangqiSolverMoveUnique,
  standardXiangqiEngineFen,
  XIANGQI_MATE_SCORE_CP,
  xiangqiUciScoreToCp,
} from '../../packages/game/src/index.ts';
import {
  analyzeXiangqiSolverPly,
  parseXiangqiScoredLines,
  XIANGQI_SOLVER_GATE_DEFAULTS,
  type XiangqiScoredLine,
  xiangqiScoredLineToVerifyLine,
} from './xiangqi-pikafish-uci.ts';

// Realistic MultiPV-2 search output for a position (only the fields the parser
// reads matter; `bestmove` is the search terminator, not an info line).
function uciSearch(bestScore: string, secondScore: string | null, plyTag = ''): string[] {
  const lines = [
    `info depth 18 seldepth 30 multipv 1 score ${bestScore} nodes 500000 pv h2e2 h9g7 e2e6${plyTag}`,
  ];
  if (secondScore !== null) {
    lines.push(
      `info depth 18 seldepth 28 multipv 2 score ${secondScore} nodes 500000 pv b2e2 b9c7 e2e6${plyTag}`,
    );
  }
  lines.push('bestmove h2e2 ponder h9g7');
  return lines;
}

function gateVerdict(bestScore: string, secondScore: string | null): boolean {
  const lines = parseXiangqiScoredLines(uciSearch(bestScore, secondScore));
  return isXiangqiSolverMoveUnique(
    xiangqiScoredLineToVerifyLine(lines[0]),
    xiangqiScoredLineToVerifyLine(lines[1]),
    XIANGQI_SOLVER_GATE_DEFAULTS,
  );
}

// ── The gate contract at the shared defaults ─────────────────────────────────

test('gate contract: a uniquely winning solver move passes', () => {
  // Best keeps a clear win (+600 ~ win% 0.97); the runner-up throws it away
  // (+40 ~ win% 0.55, at/below winLo 0.60): the shipped move is THE answer.
  assert.equal(gateVerdict('cp 600', 'cp 40'), true);
});

test('gate contract: a dual-solution position fails', () => {
  // Two still-winning moves 50cp apart: both are good, forcing one is unfair.
  // This is the verdict that must stay aligned between miner and audit.
  assert.equal(gateVerdict('cp 600', 'cp 550'), false);
});

test('gate contract: two winning moves fail however far apart', () => {
  // +900 vs +600: the runner-up still wins, so it is a second answer.
  assert.equal(gateVerdict('cp 900', 'cp 600'), false);
});

test('gate contract: hard floor rejects near ties before win-band classification', () => {
  assert.equal(gateVerdict('cp 270', 'cp 71'), false); // 199cp gap
  assert.equal(gateVerdict('cp 270', 'cp 70'), true); // 200cp gap, runner-up <= winLo
});

test('gate contract: best move below the winning floor fails even when unique-ish', () => {
  // +150 ~ win% 0.70, under winHi 0.80: not decisively winning, not a puzzle.
  assert.equal(gateVerdict('cp 150', 'cp -50'), false);
});

test('gate contract: a mate is unique only when no other move mates (lichess rule)', () => {
  assert.equal(gateVerdict('mate 3', 'mate 5'), false); // a slower second mate is a trap
  assert.equal(gateVerdict('mate 3', 'mate 3'), false); // dual mate: two solutions
  assert.equal(gateVerdict('mate 3', 'cp 800'), true); // lone mate beats non-mate
  assert.equal(gateVerdict('mate 3', 'mate -4'), true); // second gets mated: not a mate
});

test('gate contract: an only-move (no MultiPV runner-up) is unique', () => {
  assert.equal(gateVerdict('cp 400', null), true);
});

// ── Score normalization: one shared mapping, no local mate folding ───────────

test('parsed scores normalize through the SHARED xiangqiUciScoreToCp', () => {
  // This is exactly where the audit tool used to drift (#185): it carried an
  // inline mate->cp copy that disagreed with the miner's shared mapping on
  // `mate 0` (+30000 vs -30000). Pin every mate shape to the shared function.
  for (const score of ['cp 123', 'cp -450', 'mate 3', 'mate -2', 'mate 0']) {
    const line = parseXiangqiScoredLines(uciSearch(score, null))[0] as XiangqiScoredLine;
    assert.equal(xiangqiScoredLineToVerifyLine(line)?.scoreCp, xiangqiUciScoreToCp(line.score));
  }
  const mateZero = parseXiangqiScoredLines(uciSearch('mate 0', null))[0] as XiangqiScoredLine;
  // mate 0 = the side to move is ALREADY mated: strongly negative, never a win.
  assert.equal(xiangqiScoredLineToVerifyLine(mateZero)?.scoreCp, -XIANGQI_MATE_SCORE_CP);
});

test('parseXiangqiScoredLines keeps the deepest complete snapshot, in rank order', () => {
  const lines = parseXiangqiScoredLines([
    'info depth 10 multipv 2 score cp 80 pv b2e2 h9g7',
    'info depth 10 multipv 1 score cp 200 pv h2e2 h9g7',
    'info depth 18 multipv 1 score cp 350 pv h2e2 b9c7 e2e6',
    'info depth 18 multipv 2 score cp 40 pv b2e2 h9g7 a0a1',
    'info string ignored',
    'bestmove h2e2',
  ]);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0], {
    rank: 1,
    score: { cp: 350, mate: null },
    pvUci: ['h2e2', 'b9c7', 'e2e6'],
    depth: 18,
    nodes: 0,
  });
  assert.deepEqual(lines[1], {
    rank: 2,
    score: { cp: 40, mate: null },
    pvUci: ['b2e2', 'h9g7', 'a0a1'],
    depth: 18,
    nodes: 0,
  });
});

// ── Canonical position loading: history-free FEN, MultiPV 2 ─────────────────

test('analyzeXiangqiSolverPly searches the standalone FEN at MultiPV 2 and gates it', async () => {
  const state = createInitialXiangqiState('gate-contract-test');
  const seen: { fen: string; multipv: number }[] = [];
  let resets = 0;
  const fake = {
    newGame: async () => {
      resets += 1;
    },
    analyzeFen: async (fen: string, _limits: unknown, multipv: number) => {
      seen.push({ fen, multipv });
      return parseXiangqiScoredLines(uciSearch('cp 600', 'cp 40'));
    },
  };
  const ply = await analyzeXiangqiSolverPly(
    fake,
    state,
    { depth: 20, nodes: 600_000 },
    XIANGQI_SOLVER_GATE_DEFAULTS,
  );
  // Both tools must judge from exactly the position a solver sees: the
  // standalone FEN (history-free), never `position startpos moves ...`.
  assert.deepEqual(seen, [{ fen: standardXiangqiEngineFen(state), multipv: 2 }]);
  assert.equal(resets, 1, 'solver-ply verification must clear hash before every search');
  assert.equal(ply.unique, true);
  assert.equal(ply.best?.scoreCp, 600);
  assert.equal(ply.second?.scoreCp, 40);
  assert.equal(ply.lines[0]?.pvUci[0], 'h2e2');

  const dual = await analyzeXiangqiSolverPly(
    {
      newGame: async () => {
        resets += 1;
      },
      analyzeFen: async () => parseXiangqiScoredLines(uciSearch('cp 600', 'cp 550')),
    },
    state,
    { depth: 20 },
    XIANGQI_SOLVER_GATE_DEFAULTS,
  );
  assert.equal(dual.unique, false);
  assert.equal(dual.reason, 'near-tie');
  assert.equal(resets, 2);
});

test('interrupted MultiPV updates cannot assemble a false common-depth comparison', () => {
  // Reduced from the real 1N5Zb 25M-node CC0 trace: depth 31 never completes.
  const raw = [
    'info depth 30 multipv 1 score cp 501 nodes 18561587 pv c7c0 e0e1',
    'info depth 30 multipv 2 score cp 62 nodes 18561587 pv g7e7 d0e1',
    'info depth 30 multipv 3 score cp 51 nodes 18561587 pv b9a7 b0a2',
    'info depth 31 multipv 1 score cp 530 nodes 22709200 pv c7c0 d0e1',
    'info depth 30 multipv 2 score cp 62 nodes 22709200 pv g7e7 d0e1',
    'info depth 30 multipv 3 score cp 51 nodes 22709200 pv b9a7 b0a2',
    'info depth 31 multipv 1 score cp 530 nodes 24453896 pv c7c0 d0e1',
    'info depth 31 multipv 2 score cp 48 nodes 24453896 pv g7e7 d0e1',
    'info depth 30 multipv 3 score cp 51 nodes 24453896 pv b9a7 b0a2',
    'info depth 31 multipv 1 score cp 530 nodes 25000092 pv c7c0 d0e1',
    'info depth 31 multipv 2 score cp 151 upperbound nodes 25000092 pv b9a7',
    'info depth 31 multipv 3 score cp 48 nodes 25000092 pv g7e7 d0e1',
    'bestmove c7c0 ponder d0e1',
  ];
  assert.deepEqual(
    parseXiangqiScoredLines(raw, 3).map((line) => [line.depth, line.score.cp, line.pvUci[0]]),
    [
      [30, 501, 'c7c0'],
      [30, 62, 'g7e7'],
      [30, 51, 'b9a7'],
    ],
  );
});

test('a malformed duplicate-root snapshot cannot replace a valid comparison', () => {
  const parsed = parseXiangqiScoredLines(
    [
      'info depth 20 multipv 1 score cp 500 pv a0a1',
      'info depth 20 multipv 2 score cp 100 pv b0b1',
      'info depth 21 multipv 1 score cp 600 pv a0a1',
      'info depth 21 multipv 2 score cp 200 pv a0a1',
    ],
    2,
  );
  assert.deepEqual(
    parsed.map((line) => [line.depth, line.pvUci[0]]),
    [
      [20, 'a0a1'],
      [20, 'b0b1'],
    ],
  );
});

test('an exact best score from an incomplete same-depth update cannot refresh an older pair', () => {
  const parsed = parseXiangqiScoredLines(
    [
      'info depth 20 multipv 1 score cp 600 pv a0a1',
      'info depth 20 multipv 2 score cp 0 pv b0b1',
      'info depth 20 multipv 1 score cp 650 pv a0a1',
      'info depth 20 multipv 2 score cp 100 upperbound pv b0b1',
    ],
    2,
  );
  assert.deepEqual(
    parsed.map((line) => line.score.cp),
    [600, 0],
  );
});

test('a requested runner-up stays missing when no complete pair is emitted', () => {
  const raw = ['info depth 20 multipv 1 score cp 600 pv a0a1', 'bestmove a0a1'];
  assert.deepEqual(parseXiangqiScoredLines(raw, 2), []);
  assert.equal(parseXiangqiScoredLines(raw, 1)[0]?.score.cp, 600);
});

test('the inferred MultiPV width cannot shrink after an interrupted update', () => {
  const raw = [
    'info depth 20 multipv 1 score cp 500 pv a0a1',
    'info depth 20 multipv 2 score cp 100 pv b0b1',
    'info depth 21 multipv 1 score cp 600 pv a0a1',
  ];
  assert.deepEqual(
    parseXiangqiScoredLines(raw).map((line) => line.score.cp),
    [500, 100],
  );
});
