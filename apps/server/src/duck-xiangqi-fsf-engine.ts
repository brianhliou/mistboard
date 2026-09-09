// Fairy-Stockfish move provider for Duck Xiangqi (9x10 xiangqi + Duck Chess's
// shared, uncapturable blocker).
//
// FSF plays it from a custom variants.ini (duck-xiangqi.ini) on a PATCHED
// binary, and the patch is not optional: stock Fairy-Stockfish compiles
// MAX_MOVES = 1024, while a turn here is a piece move AND a duck placement, so
// the opening array alone generates 2,554 legal turns and random play peaks near
// 4,901. Overflowing that buffer is a stack smash inside MovePicker. The build
// (railpack) is gated on perft(1) = 2554 against this .ini, which is the kernel's
// own count for the opening array, so the gate asserts agreement with the rules
// the server enforces rather than merely that the binary runs. See
// fairy-stockfish-duck-xiangqi.ref for the full rationale.
//
// Structurally this mirrors the Fortress Xiangqi provider (per-tier warm FSF
// session, node+skill tiers, custom variant via VariantPath). Engine ids follow
// the Fairy-Stockfish naming (fairy-stockfish-duck-xiangqi-*); public bot
// identities live in first-party-bots.ts, separate from the executable engine id.
//
// The process lifecycle (spawn/parse/timeout/kill + the concurrency pool) is the
// shared `uci-engine-harness`; this file is just the Duck Xiangqi config + tiers.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  resolveFsfVariantIniPath,
  splitFairyStockfishCommands,
  UciEnginePool,
  type UciEval,
  UciWarmSessionCache,
} from './uci-engine-harness.js';

const VARIANT = 'duckxiangqi';
const VARIANT_INI = 'duck-xiangqi.ini';

export const DUCK_XIANGQI_DEFAULT_ENGINE_ID = 'fairy-stockfish-duck-xiangqi-level-4';

// Engine BUILD version recorded per PvE game. Bump on any engine/config change
// (the .ini, the tier table, the pinned ref, or the patch).
// 0.1.0: first live ladder — eight node-anchored classical rungs on the patched
//        duck binary, warm sessions, no EvE entry and no published ratings.
export const DUCK_XIANGQI_FSF_ENGINE_VERSION = '0.1.0';

/**
 * Short form of the Fairy-Stockfish commit prod builds for this provider. MUST
 * be a prefix of the first line of fairy-stockfish-duck-xiangqi.ref (the railpack
 * build step checks that commit out); duck-xiangqi-fsf-engine-ref.test.ts fails
 * the build if the two drift.
 *
 * The ref alone does not identify this engine: the binary is that commit PLUS
 * fairy-stockfish-duck-xiangqi.patch, and a change to either plays a different
 * game. DUCK_XIANGQI_FSF_PATCH_SHA256 pins the other half.
 */
export const DUCK_XIANGQI_FSF_ENGINE_REF = '1b5bdd40';

/**
 * sha256 of fairy-stockfish-duck-xiangqi.patch, the second half of this engine's
 * build identity. The patch raises MAX_MOVES to 8192, lowers MAX_PLY to 100, and
 * teaches the flying-general rule about a non-royal general (walling forbids a
 * royal king, so unpatched FSF switches that rule off on itself). Editing it
 * without moving this digest would let a rated identity silently change how it
 * plays; the ref test is what catches that.
 */
export const DUCK_XIANGQI_FSF_PATCH_SHA256 =
  'ced7beef2270e36b8d6324fe96c23d121e7bd59985ad073aee60bfbca5d628a5';

export type DuckXiangqiEngineTier = {
  id: string;
  name: string;
  /** Stockfish `Skill Level` (-20..20); 20 is full strength. */
  skill: number;
  /** Node budget: the CPU-independent strength anchor for this rung. */
  nodes: number;
  /**
   * Latency ceiling handed to the clock-aware allocator (budgetForMove), NOT a
   * fixed think. It only needs to be generous enough that the node budget binds
   * on the slow prod vCPU.
   */
  movetimeMs: number;
};

// Eight rungs, the same skill ladder the xiangqi and fortress FSF bots use, with
// a NODE budget as the strength anchor so a rung plays the same game on a laptop
// and on prod's slower vCPU. A movetime-only limit would make each rung's
// strength whatever the deploy box happened to deliver that day.
//
// The node budgets are LOWER than fortress's at the same level, and that is
// measured rather than cautious. Duck Xiangqi's root branching factor is ~2,554
// against fortress's few dozen, and the classical search on this binary managed
// ~150k nps deep (~300k shallow) on an M-series laptop, 2026-09-09:
//
//     3k nodes -> depth 2 (~10 ms)      100k -> depth 7 (~660 ms)
//    25k nodes -> depth 4 (~80 ms)      300k -> depth 9 (~2.1 s)
//     1M nodes -> depth 10 (~5.4 s)
//
// A 1M-node top rung (xiangqi Level 8's budget) would therefore cost ~13 s on a
// vCPU 2.5x slower than the laptop, which no offered pace can pay. In live
// self-play on a warm session (where the hash carries over between plies) the
// 300k rung actually reached its budget in 1.1-1.6 s at depth 8-10, so ~4 s on
// prod: the node budget stays the binding limit and the 6 s ceiling stays a
// latency guard.
//
// NO NNUE anywhere on this ladder: the only xiangqi net we ship is a
// standard-xiangqi net and it does not describe this variant, so every rung runs
// the classical eval, forced explicitly so a binary that gains a default net
// cannot silently substitute it.
const DUCK_XIANGQI_ENGINE_TIERS = [
  {
    id: 'fairy-stockfish-duck-xiangqi-level-1',
    name: 'Fairy-Stockfish Level 1',
    skill: -9,
    // One full depth-1 pass over the ~2,554 root turns costs ~2,745 nodes, so a
    // smaller budget would cut the root scan itself in half and make the rung's
    // move an artifact of move ordering rather than of its skill setting.
    nodes: 3_000,
    movetimeMs: 300,
  },
  {
    id: 'fairy-stockfish-duck-xiangqi-level-2',
    name: 'Fairy-Stockfish Level 2',
    skill: -5,
    nodes: 6_000,
    movetimeMs: 300,
  },
  {
    id: 'fairy-stockfish-duck-xiangqi-level-3',
    name: 'Fairy-Stockfish Level 3',
    skill: -1,
    nodes: 12_000,
    movetimeMs: 400,
  },
  {
    id: DUCK_XIANGQI_DEFAULT_ENGINE_ID,
    name: 'Fairy-Stockfish Level 4',
    skill: 3,
    nodes: 25_000,
    movetimeMs: 600,
  },
  {
    id: 'fairy-stockfish-duck-xiangqi-level-5',
    name: 'Fairy-Stockfish Level 5',
    skill: 8,
    nodes: 50_000,
    movetimeMs: 900,
  },
  {
    id: 'fairy-stockfish-duck-xiangqi-level-6',
    name: 'Fairy-Stockfish Level 6',
    skill: 12,
    nodes: 100_000,
    movetimeMs: 2_000,
  },
  {
    id: 'fairy-stockfish-duck-xiangqi-level-7',
    name: 'Fairy-Stockfish Level 7',
    skill: 16,
    nodes: 175_000,
    movetimeMs: 3_500,
  },
  {
    id: 'fairy-stockfish-duck-xiangqi-level-8',
    name: 'Fairy-Stockfish Level 8',
    skill: 20,
    nodes: 300_000,
    // Ceiling, not fixed think: ~2.1 s on a laptop, an estimated ~5 s on prod's
    // shared vCPU, so the node budget stays the binding limit on every offered
    // pace except severe time pressure, where the allocator shrinks the movetime
    // and the rung plays weaker but solvent.
    movetimeMs: 6_000,
  },
] as const satisfies readonly DuckXiangqiEngineTier[];

export const DUCK_XIANGQI_PLAYABLE_ENGINES: readonly DuckXiangqiEngineTier[] =
  DUCK_XIANGQI_ENGINE_TIERS;

const DUCK_XIANGQI_ENGINE_BY_ID: ReadonlyMap<string, DuckXiangqiEngineTier> = new Map(
  DUCK_XIANGQI_ENGINE_TIERS.map((engine) => [engine.id, engine]),
);

// Small FSF slot pool, separate from the other variants. Promote to a shared
// pool only under real concurrent load.
const fsfPool = new UciEnginePool({
  name: 'duck-xiangqi-fsf',
  maxProcessesEnvVar: 'MISTBOARD_DUCK_XIANGQI_FSF_MAX_PROCESSES',
  queueTimeoutEnvVar: 'MISTBOARD_DUCK_XIANGQI_FSF_QUEUE_TIMEOUT_MS',
  queueTimeoutMessage: 'duck-xiangqi fsf concurrency queue timed out',
});

// Parked engine processes between moves; the pool above still caps how many
// searches run at once, so live sessions never exceed its slots.
const warmSessions = new UciWarmSessionCache({ name: 'duck-xiangqi-fsf' });

/** Point-in-time warm-session counters (spawned/reused/idle) for diagnostics. */
export function duckXiangqiFsfWarmSessionStats() {
  return warmSessions.stats();
}

export function duckXiangqiEngineTierFor(
  engineId: string | undefined,
): DuckXiangqiEngineTier | null {
  if (!engineId) return null;
  return DUCK_XIANGQI_ENGINE_BY_ID.get(engineId) ?? null;
}

export function duckXiangqiEngineDisplayName(engineId: string): string {
  return duckXiangqiEngineTierFor(engineId)?.name ?? engineId;
}

export function isDuckXiangqiEngineClientId(clientId: string | undefined): boolean {
  return duckXiangqiEngineTierFor(clientId) !== null;
}

export function duckXiangqiEngineVersion(clientId: string | undefined): string | null {
  return isDuckXiangqiEngineClientId(clientId) ? DUCK_XIANGQI_FSF_ENGINE_VERSION : null;
}

// duck-xiangqi.ini lives in src/; tsc does not copy it to dist/, so look in both
// the tsx-dev (src) and built (dist -> ../src) locations.
export function duckXiangqiVariantIniPath(): string {
  return resolveFsfVariantIniPath(VARIANT_INI);
}

/**
 * Resolve the Duck Xiangqi FSF binary: explicit env override, else the
 * railpack-built `/app/bin/fairy-stockfish-duck-xiangqi` (or its cwd-relative dev
 * twin). Throws when none of them exist.
 *
 * Deliberately NO fallback to the shared `fairyStockfishPath()`, unlike the
 * xiangqi provider. A stock FSF build compiles MAX_MOVES = 1024 against this
 * variant's 4,901-turn peak, so the fallback would not be a weaker engine, it
 * would be a stack smash in MovePicker (SIGSEGV, corrupted backtrace) or, if it
 * survived, a legal-move set that is not this game. Failing here surfaces a
 * missing binary as a missing binary — which is also what engine-boot-check.ts
 * probes for at startup.
 */
export function duckXiangqiFsfPath(): string {
  const explicit = process.env.MISTBOARD_FSF_DUCK_XIANGQI_PATH;
  if (explicit) {
    const resolved = resolve(explicit);
    if (!existsSync(resolved)) {
      throw new Error(
        `MISTBOARD_FSF_DUCK_XIANGQI_PATH points at ${resolved} but the binary does not exist`,
      );
    }
    return resolved;
  }
  for (const candidate of [
    resolve(process.cwd(), 'bin', 'fairy-stockfish-duck-xiangqi'),
    '/app/bin/fairy-stockfish-duck-xiangqi',
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    'Duck Xiangqi Fairy-Stockfish binary not found (looked for bin/fairy-stockfish-duck-xiangqi ' +
      'and /app/bin/fairy-stockfish-duck-xiangqi). Set MISTBOARD_FSF_DUCK_XIANGQI_PATH. The ' +
      'shared Fairy-Stockfish build is NOT a substitute: it cannot play this variant.',
  );
}

/**
 * Resolve the engine tier, take a concurrency slot, and ask FSF for a move given
 * the turn history from the start position in FSF's own encoding (one comma-joined
 * token per turn — see server-duck-xiangqi-engine.ts for the spelling). Returns the
 * whole search summary so the per-move decision artifact can record what the search
 * actually consumed against the rung's node budget.
 */
export async function duckXiangqiLiveEngineMove(
  engineId: string,
  moves: string[],
  opts: { movetimeMs?: number } = {},
): Promise<UciEval> {
  const tier = duckXiangqiEngineTierFor(engineId);
  if (!tier) throw new Error(`unknown Duck Xiangqi engine: ${engineId}`);
  const release = await fsfPool.acquire();
  try {
    const bin = duckXiangqiFsfPath();
    const movetimeMs = opts.movetimeMs ?? tier.movetimeMs;
    const { init, position, go } = splitFairyStockfishCommands({
      moves,
      variant: VARIANT,
      iniPath: duckXiangqiVariantIniPath(),
      skill: tier.skill,
      nodes: tier.nodes,
      // Explicit, not inherited: this build is compiled with nnue=yes and the
      // only net in the image is a standard-xiangqi net. Forcing classical is the
      // output gate that stops a silent substitution.
      eval: 'classical',
      movetimeMs,
    });
    // Warm session per tier. This is a from-source binary and the sibling xiangqi
    // build takes ~4.3 s just to start in the prod container, which a
    // spawn-per-move loop charges to the bot's clock on every ply. `init` is the
    // cache key, so tiers never share a process (different Skill Level).
    //
    // `splitFairyStockfishCommands` is also what makes the two ordering hazards
    // of this variant unreachable: it emits VariantPath BEFORE UCI_Variant, and
    // it always emits an explicit `position …`. Without the latter the engine
    // keeps the chess position it booted with — perft reads 20 instead of 2554 —
    // while still reporting the variant as loaded.
    return await warmSessions.withSession(
      { bin, initCommands: init, name: `duck-xiangqi-fsf:${tier.id}` },
      (session) =>
        session.evalPosition({
          positionCommand: position,
          goCommand: go,
          timeoutMs: movetimeMs + 4000,
          timeoutMessage: 'duck-xiangqi fsf move timed out',
        }),
    );
  } finally {
    release();
  }
}
