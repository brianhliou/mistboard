// Fairy-Stockfish move provider for Atomic Xiangqi (9x10 xiangqi, a capture is
// an explosion).
//
// FSF plays it from a custom variants.ini (atomic-xiangqi.ini) on a PATCHED
// binary, and the patch is not optional: stock Fairy-Stockfish has atomic's
// blast in chess's eight-neighbour shape only, cannot exempt a piece type from
// it, cannot make a cannon's shot take only its target, and does not know the
// lethal-check reading of the perpetual-check law. The build (railpack) is
// gated on perft(1) against this .ini at three positions, each the kernel's own
// count, so the gate asserts agreement with the rules the server enforces
// rather than merely that the binary runs. See fairy-stockfish-atomic-xiangqi.ref.
//
// Structurally this mirrors the Duck Xiangqi provider (per-tier warm FSF
// session, node+skill tiers, custom variant via VariantPath). Engine ids follow
// the Fairy-Stockfish naming (fairy-stockfish-atomic-xiangqi-*); public bot
// identities live in first-party-bots.ts, separate from the executable engine id.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  resolveFsfVariantIniPath,
  splitFairyStockfishCommands,
  UciEnginePool,
  UciEngineSession,
  type UciEval,
  UciWarmSessionCache,
} from './uci-engine-harness.js';

const VARIANT = 'atomicxiangqi';
const VARIANT_INI = 'atomic-xiangqi.ini';

// Uniformly-random legal mover: the calibration floor / 0-Elo anchor for the
// atomic ladder. EvE-only, never in ATOMIC_XIANGQI_PLAYABLE_ENGINES.
export const ATOMIC_XIANGQI_RANDOM_ENGINE_ID = 'random-legal-atomic-xiangqi';
export const ATOMIC_XIANGQI_RANDOM_ENGINE_VERSION = 'random-legal-v1';

export const ATOMIC_XIANGQI_DEFAULT_ENGINE_ID = 'fairy-stockfish-atomic-xiangqi-level-4';

// Engine BUILD version recorded per PvE game. Bump on any engine/config change
// (the .ini, the tier table, the pinned ref, or the patch).
// 0.1.0: first live ladder, eight node-anchored classical rungs on the patched
//        atomic binary with the cannon-shot rules (lab fingerprint 045a5cf08c06),
//        warm sessions, ratings not yet published.
export const ATOMIC_XIANGQI_FSF_ENGINE_VERSION = '0.1.0';

/**
 * Short form of the Fairy-Stockfish commit prod builds for this provider. MUST
 * be a prefix of the first line of fairy-stockfish-atomic-xiangqi.ref;
 * atomic-xiangqi-fsf-engine-ref.test.ts fails the build if the two drift. The
 * ref alone does not identify this engine: the binary is that commit PLUS
 * fairy-stockfish-atomic-xiangqi.patch, and ATOMIC_XIANGQI_FSF_PATCH_SHA256
 * pins the other half.
 */
export const ATOMIC_XIANGQI_FSF_ENGINE_REF = '1b5bdd40';

/** sha256 of fairy-stockfish-atomic-xiangqi.patch, the second half of this
 *  engine's build identity. */
export const ATOMIC_XIANGQI_FSF_PATCH_SHA256 =
  '6a1b34042380437efc0e220e7f86b29e4d92b9f5b96784860f86ded4f24250aa';

export type AtomicXiangqiEngineTier = {
  id: string;
  name: string;
  /** Stockfish `Skill Level` (-20..20); 20 is full strength. */
  skill: number;
  /** Node budget: the CPU-independent strength anchor for this rung. */
  nodes: number;
  /** Latency ceiling handed to the clock-aware allocator, not a fixed think. */
  movetimeMs: number;
};

// Eight rungs on the same skill ladder as the other FSF bots, node-anchored so
// a rung plays the same game on a laptop and on prod's slower vCPU. The root
// branching factor is xiangqi's (~44), so the budgets are the fortress
// ladder's rather than duck's: the lab measured ~1.0-1.4M nps on this binary
// on an M-series laptop, so the 1M-node top rung is ~1 s here and an estimated
// ~3 s on prod, under the 6 s ceiling. NO NNUE: the only xiangqi net shipped is
// a standard-xiangqi net and it does not describe a game where captures
// explode, so every rung runs the classical eval, forced explicitly.
const ATOMIC_XIANGQI_ENGINE_TIERS = [
  {
    id: 'fairy-stockfish-atomic-xiangqi-level-1',
    name: 'Fairy-Stockfish Level 1',
    skill: -9,
    nodes: 5_000,
    movetimeMs: 300,
  },
  {
    id: 'fairy-stockfish-atomic-xiangqi-level-2',
    name: 'Fairy-Stockfish Level 2',
    skill: -5,
    nodes: 10_000,
    movetimeMs: 300,
  },
  {
    id: 'fairy-stockfish-atomic-xiangqi-level-3',
    name: 'Fairy-Stockfish Level 3',
    skill: -1,
    nodes: 20_000,
    movetimeMs: 400,
  },
  {
    id: ATOMIC_XIANGQI_DEFAULT_ENGINE_ID,
    name: 'Fairy-Stockfish Level 4',
    skill: 3,
    nodes: 40_000,
    movetimeMs: 600,
  },
  {
    id: 'fairy-stockfish-atomic-xiangqi-level-5',
    name: 'Fairy-Stockfish Level 5',
    skill: 8,
    nodes: 80_000,
    movetimeMs: 900,
  },
  {
    id: 'fairy-stockfish-atomic-xiangqi-level-6',
    name: 'Fairy-Stockfish Level 6',
    skill: 12,
    nodes: 160_000,
    movetimeMs: 2_000,
  },
  {
    id: 'fairy-stockfish-atomic-xiangqi-level-7',
    name: 'Fairy-Stockfish Level 7',
    skill: 16,
    nodes: 400_000,
    movetimeMs: 3_500,
  },
  {
    id: 'fairy-stockfish-atomic-xiangqi-level-8',
    name: 'Fairy-Stockfish Level 8',
    skill: 20,
    nodes: 1_000_000,
    movetimeMs: 6_000,
  },
] as const satisfies readonly AtomicXiangqiEngineTier[];

export const ATOMIC_XIANGQI_PLAYABLE_ENGINES: readonly AtomicXiangqiEngineTier[] =
  ATOMIC_XIANGQI_ENGINE_TIERS;

const ATOMIC_XIANGQI_ENGINE_BY_ID: ReadonlyMap<string, AtomicXiangqiEngineTier> = new Map(
  ATOMIC_XIANGQI_ENGINE_TIERS.map((engine) => [engine.id, engine]),
);

const fsfPool = new UciEnginePool({
  name: 'atomic-xiangqi-fsf',
  maxProcessesEnvVar: 'MISTBOARD_ATOMIC_XIANGQI_FSF_MAX_PROCESSES',
  queueTimeoutEnvVar: 'MISTBOARD_ATOMIC_XIANGQI_FSF_QUEUE_TIMEOUT_MS',
  queueTimeoutMessage: 'atomic-xiangqi fsf concurrency queue timed out',
});

const warmSessions = new UciWarmSessionCache({ name: 'atomic-xiangqi-fsf' });

// Dedicated ANALYSIS pool (the xiangqi #168 pattern): a whole-game sweep holds
// one persistent engine process for its full duration. On the live pool that
// would pin a live-move slot for minutes and queue live bot moves into the
// queue timeout; a separate pool makes the isolation structural. One slot by
// default (analysis is a batch workload) and a generous queue timeout so queued
// sweep jobs wait instead of shedding.
const analysisPool = new UciEnginePool({
  name: 'atomic-xiangqi-fsf-analysis',
  maxProcessesEnvVar: 'MISTBOARD_ATOMIC_XIANGQI_FSF_ANALYSIS_MAX_PROCESSES',
  queueTimeoutEnvVar: 'MISTBOARD_ATOMIC_XIANGQI_FSF_ANALYSIS_QUEUE_TIMEOUT_MS',
  defaultMaxProcesses: 1,
  defaultQueueTimeoutMs: 30_000,
  queueTimeoutMessage: 'atomic-xiangqi analysis queue timed out',
});

export function atomicXiangqiFsfWarmSessionStats() {
  return warmSessions.stats();
}

export function atomicXiangqiEngineTierFor(
  engineId: string | undefined,
): AtomicXiangqiEngineTier | null {
  if (!engineId) return null;
  return ATOMIC_XIANGQI_ENGINE_BY_ID.get(engineId) ?? null;
}

export function atomicXiangqiEngineDisplayName(engineId: string): string {
  return atomicXiangqiEngineTierFor(engineId)?.name ?? engineId;
}

export function isAtomicXiangqiEngineClientId(clientId: string | undefined): boolean {
  return atomicXiangqiEngineTierFor(clientId) !== null;
}

export function atomicXiangqiEngineVersion(clientId: string | undefined): string | null {
  return isAtomicXiangqiEngineClientId(clientId) ? ATOMIC_XIANGQI_FSF_ENGINE_VERSION : null;
}

export function atomicXiangqiVariantIniPath(): string {
  return resolveFsfVariantIniPath(VARIANT_INI);
}

/**
 * Resolve the Atomic Xiangqi FSF binary: explicit env override, else the
 * railpack-built `/app/bin/fairy-stockfish-atomic-xiangqi` (or its cwd-relative
 * dev twin). Throws when none exist. Deliberately NO fallback to the shared
 * `fairyStockfishPath()`: stock FSF would not be a weaker engine here, it
 * would play a different game (chess-shaped blasts, cannon shots that clear
 * a rank), and engine-boot-check.ts reports a missing binary as missing.
 */
export function atomicXiangqiFsfPath(): string {
  const explicit = process.env.MISTBOARD_FSF_ATOMIC_XIANGQI_PATH;
  if (explicit) {
    const resolved = resolve(explicit);
    if (!existsSync(resolved)) {
      throw new Error(
        `MISTBOARD_FSF_ATOMIC_XIANGQI_PATH points at ${resolved} but the binary does not exist`,
      );
    }
    return resolved;
  }
  for (const candidate of [
    resolve(process.cwd(), 'bin', 'fairy-stockfish-atomic-xiangqi'),
    '/app/bin/fairy-stockfish-atomic-xiangqi',
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    'Atomic Xiangqi Fairy-Stockfish binary not found (looked for bin/fairy-stockfish-atomic-xiangqi ' +
      'and /app/bin/fairy-stockfish-atomic-xiangqi). Set MISTBOARD_FSF_ATOMIC_XIANGQI_PATH. The ' +
      'shared Fairy-Stockfish build is NOT a substitute: it plays a different game.',
  );
}

/**
 * Resolve the engine tier, take a concurrency slot, and ask FSF for a move given
 * the move history from the start position (plain `<from><to>` UCI, a1-i10, no
 * rank shift). Returns the whole search summary so the per-move decision
 * artifact can record what the search consumed against the rung's budget.
 */
export async function atomicXiangqiLiveEngineMove(
  engineId: string,
  moves: string[],
  opts: { movetimeMs?: number } = {},
): Promise<UciEval> {
  const tier = atomicXiangqiEngineTierFor(engineId);
  if (!tier) throw new Error(`unknown Atomic Xiangqi engine: ${engineId}`);
  const release = await fsfPool.acquire();
  try {
    const bin = atomicXiangqiFsfPath();
    const movetimeMs = opts.movetimeMs ?? tier.movetimeMs;
    const { init, position, go } = splitFairyStockfishCommands({
      moves,
      variant: VARIANT,
      iniPath: atomicXiangqiVariantIniPath(),
      skill: tier.skill,
      nodes: tier.nodes,
      // Explicit, not inherited: the build is nnue=yes and the only net in the
      // image is a standard-xiangqi net. Forcing classical is the output gate.
      eval: 'classical',
      movetimeMs,
    });
    // Warm session per tier (`init` is the cache key, so tiers never share a
    // process). The from-source binary takes seconds to start in the prod
    // container, which a spawn-per-move loop would charge to the bot's clock.
    return await warmSessions.withSession(
      { bin, initCommands: init, name: `atomic-xiangqi-fsf:${tier.id}` },
      (session) =>
        session.evalPosition({
          positionCommand: position,
          goCommand: go,
          timeoutMs: movetimeMs + 4000,
          timeoutMessage: 'atomic-xiangqi fsf move timed out',
        }),
    );
  } finally {
    release();
  }
}

// ── Whole-game analysis (fixed-depth eval, NOT the playable tier) ─────────────

/** Fixed-depth analysis eval, Red POV. Distinct from the playable move provider:
 *  full strength (no Skill Level / node cap), `go depth N`, and read the score.
 *  Classical eval, forced: the only net in the image describes a game where
 *  captures do not explode. */
export const ATOMIC_XIANGQI_ANALYSIS_DEPTH = 12;

// The cache engine_id for the analysis sweep. Deliberately NOT a playable tier
// id (those key on strength, which is irrelevant to a fixed-depth eval);
// version-suffixed so an engine/.ini/patch change invalidates the cached evals.
export const ATOMIC_XIANGQI_ANALYSIS_ENGINE_ID = `fairy-stockfish-atomic-xiangqi-analysis@${ATOMIC_XIANGQI_FSF_ENGINE_VERSION}`;

export type AtomicXiangqiPositionEval = {
  /** Centipawns from RED's POV (positive = Red better); null when mate is set. */
  cp: number | null;
  /** Signed moves-to-mate from RED's POV; null otherwise. */
  mate: number | null;
  /** Best move in FSF UCI, which is our own `<from><to>` spelling. */
  best: string | null;
  depth: number;
};

// Normalize a side-to-move UCI eval to RED's POV. Red moves first, so Black is
// to move after an odd number of plies; flip the sign then. `mate 0` (side-to-
// move already mated, or here: its general already blown up) cannot carry a
// sign, so encode it as a decisive cp for the other side.
function redPovEval(evaluation: UciEval, plyCount: number): AtomicXiangqiPositionEval {
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
 * Run `fn` with a position evaluator backed by ONE persistent patched
 * Fairy-Stockfish process: binary spawn + variant setup happen once for the
 * whole sweep, then each position is an incremental `position startpos moves
 * …` + `go depth N` round-trip. The evaluator normalises to RED's POV. Holds
 * one DEDICATED analysis-pool slot for the duration, so a sweep never competes
 * with live PvE moves; the session is always killed on the way out.
 */
export async function withAtomicXiangqiAnalysisSession<T>(
  fn: (evaluate: (moves: string[]) => Promise<AtomicXiangqiPositionEval>) => Promise<T>,
  opts: { depth?: number } = {},
): Promise<T> {
  const depth = Math.max(1, Math.floor(opts.depth ?? ATOMIC_XIANGQI_ANALYSIS_DEPTH));
  const release = await analysisPool.acquire();
  const session = new UciEngineSession({
    bin: atomicXiangqiFsfPath(),
    name: 'atomic-xiangqi-fsf-analysis',
    initCommands: [
      'uci',
      `setoption name VariantPath value ${atomicXiangqiVariantIniPath()}`,
      `setoption name UCI_Variant value ${VARIANT}`,
      'setoption name Use NNUE value false',
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
        timeoutMessage: 'atomic-xiangqi analysis eval timed out',
      });
      return redPovEval(evaluation, moves.length);
    });
  } finally {
    session.close();
    release();
  }
}
