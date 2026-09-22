import { afterEach, describe, expect, it, vi } from 'vitest';
import { cevalEngineName, cevalSupported, createCeval } from './ceval.js';
import {
  fsfUciToPikafishUci,
  isPikafishCevalVariant,
  PikafishCeval,
  pikafishEngineName,
  pikafishThreads,
  pikafishUciToFsfUci,
} from './pikafish-ceval.js';

type FakeMessage = { type: string; line?: string; loaded?: number; total?: number };

/** Stands in for the worker: answers the handshake, reports two net-progress
 *  ticks before `ready`, and searches in Pikafish's a0-i9 coordinates. */
class FakeWorker {
  static latest: FakeWorker | null = null;
  readonly commands: string[] = [];
  init: { jsUrl?: string; wasmUrl?: string; netUrl?: string } | null = null;
  onmessage: ((event: MessageEvent<FakeMessage>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  private messageListeners = new Set<(event: MessageEvent<FakeMessage>) => void>();

  constructor(_url: string | URL) {
    FakeWorker.latest = this;
  }

  addEventListener(_type: string, listener: EventListenerOrEventListenerObject): void {
    this.messageListeners.add(listener as (event: MessageEvent<FakeMessage>) => void);
  }

  removeEventListener(_type: string, listener: EventListenerOrEventListenerObject): void {
    this.messageListeners.delete(listener as (event: MessageEvent<FakeMessage>) => void);
  }

  postMessage(message: {
    type: string;
    command?: string;
    jsUrl?: string;
    wasmUrl?: string;
    netUrl?: string;
  }): void {
    if (message.type === 'init') {
      this.init = message;
      queueMicrotask(() => {
        this.emit({ type: 'net-progress', loaded: 10_000_000, total: 50_706_378 });
        this.emit({ type: 'net-progress', loaded: 50_706_378, total: 50_706_378 });
        this.emit({ type: 'net-written' });
        this.emit({ type: 'ready' });
      });
      return;
    }
    if (message.type !== 'command' || !message.command) return;
    this.commands.push(message.command);
    if (message.command === 'uci') {
      queueMicrotask(() => this.emit({ type: 'line', line: 'uciok' }));
    } else if (message.command === 'isready') {
      queueMicrotask(() => this.emit({ type: 'line', line: 'readyok' }));
    } else if (message.command.startsWith('go depth')) {
      queueMicrotask(() => {
        this.emit({
          type: 'line',
          line: 'info string NNUE evaluation using pikafish.nnue (64MiB, (62083, 1024, 32, 32, 1))',
        });
        this.emit({
          type: 'line',
          line: 'info depth 8 seldepth 14 multipv 1 score cp 24 nodes 26729 nps 954607 pv h2e2 h9g7 g3g4',
        });
        this.emit({ type: 'line', line: 'bestmove h2e2 ponder h9g7' });
      });
    } else if (message.command === 'go infinite') {
      queueMicrotask(() => {
        this.emit({
          type: 'line',
          line: 'info depth 5 seldepth 8 multipv 1 score cp 33 nodes 1200 nps 450000 pv h0g2',
        });
      });
    } else if (message.command === 'stop') {
      queueMicrotask(() => this.emit({ type: 'line', line: 'bestmove h0g2' }));
    }
  }

  terminate(): void {}

  private emit(data: FakeMessage): void {
    const event = { data } as MessageEvent<FakeMessage>;
    this.onmessage?.(event);
    for (const listener of [...this.messageListeners]) listener(event);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeWorker.latest = null;
});

describe('Pikafish ceval dispatch', () => {
  it('claims standard xiangqi and nothing else', () => {
    expect(isPikafishCevalVariant('xiangqi')).toBe(true);
    expect(isPikafishCevalVariant('fortressxiangqi')).toBe(false);
    expect(isPikafishCevalVariant('atomicxiangqi')).toBe(false);
    expect(isPikafishCevalVariant('jieqi')).toBe(false);
    expect(isPikafishCevalVariant('chess')).toBe(false);
  });

  it('labels the panel Pikafish for xiangqi and leaves the others alone', () => {
    expect(pikafishEngineName('xiangqi')).toBe('Pikafish');
    expect(pikafishEngineName('fortressxiangqi')).toBeNull();
    expect(cevalEngineName('xiangqi')).toBe('Pikafish');
    expect(cevalEngineName('fortressxiangqi')).toBe('Fairy-Stockfish');
    expect(cevalEngineName('jieqi')).toBe('PikaJieQi');
  });

  it('constructs the dedicated backend without loading a worker', () => {
    const handle = createCeval('xiangqi');
    expect(handle).toBeInstanceOf(PikafishCeval);
    expect(handle.variant).toBe('xiangqi');
    handle.dispose();
  });

  it('requires cross-origin isolation for the pthread build', () => {
    expect(cevalSupported('xiangqi')).toBe(false);
  });

  it('caps search threads at the pre-allocated pthread pool', () => {
    expect(pikafishThreads(undefined)).toBe(1);
    expect(pikafishThreads(2)).toBe(1);
    expect(pikafishThreads(4)).toBe(3);
    expect(pikafishThreads(16)).toBe(8);
  });
});

describe('Pikafish coordinate shift', () => {
  it('drops FSF ranks by one on the way in and lifts them on the way out', () => {
    expect(fsfUciToPikafishUci('h3e3')).toBe('h2e2');
    expect(fsfUciToPikafishUci('h10g8')).toBe('h9g7');
    expect(pikafishUciToFsfUci('h2e2')).toBe('h3e3');
    expect(pikafishUciToFsfUci('h9g7')).toBe('h10g8');
  });

  it('passes anything that is not a board move through', () => {
    expect(fsfUciToPikafishUci('0000')).toBe('0000');
    expect(pikafishUciToFsfUci('(none)')).toBe('(none)');
  });
});

describe('Pikafish ceval session', () => {
  it('points the worker at the net, reports its download, then completes the handshake', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
    const handle = new PikafishCeval('xiangqi');
    const progress: Array<[number, number]> = [];
    await handle.preload((p) => progress.push([p.loaded, p.total]));
    expect(FakeWorker.latest?.init?.netUrl).toMatch(/\/engine\/pikafish\/pikafish\.nnue\?v=/);
    expect(progress).toEqual([
      [10_000_000, 50_706_378],
      [50_706_378, 50_706_378],
    ]);
    expect(FakeWorker.latest?.commands).toEqual([
      'uci',
      'setoption name Threads value 7',
      'setoption name Hash value 64',
      'isready',
    ]);
    handle.dispose();
  });

  it('sends FSF-coordinate moves as Pikafish coordinates and returns the PV in FSF coordinates', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const handle = new PikafishCeval('xiangqi');
    const updates: number[] = [];
    const result = await handle.evaluate({
      movesUci: ['h3e3', 'h10g8'],
      multiPv: 1,
      maxDepth: 8,
      onUpdate: (update) => updates.push(update.depth),
    });
    expect(FakeWorker.latest?.commands).toContain('position startpos moves h2e2 h9g7');
    expect(FakeWorker.latest?.commands).toContain('go depth 8');
    expect(result).toMatchObject({ depth: 8, seldepth: 14, nodes: 26729, nps: 954607 });
    expect(result.lines[0]).toMatchObject({
      multipv: 1,
      scoreCp: 24,
      pvUci: ['h3e3', 'h10g8', 'g4g5'],
    });
    // The complete MultiPV-1 burst renders once, and bestmove renders the final state.
    expect(updates).toEqual([8, 8]);
    handle.dispose();
  });

  it('analyses from a FEN when one is given', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const handle = new PikafishCeval('xiangqi');
    await handle.evaluate({
      movesUci: [],
      initialFen: '5P3/9/3k5/9/9/2B6/9/9/9/4K4 w - - 17 17',
      maxDepth: 8,
    });
    expect(FakeWorker.latest?.commands).toContain(
      'position fen 5P3/9/3k5/9/9/2B6/9/9/9/4K4 w - - 17 17',
    );
    handle.dispose();
  });

  it('runs continuous analysis until stop and then resolves the superseded search', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const handle = new PikafishCeval('xiangqi');
    const updates: number[] = [];
    const resultPromise = handle.evaluate({
      movesUci: [],
      effort: 'infinite',
      onUpdate: (update) => updates.push(update.depth),
    });
    await vi.waitFor(() => expect(FakeWorker.latest?.commands).toContain('go infinite'));
    await vi.waitFor(() => expect(updates).toContain(5));
    handle.stop();
    const result = await resultPromise;
    expect(result.lines).toEqual([]);
    expect(FakeWorker.latest?.commands).toContain('stop');
    handle.dispose();
  });
});
