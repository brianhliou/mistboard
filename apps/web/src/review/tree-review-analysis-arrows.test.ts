// With the local engine OFF, the board follows lichess: the position a judged move was
// played FROM shows the better move the stored analysis named (so "?? h3-e3 was best."
// is an arrow where h3-e3 could have been played), and the judged move's own position
// shows only its glyph badge. A quiet move gets the eval track's single best move; a
// jieqi reveal gets its ranked alternatives (never a line past the reveal). Positions
// whose next move was fine draw no arrows.
import {
  applyJieqiMove,
  createInitialJieqiState,
  getJieqiLegalMoves,
  type JieqiMove,
  STANDARD_JIEQI_DEAL,
  type XiangqiMove,
} from '@mistboard/game';
import { afterEach, describe, expect, it } from 'vitest';
import type { DecisionOverlay } from './analysis-marks.js';
import { computeGameAnalysis, type GameAnalysis } from './game-analysis.js';
import { mountJieqiReview } from './jieqi-review.js';
import { mountXiangqiReview } from './xiangqi-review.js';

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function key(name: string): void {
  document.body.dispatchEvent(
    new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }),
  );
}

function arrowLayer(root: HTMLElement): string {
  return root.querySelector('.xq-live-arrows')?.innerHTML ?? '';
}

function glyphLayer(root: HTMLElement): string {
  return root.querySelector('.xq-live-glyphs, .jieqi-board-markers')?.innerHTML ?? '';
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('stored best-move arrows on the review board (engine off)', () => {
  // Red's b3-e3 collapses the eval; the engine wanted h3-e3. Black's reply is fine.
  const PLAYED: XiangqiMove[] = [
    { from: 'b3', to: 'e3' },
    { from: 'h8', to: 'e8' },
  ];
  const ANALYSIS: GameAnalysis = computeGameAnalysis({
    engineId: 'test',
    depth: 12,
    plies: [
      { ply: 0, cp: 250, mate: null, best: 'h3e3' },
      { ply: 1, cp: -300, mate: null, best: 'h8e8' },
      { ply: 2, cp: -300, mate: null, best: 'h3e3' },
    ],
  });

  function mount(): HTMLElement {
    const root = document.createElement('div');
    document.body.append(root);
    mountXiangqiReview(root, {
      ariaLabel: 'Review',
      title: 'Review',
      summary: '',
      moves: PLAYED,
      analysis: {
        requestLabel: 'Analyse',
        fetchCached: async () => ANALYSIS,
        run: async () => ANALYSIS,
      },
    });
    return root;
  }

  it('draws the better move on the position before the judged move, the badge on it', async () => {
    const root = mount();
    await settle();
    // Mount lands on the tip (ply 2, Black's fine reply): no arrow, no badge.
    expect(arrowLayer(root)).not.toContain('xq-arrow--best');
    expect(glyphLayer(root)).not.toContain('>??<');
    key('ArrowLeft'); // ply 1: the blunder b3-e3 itself
    expect(root.textContent).toContain('Blunder. h3-e3 was best.');
    expect(arrowLayer(root)).not.toContain('xq-arrow--best');
    expect(glyphLayer(root)).toContain('>??</text>');
    expect(glyphLayer(root)).toContain('xq-marker--blunder');
    key('ArrowLeft'); // the start position, where h3-e3 was available
    expect(arrowLayer(root).match(/xq-arrow--best/g)).toHaveLength(1);
    expect(glyphLayer(root)).not.toContain('>??<');
  });
});

describe('a reveal blunder: ranked alternatives before it, the badge on it (jieqi, engine off)', () => {
  function firstMoves(count: number): JieqiMove[] {
    let state = createInitialJieqiState('t', STANDARD_JIEQI_DEAL);
    const moves: JieqiMove[] = [];
    for (let i = 0; i < count; i += 1) {
      const move = getJieqiLegalMoves(state)[0]!;
      moves.push(move);
      state = applyJieqiMove(state, move);
    }
    return moves;
  }

  it('one arrow per alternative before the reveal, the played reveal excluded, best on top', async () => {
    const moves = firstMoves(2);
    const analysis = computeGameAnalysis({
      engineId: 'test',
      depth: 10,
      plies: [0, 1, 2].map((ply) => ({ ply, cp: 0, mate: null, best: null })),
      chancePlies: [1],
    });
    const overlay: DecisionOverlay = {
      byPly: new Map([
        [
          1,
          {
            judgment: 'blunder',
            accuracy: 30,
            luck: -10,
            playedRank: 4,
            candidates: [
              { label: 'b3-b10', win: 70, uci: 'b2b9' },
              { label: 'h3-h10', win: 68, uci: 'h2h9' },
              { label: 'b3-e3', win: 66, uci: 'b2e2' },
              { label: 'played', win: 35, uci: 'a3a4', played: true },
            ],
          },
        ],
      ]),
      red: { reveals: 1, decisionAccuracy: 30 },
      black: { reveals: 0, decisionAccuracy: 100 },
    };
    const root = document.createElement('div');
    document.body.append(root);
    mountJieqiReview(root, 'room-arrows', STANDARD_JIEQI_DEAL, {
      ariaLabel: 'test',
      title: 'Jieqi',
      summary: 'test',
      moves,
      analysis: {
        requestLabel: 'Analyse',
        fetchCached: async () => analysis,
        run: async () => analysis,
      },
      decisions: { fetchCached: async () => overlay, canRun: true, run: async () => overlay },
    });
    await settle();
    key('ArrowLeft'); // ply 1, the reveal itself: its badge, no alternatives
    expect(root.textContent).toContain('Blunder. b3-b10 was best.');
    expect(arrowLayer(root)).not.toContain('xq-arrow');
    expect(glyphLayer(root)).toContain('>??</text>');
    key('ArrowLeft'); // the start position the reveal was chosen from
    const html = arrowLayer(root);
    expect(html.match(/xq-arrow--alt/g)).toHaveLength(2);
    expect(html.match(/xq-arrow--best/g)).toHaveLength(1);
    // Best paints last, over the alternates.
    expect(html.lastIndexOf('xq-arrow--best')).toBeGreaterThan(html.lastIndexOf('xq-arrow--alt'));
    // The move the advice names is a clickable one-move branch, never a line past it.
    const variations = [...root.querySelectorAll('.move-tree__variation')];
    expect(variations).toHaveLength(1);
    expect(variations[0]?.textContent).toContain('b3-b10');
    expect(variations[0]?.textContent).not.toContain('h3-h10');
    expect(variations[0]?.querySelectorAll('.move-tree__move')).toHaveLength(1);
  });
});
