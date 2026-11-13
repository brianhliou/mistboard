import assert from 'node:assert/strict';
import test from 'node:test';
import {
  XIANGQI_SOLVER_GATE_DEFAULTS,
  type XiangqiPuzzle,
  xiangqiMoveToPikafishUci,
} from '../../packages/game/src/index.ts';
import type { PikafishEngine } from './xiangqi-pikafish-uci.ts';
import { auditXiangqiPuzzle } from './xiangqi-puzzle-uniqueness-audit.ts';

test('durable audit refuses a quiet tail even when every stored move clears score separation', async () => {
  const puzzle: XiangqiPuzzle = {
    id: 'audit-endpoint',
    variant: 'xiangqi',
    title: 'Payoff',
    themes: ['winning'],
    goal: { type: 'winning-advantage' },
    initial: {
      id: 'audit-endpoint',
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
    solution: [
      { from: 'a1', to: 'a5' },
      { from: 'e10', to: 'e9' },
      { from: 'a5', to: 'a6' },
    ],
  };
  let calls = 0;
  const engine = {
    newGame: async () => {},
    analyzeFen: async () => {
      const token = xiangqiMoveToPikafishUci(puzzle.solution[Math.floor(calls++ / 2) * 2]!);
      return [
        { rank: 1, score: { cp: 1000, mate: null }, pvUci: [token], depth: 22 },
        { rank: 2, score: { cp: -200, mate: null }, pvUci: ['d0d1'], depth: 22 },
      ];
    },
  } as unknown as PikafishEngine;
  const report = await auditXiangqiPuzzle(engine, puzzle, {
    ...XIANGQI_SOLVER_GATE_DEFAULTS,
    depth: 22,
    nodes: null,
    limit: 0,
    ids: null,
    out: null,
  });
  assert.equal(report.allMatch, true);
  assert.ok(report.plies.every((ply) => ply.unique));
  assert.equal(report.verdict, 'invalid-endpoint');
  assert.ok(report.endpoint.ok);
  assert.equal(report.endpoint.moves.length, 1);
});

test('independent audit rejects a forced starting move without spending engine searches', async () => {
  const puzzle: XiangqiPuzzle = {
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
  const engine = {
    newGame: async () => {
      throw new Error('must not search');
    },
  } as unknown as PikafishEngine;
  const report = await auditXiangqiPuzzle(engine, puzzle, {
    ...XIANGQI_SOLVER_GATE_DEFAULTS,
    depth: 22,
    nodes: null,
    limit: 0,
    ids: null,
    out: null,
  });
  assert.equal(report.verdict, 'invalid-start');
  assert.equal(report.solverPlies, 0);
});
