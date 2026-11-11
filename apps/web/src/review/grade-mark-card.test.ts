// The move-grade card (#517): hovering or tapping a ?!, ? or ?? mark, on the board or in the
// move list, says the grade, what it cost in win chance and the better move. Its numbers are
// the analysis mark's own, so the card cannot disagree with the advice line beside it.
import { winPercent, winPercentK, type XiangqiMove } from '@mistboard/game';
import { afterEach, describe, expect, it } from 'vitest';
import { analysisMarks, type DecisionOverlay } from './analysis-marks.js';
import { computeGameAnalysis, type GameAnalysis } from './game-analysis.js';
import { gradeCardHtml } from './grade-mark-card.js';
import type { SerializedTree } from './tree-serialize.js';
import { mountXiangqiReview } from './xiangqi-review.js';

const text = (html: string): string =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

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
const K = winPercentK('test');
const BLUNDER_LOSS = Math.round(winPercent(250, null, K) - winPercent(-300, null, K));

const marksOf = (analysis: GameAnalysis, decisions: DecisionOverlay | null = null) =>
  analysisMarks({
    analysis,
    decisions,
    quoteEvalBestMove: true,
    formatBestMove: (uci) => `${uci.slice(0, 2)}-${uci.slice(2, 4)}`,
  });

describe('the grade behind a mark', () => {
  it('a quiet move: the eval drop it was graded on, and the eval track’s best move', () => {
    expect(BLUNDER_LOSS).toBeGreaterThan(30);
    const marks = marksOf(ANALYSIS);
    expect(marks.get(1)?.grade).toEqual({ judgment: 'blunder', loss: BLUNDER_LOSS, best: 'h3-e3' });
    // A fine move has nothing to explain.
    expect(marks.get(2)?.grade).toBeUndefined();
  });

  it('a chance move: the decision layer’s luck-free values, never the realised swing', () => {
    // The eval track saw no judgment on this reveal ply (a chance ply is left to the
    // decision layer), so every number comes from the ranked table the mover could see.
    const analysis = computeGameAnalysis({
      engineId: 'test',
      depth: 10,
      plies: [
        { ply: 0, cp: 0, mate: null, best: null },
        { ply: 1, cp: -900, mate: null, best: null },
      ],
      chancePlies: [1],
    });
    const overlay: DecisionOverlay = {
      byPly: new Map([
        [
          1,
          {
            judgment: 'mistake',
            accuracy: 60,
            luck: -30,
            playedRank: 2,
            candidates: [
              { label: 'e1-d1', win: 58 },
              { label: 'c4-c5', win: 46, played: true },
            ],
          },
        ],
      ]),
      red: { reveals: 1, decisionAccuracy: 60 },
      black: { reveals: 0, decisionAccuracy: 100 },
    };
    expect(marksOf(analysis, overlay).get(1)?.grade).toEqual({
      judgment: 'mistake',
      loss: 12,
      best: 'e1-d1',
    });
  });

  it('the card says it in words, leaving out what the analysis cannot fill', () => {
    expect(text(gradeCardHtml({ judgment: 'mistake', loss: 12, best: 'c3-c4' }))).toBe(
      'Mistake Lost 12 points of win chance Better was c3-c4',
    );
    expect(text(gradeCardHtml({ judgment: 'inaccuracy' }))).toBe('Inaccuracy');
  });
});

// ── Triggers, through the review itself ──

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function key(name: string): void {
  document.body.dispatchEvent(
    new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }),
  );
}

function pointer(
  target: EventTarget,
  type: string,
  init: { pointerType: string; x?: number; y?: number },
): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      pointerType: init.pointerType,
      clientX: init.x ?? 0,
      clientY: init.y ?? 0,
    }),
  );
}

const openCard = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('.luck-card.luck-card--open:not([hidden])');

afterEach(() => {
  document.body.replaceChildren();
});

describe('the grade card on the review', () => {
  function mountAnalysed(): HTMLElement {
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

  const blunderWords = `Blunder Lost ${BLUNDER_LOSS} points of win chance Better was h3-e3`;

  it('opens from the move list’s glyph on hover, for that glyph’s move', async () => {
    const root = mountAnalysed();
    await settle();
    // The cursor is on the tip (ply 2); the list's ?? is ply 1's, and opens ply 1's card.
    const glyph = root.querySelector<HTMLElement>('.review-move-list__suffix[data-grade-path]');
    expect(glyph?.textContent).toBe('??');
    pointer(glyph!, 'pointerover', { pointerType: 'mouse' });
    expect(text(openCard()?.innerHTML ?? '')).toBe(blunderWords);
  });

  it('opens from the board badge on hover and on a tap', async () => {
    const root = mountAnalysed();
    await settle();
    key('ArrowLeft'); // ply 1: the blunder, badged on e3
    const badge = root.querySelector('.xq-marker--glyph');
    expect(badge).not.toBeNull();
    badge!.getBoundingClientRect = () => new DOMRect(300, 200, 24, 24);
    pointer(badge!, 'pointermove', { pointerType: 'mouse', x: 312, y: 212 });
    expect(text(openCard()?.innerHTML ?? '')).toBe(blunderWords);
    pointer(badge!, 'pointermove', { pointerType: 'mouse', x: 100, y: 100 });
    expect(openCard()).toBeNull();
    pointer(badge!, 'pointerdown', { pointerType: 'touch', x: 312, y: 212 });
    expect(openCard()).not.toBeNull();
  });

  it('opens nothing for a glyph the user wrote: it has no numbers behind it', () => {
    // NAG 2 = '?', authored, no analysis.
    const tree: SerializedTree = {
      version: 1,
      root: { children: [{ uci: 'h3e3', annotations: { glyphs: [2] }, children: [] }] },
    };
    const root = document.createElement('div');
    document.body.append(root);
    mountXiangqiReview(root, {
      ariaLabel: 'Study',
      title: 'Study',
      summary: '',
      moves: [],
      initialTree: tree,
      analysis: null,
    });
    const glyph = root.querySelector<HTMLElement>('.review-move-list__suffix[data-grade-path]');
    expect(glyph?.textContent).toBe('?');
    pointer(glyph!, 'pointerover', { pointerType: 'mouse' });
    const badge = root.querySelector('.xq-marker--glyph')!;
    badge.getBoundingClientRect = () => new DOMRect(300, 200, 24, 24);
    pointer(badge, 'pointermove', { pointerType: 'mouse', x: 312, y: 212 });
    expect(openCard()).toBeNull();
  });
});
