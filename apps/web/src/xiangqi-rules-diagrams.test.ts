import {
  getStandardXiangqiLegalMovesFrom,
  isStandardXiangqiLegalMove,
  type XiangqiGameState,
  type XiangqiSquare,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { xiangqiArticle } from './articles/content/xiangqi.js';
import {
  XIANGQI_RULES_LINES,
  xiangqiRulesMoves,
  xiangqiRulesStates,
} from './xiangqi-rules-diagrams.js';

function destinations(state: XiangqiGameState, from: XiangqiSquare): string[] {
  return getStandardXiangqiLegalMovesFrom(state, from)
    .map((move) => move.to)
    .sort();
}

describe('Xiangqi rules examples through the game kernel', () => {
  for (const [name, line] of Object.entries(XIANGQI_RULES_LINES)) {
    it(`${name}: every displayed position is reached from the start by legal moves`, () => {
      const states = xiangqiRulesStates(line);
      const moves = xiangqiRulesMoves(line);
      expect(states).toHaveLength(moves.length + 1);
      for (const [i, move] of moves.entries()) {
        expect(isStandardXiangqiLegalMove(states[i], move)).toBe(true);
        expect(states[i + 1].lastMove).toEqual(move);
      }
    });
  }

  it('MOVES AS A HORSE: the horse steps one point along a line, then one diagonally out', () => {
    const [start, after] = xiangqiRulesStates(XIANGQI_RULES_LINES.horse);
    // b1 to c3 or a3; the elephant on c1 blocks the leg toward d2.
    expect(destinations(start, 'b1')).toEqual(['a3', 'c3']);
    expect(after.board.c3).toEqual({ color: 'red', role: 'horse' });
  });

  it('CAPTURES BY JUMPING: the cannon needs exactly one screen and cannot take what it cannot jump to', () => {
    const [start, after] = xiangqiRulesStates(XIANGQI_RULES_LINES.cannon);
    expect(start.board.b8).toEqual({ color: 'black', role: 'cannon' });
    expect(start.board.b10).toEqual({ color: 'black', role: 'horse' });
    const dests = destinations(start, 'b3');
    expect(dests).toContain('b10'); // jumps the cannon on b8
    expect(dests).not.toContain('b8'); // no screen in front of the first piece
    expect(dests).not.toContain('b9'); // a quiet move cannot pass a piece
    expect(after.board.b10).toEqual({ color: 'red', role: 'cannon' });
    expect(after.board.b8).toEqual({ color: 'black', role: 'cannon' });
  });

  it('renders every rules figure', () => {
    let figures = 0;
    for (const section of xiangqiArticle.sections) {
      for (const block of section.blocks ?? []) {
        if (block.kind !== 'raw-svg') continue;
        const svg = typeof block.svg === 'function' ? block.svg() : block.svg;
        expect(svg).toContain('<svg');
        figures += 1;
      }
    }
    expect(figures).toBeGreaterThanOrEqual(8);
  });
});
