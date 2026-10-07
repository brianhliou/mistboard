import {
  createInitialXiangqiState,
  parseStandardXiangqiFen,
  type XiangqiGameState,
  type XiangqiMove,
  type XiangqiTablebaseResponse,
} from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearXiangqiTablebaseMemo, fetchXiangqiTablebase } from './xiangqi-tablebase-client.js';
import { createXiangqiTablebasePanel } from './xiangqi-tablebase-panel.js';

// Horse vs elephant, the zugzwang study: only f8-d7 wins (chessdb DTM 9).
const ZUGZWANG = '3k5/9/5N3/9/2b6/9/9/9/4K4/9 w';

function position(fen: string): XiangqiGameState {
  const parsed = parseStandardXiangqiFen(fen);
  if (!parsed.ok) throw new Error(`bad fen ${fen}`);
  return parsed.state;
}

const EXACT: XiangqiTablebaseResponse = {
  status: 'exact',
  result: 'win',
  dtm: 9,
  moves: [
    { from: 'f8', to: 'd7', result: 'win', dtm: 9 },
    { from: 'f8', to: 'e6', result: 'draw', dtm: null },
    { from: 'e2', to: 'e1', result: 'loss', dtm: 12 },
  ],
};

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}

describe('xiangqi tablebase panel', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    clearXiangqiTablebaseMemo();
  });

  it('lists every move best first with its result and mate distance', async () => {
    const panel = createXiangqiTablebasePanel(async () => EXACT);
    document.body.append(panel.el);
    panel.setState(position(ZUGZWANG));
    await flushPromises();

    expect(panel.el.hidden).toBe(false);
    const rows = [...panel.el.querySelectorAll<HTMLElement>('.xq-tablebase__row')];
    expect(rows.map((row) => row.dataset.move)).toEqual(['f8d7', 'f8e6', 'e2e1']);
    expect(rows.map((row) => row.dataset.result)).toEqual(['win', 'draw', 'loss']);
    expect(rows[0]?.querySelector('.xq-tablebase__dtm')?.textContent).toBe('Mate in 5');
    expect(rows[1]?.querySelector('.xq-tablebase__dtm')?.textContent).toBe('');
    expect(rows[2]?.querySelector('.xq-tablebase__dtm')?.textContent).toBe('Mated in 6');
    expect(rows[0]?.querySelector('.xq-tablebase__badge')?.textContent).toBe('Win');
    expect(panel.el.querySelector('.xq-tablebase__summary')?.textContent).toBe(
      'Red wins · Mate in 5',
    );
  });

  it('stays hidden when there is no exact answer, and when the lookup throws', async () => {
    const none = createXiangqiTablebasePanel(async () => ({ status: 'none' }));
    none.setState(position(ZUGZWANG));
    await flushPromises();
    expect(none.el.hidden).toBe(true);
    expect(none.el.querySelector('.xq-tablebase__row')).toBeNull();

    const broken = createXiangqiTablebasePanel(async () => {
      throw new Error('down');
    });
    broken.setState(position(ZUGZWANG));
    await flushPromises();
    expect(broken.el.hidden).toBe(true);
  });

  it('plays the clicked move and previews the hovered one', async () => {
    const panel = createXiangqiTablebasePanel(async () => EXACT);
    const played: XiangqiMove[] = [];
    const hovered: (XiangqiMove | null)[] = [];
    panel.onPlayMove((move) => played.push(move));
    panel.onHoverMove((move) => hovered.push(move));
    panel.setState(position(ZUGZWANG));
    await flushPromises();

    const first = panel.el.querySelector<HTMLElement>('.xq-tablebase__row');
    first?.dispatchEvent(new MouseEvent('mouseenter'));
    first?.click();
    expect(played).toEqual([{ from: 'f8', to: 'd7' }]);
    expect(hovered).toEqual([{ from: 'f8', to: 'd7' }]);
  });

  it('drops a late answer for a position the reader already left', async () => {
    let release: (value: XiangqiTablebaseResponse) => void = () => {};
    const slow = new Promise<XiangqiTablebaseResponse>((resolve) => {
      release = resolve;
    });
    const lookup = vi.fn(async (state: XiangqiGameState) =>
      state.board.f8 ? slow : ({ status: 'none' } as const),
    );
    const panel = createXiangqiTablebasePanel(lookup);
    panel.setState(position(ZUGZWANG));
    panel.setState(createInitialXiangqiState('t'));
    release(EXACT);
    await flushPromises();
    expect(panel.el.hidden).toBe(true);
  });
});

describe('xiangqi tablebase client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearXiangqiTablebaseMemo();
  });

  it('never asks about a middlegame position', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await fetchXiangqiTablebase(createInitialXiangqiState('t'))).toEqual({ status: 'none' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('asks our server, memoises exact answers', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(EXACT));
    vi.stubGlobal('fetch', fetchSpy);
    const state = position(ZUGZWANG);
    expect(await fetchXiangqiTablebase(state)).toEqual(EXACT);
    expect(await fetchXiangqiTablebase(state)).toEqual(EXACT);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String((fetchSpy.mock.calls[0] as unknown[])[0])).toMatch(
      /^\/api\/xiangqi\/tablebase\?fen=/,
    );
  });

  it('reads errors, bad bodies and network failures as no data', async () => {
    const state = position(ZUGZWANG);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'x' }, 500)),
    );
    expect(await fetchXiangqiTablebase(state)).toEqual({ status: 'none' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ status: 'exact', result: 'draw', moves: [] })),
    );
    expect(await fetchXiangqiTablebase(state)).toEqual({ status: 'none' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network');
      }),
    );
    expect(await fetchXiangqiTablebase(state)).toEqual({ status: 'none' });
  });
});
