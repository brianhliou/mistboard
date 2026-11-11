// The phone game review's analysis strip (#619): between the board's bottom
// player row and the arrow bar, the request button before analysis, its
// progress while it runs, and the advantage chart once it lands, with no
// reload. Tap or drag the strip to jump. Above 600px the same element stays in
// the Computer analysis tab.
import type { XiangqiMove } from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisJobPollOptions } from './analysis-job-poll.js';
import { formatEval } from './engine/eval-format.js';
import type { GameAnalysis } from './game-analysis.js';
import type { AnalysisSource, DecisionSource } from './tree-review.js';
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

function stubMedia(phone: boolean): MediaQueryList {
  const media = new EventTarget() as MediaQueryList;
  Object.defineProperty(media, 'matches', { value: phone, writable: true });
  vi.spyOn(window, 'matchMedia').mockReturnValue(media);
  return media;
}

function mount(
  analysis: Pick<AnalysisSource, 'fetchCached' | 'run'>,
  analysisExtra?: HTMLElement,
  decisions?: DecisionSource,
): HTMLElement {
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
    analysisExtra,
    decisions,
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

  it('composes a Computer analysis tab for extra content alone', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const extra = document.createElement('div');
    mountXiangqiReview(root, {
      ariaLabel: 'Review',
      title: 'Review',
      summary: '',
      moves: PLAYED,
      analysis: null,
      analysisExtra: extra,
      initialUnderboardTab: 'share',
    });
    expect(root.querySelector('[data-tab="analysis"]')).not.toBeNull();
    expect(tabBody(root).firstElementChild).toBe(extra);
    // An explicit initial tab still wins over the extra's presence.
    expect(root.querySelector('.review-underboard-tab--active')?.getAttribute('data-tab')).toBe(
      'share',
    );
  });

  it.each([false, true])(
    'preserves extra content above analysis through loading and phone layout changes (phone=%s)',
    async (phone) => {
      const media = stubMedia(phone);
      const extra = document.createElement('div');
      extra.textContent = 'Two-engine chart';
      const root = mount({ fetchCached: async () => null, run: async () => ANALYSIS }, extra);
      await settle();
      expect(tabBody(root).firstElementChild).toBe(extra);
      expect(strip(root).contains(extra)).toBe(false);
      root.querySelector<HTMLButtonElement>('.xiangqi-review__analyse')!.click();
      await settle();
      expect(tabBody(root).firstElementChild).toBe(extra);
      expect(strip(root).contains(extra)).toBe(false);
      for (const nextPhone of [!phone, phone]) {
        Object.defineProperty(media, 'matches', { value: nextPhone });
        media.dispatchEvent(new Event('change'));
        expect(tabBody(root).firstElementChild).toBe(extra);
        expect(strip(root).contains(extra)).toBe(false);
        expect(strip(root).querySelector('.advantage-chart') !== null).toBe(nextPhone);
        expect(tabBody(root).querySelector('.advantage-chart') !== null).toBe(!nextPhone);
        if (!nextPhone) {
          expect(extra.nextElementSibling?.querySelector('.advantage-chart')).not.toBeNull();
        }
      }
    },
  );

  it('keeps extra content above cached analysis without the phone strip', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const extra = document.createElement('div');
    mountXiangqiReview(root, {
      ariaLabel: 'Study',
      title: 'Study',
      summary: '',
      moves: PLAYED,
      analysisExtra: extra,
      analysis: {
        requestLabel: 'Computer analysis',
        fetchCached: async () => ANALYSIS,
        run: async () => ANALYSIS,
      },
    });
    await settle();
    expect(tabBody(root).firstElementChild).toBe(extra);
    expect(extra.nextElementSibling?.querySelector('.advantage-chart')).not.toBeNull();
    expect(root.querySelector('.review-phone-analysis')).toBeNull();
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

it('refresh shows discovered queued/running progress and completion replaces it with the chart', async () => {
  stubMedia(true);
  let complete!: (value: GameAnalysis) => void;
  const run = vi.fn();
  const root = mount({
    fetchCached: async (options) => {
      options?.onStatus?.({ status: 'pending', state: 'queued' });
      await Promise.resolve();
      options?.onStatus?.({
        status: 'pending',
        state: 'running',
        progress: { phase: 'analysis', completed: 2, total: 5 },
      });
      return new Promise((resolve) => {
        complete = resolve;
      });
    },
    run,
  });
  await settle();
  expect(strip(root).textContent).toContain('Analysing positions… 2/5');
  expect(strip(root).querySelector<HTMLButtonElement>('button')?.disabled).toBe(true);
  expect(run).not.toHaveBeenCalled();
  complete(ANALYSIS);
  await settle();
  expect(strip(root).querySelector('.advantage-chart__svg')).not.toBeNull();
});

it('base cache stays visible while a separate reveal job resumes, fails and retries read-only', async () => {
  stubMedia(true);
  let fail!: (error: Error) => void;
  const run = vi.fn();
  const fetchCached = vi.fn(async (options?: AnalysisJobPollOptions) => {
    options?.onStatus?.({
      status: 'pending',
      state: 'running',
      progress: { phase: 'decisions', completed: 1, total: 4 },
    });
    return new Promise<never>((_resolve, reject) => {
      fail = reject;
    });
  });
  const root = mount({ fetchCached: async () => ANALYSIS, run: vi.fn() }, undefined, {
    canRun: false,
    fetchCached,
    run,
  });
  await settle();
  expect(strip(root).querySelector('.advantage-chart__svg')).not.toBeNull();
  expect(root.textContent).toContain('Grading reveals… through move 1/4');
  fail(new Error('decisions_request_failed_analysis_failed'));
  await settle();
  expect(root.textContent).toContain('Analysis could not finish');
  expect(strip(root).querySelector('.advantage-chart__svg')).not.toBeNull();
  root.querySelector<HTMLButtonElement>('.review-analysis-job-retry')!.click();
  await settle();
  expect(fetchCached).toHaveBeenCalledTimes(2);
  expect(run).not.toHaveBeenCalled();
});
it('removing the review shell aborts its discovery/polling lifetime', async () => {
  stubMedia(true);
  let signal: AbortSignal | undefined;
  const root = mount({
    fetchCached: async (options) => {
      signal = options?.signal;
      return new Promise(() => {});
    },
    run: vi.fn(),
  });
  await settle();
  expect(signal?.aborted).toBe(false);
  root.replaceChildren();
  await settle();
  expect(signal?.aborted).toBe(true);
});
