// Pikafish-jieqi move provider for Jieqi (揭棋) PvE.
//
// The engine is the Pikafish `jieqi` / `jieqi_old` branch (our "PikaJieQi" binary)
// driven as a UCI subprocess — the same Tier-B pattern as xiangqi/Fairy-Stockfish,
// NOT the redaction-shaped Obscuro engine-worker (the fog engine). Unlike xiangqi
// (perfect information, replayed from `position startpos moves ...`), jieqi has hidden
// identities that the engine must NOT learn, so we hand it a redacted CURRENT-position
// FEN built by jieqi-fen.ts. Live moves run on WARM sessions (UciWarmSessionCache) since
// 2026-09-03: the spawn-per-move loop re-allocated the 256 MB hash twice on every ply
// (`Hash`, then `Threads` re-sizes it), each a transparent-huge-page fault that stalls
// in direct compaction whenever the prod host runs out of free huge pages (#335). A
// parked process pays that once, and its 8 s deadline covers only the search.
//
// LAUNCH config is the no-net `jieqi_old` classical-eval build (handcrafted eval, no
// NNUE weights — clean GPL-3 with no net-licensing problem). The strength track swaps in
// the NNUE `jieqi` branch + our own-trained net via MISTBOARD_PIKAFISH_NET (EvalFile).

import { existsSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { resolve } from 'node:path';
import { logger } from './obs.js';
import {
  boundedEnvInt,
  runUciEval,
  UciEnginePool,
  UciEngineSession,
  type UciEval,
  type UciMultiPvLine,
  UciWarmSessionCache,
} from './uci-engine-harness.js';

export const JIEQI_DEFAULT_ENGINE_ID = 'pikafish-jieqi-strongest';
// Engine BUILD version recorded per PvE game (subject_id encodes only the tier). The shipped
// engine is the no-net classical Pikafish jieqi_old build; bump on any engine/config change.
// 0.3.0 (2026-08-31): new binary (ScoreCalc flip-node fix, pikafish-jieqi.ref 4f857757).
// 0.3.1 (2026-09-03): live moves on warm sessions (hash allocated once per process, the
// 8 s deadline covers only the search), `ucinewgame` at a game's first engine move.
// 0.3.2 (2026-09-03): new binary (pikafish-jieqi.ref e75cee3a): qsearch honours
// `go movetime` via a Threads.stop check and a main-thread check_time() at its entry.
// 0.3.3 (2026-10-02): new binary (pikafish-jieqi.ref bcc83f88, #497): reveals scored
// honestly (no Black-side flip; root fail-lows re-searched instead of averaged as exact).
export const JIEQI_ENGINE_VERSION = '0.3.3';

// AB-JChess (github.com/lxsgx23/AB-JChess, GPL-3, by Huorongrong and Laoxu (Kouza)): the
// top jieqi slot since 2026-10, a Pikafish-derived engine with its own NNUE. The slot is
// not a numbered level: it holds the strongest engine we know of and names it, so a later
// swap never redefines a level (docs-private/engine-track/jieqi-strength-ceiling-2026-09-30.md).
// ab-jchess.ref pins the binary; railpack.json fetches the net from the author's release
// and checks its sha256 (his terms: never re-hosted). The version names the source
// release and the net, since either one changes its play.
export const JIEQI_ABJCHESS_ENGINE_ID = 'ab-jchess-jieqi';
export const ABJCHESS_JIEQI_ENGINE_VERSION = 'abj-0.2b-net-20260911';
export const ABJCHESS_NET_FILE = 'abjchess-20260911.nnue';
// Short form of ab-jchess.ref, the AB-JChess commit the prod image builds. Part of the
// AB analysis cache keys for the same reason PIKAFISH_JIEQI_ENGINE_REF is part of the
// PikaJieQi ones (see below); jieqi-engine-ref.test.ts keeps the two in step.
export const ABJCHESS_ENGINE_REF = '1ae95ca6';
// ANALYSIS pins its own version. The 0.2.0 bump above is a LIVE-PLAY search-config change
// (top-tier movetime + Hash/Threads, see jieqiLiveResourceOptions); the two paths are
// independent, so a live-play change must not invalidate cached sweeps. Bump this one only
// when the binary or the analysis search config itself changes. Analysis now runs a fixed
// depth (JIEQI_ANALYSIS_DEPTH_SEARCH), single-threaded, on its OWN fixed Hash — see
// jieqiAnalysisResourceOptions; it is no longer "default hash", and depth is no longer 12.
// 0.2.0 (2026-08-27): jieqi analysis runs `go depth N movetime T` and halts on
// whichever binds first. When movetime wins, the final iteration is aborted and
// the last `info` line is a bound with a one-move pv — which the UCI reader used
// to take as the evaluation (see uci-engine-harness). Fixed there; this bump
// orphans sweeps whose movetime bound, since their evals and pvs are wrong.
// Fortress is NOT bumped: it runs a pure `go depth N`, which always completes
// its final iteration. The Misty-backed variants never touch this parser.
// 0.4.0 (2026-08-31): new binary. The ScoreCalc flip-node fix changes evals at any node
// where a dark piece moves, so every cached sweep predates the engine that would produce
// it now. The ref below moves in the same commit; this bump is belt-and-braces.
// 0.5.0 (2026-10-02): new binary (#497); every reveal eval can change. Ref moves too.
export const JIEQI_ANALYSIS_ENGINE_VERSION = '0.5.0';

// Short form of the commit the prod image builds (pikafish-jieqi.ref). Since 2026-08-31
// that is OUR fork's `jieqi_old-mistboard` branch, not upstream: upstream 23b9466c plus a
// single src/misc.h patch, so ScoreCalc no longer averages a forced loss away at flip nodes.
// It belongs in the ANALYSIS cache key because that key's whole promise is "same inputs,
// same evals": the binary is an input, and until 2026-08-28 the build cloned branch tip on
// every deploy, so two deploys either side of an upstream commit filed evals from different
// engines under one identical key. Version alone could not catch that, being hand-maintained.
// jieqi-engine-ref.test.ts fails if this drifts from the .ref file, so swapping the engine
// cannot land without moving the key and forcing a recompute.
// e75cee3a (2026-09-03): qsearch honours Threads.stop / movetime. A node- or
// depth-limited analysis search now stops on the exact node it should, so evals can
// differ from 4f857757 by the tail it used to overrun; hence the key moves.
// bcc83f88 (2026-10-02, #497): reveal scoring fixed; most reveal evals change.
export const PIKAFISH_JIEQI_ENGINE_REF = 'bcc83f88';

export type JieqiEngineTier = {
  id: string;
  name: string;
  movetimeMs: number;
  // Optional hard search-depth cap: `go depth N movetime T` stops at whichever binds.
  // The top tier omits it (full strength, time-bounded).
  depth?: number;
  // Stockfish-style Skill Level (-20..20). jieqi_old has NO Skill Level / UCI_Elo
  // option, so the server applies Stockfish's own pick rule to the engine's MultiPV
  // table (pickSkillMove below). Omitted = full strength, no MultiPV.
  skill?: number;
  // Retired tiers stay resolvable (old rooms, replays, attribution) but are not
  // offered or rated.
  retired?: boolean;
  // The binary behind the tier; omitted = PikaJieQi.
  engine?: 'ab-jchess';
};

// The ladder (2026-09-29): Lichess's Stockfish level table, the same one the xiangqi
// Fairy-Stockfish ladder copies (xiangqi-fsf-engine.ts): skill -9..16, depth 5/5/5/5/5/8/13,
// 50..500 ms. Level 8 is the full-strength bot every jieqi game used to get, under its
// old id so its history and rating carry over. Strength per level is a starting point
// until the EvE run rates it (jieqi-eve-adapter.ts).
const JIEQI_LADDER_TIERS = [
  { level: 1, skill: -9, depth: 5, movetimeMs: 50 },
  { level: 2, skill: -5, depth: 5, movetimeMs: 100 },
  { level: 3, skill: -1, depth: 5, movetimeMs: 150 },
  { level: 4, skill: 3, depth: 5, movetimeMs: 200 },
  { level: 5, skill: 7, depth: 5, movetimeMs: 300 },
  { level: 6, skill: 11, depth: 8, movetimeMs: 400 },
  { level: 7, skill: 16, depth: 13, movetimeMs: 500 },
].map(
  ({ level, ...tier }): JieqiEngineTier => ({
    id: `pikafish-jieqi-level-${level}`,
    name: `Pikafish Level ${level}`,
    ...tier,
  }),
);

const JIEQI_ENGINE_TIERS: readonly JieqiEngineTier[] = [
  ...JIEQI_LADDER_TIERS,
  {
    // Level 8: no depth cap, no skill, and the movetime matches mainline Pikafish's top
    // xiangqi rung (level-8, 4000ms). Measured at the jieqi start position on an 8-core
    // dev box: this config reaches depth 32.
    id: JIEQI_DEFAULT_ENGINE_ID,
    name: 'PikaJieQi - Strongest',
    movetimeMs: 4_000,
  },
  {
    // The top slot: AB-JChess on level 8's budget (4000ms, Hash 256, the same threads).
    // Full strength, so no depth cap and no skill.
    id: JIEQI_ABJCHESS_ENGINE_ID,
    name: 'AB-JChess',
    movetimeMs: 4_000,
    engine: 'ab-jchess',
  },
  // Pre-ladder tiers (depth caps only), never offered after the Pikafish consolidation.
  {
    id: 'pikafish-jieqi-amateur',
    name: 'PikaJieQi - Amateur',
    depth: 4,
    movetimeMs: 800,
    retired: true,
  },
  {
    id: 'pikafish-jieqi-strong',
    name: 'PikaJieQi - Strong',
    depth: 10,
    movetimeMs: 1200,
    retired: true,
  },
];

// Per-process search resources for LIVE play. PikaJieQi ships UCI defaults of
// Threads=1 / Hash=16, and 16MB is badly undersized for this binary: it runs at
// ~3M nps, so hashfull pegs at 1000 (a fully thrashing table) inside the first
// second of a 4s search. Measured at the start position, 4000ms:
//   16MB/1thr -> depth 25 | 256MB/1thr -> depth 28 | 256MB/2thr -> depth 32.
// The THREAD count is what the analysis path must not borrow: a fixed-depth sweep is
// cached by (room, engine, depth) and promises a CPU-independent result, and parallel
// search is order-dependent. Measured, same position at depth 22, three runs:
// 1 thread -> cp 1055 / 1055 / 1055; 2 threads -> cp 1046 / 1055 / 1002. Hash is a
// fixed byte count and carries no such hazard, so analysis sets its own (below).
//
// Threads never claims more than HALF the container's cores: the engine shares the
// `web` box with the WS server's event loop, and the live pool can run
// MISTBOARD_PIKAFISH_MAX_PROCESSES (default 2) of these at once. So a 2-vCPU box
// stays single-threaded and only an 8-vCPU box reaches the cap of 4. Both knobs are
// env-tunable: raise MISTBOARD_PIKAFISH_JIEQI_THREADS / _HASH_MB if the container
// has headroom (each concurrent search allocates its own Hash).
function jieqiLiveResourceOptions(): string[] {
  const hashMb = boundedEnvInt('MISTBOARD_PIKAFISH_JIEQI_HASH_MB', 256, 16, 4_096);
  const threads = boundedEnvInt(
    'MISTBOARD_PIKAFISH_JIEQI_THREADS',
    Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2))),
    1,
    16,
  );
  return [`setoption name Hash value ${hashMb}`, `setoption name Threads value ${threads}`];
}

/** Every tier the server can resolve, retired ones included (registry, history). */
export const JIEQI_ALL_ENGINE_TIERS: readonly JieqiEngineTier[] = JIEQI_ENGINE_TIERS;

/** The EvE-only uniformly-random mover: the 0-Elo anchor of the ladder's ratings. */
export const JIEQI_RANDOM_ENGINE_ID = 'random-legal-jieqi';
export const JIEQI_RANDOM_ENGINE_VERSION = 'random-legal-v1';

/** Everything offered, weakest first: levels 1-7, level 8 (JIEQI_DEFAULT_ENGINE_ID),
 *  then the AB-JChess top slot. */
export const JIEQI_PLAYABLE_ENGINES: readonly JieqiEngineTier[] = JIEQI_ENGINE_TIERS.filter(
  (tier) => !tier.retired,
);

const JIEQI_ENGINE_BY_ID: ReadonlyMap<string, JieqiEngineTier> = new Map(
  JIEQI_ENGINE_TIERS.map((engine) => [engine.id, engine]),
);

// Small per-process slot pool (Tier-B UCI subprocess; shared harness).
const enginePool = new UciEnginePool({
  name: 'pikajieqi',
  maxProcessesEnvVar: 'MISTBOARD_PIKAFISH_MAX_PROCESSES',
  queueTimeoutEnvVar: 'MISTBOARD_PIKAFISH_QUEUE_TIMEOUT_MS',
  queueTimeoutMessage: 'pikafish-jieqi concurrency queue timed out',
});

// Dedicated ANALYSIS pool: whole-game sweeps and decisions fan-outs acquire here,
// never from the live pool above, so analysis compute can never occupy a live
// bot-move slot (the queue-timeout starvation in #208/#168). Two slots match the
// decisions fan-out concurrency (see mapWithConcurrency call sites); the longer
// default queue timeout gives queued analysis evals headroom instead of shedding.
const analysisPool = new UciEnginePool({
  name: 'pikajieqi-analysis',
  maxProcessesEnvVar: 'MISTBOARD_PIKAFISH_JIEQI_ANALYSIS_MAX_PROCESSES',
  queueTimeoutEnvVar: 'MISTBOARD_PIKAFISH_JIEQI_ANALYSIS_QUEUE_TIMEOUT_MS',
  defaultMaxProcesses: 2,
  defaultQueueTimeoutMs: 30_000,
  queueTimeoutMessage: 'pikafish-jieqi analysis queue timed out',
});

// AB-JChess analysis gets its own pool, ONE slot by default: each process holds the
// 133 MB net besides its hash, on the same `web` box as the WS server and the live AB
// sessions. A sweep or a decisions run holds its one session for the whole run, and
// the analysis job lane already runs one jieqi job at a time, so one slot costs no
// throughput. The live-play pool above is separate and unchanged.
const abJchessAnalysisPool = new UciEnginePool({
  name: 'abjchess-analysis',
  maxProcessesEnvVar: 'MISTBOARD_ABJCHESS_ANALYSIS_MAX_PROCESSES',
  queueTimeoutEnvVar: 'MISTBOARD_ABJCHESS_ANALYSIS_QUEUE_TIMEOUT_MS',
  defaultMaxProcesses: 1,
  defaultQueueTimeoutMs: 30_000,
  queueTimeoutMessage: 'ab-jchess analysis queue timed out',
});

// How many times ONE sweep may respawn its analysis engine after a crash. Low on
// purpose: recovering from the occasional PikaJieQi segfault is the goal, but an
// engine that dies on position after position is a real failure and must surface
// instead of silently costing a fresh process every eval.
const ANALYSIS_SESSION_MAX_RESPAWNS = 3;

// Resolve the PikaJieQi binary: explicit env override, else the known dev location,
// else the prod (railpack-compiled) / system locations.
export function pikaJieqiPath(): string {
  const explicit = process.env.MISTBOARD_PIKAFISH_PATH;
  if (explicit) {
    const resolved = resolve(explicit);
    if (!existsSync(resolved)) {
      throw new Error(
        `MISTBOARD_PIKAFISH_PATH points at ${resolved} but the binary does not exist`,
      );
    }
    return resolved;
  }
  const home = process.env.HOME;
  if (home) {
    const dev = resolve(home, 'projects', 'tools', 'pikafish-jieqi-old', 'src', 'PikaJieQi');
    if (existsSync(dev)) return dev;
  }
  for (const candidate of [
    resolve(process.cwd(), 'bin', 'pikafish-jieqi'),
    '/app/bin/pikafish-jieqi',
    '/usr/local/bin/pikafish-jieqi',
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('PikaJieQi (jieqi) binary not found. Set MISTBOARD_PIKAFISH_PATH.');
}

// AB-JChess and its net. No dev fallback under ~/projects/tools: the checkout there is
// 0.1b, which searches the start position on an empty pool field. Locally, build 0.2b
// (ab-jchess.ref) and point MISTBOARD_ABJCHESS_PATH at it.
export function abJchessPath(): string {
  const explicit = process.env.MISTBOARD_ABJCHESS_PATH;
  if (explicit) {
    const resolved = resolve(explicit);
    if (!existsSync(resolved)) {
      throw new Error(
        `MISTBOARD_ABJCHESS_PATH points at ${resolved} but the binary does not exist`,
      );
    }
    return resolved;
  }
  for (const candidate of [resolve(process.cwd(), 'bin', 'ab-jchess'), '/app/bin/ab-jchess']) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('AB-JChess binary not found. Set MISTBOARD_ABJCHESS_PATH.');
}

export function abJchessNetPath(): string {
  const explicit = process.env.MISTBOARD_ABJCHESS_NET;
  const home = process.env.HOME;
  const candidates = explicit
    ? [resolve(explicit)]
    : [
        resolve(process.cwd(), 'bin', ABJCHESS_NET_FILE),
        `/app/bin/${ABJCHESS_NET_FILE}`,
        ...(home
          ? [resolve(home, 'projects', 'tools', 'AB-JChess', 'nets', ABJCHESS_NET_FILE)]
          : []),
      ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      `AB-JChess net ${ABJCHESS_NET_FILE} not found (${candidates.join(', ')}). Set MISTBOARD_ABJCHESS_NET.`,
    );
  }
  return found;
}

/** True when both the AB-JChess binary and its net resolve; the top slot is offered only then. */
export function abJchessAvailable(): boolean {
  try {
    abJchessPath();
    abJchessNetPath();
    return true;
  } catch {
    return false;
  }
}

// The classical jieqi_old build needs no net. When serving the NNUE `jieqi` branch,
// point MISTBOARD_PIKAFISH_NET at an ABSOLUTE path to our trained .nnue (the engine
// rejects a relative EvalFile).
function netOption(): string[] {
  const net = process.env.MISTBOARD_PIKAFISH_NET;
  if (!net) return [];
  const resolved = resolve(net);
  if (!existsSync(resolved)) {
    throw new Error(`MISTBOARD_PIKAFISH_NET points at ${resolved} but the file does not exist`);
  }
  return [`setoption name EvalFile value ${resolved}`];
}

export function jieqiEngineTierFor(engineId: string | undefined): JieqiEngineTier | null {
  if (!engineId) return null;
  return JIEQI_ENGINE_BY_ID.get(engineId) ?? null;
}

// Presence check: true when the PikaJieQi binary resolves (live levels 1-8, the live
// prewarm). The analysis route gates on jieqiAnalysisEngineAvailable() below instead,
// which also accepts AB-JChess.
export function jieqiEngineBinaryAvailable(): boolean {
  try {
    pikaJieqiPath();
    return true;
  } catch {
    return false;
  }
}

/** The binary behind server-side jieqi analysis (sweep + decisions). */
export type JieqiAnalysisEngine = 'ab-jchess' | 'pikafish-jieqi';

/**
 * Which engine computes NEW jieqi analysis: AB-JChess whenever its binary and net
 * resolve (prod), else PikaJieQi, so a dev box or CI without the net still analyses.
 * Each engine files under its own cache ids and the client reads the curve off the
 * stored id, so the two never mix inside one series (jieqi-analysis.ts).
 */
export function jieqiAnalysisEngine(): JieqiAnalysisEngine {
  return abJchessAvailable() ? 'ab-jchess' : 'pikafish-jieqi';
}

/** The analysis route's fail-closed gate: either engine can serve it. */
export function jieqiAnalysisEngineAvailable(): boolean {
  return abJchessAvailable() || jieqiEngineBinaryAvailable();
}

// Per-process search resources for ANALYSIS. Single-threaded, because parallel search
// is non-deterministic and a cached sweep promises a reproducible result. Hash is
// raised off the 16MB UCI default anyway: 16MB is badly undersized for a ~3M nps binary
// and hashfull pegs at 1000 mid-search, which does not merely slow the search down, it
// corrupts it. Measured at the start position, single-threaded, depths 12 through 32:
// 16MB wanders 238 -> 241 -> 265 -> 299 cp on a fully thrashing table, while 256MB holds
// 234 -> 238 -> 234 with hashfull under 12%. A fixed byte count is as reproducible as any
// other fixed option, so this preserves the cache guarantee that Threads would break.
//
// SCOPE OF THAT GUARANTEE, measured 2026-08-28 and narrower than this comment used to
// imply: reproducible means same-architecture. The same pinned commit built arm64/NEON
// and x86-64-sse41-popcnt disagrees on both eval and node count for one position
// (depth 20: 1043 cp / 1,106,314 nodes vs 1050 cp / 851,161). The cache key captures
// engine ref and depth, not ARCH, so ONLY an x86-64 build (what railpack builds) may
// write these rows. scripts/backfill-jieqi-analysis.mjs enforces that at runtime.
//
// AB-JChess analysis runs a 64 MB table. Its budgets are tens of thousands of nodes
// (it searches ~30-70k nps single-threaded, ~50x slower per node than PikaJieQi), so
// even a 200k-node re-search touches a few percent of 64 MB; the remaining 192 MB would
// buy nothing but resident memory on the web box. Same reproducibility argument: fixed.
export function jieqiAnalysisResourceOptions(
  engine: JieqiAnalysisEngine = 'pikafish-jieqi',
): string[] {
  const hashMb = engine === 'ab-jchess' ? 64 : 256;
  return [`setoption name Hash value ${hashMb}`, 'setoption name Threads value 1'];
}

/** The `uci` … `isready` handshake an analysis session is spawned with: the engine's
 *  net (AB-JChess always loads its own; PikaJieQi only when MISTBOARD_PIKAFISH_NET is
 *  set), then the fixed analysis Hash/Threads. */
export function buildJieqiAnalysisInitCommands(engine: JieqiAnalysisEngine): string[] {
  const net =
    engine === 'ab-jchess' ? [`setoption name EvalFile value ${abJchessNetPath()}`] : netOption();
  return ['uci', ...net, ...jieqiAnalysisResourceOptions(engine), 'ucinewgame', 'isready'];
}

/**
 * The search budget for ONE analysis eval, as a union so a call site must pick exactly one
 * dial and cannot silently set both.
 *
 * NODES is the Layer-1 (whole-game sweep) dial; DEPTH is the Layer-2 (decisions) dial. The
 * difference matters and is not cosmetic: a fixed DEPTH is not a fixed amount of search.
 * Measured over one 64-ply jieqi game at depth 16, per-ply cost ranged from 94k to 7.8M nodes
 * (median 173k, mean 845k) because check extensions and singular extensions spend the budget
 * for you. That makes NEIGHBOURING plies incomparable: a position one ply before a discovered
 * check got 94k nodes and missed the tactic, while the position after it — already in check,
 * so extended — got 214k at the same nominal depth and found it. The eval series then shows a
 * cliff on a quiet-looking move, which is a search artifact, not a game event. Nodes spend the
 * same everywhere, so the series is internally comparable. (This is also what lichess/fishnet
 * budget on, for the same reason.)
 *
 * The movetime cap on the nodes arm is a BACKSTOP that must never bind: 500k nodes is ~200ms
 * at the 2-3M nps this binary runs at, against a 6s cap, so binding it would take a box under
 * ~84k nps. If it ever binds, the result stops being reproducible for that ply.
 */
export type JieqiEvalBudget =
  | { nodes: number; movetimeMs: number; depth?: undefined }
  | { depth: number; movetimeMs: number; nodes?: undefined };

function jieqiGoCommand(opts: JieqiEvalBudget): string {
  return opts.nodes != null
    ? `go nodes ${Math.max(1, Math.floor(opts.nodes))} movetime ${opts.movetimeMs}`
    : `go depth ${Math.max(1, Math.floor(opts.depth))} movetime ${opts.movetimeMs}`;
}

/** The exact UCI block a fixed-budget analysis eval sends. Exported so the analysis
 *  resource options (fixed Hash, single thread) are testable: a cached sweep is keyed
 *  by (room, engine, depth) and promises a CPU-independent result, which a second
 *  search thread would not preserve. */
export function buildJieqiAnalysisCommands(
  fen: string,
  opts: JieqiEvalBudget & { moves?: readonly string[] },
): string[] {
  return [
    'uci',
    ...netOption(),
    ...jieqiAnalysisResourceOptions(),
    'ucinewgame',
    'isready',
    buildJieqiPositionCommand(fen, opts.moves),
    jieqiGoCommand(opts),
  ];
}

// Whole-game ANALYSIS eval (distinct from the playable move provider above): read PikaJieQi's
// `info … score` for a redacted current-position FEN, side-to-move POV. Unlike the 3 custom
// engines, Pikafish ALREADY emits `info score` — no engine change was needed here, so this just
// reads what the binary already prints. The dial is a fixed search DEPTH (CPU-independent
// result, so the cached analysis stays stable) with a movetime cap bounding latency. Gated
// through the dedicated ANALYSIS pool so a sweep can never occupy a live bot-move slot. Caller
// owns POV normalization; the redacted (as-played info-state) FEN is sent as-is — the engine
// never sees a hidden id.
export async function evaluateJieqiFen(
  fen: string,
  opts: JieqiEvalBudget & { moves?: readonly string[] },
): Promise<UciEval> {
  const commands = buildJieqiAnalysisCommands(fen, opts);
  const release = await analysisPool.acquire();
  try {
    return await runUciEval({
      bin: pikaJieqiPath(),
      commands,
      timeoutMs: opts.movetimeMs + 4_000,
      timeoutMessage: 'pikafish-jieqi eval timed out',
    });
  } finally {
    release();
  }
}

/** One analysis eval request on a session: the budget, the repetition window, and two
 *  per-request switches a shared session needs because it outlives any one search. */
export type JieqiAnalysisRequest = JieqiEvalBudget & {
  moves?: readonly string[];
  /** Clear the hash (`ucinewgame`) before this search, so its result depends only on
   *  (fen, moves, budget) and not on what the session searched before. The decisions
   *  pass sets it: its evals used to run one process each, and keep that contract. */
  fresh?: boolean;
};

/** The evaluators an analysis session hands its caller. Scores are side-to-move POV. */
export type JieqiAnalysisEvaluators = {
  evaluateFen: (fen: string, opts: JieqiAnalysisRequest) => Promise<UciEval>;
  /** The ranked MultiPV table for one search. MultiPV is set per request, so a single
   *  eval on the same session never inherits the table's width. */
  multiPv: (
    fen: string,
    opts: JieqiAnalysisRequest & { multiPv: number },
  ) => Promise<UciMultiPvLine[]>;
};

function jieqiAnalysisSessionSpec(engine: JieqiAnalysisEngine) {
  return engine === 'ab-jchess'
    ? {
        bin: abJchessPath(),
        name: 'ab-jchess-analysis',
        pool: abJchessAnalysisPool,
      }
    : {
        bin: pikaJieqiPath(),
        name: 'pikafish-jieqi-analysis',
        pool: analysisPool,
      };
}

/**
 * Run `fn` with evaluators backed by ONE persistent analysis process (the xiangqi #168
 * pattern): binary spawn + option setup + net load happen once for the whole run, then
 * each position is a `position fen …` + `go` round-trip built by the SAME
 * jieqiGoCommand the per-spawn path uses, so eval semantics are unchanged. `engine`
 * picks the binary (jieqiAnalysisEngine() by default: AB-JChess when it resolves). The
 * sweep and the decisions pass both run here: decisions used to spawn a process per
 * eval, several hundred per game, which for AB-JChess would mean reloading a 133 MB net
 * each time. Scores are side-to-move POV; the caller owns normalization, and the
 * redacted FEN is sent as-is (the engine never sees a hidden id). Holds one slot of the
 * engine's analysis pool for the duration, so a run never occupies a live bot-move
 * slot, and the session is always killed on the way out: nothing is left parked between
 * runs, so an idle server holds no analysis process.
 *
 * SURVIVES AN ENGINE DEATH. A whole-game sweep walks 40-100+ positions through ONE
 * process, so without recovery a single engine exit fails the entire sweep — and
 * PikaJieQi (a research fork with its assertions compiled out) does crash: it can
 * play a general capture and segfault, deterministically, on a warm process. See
 * mistboard-engine lab/jieqi-darkmove-2026-08-31/CRASH_FINDINGS.md. The live
 * bot-move path is immune because it spawns per move; this one is not, so it
 * respawns and retries the eval that died. Bounded, because an engine dying on
 * every position is a real failure and must surface rather than spin.
 */
export async function withJieqiAnalysisSession<T>(
  fn: (
    evaluateFen: JieqiAnalysisEvaluators['evaluateFen'],
    multiPv: JieqiAnalysisEvaluators['multiPv'],
  ) => Promise<T>,
  engine: JieqiAnalysisEngine = jieqiAnalysisEngine(),
): Promise<T> {
  const spec = jieqiAnalysisSessionSpec(engine);
  const initCommands = buildJieqiAnalysisInitCommands(engine);
  const release = await spec.pool.acquire();
  const spawnSession = () => new UciEngineSession({ bin: spec.bin, name: spec.name, initCommands });
  let session = spawnSession();
  let respawns = 0;
  const request = (fen: string, opts: JieqiAnalysisRequest, multiPv: number) => ({
    positionCommand: [
      opts.fresh ? 'ucinewgame' : null,
      `setoption name MultiPV value ${Math.max(1, Math.floor(multiPv))}`,
      buildJieqiPositionCommand(fen, opts.moves),
    ]
      .filter((line): line is string => line !== null)
      .join('\n'),
    goCommand: jieqiGoCommand(opts),
    timeoutMs: opts.movetimeMs + 4_000,
    timeoutMessage: `${spec.name} eval timed out`,
  });
  // Only a DEAD session is worth respawning for. A rejection from a session that is
  // still alive is a real error and must surface unchanged.
  const withRespawn = async <R>(run: (s: UciEngineSession) => Promise<R>): Promise<R> => {
    try {
      return await run(session);
    } catch (err) {
      if (!session.failed || respawns >= ANALYSIS_SESSION_MAX_RESPAWNS) throw err;
      respawns += 1;
      logger.warn(
        { err: String(err), engine, respawns, max: ANALYSIS_SESSION_MAX_RESPAWNS },
        'jieqi analysis session died mid-run; respawning and retrying the eval',
      );
      session.close();
      session = spawnSession();
      await session.ready();
      return await run(session);
    }
  };
  try {
    await session.ready();
    return await fn(
      (fen, opts) => withRespawn((s) => s.evalPosition(request(fen, opts, 1))),
      async (fen, opts) =>
        (await withRespawn((s) => s.multiPvPosition(request(fen, opts, opts.multiPv)))).lines,
    );
  } finally {
    session.close();
    release();
  }
}

export function jieqiEngineDisplayName(engineId: string): string {
  return jieqiEngineTierFor(engineId)?.name ?? engineId;
}

export function isJieqiEngineClientId(clientId: string | undefined): boolean {
  return jieqiEngineTierFor(clientId) !== null;
}

export function jieqiEngineVersion(clientId: string | undefined): string | null {
  const tier = jieqiEngineTierFor(clientId);
  if (!tier) return null;
  return tier.engine === 'ab-jchess' ? ABJCHESS_JIEQI_ENGINE_VERSION : JIEQI_ENGINE_VERSION;
}

// `moves`: the quiet plies since the last irreversible move (capture OR reveal), with `fen`
// being the position at that point. Pikafish replays them to build its position stack, which
// activates is_repeated() (gated on pliesFromNull>=4) so it honors xiangqi repetition /
// perpetual-check / perpetual-chase rules instead of being blind to threefold. Omit for the
// prior FEN-only behavior. Safe under redaction: a window has no reveal, so the window-start
// FEN's dark tiles stay dark and the replayed moves are all of already-revealed pieces.
export type JieqiEngineOptions = {
  movetimeMs?: number;
  depth?: number;
  moves?: readonly string[];
  /** True for a game's first engine move: a parked process still carries the previous
   *  game's hash table, and `ucinewgame` clears it before the search. */
  newGame?: boolean;
  /** Skill Level for a ladder tier (see pickSkillMove); omitted = full strength. */
  skill?: number;
  /** Uniform [0,1) source for the skill pick; injectable for deterministic tests. */
  rng?: () => number;
  /** The binary (JieqiEngineTier.engine); omitted = PikaJieQi. */
  engine?: 'ab-jchess';
};

// Stockfish's Skill Level, applied outside the engine. Stockfish (search.cpp,
// Skill::pick_best) searches with at least 4 PVs and then, for each candidate, adds a
// push that is bigger the weaker the level: a deterministic share of how much worse the
// move is, plus a random share of the top-to-4th spread (capped at a pawn). The highest
// score + push wins, so low levels drift to worse moves on purpose and high levels pick
// among near-equals at random. The formula is linear in the scores, so running it on UCI
// centipawns with the cap at 100 cp is the same pick as on internal units.
// One deviation: Stockfish picks at depth 1 + level when a non-negative level reaches it
// mid-search; this picks from the final table. With the ladder's depth caps that matters
// only for level 4 (skill 3, cap 5: Stockfish would pick at depth 4).
export const JIEQI_SKILL_MULTIPV = 4;
const SKILL_PAWN_CP = 100;
const SKILL_MATE_SCORE = 32_000;

function skillScore(line: Pick<UciMultiPvLine, 'cp' | 'mate'>): number {
  if (line.mate !== null) {
    return line.mate > 0 ? SKILL_MATE_SCORE - line.mate : -SKILL_MATE_SCORE - line.mate;
  }
  return line.cp ?? 0;
}

export function pickSkillMove(
  lines: readonly UciMultiPvLine[],
  skill: number,
  rng: () => number = Math.random,
): UciMultiPvLine | null {
  const ranked = [...lines]
    .filter((line) => line.move !== '')
    .sort((a, b) => a.index - b.index)
    .slice(0, JIEQI_SKILL_MULTIPV);
  if (ranked.length === 0) return null;
  const top = skillScore(ranked[0]!);
  const delta = Math.min(top - skillScore(ranked.at(-1)!), SKILL_PAWN_CP);
  const weakness = 120 - 2 * skill;
  let maxScore = Number.NEGATIVE_INFINITY;
  let best: UciMultiPvLine = ranked[0]!;
  for (const line of ranked) {
    const score = skillScore(line);
    const random = Math.floor(rng() * weakness);
    const push = Math.trunc((weakness * (top - score) + delta * random) / 128);
    if (score + push >= maxScore) {
      maxScore = score + push;
      best = line;
    }
  }
  return best;
}

export function buildJieqiPositionCommand(fen: string, moves: readonly string[] = []): string {
  return moves.length > 0 ? `position fen ${fen} moves ${moves.join(' ')}` : `position fen ${fen}`;
}

/**
 * Ask PikaJieQi for a move given a redacted FEN (see jieqi-fen.ts) and an optional
 * repetition window (`opts.moves`; see JieqiEngineOptions). Returns the engine's bestmove in
 * Pikafish UCI (rank 0..9, e.g. "e7a7") or null. The FEN is server-built and trusted.
 */
export async function jieqiLiveEngineMove(
  engineId: string,
  fen: string,
  opts: {
    movetimeMs?: number;
    moves?: readonly string[];
    newGame?: boolean;
    rng?: () => number;
  } = {},
): Promise<UciEval> {
  const tier = jieqiEngineTierFor(engineId);
  if (!tier) throw new Error(`unknown Jieqi engine: ${engineId}`);
  const release = await enginePool.acquire();
  try {
    return await jieqiEngineSearch(fen, {
      depth: tier.depth,
      movetimeMs: opts.movetimeMs ?? tier.movetimeMs,
      moves: opts.moves,
      newGame: opts.newGame,
      skill: tier.skill,
      rng: opts.rng,
      engine: tier.engine,
    });
  } finally {
    release();
  }
}

/** The `uci` … `isready` handshake a live session is spawned with. Hash and Threads are
 *  set here, once per process lifetime; AB-JChess loads its net here too. */
export function buildJieqiLiveInitCommands(engine?: 'ab-jchess'): string[] {
  const net =
    engine === 'ab-jchess' ? [`setoption name EvalFile value ${abJchessNetPath()}`] : netOption();
  return ['uci', ...net, ...jieqiLiveResourceOptions(), 'ucinewgame', 'isready'];
}

/** The `go` line for a live move: a depth cap (if any) stops the search early for the
 *  weaker tiers; movetime bounds latency on the deep tiers. `go depth N movetime T`
 *  halts at whichever hits first. */
export function buildJieqiGoCommand(opts: JieqiEngineOptions = {}): string {
  const movetimeMs = opts.movetimeMs ?? 500;
  const depth = opts.depth !== undefined ? Math.max(1, Math.floor(opts.depth)) : null;
  return depth === null ? `go movetime ${movetimeMs}` : `go depth ${depth} movetime ${movetimeMs}`;
}

/** The exact UCI block a live bot move amounts to, in the order a warm session sends
 *  it over its lifetime (handshake once, then position + go per move). Exported so the
 *  resource options and go-limit wiring are unit-testable without spawning the binary. */
export function buildJieqiLiveCommands(fen: string, opts: JieqiEngineOptions = {}): string[] {
  return [
    ...buildJieqiLiveInitCommands(opts.engine),
    buildJieqiPositionCommand(fen, opts.moves),
    buildJieqiGoCommand(opts),
  ];
}

// Parked live-move processes, keyed by binary + handshake, so PikaJieQi and AB-JChess
// park separately. enginePool above still caps how many run at once, so at most that
// many of each are ever parked; an AB-JChess one holds its 133 MB net besides the hash. The idle TTL is long on purpose: a reaped session
// means the next player pays the spawn + hash allocation on their clock, which is the
// exact cost this cache exists to keep off the move path.
const warmSessions = new UciWarmSessionCache({ name: 'pikafish-jieqi', idleTtlMs: 60 * 60_000 });

function jieqiLiveSessionSpec(engine?: 'ab-jchess') {
  return engine === 'ab-jchess'
    ? { bin: abJchessPath(), initCommands: buildJieqiLiveInitCommands(engine), name: 'ab-jchess' }
    : { bin: pikaJieqiPath(), initCommands: buildJieqiLiveInitCommands(), name: 'pikafish-jieqi' };
}

export async function jieqiEngineMove(
  fen: string,
  opts: JieqiEngineOptions = {},
): Promise<string | null> {
  return (await jieqiEngineSearch(fen, opts)).best;
}

/**
 * The same move request, but returning the whole search summary rather than just
 * the move. Live play takes this one so the per-move decision artifact can record
 * the depth the search actually reached next to the tier's depth cap and the
 * movetime the server allotted; PikaJieQi has no Skill Level knob, so depth
 * reached against depth configured IS the strength question for this engine.
 */
export async function jieqiEngineSearch(
  fen: string,
  opts: JieqiEngineOptions = {},
): Promise<UciEval> {
  const movetimeMs = opts.movetimeMs ?? 500;
  const position = buildJieqiPositionCommand(fen, opts.moves);
  const skilled = opts.skill !== undefined;
  // Parked sessions are shared by every tier, so each move sets MultiPV itself: a
  // full-strength move must not inherit a ladder tier's 4 lines (it would search the
  // same depth in a quarter of the nodes per line).
  const prefix = [
    opts.newGame ? 'ucinewgame' : null,
    `setoption name MultiPV value ${skilled ? JIEQI_SKILL_MULTIPV : 1}`,
  ].filter((line): line is string => line !== null);
  const request = {
    // `ucinewgame` on a game's first move clears the previous game's hash: a memset of
    // pages already resident, ~50 ms, no allocation.
    positionCommand: [...prefix, position].join('\n'),
    goCommand: buildJieqiGoCommand(opts),
    timeoutMs: movetimeMs + 4000,
    timeoutMessage: 'pikafish-jieqi move timed out',
  };
  const spec = jieqiLiveSessionSpec(opts.engine);
  if (!skilled) {
    return warmSessions.withSession(spec, (session) => session.evalPosition(request));
  }
  const table = await warmSessions.withSession(spec, (session) => session.multiPvPosition(request));
  const picked = pickSkillMove(table.lines, opts.skill!, opts.rng);
  // No scored line (a terminal position): keep the engine's own answer.
  if (!picked) return { best: table.best, cp: table.cp, mate: table.mate, depth: table.depth };
  return {
    best: picked.move,
    cp: picked.cp,
    mate: picked.mate,
    depth: picked.depth,
    pv: picked.pv,
  };
}

/**
 * Spawn and park one live session so the first jieqi move after a deploy does not pay
 * the handshake (and, on a fragmented host, the hash allocation stall) on a player's
 * clock. Best-effort: a failure is logged and the first move spawns on demand.
 */
export async function prewarmJieqiEngine(): Promise<void> {
  if (!jieqiEngineBinaryAvailable()) return;
  try {
    await warmSessions.withSession(jieqiLiveSessionSpec(), (session) => session.ready());
    logger.info(
      { kind: 'jieqi_engine_prewarmed', ...warmSessions.stats() },
      'Jieqi live engine session parked',
    );
  } catch (err) {
    logger.warn(
      {
        kind: 'jieqi_engine_prewarm_failed',
        error: err instanceof Error ? err.message : String(err),
      },
      'Jieqi live engine prewarm failed; the first move will spawn on demand',
    );
  }
}

/** Point-in-time warm-session counters (spawned/reused/idle) for diagnostics. */
export function pikafishJieqiWarmSessionStats() {
  return warmSessions.stats();
}
