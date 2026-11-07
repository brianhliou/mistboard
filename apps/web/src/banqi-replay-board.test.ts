// @vitest-environment happy-dom

import { banqiStateToDealtFen, createBanqiDeal, createInitialBanqiState } from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ENDGAME_LINE, ENDGAME_ROOT_FEN } from './articles/banqi-endgame-diagrams.js';
import { mountBanqiReplayBoard } from './banqi-replay-board.js';
import { animateBanqiBoardMove, animateBanqiReveal } from './live-banqi-render.js';

vi.mock('./live-banqi-render.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./live-banqi-render.js')>()),
  animateBanqiBoardMove: vi.fn(),
  animateBanqiReveal: vi.fn(),
}));

const glides = () =>
  vi
    .mocked(animateBanqiBoardMove)
    .mock.calls.map(([, move, opts]) => [`${move.from}${move.to}`, opts?.reverse ?? false]);

describe('banqi replay board glides', () => {
  afterEach(() => {
    vi.mocked(animateBanqiBoardMove).mockClear();
    vi.mocked(animateBanqiReveal).mockClear();
  });

  it('glides one step, onto a sideline from the position it leaves and back off it, but not a jump', () => {
    const moves = ENDGAME_LINE.map((move) => `${move.from}${move.to}`);
    // Red's other first move from the root, c1-d1, as a reader's sideline.
    const board = mountBanqiReplayBoard(document.createElement('div'), {
      rootFen: ENDGAME_ROOT_FEN,
      moves,
      lines: new Map([[1, ['c1d1']]]),
    });
    board.jumpToPly(1);
    expect(glides()).toEqual([[moves[0], false]]);
    board.jumpToPly(0);
    board.jumpToLine(1, 1);
    board.jumpToPly(0);
    expect(glides().slice(1)).toEqual([
      [moves[0], true],
      ['c1d1', false],
      ['c1d1', true],
    ]);
    board.jumpToPly(5);
    board.jumpToLine(1, 1);
    expect(glides()).toHaveLength(4);
  });

  it('turns the tile over on a step forward onto a flip, and not back or on a jump', () => {
    let n = 0.37;
    const deal = createBanqiDeal(() => {
      n = (n * 9301 + 49297) % 233280;
      return n / 233280;
    });
    const rootFen = banqiStateToDealtFen(createInitialBanqiState('t', deal));
    const board = mountBanqiReplayBoard(document.createElement('div'), {
      rootFen,
      moves: ['b2b2', 'c2c2'],
    });
    board.jumpToPly(1);
    expect(vi.mocked(animateBanqiReveal).mock.calls.map(([, square]) => square)).toEqual(['b2']);
    board.jumpToPly(0);
    board.jumpToPly(2);
    expect(animateBanqiReveal).toHaveBeenCalledTimes(1);
    // A flip travels nowhere, so it never glides either way.
    expect(animateBanqiBoardMove).not.toHaveBeenCalled();
  });
});
