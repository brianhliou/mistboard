import type { Color, GameEvent, GameSpecId, GameState, Move } from '@mistboard/game';

export type EngineKind = 'builtin' | 'typescript-bundle' | 'wasm' | 'container';

/**
 * The fixed set of engine ids known to this worker. Every registry entry is
 * keyed by one of these, every id literal (defaults, the prod-playable set,
 * fallback ids) is checked against this union at compile time — so a typo or a
 * dropped entry fails `tsc`, not just a runtime `loadEngine` throw. External
 * ids (DB rows, client requests, env overrides) stay `string` until validated
 * through the registry.
 */
export type EngineId =
  // builtin (in-process TypeScript)
  | 'builtin-capture-seeker'
  | 'builtin-random-legal'
  // python-subprocess (dark chess + variant Misty builds)
  | 'python-tier1-v0.9.5'
  | 'python-tier1-current'
  | 'python-v2-current'
  | 'python-v2-strongest'
  | 'python-v2-faithful'
  | 'python-v2-kingsafe'
  | 'python-v2-adaptive'
  | 'python-v2-nocarry'
  | 'python-v2-v1.0'
  | 'python-v2-v1.1'
  | 'python-v2-v1.2'
  | 'python-v2-v1.3'
  | 'python-v2-v1.4'
  | 'python-v2-v1.5'
  | 'python-v2-v1.6'
  | 'python-dmx-v1.0'
  | 'python-fdx-v1.0'
  | 'python-fdx-v1.1'
  | 'python-fdx-v1.2'
  | 'python-tier1-v0.9.1'
  | 'python-tier1-v0.8.9'
  | 'python-tier1-v0.7.22'
  | 'python-tier1-v0.7.0'
  | 'python-random-legal'
  // Fairy-Stockfish (standard Xiangqi human-strength profiles)
  | `fairy-stockfish-xiangqi-level-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`
  // Uniformly-random legal-move xiangqi bot (calibration floor / 0-Elo anchor)
  | 'random-legal-xiangqi'
  // Pikafish (Jieqi)
  | 'pikafish-jieqi-amateur'
  | 'pikafish-jieqi-strong'
  | 'pikafish-jieqi-strongest'
  // Pikafish (standard Xiangqi)
  | `pikafish-xiangqi-level-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`
  | 'pikafish-xiangqi-amateur'
  | 'pikafish-xiangqi-strong'
  | 'pikafish-xiangqi-strongest'
  // MistyBanqi (Banqi)
  | 'misty-banqi'
  | 'misty-banqi-amateur'
  | 'misty-banqi-strong'
  | 'misty-banqi-strongest'
  // Fairy-Stockfish (Mini Xiangqi)
  | 'fairy-stockfish-mini-xiangqi-amateur'
  | 'fairy-stockfish-mini-xiangqi-strong'
  | 'fairy-stockfish-mini-xiangqi-very-strong'
  // MistyJungleFlip (Flip Jungle)
  | 'misty-jungle-flip';

/**
 * A seat's client id that denotes a registered engine. Superset of `EngineId`
 * with the legacy `'random-engine'` alias the picker still resolves to the
 * default engine. This is the narrowing target of the engine-client-id guards.
 */
export type EngineClientId = EngineId | 'random-engine';

export type EngineMoveContext = {
  baseThinkTimeMs?: number;
  clockRemainingMs?: number;
  engineReservationId?: string;
  events?: GameEvent[];
  state: GameState;
  color: Color;
  incrementMs?: number;
  legalMoves: Move[];
  roomId?: string;
  seed: bigint;
  ply: number;
};

export type EngineMoveScore = {
  move: Move;
  score: number;
  reason: string;
};

export type EngineMoveDecision = {
  move: Move;
  scores: EngineMoveScore[];
  thinkTimeMs?: number;
  // Opaque per-move engine telemetry (e.g. v2 belief size, GT-CFR iters, full
  // move ranking) for the live-engine-decision debug artifact. Optional;
  // non-remote engines don't set it.
  diagnostics?: Record<string, unknown>;
};

export type EngineLivePolicy = {
  timeoutMs?: number;
  fallbackEngineId?: EngineId | null;
};

/**
 * Discriminated union over `config.kind` — the runtime family discriminator
 * (distinct from `EngineDefinition.kind`, which is the deploy shape). Only
 * `.kind` is read in TypeScript (to route the move to the python worker vs the
 * in-process path); the remaining fields are catalog metadata serialized into
 * `engine_versions.config` and kept in sync with the engine-side tiers. Each
 * distinct config shape is a named member so the fields can no longer be
 * silently misspelled or cross-contaminated.
 */
export type EngineConfigKind =
  | 'builtin'
  | 'python-subprocess'
  | 'fairy-stockfish'
  | 'pikafish'
  | 'pikafish-xiangqi'
  | 'banqi-uci'
  | 'jungle-flip-uci';

/** In-process TypeScript baseline engines (capture-seeker, random-legal). */
export type BuiltinEngineConfig = {
  kind: 'builtin';
  strategy: string;
  version: number;
};

/**
 * Python-worker engines (dark chess + variant Misty builds). `config` /
 * `config_hash` / `engine_pin` are absent on the bare random-legal baseline;
 * `version` is numeric there and a semver-ish string elsewhere.
 */
export type PythonSubprocessEngineConfig = {
  kind: 'python-subprocess';
  strategy: string;
  version: string | number;
  config?: string;
  config_hash?: string;
  engine_pin?: string;
};

/** Fairy-Stockfish UCI engines (Mini Xiangqi, Xiangqi ladder). */
export type FairyStockfishEngineConfig = {
  kind: 'fairy-stockfish';
  skill: number;
  movetime_ms: number;
  depth?: number;
  nodes?: number;
  hash_mb?: number;
  /** NNUE net file name when the rung runs a net; absent means classical eval. */
  nnue?: string;
};

/** Pikafish jieqi UCI engines. `depth` is uncapped (absent) on the top tier. */
export type PikafishEngineConfig = {
  kind: 'pikafish';
  movetime_ms: number;
  depth?: number;
};

/** Mainline Pikafish standard-Xiangqi tiers, reproducibly limited by nodes. */
export type PikafishXiangqiEngineConfig = {
  kind: 'pikafish-xiangqi';
  nodes: number;
  movetime_ms: number;
  version: string;
};

/**
 * MistyBanqi standalone Rust αβ+TT UCI engine tiers. `nodes` is the strength
 * dial and `movetime_ms` the latency cap, matching `BanqiEngineTier`. `nodes`
 * is absent on the three RETIRED tiers (amateur/strong/strongest), which really
 * were movetime-only searches before the 2026-06-18 collapse to one
 * node-budgeted bot — those entries describe what actually ran and must stay
 * movetime-only.
 */
export type BanqiUciEngineConfig = {
  kind: 'banqi-uci';
  movetime_ms: number;
  nodes?: number;
};

/** MistyJungleFlip standalone Rust αβ+Star1+TT UCI engine. */
export type JungleFlipUciEngineConfig = {
  kind: 'jungle-flip-uci';
  nodes: number;
  movetime_ms: number;
};

export type EngineConfig =
  | BuiltinEngineConfig
  | PythonSubprocessEngineConfig
  | FairyStockfishEngineConfig
  | PikafishEngineConfig
  | PikafishXiangqiEngineConfig
  | BanqiUciEngineConfig
  | JungleFlipUciEngineConfig;

export type EngineDefinition = {
  id: EngineId;
  engineId: string;
  engineName: string;
  name: string;
  kind: EngineKind;
  configHash: string;
  playSignature: string;
  config: EngineConfig;
  livePolicy?: EngineLivePolicy;
  notes?: string;
  /**
   * Game variant this engine plays (e.g. 'dark-mini-xiangqi'). Absent ⇒ dark
   * chess (the default). Drives the worker `--game` flag and the request's
   * gameSpecId so the engine interprets the right board geometry + piece set.
   */
  gameSpecId?: GameSpecId;
  chooseMove?: (context: EngineMoveContext) => EngineMoveDecision;
};
