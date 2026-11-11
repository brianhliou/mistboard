/* tslint:disable */
/* eslint-disable */

/**
 * Stateful, incrementally advanced analysis for the browser's continuous mode.
 *
 * JavaScript calls `step` with bounded node slices and yields to the worker event loop
 * between calls. Dropping this object cancels the search without an unbounded wasm call.
 */
export class AnalysisSession {
    free(): void;
    [Symbol.dispose](): void;
    constructor(fen: string, multipv: number);
    /**
     * Set the game's no-capture-no-flip draw limit in plies (default 40). Call it before
     * the first `step`.
     */
    set_no_progress_limit(limit: number): void;
    step(nodes: number): string;
    readonly depth: number;
}

/**
 * Evaluate a redacted Banqi FEN and return the top-`multipv` legal moves as JSON,
 * ranked best-first, each with an exact side-to-move centipawn score.
 *
 * Returns `{"lines":[{"uci":"c1c1","cp":123,"depth":6},...]}` (a flip is `from==to`, e.g.
 * `"c1c1"`), or `{"error":"bad_fen"}` on a malformed FEN, or `{"lines":[]}` when there is
 * no legal move (terminal). `cp` is side-to-move POV (the browser normalizes to Red).
 */
export function analyze(fen: string, nodes: number, multipv: number): string;

/**
 * `analyze` under the game's no-capture-no-flip draw limit in plies (`analyze` uses 40).
 * Mistboard games created from 2026-10-17 draw at 60, older ones at 40.
 */
export function analyze_with_limit(fen: string, nodes: number, multipv: number, no_progress_limit: number): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_analysissession_free: (a: number, b: number) => void;
    readonly analysissession_depth: (a: number) => number;
    readonly analysissession_new: (a: number, b: number, c: number) => [number, number, number];
    readonly analysissession_set_no_progress_limit: (a: number, b: number) => void;
    readonly analysissession_step: (a: number, b: number) => [number, number];
    readonly analyze: (a: number, b: number, c: number, d: number) => [number, number];
    readonly analyze_with_limit: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
