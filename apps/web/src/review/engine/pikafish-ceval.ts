// Client-side standard-xiangqi analysis on mainline Pikafish, built to
// WebAssembly with its NNUE net (apps/web/public/engine/pikafish). The engine
// runs as a persistent UCI session in a dedicated worker and streams
// iterative-deepening MultiPV updates, the same shape as the PikaJieQi backend.
//
// Two things are specific to this backend. The net is 51 MB and is fetched by
// the worker on the first preload (byte progress reaches the caller through
// `preload(onProgress)`), and Pikafish speaks a0-i9 coordinates while every
// caller on this side speaks Fairy-Stockfish's a1-i10, so moves are shifted
// down one rank on the way in and PV moves shifted back up on the way out.
import type {
  CevalHandle,
  CevalLine,
  CevalLoadProgress,
  CevalRequest,
  CevalUpdate,
  CevalVariant,
} from './ceval-types.js';
import { depthForEffort } from './ceval-types.js';
import { createMultiPvBurstCollector, createThrottledEmitter } from './multipv-burst.js';
import { parseInfo } from './uci-info.js';

const ENGINE_BASE = '/engine/pikafish/';
// Bump on any vendored-asset change; the CDN keys on the query string (see the
// note above ENGINE_ASSET_VERSION in ceval.ts). Names the engine commit, the
// net's release date, and the toolchain.
export const PIKAFISH_ASSET_VERSION = '6a59ee2-net20260906-emsdk3174';
export const PIKAFISH_NNUE_NET = 'pikafish.nnue';
export const pikafishEngineAsset = (file: string): string =>
  `${ENGINE_BASE}${file}?v=${PIKAFISH_ASSET_VERSION}`;
const EMIT_THROTTLE_MS = 80;
const EMPTY_UPDATE: CevalUpdate = {
  depth: 0,
  seldepth: 0,
  nodes: 0,
  nps: 0,
  lines: [],
};

type EngineMessage =
  | { type: 'ready' }
  | { type: 'net-progress'; loaded: number; total: number }
  | { type: 'net-written'; bytes: number }
  | { type: 'line'; line: string }
  | { type: 'stderr'; line: string }
  | { type: 'error'; error?: string };

/** True only for standard xiangqi. The xiangqi variants (fortress, atomic,
 *  duck) stay on Fairy-Stockfish, which is where their rules live. */
export function isPikafishCevalVariant(variant: CevalVariant): boolean {
  return variant === 'xiangqi';
}

export function pikafishEngineName(variant: CevalVariant): string | null {
  return isPikafishCevalVariant(variant) ? 'Pikafish' : null;
}

/** Fairy-Stockfish a1-i10 → Pikafish a0-i9. Anything that is not a plain
 *  board move is passed through untouched. */
export function fsfUciToPikafishUci(uci: string): string {
  const match = uci.match(/^([a-i])(10|[1-9])([a-i])(10|[1-9])$/);
  if (!match) return uci;
  return `${match[1]}${Number(match[2]) - 1}${match[3]}${Number(match[4]) - 1}`;
}

/** Pikafish a0-i9 → Fairy-Stockfish a1-i10. */
export function pikafishUciToFsfUci(uci: string): string {
  const match = uci.match(/^([a-i])(\d)([a-i])(\d)$/);
  if (!match) return uci;
  return `${match[1]}${Number(match[2]) + 1}${match[3]}${Number(match[4]) + 1}`;
}

/** Search threads for the worker. The build pre-allocates eight pthreads
 *  (PTHREAD_POOL_SIZE=8); asking for more would block the worker on a thread
 *  that can only be created once it yields, so the cap is the pool. */
export function pikafishThreads(hardwareConcurrency: number | undefined): number {
  const cores = hardwareConcurrency ?? 2;
  return Math.max(1, Math.min(8, cores - 1));
}

/** Persistent, streaming UCI client for the Pikafish worker. */
export class PikafishCeval implements CevalHandle {
  private worker: Worker | null = null;
  private readyPromise: Promise<void> | null = null;
  private listeners = new Set<(line: string) => void>();
  private progressListeners = new Set<(progress: CevalLoadProgress) => void>();
  private searching = false;
  private token = 0;

  constructor(readonly variant: CevalVariant) {
    if (!isPikafishCevalVariant(variant)) {
      throw new Error(`pikafish-ceval: no config for variant ${variant}`);
    }
  }

  preload(onProgress?: (progress: CevalLoadProgress) => void): Promise<void> {
    if (onProgress) this.progressListeners.add(onProgress);
    if (!this.readyPromise) this.readyPromise = this.spawn();
    return this.readyPromise.finally(() => {
      if (onProgress) this.progressListeners.delete(onProgress);
    });
  }

  private async spawn(): Promise<void> {
    const worker = new Worker(pikafishEngineAsset('worker.js'));
    this.worker = worker;
    worker.onmessage = (event: MessageEvent<EngineMessage>) => {
      const message = event.data;
      if (message.type === 'line') {
        if (message.line.startsWith('bestmove')) this.searching = false;
        for (const listener of [...this.listeners]) listener(message.line);
      } else if (message.type === 'net-progress') {
        for (const listener of [...this.progressListeners]) {
          listener({ loaded: message.loaded, total: message.total });
        }
      }
    };

    await new Promise<void>((resolve, reject) => {
      const onMessage = (event: MessageEvent<EngineMessage>) => {
        const message = event.data;
        if (message.type === 'ready') {
          worker.removeEventListener('message', onMessage);
          resolve();
        } else if (message.type === 'error') {
          worker.removeEventListener('message', onMessage);
          reject(new Error(message.error ?? 'pikafish-ceval: worker init failed'));
        }
      };
      worker.addEventListener('message', onMessage);
      worker.onerror = (event) => {
        reject(new Error(`pikafish-ceval: worker error: ${event.message}`));
      };
      worker.postMessage({
        type: 'init',
        jsUrl: pikafishEngineAsset('pikafish.js'),
        wasmUrl: pikafishEngineAsset('pikafish.wasm'),
        netUrl: pikafishEngineAsset(PIKAFISH_NNUE_NET),
      });
    });

    const uciOk = this.waitFor((line) => line === 'uciok');
    this.send('uci');
    await uciOk;

    this.send(`setoption name Threads value ${pikafishThreads(navigator.hardwareConcurrency)}`);
    this.send('setoption name Hash value 64');
    const ready = this.waitFor((line) => line === 'readyok');
    this.send('isready');
    await ready;
  }

  private send(command: string): void {
    if (!this.worker) throw new Error('pikafish-ceval: worker not ready');
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
    await stopped;
    this.searching = false;
  }

  async evaluate(req: CevalRequest): Promise<CevalUpdate> {
    await this.preload();
    const myToken = ++this.token;
    await this.stopAndWait();
    if (this.token !== myToken) return EMPTY_UPDATE;

    const multiPv = req.multiPv ?? 1;
    const maxDepth = req.maxDepth ?? depthForEffort(req.effort);
    const infinite = req.maxDepth === undefined && req.effort === 'infinite';
    this.send(`setoption name MultiPV value ${multiPv}`);
    const base = req.initialFen ? `fen ${req.initialFen}` : 'startpos';
    const moves = req.movesUci.map(fsfUciToPikafishUci);
    this.send(moves.length ? `position ${base} moves ${moves.join(' ')}` : `position ${base}`);

    // Complete bursts only, same as the Fairy-Stockfish backend (multipv-burst.ts).
    const bursts = createMultiPvBurstCollector(multiPv);
    let lines: CevalLine[] = [];
    let seldepth = 0;
    let nodes = 0;
    let nps = 0;
    const snapshot = (): CevalUpdate => ({
      depth: lines[0]?.depth ?? 0,
      seldepth,
      nodes,
      nps,
      lines,
    });
    const emitter = createThrottledEmitter(EMIT_THROTTLE_MS, () => {
      if (this.token === myToken) req.onUpdate?.(snapshot());
    });

    return await new Promise<CevalUpdate>((resolve) => {
      const off = this.onLine((line) => {
        if (line.startsWith('info ') && this.token === myToken) {
          const info = parseInfo(line);
          if (!info) return;
          info.pvUci = info.pvUci.map(pikafishUciToFsfUci);
          if (info.seldepth) seldepth = info.seldepth;
          if (info.nodes) nodes = info.nodes;
          if (info.nps) nps = info.nps;
          const burst = bursts.push(info);
          if (burst) {
            lines = burst;
            if (req.onUpdate) emitter.schedule();
          }
          return;
        }
        if (!line.startsWith('bestmove')) return;
        off();
        this.searching = false;
        emitter.cancel();
        if (this.token !== myToken) {
          resolve(EMPTY_UPDATE);
          return;
        }
        const tail = bursts.flush();
        if (tail) lines = tail;
        const update = snapshot();
        req.onUpdate?.(update);
        resolve(update);
      });
      this.searching = true;
      this.send(infinite ? 'go infinite' : `go depth ${maxDepth}`);
    });
  }

  stop(): void {
    this.token++;
    if (this.searching && this.worker) this.send('stop');
  }

  dispose(): void {
    this.stop();
    this.worker?.terminate();
    this.worker = null;
    this.readyPromise = null;
    this.listeners.clear();
    this.progressListeners.clear();
    this.searching = false;
  }
}
