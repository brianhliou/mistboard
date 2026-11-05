import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Locale, setStoredLocale } from '../../i18n/locale.js';
import { cevalEngineName, cevalSupported, cevalSupportsInfinite, createCeval } from './ceval.js';
import type { CevalHandle, CevalVariant } from './ceval-types.js';
import { createEnginePanel, type EnginePanel } from './engine-panel.js';
import { createEvalBar } from './eval-bar.js';

// Recorded from the pinned 1387d11 WASM at 5,000 nodes / 2 seconds; copied
// verbatim from engine/rapfi-candidates.test.ts, including a partial rerank.
const recorded = `INFO PV 0
INFO NUMPV 3
INFO DEPTH 9
INFO SELDEPTH 12
INFO NODES 413
INFO TOTALNODES 3925
INFO TOTALTIME 30
INFO SPEED 130833
INFO EVAL 482
INFO WINRATE 0.917587
INFO BESTLINE 5,6 7,6 9,6 8,5 9,4 6,5 9,8
INFO PV DONE
MESSAGE (1) 482 | 9-12 | F9 H9 J9 I10 J11 G10 J7
INFO PV 1
INFO NUMPV 3
INFO DEPTH 9
INFO SELDEPTH 10
INFO NODES 624
INFO TOTALNODES 3994
INFO TOTALTIME 30
INFO SPEED 133133
INFO EVAL 271
INFO WINRATE 0.794946
INFO BESTLINE 6,6 9,9 9,6 8,6 5,6 5,5 8,5 7,4 5,9
INFO PV DONE
MESSAGE (2) 271 | 9-10 | G9 J6 J9 I9 F9 F10 I10 H11 F6
INFO PV 2
INFO NUMPV 3
INFO DEPTH 9
INFO SELDEPTH 11
INFO NODES 709
INFO TOTALNODES 4224
INFO TOTALTIME 32
INFO SPEED 132000
INFO EVAL 544
INFO WINRATE 0.938196
INFO BESTLINE 7,9 8,9 5,6 6,9 9,6 5,8 5,7 8,10
INFO PV DONE
MESSAGE (3) 544 | 9-11 | H6 I6 F9 G6 J9 F7 F8 I5
MESSAGE Depth 9-11 | Eval 544 | Time 32ms | H6 I6 F9 G6 J9 F7 F8 I5
INFO PV 0
INFO NUMPV 3
INFO DEPTH 10
INFO SELDEPTH 11
INFO NODES 738
INFO TOTALNODES 4338
INFO TOTALTIME 32
INFO SPEED 135562
INFO EVAL 544
INFO WINRATE 0.938196
INFO BESTLINE 7,9 8,9 5,6 6,9 9,6 5,8 5,7 8,10
INFO PV DONE
MESSAGE (1) 544 | 10-11 | H6 I6 F9 G6 J9 F7 F8 I5
MESSAGE Depth 9-11 | Eval 544 | Time 39ms | H6 I6 F9 G6 J9 F7 F8 I5
MESSAGE Speed 128K | Depth 9-11 | Eval 544 | Node 5028 | Time 39ms
7,9`;

// Same structured protocol, with a forced-five score substituted to exercise
// signed win distances independently of any human MESSAGE summary.
const forced = (score: number) =>
  recorded
    .split('INFO PV 1')[0]
    .replace('INFO NUMPV 3', 'INFO NUMPV 1')
    .replace('INFO EVAL 482', `INFO EVAL ${score}`);
const root = JSON.stringify({
  turn: 1,
  stones: [
    { x: 7, y: 7, player: 1 },
    { x: 8, y: 8, player: 1 },
    { x: 6, y: 8, player: 1 },
    { x: 7, y: 8, player: 2 },
    { x: 8, y: 7, player: 2 },
    { x: 6, y: 7, player: 2 },
  ],
});

type Message = { type: string; line?: string; elapsedMs?: number; error?: string };
class WorkerStub {
  static instances: WorkerStub[] = [];
  onmessage: ((event: MessageEvent<Message>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly sent: { type: string; commands?: string[] }[] = [];
  readonly terminate = vi.fn();
  constructor(readonly url: string) {
    WorkerStub.instances.push(this);
  }
  postMessage(message: { type: string; commands?: string[] }) {
    this.sent.push(message);
  }
  emit(message: Message) {
    this.onmessage?.({ data: message } as MessageEvent<Message>);
  }
  output(output = recorded) {
    for (const line of output.split('\n')) this.emit({ type: 'line', line });
  }
  done() {
    this.emit({ type: 'done', elapsedMs: 40 });
  }
  get commands() {
    return this.sent.flatMap(({ commands }) => commands ?? []);
  }
}
const latest = () => WorkerStub.instances.at(-1)!;
const handles: CevalHandle[] = [];
const panels: EnginePanel[] = [];
function handle() {
  const h = createCeval('gomoku');
  handles.push(h);
  return h;
}
function panel() {
  const bar = createEvalBar();
  const onLines = vi.fn();
  const p = createEnginePanel({ variant: 'gomoku', evalBar: bar, onLines });
  panels.push(p);
  return { p, bar, onLines };
}
async function startPanel(p: EnginePanel, moves: string[] = [], fen = root) {
  p.setPosition(moves, fen);
  p.setOn(true);
  latest().emit({ type: 'ready' });
  await vi.advanceTimersByTimeAsync(0);
}
const headline = (p: EnginePanel) => p.el.querySelector('.engine-panel__eval')?.textContent;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('Worker', WorkerStub);
  WorkerStub.instances = [];
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  });
  setStoredLocale('en');
});
afterEach(() => {
  for (const p of panels.splice(0)) p.dispose();
  for (const h of handles.splice(0)) h.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.documentElement.lang = 'en';
  setStoredLocale('en');
});

describe('Rapfi shared ceval', () => {
  it('dispatches lazily without isolation, with bounded effort and a fail-closed unknown case', () => {
    expect(cevalSupported('gomoku')).toBe(true);
    expect(cevalEngineName('gomoku')).toBe('Rapfi');
    expect(cevalSupportsInfinite('gomoku')).toBe(false);
    expect(handle().variant).toBe('gomoku');
    expect(WorkerStub.instances).toHaveLength(0);
    expect(() => createCeval('future-game' as CevalVariant)).toThrow('unsupported variant');
  });

  it('streams three distinct recorded PVs, depth and nodes through the common contract', async () => {
    const updates = vi.fn();
    const result = handle().evaluate({
      movesUci: [],
      initialFen: root,
      multiPv: 3,
      onUpdate: updates,
    });
    const w = latest();
    w.emit({ type: 'ready' });
    await vi.advanceTimersByTimeAsync(0);
    expect(w.url).toContain('/engine/rapfi/worker.js?v=1387d11312');
    expect(w.commands).toContain('YXNBEST 3');
    expect(w.commands).toContain('INFO show_detail 2');
    expect(w.commands).toContain('YXBOARD\n7,7,1\n7,8,2\n8,8,1\n8,7,2\n6,8,1\n6,7,2\nDONE');
    w.output();
    expect(updates).toHaveBeenCalled();
    w.done();
    const final = await result;
    // The last block reranks only PV 0 onto PV 2's move: keep the preceding
    // complete set of distinct alternatives until a complete new set arrives.
    expect(final).toMatchObject({ depth: 9, seldepth: 12, nodes: 4224, nps: 132000 });
    expect(
      final.lines.map(({ multipv, scoreCp, mate, pvUci }) => ({
        multipv,
        scoreCp,
        mate,
        first: pvUci[0],
      })),
    ).toEqual([
      { multipv: 1, scoreCp: 870, mate: null, first: 'h10' },
      { multipv: 2, scoreCp: 771, mate: null, first: 'f7' },
      { multipv: 3, scoreCp: 434, mate: null, first: 'g7' },
    ]);
    expect(final.lines[0].pvUci.slice(0, 3)).toEqual(['h10', 'i10', 'f7']);
  });

  it.each(['quick', 'standard', 'deep', 'max', 'infinite'] as const)(
    'bounds %s requests by nodes and wall time',
    async (effort) => {
      const h = handle();
      void h.evaluate({ movesUci: [], effort });
      latest().emit({ type: 'ready' });
      await vi.advanceTimersByTimeAsync(0);
      const commands = latest().commands;
      const nodes = Number(
        commands
          .find((c) => c.startsWith('INFO max_node'))
          ?.split(' ')
          .at(-1),
      );
      const ms = Number(
        commands
          .find((c) => c.startsWith('INFO timeout_turn'))
          ?.split(' ')
          .at(-1),
      );
      expect(nodes).toBeGreaterThan(0);
      expect(nodes).toBeLessThanOrEqual(500000);
      expect(ms).toBeLessThanOrEqual(5000);
      expect(ms).toBeGreaterThan(0);
      h.stop();
    },
  );

  it('preloads once and cancels even before initialization completes', async () => {
    const h = handle();
    const preload = h.preload();
    const second = h.preload();
    expect(WorkerStub.instances).toHaveLength(1);
    latest().emit({ type: 'ready' });
    await Promise.all([preload, second]);
    expect(latest().commands).toEqual([]);
    const updates = vi.fn();
    const pending = h.evaluate({ movesUci: [], onUpdate: updates });
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    const old = latest();
    const stale = old.onmessage!;
    h.stop();
    stale({ data: { type: 'ready' } } as MessageEvent<Message>);
    old.output();
    old.done();
    await vi.advanceTimersByTimeAsync(0);
    expect(old.terminate).toHaveBeenCalledOnce();
    expect(updates).not.toHaveBeenCalled();
    expect(settled).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels a cold search before ready, then starts only its replacement', async () => {
    const h = handle();
    const first = vi.fn();
    let settled = false;
    void h.evaluate({ movesUci: [], onUpdate: first }).then(() => {
      settled = true;
    });
    const old = latest();
    const stale = old.onmessage!;
    h.stop();
    const next = h.evaluate({ movesUci: ['h8'], multiPv: 1 });
    stale({ data: { type: 'ready' } } as MessageEvent<Message>);
    await vi.advanceTimersByTimeAsync(0);
    expect(old.commands).toEqual([]);
    expect(latest().commands).toEqual([]);
    latest().emit({ type: 'ready' });
    await vi.advanceTimersByTimeAsync(0);
    latest().output(forced(29989));
    latest().done();
    expect((await next).lines[0]).toMatchObject({ mate: 6, scoreCp: null });
    expect(first).not.toHaveBeenCalled();
    expect(settled).toBe(false);
  });

  it('rejects an error queued directly after ready without starting another search', async () => {
    const pending = expect(handle().evaluate({ movesUci: [] })).rejects.toThrow('load failed');
    const w = latest();
    w.emit({ type: 'ready' });
    w.emit({ type: 'error', error: 'load failed' });
    await pending;
    expect(w.commands).toEqual([]);
    expect(w.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('supersedes searches and ignores queued replies from their terminated worker', async () => {
    const h = handle();
    const first = vi.fn();
    void h.evaluate({ movesUci: [], onUpdate: first });
    const old = latest();
    const stale = old.onmessage!;
    const next = h.evaluate({ movesUci: ['h8'], multiPv: 1 });
    const w = latest();
    stale({ data: { type: 'ready' } } as MessageEvent<Message>);
    for (const line of recorded.split('\n'))
      stale({ data: { type: 'line', line } } as MessageEvent<Message>);
    expect(first).not.toHaveBeenCalled();
    expect(w.commands).toEqual([]);
    w.emit({ type: 'ready' });
    await vi.advanceTimersByTimeAsync(0);
    expect(w.commands).toContain('YXBOARD\n7,7,2\nDONE');
    w.output(forced(-29990));
    w.done();
    expect((await next).lines[0]).toMatchObject({ scoreCp: null, mate: -5 });
  });

  it('rejects malformed positions and occupied moves before allocating workers', async () => {
    await expect(handle().evaluate({ movesUci: ['h8', 'h8'] })).rejects.toThrow();
    await expect(handle().evaluate({ movesUci: ['p1'] })).rejects.toThrow();
    await expect(handle().evaluate({ movesUci: [], initialFen: '{}' })).rejects.toThrow();
    await expect(handle().evaluate({ movesUci: [], multiPv: 0 })).rejects.toThrow();
    expect(WorkerStub.instances).toHaveLength(0);
  });

  it('terminates and rejects on initialization timeout, search timeout and protocol error', async () => {
    const h = handle();
    const init = expect(h.evaluate({ movesUci: [] })).rejects.toThrow('initialization timed out');
    await vi.advanceTimersByTimeAsync(30000);
    await init;
    const search = expect(h.evaluate({ movesUci: [], effort: 'quick' })).rejects.toThrow(
      'search timed out',
    );
    latest().emit({ type: 'ready' });
    await vi.advanceTimersByTimeAsync(1300);
    await search;
    const error = expect(h.evaluate({ movesUci: [] })).rejects.toThrow('ERROR bad position');
    latest().emit({ type: 'ready' });
    await vi.advanceTimersByTimeAsync(0);
    latest().emit({ type: 'line', line: 'ERROR bad position' });
    await error;
    expect(WorkerStub.instances.every((w) => w.terminate.mock.calls.length === 1)).toBe(true);
  });
});

describe('Gomoku shared engine panel', () => {
  it('starts off and displays three lines, the Black POV gauge, and depth/nodes when enabled', async () => {
    const { p, bar } = panel();
    expect(p.el.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false');
    expect(WorkerStub.instances).toHaveLength(0);
    await startPanel(p);
    latest().output();
    latest().done();
    await vi.advanceTimersByTimeAsync(0);
    expect(p.el.querySelectorAll('.engine-panel__line')).toHaveLength(3);
    expect(headline(p)).toBe('B+8.7');
    expect(p.el.dataset.seatInkFamily).toBe('gomoku');
    expect(bar.el.dataset.seatInkFamily).toBe('gomoku');
    expect(p.el.textContent).toContain('h10 i10 f7');
    expect(p.el.querySelector('.engine-panel__sub')?.textContent).toContain('Depth 9');
    expect(p.el.querySelector('.engine-panel__sub')?.textContent).toContain('4224 nodes');
    expect(bar.el.querySelector<HTMLElement>('.review-eval-bar__fill')?.style.height).toBe('93.8%');
  });

  it.each([false, true])(
    'normalizes a White-to-move score with a White base: %s',
    async (whiteBase) => {
      const { p, bar } = panel();
      await startPanel(
        p,
        whiteBase ? [] : ['a1'],
        whiteBase ? root.replace('"turn":1', '"turn":2') : root,
      );
      latest().output();
      latest().done();
      await vi.advanceTimersByTimeAsync(0);
      expect(headline(p)).toBe('W+8.7');
      expect(bar.el.querySelector<HTMLElement>('.review-eval-bar__fill')?.style.height).toBe(
        '6.2%',
      );
    },
  );

  it.each([
    ['en', 29990, 'Black wins in 5'],
    ['en', -29990, 'White wins in 5'],
    ['zh-Hans', 29990, '黑方 5 步内获胜'],
    ['zh-Hans', -29990, '白方 5 步内获胜'],
    ['zh-Hant', 29990, '黑方 5 步內獲勝'],
    ['zh-Hant', -29990, '白方 5 步內獲勝'],
  ])('uses translated forced-five wording in %s for %s', async (locale, score, expected) => {
    document.documentElement.lang = String(locale);
    setStoredLocale(locale as Locale);
    const { p } = panel();
    await startPanel(p);
    latest().output(forced(Number(score)));
    latest().done();
    await vi.advanceTimersByTimeAsync(0);
    expect(headline(p)).toBe(expected);
    expect(p.el.querySelector('.engine-panel__line-eval')?.textContent).toBe(expected);
    expect(p.el.textContent).not.toContain('29990');
    expect(p.el.textContent).not.toContain('#5');
  });

  it.each([
    [29989, [], 'Black wins in 6'],
    [-29989, [], 'White wins in 6'],
    [29990, ['a1'], 'White wins in 5'],
    [-29990, ['a1'], 'Black wins in 5'],
    [30000, [], 'Black wins'],
    [-30000, [], 'White wins'],
  ])('keeps win distance and winning color for %s at %s', async (score, moves, expected) => {
    const { p } = panel();
    await startPanel(p, moves);
    latest().output(forced(score));
    latest().done();
    await vi.advanceTimersByTimeAsync(0);
    expect(headline(p)).toBe(expected);
  });

  it('clears on position changes, off and dispose; stale output cannot redraw during debounce', async () => {
    const { p, onLines } = panel();
    await startPanel(p);
    const old = latest();
    const stale = old.onmessage!;
    old.output();
    p.setPosition(['a1'], root);
    expect(old.terminate).toHaveBeenCalledOnce();
    expect(onLines).toHaveBeenLastCalledWith(null);
    stale({ data: { type: 'line', line: 'INFO PV DONE' } } as MessageEvent<Message>);
    expect(onLines).toHaveBeenLastCalledWith(null);
    await vi.advanceTimersByTimeAsync(151);
    latest().emit({ type: 'ready' });
    await vi.advanceTimersByTimeAsync(0);
    latest().output();
    expect(headline(p)).toBe('W+8.7');
    p.setOn(false);
    expect(onLines).toHaveBeenLastCalledWith(null);
    expect(headline(p)).toBe('–');
    expect(p.el.querySelectorAll('.engine-panel__line')).toHaveLength(0);
    p.setPosition([], root);
    p.setOn(true);
    latest().emit({ type: 'ready' });
    await vi.advanceTimersByTimeAsync(0);
    const disposed = latest().onmessage!;
    onLines.mockClear();
    p.dispose();
    disposed({ data: { type: 'line', line: 'INFO PV DONE' } } as MessageEvent<Message>);
    expect(onLines).not.toHaveBeenCalledWith(expect.any(Array));
  });
});
