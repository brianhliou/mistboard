import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cevalEngineName, cevalSupported, createCeval } from './ceval.js';
import { isPikaJieqiCevalVariant, PikaJieQiCeval, pikaJieqiEngineName } from './pikajieqi-ceval.js';

type FakeMessage = { type: string; line?: string };

class FakeWorker {
  static latest: FakeWorker | null = null;
  readonly commands: string[] = [];
  readonly url: string;
  init: { jsUrl?: string; wasmUrl?: string } | null = null;
  onmessage: ((event: MessageEvent<FakeMessage>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  private messageListeners = new Set<(event: MessageEvent<FakeMessage>) => void>();

  constructor(url: string | URL) {
    this.url = String(url);
    FakeWorker.latest = this;
  }

  addEventListener(_type: string, listener: EventListenerOrEventListenerObject): void {
    this.messageListeners.add(listener as (event: MessageEvent<FakeMessage>) => void);
  }

  removeEventListener(_type: string, listener: EventListenerOrEventListenerObject): void {
    this.messageListeners.delete(listener as (event: MessageEvent<FakeMessage>) => void);
  }

  postMessage(message: { type: string; command?: string; jsUrl?: string; wasmUrl?: string }): void {
    if (message.type === 'init') {
      this.init = message;
      queueMicrotask(() => this.emit({ type: 'ready' }));
      return;
    }
    if (message.type !== 'command' || !message.command) return;
    this.commands.push(message.command);
    const option = /^setoption name (.*?) value /.exec(message.command)?.[1];
    // Rule transport is prepared ahead of the rule-capable asset update.
    // UCI_AnalyseMode from the classical build still fails the NNUE handshake.
    if (option && !['Hash', 'MultiPV', 'ChanceMix', 'EvalFile', 'Jieqi Rule'].includes(option)) {
      throw new Error(`unsupported NNUE browser option: ${option}`);
    }
    if (message.command === 'uci') {
      queueMicrotask(() => this.emit({ type: 'line', line: 'uciok' }));
    } else if (message.command === 'isready') {
      queueMicrotask(() => this.emit({ type: 'line', line: 'readyok' }));
    } else if (message.command.startsWith('go depth')) {
      queueMicrotask(() => {
        this.emit({
          type: 'line',
          line: 'info depth 4 seldepth 7 multipv 1 score cp 31 nodes 900 nps 450000 pv a0a1',
        });
        this.emit({ type: 'line', line: 'bestmove a0a1' });
      });
    } else if (message.command === 'go infinite') {
      queueMicrotask(() => {
        this.emit({
          type: 'line',
          line: 'info depth 5 seldepth 8 multipv 1 score cp 33 nodes 1200 nps 450000 pv a0a1',
        });
      });
    } else if (message.command === 'stop') {
      queueMicrotask(() => this.emit({ type: 'line', line: 'bestmove a0a1' }));
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
  vi.unstubAllEnvs();
  FakeWorker.latest = null;
});

describe('PikaJieQi ceval dispatch', () => {
  // AB-JChess is the jieqi default (#800); these cover the build that turns it off.
  beforeEach(() => {
    vi.stubEnv('VITE_ABJCHESS_CEVAL_ENABLED', 'false');
  });

  it('claims only the jieqi variant', () => {
    expect(isPikaJieqiCevalVariant('jieqi')).toBe(true);
    expect(isPikaJieqiCevalVariant('xiangqi')).toBe(false);
    expect(isPikaJieqiCevalVariant('banqi')).toBe(false);
  });

  it('uses the PikaJieQi engine label', () => {
    expect(pikaJieqiEngineName('jieqi')).toBe('PikaJieQi');
    expect(pikaJieqiEngineName('xiangqi')).toBeNull();
    expect(cevalEngineName('jieqi')).toBe('PikaJieQi');
  });

  it('constructs the dedicated backend without loading a worker', () => {
    const handle = createCeval('jieqi');
    expect(handle).toBeInstanceOf(PikaJieQiCeval);
    expect(handle.variant).toBe('jieqi');
    handle.dispose();
  });

  it('requires cross-origin isolation for the pthread build', () => {
    expect(cevalSupported('jieqi')).toBe(false);
  });

  it('keeps the one-thread default and completes the UCI handshake', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const handle = new PikaJieQiCeval('jieqi');
    await handle.preload();
    expect(FakeWorker.latest?.url).toBe(
      '/engine/pikafish-jieqi/worker.js?v=bc398e6e-emsdk3174-nnue1',
    );
    expect(FakeWorker.latest?.init).toMatchObject({
      jsUrl: '/engine/pikafish-jieqi/pikajieqi.js?v=bc398e6e-emsdk3174-nnue1',
      wasmUrl: '/engine/pikafish-jieqi/pikajieqi.wasm?v=bc398e6e-emsdk3174-nnue1',
    });
    expect(FakeWorker.latest?.commands).toContain('setoption name Hash value 32');
    expect(FakeWorker.latest?.commands.some((command) => command.includes('Threads'))).toBe(false);
    handle.dispose();
  });

  it('streams a Pika info line through the shared ceval contract', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const handle = new PikaJieQiCeval('jieqi');
    const updates: number[] = [];
    const result = await handle.evaluate({
      movesUci: [],
      initialFen: '9/9/9/9/9/9/9/9/9/9 w R0A0C0P0N0B0r0a0c0p0n0b0 0 1',
      multiPv: 2,
      maxDepth: 4,
      onUpdate: (update) => updates.push(update.depth),
    });
    expect(result).toMatchObject({
      depth: 4,
      seldepth: 7,
      nodes: 900,
      nps: 450000,
    });
    expect(result.lines[0]).toMatchObject({
      multipv: 1,
      scoreCp: 31,
      pvUci: ['a0a1'],
    });
    expect(FakeWorker.latest?.commands).toContain('setoption name MultiPV value 2');
    expect(FakeWorker.latest?.commands).toContain('setoption name Jieqi Rule value jqe-v1');
    expect(FakeWorker.latest?.commands).toContain('go depth 4');
    // One line at MultiPV 2 is an incomplete burst: it renders once, at bestmove.
    expect(updates).toEqual([4]);
    handle.dispose();
  });

  it('sets the rule before every position and search when reusing a worker', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const handle = new PikaJieQiCeval('jieqi');
    await handle.preload();
    const worker = FakeWorker.latest!;
    const fen = '9/9/9/9/9/9/9/9/9/9 w R0A0C0P0N0B0r0a0c0p0n0b0 0 1';
    try {
      for (const jieqiRule of ['legacy', 'jqe-v1', 'legacy', undefined] as const) {
        const start = worker.commands.length;
        await handle.evaluate({
          initialFen: fen,
          movesUci: ['a0a1'],
          maxDepth: 4,
          jieqiRule,
        });
        expect(FakeWorker.latest).toBe(worker);
        expect(worker.commands.slice(start)).toEqual([
          `setoption name Jieqi Rule value ${jieqiRule ?? 'jqe-v1'}`,
          'setoption name MultiPV value 1',
          `position fen ${fen} moves a0a1`,
          'go depth 4',
        ]);
      }
    } finally {
      handle.dispose();
    }
  });

  it('runs continuous analysis until stop and then resolves the superseded search', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const handle = new PikaJieQiCeval('jieqi');
    const updates: number[] = [];
    const resultPromise = handle.evaluate({
      movesUci: [],
      initialFen: '9/9/9/9/9/9/9/9/9/9 w R0A0C0P0N0B0r0a0c0p0n0b0 0 1',
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
