import { createInitialXiangqiState } from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameAnalysis, XiangqiGameAnalysisResponse } from './review/game-analysis.js';
import { mountXiangqiReplay, type XiangqiReplaySpec } from './xiangqi-replay.js';
import { createReplayAdvantageChart, loadReplayChartAnalysis } from './xiangqi-replay-chart.js';

// An article board whose game is in the broadcast archive shows that game's
// advantage chart under the board: the review chart, the stored analysis, loaded
// only when the board nears the viewport, synced both ways with the stepper.

const BOARD_ID = '2026-xiangqi-league-2026-xiangqi-league-r07-b16mlqhe';
const ANALYSIS_PATH = `/api/xiangqi-broadcasts/games/${BOARD_ID}/analysis`;

const spec: XiangqiReplaySpec = {
  iccs: 'h2e2 h9g7 h0g2 i9h9',
  red: 'Red',
  black: 'Black',
  event: 'Chart',
  resultText: '*',
  annotations: { byPly: {} },
  boardId: BOARD_ID,
};

function analysisBody(plies: number): XiangqiGameAnalysisResponse {
  return {
    engineId: 'pikafish-xiangqi-analysis@5',
    depth: 12,
    plies: Array.from({ length: plies + 1 }, (_, ply) => ({
      ply,
      cp: ply % 2 === 0 ? 30 : -20,
      mate: null,
      best: null,
    })),
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** Records every observer the replay makes and lets a test say "now visible". */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  observed: Element[] = [];
  disconnected = false;
  constructor(readonly callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.instances.push(this);
  }
  observe(el: Element): void {
    this.observed.push(el);
  }
  unobserve(): void {}
  disconnect(): void {
    this.disconnected = true;
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  intersect(): void {
    const entries = this.observed.map(
      (target) => ({ isIntersecting: true, target }) as unknown as IntersectionObserverEntry,
    );
    this.callback(entries, this as unknown as IntersectionObserver);
  }
}

let host: HTMLElement;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  document.body.replaceChildren();
  host = document.createElement('div');
  document.body.append(host);
  FakeIntersectionObserver.instances = [];
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  fetchMock = vi.fn(async () => jsonResponse(analysisBody(4)));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const slot = () => host.querySelector<HTMLElement>('.xq-replay-chart');
const cursorX = () =>
  host.querySelector('.xq-replay-chart .advantage-chart__cursor')?.getAttribute('x1');
const nextButton = () => host.querySelector<HTMLButtonElement>('.stepper-button-next')!;
const prevButton = () => host.querySelector<HTMLButtonElement>('.stepper-button-prev')!;

async function mountVisible(
  s: XiangqiReplaySpec = spec,
  lang?: 'zh-Hans' | 'zh-Hant',
): Promise<void> {
  mountXiangqiReplay(host, s, { lang });
  FakeIntersectionObserver.instances[0]!.intersect();
  await vi.waitFor(() =>
    expect(host.querySelector('.xq-replay-chart .advantage-chart')).not.toBeNull(),
  );
}

describe('loadReplayChartAnalysis (data path)', () => {
  it('GETs the stored broadcast analysis and returns it when it covers every ply', async () => {
    const analysis = await loadReplayChartAnalysis(BOARD_ID, 4);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(ANALYSIS_PATH);
    // GET only: a POST would queue an engine pass for every reader.
    expect((init as RequestInit).method).toBe('GET');
    expect(analysis?.evals.map((e) => e.ply)).toEqual([0, 1, 2, 3, 4]);
  });

  it('is null when nothing is stored yet (204)', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await loadReplayChartAnalysis(BOARD_ID, 4)).toBeNull();
  });

  it('is null on a server error or a network failure', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 500 }));
    expect(await loadReplayChartAnalysis(BOARD_ID, 4)).toBeNull();
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    expect(await loadReplayChartAnalysis(BOARD_ID, 4)).toBeNull();
  });

  it('is null when the series does not match the article record ply for ply', async () => {
    // A longer or shorter record would put the cursor on the wrong move.
    fetchMock.mockResolvedValueOnce(jsonResponse(analysisBody(36)));
    expect(await loadReplayChartAnalysis(BOARD_ID, 4)).toBeNull();
    const gappy = analysisBody(4);
    gappy.plies.splice(2, 1, { ...gappy.plies[2]!, ply: 7 });
    fetchMock.mockResolvedValueOnce(jsonResponse(gappy));
    expect(await loadReplayChartAnalysis(BOARD_ID, 4)).toBeNull();
  });

  it('accepts an injected fetcher', async () => {
    const fetcher = vi.fn(async () => null as GameAnalysis | null);
    expect(await loadReplayChartAnalysis(BOARD_ID, 4, fetcher)).toBeNull();
    expect(fetcher).toHaveBeenCalledWith('xiangqi-broadcasts', BOARD_ID);
  });
});

describe('article board advantage chart (mount)', () => {
  it('reserves its slot between the board and the control bar, and fetches nothing until visible', () => {
    mountXiangqiReplay(host, spec);
    const s = slot();
    expect(s).not.toBeNull();
    expect(s?.childElementCount).toBe(0);
    const col = host.querySelector('.xq-replay-board-col')!;
    const kids = [...col.children].map((el) => el.className.split(' ')[0]);
    expect(kids).toEqual([
      'xq-replay-seat',
      'raw-svg-stepper-frame',
      'xq-replay-seat',
      'xq-replay-chart',
      'xq-replay-controls-wrap',
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(FakeIntersectionObserver.instances[0]?.observed).toEqual([host]);
    // The analysis link stays the last thing under the card.
    expect(host.lastElementChild?.classList.contains('xq-replay-analysis-link')).toBe(true);
  });

  it('draws the chart once visible and marks the board ply', async () => {
    await mountVisible({ ...spec, startPly: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(FakeIntersectionObserver.instances[0]?.disconnected).toBe(true);
    // 4 plies over 300 view units: ply 2 sits at 150.
    expect(cursorX()).toBe('150.00');
    nextButton().click();
    expect(cursorX()).toBe('225.00');
    prevButton().click();
    prevButton().click();
    expect(cursorX()).toBe('75.00');
  });

  it('jumps the board when the chart is clicked', async () => {
    await mountVisible();
    const svg = host.querySelector<SVGElement>('.xq-replay-chart .advantage-chart__svg')!;
    svg.getBoundingClientRect = () => ({ left: 0, width: 300, top: 0, height: 104 }) as DOMRect;
    const chartEl = host.querySelector<HTMLElement>('.xq-replay-chart .advantage-chart')!;
    chartEl.dispatchEvent(new MouseEvent('click', { clientX: 300, bubbles: true }));
    expect(cursorX()).toBe('299.40'); // the last ply, inset by half a hairline
    // The board went with it: the last move is current and there is no next.
    expect(nextButton().disabled).toBe(true);
    const buttons = [...host.querySelectorAll('.xq-replay-move-button')];
    expect(buttons.findIndex((b) => b.classList.contains('is-current'))).toBe(3);
  });

  it('names the chart and its phases in the page language', async () => {
    await mountVisible(spec, 'zh-Hans');
    expect(host.querySelector('.advantage-chart')?.getAttribute('aria-label')).toBe(
      '全局形势图，点击可跳到该步',
    );
  });

  it('leaves nothing behind when the game has no stored analysis', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    mountXiangqiReplay(host, spec);
    FakeIntersectionObserver.instances[0]!.intersect();
    await vi.waitFor(() => expect(slot()).toBeNull());
    // Flipping re-orders the column; the dropped slot must not come back.
    host.querySelectorAll<HTMLButtonElement>('.xq-replay-menu-item')[0]!.click();
    expect(slot()).toBeNull();
    expect(host.querySelector('.xq-replay-analysis-link')).not.toBeNull();
  });

  it('keeps the chart under the board when the board is flipped', async () => {
    await mountVisible();
    host.querySelectorAll<HTMLButtonElement>('.xq-replay-menu-item')[0]!.click();
    const col = host.querySelector('.xq-replay-board-col')!;
    expect(col.children[3]?.classList.contains('xq-replay-chart')).toBe(true);
    expect(col.querySelector('.advantage-chart')).not.toBeNull();
  });

  it('has no slot and no observer without a board id', () => {
    const { boardId: _omit, ...noBoard } = spec;
    mountXiangqiReplay(host, noBoard);
    expect(slot()).toBeNull();
    expect(FakeIntersectionObserver.instances).toHaveLength(0);
  });

  it('does not mount into a destroyed board', async () => {
    let release: (r: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => (release = resolve)));
    const controller = mountXiangqiReplay(host, spec);
    const s = slot()!;
    FakeIntersectionObserver.instances[0]!.intersect();
    controller.destroy();
    release(jsonResponse(analysisBody(4)));
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(s.childElementCount).toBe(0);
  });
});

describe('createReplayAdvantageChart', () => {
  it('draws the localized phase labels', () => {
    const start = createInitialXiangqiState('chart-test');
    const plies = 24;
    const body = analysisBody(plies);
    const analysis = {
      engineId: body.engineId,
      depth: body.depth,
      evals: body.plies,
    } as unknown as GameAnalysis;
    const chart = createReplayAdvantageChart(analysis, {
      states: Array.from({ length: plies + 1 }, () => start),
      moveLabel: () => null,
      onJump: () => {},
      ariaLabel: 'x',
      phaseLabels: { opening: '开局', middlegame: '中局', endgame: '残局' },
    });
    const labels = [...chart.el.querySelectorAll('.advantage-chart__phase-label')].map(
      (el) => el.textContent,
    );
    expect(labels).toEqual(['开局', '中局']);
  });
});
