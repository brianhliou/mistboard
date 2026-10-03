// Client-side Jieqi analysis powered by the classical-evaluation
// PikaJieQi WebAssembly build. The engine runs as a persistent UCI session in a
// dedicated worker and streams iterative-deepening MultiPV updates.
import type {
  CevalHandle,
  CevalLine,
  CevalRequest,
  CevalUpdate,
  CevalVariant,
} from './ceval-types.js';
import { depthForEffort } from './ceval-types.js';
import { createMultiPvBurstCollector, createThrottledEmitter } from './multipv-burst.js';
import { parseInfo } from './uci-info.js';

const ENGINE_BASE = '/engine/pikafish-jieqi/';
const ENGINE_ASSET_VERSION = 'bcc83f8-emsdk3174-coep1';
const engineAsset = (file: string): string => `${ENGINE_BASE}${file}?v=${ENGINE_ASSET_VERSION}`;
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
  | { type: 'line'; line: string }
  | { type: 'stderr'; line: string }
  | { type: 'error'; error?: string };

/** True only for the Jieqi backend. */
export function isPikaJieqiCevalVariant(variant: CevalVariant): boolean {
  return variant === 'jieqi';
}

export function pikaJieqiEngineName(variant: CevalVariant): string | null {
  return isPikaJieqiCevalVariant(variant) ? 'PikaJieQi' : null;
}

/** Persistent, streaming UCI client for the PikaJieQi worker. */
export class PikaJieQiCeval implements CevalHandle {
  private worker: Worker | null = null;
  private readyPromise: Promise<void> | null = null;
  private listeners = new Set<(line: string) => void>();
  private searching = false;
  private token = 0;

  constructor(readonly variant: CevalVariant) {
    if (!isPikaJieqiCevalVariant(variant)) {
      throw new Error(`pikajieqi-ceval: no config for variant ${variant}`);
    }
  }

  preload(): Promise<void> {
    if (!this.readyPromise) this.readyPromise = this.spawn();
    return this.readyPromise;
  }

  private async spawn(): Promise<void> {
    const worker = new Worker(engineAsset('worker.js'));
    this.worker = worker;
    worker.onmessage = (event: MessageEvent<EngineMessage>) => {
      const message = event.data;
      if (message.type === 'line') {
        if (message.line.startsWith('bestmove')) this.searching = false;
        for (const listener of [...this.listeners]) listener(message.line);
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
          reject(new Error(message.error ?? 'pikajieqi-ceval: worker init failed'));
        }
      };
      worker.addEventListener('message', onMessage);
      worker.onerror = (event) => {
        reject(new Error(`pikajieqi-ceval: worker error: ${event.message}`));
      };
      worker.postMessage({
        type: 'init',
        jsUrl: engineAsset('pikajieqi.js'),
        wasmUrl: engineAsset('pikajieqi.wasm'),
      });
    });

    const uciOk = this.waitFor((line) => line === 'uciok');
    this.send('uci');
    await uciOk;

    // Keep the branch default of one search thread. Changing Threads from
    // inside the dedicated worker blocks while Emscripten provisions another
    // pthread, so it can deadlock before `readyok`; the single thread still
    // searches comfortably above one million nodes/second in Chromium.
    this.send('setoption name Hash value 32');
    this.send('setoption name UCI_AnalyseMode value true');
    const ready = this.waitFor((line) => line === 'readyok');
    this.send('isready');
    await ready;
  }

  private send(command: string): void {
    if (!this.worker) throw new Error('pikajieqi-ceval: worker not ready');
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

    const fen = req.initialFen;
    if (!fen) {
      throw new Error('pikajieqi-ceval: initialFen required');
    }
    const multiPv = req.multiPv ?? 1;
    const maxDepth = req.maxDepth ?? depthForEffort(req.effort);
    const infinite = req.maxDepth === undefined && req.effort === 'infinite';
    this.send(`setoption name MultiPV value ${multiPv}`);
    this.send(
      req.movesUci.length
        ? `position fen ${fen} moves ${req.movesUci.join(' ')}`
        : `position fen ${fen}`,
    );

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
    this.searching = false;
  }
}
