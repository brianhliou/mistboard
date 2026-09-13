// MistyJungle move provider for Jungle (Dou Shou Qi / 斗兽棋) PvE — the Rust engine.
//
// Jungle is PERFECT-INFORMATION and deterministic, so — like banqi/jieqi/xiangqi
// (Tier-B) and unlike the fog engine-worker — we drive our own `jungle-engine` Rust
// binary (~/projects/mistboard-engine/jungle-engine) as a UCI subprocess and hand it
// a plain full-board FEN (jungle-fen.ts; no redaction). One process per request
// (stateless, robust); promote to a persistent pool only under real load.
//
// This is the strong backend behind the misty-jungle-level-* engine ids. It replaces
// the in-process TS alpha-beta (server-jungle-engine.ts) ONLY when MISTBOARD_JUNGLE_RUST_ENGINE
// is enabled AND the binary is present; otherwise the TS engine still serves (fallback).
// The win the Rust engine brings: proper win-distance (it takes the FASTEST win instead
// of dawdling — the TS engine scored all wins equally and an alphabetical tie-break could
// pick a slower one), plus the shared fail-closed/observability boundary.
//
// Strength is a NODE budget (CPU-independent), not a clock; a movetime cap bounds latency.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { runUciEval, UciEnginePool, type UciEval } from './uci-engine-harness.js';

// The binary self-reports "MistyJungle <version>" over UCI; bump on every shipped
// eval/search change so the per-game configHash stays meaningful.
export const JUNGLE_RUST_ENGINE_VERSION = '0.0.4';

export type JungleRustTier = {
  id: string;
  // NODE budget = CPU-independent strength (`go nodes N`). Initial values; tune by
  // bakeoff (node budget is a clean difficulty dial — see the Flip Jungle ladder).
  nodes: number;
  // Latency cap: `go nodes N movetime CAP` halts at whichever hits first.
  movetimeCapMs: number;
};

// Node budgets for every jungle engine id, playable or retired. Jungle ships ONE bot
// (2026-07-27): `misty-jungle-level-2` is the only id a new room may be created against
// — see JUNGLE_PLAYABLE_ENGINE_ID in server-jungle-engine.ts for why the retired ids
// stay defined rather than deleted.
//
// The playable tier carries the STRONGEST budget, which is the whole point of collapsing
// a three-rung ladder into one bot: there is no longer a stronger setting being held
// back for a rung nobody could select. Two measurements set it:
//
//   Why not 200k (what shipped until today). It left ~97% of its own latency cap unspent
//   — 200k returns in ~66ms p50 against a 3000ms ceiling — and that unspent headroom
//   lost games. In jgl_d234f6d2 the bot shuffled a rat back and forth for four moves
//   while a red rat walked into its den, because a den race only enters the search ~10+
//   plies out and eval_hand carries no den-defense term (#272). Same position, same
//   binary: 200k scores it 0.00 and shuffles, 1M scores it +73 for the attacker and
//   plays the defence that holds. Self-play over 120 games: 1M beat 200k by ~+64 Elo
//   (W29-L7-D84, decisive record 29-7, p = 0.0003).
//
//   Why 5M and not 1M. Self-play over 60 games: 5M beat 1M by ~+89 Elo (W16-L1-D43,
//   decisive record 16-1, p = 0.0001). The returns had not flattened, so the ceiling
//   below — not diminishing strength — is what stops the budget here.
//
//   Why the budget stops at 5M. 5M costs ~1839ms p50 / 2133ms max on the release binary.
//   The per-move allowance budgetForMove hands out is ~7.6s at the start of a 3+2 game
//   and ~3.6s with a minute left, so the NODE budget binds and strength stays
//   CPU-independent. The exception is 1+1, jungle's fastest preset: the allowance there
//   falls to ~1.8s by the 30-second mark, which is exactly where 5M lands, so a bullet
//   game clamps on time for its second half. That is the allocator working as designed
//   (solvency beats strength under time pressure), but it does mean 1+1 Misty is not
//   quite the same opponent as 3+2 Misty. Raising the budget further would widen that
//   gap without helping the controls people actually play.
//
//   Why the cap is 6000ms and not 4000ms (2026-09-06). The paragraph above sized 5M
//   against a BEST case and left only ~2.2x margin, and that margin is gone. Two
//   effects, both measured in the prod container: the host is a shared Railway box
//   whose load swings the SAME search by ~1.5x (5M cost 2227ms at loadavg 14.9 and
//   3587ms at loadavg 86.3, twenty minutes apart — not the container, which used 1.49
//   of 24 vCPU with zero cgroup throttling), and the box is ~1.45x slower than whatever
//   produced the 1839ms baseline (200k measures 94-99ms here against the ~66ms above).
//   Together those pushed 5M past 4000ms, and game timestamps show jungle pinned at the
//   cap on essentially every ply from 2026-09-03 (p50 4022ms, p90 4028ms) against a
//   node-bound p50 of 2167ms before 08-31 — i.e. the invariant this comment claims,
//   that strength stays CPU-independent, had quietly stopped holding.
//
//   6000ms restores ~1.7x margin over the worst measured 3587ms. It is a latency cost
//   and nothing else: budgetForMove still clips the ceiling under time pressure, so the
//   fast controls are unaffected and the 1+1 caveat above is unchanged.
//
//   The rule this got wrong, and the reason it is worth writing down: a work budget must
//   fit inside its ceiling at the SLOWEST throughput you are willing to tolerate, not
//   the fastest you happened to measure. A limit sized against a best case is not a
//   limit, it is a race between two numbers nobody is comparing.
//
//   Caveat on verifying any of this: the jungle binary emits only `info score cp .. pv ..`
//   — no nodes, no time — so the per-move artifact records nothing for jungle and the
//   only observable is wall time. Confirming this fix means watching p50 settle BELOW
//   the cap rather than pinning to it. Making nodes observable needs a change in the
//   misty-jungle repo.
//
// The retired tiers keep the budgets they shipped with, so a legacy room that somehow
// resumes plays as it originally did rather than at a strength nobody chose.
const JUNGLE_RUST_TIERS: ReadonlyMap<string, JungleRustTier> = new Map([
  ['misty-jungle-level-1', { id: 'misty-jungle-level-1', nodes: 20_000, movetimeCapMs: 1_500 }],
  ['misty-jungle-level-2', { id: 'misty-jungle-level-2', nodes: 5_000_000, movetimeCapMs: 6_000 }],
  ['misty-jungle-level-3', { id: 'misty-jungle-level-3', nodes: 1_000_000, movetimeCapMs: 5_000 }],
]);

// Every defined tier, so the single-bot invariant (the playable id is the strongest one
// defined) is testable rather than eyeballed. With the ladder gone, "strictly increasing
// rungs" is no longer the property worth guarding — "no retired id out-searches the bot
// players actually get" is.
export const JUNGLE_RUST_TIER_LIST: readonly JungleRustTier[] = [...JUNGLE_RUST_TIERS.values()];

export function jungleRustEngineEnabled(): boolean {
  return process.env.MISTBOARD_JUNGLE_RUST_ENGINE === 'true';
}

export function jungleRustTierFor(engineId: string | undefined): JungleRustTier | null {
  if (!engineId) return null;
  return JUNGLE_RUST_TIERS.get(engineId) ?? null;
}

// True iff the binary resolves on this box. Lets the server fall back to the
// in-process TS engine when the flag is on but the binary wasn't shipped, rather
// than break Jungle PvE entirely.
export function jungleEngineBinaryAvailable(): boolean {
  try {
    jungleEnginePath();
    return true;
  } catch {
    return false;
  }
}

// Resolve the MistyJungle binary: explicit env override, else the dev build location,
// else the prod (railpack-compiled) / system locations. Mirrors banqiEnginePath.
export function jungleEnginePath(): string {
  const explicit = process.env.MISTBOARD_JUNGLE_ENGINE_PATH;
  if (explicit) {
    const resolved = resolve(explicit);
    if (!existsSync(resolved)) {
      throw new Error(
        `MISTBOARD_JUNGLE_ENGINE_PATH points at ${resolved} but the binary does not exist`,
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
      'jungle-engine',
      'target',
      'release',
      'jungle-engine',
    );
    if (existsSync(dev)) return dev;
  }
  for (const candidate of [
    resolve(process.cwd(), 'bin', 'jungle-engine'),
    '/app/bin/jungle-engine',
    '/usr/local/bin/jungle-engine',
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('MistyJungle (jungle) binary not found. Set MISTBOARD_JUNGLE_ENGINE_PATH.');
}

// Best move for `engineId` given a full-board FEN (jungle-fen.ts), in engine UCI
// ("d8d9") or null. FEN is server-built/trusted. Concurrency-capped per process.
export async function jungleLiveEngineMove(
  engineId: string,
  fen: string,
  opts: { nodes?: number; movetimeCapMs?: number; repSeedFens?: readonly string[] } = {},
): Promise<UciEval> {
  const tier = jungleRustTierFor(engineId);
  if (!tier) throw new Error(`unknown Jungle engine: ${engineId}`);
  const release = await enginePool.acquire();
  try {
    return await jungleEngineSearch(fen, {
      nodes: opts.nodes ?? tier.nodes,
      movetimeCapMs: opts.movetimeCapMs ?? tier.movetimeCapMs,
      repSeedFens: opts.repSeedFens,
    });
  } finally {
    release();
  }
}

export async function jungleEngineMove(
  fen: string,
  opts: {
    nodes?: number;
    movetimeCapMs?: number;
    repSeedFens?: readonly string[];
  } = {},
): Promise<string | null> {
  return (await jungleEngineSearch(fen, opts)).best;
}

/**
 * The same move request, but returning the whole search summary rather than just
 * the move. Live play takes this one so the per-move decision artifact can record
 * what the engine actually consumed (depth, nodes, time) next to the node budget
 * it was configured with; the gap between those two is what says whether a bot is
 * playing at its rated strength or being cut short by the movetime cap.
 */
export function jungleEngineSearch(
  fen: string,
  opts: {
    nodes?: number;
    movetimeCapMs?: number;
    repSeedFens?: readonly string[];
  } = {},
): Promise<UciEval> {
  const nodes = opts.nodes ?? 1_000_000;
  const movetimeCapMs = opts.movetimeCapMs ?? 5_000;
  // Node budget = CPU-independent strength; movetime cap bounds latency (halt at
  // whichever hits first). Perfect-info: the full board FEN is sent as-is.
  const commands = [
    'uci',
    'ucinewgame',
    'isready',
    buildJunglePositionCommand(fen, opts.repSeedFens),
    `go nodes ${nodes} movetime ${movetimeCapMs}`,
  ];
  return runUciEval({
    bin: jungleEnginePath(),
    commands,
    timeoutMs: movetimeCapMs + 4000,
    timeoutMessage: 'jungle-engine move timed out',
  });
}

/**
 * Build the Jungle engine's history-aware UCI position command. A seed contains
 * representative FENs for positions already seen twice, separated by semicolons because
 * each FEN itself contains spaces.
 */
export function buildJunglePositionCommand(
  fen: string,
  repSeedFens: readonly string[] = [],
): string {
  if (repSeedFens.length === 0) return `position fen ${fen}`;
  return `position fen ${fen} reps ${repSeedFens.join(';')}`;
}

// Per-process concurrency cap (mirrors banqi-engine.ts; shared harness).
const enginePool = new UciEnginePool({
  name: 'jungle',
  maxProcessesEnvVar: 'MISTBOARD_JUNGLE_MAX_PROCESSES',
  queueTimeoutEnvVar: 'MISTBOARD_JUNGLE_QUEUE_TIMEOUT_MS',
  queueTimeoutMessage: 'jungle-engine concurrency queue timed out',
});

// Dedicated ANALYSIS pool: whole-game sweeps and decisions fan-outs acquire here,
// never from the live pool above, so analysis compute can never occupy a live
// bot-move slot (the queue-timeout starvation in #208/#168). Two slots match the
// decisions fan-out concurrency (see mapWithConcurrency call sites); the longer
// default queue timeout gives queued analysis evals headroom instead of shedding.
const analysisPool = new UciEnginePool({
  name: 'jungle-analysis',
  maxProcessesEnvVar: 'MISTBOARD_JUNGLE_ANALYSIS_MAX_PROCESSES',
  queueTimeoutEnvVar: 'MISTBOARD_JUNGLE_ANALYSIS_QUEUE_TIMEOUT_MS',
  defaultMaxProcesses: 2,
  defaultQueueTimeoutMs: 30_000,
  queueTimeoutMessage: 'jungle-engine analysis queue timed out',
});

// Whole-game ANALYSIS eval (distinct from the playable move providers above): read the
// engine's `info … score` for a full-board FEN, side-to-move POV. Same node-budget dial
// as play (jungle has no `go depth`), so the eval is CPU-independent and reproducible —
// which keeps the cached analysis stable. Gated through the dedicated ANALYSIS pool so a
// sweep can never occupy a live bot-move slot. Caller owns POV
// normalization; the fog-free full board is sent as-is (jungle is perfect information).
export async function evaluateJungleFenNodes(
  fen: string,
  opts: { nodes: number; movetimeCapMs: number; repSeedFens?: readonly string[] },
): Promise<UciEval> {
  const commands = [
    'uci',
    'ucinewgame',
    'isready',
    buildJunglePositionCommand(fen, opts.repSeedFens),
    `go nodes ${opts.nodes} movetime ${opts.movetimeCapMs}`,
  ];
  const release = await analysisPool.acquire();
  try {
    return await runUciEval({
      bin: jungleEnginePath(),
      commands,
      timeoutMs: opts.movetimeCapMs + 4_000,
      timeoutMessage: 'jungle-engine eval timed out',
    });
  } finally {
    release();
  }
}
