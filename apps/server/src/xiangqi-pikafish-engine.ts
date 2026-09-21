// Mainline Pikafish move provider for standard (open-information) Xiangqi PvE.
//
// Unlike Jieqi (which needs the `jieqi_old` fork + a redacted FEN) or Fortress
// (a Fairy-Stockfish custom variant), STANDARD xiangqi is exactly what mainline
// Pikafish plays natively — no fork, no variants.ini, no FEN redaction. We drive
// the stock binary as a UCI subprocess (the same Tier-B pattern as Jieqi/FSF),
// replaying the game as `position startpos moves ...` in Pikafish UCI coords.
//
// Coordinate note: our XiangqiSquare is `${file a-i}${rank 1-10}` (red back rank
// = rank 1). Pikafish UCI uses rank 0-9 (red back rank = rank 0), so the only
// translation is a rank-1 shift — see xiangqiMoveToPikafishUci. The process
// lifecycle (spawn/parse/timeout/kill + the concurrency pool) is the shared
// uci-engine-harness; this file is just the Pikafish config, tiers, and coords.
//
// Mainline Pikafish REQUIRES an NNUE net (EvalFile). It defaults to loading
// `pikafish.nnue` from the process CWD, which the server does not provide, so we
// always pass an absolute EvalFile resolved next to the binary (or via
// MISTBOARD_PIKAFISH_XIANGQI_NET). Net licensing: the shipped net is the
// official Pikafish NNUE (see NNUE-License in the pikafish distribution).

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  runUciEval,
  UciEnginePool,
  UciEngineSession,
  type UciEval,
  UciWarmSessionCache,
} from './uci-engine-harness.js';

// Xiangqi -> engine UCI now lives in @mistboard/game so the browser FSF-wasm
// analysis engine and this server Pikafish path share one converter. Re-exported
// under the historical names so existing importers are untouched.
export {
  xiangqiMoveToPikafishUci,
  xiangqiSquareToPikafishUci as xiangqiSquareToPikafish,
} from '@mistboard/game';

// Level 5 remains the public default selected by the expanded ladder.
export const XIANGQI_DEFAULT_ENGINE_ID = 'pikafish-xiangqi-level-5';
// Engine BUILD version recorded per PvE game (subject_id encodes only the tier).
// Bump on any engine/net/config change.
export const XIANGQI_ENGINE_VERSION = '0.3.0';

export type XiangqiEngineId =
  | `pikafish-xiangqi-level-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`
  | 'pikafish-xiangqi-amateur'
  | 'pikafish-xiangqi-strong'
  | 'pikafish-xiangqi-strongest';

export type XiangqiEngineTier = {
  id: XiangqiEngineId;
  name: string;
  // Mainline Pikafish does not expose Stockfish's `Skill Level` / `UCI_Elo`
  // options. The node budget is the only strength control; movetimeMs is the
  // latency ceiling handed to the clock-aware allocator (budgetForMove).
  nodes: number;
  movetimeMs: number;
};

// Eight node-budget rungs, ordered weakest first. The 2026-07-10 autoplay did
// establish monotonic ordering through L6, but it did NOT exercise the configured
// skill values: Pikafish rejected that unsupported option while the old harness
// ignored the diagnostic. Human-facing strength remains provisional pending the
// opening-diverse engine-league calibration.
const XIANGQI_ENGINE_TIERS = [
  {
    id: 'pikafish-xiangqi-level-1',
    name: 'Pikafish - Level 1',
    nodes: 1_000,
    movetimeMs: 300,
  },
  {
    id: 'pikafish-xiangqi-level-2',
    name: 'Pikafish - Level 2',
    nodes: 3_000,
    movetimeMs: 400,
  },
  {
    id: 'pikafish-xiangqi-level-3',
    name: 'Pikafish - Level 3',
    nodes: 10_000,
    movetimeMs: 500,
  },
  {
    id: 'pikafish-xiangqi-level-4',
    name: 'Pikafish - Level 4',
    nodes: 30_000,
    movetimeMs: 800,
  },
  {
    id: XIANGQI_DEFAULT_ENGINE_ID,
    name: 'Pikafish - Level 5',
    nodes: 100_000,
    movetimeMs: 1_200,
  },
  {
    id: 'pikafish-xiangqi-level-6',
    name: 'Pikafish - Level 6',
    nodes: 300_000,
    movetimeMs: 1_500,
  },
  {
    id: 'pikafish-xiangqi-level-7',
    name: 'Pikafish - Level 7',
    nodes: 1_000_000,
    movetimeMs: 2_500,
  },
  {
    id: 'pikafish-xiangqi-level-8',
    name: 'Pikafish',
    nodes: 3_000_000,
    movetimeMs: 4_000,
  },
] as const satisfies readonly XiangqiEngineTier[];

// Retired pre-ladder tiers (shipped 2026-07-04, replaced by the 8-level ladder).
// Live prod data still references these ids: finished PvE game records and
// replays, bot-profile engine attribution, and possibly in-flight rooms at
// deploy time. They stay resolvable by id (BY_ID below) with their original
// parameters so old rooms/replays/postgame pages behave identically, but they
// are NOT in XIANGQI_PLAYABLE_ENGINES, so the picker never offers them.
export const XIANGQI_LEGACY_ENGINE_TIERS = [
  {
    id: 'pikafish-xiangqi-amateur',
    name: 'Pikafish - Amateur',
    nodes: 20_000,
    movetimeMs: 400,
  },
  {
    id: 'pikafish-xiangqi-strong',
    name: 'Pikafish - Strong',
    nodes: 300_000,
    movetimeMs: 1_500,
  },
  {
    id: 'pikafish-xiangqi-strongest',
    name: 'Pikafish - Strongest',
    nodes: 3_000_000,
    movetimeMs: 4_000,
  },
] as const satisfies readonly XiangqiEngineTier[];

export const XIANGQI_PLAYABLE_ENGINES: readonly XiangqiEngineTier[] = XIANGQI_ENGINE_TIERS;
export const XIANGQI_ALL_ENGINE_TIERS: readonly XiangqiEngineTier[] = [
  ...XIANGQI_ENGINE_TIERS,
  ...XIANGQI_LEGACY_ENGINE_TIERS,
];

const XIANGQI_ENGINE_BY_ID: ReadonlyMap<string, XiangqiEngineTier> = new Map(
  XIANGQI_ALL_ENGINE_TIERS.map((engine) => [engine.id, engine]),
);

// Small per-process slot pool (Tier-B UCI subprocess; shared harness). Reuses the
// same env knobs as the Jieqi Pikafish pool. LIVE PvE moves only — analysis sweeps
// run on their own pool below so a whole-game sweep never starves a live bot move.
const enginePool = new UciEnginePool({
  name: 'pikafish-xiangqi',
  maxProcessesEnvVar: 'MISTBOARD_PIKAFISH_MAX_PROCESSES',
  queueTimeoutEnvVar: 'MISTBOARD_PIKAFISH_QUEUE_TIMEOUT_MS',
  queueTimeoutMessage: 'pikafish-xiangqi concurrency queue timed out',
});

// Dedicated ANALYSIS pool (#168): a whole-game sweep holds one persistent engine
// process for its full duration (up to minutes). On the shared live pool that
// pinned one of ~2 slots and queued live bot moves into the 5s queue timeout
// mid-game; a separate pool makes the isolation structural — analysis acquires
// can never occupy a live-move slot. One slot by default (analysis is a batch
// workload; parallel sweeps just fight for CPU), and a generous queue timeout so
// queued sweep jobs wait instead of shedding.
const analysisPool = new UciEnginePool({
  name: 'pikafish-xiangqi-analysis',
  maxProcessesEnvVar: 'MISTBOARD_PIKAFISH_ANALYSIS_MAX_PROCESSES',
  queueTimeoutEnvVar: 'MISTBOARD_PIKAFISH_ANALYSIS_QUEUE_TIMEOUT_MS',
  defaultMaxProcesses: 1,
  defaultQueueTimeoutMs: 30_000,
  queueTimeoutMessage: 'pikafish-xiangqi analysis queue timed out',
});

// Resolve the mainline Pikafish binary: explicit env override, else the known dev
// location, else the prod (railpack-baked) / system locations. Throws rather than
// silently falling back to a first-legal move.
export function pikafishXiangqiPath(): string {
  const explicit = process.env.MISTBOARD_PIKAFISH_XIANGQI_PATH;
  if (explicit) {
    const resolved = resolve(explicit);
    if (!existsSync(resolved)) {
      throw new Error(
        `MISTBOARD_PIKAFISH_XIANGQI_PATH points at ${resolved} but the binary does not exist`,
      );
    }
    return resolved;
  }
  const home = process.env.HOME;
  if (home) {
    const dev = resolve(
      home,
      'projects',
      'tools',
      'pikafish-official-2026-01-02',
      'MacOS',
      'pikafish-apple-silicon',
    );
    if (existsSync(dev)) return dev;
  }
  for (const candidate of [
    resolve(process.cwd(), 'bin', 'pikafish'),
    '/app/bin/pikafish',
    '/usr/local/bin/pikafish',
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    'mainline Pikafish (xiangqi) binary not found. Set MISTBOARD_PIKAFISH_XIANGQI_PATH.',
  );
}

// Resolve the NNUE net (absolute EvalFile). Explicit env override, else
// pikafish.nnue next to the binary (dev keeps it one level up from MacOS/, prod
// bakes it beside the binary), else beside the resolved binary dir.
export function pikafishXiangqiNetPath(binPath: string): string {
  const explicit = process.env.MISTBOARD_PIKAFISH_XIANGQI_NET;
  if (explicit) {
    const resolved = resolve(explicit);
    if (!existsSync(resolved)) {
      throw new Error(
        `MISTBOARD_PIKAFISH_XIANGQI_NET points at ${resolved} but the file does not exist`,
      );
    }
    return resolved;
  }
  const binDir = dirname(binPath);
  for (const candidate of [
    resolve(binDir, 'pikafish.nnue'),
    resolve(binDir, '..', 'pikafish.nnue'),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    'Pikafish NNUE net (pikafish.nnue) not found beside the binary. Set MISTBOARD_PIKAFISH_XIANGQI_NET.',
  );
}

export function xiangqiEngineTierFor(engineId: string | undefined): XiangqiEngineTier | null {
  if (!engineId) return null;
  return XIANGQI_ENGINE_BY_ID.get(engineId) ?? null;
}

export function xiangqiEngineDisplayName(engineId: string): string {
  return xiangqiEngineTierFor(engineId)?.name ?? engineId;
}

export function isXiangqiEngineClientId(clientId: string | undefined): boolean {
  return xiangqiEngineTierFor(clientId) !== null;
}

export function xiangqiEngineVersion(clientId: string | undefined): string | null {
  return isXiangqiEngineClientId(clientId) ? XIANGQI_ENGINE_VERSION : null;
}

export type XiangqiEngineOptions = { movetimeMs?: number };

/**
 * Ask mainline Pikafish for a move given the Pikafish-UCI move history since the
 * start position (built by the adapter via xiangqiMoveToPikafishUci). Returns the
 * search summary: `best` is the bestmove in Pikafish UCI (e.g. "b0c2") or null,
 * alongside the depth/nodes/time/score the live loop persists per move. The
 * history is server-built and trusted.
 */
export async function xiangqiLiveEngineMove(
  engineId: string,
  moves: string[],
  opts: XiangqiEngineOptions = {},
): Promise<UciEval> {
  const tier = xiangqiEngineTierFor(engineId);
  if (!tier) throw new Error(`unknown Xiangqi engine: ${engineId}`);
  const release = await enginePool.acquire();
  try {
    return await xiangqiEngineMove(moves, {
      nodes: tier.nodes,
      movetimeMs: opts.movetimeMs ?? tier.movetimeMs,
    });
  } finally {
    release();
  }
}

export function xiangqiEngineMove(
  moves: string[],
  opts: { nodes: number; movetimeMs: number },
): Promise<UciEval> {
  const bin = pikafishXiangqiPath();
  const net = pikafishXiangqiNetPath(bin);
  const nodes = Math.max(1, Math.floor(opts.nodes));
  const movetimeMs = Math.max(1, Math.floor(opts.movetimeMs));
  const position =
    moves.length > 0 ? `position startpos moves ${moves.join(' ')}` : 'position startpos';
  // Warm session: mainline Pikafish reloads its ~40 MB net on every spawn
  // (~2.8 s on prod, measured in the container 2026-09-02), which a
  // spawn-per-move loop charged to the bot's clock on every ply.
  return warmSessions.withSession(
    {
      bin,
      initCommands: ['uci', `setoption name EvalFile value ${net}`, 'ucinewgame', 'isready'],
      name: 'pikafish-xiangqi',
    },
    (session) =>
      session.evalPosition({
        positionCommand: position,
        // `go nodes N movetime T` halts at whichever binds first: the node budget
        // is the reproducible strength anchor; the movetime is the latency ceiling.
        goCommand: `go nodes ${nodes} movetime ${movetimeMs}`,
        timeoutMs: movetimeMs + 4000,
        timeoutMessage: 'pikafish-xiangqi move timed out',
      }),
  );
}

// Parked live-move engine processes; enginePool above still caps concurrency.
const warmSessions = new UciWarmSessionCache({ name: 'pikafish-xiangqi' });

/** Point-in-time warm-session counters (spawned/reused/idle) for diagnostics. */
export function pikafishXiangqiWarmSessionStats() {
  return warmSessions.stats();
}

/** Fixed analysis depth: comparable evals across every ply of a game (P3). */
export const XIANGQI_ANALYSIS_DEPTH = 18;

// Node budget per analysed position for the whole-game sweep (#168). A node
// budget gives uniform compute per position (no depth-parity sawtooth) and a
// CPU-independent, reproducible eval — the lichess/fishnet user-request tier is
// 1M nodes, which the persistent session makes affordable.
export const XIANGQI_ANALYSIS_NODES = 1_000_000;
// MultiPV width for the sweep. 2 is not a strength setting: it is what makes the
// runner-up move available so the `!` rule can ask "was there another move this
// good" (#315). Both lines come out of ONE search, so the gap between them is a
// real comparison; deriving the second line from a separate search would put
// search noise inside the threshold. Cost is a slightly shallower rank-1 PV at
// the same node budget.
export const XIANGQI_ANALYSIS_MULTI_PV = 2;
// Hard per-position wall-clock guard for a sweep eval. 1M nodes is normally a
// few seconds; this only fires when the engine wedges (then the session dies
// and the sweep fails closed rather than hanging the job). Scaled with the
// node budget: a 10M-node sweep (the depth a published board is checked at)
// legitimately takes 8-40s a position depending on what else is on the CPU,
// and a flat 30s guard failed five of them at once on 2026-09-20.
const XIANGQI_ANALYSIS_EVAL_TIMEOUT_MS = 30_000;
const analysisEvalTimeoutMs = (nodes: number) =>
  Math.max(XIANGQI_ANALYSIS_EVAL_TIMEOUT_MS, Math.ceil(nodes / 1_000_000) * XIANGQI_ANALYSIS_EVAL_TIMEOUT_MS);

export type XiangqiPositionEval = {
  /** Centipawns from RED's POV (positive = Red better); null when mate is set. */
  cp: number | null;
  /** Signed moves-to-mate from RED's POV; null otherwise. */
  mate: number | null;
  /** Engine best move (engine UCI) at this position. */
  best: string | null;
  /** Principal variation (engine UCI), capped — feeds the review's inline
   *  best-play lines. Absent when the engine emitted none. */
  pv?: string[];
  depth: number;
  /**
   * The SECOND-best root move at this position (MultiPV rank 2), Red POV, from
   * the SAME search as `cp`/`mate` — so the gap between them is a real
   * comparison rather than two searches differing by noise. Absent when the
   * search reported one line (terminal or single-legal-move positions), and on
   * every row cached before MultiPV 2 (analysis engine version <= 4).
   * Feeds the `!` rule's "was there another move this good" test (#315).
   */
  second?: { move: string; cp: number | null; mate: number | null };
};

/** Stored/served PV length cap. Raised 16 -> 32 on 2026-08-27: at the analysis
 *  budget Pikafish routinely reports 20-24 plies and reaches seldepth in the
 *  thirties, so 16 was cutting real line, and the review page then cut it again
 *  to 10. A refutation that stops eight moves in reads as the engine having
 *  nothing more to say. Cost is ~5 bytes/ply on the pv field only. */
const ANALYSIS_PV_MAX_PLIES = 32;

// Normalize a side-to-move UCI eval to RED's POV. Red moves first, so Black is
// to move after an odd number of plies; flip the sign then. `mate 0` = the side
// to move is already checkmated (a loss for them): 0 cannot carry the POV sign,
// so encode it as a decisive cp instead — otherwise the winner's mating move
// looks like it dropped to a loss.
function redPovSign(plyCount: number): 1 | -1 {
  return plyCount % 2 === 0 ? 1 : -1;
}

/** Flip one side-to-move score pair onto Red's POV. `mate 0` is the side to move
 *  being already checkmated; 0 cannot carry a sign, so encode it as decisive cp. */
function redPovScore(
  cp: number | null,
  mate: number | null,
  sign: 1 | -1,
): { cp: number | null; mate: number | null } {
  if (mate === 0) return { cp: sign * -30000, mate: null };
  return {
    cp: cp == null ? null : cp * sign,
    mate: mate == null ? null : mate * sign,
  };
}

function redPovEval(evaluation: UciEval, plyCount: number): XiangqiPositionEval {
  const sign = redPovSign(plyCount);
  const pv = evaluation.pv?.length ? evaluation.pv.slice(0, ANALYSIS_PV_MAX_PLIES) : undefined;
  const score = redPovScore(evaluation.cp, evaluation.mate, sign);
  return {
    cp: score.cp,
    mate: score.mate,
    best: evaluation.best,
    pv,
    depth: evaluation.depth,
  };
}

function positionCommand(moves: readonly string[]): string {
  return moves.length > 0 ? `position startpos moves ${moves.join(' ')}` : 'position startpos';
}

/**
 * Full-strength eval of ONE xiangqi position (P3), normalised to RED's POV so
 * the advantage chart and accuracy are coherent across a game. One spawn per
 * call (net reload included) — fine for a single position; whole-game sweeps
 * must use withXiangqiAnalysisSession instead. Concurrency is gated by the
 * shared live engine pool.
 */
export async function evaluateXiangqiPosition(
  moves: string[],
  opts: { depth?: number } = {},
): Promise<XiangqiPositionEval> {
  const bin = pikafishXiangqiPath();
  const net = pikafishXiangqiNetPath(bin);
  const depth = Math.max(1, Math.floor(opts.depth ?? XIANGQI_ANALYSIS_DEPTH));
  const commands = [
    'uci',
    `setoption name EvalFile value ${net}`,
    'ucinewgame',
    'isready',
    positionCommand(moves),
    `go depth ${depth}`,
  ];
  const release = await enginePool.acquire();
  try {
    const evaluation = await runUciEval({
      bin,
      commands,
      timeoutMs: 20_000,
      timeoutMessage: 'pikafish-xiangqi eval timed out',
    });
    return redPovEval(evaluation, moves.length);
  } finally {
    release();
  }
}

/**
 * Run `fn` with a position evaluator backed by ONE persistent Pikafish process
 * (#168): binary spawn, option setup, and the NNUE net load happen once for the
 * whole sweep, then each position is an incremental `position startpos moves …`
 * + `go nodes N` round-trip. The evaluator normalises to RED's POV (same math
 * as evaluateXiangqiPosition). Holds one DEDICATED analysis-pool slot for the
 * duration, so a sweep never competes with live PvE moves; the session is
 * always killed on the way out.
 */
export async function withXiangqiAnalysisSession<T>(
  fn: (evaluate: (moves: string[]) => Promise<XiangqiPositionEval>) => Promise<T>,
  opts: { nodes?: number; multiPv?: number } = {},
): Promise<T> {
  const bin = pikafishXiangqiPath();
  const net = pikafishXiangqiNetPath(bin);
  const nodes = Math.max(1, Math.floor(opts.nodes ?? XIANGQI_ANALYSIS_NODES));
  const multiPv = Math.max(1, Math.floor(opts.multiPv ?? XIANGQI_ANALYSIS_MULTI_PV));
  const release = await analysisPool.acquire();
  const session = new UciEngineSession({
    bin,
    name: 'pikafish-xiangqi-analysis',
    initCommands: [
      'uci',
      `setoption name EvalFile value ${net}`,
      `setoption name MultiPV value ${multiPv}`,
      'ucinewgame',
      'isready',
    ],
  });
  try {
    await session.ready();
    return await fn(async (moves) => {
      const evaluation = await session.multiPvPosition({
        positionCommand: positionCommand(moves),
        goCommand: `go nodes ${nodes}`,
        timeoutMs: analysisEvalTimeoutMs(nodes),
        timeoutMessage: 'pikafish-xiangqi analysis eval timed out',
      });
      const base = redPovEval(evaluation, moves.length);
      const runnerUp = evaluation.lines.find((line) => line.index === 2);
      if (!runnerUp) return base;
      const score = redPovScore(runnerUp.cp, runnerUp.mate, redPovSign(moves.length));
      return { ...base, second: { move: runnerUp.move, cp: score.cp, mate: score.mate } };
    });
  } finally {
    session.close();
    release();
  }
}
