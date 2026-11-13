import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { XiangqiPuzzle } from '../../packages/game/src/puzzles-xiangqi.ts';
import { xiangqiSolverMoveCoverage } from '../../packages/game/src/puzzles-xiangqi-mining.ts';
import {
  auditXiangqiCorpusPuzzle,
  judgeXiangqiSearchEvidence,
  verifyXiangqiSearchPvs,
} from './xiangqi-corpus-quality-audit.ts';
import { parseXiangqiScoredLines, type XiangqiSolverPlyAnalysis } from './xiangqi-pikafish-uci.ts';

const puzzle: XiangqiPuzzle = {
  id: 'audit-capture',
  variant: 'xiangqi',
  title: 'Capture',
  themes: ['winning'],
  goal: { type: 'winning-advantage', winner: 'red', centipawns: 600 },
  initial: {
    id: 'audit-capture',
    moveNumber: 1,
    progressClock: 0,
    positionCounts: {},
    status: { type: 'playing', turn: 'red' },
    board: {
      d1: { color: 'red', role: 'general' },
      a1: { color: 'red', role: 'chariot' },
      e10: { color: 'black', role: 'general' },
      a5: { color: 'black', role: 'horse' },
    },
  },
  solution: [{ from: 'a1', to: 'a5' }],
};
const parsed = (depth = 22) =>
  parseXiangqiScoredLines(
    [
      `info depth ${depth} multipv 1 score cp 600 pv a0a4`,
      `info depth ${depth} multipv 2 score cp -200 pv a0b0`,
      `info depth ${depth} multipv 3 score cp -300 pv a0a1`,
    ],
    3,
  );
function analysis(depth = 22): XiangqiSolverPlyAnalysis {
  return {
    lines: parsed(depth),
    best: { scoreCp: 600, mate: null },
    second: { scoreCp: -200, mate: null },
    unique: true,
    reason: 'winning-chance-separation',
    moveCoverage: xiangqiSolverMoveCoverage(puzzle.initial),
  };
}

test('a complete snapshot audit uses both budgets, records evidence and leaves source untouched', async () => {
  const before = JSON.stringify(puzzle);
  const seen: number[] = [];
  const result = await auditXiangqiCorpusPuzzle(
    {
      newGame: async () => {},
      analyzeFen: async (_fen, limits, ranks) => {
        seen.push(limits.nodes ?? 0);
        assert.equal(ranks, 3);
        return parsed();
      },
    },
    puzzle,
  );
  assert.deepEqual(seen, [5_000_000, 25_000_000]);
  assert.equal(result.decision.disposition, 'keep');
  assert.equal(result.evidence.length, 1);
  assert.equal(JSON.stringify(puzzle), before);
});

test('budget disagreement and insufficient depth stay unresolved', () => {
  const first = analysis();
  const disagreement = { ...analysis(), unique: false, reason: 'insufficient-separation' as const };
  assert.equal(
    judgeXiangqiSearchEvidence(0, puzzle.solution[0]!, [first, disagreement]).verdict,
    'unresolved',
  );
  assert.equal(
    judgeXiangqiSearchEvidence(0, puzzle.solution[0]!, [first, analysis(21)]).reason,
    'search-under-depth',
  );
});

test('a stable different best move is not a keep for the stored answer', () => {
  const first = analysis();
  first.lines[0]!.pvUci = ['a0b0'];
  const result = judgeXiangqiSearchEvidence(0, puzzle.solution[0]!, [first, first]);
  assert.equal(result.verdict, 'fail');
  assert.equal(result.reason, 'stored-answer-mismatch');
});

test('invalid engine PV and missing alternative coverage cannot silently pass', () => {
  const invalid = analysis();
  invalid.lines[0]!.pvUci = ['z0z1'];
  assert.equal(verifyXiangqiSearchPvs(puzzle.initial, invalid), false);
  const missing = { ...analysis(), reason: 'immediate-mate-alternatives-unchecked' as const };
  assert.equal(
    judgeXiangqiSearchEvidence(0, puzzle.solution[0]!, [missing, missing]).verdict,
    'unresolved',
  );
});

test('fresh corpus workers reject forced starts before engine analysis', async () => {
  const forced: XiangqiPuzzle = {
    id: 'forced-root',
    variant: 'xiangqi',
    title: 'Forced response',
    themes: ['winning'],
    goal: { type: 'winning-advantage' },
    solution: [{ from: 'a3', to: 'e3' }],
    initial: {
      id: 'forced-root',
      moveNumber: 1,
      progressClock: 0,
      positionCounts: {},
      status: { type: 'playing', turn: 'red' },
      board: {
        e1: { color: 'red', role: 'general' },
        a3: { color: 'red', role: 'chariot' },
        d10: { color: 'black', role: 'general' },
        e3: { color: 'black', role: 'chariot' },
        d2: { color: 'black', role: 'chariot' },
        h2: { color: 'black', role: 'horse' },
      },
    },
  };
  const result = await auditXiangqiCorpusPuzzle(
    {
      newGame: async () => {
        throw new Error('must not search');
      },
      analyzeFen: async () => {
        throw new Error('must not search');
      },
    },
    forced,
  );
  assert.equal(result.decision.disposition, 'withhold-candidate');
  assert.equal(result.decision.reason, 'no-choice-at-root');
  assert.deepEqual(result.evidence, []);
});

const readerTactics = JSON.parse(
  readFileSync(new URL('./fixtures/advantage-review-regressions.json', import.meta.url), 'utf8'),
) as {
  code: string;
  initial: XiangqiPuzzle['initial'];
  solution: XiangqiPuzzle['solution'];
  searches: XiangqiSolverPlyAnalysis[];
}[];
for (const example of readerTactics) {
  test(`${example.code}: a useful advantage tactic remains a review case while its admission key still fails`, async () => {
    const p: XiangqiPuzzle = {
      id: `review-${example.code}`,
      variant: 'xiangqi',
      title: 'Advantage review regression',
      themes: ['winning'],
      goal: { type: 'winning-advantage' },
      initial: example.initial,
      solution: example.solution,
    };
    const before = JSON.stringify(p);
    let i = 0;
    const result = await auditXiangqiCorpusPuzzle(
      {
        newGame: async () => {},
        analyzeFen: async () => {
          const s = example.searches[i++];
          assert(s);
          return s.lines;
        },
      },
      p,
    );
    assert.equal(i, 2);
    assert.equal(result.judgments[0]?.verdict, 'fail');
    assert.equal(result.decision.disposition, 'needs-review');
    assert.equal(result.decision.reason, result.judgments[0]?.reason);
    assert.equal(result.decision.replacement, undefined);
    assert.equal(JSON.stringify(p), before);
  });
}
