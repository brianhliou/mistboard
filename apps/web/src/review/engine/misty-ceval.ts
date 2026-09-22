// Client-side ("local") engine analysis for the Misty family of Rust engines, compiled to
// WebAssembly: Banqi (MistyBanqi), Flip Jungle (MistyJungleFlip), and vanilla Jungle
// (MistyJungle). This is the second ceval backend — the Fairy-Stockfish one in ceval.ts
// drives xiangqi/fortress; this one drives the Rust-engine variants (the hidden-info flip
// ones AND perfect-info Jungle), which are Rust, not FSF. Both satisfy the same CevalHandle
// contract so the engine panel is backend-agnostic.
//
// Key differences from the FSF backend:
//  - SINGLE-THREADED wasm: no SharedArrayBuffer, so NO cross-origin isolation needed
//    (cevalSupported() is unconditionally true for these variants).
//  - NODE-BUDGETED: finite searches return one update. Continuous analysis advances a
//    stateful incremental session in bounded slices while retaining its TT and
//    move-ordering state.
//  - FEN-per-position, not moves-from-startpos: a flip variant's position is fed as a
//    redacted FEN (face-down tiles as X); the panel supplies initialFen, movesUci is empty.
import type {
  CevalEffort,
  CevalHandle,
  CevalLine,
  CevalRequest,
  CevalUpdate,
  CevalVariant,
} from './ceval-types.js';

// Vendored wasm assets live in public/ (like the FSF build) and are cache-busted by this
// version query. The worker's own imports are unversioned (bare path), so the main thread
// posts the versioned URLs in `init` — bump this on any vendored-asset change to mint fresh
// edge cache keys for the worker script, the JS glue, AND the wasm.
// -coep1: the 0.2.4-2 keys were edge-cached before the server started sending
// COEP/CORP on /engine/<pkg>/ assets (2026-07-16); fresh keys pick the headers up.
// -tiger-jump: the misty-jungle wasm was rebuilt with the tiger's sideways river jump
// (#430, 2026-09-21); a cached old wasm would analyse a different game than the bot plays.
const MISTY_ASSET_VERSION = '0.2.6-tiger-jump';

interface MistyEngineConfig {
  /** Public base path of the vendored wasm build. */
  base: string;
  /** wasm-pack module basename (`<name>.js` + `<name>_bg.wasm`) under `base`. */
  moduleName: string;
  /** Human label shown in the panel. */
  engineName: string;
  /** Product effort → node budget. Misty searches by nodes rather than a fixed depth. */
  nodesForEffort: Record<Exclude<CevalEffort, 'infinite'>, number>;
}

const MISTY_EFFORT_NODES: Record<Exclude<CevalEffort, 'infinite'>, number> = {
  quick: 360_000,
  standard: 2_000_000,
  deep: 10_000_000,
  max: 20_000_000,
};
const CONTINUOUS_SLICE_NODES = 2_000_000;

const MISTY_CONFIGS: Record<string, MistyEngineConfig> = {
  banqi: {
    base: '/engine/misty-banqi/',
    moduleName: 'banqi_wasm',
    engineName: 'MistyBanqi',
    nodesForEffort: MISTY_EFFORT_NODES,
  },
  jungleflip: {
    base: '/engine/misty-jungle-flip/',
    moduleName: 'jungle_flip_wasm',
    engineName: 'MistyJungleFlip',
    nodesForEffort: MISTY_EFFORT_NODES,
  },
  jungle: {
    base: '/engine/misty-jungle/',
    moduleName: 'jungle_wasm',
    engineName: 'MistyJungle',
    nodesForEffort: MISTY_EFFORT_NODES,
  },
};

/** Variants served by a Misty wasm backend (vs the FSF backend in ceval.ts). */
export function isMistyCevalVariant(variant: CevalVariant): boolean {
  return variant === 'banqi' || variant === 'jungleflip' || variant === 'jungle';
}

export function mistyEngineName(variant: CevalVariant): string | null {
  return MISTY_CONFIGS[variant]?.engineName ?? null;
}

interface PendingAnalyze {
  resolve: (json: string) => void;
  reject: (err: Error) => void;
}

/** A CevalHandle backed by a Misty wasm engine running in a dedicated module worker. */
export class MistyCeval implements CevalHandle {
  private worker: Worker | null = null;
  private readyPromise: Promise<void> | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingAnalyze>();
  private token = 0;
  private nextSessionId = 1;
  private activeSessionId: number | null = null;
  private readonly config: MistyEngineConfig;

  constructor(readonly variant: CevalVariant) {
    const config = MISTY_CONFIGS[variant];
    if (!config) throw new Error(`misty-ceval: no config for variant ${variant}`);
    this.config = config;
  }

  /** Spin up the worker and initialize the wasm (idempotent). */
  preload(): Promise<void> {
    if (!this.readyPromise) this.readyPromise = this.spawn();
    return this.readyPromise;
  }

  private spawn(): Promise<void> {
    const v = MISTY_ASSET_VERSION;
    const worker = new Worker(`${this.config.base}worker.js?v=${v}`, { type: 'module' });
    this.worker = worker;
    worker.onmessage = (event: MessageEvent) => this.onMessage(event.data);
    return new Promise<void>((resolve, reject) => {
      const onReady = (event: MessageEvent) => {
        const msg = event.data;
        if (msg?.type === 'ready') {
          worker.removeEventListener('message', onReady);
          resolve();
        } else if (msg?.type === 'error' && msg.id === undefined) {
          worker.removeEventListener('message', onReady);
          reject(new Error(msg.error ?? 'misty-ceval: worker init failed'));
        }
      };
      worker.addEventListener('message', onReady);
      worker.onerror = (e) => reject(new Error(`misty-ceval: worker error: ${e.message}`));
      worker.postMessage({
        type: 'init',
        jsUrl: `${this.config.base}${this.config.moduleName}.js?v=${v}`,
        wasmUrl: `${this.config.base}${this.config.moduleName}_bg.wasm?v=${v}`,
      });
    });
  }

  private onMessage(msg: { type: string; id?: number; json?: string; error?: string }): void {
    if (msg.id === undefined) return; // init-phase messages handled in spawn()
    const entry = this.pending.get(msg.id);
    if (!entry) return;
    this.pending.delete(msg.id);
    if (msg.type === 'result' && typeof msg.json === 'string') entry.resolve(msg.json);
    else entry.reject(new Error(msg.error ?? 'misty-ceval: analyze failed'));
  }

  async evaluate(req: CevalRequest): Promise<CevalUpdate> {
    await this.preload();
    const myToken = ++this.token; // supersede any in-flight evaluate
    const fen = req.initialFen;
    if (!fen) {
      // Misty engines are FEN-per-position; a caller must supply the redacted FEN.
      throw new Error('misty-ceval: initialFen required (flip variants have no startpos)');
    }
    const multiPv = req.multiPv ?? 1;
    const effort = req.effort ?? 'standard';
    const nodes =
      req.maxDepth !== undefined
        ? Math.max(80_000, req.maxDepth * 20_000)
        : this.config.nodesForEffort[effort === 'infinite' ? 'standard' : effort];
    if (effort === 'infinite') {
      return await this.evaluateContinuous(req, fen, multiPv, myToken);
    }
    const json = await this.send(fen, nodes, multiPv);
    if (this.token !== myToken) {
      // A newer evaluate superseded us; return an empty update rather than stale lines.
      return { depth: 0, seldepth: 0, nodes: 0, nps: 0, lines: [] };
    }
    const update = parseMistyUpdate(json, nodes);
    req.onUpdate?.(update);
    return update;
  }

  private async evaluateContinuous(
    req: CevalRequest,
    fen: string,
    multiPv: number,
    token: number,
  ): Promise<CevalUpdate> {
    const sessionId = this.nextSessionId++;
    this.activeSessionId = sessionId;
    let reset = true;
    let latest: CevalUpdate = {
      depth: 0,
      seldepth: 0,
      nodes: 0,
      nps: 0,
      lines: [],
    };
    try {
      while (this.token === token) {
        const json = await this.sendStep(
          sessionId,
          reset ? fen : undefined,
          CONTINUOUS_SLICE_NODES,
          multiPv,
        );
        reset = false;
        if (this.token !== token) break;
        latest = parseMistyUpdate(json, latest.nodes + CONTINUOUS_SLICE_NODES);
        req.onUpdate?.(latest);
      }
      return this.token === token ? latest : { ...latest, lines: [] };
    } finally {
      this.worker?.postMessage({ type: 'cancel', sessionId });
      if (this.activeSessionId === sessionId) this.activeSessionId = null;
    }
  }

  private send(fen: string, nodes: number, multipv: number): Promise<string> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error('misty-ceval: worker not ready'));
    const id = this.nextId++;
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ type: 'analyze', id, fen, nodes, multipv });
    });
  }

  private sendStep(
    sessionId: number,
    fen: string | undefined,
    nodes: number,
    multipv: number,
  ): Promise<string> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error('misty-ceval: worker not ready'));
    const id = this.nextId++;
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ type: 'step', id, sessionId, fen, nodes, multipv });
    });
  }

  stop(): void {
    // A wasm slice is synchronous inside the worker, so cancellation takes effect at the
    // next bounded slice boundary. The token suppresses any stale result in the meantime.
    this.token++;
    if (this.activeSessionId !== null) {
      this.worker?.postMessage({ type: 'cancel', sessionId: this.activeSessionId });
      this.activeSessionId = null;
    }
  }

  dispose(): void {
    this.stop();
    this.worker?.terminate();
    this.worker = null;
    this.readyPromise = null;
    for (const entry of this.pending.values()) {
      entry.reject(new Error('misty-ceval: disposed'));
    }
    this.pending.clear();
  }
}

/** Parse the worker's `{"lines":[{uci,cp,depth}]}` JSON into a single-shot CevalUpdate. */
export function parseMistyUpdate(json: string, nodeBudget: number): CevalUpdate {
  let parsed: {
    nodes?: number;
    lines?: Array<{ uci: string; cp: number; depth: number }>;
    error?: string;
  };
  try {
    parsed = JSON.parse(json);
  } catch {
    return { depth: 0, seldepth: 0, nodes: 0, nps: 0, lines: [] };
  }
  const rawLines = parsed.lines ?? [];
  const lines: CevalLine[] = rawLines.map((line, i) => ({
    multipv: i + 1,
    depth: line.depth,
    scoreCp: line.cp,
    mate: null,
    pvUci: [line.uci],
  }));
  const depth = lines[0]?.depth ?? 0;
  return { depth, seldepth: depth, nodes: parsed.nodes ?? nodeBudget, nps: 0, lines };
}
