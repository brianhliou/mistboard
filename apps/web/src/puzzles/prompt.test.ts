import { XIANGQI_MATE_SEARCH_MAX_SOLVER_MOVES } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { puzzlePrompt } from './prompt.js';

const withinCap = XIANGQI_MATE_SEARCH_MAX_SOLVER_MOVES * 2 - 1;
const pastCap = withinCap + 2;

describe('puzzlePrompt', () => {
  it('asks for the best move where the grader accepts any forced mate', () => {
    expect(
      puzzlePrompt({
        variant: 'xiangqi',
        goal: { type: 'checkmate', winner: 'red' },
        solutionPlyCount: withinCap,
      }),
    ).toBe('Find the best move.');
  });

  it('asks for the fastest mate once the mate is longer than the grader can prove', () => {
    expect(
      puzzlePrompt({
        variant: 'xiangqi',
        goal: { type: 'checkmate', winner: 'red' },
        solutionPlyCount: pastCap,
      }),
    ).toBe('Find the fastest mate.');
  });

  it('never narrows the ask on winning-advantage puzzles or other variants', () => {
    expect(
      puzzlePrompt({
        variant: 'xiangqi',
        goal: { type: 'winning-advantage', winner: 'red' },
        solutionPlyCount: pastCap,
      }),
    ).toBe('Find the best move.');
    expect(
      puzzlePrompt({
        variant: 'mini-xiangqi',
        goal: { type: 'checkmate', winner: 'red' },
        solutionPlyCount: pastCap,
      }),
    ).toBe('Find the best move.');
  });
});
