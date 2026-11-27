// Client-side Jieqi analysis on AB-JChess (by Huorongrong and Laoxu (Kouza)),
// the engine the server grades jieqi games with, compiled to WebAssembly (#800).
// The jieqi default since 2026-11-27 (abjchessCevalEnabled()); PikaJieQi is the fallback.
//
// One persistent UCI session in a dedicated worker. The build is the pthreads
// one (public/engine/ab-jchess/README.md): the jieqi panel already requires
// cross-origin isolation for PikaJieQi, so threads cost no reach, and they give
// what the single-threaded build cannot, a streaming `go` that `stop` interrupts.
// The engine has no MultiPV option, so extra lines come from repeated searches:
// line 1 searches normally, then each next line searches again with
// `go searchmoves` over the legal root moves minus the first moves already
// shown (abjchessSearchPasses). Line 1 streams first; the rest follow it.
import { ABJCHESS_20261031_WIN_PCT_K } from '@mistboard/game';
import { ABJCHESS_ENGINE_ASSET_VERSION } from '../../engine-credits.js';
import type {
  CevalEffort,
  CevalHandle,
  CevalLine,
  CevalLoadProgress,
  CevalRequest,
  CevalUpdate,
  CevalVariant,
} from './ceval-types.js';
import { createMultiPvBurstCollector, createThrottledEmitter } from './multipv-burst.js';
import { PikaJieQiCeval, pikaJieqiEngineName } from './pikajieqi-ceval.js';
import { parseInfo } from './uci-info.js';

export const ABJCHESS_ENGINE_NAME = 'AB-JChess';
const ENGINE_BASE = '/engine/ab-jchess/';

export { ABJCHESS_ENGINE_ASSET_VERSION };

const engineAsset = (file: string): string =>
  `${ENGINE_BASE}${file}?v=${ABJCHESS_ENGINE_ASSET_VERSION}`;
/** The URLs the worker loads, in load order. */
export const ABJCHESS_ASSET_URLS = Object.freeze({
  worker: engineAsset('worker.js'),
  js: engineAsset('abjchess.js'),
  wasm: engineAsset('abjchess.wasm'),
  net: engineAsset('abjchess-20261030.nnue'),
});
const EMIT_THROTTLE_MS = 80;
const HASH_MB = 32;
// A worker that has not answered by then (a stalled download, a module that
// never instantiates) counts as a load failure, so the panel falls back.
const INIT_TIMEOUT_MS = 60_000;
/** A stopped search answers `bestmove` in milliseconds; past this the worker is stuck. */
export const ABJCHESS_STOP_TIMEOUT_MS = 3_000;

/**
 * Search depth per effort. AB-JChess in WebAssembly runs about 1.8M nodes a
 * second on a desktop: from the opening, depth 14 in about 1 s, 16 in about
 * 6 s, 18 in about 30 s. The PikaJieQi table (14/18/22/26) would leave the
 * default effort searching for minutes. Lines stream per completed depth, so
 * the first one shows within milliseconds at any effort.
 */
export const ABJCHESS_DEPTH_BY_EFFORT: Readonly<Record<Exclude<CevalEffort, 'infinite'>, number>> =
  Object.freeze({ quick: 12, standard: 14, deep: 16, max: 18 });
/** Cap for a caller's explicit maxDepth. */
export const ABJCHESS_MAX_DEPTH = ABJCHESS_DEPTH_BY_EFFORT.max;

/** The `go` command for a request: an explicit maxDepth (clamped to 1..cap)
 *  wins, then the effort; `infinite` searches until stopped. */
export function abjchessGoCommand(req: Pick<CevalRequest, 'maxDepth' | 'effort'>): string {
  if (req.maxDepth !== undefined) {
    const depth = Number.isFinite(req.maxDepth) ? Math.trunc(req.maxDepth) : ABJCHESS_MAX_DEPTH;
    return `go depth ${Math.min(ABJCHESS_MAX_DEPTH, Math.max(1, depth))}`;
  }
  if (req.effort === 'infinite') return 'go infinite';
  return `go depth ${ABJCHESS_DEPTH_BY_EFFORT[req.effort ?? 'standard']}`;
}

/** The panel's line setting, clamped to what the wrapper serves. */
export const ABJCHESS_MAX_MULTIPV = 5;

export interface AbJchessSearchPass {
  /** The `go` command without `searchmoves`. */
  go: string;
  /** How many lines this pass searches (1 = the best line only). */
  ranks: number;
}

/**
 * The searches one request runs. A bounded request is one pass of `multiPv`
 * lines at its depth. `infinite` with several lines deepens every line through
 * the effort depths, then leaves line 1 searching until stopped while the
 * others keep their deepest result; with one line it is a plain `go infinite`.
 */
export function abjchessSearchPasses(
  req: Pick<CevalRequest, 'maxDepth' | 'effort'>,
  multiPv: number,
): AbJchessSearchPass[] {
  const ranks = Math.min(ABJCHESS_MAX_MULTIPV, Math.max(1, Math.trunc(multiPv) || 1));
  const go = abjchessGoCommand(req);
  if (go !== 'go infinite') return [{ go, ranks }];
  if (ranks === 1) return [{ go, ranks: 1 }];
  const { standard, deep, max } = ABJCHESS_DEPTH_BY_EFFORT;
  return [
    ...[standard, deep, max].map((depth) => ({ go: `go depth ${depth}`, ranks })),
    { go, ranks: 1 },
  ];
}

const ROOT_MOVE = /^[a-i][0-9][a-i][0-9]$/;

/** The engine's `moves` reply (its legal root moves), validated and deduped. */
export function parseAbjchessRootMoves(line: string): string[] {
  const [head, ...moves] = line.trim().split(/\s+/);
  if (head !== 'moves') return [];
  return [...new Set(moves.filter((move) => ROOT_MOVE.test(move)))];
}

/**
 * Lines to show: this pass's fresh lines in rank order, then the previous
 * pass's lines whose first move no fresh line has taken, renumbered.
 */
export function mergeAbjchessLines(
  fresh: readonly CevalLine[],
  previous: readonly CevalLine[],
  multiPv: number,
): CevalLine[] {
  const taken = new Set(fresh.map((line) => line.pvUci[0]));
  const stale = previous.filter((line) => !taken.has(line.pvUci[0]));
  return [...fresh, ...stale]
    .slice(0, multiPv)
    .map((line, index) => ({ ...line, multipv: index + 1 }));
}

/**
 * `setoption` for a spin option. The build has no C++ exception handling, so a
 * value the engine's integer parse rejects aborts the whole module: only a
 * safe integer within the option's range is ever sent.
 */
export function abjchessSpinOption(name: 'Hash' | 'Threads', value: number): string {
  const max = name === 'Hash' ? 16384 : 256;
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new Error(`ab-jchess-ceval: ${name} must be an integer in 1..${max}, got ${value}`);
  }
  return `setoption name ${name} value ${value}`;
}

// The public jieqi FEN (jieqiStateToPikafishFen with public: true): board with
// X/x for face-down pieces, side to move, the hidden pool, the two clocks.
const FEN_BOARD = /^[KABNRCPXkabnrcpx1-9]+(?:\/[KABNRCPXkabnrcpx1-9]+){9}$/;
const FEN_POOL = /^(?:-|(?:[RACPNBracpnb]\d{1,2})+)$/;
const FEN_CLOCK = /^\d{1,4}$/;
// Coordinates, then the mover's identity when it moved face down (the reveal),
// then the victim's when it captured a face-down piece (engine apply_token).
const MOVE_TOKEN = /^[a-i][0-9][a-i][0-9][RACPNBracpnb]{0,2}$/;

/**
 * The `position` command, validated so nothing but a FEN and move tokens reach
 * the engine's line parser. The review sends each node's public FEN with no
 * moves, as the server does; a move list is accepted for other callers, each
 * move carrying its reveal suffix when the mover was face down.
 */
export function abjchessPositionCommand(fen: string, movesUci: readonly string[] = []): string {
  const fields = fen.trim().split(/\s+/);
  const [board, side, pool, halfmove, fullmove] = fields;
  if (
    fields.length !== 5 ||
    !FEN_BOARD.test(board ?? '') ||
    (side !== 'w' && side !== 'b') ||
    !FEN_POOL.test(pool ?? '') ||
    !FEN_CLOCK.test(halfmove ?? '') ||
    !FEN_CLOCK.test(fullmove ?? '')
  ) {
    throw new Error(`ab-jchess-ceval: not a public jieqi FEN: ${fen}`);
  }
  for (const move of movesUci) {
    if (!MOVE_TOKEN.test(move)) throw new Error(`ab-jchess-ceval: bad move token ${move}`);
  }
  const command = `position fen ${fields.join(' ')}`;
  return movesUci.length ? `${command} moves ${movesUci.join(' ')}` : command;
}

const EMPTY_UPDATE: CevalUpdate = { depth: 0, seldepth: 0, nodes: 0, nps: 0, lines: [] };

type EngineMessage =
  | { type: 'ready' }
  | { type: 'line'; line: string }
  | { type: 'stderr'; line: string }
  | { type: 'error'; error?: string };

/** The worker died or the module aborted; the session is unusable. */
export class AbJchessCrashError extends Error {}

/** Persistent, streaming UCI client for the AB-JChess worker. */
export class AbJchessCeval implements CevalHandle {
  readonly engineName = ABJCHESS_ENGINE_NAME;
  readonly winK = ABJCHESS_20261031_WIN_PCT_K;
  readonly maxMultiPv = ABJCHESS_MAX_MULTIPV;
  private worker: Worker | null = null;
  private readyPromise: Promise<void> | null = null;
  private listeners = new Set<(line: string) => void>();
  private crashListeners = new Set<(error: Error) => void>();
  private crashed: Error | null = null;
  private searching = false;
  private token = 0;
  /** Held from an evaluation's stop through its `go`: replies (readyok, a
   * rejected position) carry no id, so two set-ups must never interleave. */
  private setupLock: Promise<void> = Promise.resolve();

  constructor(readonly variant: CevalVariant) {
    if (variant !== 'jieqi') throw new Error(`ab-jchess-ceval: no config for variant ${variant}`);
  }

  preload(): Promise<void> {
    if (!this.readyPromise) this.readyPromise = this.spawn();
    return this.readyPromise;
  }

  private crash(error: Error): void {
    if (this.crashed) return;
    this.crashed = error;
    this.searching = false;
    for (const listener of [...this.crashListeners]) listener(error);
  }

  private async spawn(): Promise<void> {
    const worker = new Worker(ABJCHESS_ASSET_URLS.worker);
    this.worker = worker;
    worker.onmessage = (event: MessageEvent<EngineMessage>) => {
      const message = event.data;
      if (message.type === 'line') {
        if (message.line.startsWith('bestmove')) this.searching = false;
        for (const listener of [...this.listeners]) listener(message.line);
      } else if (message.type === 'error') {
        this.crash(new AbJchessCrashError(message.error ?? 'ab-jchess-ceval: worker failed'));
      }
    };
    worker.onerror = (event) => {
      const detail = event.message || 'worker script failed to load';
      this.crash(new AbJchessCrashError(`ab-jchess-ceval: worker error: ${detail}`));
    };

    const errors: string[] = [];
    const offErrors = this.onLine((line) => {
      if (line.startsWith('info string ERROR')) errors.push(line);
    });
    try {
      await this.untilCrash(
        new Promise<void>((resolve) => {
          const onMessage = (event: MessageEvent<EngineMessage>) => {
            if (event.data.type !== 'ready') return;
            worker.removeEventListener('message', onMessage);
            resolve();
          };
          worker.addEventListener('message', onMessage);
          worker.postMessage({
            type: 'init',
            jsUrl: ABJCHESS_ASSET_URLS.js,
            wasmUrl: ABJCHESS_ASSET_URLS.wasm,
            netUrl: ABJCHESS_ASSET_URLS.net,
          });
        }),
        INIT_TIMEOUT_MS,
      );
      const uciOk = this.waitFor((line) => line === 'uciok');
      this.send('uci');
      await this.untilCrash(uciOk, INIT_TIMEOUT_MS);
      // One search thread (the engine default; Threads is never sent). The
      // server starts AB-JChess with `ChaseRule value default` and never varies
      // it by the game's adjudication rule (jieqi-engine.ts
      // abJchessStartupOptions), so neither does this panel; the engine's own
      // default is skyrule. Setting it clears the hash, so it is sent once.
      this.send(abjchessSpinOption('Hash', HASH_MB));
      this.send('setoption name ChaseRule value default');
      const ready = this.waitFor((line) => line === 'readyok');
      this.send('isready');
      await this.untilCrash(ready, INIT_TIMEOUT_MS);
    } finally {
      offErrors();
    }
    // A missing or unreadable net is reported, and the engine refuses to search.
    if (errors.length) throw new AbJchessCrashError(errors.join('; '));
  }

  /**
   * Reject when the worker dies instead of hanging. Past `timeoutMs` the
   * session is declared crashed, so the fallback takes over.
   */
  private untilCrash<T>(
    promise: Promise<T>,
    timeoutMs?: number,
    timeoutMessage = 'ab-jchess-ceval: engine did not start',
  ): Promise<T> {
    if (this.crashed) return Promise.reject(this.crashed);
    return new Promise<T>((resolve, reject) => {
      const timer =
        timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              done();
              const error = new AbJchessCrashError(timeoutMessage);
              this.crash(error);
              reject(error);
            }, timeoutMs);
      const onCrash = (error: Error) => {
        done();
        reject(error);
      };
      const done = () => {
        clearTimeout(timer);
        this.crashListeners.delete(onCrash);
      };
      this.crashListeners.add(onCrash);
      promise.then(
        (value) => {
          done();
          resolve(value);
        },
        (error: unknown) => {
          done();
          reject(error);
        },
      );
    });
  }

  private send(command: string): void {
    if (!this.worker) throw new Error('ab-jchess-ceval: worker not ready');
    this.worker.postMessage({ type: 'command', command });
  }

  private onLine(listener: (line: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private waitFor(predicate: (line: string) => boolean): Promise<string> {
    return new Promise((resolve) => {
      const off = this.onLine((line) => {
        if (!predicate(line)) return;
        off();
        resolve(line);
      });
    });
  }

  private async stopAndWait(): Promise<void> {
    if (!this.searching) return;
    const stopped = this.waitFor((line) => line.startsWith('bestmove'));
    this.send('stop');
    await this.untilCrash(
      stopped,
      ABJCHESS_STOP_TIMEOUT_MS,
      'ab-jchess-ceval: search did not stop',
    );
    this.searching = false;
  }

  async evaluate(req: CevalRequest): Promise<CevalUpdate> {
    await this.preload();
    const myToken = ++this.token;
    const previous = this.setupLock;
    let release = () => {};
    this.setupLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await previous;
      return await this.search(req, myToken, release);
    } finally {
      release();
    }
  }

  /** Runs under the set-up lock; calls `release` once `go` is sent. */
  private async search(
    req: CevalRequest,
    myToken: number,
    release: () => void,
  ): Promise<CevalUpdate> {
    if (this.token !== myToken) return EMPTY_UPDATE;
    await this.stopAndWait();
    if (this.token !== myToken) return EMPTY_UPDATE;
    if (!req.initialFen) throw new Error('ab-jchess-ceval: initialFen required');
    const position = abjchessPositionCommand(req.initialFen, req.movesUci);
    const passes = abjchessSearchPasses(req, req.multiPv ?? 1);

    // A rejected position keeps the engine's previous one, and `go` would then
    // search that: confirm the position took before searching.
    const rejected: string[] = [];
    const offRejected = this.onLine((line) => {
      if (line.startsWith('info string bad') || line.startsWith('info string invalid'))
        rejected.push(line);
    });
    const ready = this.waitFor((line) => line === 'readyok');
    this.send(position);
    this.send('isready');
    try {
      await this.untilCrash(ready);
    } finally {
      offRejected();
    }
    if (rejected.length) throw new Error(`ab-jchess-ceval: ${rejected.join('; ')}`);
    if (this.token !== myToken) return EMPTY_UPDATE;

    const multiPv = Math.max(...passes.map((pass) => pass.ranks));
    let rootMoves: string[] = [];
    if (multiPv > 1) {
      const listed = this.waitFor((line) => line.startsWith('moves'));
      this.send('moves');
      rootMoves = parseAbjchessRootMoves(await this.untilCrash(listed));
      if (this.token !== myToken) return EMPTY_UPDATE;
    }

    let lines: CevalLine[] = [];
    let seldepth = 0;
    let nodesBefore = 0;
    let nodes = 0;
    let nps = 0;
    const snapshot = (): CevalUpdate => ({
      depth: lines[0]?.depth ?? 0,
      seldepth,
      nodes: nodesBefore + nodes,
      nps,
      lines,
    });
    const emitter = createThrottledEmitter(EMIT_THROTTLE_MS, () => {
      if (this.token === myToken) req.onUpdate?.(snapshot());
    });

    try {
      for (const pass of passes) {
        const previous = lines;
        const fresh: CevalLine[] = [];
        for (let rank = 1; rank <= pass.ranks; rank++) {
          let go = pass.go;
          if (rank > 1) {
            const taken = new Set(fresh.map((line) => line.pvUci[0]));
            const rest = rootMoves.filter((move) => !taken.has(move));
            if (!rest.length) break;
            go = `${go} searchmoves ${rest.join(' ')}`;
          }
          nodesBefore += nodes;
          nodes = 0;
          const best = await this.runGo(go, myToken, release, (line, info) => {
            if (info.seldepth) seldepth = info.seldepth;
            if (info.nodes) nodes = info.nodes;
            if (info.nps) nps = info.nps;
            if (!line) return;
            fresh[rank - 1] = line;
            lines = mergeAbjchessLines(fresh, previous, multiPv);
            if (req.onUpdate) emitter.schedule();
          });
          if (this.token !== myToken) return EMPTY_UPDATE;
          if (!best) break;
          fresh[rank - 1] = best;
          lines = mergeAbjchessLines(fresh, previous, multiPv);
        }
      }
    } finally {
      emitter.cancel();
    }
    if (this.token !== myToken) return EMPTY_UPDATE;
    const update = snapshot();
    req.onUpdate?.(update);
    return update;
  }

  /**
   * One `go`, sent only while `myToken` is current (checked in the same tick
   * as the send, so a newer evaluation's set-up never interleaves with it).
   * Resolves with the search's last full line, or null when it had none (no
   * legal move, or superseded before it started).
   */
  private async runGo(
    go: string,
    myToken: number,
    release: () => void,
    onInfo: (line: CevalLine | null, info: NonNullable<ReturnType<typeof parseInfo>>) => void,
  ): Promise<CevalLine | null> {
    if (this.token !== myToken) return null;
    // The engine labels every line multipv 1; a stray other label is not ours.
    const bursts = createMultiPvBurstCollector(1);
    let last: CevalLine | null = null;
    let off = () => {};
    const finished = new Promise<CevalLine | null>((resolve) => {
      off = this.onLine((line) => {
        if (line.startsWith('info ') && this.token === myToken) {
          const info = parseInfo(line);
          if (!info) return;
          const burst = info.multipv === 1 ? bursts.push(info) : null;
          if (burst?.[0]) last = burst[0];
          onInfo(burst?.[0] ?? null, info);
          return;
        }
        if (!line.startsWith('bestmove')) return;
        off();
        this.searching = false;
        const tail = bursts.flush();
        if (tail?.[0]) last = tail[0];
        resolve(last);
      });
    });
    this.searching = true;
    this.send(go);
    release();
    try {
      return await this.untilCrash(finished);
    } catch (error) {
      off();
      throw error;
    }
  }

  stop(): void {
    this.token++;
    if (this.searching && this.worker && !this.crashed) this.send('stop');
  }

  dispose(): void {
    this.stop();
    this.worker?.terminate();
    this.worker = null;
    this.readyPromise = null;
    this.listeners.clear();
    this.crashListeners.clear();
    this.searching = false;
  }
}

/**
 * The flagged jieqi handle: AB-JChess first, PikaJieQi when it will not load
 * or its worker dies, so the panel never goes dead. `engineName`, `winK` and
 * `maxMultiPv` follow whichever engine is answering.
 */
export class AbJchessWithFallback implements CevalHandle {
  private active: CevalHandle;
  private fellBack = false;
  private readyPromise: Promise<void> | null = null;

  constructor(
    readonly variant: CevalVariant,
    private readonly createPrimary: () => CevalHandle = () => new AbJchessCeval(variant),
    private readonly createFallback: () => CevalHandle = () => new PikaJieQiCeval(variant),
  ) {
    this.active = this.createPrimary();
  }

  get engineName(): string {
    return this.fellBack
      ? (pikaJieqiEngineName(this.variant) ?? 'PikaJieQi')
      : ABJCHESS_ENGINE_NAME;
  }

  get winK(): number | undefined {
    return this.fellBack ? this.active.winK : ABJCHESS_20261031_WIN_PCT_K;
  }

  get maxMultiPv(): number | undefined {
    return this.fellBack ? this.active.maxMultiPv : ABJCHESS_MAX_MULTIPV;
  }

  /** True once PikaJieQi has taken over. */
  get usingFallback(): boolean {
    return this.fellBack;
  }

  private fallBack(error: unknown): void {
    if (this.fellBack) return;
    console.warn('AB-JChess unavailable, analysing with PikaJieQi instead', error);
    this.active.dispose();
    this.active = this.createFallback();
    this.fellBack = true;
  }

  preload(onProgress?: (progress: CevalLoadProgress) => void): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = this.active.preload(onProgress).catch((error: unknown) => {
        this.fallBack(error);
        return this.active.preload(onProgress);
      });
    }
    return this.readyPromise;
  }

  async evaluate(req: CevalRequest): Promise<CevalUpdate> {
    await this.preload();
    if (this.fellBack) return this.active.evaluate(req);
    try {
      return await this.active.evaluate(req);
    } catch (error) {
      if (!(error instanceof AbJchessCrashError)) throw error;
      this.fallBack(error);
      this.readyPromise = this.active.preload();
      await this.readyPromise;
      return this.active.evaluate(req);
    }
  }

  stop(): void {
    this.active.stop();
  }

  dispose(): void {
    this.active.dispose();
    this.readyPromise = null;
  }
}
