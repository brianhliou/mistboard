// The phone game review's analysis strip (#619): between the board's bottom
// player row and the arrow bar, the request button before analysis, its
// progress while it runs, and the advantage chart once it lands, with no
// reload. Tap or drag the strip to jump. Above 600px the same element stays in
// the Computer analysis tab.
import type { XiangqiMove } from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatEval } from './engine/eval-format.js';
import type { GameAnalysis } from './game-analysis.js';
import { mountXiangqiReview } from './xiangqi-review.js';

const PLAYED: XiangqiMove[] = [
  { from: 'b3', to: 'e3' },
  { from: 'h8', to: 'e8' },
  { from: 'b1', to: 'c3' },
  { from: 'h10', to: 'g8' },
];
const CPS = [20, 30, -40, 50, -60];

const ANALYSIS: GameAnalysis = {
  engineId: 'test',
  depth: 12,
  evals: CPS.map((cp, ply) => ({ ply, cp, mate: null, best: null, pv: [] })),
  moves: PLAYED.map((_, i) => ({
    ply: i + 1,
    mover: i % 2 === 0 ? ('red' as const) : ('black' as const),
    judgment: null,
    accuracy: 100,
  })),
  chancePlies: [],
  unstablePlies: [],
  bestPlayedPlies: [],
  red: { accuracy: 100, inaccuracies: 0, mistakes: 0, blunders: 0, acpl: 0 },
  black: { accuracy: 100, inaccuracies: 0, mistakes: 0, blunders: 0, acpl: 0 },
};

function stubMedia(phone: boolean): void {
  const media = new EventTarget() as MediaQueryList;
  Object.defineProperty(media, 'matches', { value: phone, writable: true });
  vi.spyOn(window, 'matchMedia').mockReturnValue(media);
}

function mount(analysis: {
  fetchCached: () => Promise<GameAnalysis | null>;
  run: (onProgress?: (done: number, total: number) => void) => Promise<GameAnalysis>;
}): HTMLElement {
  const root = document.createElement('div');
  document.body.append(root);
  const metaCard = document.createElement('section');
  metaCard.className = 'game-meta-card';
  mountXiangqiReview(root, {
    ariaLabel: 'Review',
    title: 'Review',
    summary: '',
    moves: PLAYED,
    metaCard,
    phoneInfoSheet: true,
    analysis: { requestLabel: 'Request computer analysis', ...analysis },
  });
  return root;
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const strip = (root: HTMLElement) => root.querySelector<HTMLElement>('.review-phone-analysis')!;
const tabBody = (root: HTMLElement) =>
  root.querySelector<HTMLElement>('.review-underboard-panel__body')!;
const chip = (root: HTMLElement) =>
  root.querySelector<HTMLElement>('.review-phone-analysis__eval')!;

describe('phone game review analysis strip', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('holds the request, then its progress, then the chart', async () => {
    stubMedia(true);
    let progress: ((done: number, total: number) => void) | undefined;
    let land: (analysis: GameAnalysis) => void = () => {};
    const root = mount({
      fetchCached: async () => null,
      run: (onProgress) => {
        progress = onProgress;
        return new Promise((resolve) => {
          land = resolve;
        });
      },
    });
    await settle();

    // Below the board, before the bar, in the col1 stack.
    expect(strip(root).hidden).toBe(false);
    expect(strip(root).dataset.kind).toBe('request');
    const button = strip(root).querySelector<HTMLButtonElement>('.xiangqi-review__analyse');
    expect(button?.textContent).toBe('Request computer analysis');
    expect(tabBody(root).contains(button)).toBe(false);
    expect(chip(root).hidden).toBe(true);

    button?.click();
    expect(button?.disabled).toBe(true);
    progress?.(2, 5);
    expect(strip(root).querySelector('.xiangqi-review__analyse')?.textContent).toBe(
      'Analysing… 2/5',
    );

    land(ANALYSIS);
    await settle();
    expect(strip(root).hidden).toBe(false);
    expect(strip(root).dataset.kind).toBe('chart');
    expect(strip(root).querySelector('.advantage-chart')).not.toBeNull();
    expect(strip(root).querySelector('.xiangqi-review__analyse')).toBeNull();
    expect(tabBody(root).querySelector('.advantage-chart')).toBeNull();
    // The current move's eval sits at the strip's left edge.
    expect(chip(root).hidden).toBe(false);
    expect(CPS.map((cp) => formatEval(cp, null))).toContain(chip(root).textContent);
  });

  it('jumps the board on a tap and follows a drag', async () => {
    stubMedia(true);
    const root = mount({ fetchCached: async () => ANALYSIS, run: async () => ANALYSIS });
    await settle();
    expect(strip(root).dataset.kind).toBe('chart');
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 0, y: 0, width: 200, height: 56 }),
    );

    // A tap at the left edge: the start position.
    strip(root)
      .querySelector('.advantage-chart')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0 }));
    expect(chip(root).textContent).toBe(formatEval(CPS[0]!, null));

    // A finger dragged to the right edge walks to the last move.
    const body = strip(root).querySelector<HTMLElement>('.review-phone-analysis__body')!;
    const pointer = (type: string, clientX: number) =>
      new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: 'touch', clientX });
    body.dispatchEvent(pointer('pointerdown', 0));
    body.dispatchEvent(pointer('pointermove', 100));
    expect(chip(root).textContent).toBe(formatEval(CPS[2]!, null));
    body.dispatchEvent(pointer('pointermove', 200));
    expect(chip(root).textContent).toBe(formatEval(CPS[4]!, null));
    body.dispatchEvent(pointer('pointerup', 200));
    // After the finger lifts, a move over the strip no longer scrubs.
    body.dispatchEvent(pointer('pointermove', 0));
    expect(chip(root).textContent).toBe(formatEval(CPS[4]!, null));
  });

  it('keeps the request in the Computer analysis tab above 600px', async () => {
    stubMedia(false);
    const root = mount({ fetchCached: async () => null, run: async () => ANALYSIS });
    await settle();
    expect(strip(root).hidden).toBe(true);
    expect(tabBody(root).querySelector('.xiangqi-review__analyse')).not.toBeNull();
    expect(strip(root).querySelector('.xiangqi-review__analyse')).toBeNull();
  });
});
