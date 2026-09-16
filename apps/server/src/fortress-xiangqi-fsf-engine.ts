// Fairy-Stockfish move provider for Fortress Xiangqi (7x8, "xiangqi with a
// pocket").
//
// Fortress is perfect-information (opposite-corner-palace xiangqi + the Treasure
// + crazyhouse drops + the chasing rule). FSF plays it natively from a custom
// variants.ini (fortress-xiangqi.ini) that inherits the built-in `minixiangqi`
// and layers on the 8th rank, corner palaces, the elephant/advisor/Treasure
// pieces, both-side drops, and chasingRule=axf. The config is validated against
// the game kernel byte-for-byte on the legal-move set by
// scripts/variant-lab/fortress-xiangqi-fsf-play.ts (0 mismatches over 10k+
// positions).
//
// Mirrors the Drop Mini Xiangqi provider (per-request FSF process, node+skill
// tiers, custom variant via VariantPath). Engine ids follow the Fairy-Stockfish
// naming (fairy-stockfish-fortress-xiangqi-*); public bot identities live in
// bot_profiles, separate from the executable engine id.
//
// The process lifecycle (spawn/parse/timeout/kill + the concurrency pool) is the
// shared `uci-engine-harness`; this file is just the Fortress config + tiers.

import {
  fairyStockfishEval,
  fairyStockfishPath,
  resolveFsfVariantIniPath,
  runUciEval,
  UciEnginePool,
  UciEngineSession,
  type UciEval,
} from './uci-engine-harness.js';

const VARIANT = 'fortressxiangqi';
const VARIANT_INI = 'fortress-xiangqi.ini';

// Uniformly-random legal mover: the calibration floor / 0-Elo anchor for the
// fortress ladder. EvE-only, never in FORTRESS_XIANGQI_PLAYABLE_ENGINES.
export const FORTRESS_XIANGQI_RANDOM_ENGINE_ID = 'random-legal-fortress-xiangqi';
export const FORTRESS_XIANGQI_RANDOM_ENGINE_VERSION = 'random-legal-v1';

export const FORTRESS_XIANGQI_DEFAULT_ENGINE_ID = 'fairy-stockfish-fortress-xiangqi-level-4';
// Engine BUILD version recorded per PvE game. Bump on any engine/config change
// (including edits to fortress-xiangqi.ini).
// 0.2.0: clock-aware per-move budgeting (shared budgetForMove allocator) + raise
//        the Strongest movetime CEILING 2000->6000 so the 800k node budget binds
//        on the slow prod vCPU (~2.4s) instead of being cut short at 2s.
// 0.3.0: eight-level ladder (the xiangqi FSF level shape); the retired
//        amateur/strong/very-strong tiers stay resolvable as legacy tiers.
export const FORTRESS_XIANGQI_ENGINE_VERSION = '0.3.0';

export type FortressXiangqiEngineTier = {
  id: string;
  name: string;
  skill: number;
  nodes: number;
  movetimeMs: number;
};

// Level ladder mirrors the standard-xiangqi FSF bots: the SKILL values are the
// lichess/PlayStrategy level ladder (stochastic Skill Level), while strength is
// additionally pinned by a NODE budget (the fortress convention: reproducible
// across the slow prod vCPU) instead of xiangqi's depth caps. `movetimeMs` is
// the CEILING handed to the shared clock-aware allocator (budgetForMove) — NOT
// a fixed think; it only needs to be generous enough that the node budget binds
// on prod (~333k nps on the 7x8 board: 800k nodes ≈ 2.4s). Level 5 and Level 8
// reproduce the retired Strong/Strongest tiers exactly; Levels 1-2 sit below
// the retired Amateur tier so beginners finally get a beatable rung.
const FORTRESS_XIANGQI_ENGINE_TIERS = [
  {
    id: 'fairy-stockfish-fortress-xiangqi-level-1',
    name: 'Fairy-Stockfish Level 1',
    skill: -9,
    nodes: 3_000,
    movetimeMs: 300,
  },
  {
    id: 'fairy-stockfish-fortress-xiangqi-level-2',
    name: 'Fairy-Stockfish Level 2',
    skill: -5,
    nodes: 6_000,
    movetimeMs: 300,
  },
  {
    id: 'fairy-stockfish-fortress-xiangqi-level-3',
    name: 'Fairy-Stockfish Level 3',
    skill: -1,
    nodes: 12_000,
    movetimeMs: 400,
  },
  {
    id: FORTRESS_XIANGQI_DEFAULT_ENGINE_ID,
    name: 'Fairy-Stockfish Level 4',
    skill: 3,
    nodes: 25_000,
    movetimeMs: 500,
  },
  {
    id: 'fairy-stockfish-fortress-xiangqi-level-5',
    name: 'Fairy-Stockfish Level 5',
    skill: 8,
    nodes: 60_000,
    movetimeMs: 800,
  },
  {
    id: 'fairy-stockfish-fortress-xiangqi-level-6',
    name: 'Fairy-Stockfish Level 6',
    skill: 12,
    nodes: 150_000,
    movetimeMs: 1_500,
  },
  {
    id: 'fairy-stockfish-fortress-xiangqi-level-7',
    name: 'Fairy-Stockfish Level 7',
    skill: 16,
    nodes: 350_000,
    movetimeMs: 3_000,
  },
  {
    id: 'fairy-stockfish-fortress-xiangqi-level-8',
    name: 'Fairy-Stockfish Level 8',
    skill: 20,
    nodes: 800_000,
    // Ceiling, not fixed think: gives the 800k node budget room to bind on prod
    // (~2.4s) instead of a low cap cutting the search short.
    movetimeMs: 6_000,
  },
] as const satisfies readonly FortressXiangqiEngineTier[];

// Retired pre-ladder tiers. Kept resolvable with their exact playing parameters
// so old rooms/replays/postgame pages behave identically, but they are NOT in
// FORTRESS_XIANGQI_PLAYABLE_ENGINES, so pickers never offer them.
const FORTRESS_XIANGQI_LEGACY_ENGINE_TIERS = [
  {
    id: 'fairy-stockfish-fortress-xiangqi-amateur',
    name: 'Fairy Stockfish - Amateur',
    skill: 1,
    nodes: 6_000,
    movetimeMs: 300,
  },
  {
    id: 'fairy-stockfish-fortress-xiangqi-strong',
    name: 'Fairy Stockfish - Strong',
    skill: 8,
    nodes: 60_000,
    movetimeMs: 800,
  },
  {
    id: 'fairy-stockfish-fortress-xiangqi-very-strong',
    name: 'Fairy Stockfish - Strongest',
    skill: 20,
    nodes: 800_000,
    movetimeMs: 6_000,
  },
] as const satisfies readonly FortressXiangqiEngineTier[];

export const FORTRESS_XIANGQI_PLAYABLE_ENGINES: readonly FortressXiangqiEngineTier[] =
  FORTRESS_XIANGQI_ENGINE_TIERS;

const FORTRESS_XIANGQI_ENGINE_BY_ID: ReadonlyMap<string, FortressXiangqiEngineTier> = new Map(
  [...FORTRESS_XIANGQI_ENGINE_TIERS, ...FORTRESS_XIANGQI_LEGACY_ENGINE_TIERS].map((engine) => [
    engine.id,
    engine,
  ]),
);

// Small FSF slot pool, separate from the other variants. Promote to a shared
// pool only under real concurrent load.
const fsfPool = new UciEnginePool({
  name: 'fortress-xiangqi-fsf',
  maxProcessesEnvVar: 'MISTBOARD_FORTRESS_XIANGQI_FSF_MAX_PROCESSES',
  queueTimeoutEnvVar: 'MISTBOARD_FORTRESS_XIANGQI_FSF_QUEUE_TIMEOUT_MS',
  queueTimeoutMessage: 'fsf concurrency queue timed out',
});

// Dedicated ANALYSIS pool (the xiangqi #168 pattern): a whole-game sweep holds
// one persistent engine process for its full duration. On the shared live pool
// that would pin a live-move slot for minutes and queue live bot moves into the
// queue timeout; a separate pool makes the isolation structural. One slot by
// default (analysis is a batch workload) and a generous queue timeout so queued
// sweep jobs wait instead of shedding.
const analysisPool = new UciEnginePool({
  name: 'fortress-xiangqi-fsf-analysis',
  maxProcessesEnvVar: 'MISTBOARD_FORTRESS_XIANGQI_FSF_ANALYSIS_MAX_PROCESSES',
  queueTimeoutEnvVar: 'MISTBOARD_FORTRESS_XIANGQI_FSF_ANALYSIS_QUEUE_TIMEOUT_MS',
  defaultMaxProcesses: 1,
  defaultQueueTimeoutMs: 30_000,
  queueTimeoutMessage: 'fortress-xiangqi analysis queue timed out',
});

export function fortressXiangqiEngineTierFor(
  engineId: string | undefined,
): FortressXiangqiEngineTier | null {
  if (!engineId) return null;
  return FORTRESS_XIANGQI_ENGINE_BY_ID.get(engineId) ?? null;
}

export function fortressXiangqiEngineDisplayName(engineId: string): string {
  return fortressXiangqiEngineTierFor(engineId)?.name ?? engineId;
}

export function isFortressXiangqiEngineClientId(clientId: string | undefined): boolean {
  return fortressXiangqiEngineTierFor(clientId) !== null;
}

export function fortressXiangqiEngineVersion(clientId: string | undefined): string | null {
  return isFortressXiangqiEngineClientId(clientId) ? FORTRESS_XIANGQI_ENGINE_VERSION : null;
}

// fortress-xiangqi.ini lives in src/; tsc does not copy it to dist/, so look in
// both the tsx-dev (src) and built (dist -> ../src) locations.
export function fortressXiangqiVariantIniPath(): string {
  return resolveFsfVariantIniPath(VARIANT_INI);
}

export type FortressXiangqiEngineRequestOptions = {
  movetimeMs?: number;
  skill?: number;
  nodes?: number;
};

/**
 * Resolve the engine tier, take a concurrency slot, and ask FSF for a move given
 * the UCI move history from the start position. Returns the UCI move (board move
 * "b1b3" or drop "Q@d4") or null when there is no move.
 */
export async function fortressXiangqiLiveEngineMove(
  engineId: string,
  moves: string[],
  opts: { movetimeMs?: number } = {},
): Promise<UciEval> {
  const tier = fortressXiangqiEngineTierFor(engineId);
  if (!tier) throw new Error(`unknown Fortress Xiangqi engine: ${engineId}`);
  const release = await fsfPool.acquire();
  try {
    return await fortressXiangqiEngineSearch(moves, {
      skill: tier.skill,
      nodes: tier.nodes,
      movetimeMs: opts.movetimeMs ?? tier.movetimeMs,
    });
  } finally {
    release();
  }
}

export async function fortressXiangqiEngineMove(
  moves: string[],
  opts: FortressXiangqiEngineRequestOptions = {},
): Promise<string | null> {
  return (await fortressXiangqiEngineSearch(moves, opts)).best;
}

/**
 * The same move request, but returning the whole search summary rather than just
 * the move. Live play takes this one so the per-move decision artifact can record
 * what the search actually consumed (depth, nodes, time) next to the rung's node
 * budget and the movetime the server allotted. On this ladder the node budget is
 * the strength anchor, so nodes reached against nodes configured is the first
 * thing to read when a rung plays below its level.
 */
export function fortressXiangqiEngineSearch(
  moves: string[],
  opts: FortressXiangqiEngineRequestOptions = {},
): Promise<UciEval> {
  return fairyStockfishEval({
    moves,
    variant: VARIANT,
    iniPath: fortressXiangqiVariantIniPath(),
    skill: opts.skill,
    nodes: opts.nodes,
    movetimeMs: opts.movetimeMs ?? 800,
  });
}

// ── Whole-game analysis (fixed-depth eval, NOT the playable tier) ─────────────

/** Fixed-depth analysis eval, Red POV. Distinct from the playable move provider:
 *  full strength (no Skill Level / node cap), `go depth N`, and read the score. */
export const FORTRESS_XIANGQI_ANALYSIS_DEPTH = 12;

// The cache engine_id for the analysis sweep. Deliberately NOT a playable tier id
// (those key on strength, which is irrelevant to a fixed-depth eval); version-
// suffixed so an engine/.ini change invalidates the cached evals.
export const FORTRESS_XIANGQI_ANALYSIS_ENGINE_ID = `fairy-stockfish-fortress-xiangqi-analysis@${FORTRESS_XIANGQI_ENGINE_VERSION}`;

export type FortressXiangqiPositionEval = {
  /** Centipawns from RED's POV (positive = Red better); null when mate is set. */
  cp: number | null;
  /** Signed moves-to-mate from RED's POV; null otherwise. */
  mate: number | null;
  /** Best move in FSF UCI (already fortress coords; may be a drop like `Q@d4`). */
  best: string | null;
  depth: number;
};

// Normalize a side-to-move UCI eval to RED's POV. Red moves first, so Black is
// to move after an odd number of plies; flip the sign then. `mate 0` (side-to-
// move already mated) can't carry a sign, so encode it as a decisive cp for the
// other side.
function redPovEval(evaluation: UciEval, plyCount: number): FortressXiangqiPositionEval {
  const sign = plyCount % 2 === 0 ? 1 : -1;
  if (evaluation.mate === 0) {
    return { cp: sign * -30000, mate: null, best: evaluation.best, depth: evaluation.depth };
  }
  return {
    cp: evaluation.cp == null ? null : evaluation.cp * sign,
    mate: evaluation.mate == null ? null : evaluation.mate * sign,
    best: evaluation.best,
    depth: evaluation.depth,
  };
}

function positionCommand(moves: readonly string[]): string {
  return moves.length > 0 ? `position startpos moves ${moves.join(' ')}` : 'position startpos';
}

/**
 * Evaluate the fortress position after `moves` (FSF UCI) at a fixed depth, returning
 * the score from RED's POV. Mirrors evaluateXiangqiPosition (Pikafish) but drives
 * Fairy-Stockfish's custom fortressxiangqi variant. One spawn per call — fine for a
 * single position; whole-game sweeps must use withFortressXiangqiAnalysisSession
 * instead. Gated through fsfPool.
 */
export async function evaluateFortressXiangqiPosition(
  moves: string[],
  opts: { depth?: number } = {},
): Promise<FortressXiangqiPositionEval> {
  const depth = Math.max(1, Math.floor(opts.depth ?? FORTRESS_XIANGQI_ANALYSIS_DEPTH));
  const commands = [
    'uci',
    `setoption name VariantPath value ${fortressXiangqiVariantIniPath()}`,
    `setoption name UCI_Variant value ${VARIANT}`,
    'ucinewgame',
    'isready',
    positionCommand(moves),
    `go depth ${depth}`,
  ];
  const release = await fsfPool.acquire();
  try {
    const evaluation = await runUciEval({
      bin: fairyStockfishPath(),
      commands,
      timeoutMs: 20_000,
      timeoutMessage: 'fortress-xiangqi eval timed out',
    });
    return redPovEval(evaluation, moves.length);
  } finally {
    release();
  }
}

/**
 * Run `fn` with a position evaluator backed by ONE persistent Fairy-Stockfish
 * process (the xiangqi #168 pattern): binary spawn + variant/ini setup happen once
 * for the whole sweep, then each position is an incremental `position startpos
 * moves …` + `go depth N` round-trip — the EXACT go command the per-spawn path
 * used, so the eval semantics (and the versioned analysis engine id) are
 * unchanged. The evaluator normalises to RED's POV (same math as
 * evaluateFortressXiangqiPosition). Holds one DEDICATED analysis-pool slot for
 * the duration, so a sweep never competes with live PvE moves; the session is
 * always killed on the way out.
 */
export async function withFortressXiangqiAnalysisSession<T>(
  fn: (evaluate: (moves: string[]) => Promise<FortressXiangqiPositionEval>) => Promise<T>,
  opts: { depth?: number } = {},
): Promise<T> {
  const depth = Math.max(1, Math.floor(opts.depth ?? FORTRESS_XIANGQI_ANALYSIS_DEPTH));
  const release = await analysisPool.acquire();
  const session = new UciEngineSession({
    bin: fairyStockfishPath(),
    name: 'fortress-xiangqi-fsf-analysis',
    initCommands: [
      'uci',
      `setoption name VariantPath value ${fortressXiangqiVariantIniPath()}`,
      `setoption name UCI_Variant value ${VARIANT}`,
      'ucinewgame',
      'isready',
    ],
  });
  try {
    await session.ready();
    return await fn(async (moves) => {
      const evaluation = await session.evalPosition({
        positionCommand: positionCommand(moves),
        goCommand: `go depth ${depth}`,
        timeoutMs: 20_000,
        timeoutMessage: 'fortress-xiangqi analysis eval timed out',
      });
      return redPovEval(evaluation, moves.length);
    });
  } finally {
    session.close();
    release();
  }
}
