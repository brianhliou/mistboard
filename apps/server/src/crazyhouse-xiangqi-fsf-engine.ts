// Fairy-Stockfish move provider for Crazyhouse Xiangqi (9x10 xiangqi, a
// captured piece joins the capturer's hand and may be dropped back).
//
// STOCK Fairy-Stockfish, no patch and no pin of its own: the variant is a
// custom variants.ini (crazyhouse-xiangqi.ini) over the built-in xiangqi, and
// the shared largeboard binary that `fairyStockfishPath()` resolves (prod's
// /app/bin/fairy-stockfish, the fortress ladder's) plays it identically to the
// lab reference. packages/game/src/fixtures/crazyhouse-xiangqi-parity.json ties
// the .ini to the game kernel: legal moves and perft-2 at 449 positions.
//
// Structurally this is the Atomic Xiangqi provider (warm FSF session per tier,
// node + skill rungs, classical eval forced) on the stock binary, with the
// Fortress ladder's tier table. Engine ids follow the Fairy-Stockfish naming
// (fairy-stockfish-crazyhouse-xiangqi-*); public bot identities live in
// first-party-bots.ts, separate from the executable engine id.

import {
  fairyStockfishPath,
  resolveFsfVariantIniPath,
  splitFairyStockfishCommands,
  UciEnginePool,
  UciEngineSession,
  type UciEval,
  UciWarmSessionCache,
} from './uci-engine-harness.js';

export const CRAZYHOUSE_XIANGQI_FSF_VARIANT = 'crazyhousexiangqi';
export const CRAZYHOUSE_XIANGQI_VARIANT_INI = 'crazyhouse-xiangqi.ini';

// Uniformly-random legal mover: the calibration floor / 0-Elo anchor for the
// ladder. EvE-only, never in CRAZYHOUSE_XIANGQI_PLAYABLE_ENGINES.
export const CRAZYHOUSE_XIANGQI_RANDOM_ENGINE_ID = 'random-legal-crazyhouse-xiangqi';
export const CRAZYHOUSE_XIANGQI_RANDOM_ENGINE_VERSION = 'random-legal-v1';

export const CRAZYHOUSE_XIANGQI_DEFAULT_ENGINE_ID = 'fairy-stockfish-crazyhouse-xiangqi-level-4';

// Engine BUILD version recorded per PvE game. Bump on any engine/config change
// (the .ini, the tier table, the stock binary the ladder runs on).
// 0.1.0: admin playtest ladder, the Fortress Xiangqi tier table unmeasured on
//        this variant, stock FSF, classical eval, warm sessions.
export const CRAZYHOUSE_XIANGQI_FSF_ENGINE_VERSION = '0.1.0';

export type CrazyhouseXiangqiEngineTier = {
  id: string;
  name: string;
  /** Stockfish `Skill Level` (-20..20); 20 is full strength. */
  skill: number;
  /** Node budget: the CPU-independent strength anchor for this rung. */
  nodes: number;
  /** Latency ceiling handed to the clock-aware allocator, not a fixed think. */
  movetimeMs: number;
};

// Eight rungs, copied from the Fortress Xiangqi ladder (the other drop variant
// on the stock binary). Not yet measured on this variant: the EvE adapter
// (crazyhouse-xiangqi-eve-adapter.ts) is what rates it. NO NNUE: the only
// xiangqi net describes a game without hands, so every rung runs the classical
// eval, forced explicitly.
const CRAZYHOUSE_XIANGQI_ENGINE_TIERS = [
  {
    id: 'fairy-stockfish-crazyhouse-xiangqi-level-1',
    name: 'Fairy-Stockfish Level 1',
    skill: -9,
    nodes: 3_000,
    movetimeMs: 300,
  },
  {
    id: 'fairy-stockfish-crazyhouse-xiangqi-level-2',
    name: 'Fairy-Stockfish Level 2',
    skill: -5,
    nodes: 6_000,
    movetimeMs: 300,
  },
  {
    id: 'fairy-stockfish-crazyhouse-xiangqi-level-3',
    name: 'Fairy-Stockfish Level 3',
    skill: -1,
    nodes: 12_000,
    movetimeMs: 400,
  },
  {
    id: CRAZYHOUSE_XIANGQI_DEFAULT_ENGINE_ID,
    name: 'Fairy-Stockfish Level 4',
    skill: 3,
    nodes: 25_000,
    movetimeMs: 500,
  },
  {
    id: 'fairy-stockfish-crazyhouse-xiangqi-level-5',
    name: 'Fairy-Stockfish Level 5',
    skill: 8,
    nodes: 60_000,
    movetimeMs: 800,
  },
  {
    id: 'fairy-stockfish-crazyhouse-xiangqi-level-6',
    name: 'Fairy-Stockfish Level 6',
    skill: 12,
    nodes: 150_000,
    movetimeMs: 1_500,
  },
  {
    id: 'fairy-stockfish-crazyhouse-xiangqi-level-7',
    name: 'Fairy-Stockfish Level 7',
    skill: 16,
    nodes: 350_000,
    movetimeMs: 3_000,
  },
  {
    id: 'fairy-stockfish-crazyhouse-xiangqi-level-8',
    name: 'Fairy-Stockfish Level 8',
    skill: 20,
    nodes: 800_000,
    movetimeMs: 6_000,
  },
] as const satisfies readonly CrazyhouseXiangqiEngineTier[];

export const CRAZYHOUSE_XIANGQI_PLAYABLE_ENGINES: readonly CrazyhouseXiangqiEngineTier[] =
  CRAZYHOUSE_XIANGQI_ENGINE_TIERS;

const CRAZYHOUSE_XIANGQI_ENGINE_BY_ID: ReadonlyMap<string, CrazyhouseXiangqiEngineTier> = new Map(
  CRAZYHOUSE_XIANGQI_ENGINE_TIERS.map((engine) => [engine.id, engine]),
);

const fsfPool = new UciEnginePool({
  name: 'crazyhouse-xiangqi-fsf',
  maxProcessesEnvVar: 'MISTBOARD_CRAZYHOUSE_XIANGQI_FSF_MAX_PROCESSES',
  queueTimeoutEnvVar: 'MISTBOARD_CRAZYHOUSE_XIANGQI_FSF_QUEUE_TIMEOUT_MS',
  queueTimeoutMessage: 'crazyhouse-xiangqi fsf concurrency queue timed out',
});

const warmSessions = new UciWarmSessionCache({ name: 'crazyhouse-xiangqi-fsf' });

// Dedicated ANALYSIS pool (the xiangqi #168 pattern): a whole-game sweep holds
// one persistent engine process for its full duration, so it must not pin a
// live-move slot. One slot by default and a generous queue timeout so queued
// sweep jobs wait instead of shedding.
const analysisPool = new UciEnginePool({
  name: 'crazyhouse-xiangqi-fsf-analysis',
  maxProcessesEnvVar: 'MISTBOARD_CRAZYHOUSE_XIANGQI_FSF_ANALYSIS_MAX_PROCESSES',
  queueTimeoutEnvVar: 'MISTBOARD_CRAZYHOUSE_XIANGQI_FSF_ANALYSIS_QUEUE_TIMEOUT_MS',
  defaultMaxProcesses: 1,
  defaultQueueTimeoutMs: 30_000,
  queueTimeoutMessage: 'crazyhouse-xiangqi analysis queue timed out',
});

export function crazyhouseXiangqiFsfWarmSessionStats() {
  return warmSessions.stats();
}

export function crazyhouseXiangqiEngineTierFor(
  engineId: string | undefined,
): CrazyhouseXiangqiEngineTier | null {
  if (!engineId) return null;
  return CRAZYHOUSE_XIANGQI_ENGINE_BY_ID.get(engineId) ?? null;
}

export function crazyhouseXiangqiEngineDisplayName(engineId: string): string {
  return crazyhouseXiangqiEngineTierFor(engineId)?.name ?? engineId;
}

export function isCrazyhouseXiangqiEngineClientId(clientId: string | undefined): boolean {
  return crazyhouseXiangqiEngineTierFor(clientId) !== null;
}

export function crazyhouseXiangqiEngineVersion(clientId: string | undefined): string | null {
  return isCrazyhouseXiangqiEngineClientId(clientId) ? CRAZYHOUSE_XIANGQI_FSF_ENGINE_VERSION : null;
}

export function crazyhouseXiangqiVariantIniPath(): string {
  return resolveFsfVariantIniPath(CRAZYHOUSE_XIANGQI_VARIANT_INI);
}

/**
 * Resolve the engine tier, take a concurrency slot, and ask FSF for a move given
 * the move history from the start position (board moves `<from><to>`, drops
 * `<L>@<to>`, a1-i10, no rank shift). Returns the whole search summary so the
 * per-move decision artifact can record what the search consumed against the
 * rung's budget.
 */
export async function crazyhouseXiangqiLiveEngineMove(
  engineId: string,
  moves: string[],
  opts: { movetimeMs?: number } = {},
): Promise<UciEval> {
  const tier = crazyhouseXiangqiEngineTierFor(engineId);
  if (!tier) throw new Error(`unknown Crazyhouse Xiangqi engine: ${engineId}`);
  const release = await fsfPool.acquire();
  try {
    const bin = fairyStockfishPath();
    const movetimeMs = opts.movetimeMs ?? tier.movetimeMs;
    const { init, position, go } = splitFairyStockfishCommands({
      moves,
      variant: CRAZYHOUSE_XIANGQI_FSF_VARIANT,
      iniPath: crazyhouseXiangqiVariantIniPath(),
      skill: tier.skill,
      nodes: tier.nodes,
      // Explicit, not inherited: a build that embeds a xiangqi net must not
      // evaluate a game with hands as if it had none.
      eval: 'classical',
      movetimeMs,
    });
    // Warm session per tier (`init` is the cache key, so tiers never share a
    // process): spawn + variant load once, then position/go per move.
    return await warmSessions.withSession(
      { bin, initCommands: init, name: `crazyhouse-xiangqi-fsf:${tier.id}` },
      (session) =>
        session.evalPosition({
          positionCommand: position,
          goCommand: go,
          timeoutMs: movetimeMs + 4000,
          timeoutMessage: 'crazyhouse-xiangqi fsf move timed out',
        }),
    );
  } finally {
    release();
  }
}

// ── Whole-game analysis (fixed-depth eval, NOT the playable tier) ─────────────

/** Fixed-depth analysis eval, Red POV. Distinct from the playable move provider:
 *  full strength (no Skill Level / node cap), `go depth N`, and read the score.
 *  Classical eval, forced, for the same reason as the ladder: the only xiangqi
 *  net describes a game without hands. */
export const CRAZYHOUSE_XIANGQI_ANALYSIS_DEPTH = 12;

// The cache engine_id for the analysis sweep. Deliberately NOT a playable tier
// id (those key on strength, irrelevant to a fixed-depth eval); version-suffixed
// so an engine/.ini change invalidates the cached evals.
export const CRAZYHOUSE_XIANGQI_ANALYSIS_ENGINE_ID = `fairy-stockfish-crazyhouse-xiangqi-analysis@${CRAZYHOUSE_XIANGQI_FSF_ENGINE_VERSION}`;

export type CrazyhouseXiangqiPositionEval = {
  /** Centipawns from RED's POV (positive = Red better); null when mate is set. */
  cp: number | null;
  /** Signed moves-to-mate from RED's POV; null otherwise. */
  mate: number | null;
  /** Best move in FSF UCI, the kernel's own spelling (`h3h10`, drops `N@e5`). */
  best: string | null;
  depth: number;
};

// Normalize a side-to-move UCI eval to RED's POV. Red moves first, so Black is
// to move after an odd number of plies; flip the sign then. `mate 0` (side-to-
// move already mated or stalemated, a loss here) cannot carry a sign, so encode
// it as a decisive cp for the other side.
function redPovEval(evaluation: UciEval, plyCount: number): CrazyhouseXiangqiPositionEval {
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

/** The UCI position command for the game after `moves`. The hands ride in the
 *  move list: the .ini's startFen carries both starting pockets and FSF moves
 *  every capture into the capturer's hand, so `startpos moves …` reaches the
 *  same pockets the kernel holds without a FEN. */
export function crazyhouseXiangqiAnalysisPositionCommand(moves: readonly string[]): string {
  return moves.length > 0 ? `position startpos moves ${moves.join(' ')}` : 'position startpos';
}

/**
 * Run `fn` with a position evaluator backed by ONE persistent stock
 * Fairy-Stockfish process: binary spawn + variant setup happen once for the
 * whole sweep, then each position is an incremental `position startpos moves
 * …` + `go depth N` round-trip. The evaluator normalises to RED's POV. Holds
 * one DEDICATED analysis-pool slot for the duration, so a sweep never competes
 * with live PvE moves; the session is always killed on the way out.
 */
export async function withCrazyhouseXiangqiAnalysisSession<T>(
  fn: (evaluate: (moves: string[]) => Promise<CrazyhouseXiangqiPositionEval>) => Promise<T>,
  opts: { depth?: number } = {},
): Promise<T> {
  const depth = Math.max(1, Math.floor(opts.depth ?? CRAZYHOUSE_XIANGQI_ANALYSIS_DEPTH));
  const release = await analysisPool.acquire();
  const session = new UciEngineSession({
    bin: fairyStockfishPath(),
    name: 'crazyhouse-xiangqi-fsf-analysis',
    initCommands: [
      'uci',
      `setoption name VariantPath value ${crazyhouseXiangqiVariantIniPath()}`,
      `setoption name UCI_Variant value ${CRAZYHOUSE_XIANGQI_FSF_VARIANT}`,
      'setoption name Use NNUE value false',
      'ucinewgame',
      'isready',
    ],
  });
  try {
    await session.ready();
    return await fn(async (moves) => {
      const evaluation = await session.evalPosition({
        positionCommand: crazyhouseXiangqiAnalysisPositionCommand(moves),
        goCommand: `go depth ${depth}`,
        timeoutMs: 20_000,
        timeoutMessage: 'crazyhouse-xiangqi analysis eval timed out',
      });
      return redPovEval(evaluation, moves.length);
    });
  } finally {
    session.close();
    release();
  }
}
