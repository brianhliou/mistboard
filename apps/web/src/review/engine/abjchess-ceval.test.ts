import { ABJCHESS_20261031_WIN_PCT_K } from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ABJCHESS_ASSET_URLS,
  ABJCHESS_DEPTH_BY_EFFORT,
  ABJCHESS_ENGINE_ASSET_VERSION,
  ABJCHESS_ENGINE_NAME,
  ABJCHESS_STOP_TIMEOUT_MS,
  AbJchessCeval,
  AbJchessCrashError,
  AbJchessWithFallback,
  abjchessGoCommand,
  abjchessPositionCommand,
  abjchessSearchPasses,
  abjchessSpinOption,
  mergeAbjchessLines,
  parseAbjchessRootMoves,
} from './abjchess-ceval.js';
import type { CevalHandle, CevalRequest, CevalUpdate } from './ceval-types.js';
import { PikaJieQiCeval } from './pikajieqi-ceval.js';

const START =
  'xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w R2A2C2P5N2B2r2a2c2p5n2b2 0 1';
// After a red face-down cannon at b2 flipped to a horse on its way to b9 (no
// reveal suffix printed by the PV; the client sends the suffix it knows).
const AFTER_FLIP =
  'xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/7X1/9/XNXXKXXXX b R2A2C2P5N1B2r2a2c2p5n2b2 1 1';

type FakeMessage = { type: string; line?: string; error?: string };
type Script = (command: string, worker: FakeWorker) => void;

class FakeWorker {
  static all: FakeWorker[] = [];
  static script: Script = defaultScript;
  static initReply: 'ready' | 'error' | 'net-missing' = 'ready';
  /** When set, each `readyok` waits in `heldReadyok` until the test sends it. */
  static holdReadyok = false;
  readonly heldReadyok: (() => void)[] = [];
  readonly commands: string[] = [];
  readonly url: string;
  init: { jsUrl?: string; wasmUrl?: string; netUrl?: string } | null = null;
  terminated = false;
  onmessage: ((event: MessageEvent<FakeMessage>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  private messageListeners = new Set<(event: MessageEvent<FakeMessage>) => void>();

  constructor(url: string | URL) {
    this.url = String(url);
    FakeWorker.all.push(this);
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
        if (FakeWorker.initReply === 'error') {
          this.emit({ type: 'error', error: 'AB-JChess net fetch failed: HTTP 404' });
        } else {
          this.emit({ type: 'ready' });
        }
      });
      return;
    }
    if (message.type !== 'command' || !message.command) return;
    this.commands.push(message.command);
    if (message.command === 'uci') {
      queueMicrotask(() => {
        if (FakeWorker.initReply === 'net-missing') {
          this.line('info string ERROR: NNUE network file not loaded, search refused');
        }
        this.line('id name AB-JChess');
        this.line('uciok');
      });
      return;
    }
    if (message.command === 'isready') {
      if (FakeWorker.holdReadyok) this.heldReadyok.push(() => this.line('readyok'));
      else queueMicrotask(() => this.line('readyok'));
      return;
    }
    FakeWorker.script(message.command, this);
  }

  terminate(): void {
    this.terminated = true;
  }

  line(line: string): void {
    this.emit({ type: 'line', line });
  }

  emit(data: FakeMessage): void {
    const event = { data } as MessageEvent<FakeMessage>;
    this.onmessage?.(event);
    for (const listener of [...this.messageListeners]) listener(event);
  }
}

function defaultScript(command: string, worker: FakeWorker): void {
  if (command.startsWith('go depth')) {
    queueMicrotask(() => {
      worker.line('info depth 1 seldepth 1 multipv 1 score cp 12 nodes 40 nps 40000 pv b2b9');
      worker.line(
        'info depth 2 seldepth 3 multipv 1 score cp 18 nodes 300 nps 300000 pv b2b9 b7b0',
      );
      worker.line('info string some note');
      worker.line('bestmove b2b9 ponder b7b0');
    });
  } else if (command === 'go infinite') {
    queueMicrotask(() =>
      worker.line('info depth 3 seldepth 4 multipv 1 score cp 21 nodes 900 nps 450000 pv h2h9'),
    );
  } else if (command === 'stop') {
    queueMicrotask(() => worker.line('bestmove h2h9'));
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  FakeWorker.all = [];
  FakeWorker.script = defaultScript;
  FakeWorker.initReply = 'ready';
  FakeWorker.holdReadyok = false;
  vi.stubGlobal('Worker', FakeWorker);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  window.history.replaceState(null, '', '/');
});

describe('AB-JChess UCI formatting', () => {
  it('sends the public FEN as the server does, with no moves', () => {
    expect(abjchessPositionCommand(START)).toBe(`position fen ${START}`);
    expect(abjchessPositionCommand(`  ${AFTER_FLIP.replace(/ /g, '   ')} `)).toBe(
      `position fen ${AFTER_FLIP}`,
    );
  });

  it('accepts move tokens with the reveal suffix and a captured identity', () => {
    // b2b9 moved face down and turned out a horse (N); a2a9 also took a
    // face-down black chariot (r); a plain move has neither.
    expect(abjchessPositionCommand(START, ['b2b9N', 'b7b0n', 'a3a4', 'a0a9Rr'])).toBe(
      `position fen ${START} moves b2b9N b7b0n a3a4 a0a9Rr`,
    );
  });

  it('refuses anything that is not a public jieqi FEN or a move token', () => {
    const bad = [
      '',
      'startpos',
      START.replace(' w ', ' r '),
      START.replace(' 0 1', ''),
      START.replace(' 0 1', ' 0 1 extra'),
      START.replace('R2A2', 'K2A2'),
      `${START}\ngo infinite`,
      START.replace('xxxxkxxxx', 'xxxxkxxxx;quit'),
    ];
    for (const fen of bad) expect(() => abjchessPositionCommand(fen), fen).toThrow();
    for (const move of ['b2b9X', 'b2', 'b2b9NNN', 'j2j9', 'b2b9 quit', 'b2b9\nstop']) {
      expect(() => abjchessPositionCommand(START, [move]), move).toThrow(/bad move token/);
    }
  });

  it('maps effort to a short first budget that steps up to the cap', () => {
    expect(ABJCHESS_DEPTH_BY_EFFORT).toEqual({ quick: 12, standard: 14, deep: 16, max: 18 });
    expect(abjchessGoCommand({})).toBe('go depth 14');
    expect(abjchessGoCommand({ effort: 'quick' })).toBe('go depth 12');
    expect(abjchessGoCommand({ effort: 'deep' })).toBe('go depth 16');
    expect(abjchessGoCommand({ effort: 'max' })).toBe('go depth 18');
    expect(abjchessGoCommand({ effort: 'infinite' })).toBe('go infinite');
  });

  it('clamps an explicit depth to 1..18 and sends only an integer', () => {
    expect(abjchessGoCommand({ maxDepth: 26, effort: 'quick' })).toBe('go depth 18');
    expect(abjchessGoCommand({ maxDepth: 0 })).toBe('go depth 1');
    expect(abjchessGoCommand({ maxDepth: 9.7 })).toBe('go depth 9');
    expect(abjchessGoCommand({ maxDepth: Number.NaN })).toBe('go depth 18');
  });

  it('validates spin options before they reach a build that aborts on a bad number', () => {
    expect(abjchessSpinOption('Hash', 32)).toBe('setoption name Hash value 32');
    for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 16385]) {
      expect(() => abjchessSpinOption('Hash', value), String(value)).toThrow();
    }
    expect(() => abjchessSpinOption('Threads', 257)).toThrow();
  });
});

describe('AB-JChess session', () => {
  it('loads the versioned assets and starts with the server options', async () => {
    const handle = new AbJchessCeval('jieqi');
    await handle.preload();
    const worker = FakeWorker.all[0]!;
    const v = `?v=${ABJCHESS_ENGINE_ASSET_VERSION}`;
    expect(worker.url).toBe(`/engine/ab-jchess/worker.js${v}`);
    expect(worker.init).toMatchObject({
      jsUrl: `/engine/ab-jchess/abjchess.js${v}`,
      wasmUrl: `/engine/ab-jchess/abjchess.wasm${v}`,
      netUrl: `/engine/ab-jchess/abjchess-20261030.nnue${v}`,
    });
    // ChaseRule `default` exactly as jieqi-engine.ts abJchessStartupOptions;
    // no Threads, no MultiPV (the engine has no such option).
    expect(worker.commands).toEqual([
      'uci',
      'setoption name Hash value 32',
      'setoption name ChaseRule value default',
      'isready',
    ]);
    expect(handle.engineName).toBe(ABJCHESS_ENGINE_NAME);
    expect(handle.winK).toBe(ABJCHESS_20261031_WIN_PCT_K);
    expect(handle.maxMultiPv).toBe(5);
    handle.dispose();
  });

  it('confirms the position, then streams one line per completed depth', async () => {
    const handle = new AbJchessCeval('jieqi');
    const updates: CevalUpdate[] = [];
    const result = await handle.evaluate({
      initialFen: START,
      movesUci: [],
      multiPv: 1,
      jieqiRule: 'legacy',
      onUpdate: (update) => updates.push(update),
    });
    const worker = FakeWorker.all[0]!;
    expect(worker.commands.slice(4)).toEqual([`position fen ${START}`, 'isready', 'go depth 14']);
    expect(worker.commands.some((c) => c.includes('MultiPV'))).toBe(false);
    // The game's adjudication rule does not change the engine's chase rule.
    expect(worker.commands.filter((c) => c.includes('ChaseRule'))).toHaveLength(1);
    expect(result.depth).toBe(2);
    expect(result.lines).toEqual([
      { multipv: 1, depth: 2, scoreCp: 18, mate: null, pvUci: ['b2b9', 'b7b0'] },
    ]);
    expect(updates.at(-1)).toEqual(result);
    for (const update of updates) expect(update.lines.length).toBeLessThanOrEqual(1);
    handle.dispose();
  });

  it('drops any line the engine labels other than the first', async () => {
    FakeWorker.script = (command, worker) => {
      if (!command.startsWith('go')) return;
      queueMicrotask(() => {
        worker.line('info depth 5 seldepth 6 multipv 1 score cp 40 nodes 10 nps 10 pv a3a4');
        worker.line('info depth 5 seldepth 6 multipv 2 score cp 10 nodes 10 nps 10 pv c3c4');
        worker.line('bestmove a3a4');
      });
    };
    const handle = new AbJchessCeval('jieqi');
    const result = await handle.evaluate({ initialFen: START, movesUci: [] });
    expect(result.lines.map((line) => line.pvUci[0])).toEqual(['a3a4']);
    handle.dispose();
  });

  it('stops the running search before the next position (stepping re-analyses)', async () => {
    const handle = new AbJchessCeval('jieqi');
    const first = handle.evaluate({ initialFen: START, movesUci: [], effort: 'infinite' });
    await flush();
    const second = handle.evaluate({ initialFen: AFTER_FLIP, movesUci: [], effort: 'quick' });
    expect(await first).toEqual({ depth: 0, seldepth: 0, nodes: 0, nps: 0, lines: [] });
    const result = await second;
    const worker = FakeWorker.all[0]!;
    expect(worker.commands.slice(4)).toEqual([
      `position fen ${START}`,
      'isready',
      'go infinite',
      'stop',
      `position fen ${AFTER_FLIP}`,
      'isready',
      'go depth 12',
    ]);
    expect(result.depth).toBe(2);
    handle.dispose();
  });

  it('refuses to search when the engine rejects the position', async () => {
    FakeWorker.script = (command, worker) => {
      if (command.startsWith('position')) {
        queueMicrotask(() => worker.line('info string bad fen'));
      }
    };
    const handle = new AbJchessCeval('jieqi');
    await expect(handle.evaluate({ initialFen: START, movesUci: [] })).rejects.toThrow(
      /info string bad fen/,
    );
    expect(FakeWorker.all[0]!.commands.some((c) => c.startsWith('go'))).toBe(false);
    handle.dispose();
  });

  it('keeps two overlapping evaluations from reading each other’s replies', async () => {
    // The second call arrives while the first still waits on the engine's
    // verdict for its position. Those replies carry no id: the rejection and
    // the readyok belong to the first call only.
    const handle = new AbJchessCeval('jieqi');
    await handle.preload();
    const worker = FakeWorker.all[0]!;
    FakeWorker.holdReadyok = true;
    const first = handle.evaluate({ initialFen: START, movesUci: [] });
    await flush();
    expect(worker.commands.slice(4)).toEqual([`position fen ${START}`, 'isready']);
    const second = handle.evaluate({ initialFen: AFTER_FLIP, movesUci: [] });
    await flush();
    worker.line('info string bad fen');
    FakeWorker.holdReadyok = false;
    worker.heldReadyok.shift()?.();
    await expect(first).rejects.toThrow(/bad fen/);
    while (worker.heldReadyok.length) worker.heldReadyok.shift()?.();
    const result = await second;
    expect(result.depth).toBe(2);
    const commands = worker.commands.slice(4);
    expect(commands.filter((c) => c.startsWith('go'))).toEqual(['go depth 14']);
    expect(commands.indexOf('go depth 14')).toBeGreaterThan(
      commands.indexOf(`position fen ${AFTER_FLIP}`),
    );
    handle.dispose();
  });

  it('searches nothing when the second of two overlapping positions is rejected', async () => {
    FakeWorker.script = (command, worker) => {
      if (command === `position fen ${AFTER_FLIP}`) {
        queueMicrotask(() => worker.line('info string bad fen'));
      } else {
        defaultScript(command, worker);
      }
    };
    const handle = new AbJchessCeval('jieqi');
    await handle.preload();
    const first = handle.evaluate({ initialFen: START, movesUci: [] });
    const second = handle.evaluate({ initialFen: AFTER_FLIP, movesUci: [] });
    expect(await first).toEqual({ depth: 0, seldepth: 0, nodes: 0, nps: 0, lines: [] });
    await expect(second).rejects.toThrow(/bad fen/);
    expect(FakeWorker.all[0]!.commands.some((c) => c.startsWith('go'))).toBe(false);
    handle.dispose();
  });

  it('gives up as a crash when a stopped search never answers, so the fallback can take over', async () => {
    FakeWorker.script = (command, worker) => {
      if (command === 'go infinite') defaultScript(command, worker);
      // `stop` gets no bestmove.
    };
    const handle = new AbJchessCeval('jieqi');
    await handle.preload();
    const first = handle
      .evaluate({ initialFen: START, movesUci: [], effort: 'infinite' })
      .catch((error: unknown) => error);
    await flush();
    vi.useFakeTimers();
    try {
      const second = handle.evaluate({ initialFen: AFTER_FLIP, movesUci: [] });
      const settled = expect(second).rejects.toBeInstanceOf(AbJchessCrashError);
      await vi.advanceTimersByTimeAsync(ABJCHESS_STOP_TIMEOUT_MS + 1);
      await settled;
      // The stuck session is dead for every caller, not only the one that waited.
      expect(await first).toBeInstanceOf(AbJchessCrashError);
    } finally {
      vi.useRealTimers();
    }
    handle.dispose();
  });

  it('treats a missing net as a load failure', async () => {
    FakeWorker.initReply = 'net-missing';
    const handle = new AbJchessCeval('jieqi');
    await expect(handle.preload()).rejects.toBeInstanceOf(AbJchessCrashError);
    handle.dispose();
  });

  it('refuses a variant other than jieqi', () => {
    expect(() => new AbJchessCeval('xiangqi')).toThrow();
  });
});

/** Answers `moves` with `legal`; each `go` reports the first move it may
 *  search (all of `legal`, or its `searchmoves` list), scores falling by rank.
 *  A `go` whose number is in `hold` waits for `stop`. */
function multiLineScript(legal: string[], hold: number[] = []): Script {
  let goes = 0;
  return (command, worker) => {
    if (command === 'moves') {
      queueMicrotask(() => worker.line(`moves ${legal.join(' ')}`));
      return;
    }
    if (command === 'stop') {
      queueMicrotask(() => worker.line('bestmove 0000'));
      return;
    }
    if (!command.startsWith('go')) return;
    goes += 1;
    const allowed = command.includes('searchmoves')
      ? command.split(' searchmoves ')[1]!.split(' ')
      : legal;
    const move = allowed[0]!;
    const cp = 50 - 10 * (legal.length - allowed.length);
    queueMicrotask(() => {
      worker.line(`info depth 1 seldepth 1 multipv 1 score cp ${cp} nodes 100 nps 1000 pv ${move}`);
      if (hold.includes(goes)) return;
      worker.line(
        `info depth 2 seldepth 2 multipv 1 score cp ${cp} nodes 300 nps 3000 pv ${move} b7b0`,
      );
      worker.line(`bestmove ${move}`);
    });
  };
}

describe('AB-JChess several lines', () => {
  it('searches line 1, then each next line without the first moves already shown', async () => {
    FakeWorker.script = multiLineScript(['b2b9', 'h2h9', 'a3a4', 'c3c4']);
    const handle = new AbJchessCeval('jieqi');
    const updates: CevalUpdate[] = [];
    const result = await handle.evaluate({
      initialFen: START,
      movesUci: [],
      multiPv: 3,
      onUpdate: (update) => updates.push(update),
    });
    const worker = FakeWorker.all[0]!;
    expect(worker.commands.slice(4)).toEqual([
      `position fen ${START}`,
      'isready',
      'moves',
      'go depth 14',
      'go depth 14 searchmoves h2h9 a3a4 c3c4',
      'go depth 14 searchmoves a3a4 c3c4',
    ]);
    expect(result.lines.map((line) => [line.multipv, line.pvUci[0], line.scoreCp])).toEqual([
      [1, 'b2b9', 50],
      [2, 'h2h9', 40],
      [3, 'a3a4', 30],
    ]);
    expect(result.depth).toBe(2);
    // Nodes add up across the three searches.
    expect(result.nodes).toBe(900);
    // Line 1 shows before the others exist.
    expect(updates[0]?.lines).toHaveLength(1);
    expect(updates.at(-1)).toEqual(result);
    handle.dispose();
  });

  it('shows as many lines as there are legal moves', async () => {
    FakeWorker.script = multiLineScript(['b2b9', 'h2h9']);
    const handle = new AbJchessCeval('jieqi');
    const result = await handle.evaluate({ initialFen: START, movesUci: [], multiPv: 5 });
    const goes = FakeWorker.all[0]!.commands.filter((c) => c.startsWith('go'));
    expect(goes).toEqual(['go depth 14', 'go depth 14 searchmoves h2h9']);
    expect(result.lines.map((line) => line.pvUci[0])).toEqual(['b2b9', 'h2h9']);
    handle.dispose();
  });

  it('one line runs one search and never asks for the root moves', async () => {
    FakeWorker.script = multiLineScript(['b2b9', 'h2h9']);
    const handle = new AbJchessCeval('jieqi');
    await handle.evaluate({ initialFen: START, movesUci: [], multiPv: 1 });
    const sent = FakeWorker.all[0]!.commands.slice(4);
    expect(sent).toEqual([`position fen ${START}`, 'isready', 'go depth 14']);
    handle.dispose();
  });

  it('a new position mid line 2 stops it and starts no line 3', async () => {
    FakeWorker.script = multiLineScript(['b2b9', 'h2h9', 'a3a4'], [2]);
    const handle = new AbJchessCeval('jieqi');
    const first = handle.evaluate({ initialFen: START, movesUci: [], multiPv: 3 });
    for (let i = 0; i < 5; i++) await flush();
    const worker = FakeWorker.all[0]!;
    expect(worker.commands.at(-1)).toBe('go depth 14 searchmoves h2h9 a3a4');
    const second = handle.evaluate({ initialFen: AFTER_FLIP, movesUci: [], multiPv: 1 });
    expect(await first).toEqual({ depth: 0, seldepth: 0, nodes: 0, nps: 0, lines: [] });
    await second;
    expect(worker.commands.slice(4)).toEqual([
      `position fen ${START}`,
      'isready',
      'moves',
      'go depth 14',
      'go depth 14 searchmoves h2h9 a3a4',
      'stop',
      `position fen ${AFTER_FLIP}`,
      'isready',
      'go depth 14',
    ]);
    handle.dispose();
  });

  it('stop() mid line 2 ends the request with no further search', async () => {
    FakeWorker.script = multiLineScript(['b2b9', 'h2h9', 'a3a4'], [2]);
    const handle = new AbJchessCeval('jieqi');
    const pending = handle.evaluate({ initialFen: START, movesUci: [], multiPv: 3 });
    for (let i = 0; i < 5; i++) await flush();
    handle.stop();
    expect(await pending).toEqual({ depth: 0, seldepth: 0, nodes: 0, nps: 0, lines: [] });
    await flush();
    const goes = FakeWorker.all[0]!.commands.filter((c) => c.startsWith('go'));
    expect(goes).toHaveLength(2);
    handle.dispose();
  });

  it('plans the searches for each effort', () => {
    expect(abjchessSearchPasses({ effort: 'deep' }, 3)).toEqual([{ go: 'go depth 16', ranks: 3 }]);
    expect(abjchessSearchPasses({ effort: 'standard' }, 9)).toEqual([
      { go: 'go depth 14', ranks: 5 },
    ]);
    expect(abjchessSearchPasses({ effort: 'infinite' }, 1)).toEqual([
      { go: 'go infinite', ranks: 1 },
    ]);
    // Every line deepens to the cap, then line 1 keeps searching.
    expect(abjchessSearchPasses({ effort: 'infinite' }, 2)).toEqual([
      { go: 'go depth 14', ranks: 2 },
      { go: 'go depth 16', ranks: 2 },
      { go: 'go depth 18', ranks: 2 },
      { go: 'go infinite', ranks: 1 },
    ]);
  });

  it('keeps the last pass lines whose first move no new line took', () => {
    const line = (move: string, depth: number) => ({
      multipv: 9,
      depth,
      scoreCp: 0,
      mate: null,
      pvUci: [move],
    });
    const merged = mergeAbjchessLines(
      [line('h2h9', 16)],
      [line('b2b9', 14), line('h2h9', 14), line('a3a4', 14)],
      3,
    );
    expect(merged.map((l) => [l.multipv, l.pvUci[0], l.depth])).toEqual([
      [1, 'h2h9', 16],
      [2, 'b2b9', 14],
      [3, 'a3a4', 14],
    ]);
  });

  it('reads only coordinate moves from the engine list', () => {
    expect(parseAbjchessRootMoves('moves b2b9 h2h9 b2b9 bogus z9z9')).toEqual(['b2b9', 'h2h9']);
    expect(parseAbjchessRootMoves('moves')).toEqual([]);
    expect(parseAbjchessRootMoves('info string moves a0a1')).toEqual([]);
  });
});

describe('AB-JChess fallback to PikaJieQi', () => {
  function fakeHandle(name: string, overrides: Partial<CevalHandle> = {}): CevalHandle {
    return {
      variant: 'jieqi',
      preload: vi.fn(async () => {}),
      evaluate: vi.fn(async (_req: CevalRequest) => ({
        depth: 9,
        seldepth: 9,
        nodes: 1,
        nps: 1,
        lines: [{ multipv: 1, depth: 9, scoreCp: 5, mate: null, pvUci: [name] }],
      })),
      stop: vi.fn(),
      dispose: vi.fn(),
      ...overrides,
    };
  }

  it('falls back when the worker reports a load error', async () => {
    FakeWorker.initReply = 'error';
    const fallback = fakeHandle('pika');
    const handle = new AbJchessWithFallback('jieqi', undefined, () => fallback);
    await handle.preload();
    expect(handle.usingFallback).toBe(true);
    expect(handle.engineName).toBe('PikaJieQi');
    expect(handle.winK).toBeUndefined();
    expect(handle.maxMultiPv).toBeUndefined();
    expect(FakeWorker.all[0]!.terminated).toBe(true);
    const result = await handle.evaluate({ initialFen: START, movesUci: [], multiPv: 3 });
    expect(result.lines[0]?.pvUci).toEqual(['pika']);
    // PikaJieQi keeps the panel's MultiPV.
    expect(vi.mocked(fallback.evaluate).mock.calls[0]?.[0].multiPv).toBe(3);
  });

  it('falls back to the real PikaJieQi backend by default', async () => {
    FakeWorker.initReply = 'error';
    const handle = new AbJchessWithFallback('jieqi');
    await handle.preload().catch(() => {});
    expect(handle.usingFallback).toBe(true);
    expect(FakeWorker.all[1]?.url).toContain('/engine/pikafish-jieqi/worker.js');
    handle.dispose();
  });

  it('falls back and re-evaluates when AB-JChess crashes mid-search', async () => {
    const primary = fakeHandle('abj', {
      evaluate: vi.fn(async () => {
        throw new AbJchessCrashError('worker died');
      }),
    });
    const fallback = fakeHandle('pika');
    const handle = new AbJchessWithFallback(
      'jieqi',
      () => primary,
      () => fallback,
    );
    expect(handle.engineName).toBe(ABJCHESS_ENGINE_NAME);
    expect(handle.winK).toBe(ABJCHESS_20261031_WIN_PCT_K);
    expect(handle.maxMultiPv).toBe(5);
    const result = await handle.evaluate({ initialFen: START, movesUci: [] });
    expect(result.lines[0]?.pvUci).toEqual(['pika']);
    expect(primary.dispose).toHaveBeenCalledOnce();
    expect(handle.usingFallback).toBe(true);
  });

  it('keeps AB-JChess on an ordinary error and passes the line setting through', async () => {
    const primary = fakeHandle('abj', {
      evaluate: vi.fn(async () => {
        throw new Error('ab-jchess-ceval: info string bad fen');
      }),
    });
    const createFallback = vi.fn(() => fakeHandle('pika'));
    const handle = new AbJchessWithFallback('jieqi', () => primary, createFallback);
    await expect(handle.evaluate({ initialFen: START, movesUci: [], multiPv: 4 })).rejects.toThrow(
      /bad fen/,
    );
    expect(vi.mocked(primary.evaluate).mock.calls[0]?.[0].multiPv).toBe(4);
    expect(createFallback).not.toHaveBeenCalled();
    expect(handle.usingFallback).toBe(false);
  });
});

describe('AB-JChess flag', () => {
  async function load() {
    vi.resetModules();
    return import('./ceval.js');
  }

  it('leaves PikaJieQi in place and fetches nothing from /engine/ab-jchess/ with the flag off', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    for (const flag of ['false']) {
      vi.stubEnv('VITE_ABJCHESS_CEVAL_ENABLED', flag);
      const { cevalEngineName, createCeval } = await load();
      expect(cevalEngineName('jieqi')).toBe('PikaJieQi');
      const handle = createCeval('jieqi');
      expect(handle.constructor.name).toBe(PikaJieQiCeval.name);
      await handle.preload();
      handle.dispose();
    }
    const urls = [...FakeWorker.all.map((w) => w.url), ...fetchMock.mock.calls.map((c) => c[0])];
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.filter((url) => String(url).includes('/engine/ab-jchess/'))).toEqual([]);
    for (const url of Object.values(ABJCHESS_ASSET_URLS)) expect(urls).not.toContain(url);
  });

  it('uses AB-JChess for jieqi by default and with the flag on, and only for jieqi', async () => {
    for (const flag of [undefined, '', 'true']) {
      vi.stubEnv('VITE_ABJCHESS_CEVAL_ENABLED', flag);
      const { cevalEngineName, createCeval } = await load();
      expect(cevalEngineName('jieqi'), String(flag)).toBe(ABJCHESS_ENGINE_NAME);
      expect(cevalEngineName('xiangqi')).not.toBe(ABJCHESS_ENGINE_NAME);
      const handle = createCeval('jieqi');
      expect(handle.constructor.name).toBe('AbJchessWithFallback');
      handle.dispose();
    }
    // Constructing the handle loads nothing; the worker starts on preload.
    expect(FakeWorker.all).toEqual([]);
  });

  it('follows ?engine= over the build flag', async () => {
    vi.stubEnv('VITE_ABJCHESS_CEVAL_ENABLED', 'false');
    window.history.replaceState(null, '', '/review/x?engine=abjchess');
    let mod = await load();
    expect(mod.cevalEngineName('jieqi')).toBe(ABJCHESS_ENGINE_NAME);
    vi.stubEnv('VITE_ABJCHESS_CEVAL_ENABLED', 'true');
    window.history.replaceState(null, '', '/review/x?engine=pikajieqi');
    mod = await load();
    expect(mod.cevalEngineName('jieqi')).toBe('PikaJieQi');
  });
});
