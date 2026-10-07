import {
  applyJieqiMove,
  createInitialJieqiState,
  getJieqiLegalMoves,
  type JieqiMove,
  STANDARD_JIEQI_DEAL,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { computeGameAnalysis } from './game-analysis.js';
import { mountJieqiReview } from './jieqi-review.js';
import type { DecisionOverlay } from './tree-review.js';

// The reveal's luck as a die on the review board (board-luck-mark.ts), end to end in jsdom:
// on by default, on the square the revealed piece landed on, only on a scored reveal ply,
// and the hover card it opens is torn down with the review.

// The first legal reveal (a face-down piece moving) for each side, so ply 1 is a reveal.
function firstMoves(count: number): JieqiMove[] {
  let state = createInitialJieqiState('t', STANDARD_JIEQI_DEAL);
  const moves: JieqiMove[] = [];
  for (let i = 0; i < count; i += 1) {
    const legal = getJieqiLegalMoves(state);
    const move = legal.find((m) => state.board[m.from]?.faceDown) ?? legal[0]!;
    moves.push(move);
    state = applyJieqiMove(state, move);
  }
  return moves;
}

function fakeAnalysis(plyCount: number) {
  const plies = Array.from({ length: plyCount + 1 }, (_, ply) => ({
    ply,
    cp: 0,
    mate: null,
    best: null,
  }));
  return computeGameAnalysis({ engineId: 'test', depth: 10, plies, chancePlies: [1, 3] });
}

// Ply 1 is a scored reveal with luck; ply 3 is scored with no luck number; ply 2 is not a
// chance ply at all.
const OVERLAY: DecisionOverlay = {
  byPly: new Map([
    [1, { judgment: null, accuracy: 100, luck: -14, playedRank: 1 }],
    [3, { judgment: null, accuracy: 100, playedRank: 1 }],
  ]),
  red: { reveals: 2, decisionAccuracy: 100 },
  black: { reveals: 0, decisionAccuracy: 100 },
};

function key(name: string): void {
  document.body.dispatchEvent(
    new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }),
  );
}

async function mount(moves: JieqiMove[]) {
  const root = document.createElement('div');
  document.body.append(root);
  const handle = mountJieqiReview(root, 'room-luck', STANDARD_JIEQI_DEAL, {
    ariaLabel: 'test',
    title: 'Jieqi',
    summary: 'test',
    moves,
    analysis: {
      requestLabel: 'Analyse',
      fetchCached: async () => fakeAnalysis(moves.length),
      run: async () => fakeAnalysis(moves.length),
    },
    decisions: { fetchCached: async () => OVERLAY, canRun: true, run: async () => OVERLAY },
  });
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  return { root, handle };
}

describe('the luck die on the jieqi review board', () => {
  it('draws on the reveal’s landing square by default, and nowhere else', async () => {
    const moves = firstMoves(3);
    const before = createInitialJieqiState('t', STANDARD_JIEQI_DEAL);
    // The fixture's first move is a reveal (a face-down piece moving).
    expect(before.board[moves[0]!.from]?.faceDown).toBe(true);
    const { root, handle } = await mount(moves);
    try {
      key('Home');
      key('ArrowRight'); // ply 1: the lucky-or-not reveal
      const marks = root.querySelectorAll('.luck-mark');
      expect(marks).toHaveLength(1);
      const mark = marks[0]!;
      expect(mark.getAttribute('data-luck-square')).toBe(moves[0]!.to);
      // -14 points: an unlucky, big swing (four pips).
      expect(mark.classList.contains('luck-mark--unlucky')).toBe(true);
      expect(mark.querySelectorAll('.luck-mark__pip')).toHaveLength(4);

      key('ArrowRight'); // ply 2: not a chance ply
      expect(root.querySelector('.luck-mark')).toBeNull();
      key('ArrowRight'); // ply 3: scored, but no luck number
      expect(root.querySelector('.luck-mark')).toBeNull();
      key('Home'); // the start position has no move
      expect(root.querySelector('.luck-mark')).toBeNull();
    } finally {
      handle.destroy();
      root.remove();
    }
  });

  it('removes its hover card when the review unmounts', async () => {
    const { root, handle } = await mount(firstMoves(3));
    expect(document.querySelectorAll('.luck-card').length).toBeGreaterThan(0);
    handle.destroy();
    root.remove();
    expect(document.querySelectorAll('.luck-card')).toHaveLength(0);
  });
});
