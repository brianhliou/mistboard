// Shared client-engine (ceval) contract types. Extracted from ceval.ts so both the
// Fairy-Stockfish backend (ceval.ts) and the Misty wasm backend (misty-ceval.ts) can
// depend on the interface without a circular import (ceval.ts value-imports MistyCeval;
// misty-ceval.ts would otherwise type-import back from ceval.ts). ceval.ts re-exports
// everything here, so existing `from './ceval.js'` importers are unaffected.

/** Variants a client engine can evaluate. `xiangqi` uses Pikafish,
 *  `fortressxiangqi`/`atomicxiangqi`/`chess` use Fairy-Stockfish, `jieqi` uses
 *  PikaJieQi, and the remaining variants use Misty. createCeval() dispatches to
 *  the appropriate backend. */
export type CevalVariant =
  | 'xiangqi'
  | 'fortressxiangqi'
  | 'atomicxiangqi'
  // Standard chess on Fairy-Stockfish's built-in variant, classical eval (no
  // net shipped): the study-only chess spec's review panel.
  | 'chess'
  | 'jieqi'
  | 'banqi'
  | 'jungleflip'
  | 'jungle';

/** Product-level analysis effort. Backends translate this into their native
 * control: UCI depth, a Misty node budget, or incremental continuous search. */
export type CevalEffort = 'quick' | 'standard' | 'deep' | 'max' | 'infinite';

const DEPTH_BY_EFFORT: Record<Exclude<CevalEffort, 'infinite'>, number> = {
  quick: 14,
  standard: 18,
  deep: 22,
  max: 26,
};

export function depthForEffort(effort: CevalEffort | undefined): number {
  if (!effort || effort === 'infinite') return DEPTH_BY_EFFORT.standard;
  return DEPTH_BY_EFFORT[effort];
}

/** Every registered client-engine backend implements cancellable continuous search. */
export function cevalSupportsInfinite(_variant: CevalVariant): boolean {
  return true;
}

export interface CevalLine {
  /** 1-based rank within MultiPV (1 = best). */
  multipv: number;
  depth: number;
  /** Integer score, side-to-move POV; centipawns for chess-family engines.
   *  Misty transports its normalized value as value * 1000. Null when `mate` is set. */
  scoreCp: number | null;
  /** Signed moves-to-mate, side-to-move POV; null otherwise. */
  mate: number | null;
  /** Principal variation, engine UCI. */
  pvUci: string[];
}

export interface CevalUpdate {
  depth: number;
  seldepth: number;
  nodes: number;
  nps: number;
  /** Lines sorted ascending by multipv. Scores are from the side-to-move POV. */
  lines: CevalLine[];
}

export interface CevalRequest {
  /** Move history from the base position, in engine UCI. */
  movesUci: string[];
  /** Base position as an engine FEN. Omit to analyse from the standard start
   *  position (the review board's whole-game replay); set it to analyse a
   *  mid-game position that has no start-position move list, e.g. a mined puzzle
   *  that begins partway through a game. `movesUci` are then applied on top. */
  initialFen?: string;
  /** Number of ranked lines to return (default 1). */
  multiPv?: number;
  /** Cap search depth; the engine streams shallower updates first (default 18). */
  maxDepth?: number;
  /** User-selected effort. `maxDepth` remains available for fixed-depth
   * programmatic sweeps and takes precedence when supplied. */
  effort?: CevalEffort;
  /** Progressive callback fired as depth increases (throttled). */
  onUpdate?: (update: CevalUpdate) => void;
}

/** Bytes of a large engine asset fetched so far (Pikafish's 51 MB net).
 *  `total` is 0 when the response carried no Content-Length. */
export interface CevalLoadProgress {
  loaded: number;
  total: number;
}

export interface CevalHandle {
  readonly variant: CevalVariant;
  /** Warm the engine ahead of the first evaluate (load + init). Idempotent.
   *  A backend with a large download reports it through `onProgress` until the
   *  promise settles; the others never call it. */
  preload(onProgress?: (progress: CevalLoadProgress) => void): Promise<void>;
  /** Evaluate a position; resolves with the deepest update reached. */
  evaluate(req: CevalRequest): Promise<CevalUpdate>;
  /** Halt the current search (the pending evaluate never resolves). */
  stop(): void;
  dispose(): void;
}
