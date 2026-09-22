// Client-side ("local") engine analysis for the review board, powered by the
// vendored Fairy-Stockfish WASM build (apps/web/public/engine/fairy-stockfish)
// for the xiangqi variants and chess. Standard xiangqi dispatches to Pikafish
// (pikafish-ceval.ts), jieqi to PikaJieQi, the Misty games to misty-ceval.ts;
// createCeval() at the bottom is the one place that decides.
//
// FSF-wasm is multi-threaded-only: it allocates a *shared* WebAssembly.Memory and
// THROWS when SharedArrayBuffer is unavailable, so the host document MUST be
// cross-origin isolated (COOP: same-origin + COEP). cevalSupported() gates on that;
// callers show a "reload to enable" affordance when it is false. Everything here is
// lazy — importing the module in a non-isolated page (or a test) does nothing until
// evaluate()/preloadEngine() is called.

// The ceval contract types live in ceval-types.ts (so the Misty backend can share them
// without a circular import); imported for local use and re-exported below for existing
// `from './ceval.js'` importers.
import type {
  CevalEffort,
  CevalHandle,
  CevalLine,
  CevalLoadProgress,
  CevalRequest,
  CevalUpdate,
  CevalVariant,
} from './ceval-types.js';
import { cevalSupportsInfinite, depthForEffort } from './ceval-types.js';
import { isMistyCevalVariant, MistyCeval, mistyEngineName } from './misty-ceval.js';
import { createMultiPvBurstCollector, createThrottledEmitter } from './multipv-burst.js';
import { isPikafishCevalVariant, PikafishCeval, pikafishEngineName } from './pikafish-ceval.js';
import { isPikaJieqiCevalVariant, PikaJieQiCeval, pikaJieqiEngineName } from './pikajieqi-ceval.js';
import { parseInfo } from './uci-info.js';

export { type InfoFields, parseInfo } from './uci-info.js';
export {
  type CevalEffort,
  type CevalHandle,
  type CevalLine,
  type CevalLoadProgress,
  type CevalRequest,
  type CevalUpdate,
  type CevalVariant,
  cevalSupportsInfinite,
  depthForEffort,
};

const ENGINE_BASE = '/engine/fairy-stockfish/';
// The vendored FSF assets live in public/ and are NOT content-hashed like the Vite
// bundle, so the CDN caches them by bare path for hours (max-age=14400) and a copy
// cached before a header/route change keeps serving stale. Every engine asset
// (script, wasm, AND the pthread worker) is versioned to force a fresh edge fetch
// on any change — critically the worker, which must carry its own COEP header to
// become cross-origin isolated; a stale header-less copy leaves it un-isolated and
// pthreads die. The worker loads its deps from a URL/blob the main thread posts to
// it (not from its own location), so a query on its URL is safe. Bump on any
// vendored-asset change (this CF config keys on the query string).
//
// The `-coepN` suffix is a cache-bust generation: a plain `1.1.11` had already
// been cached at the edge WITHOUT the COEP header (from a pre-fix request), so
// that key was poisoned. Bump the suffix to mint a fresh, never-cached key that
// fills from origin (which now always sends COEP) whenever the required response
// headers change.
const ENGINE_ASSET_VERSION = '1.1.12-atomic1';
const engineAsset = (file: string): string => `${ENGINE_BASE}${file}?v=${ENGINE_ASSET_VERSION}`;

/** Human label for the engine, shown in the analysis panel. */
export const CEVAL_ENGINE_NAME = 'Fairy-Stockfish';

/** The custom-variant definitions written into the engine at load. Atomic's
 *  four patch-only options (blastShape, blastImmuneTypes, cannonShotBlasts,
 *  lethalCheck) parse only on the patched build vendored here; see the README. */
const CUSTOM_VARIANT_INIS = ['fortress-xiangqi.ini', 'atomic-xiangqi.ini'] as const;

/** Whether the client engine for `variant` can run in this page. Fairy-Stockfish,
 *  Pikafish and PikaJieQi need SharedArrayBuffer (cross-origin isolation); the
 *  single-threaded Misty variants do not. Called with no argument, it reports
 *  the threaded-engine requirement for backward compatibility. */
export function cevalSupported(variant?: CevalVariant): boolean {
  if (variant && isMistyCevalVariant(variant)) return true;
  return (
    typeof SharedArrayBuffer === 'function' &&
    typeof crossOriginIsolated === 'boolean' &&
    crossOriginIsolated === true
  );
}

/** Human label for the engine backing `variant`. */
export function cevalEngineName(variant: CevalVariant): string {
  return (
    mistyEngineName(variant) ??
    pikafishEngineName(variant) ??
    pikaJieqiEngineName(variant) ??
    CEVAL_ENGINE_NAME
  );
}

// --- low-level engine (singleton) ---------------------------------------------

interface RawEngine {
  postMessage(cmd: string): void;
  addMessageListener(cb: (line: string) => void): void;
  FS: { writeFile(path: string, data: string | Uint8Array): void };
}

type StockfishFactory = (opts: { locateFile: (f: string) => string }) => Promise<RawEngine>;

declare global {
  // The classic engine script assigns this global (its UMD tail finds no
  // module/define in the browser, so it falls back to a global).
  // eslint-disable-next-line no-var
  var Stockfish: StockfishFactory | undefined;
}

class EngineCore {
  private listeners = new Set<(line: string) => void>();

  constructor(private raw: RawEngine) {
    raw.addMessageListener((line) => {
      for (const cb of [...this.listeners]) cb(line);
    });
  }

  send(cmd: string): void {
    this.raw.postMessage(cmd);
  }

  onLine(cb: (line: string) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  // Text for the Fortress .ini, bytes for the NNUE net.
  writeFile(path: string, data: string | Uint8Array): void {
    this.raw.FS.writeFile(path, data);
  }

  waitFor(pred: (line: string) => boolean): Promise<string> {
    return new Promise((resolve) => {
      const off = this.onLine((line) => {
        if (pred(line)) {
          off();
          resolve(line);
        }
      });
    });
  }
}

let enginePromise: Promise<EngineCore> | null = null;

function injectEngineScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector('script[data-fsf-engine]')) {
      resolve();
      return;
    }
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.dataset.fsfEngine = '1';
    el.addEventListener('load', () => resolve());
    el.addEventListener('error', () => reject(new Error('ceval: failed to load engine script')));
    document.head.appendChild(el);
  });
}

async function loadEngineCore(): Promise<EngineCore> {
  if (!cevalSupported()) {
    throw new Error('ceval_unsupported: page is not cross-origin isolated');
  }
  await injectEngineScript(engineAsset('stockfish.js'));
  const factory = globalThis.Stockfish;
  if (typeof factory !== 'function') {
    throw new Error('ceval: engine global missing after script load');
  }
  const raw = await factory({ locateFile: (f) => engineAsset(f) });
  const core = new EngineCore(raw);

  core.send('uci');
  await core.waitFor((line) => line === 'uciok');

  // Modest resources: leave a core for the UI, cap threads/hash for a review board.
  const cores = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 2) : 2;
  const threads = Math.max(1, Math.min(cores - 1, 8));
  core.send(`setoption name Threads value ${threads}`);
  core.send('setoption name Hash value 64');

  // Load our custom variants into the engine's in-memory FS. Standard xiangqi
  // is a Fairy-Stockfish built-in and needs no .ini. VariantPath names ONE
  // file, so the two stanzas are concatenated into it; each .ini is kept as a
  // separate file on disk because each is a mirror of a server-side original
  // (apps/server/src/*.ini) that is diffed against it.
  try {
    const inis = await Promise.all(
      CUSTOM_VARIANT_INIS.map((file) => fetch(`${ENGINE_BASE}${file}`).then((r) => r.text())),
    );
    core.writeFile('variants.ini', inis.join('\n\n'));
    core.send('setoption name VariantPath value variants.ini');
  } catch {
    // Custom-variant analysis will be unavailable, but xiangqi still works.
  }

  const ready = core.waitFor((line) => line === 'readyok');
  core.send('isready');
  await ready;
  return core;
}

/** Warm the engine up ahead of the first evaluate (script + wasm + variant load). */
export function preloadEngine(): Promise<void> {
  if (!enginePromise) enginePromise = loadEngineCore();
  return enginePromise.then(() => undefined);
}

function engine(): Promise<EngineCore> {
  if (!enginePromise) enginePromise = loadEngineCore();
  return enginePromise;
}

const EMIT_THROTTLE_MS = 80;

// --- public handle ------------------------------------------------------------

class Ceval implements CevalHandle {
  private token = 0;
  private currentOff: (() => void) | null = null;

  constructor(readonly variant: CevalVariant) {}

  preload(): Promise<void> {
    return preloadEngine();
  }

  async evaluate(req: CevalRequest): Promise<CevalUpdate> {
    const core = await engine();
    this.stop(); // supersede any in-flight search
    const myToken = ++this.token;
    const multiPv = req.multiPv ?? 1;
    const maxDepth = req.maxDepth ?? depthForEffort(req.effort);
    const infinite = req.maxDepth === undefined && req.effort === 'infinite';

    core.send('stop');
    core.send(`setoption name UCI_Variant value ${this.variant}`);
    // Every variant on this core (Fortress, Atomic, chess) runs the classical
    // evaluation; no net is shipped for them. Standard xiangqi, which ran here
    // on FSF's xiangqi net until 2026-09, now dispatches to Pikafish
    // (pikafish-ceval.ts), and the net went with it.
    core.send('setoption name Use NNUE value false');
    core.send(`setoption name MultiPV value ${multiPv}`);
    const base = req.initialFen ? `fen ${req.initialFen}` : 'startpos';
    core.send(
      req.movesUci.length ? `position ${base} moves ${req.movesUci.join(' ')}` : `position ${base}`,
    );

    // Lines render only as complete bursts (see multipv-burst.ts): the engine
    // re-prints every MultiPV line each time one PV finishes, and a snapshot
    // taken mid-burst pairs the new best line with its own stale copy.
    const bursts = createMultiPvBurstCollector(multiPv);
    let lines: CevalLine[] = [];
    let seldepth = 0;
    let nodes = 0;
    let nps = 0;
    let started = false;

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
      const off = core.onLine((line) => {
        if (this.token !== myToken || !started) return;
        if (line.startsWith('info ')) {
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
        } else if (line.startsWith('bestmove')) {
          off();
          if (this.currentOff === off) this.currentOff = null;
          emitter.cancel();
          const tail = bursts.flush();
          if (tail) lines = tail;
          const final = snapshot();
          req.onUpdate?.(final);
          resolve(final);
        }
      });
      this.currentOff = off;

      const ready = core.waitFor((line) => line === 'readyok');
      core.send('isready');
      void ready.then(() => {
        if (this.token !== myToken) return;
        started = true;
        core.send(infinite ? 'go infinite' : `go depth ${maxDepth}`);
      });
    });
  }

  stop(): void {
    this.token++; // supersede: in-flight listeners and pending emits bail
    if (this.currentOff) {
      this.currentOff();
      this.currentOff = null;
    }
    void engine()
      .then((core) => core.send('stop'))
      .catch(() => {});
  }

  dispose(): void {
    this.stop();
  }
}

export function createCeval(variant: CevalVariant): CevalHandle {
  if (isMistyCevalVariant(variant)) return new MistyCeval(variant);
  if (isPikafishCevalVariant(variant)) return new PikafishCeval(variant);
  if (isPikaJieqiCevalVariant(variant)) return new PikaJieQiCeval(variant);
  return new Ceval(variant);
}
