// MistyBanqi move provider for Banqi (半棋) PvE.
//
// The engine is our own `banqi-engine` binary ("MistyBanqi", in
// ~/projects/mistboard-engine/banqi-engine) — a standalone Rust αβ+Star1+TT engine
// driven as a UCI subprocess, the same Tier-B pattern as jieqi/xiangqi (NOT the
// fog engine-worker). Banqi has hidden piece IDENTITIES the engine must not learn, so
// we hand it a redacted CURRENT-position FEN built by banqi-fen.ts. One process per
// request (stateless, robust); promote to a persistent pool only under real load.
//
// Fixed-strength classical engine (no net). Strength is a NODE budget (positions searched),
// not a time budget — so the bot plays the same strength on any CPU (prod's slow shared vCPU
// was under-searching the old movetime tiers). A movetime cap bounds latency. One versioned
// bot (v0.2.0; was 3 difficulty tiers through 2026-06-18).

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { logger } from './obs.js';
import { runUciEval, UciEnginePool, type UciEval } from './uci-engine-harness.js';

// Bump on every shipped eval/search change; the binary self-reports "MistyBanqi <version>"
// over UCI, and the engines registry records it (configHash) on each game so we can always
// tell which build played.
//
// Corrected 2026-09-06: this read '0.2.5', a version that was never released. The newest
// misty-banqi release is v0.2.4, railpack.json fetches v0.2.4, and the deployed binary
// answers `id name MistyBanqi 0.2.4` — so every banqi game recorded since the typo names a
// build that does not exist. The one mechanism whose whole job is "tell which build
// played" was itself the thing that was wrong, which is precisely why it survived:
// nothing compares this constant against what the binary reports.
//
// Bump this only together with the railpack pin. Better still, stop bumping it by hand:
// engine_boot_check already spawns each binary at startup, so it could assert the
// handshake matches this string and turn a silent provenance lie into a loud boot failure.
export const BANQI_ENGINE_VERSION = '0.2.5';
export const BANQI_DEFAULT_ENGINE_ID = 'misty-banqi';

export type BanqiEngineTier = {
  id: string;
  name: string;
  version: string;
  // Strength is a NODE budget, not a time budget: `go nodes N` searches the same number of
  // positions on any CPU, so the bot plays the same strength regardless of how slow/loaded the
  // prod box is. (Movetime-only tiers under-searched in prod: that was measured in 2026-06 as
  // ~200K nodes in 600ms on the shared vCPU vs ~1.2M on a dev Mac — the bot was far weaker in
  // prod than in testing. Those ABSOLUTE numbers are long stale; re-measured 2026-09-06 the prod
  // container runs 1.14M-3.7M nps depending on position class. The ARGUMENT stands, which is why
  // the dial is still nodes: a node budget is the only way the bot plays the same strength on a
  // fast host and a busy one.)
  nodes: number;
  // Latency cap (ms): `go nodes N movetime CAP` halts at whichever hits first, so a slow box never
  // exceeds CAP per move. Generous enough that a normal prod CPU reaches the full node budget.
  movetimeCapMs: number;
};

// ONE versioned bot (2026-06-18). Was 3 difficulty tiers (amateur/strong/strongest); collapsed
// to a single full-strength MistyBanqi when the cheap-strength eval shipped (v0.2.0: cover_mat +
// king_ctx + value-aware mobility + adaptive domination + corrected value table, +16.6% vs hw3).
// The node budget is the strength dial; the 8s cap is the latency promise to the player and
// does NOT move.
//
// History of the cap, and why the number it was justified with is now wrong. The cap was
// raised 5000 -> 8000 on 2026-07-24 on the premise that prod's shared vCPU ran ~330K nodes/s
// (vs ~1.5M/s on a dev Mac) and therefore needed ~4.5s to reach 1.5M nodes, so a 5s cap
// truncated below budget and the bot played the shallow, weaker move (a diagnosed banqi
// horizon miss). That premise is stale by roughly 5x. Measured in the prod web container
// 2026-09-06, the SLOWEST position class runs ~1.14M nodes/s and 1.5M nodes completes in
// ~1.3s, matching the p50 of 843ms observed across 2,366 live plies. The cap raise therefore
// bought nothing: the 8s ceiling was never once hit, utilisation sat at ~11%, and the number
// that should have moved was the node budget.
//
// Budget resized 1.5M -> 3.5M (2026-09-06) to fix that budget-FIT defect. It is NOT a claimed
// strength gain — see the note at the bottom.
//
// Sizing rule: a work budget must fit inside its ceiling at the SLOWEST throughput we are
// willing to tolerate, not the fastest we measured. Measured in the prod web container
// 2026-09-06 (48-core shared Railway host, `go nodes N movetime 300000` so the node budget
// always binds, wall clock around the whole UCI round-trip including spawn), sweeping
// 1.5M..6M nodes over opening / early-flip / midgame / endgame FENs:
//
//   position class          throughput    cost @ 3.5M nodes    host loadavg
//   opening (32 dark)       ~3.7M nps       ~950ms             12.3-13.1
//   early (29 dark)         ~2.9M nps       ~1,200ms           12.5-13.1
//   endgame (few pieces)    ~1.8M nps       ~1,930ms           29-34
//   midgame (dense board)   ~1.14M nps      ~3,040ms           27-32   <- worst
//
// Dense revealed midgames are the slow class: widest move list, least chance-node pruning.
// Host load between loadavg 8 and loadavg 34 moved these numbers by under 5%, so the derate
// below is a tolerance, not an extrapolation of what was seen: a fixed search on this shared
// host has been observed to swing ~1.5x when it gets genuinely busy (loadavg 86), so the
// slowest throughput we accept is the worst measured class divided by 1.5.
//
//   slowest tolerated throughput = 1.14M nps / 1.5   = 0.76M nps
//   worst plausible cost @ 3.5M  = 3.5M / 0.76M nps  = 4,600ms
//   margin                       = 8,000ms / 4,600ms = 1.74x
//
// Do not size by scaling the node count up by the utilisation ratio (~9x here) — that puts
// the median at the ceiling and the p99 far past it, which is exactly how the sibling
// jungle-flip tier ended up crossing its cap on a busy host.
//
// NOT a claimed Elo gain: no self-play was run for this change. The strength evidence on
// record is the v0.2.0 eval work (cover_mat + king_ctx + value-aware mobility + adaptive
// domination + corrected value table, +16.6% vs hw3) and the v0.2.1 gen_danger arm — none of
// which measured 3.5M vs 1.5M nodes. If a strength check is run and 3.5M does not beat 1.5M,
// lower this number rather than raising the cap.
//
// `banqiEngineMove` logs a truncation warning when a move still hits the cap, so if this
// budget turns out not to fit on a genuinely degraded host it shows up in the logs rather
// than silently playing a weaker move.
const MISTY_BANQI: BanqiEngineTier = {
  id: BANQI_DEFAULT_ENGINE_ID,
  name: 'MistyBanqi',
  version: BANQI_ENGINE_VERSION,
  nodes: 3_500_000,
  movetimeCapMs: 8000,
};

export const BANQI_PLAYABLE_ENGINES: readonly BanqiEngineTier[] = [MISTY_BANQI];

// Legacy tier ids from old / in-flight game records still RESOLVE to the single bot (so the
// engine keeps moving and they display fine), but are not offered in the picker.
const BANQI_LEGACY_IDS = ['misty-banqi-strong', 'misty-banqi-amateur', 'misty-banqi-strongest'];

const BANQI_ENGINE_BY_ID: ReadonlyMap<string, BanqiEngineTier> = new Map<string, BanqiEngineTier>([
  [MISTY_BANQI.id, MISTY_BANQI],
  ...BANQI_LEGACY_IDS.map((id) => [id, MISTY_BANQI] as [string, BanqiEngineTier]),
]);

// Small per-process slot pool (Tier-B UCI subprocess; shared harness).
const enginePool = new UciEnginePool({
  name: 'banqi',
  maxProcessesEnvVar: 'MISTBOARD_BANQI_MAX_PROCESSES',
  queueTimeoutEnvVar: 'MISTBOARD_BANQI_QUEUE_TIMEOUT_MS',
  queueTimeoutMessage: 'banqi-engine concurrency queue timed out',
});

// Dedicated ANALYSIS pool: whole-game sweeps and decisions fan-outs acquire here,
// never from the live pool above, so analysis compute can never occupy a live
// bot-move slot (the queue-timeout starvation in #208/#168). Two slots match the
// decisions fan-out concurrency (see mapWithConcurrency call sites); the longer
// default queue timeout gives queued analysis evals headroom instead of shedding.
const analysisPool = new UciEnginePool({
  name: 'banqi-analysis',
  maxProcessesEnvVar: 'MISTBOARD_BANQI_ANALYSIS_MAX_PROCESSES',
  queueTimeoutEnvVar: 'MISTBOARD_BANQI_ANALYSIS_QUEUE_TIMEOUT_MS',
  defaultMaxProcesses: 2,
  defaultQueueTimeoutMs: 30_000,
  queueTimeoutMessage: 'banqi-engine analysis queue timed out',
});

// Resolve the MistyBanqi binary: explicit env override, else the dev build location,
// else the prod (railpack-compiled) / system locations.
export function banqiEnginePath(): string {
  const explicit = process.env.MISTBOARD_BANQI_ENGINE_PATH;
  if (explicit) {
    const resolved = resolve(explicit);
    if (!existsSync(resolved)) {
      throw new Error(
        `MISTBOARD_BANQI_ENGINE_PATH points at ${resolved} but the binary does not exist`,
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
      'banqi-engine',
      'target',
      'release',
      'banqi-engine',
    );
    if (existsSync(dev)) return dev;
  }
  for (const candidate of [
    resolve(process.cwd(), 'bin', 'banqi-engine'),
    '/app/bin/banqi-engine',
    '/usr/local/bin/banqi-engine',
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('MistyBanqi (banqi) binary not found. Set MISTBOARD_BANQI_ENGINE_PATH.');
}

export function banqiEngineTierFor(engineId: string | undefined): BanqiEngineTier | null {
  if (!engineId) return null;
  return BANQI_ENGINE_BY_ID.get(engineId) ?? null;
}

// Presence check for the fail-closed analysis path: true when the binary resolves. The
// analysis route uses this to return 503 (not a silent weaker eval) when the build is
// missing the engine — mirrors jungleEngineBinaryAvailable().
export function banqiEngineBinaryAvailable(): boolean {
  try {
    banqiEnginePath();
    return true;
  } catch {
    return false;
  }
}

export function banqiEngineDisplayName(engineId: string): string {
  return banqiEngineTierFor(engineId)?.name ?? engineId;
}

export function isBanqiEngineClientId(clientId: string | undefined): boolean {
  return banqiEngineTierFor(clientId) !== null;
}

// Engine BUILD version recorded per PvE game (subject_id is version-less). Bump
// BANQI_ENGINE_VERSION on each shipped eval/search change.
export function banqiEngineVersion(clientId: string | undefined): string | null {
  return isBanqiEngineClientId(clientId) ? BANQI_ENGINE_VERSION : null;
}

// `moves`: the quiet plies since the last irreversible move (capture/flip). When present,
// `fen` is the position at that irreversible move (window start), and the engine replays
// the moves to seed its repetition history — so it avoids/seeks threefold (perpetual-chase)
// draws instead of shuffling into them blind. Omit for the prior FEN-only behavior.
export type BanqiEngineOptions = {
  nodes?: number;
  movetimeCapMs?: number;
  moves?: readonly string[];
};

export function buildBanqiPositionCommand(fen: string, moves: readonly string[] = []): string {
  return moves.length > 0 ? `position fen ${fen} moves ${moves.join(' ')}` : `position fen ${fen}`;
}

/**
 * Ask MistyBanqi for a move given a redacted FEN (see banqi-fen.ts) and an optional
 * repetition window (`opts.moves`; see BanqiEngineOptions). Returns the engine's bestmove
 * in engine UCI (rank 0..3, e.g. "a0b0", flip "a0a0") or null. FEN is server-built/trusted.
 */
export async function banqiLiveEngineMove(
  engineId: string,
  fen: string,
  opts: BanqiEngineOptions = {},
): Promise<UciEval> {
  const tier = banqiEngineTierFor(engineId);
  if (!tier) throw new Error(`unknown Banqi engine: ${engineId}`);
  const release = await enginePool.acquire();
  try {
    return await banqiEngineSearch(fen, {
      nodes: opts.nodes ?? tier.nodes,
      movetimeCapMs: opts.movetimeCapMs ?? tier.movetimeCapMs,
      moves: opts.moves,
    });
  } finally {
    release();
  }
}

// Fraction of the node budget below which a move counts as truncated (cut short by the
// movetime cap before finishing its search), and the fraction of the cap that counts as
// "hit the cap". A truncated move plays a shallower, weaker choice than the configured
// strength — the failure mode behind the diagnosed banqi horizon miss (2026-07-24). We warn
// so this is visible in prod instead of silent (the binary emitted no search stats before).
const BANQI_TRUNCATION_NODE_FRACTION = 0.9;
const BANQI_CAP_HIT_FRACTION = 0.95;

/**
 * Emit search-truncation telemetry for one MistyBanqi move. `nodes` reports (depth/nodes/time)
 * come from the engine's `info` lines; older builds that emit none fall back to wall-clock
 * `elapsedMs` (an upper bound, includes spawn + handshake). Warns only on a truncated move, so
 * a healthy engine stays quiet and a warning is an actionable "cap too low / CPU starved" signal.
 */
function reportBanqiSearchTelemetry(input: {
  result: UciEval;
  nodeBudget: number;
  movetimeCapMs: number;
  elapsedMs: number;
}): void {
  const { result, nodeBudget, movetimeCapMs, elapsedMs } = input;
  const reachedBudget =
    result.nodes != null ? result.nodes >= nodeBudget * BANQI_TRUNCATION_NODE_FRACTION : null;
  const capMs = movetimeCapMs * BANQI_CAP_HIT_FRACTION;
  const hitCap = result.timeMs != null ? result.timeMs >= capMs : elapsedMs >= capMs;
  // Truncated: the engine reported fewer nodes than its budget, or it ran up against the cap.
  const truncated = reachedBudget === false || hitCap;
  if (!truncated) return;
  logger.warn(
    {
      kind: 'banqi_search_truncated',
      nodeBudget,
      movetimeCapMs,
      reportedNodes: result.nodes ?? null,
      reportedDepth: result.depth || null,
      reportedTimeMs: result.timeMs ?? null,
      elapsedMs: Math.round(elapsedMs),
      // A truncated search on the slow prod vCPU plays below configured strength; if this fires
      // steadily, raise movetimeCapMs or speed the engine (e.g. enable move ordering).
    },
    'MistyBanqi move truncated below node budget',
  );
}

export async function banqiEngineMove(
  fen: string,
  opts: BanqiEngineOptions = {},
): Promise<string | null> {
  return (await banqiEngineSearch(fen, opts)).best;
}

/**
 * The same move request, but returning the whole search summary rather than just
 * the move. Live play takes this one so the per-move decision artifact can record
 * what the engine actually consumed (depth, nodes, time) next to the budget it was
 * given; without those two numbers side by side, an engine that spends a fraction
 * of its allocation looks exactly like one that spends all of it.
 */
export async function banqiEngineSearch(
  fen: string,
  opts: BanqiEngineOptions = {},
): Promise<UciEval> {
  const nodes = opts.nodes ?? 500_000;
  const movetimeCapMs = opts.movetimeCapMs ?? 2500;
  const position = buildBanqiPositionCommand(fen, opts.moves);
  // Node budget = CPU-independent strength; movetime cap bounds latency (halt at whichever first).
  const commands = [
    'uci',
    'ucinewgame',
    'isready',
    position,
    `go nodes ${nodes} movetime ${movetimeCapMs}`,
  ];
  const startedAt = Date.now();
  const result = await runUciEval({
    bin: banqiEnginePath(),
    commands,
    timeoutMs: movetimeCapMs + 4000,
    timeoutMessage: 'banqi-engine move timed out',
  });
  reportBanqiSearchTelemetry({
    result,
    nodeBudget: nodes,
    movetimeCapMs,
    elapsedMs: Date.now() - startedAt,
  });
  return result;
}

// Whole-game ANALYSIS eval (distinct from the playable move provider above): read the
// engine's `info … score` for a redacted current-position FEN, side-to-move POV. Same
// node-budget dial as play, so the eval is CPU-independent and reproducible — which keeps
// the cached analysis stable. Gated through the dedicated ANALYSIS pool so a sweep can
// never occupy a live bot-move slot. Caller owns POV normalization; the
// redacted (as-played info-state) FEN is sent as-is — the engine never sees a hidden id.
export async function evaluateBanqiFenNodes(
  fen: string,
  opts: { nodes: number; movetimeCapMs: number; moves?: readonly string[] },
): Promise<UciEval> {
  const commands = [
    'uci',
    'ucinewgame',
    'isready',
    buildBanqiPositionCommand(fen, opts.moves),
    `go nodes ${opts.nodes} movetime ${opts.movetimeCapMs}`,
  ];
  const release = await analysisPool.acquire();
  try {
    return await runUciEval({
      bin: banqiEnginePath(),
      commands,
      timeoutMs: opts.movetimeCapMs + 4_000,
      timeoutMessage: 'banqi-engine eval timed out',
    });
  } finally {
    release();
  }
}
