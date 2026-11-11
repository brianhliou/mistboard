// MistyJungleFlip move provider for Flip Jungle (翻翻兽棋) PvE.
//
// The engine is our own `jungle-flip-engine` binary ("MistyJungleFlip", in
// ~/projects/mistboard-engine/jungle-flip-engine) — a standalone Rust αβ+Star1+TT
// engine driven as a UCI subprocess, the same Tier-B pattern as banqi/jieqi/xiangqi
// (NOT the fog engine-worker). Flip Jungle has hidden piece IDENTITIES the engine must
// not learn, so we hand it a redacted CURRENT-position FEN built by jungle-flip-fen.ts.
// One process per request (stateless, robust); promote to a persistent pool only under
// real load.
//
// L1–5 use classical root noise at a fixed depth; L6–7 use classical node
// budgets. L8 uses the private neural net only with an explicit readable EvalFile.
// A movetime cap bounds latency.
// Unlike banqi, the binary ignores
// trailing `moves` (the clock is carried in the FEN); game-history threefold context
// goes as a `reps` tail of positions already seen twice. Since v0.4.0 the binary also
// loads the ≤4 exact tablebase (WLD + distance-to-mate) that railpack downloads next to
// it, and scores wins by distance — it converts won endgames by the shortest forced
// line instead of shuffling a won position to the repetition draw.

import { randomInt } from 'node:crypto';
import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { EngineId } from './engines/types.js';
import { runUciEval, UciEnginePool, type UciEval } from './uci-engine-harness.js';

// Bump on every shipped eval/search change; the binary self-reports "MistyJungleFlip
// <version>" over UCI, and the engines registry records it (configHash) per game.
export const JUNGLE_FLIP_ENGINE_VERSION = '0.6.0';
export const JUNGLE_FLIP_DEFAULT_ENGINE_ID = 'misty-jungle-flip';
/** EvE-only uniformly random floor; never a player-facing level. */
export const JUNGLE_FLIP_RANDOM_ENGINE_ID = 'random-legal-jungle-flip';

export type JungleFlipEngineTier = {
  id: EngineId;
  level: number;
  name: string;
  version: string;
  // Strength is a NODE budget, not a time budget: `go nodes N` searches the same number
  // of positions on any CPU, so the bot plays the same strength regardless of how
  // slow/loaded the prod box is.
  nodes: number;
  // Latency cap (ms): `go nodes N movetime CAP` halts at whichever hits first, so a slow
  // box never exceeds CAP per move.
  movetimeCapMs: number;
  evaluation: 'classical' | 'nnue';
  noise?: number;
  noiseDepth?: number;
};

// Full-strength classical (now L7, the old L8) budget history. The 5s cap is the
// latency promise and does not move when introducing weaker levels.
//
// Budget resized 512K -> 2.5M (2026-09-06) to fix a budget-FIT defect, not to claim a
// strength gain. 512K left the ceiling almost entirely unspent: measured across 786 plies
// of 40 finished games over 8 weeks, p50 move cost was 217ms against a 5,000ms ceiling
// (4.3% utilisation; the highest single move ever recorded was 859ms). A work limit that
// cannot come close to its ceiling is the same defect that had fog xiangqi searching at
// 1.8% of budget.
//
// Sizing rule (the part 512K got wrong): a work budget must fit inside its ceiling at the
// SLOWEST throughput we are willing to tolerate, not the fastest we measured. Measured in
// the prod web container 2026-09-06 (48-core shared Railway host, `go nodes N movetime
// 300000` so the node budget always binds, wall clock around the whole UCI round-trip
// including spawn), sweeping 512K..4M nodes on opening / early / midgame / endgame FENs:
//
//   position class      throughput    cost @ 2.5M nodes    host loadavg
//   opening (16 dark)   ~8.2M nps       ~310ms             11.3-11.8
//   early (14 dark)     ~6.9M nps       ~370ms             11.3-11.8
//   midgame             ~2.4M nps       ~1,070ms           29-34
//   endgame (TB-heavy)  ~1.27M nps      ~1,930ms           30-34   <- worst
//
// Endgames are the slow class: <=4 pieces hits the on-disk tablebase, and 5-6 piece
// positions probe it constantly without ever resolving in one hit. Host load between
// loadavg 8 and loadavg 34 moved these numbers by under 8%, so the derate below is a
// tolerance, not an extrapolation of what was seen: a fixed search on this shared host has
// been observed to swing ~1.5x when it gets genuinely busy (loadavg 86), so the slowest
// throughput we accept is the worst measured class divided by 1.5.
//
//   slowest tolerated throughput = 1.27M nps / 1.5   = 0.85M nps
//   worst plausible cost @ 2.5M  = 2.5M / 0.85M nps  = 2,940ms
//   margin                       = 5,000ms / 2,940ms = 1.70x
//
// 1.7x is the target because ~2.2x against a BEST case is what 512K was sized with, and
// that still crossed its cap when the host got busy. Do not size by scaling the node count
// up by the utilisation ratio — that puts the median at the ceiling and the p99 well past it.
//
// NOT a claimed Elo gain: no self-play was run for this change. The strength evidence on
// record for this engine is the older 1M-beats-200K and 5M-beats-1M node ladders, which say
// more nodes has helped here before; it is not a measurement of 2.5M vs 512K. If a strength
// check is ever run and 2.5M does not beat 512K, the correct response is to lower this
// number, not to raise the cap.
// L1–5 measured vs random: +77, +174, +269, +388, +567 Elo (400 paired games
// each, #930). L6 is about +900; L7 is the old L8 at 2.5M nodes. Drop the 100K rung.
// L8's net runs at about 0.45x classical throughput: 1.0–1.3M vs 1.9–3.3M nps
// on an M-series Mac at 50K nodes. Derating prod's slowest tolerated classical
// 0.85M nps gives about 0.38M nps: 1M nodes takes about 2.6s worst case, a 1.9x
// margin under the 5s cap. Self-play measured +139 [+118, +161] Elo over classical
// at equal time and +119 at equal 2.5M nodes; the net is not yet rated on prod.
export const JUNGLE_FLIP_PLAYABLE_ENGINES: readonly JungleFlipEngineTier[] = (
  [1, 2, 3, 4, 5, 6, 7, 8] as const
).map(
  (level): JungleFlipEngineTier => ({
    id: level === 7 ? JUNGLE_FLIP_DEFAULT_ENGINE_ID : `misty-jungle-flip-level-${level}`,
    level,
    name: `MistyJungleFlip Level ${level}`,
    version: JUNGLE_FLIP_ENGINE_VERSION,
    nodes: level === 6 ? 2_000 : level === 8 ? 1_000_000 : 2_500_000,
    movetimeCapMs: 5000,
    evaluation: level === 8 ? 'nnue' : 'classical',
    ...(level <= 5
      ? {
          noise: [1, 0.3, 0.1, 0.02, 0.01][level - 1]!,
          noiseDepth: level === 1 ? 1 : level === 5 ? 4 : 2,
        }
      : {}),
  }),
);

const JUNGLE_FLIP_ENGINE_BY_ID: ReadonlyMap<string, JungleFlipEngineTier> = new Map<
  string,
  JungleFlipEngineTier
>([...JUNGLE_FLIP_PLAYABLE_ENGINES.map((tier): [string, JungleFlipEngineTier] => [tier.id, tier])]);

// Small per-process slot pool (Tier-B UCI subprocess; shared harness).
const enginePool = new UciEnginePool({
  name: 'jungle-flip',
  maxProcessesEnvVar: 'MISTBOARD_JUNGLE_FLIP_MAX_PROCESSES',
  queueTimeoutEnvVar: 'MISTBOARD_JUNGLE_FLIP_QUEUE_TIMEOUT_MS',
  queueTimeoutMessage: 'jungle-flip-engine concurrency queue timed out',
});

// Dedicated ANALYSIS pool: whole-game sweeps and decisions fan-outs acquire here,
// never from the live pool above, so analysis compute can never occupy a live
// bot-move slot (the queue-timeout starvation in #208/#168). Two slots match the
// decisions fan-out concurrency (see mapWithConcurrency call sites); the longer
// default queue timeout gives queued analysis evals headroom instead of shedding.
const analysisPool = new UciEnginePool({
  name: 'jungle-flip-analysis',
  maxProcessesEnvVar: 'MISTBOARD_JUNGLE_FLIP_ANALYSIS_MAX_PROCESSES',
  queueTimeoutEnvVar: 'MISTBOARD_JUNGLE_FLIP_ANALYSIS_QUEUE_TIMEOUT_MS',
  defaultMaxProcesses: 2,
  defaultQueueTimeoutMs: 30_000,
  queueTimeoutMessage: 'jungle-flip-engine analysis queue timed out',
});

// Resolve the MistyJungleFlip binary: explicit env override, else the dev build
// location, else the prod (railpack-compiled) / system locations.
export function jungleFlipEnginePath(): string {
  const explicit = process.env.MISTBOARD_JUNGLE_FLIP_ENGINE_PATH;
  if (explicit) {
    const resolved = resolve(explicit);
    if (!existsSync(resolved)) {
      throw new Error(
        `MISTBOARD_JUNGLE_FLIP_ENGINE_PATH points at ${resolved} but the binary does not exist`,
      );
    }
    return resolved;
  }
  const home = process.env.HOME;
  if (home) {
    const dev = resolve(
      home,
      'projects',
      'mistboard-engine',
      'jungle-flip-engine',
      'target',
      'release',
      'jungle-flip-engine',
    );
    if (existsSync(dev)) return dev;
  }
  for (const candidate of [
    resolve(process.cwd(), 'bin', 'jungle-flip-engine'),
    '/app/bin/jungle-flip-engine',
    '/usr/local/bin/jungle-flip-engine',
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    'MistyJungleFlip (jungle-flip) binary not found. Set MISTBOARD_JUNGLE_FLIP_ENGINE_PATH.',
  );
}

export function jungleFlipEngineTierFor(engineId: string | undefined): JungleFlipEngineTier | null {
  if (!engineId) return null;
  return JUNGLE_FLIP_ENGINE_BY_ID.get(engineId) ?? null;
}

function readableNetPath(path: string | undefined): string | null {
  if (!path) return null;
  const resolved = resolve(path);
  try {
    accessSync(resolved, constants.R_OK);
    const stat = statSync(resolved);
    return stat.isFile() && stat.size > 0 ? resolved : null;
  } catch {
    return null;
  }
}

/** No implicit net: L8 is held until an operator supplies its EvalFile. */
export function jungleFlipNetPath(): string | null {
  return readableNetPath(process.env.MISTBOARD_JUNGLE_FLIP_NET);
}

export function jungleFlipEngineAvailable(
  clientId: string = JUNGLE_FLIP_DEFAULT_ENGINE_ID,
): boolean {
  const tier = jungleFlipEngineTierFor(clientId);
  return (
    tier !== null &&
    jungleFlipEngineBinaryAvailable() &&
    (tier.evaluation !== 'nnue' || jungleFlipNetPath() !== null)
  );
}

// Presence check for the fail-closed analysis path: true when the binary resolves. The
// analysis route uses this to return 503 (not a silent weaker eval) when the build is
// missing the engine — mirrors jungleEngineBinaryAvailable().
export function jungleFlipEngineBinaryAvailable(): boolean {
  try {
    jungleFlipEnginePath();
    return true;
  } catch {
    return false;
  }
}

export function jungleFlipEngineDisplayName(engineId: string): string {
  if (engineId === JUNGLE_FLIP_DEFAULT_ENGINE_ID) return 'MistyJungleFlip';
  return jungleFlipEngineTierFor(engineId)?.name ?? engineId;
}

export function isJungleFlipEngineClientId(clientId: string | undefined): boolean {
  return jungleFlipEngineTierFor(clientId) !== null;
}

// Engine BUILD version recorded per PvE game (subject_id is version-less). Bump
// JUNGLE_FLIP_ENGINE_VERSION on each shipped eval/search change.
export function jungleFlipEngineVersion(clientId: string | undefined): string | null {
  return isJungleFlipEngineClientId(clientId) ? JUNGLE_FLIP_ENGINE_VERSION : null;
}

export type JungleFlipEngineOptions = {
  /** L8's net; omit to explicitly reset the engine to classical evaluation. */
  evalFile?: string;
  nodes?: number;
  movetimeCapMs?: number;
  noise?: number;
  noiseDepth?: number;
  // Redacted FENs of positions already seen twice this game (see jungleFlipRepSeedFens).
  // Appended as a trailing `reps` token so the engine's search scores a move that re-enters
  // one as a threefold draw. Older binaries ignore the trailing token (state_from_fen reads
  // only the leading FEN fields), so this is backward-compatible.
  repSeedFens?: readonly string[];
  // Decimal seed passed as `JF_TIE_SEED` to break exact-value root ties (mainly the opening
  // flip). Omit to let the binary self-seed from entropy (varied but non-reproducible). A
  // stable per-game value (see jungleFlipTieSeed) gives variety AND exact replay. Unknown to
  // pre-tie-break binaries, which ignore the env var. L1–5 also send this value
  // through the required UCI Seed option for reproducible root noise.
  tieSeed?: string;
};

/**
 * Deterministic per-game tie-break seed for the engine's `JF_TIE_SEED`, derived from the
 * (persisted) room id: tied choices vary across games yet replay exactly for a given game,
 * with no extra state to store. FNV-1a 64-bit as a decimal string; never "0" (the engine
 * reserves 0 as the "off"/legacy-deterministic sentinel).
 */
export function jungleFlipTieSeed(roomId: string): string {
  const mask = 0xffffffffffffffffn;
  const prime = 0x100000001b3n;
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < roomId.length; i++) {
    hash = ((hash ^ BigInt(roomId.charCodeAt(i))) * prime) & mask;
  }
  return (hash === 0n ? 1n : hash).toString();
}

/**
 * Build the UCI `position` command. A non-empty rep seed is appended as
 * `... reps <fen1>;<fen2>;...` (FENs contain spaces, so they are ';'-delimited). Kept pure
 * for unit testing the wire format.
 */
export function buildJungleFlipPositionCommand(
  fen: string,
  repSeedFens: readonly string[] = [],
): string {
  if (repSeedFens.length === 0) return `position fen ${fen}`;
  return `position fen ${fen} reps ${repSeedFens.join(';')}`;
}

/**
 * Ask MistyJungleFlip for a move given a redacted FEN (see jungle-flip-fen.ts). Returns
 * the engine's bestmove in engine UCI (rank 0..3, e.g. "a0b0", flip "a0a0") or null.
 * FEN is server-built/trusted.
 */
export async function jungleFlipLiveEngineMove(
  engineId: string,
  fen: string,
  opts: JungleFlipEngineOptions = {},
): Promise<UciEval> {
  const tier = jungleFlipEngineTierFor(engineId);
  if (!tier) throw new Error(`unknown Flip Jungle engine: ${engineId}`);
  const evalFile = tier.evaluation === 'nnue' ? jungleFlipNetPath() : null;
  if (tier.evaluation === 'nnue' && !evalFile) throw new Error('Flip Jungle net is not available');
  const release = await enginePool.acquire();
  try {
    if (evalFile !== null && !readableNetPath(evalFile)) {
      throw new Error('Flip Jungle net is not available');
    }
    return await jungleFlipEngineSearch(fen, {
      evalFile: evalFile ?? undefined,
      nodes: opts.nodes ?? tier.nodes,
      movetimeCapMs: opts.movetimeCapMs ?? tier.movetimeCapMs,
      repSeedFens: opts.repSeedFens,
      tieSeed: opts.tieSeed,
      noise: tier.noise,
      noiseDepth: tier.noiseDepth,
    });
  } finally {
    release();
  }
}

export async function jungleFlipEngineMove(
  fen: string,
  opts: JungleFlipEngineOptions = {},
): Promise<string | null> {
  return (await jungleFlipEngineSearch(fen, opts)).best;
}

/**
 * The same move request, but returning the whole search summary rather than just
 * the move. Live play takes this one so the per-move decision artifact can record
 * what the engine actually consumed (depth, nodes, time) next to the node budget
 * it was configured with. `opts.tieSeed` still travels as JF_TIE_SEED — runUciEval
 * honours `env` (it did not before this call site existed).
 */
export function jungleFlipEngineSearch(
  fen: string,
  opts: JungleFlipEngineOptions = {},
): Promise<UciEval> {
  return runUciEval(buildJungleFlipEngineRequest(fen, opts));
}

/** The complete subprocess request, built only from the caller's redacted FEN. */
export function buildJungleFlipEngineRequest(fen: string, opts: JungleFlipEngineOptions = {}) {
  const movetimeCapMs = opts.movetimeCapMs ?? 2500;
  const commands = buildJungleFlipEngineCommands(fen, opts);
  return {
    bin: jungleFlipEnginePath(),
    commands,
    timeoutMs: movetimeCapMs + 4000,
    timeoutMessage: 'jungle-flip-engine move timed out',
    env: opts.tieSeed ? { JF_TIE_SEED: opts.tieSeed } : undefined,
  };
}

/** Every search explicitly sets EvalFile, including classical requests on a reused process. */
export function buildJungleFlipEngineCommands(
  fen: string,
  opts: JungleFlipEngineOptions = {},
): string[] {
  const nodes = opts.nodes ?? 512_000;
  const movetimeCapMs = opts.movetimeCapMs ?? 2500;
  // Node budget = CPU-independent strength; movetime cap bounds latency (halt at
  // whichever first). The position carries the clock in the FEN plus an optional
  // `reps` seed (threefold game history) so the search adjudicates repetition draws.
  return [
    'uci',
    `setoption name EvalFile value ${opts.evalFile ?? ''}`,
    ...(opts.noise === undefined
      ? []
      : [
          `setoption name Noise value ${opts.noise}`,
          `setoption name NoiseDepth value ${opts.noiseDepth}`,
          `setoption name Seed value ${opts.tieSeed ?? randomInt(1, 0x7fffffff).toString()}`,
        ]),
    'ucinewgame',
    'isready',
    buildJungleFlipPositionCommand(fen, opts.repSeedFens),
    `go nodes ${nodes} movetime ${movetimeCapMs}`,
  ];
}

// Whole-game ANALYSIS eval (distinct from the playable move provider above): read the
// engine's `info … score` for a redacted current-position FEN, side-to-move POV. Same
// node-budget dial as play, so the eval is CPU-independent and reproducible — which keeps
// the cached analysis stable. Gated through the dedicated ANALYSIS pool so a sweep can
// never occupy a live bot-move slot. The caller supplies repeated-position seeds reconstructed
// from the game history; the redacted FENs keep hidden ids hidden.
export async function evaluateJungleFlipFenNodes(
  fen: string,
  opts: { nodes: number; movetimeCapMs: number; repSeedFens?: readonly string[] },
): Promise<UciEval> {
  const commands = buildJungleFlipEngineCommands(fen, opts);
  const release = await analysisPool.acquire();
  try {
    return await runUciEval({
      bin: jungleFlipEnginePath(),
      commands,
      timeoutMs: opts.movetimeCapMs + 4_000,
      timeoutMessage: 'jungle-flip-engine eval timed out',
    });
  } finally {
    release();
  }
}
