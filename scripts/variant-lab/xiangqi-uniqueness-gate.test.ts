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
  type XiangqiGameState,
  xiangqiSolverMoveCoverage,
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
  // The frozen CC0 transform separates +600 (~94%) from +40 (~55%).
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

test('gate contract: separation boundary rejects a near tie', () => {
  assert.equal(gateVerdict('cp 500', 'cp 60'), false);
  assert.equal(gateVerdict('cp 500', 'cp 50'), true);
});

test('gate contract: best move below the winning floor fails even when unique-ish', () => {
  // +150 maps below winHi 0.80 on the CC0 score scale.
  assert.equal(gateVerdict('cp 150', 'cp -50'), false);
});

test('gate contract: a mate requires the runner-up to lose the win', () => {
  assert.equal(gateVerdict('mate 3', 'mate 5'), false); // a slower second mate is a trap
  assert.equal(gateVerdict('mate 3', 'mate 3'), false); // dual mate: two solutions
  assert.equal(gateVerdict('mate 3', 'cp 800'), false); // a non-mating alternative still wins
  assert.equal(gateVerdict('mate 9', 'cp 1730'), false); // reported move 25
  assert.equal(gateVerdict('mate 9', 'cp 1280'), false);
  assert.equal(gateVerdict('mate 3', 'cp 40'), true); // runner-up loses the win
  assert.equal(gateVerdict('mate 3', 'cp 70'), true);
  assert.equal(gateVerdict('mate 3', 'cp 132'), true);
  assert.equal(gateVerdict('mate 3', 'cp 134'), false);
  assert.equal(gateVerdict('mate 3', 'mate -4'), true); // second gets mated: not a mate
});

test('gate contract: immediate mates still check non-immediate winning alternatives', () => {
  assert.equal(gateVerdict('mate 1', 'mate 1'), false);
  assert.equal(gateVerdict('mate 1', 'cp 1730'), false);
  assert.equal(gateVerdict('mate 1', 'cp 0'), true);
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

test('parseXiangqiScoredLines keeps complete deepest iterations in rank order', () => {
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
  assert.equal(dual.reason, 'insufficient-separation');
  assert.equal(resets, 2);
});

test('parser compares a completed common depth and ignores bound-only scores', () => {
  const parsed = parseXiangqiScoredLines(
    [
      'info depth 20 multipv 1 score cp 600 nodes 10 pv h2e2',
      'info depth 20 multipv 2 score cp 0 nodes 20 pv b2e2',
      'info depth 21 multipv 1 score cp 800 nodes 30 pv h2e2',
      'info depth 21 multipv 2 score cp 300 lowerbound nodes 40 pv b2e2',
    ],
    2,
  );
  assert.deepEqual(
    parsed.map((line) => [line.depth, line.score.cp]),
    [
      [20, 600],
      [20, 0],
    ],
  );
  assert.deepEqual(
    parseXiangqiScoredLines(['info depth 20 multipv 1 score cp 600 pv h2e2'], 2),
    [],
  );
});

test('immediate-mate admission searches past every kernel-proven immediate win', async () => {
  const state: XiangqiGameState = {
    id: 'three-immediate-mates',
    moveNumber: 1,
    progressClock: 0,
    positionCounts: {},
    status: { type: 'playing', turn: 'red' },
    board: {
      d1: { color: 'red', role: 'general' },
      a8: { color: 'red', role: 'chariot' },
      b9: { color: 'red', role: 'chariot' },
      e10: { color: 'black', role: 'general' },
    },
  };
  const coverage = xiangqiSolverMoveCoverage(state);
  assert.equal(coverage.immediateWins.length, 3);
  const token = (move: { from: string; to: string }) =>
    `${move.from[0]}${Number(move.from.slice(1)) - 1}${move.to[0]}${Number(move.to.slice(1)) - 1}`;
  const requested: number[] = [];
  const analyze = async (alternativeCp: number) =>
    analyzeXiangqiSolverPly(
      {
        newGame: async () => {},
        analyzeFen: async (_fen, _limits, multiPv) => {
          requested.push(multiPv);
          const rows = coverage.immediateWins.map(
            (move, i) => `info depth 22 multipv ${i + 1} score mate 1 pv ${token(move)}`,
          );
          rows.push(`info depth 22 multipv 4 score cp ${alternativeCp} pv a7a6`);
          return parseXiangqiScoredLines(rows, 4);
        },
      },
      state,
      { depth: 22 },
      XIANGQI_SOLVER_GATE_DEFAULTS,
    );
  assert.equal((await analyze(700)).unique, false);
  assert.equal((await analyze(0)).unique, true);
  assert.deepEqual(requested, [4, 4]);
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
