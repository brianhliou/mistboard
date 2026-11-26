// KataGo-AnimalChess as a Jungle move provider (#434).
//
// hzyhhzy's KataGomo branch `AnimalChess2025` (MIT, like upstream KataGo) with
// Kouza's `b10c384` net won the jungle challenge on brianhliou.com/challenges:
// 82-0-118 against MistyJungle 0.0.6 at matched time, so the bot seat is its.
// MistyJungle keeps the rung below it (jungle-engine.ts); this file is the top
// rung only. hzyhhzy agreed to the site running his engine with that net
// (hzyhhzy/KataGomo#12), credited on the bot page and /source.
//
// It speaks GTP, not UCI; it shares the harness's capacity gates, but has its own
// command/response driver. Two differences
// from every other engine we drive:
//
//   1. A move is TWO `genmove` calls. The board has a per-move stage (pick the
//      piece, then the square), so one turn is two GTP replies, each a vertex.
//   2. Its board is our left-right mirror and J is its leopard. The mapping is
//      in @mistboard/game (jungle-katago-gtp.ts) rather than here, because the
//      match harness that rated this engine has to use the identical one; if
//      they drifted, the engine we rated would not be the engine we serve.
//
// One warm process, shared by every jungle game and the EvE runner
// (jungle-katago-session.ts). Loading the net is ~0.5 s on this Mac and ~1.65 s
// on prod, which a process per move paid on every move: at 1+1 that is more
// than the increment, and the seat lost a won game on time (jgl_29484585,
// 2026-11-12). The process holds ~1 GB while it lives (katago-jungle-gtp.cfg
// has the measurements), so it exits after 10 idle minutes and is parked with
// the total engine-process cap meanwhile. Nothing is carried between moves:
// every move clears the board and the search cache and sets the full position.
// Decided 2026-11-25: no weaker engine stands in when the clock is short; the
// shared process is the fix, and 1+1 stays on offer.
//
// Strength is a VISIT budget, not a clock: visits are CPU-independent, so the
// bot plays the same strength on a loaded box as on an idle one, and the
// movetime ceiling only bounds latency. Measured 2026-09-22 (lab/modal_katago_speed.py):
// 150 visits is ~1.7 s a move on four cores and ~3.9 s on one. The prod box runs
// ~1.45x slower than that reference and its load swings a search by ~1.5x
// (jungle-engine.ts records the same two effects), so the ceiling has to clear
// ~3.7 s in the worst case: 6 s, the same ceiling MistyJungle carries.
//
// There is no flag. Like AB-JChess, the seat is offered exactly where its binary,
// net and config resolve (katagoJungleAvailable): railpack fetches the binary
// from our engines release and the net from Kouza's Dandelion release, so prod
// has both and a dev box without them never seats a bot that cannot move.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  fromKatagoVertex,
  type JungleColor,
  katagoGenmoveColor,
  toKatagoFen,
} from '@mistboard/game';
import {
  gtpProcessSpawner,
  KATAGO_SESSION_START_TIMEOUT_MS,
  KatagoJungleSession,
} from './jungle-katago-session.js';
import { logger } from './obs.js';
import { boundedEnvInt, resolveFsfVariantIniPath, type UciEval } from './uci-engine-harness.js';

/** The engine id the top jungle seat carries. Named for its engine, not a level,
 *  like AB-JChess: a stronger engine can replace it without redefining a rung. */
export const KATAGO_JUNGLE_ENGINE_ID = 'katago-jungle';

/**
 * Binary + net identity, recorded per game so a configHash means something:
 * the KataGomo commit (katago-jungle.ref) and Kouza's b10c384 net dated
 * 2026-02-28 from Dandelion 4. Bump it when either moves.
 */
export const KATAGO_JUNGLE_ENGINE_VERSION = 'animalchess2025-f7743af9-b10c384-20260228';

/** The GTP config the seat runs, in this directory (railpack also loads it). */
export const KATAGO_JUNGLE_CONFIG_FILE = 'katago-jungle-gtp.cfg';

export type KatagoJungleTier = {
  id: string;
  /** Search budget per stage of the move. 150 measured at 0.690 against
   *  MistyJungle over 50 games, indistinguishable from the 1,000 that scored
   *  0.705 over 200 (-0.015 ± 0.075). */
  visits: number;
  /** Latency ceiling for the whole move, process start included. */
  movetimeCapMs: number;
};

const KATAGO_JUNGLE_TIERS: ReadonlyMap<string, KatagoJungleTier> = new Map([
  [KATAGO_JUNGLE_ENGINE_ID, { id: KATAGO_JUNGLE_ENGINE_ID, visits: 150, movetimeCapMs: 6_000 }],
]);

export const KATAGO_JUNGLE_TIER_LIST: readonly KatagoJungleTier[] = [
  ...KATAGO_JUNGLE_TIERS.values(),
];

export function katagoJungleTierFor(engineId: string | undefined): KatagoJungleTier | null {
  if (!engineId) return null;
  return KATAGO_JUNGLE_TIERS.get(engineId) ?? null;
}

/** Binary or net: an env override, else the dev build, else the prod
 *  (railpack-fetched) location. Mirrors jungleEnginePath. */
function resolveAsset(envVar: string, dev: string[], candidates: string[], label: string): string {
  const explicit = process.env[envVar];
  if (explicit) {
    const resolved = resolve(explicit);
    if (!existsSync(resolved)) {
      throw new Error(`${envVar} points at ${resolved} but ${label} does not exist there`);
    }
    return resolved;
  }
  const home = process.env.HOME;
  if (home) {
    const devPath = resolve(home, ...dev);
    if (existsSync(devPath)) return devPath;
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`KataGo jungle ${label} not found. Set ${envVar}.`);
}

export function katagoJungleEnginePath(): string {
  return resolveAsset(
    'MISTBOARD_KATAGO_JUNGLE_ENGINE_PATH',
    ['projects', 'tools', 'KataGomo-animalchess', 'cpp', 'build', 'katago'],
    [resolve(process.cwd(), 'bin', 'katago-jungle'), '/app/bin/katago-jungle'],
    'binary',
  );
}

export function katagoJungleNetPath(): string {
  return resolveAsset(
    'MISTBOARD_KATAGO_JUNGLE_NET_PATH',
    ['projects', 'mistboard-engine', 'lab', 'jungle-katago-2026-09-21', 'b10c384nbt.bin.gz'],
    [
      resolve(process.cwd(), 'bin', 'katago-jungle-net.bin.gz'),
      '/app/bin/katago-jungle-net.bin.gz',
    ],
    'net',
  );
}

/** The repo's config (src/, or ../src from dist/); an env override for experiments. */
export function katagoJungleConfigPath(): string {
  const explicit = process.env.MISTBOARD_KATAGO_JUNGLE_CONFIG_PATH;
  if (explicit) {
    const resolved = resolve(explicit);
    if (!existsSync(resolved)) {
      throw new Error(
        `MISTBOARD_KATAGO_JUNGLE_CONFIG_PATH points at ${resolved} but the config does not exist there`,
      );
    }
    return resolved;
  }
  return resolveFsfVariantIniPath(KATAGO_JUNGLE_CONFIG_FILE);
}

/** True iff binary, net and config all resolve on this box: the seat is offered
 *  (and a room may be created against it) only then. */
export function katagoJungleAvailable(): boolean {
  try {
    katagoJungleEnginePath();
    katagoJungleNetPath();
    katagoJungleConfigPath();
    return true;
  } catch {
    return false;
  }
}

// The ceiling's stage split reserves this much for everything that is not a
// search, as it always has, so a move at the tier ceiling (10+5, untimed) is the
// same two 2.5 s stages it always was.
const STARTUP_RESERVE_MS = 1_000;
// Each stage searches at least this long, whatever the clock says. With only a
// handful of visits the second stage can answer "pass", which in this engine is
// a forfeit rather than a move (seen at 8 visits, never at 16 or more in
// linux/amd64 smoke runs); 300 ms is ~50 visits on the reference box.
const MIN_STAGE_MS = 300;

// A cold start: spawn and net load until the engine answers. Measured
// 2026-11-25: 437-518 ms on this Mac (12 runs); on prod the 1+1 game
// jgl_29484585 spent 2,230 ms on a move whose stages were both at the minimum,
// so the start there is ~1.63 s, about 3.3x this Mac. Only the first move after
// an idle close (or a crash) pays it; a prewarm at room creation hides it.
export const KATAGO_JUNGLE_STARTUP_MS = 1_650;
// What a move on the loaded process pays beyond its two stages: the setup
// replies and the two genmove round trips. A move at two 300 ms stages took
// 655 ms on this Mac (55 ms over, 2026-11-25); 3.3x for prod and rounded up.
export const KATAGO_JUNGLE_WARM_OVERHEAD_MS = 250;
/** The cheapest move KataGo can make on prod with the process loaded. */
export const KATAGO_JUNGLE_MIN_MOVE_MS = KATAGO_JUNGLE_WARM_OVERHEAD_MS + MIN_STAGE_MS * 2;
/** The same after a cold start, which only an idle close or a crash costs. */
export const KATAGO_JUNGLE_COLD_MIN_MOVE_MS = KATAGO_JUNGLE_STARTUP_MS + MIN_STAGE_MS * 2;
// Past both stages' maxTime the engine has had every chance to answer; a process
// still silent after this much more is stuck, and is killed.
const REPLY_SLACK_MS = 3_000;

/** Per-stage `maxTime` in seconds at the ceiling split for a `movetimeCapMs` budget. */
export function katagoStageSeconds(movetimeCapMs: number): number {
  const perStage = Math.max(MIN_STAGE_MS, (movetimeCapMs - STARTUP_RESERVE_MS) / 2);
  return Math.round(perStage) / 1000;
}

/**
 * Per-stage `maxTime` for a move whose whole wall budget is `movetimeCapMs`,
 * once it reaches the process after `waitedMs` (its queue wait, plus the start
 * when the process was cold). Never more than the ceiling split, so a move with
 * time to spare plays as it did; never less than the minimum stage.
 */
export function katagoStageSecondsForMove(movetimeCapMs: number, waitedMs = 0): number {
  const ceilingStage = Math.max(MIN_STAGE_MS, (movetimeCapMs - STARTUP_RESERVE_MS) / 2);
  const fitted = (movetimeCapMs - waitedMs - KATAGO_JUNGLE_WARM_OVERHEAD_MS) / 2;
  return Math.round(Math.max(MIN_STAGE_MS, Math.min(ceilingStage, fitted))) / 1000;
}

/** How long the loaded process may take to answer one move at a `movetimeCapMs` budget. */
export function katagoMoveDeadlineMs(movetimeCapMs: number): number {
  return Math.round(katagoStageSeconds(movetimeCapMs) * 1000) * 2 + REPLY_SLACK_MS;
}

/**
 * The GTP exchange for one move on the shared process: wipe what the last move
 * left (board, history, search tree), set the budget and the full position,
 * then the two stages. No `quit`: the process stays for the next move.
 */
export function katagoMoveCommands(
  fen: string,
  mover: JungleColor,
  opts: { visits: number; movetimeCapMs: number; waitedMs?: number },
): string[] {
  const { board, side } = toKatagoFen(fen);
  const colour = katagoGenmoveColor(mover);
  const stage = katagoStageSecondsForMove(opts.movetimeCapMs, opts.waitedMs ?? 0);
  // maxVisits is the strength dial; maxTime is the ceiling, per genmove. Both are
  // set per call rather than baked into the config, so a tier is one place.
  return [
    'clear_board',
    'clear_cache',
    `kata-set-param maxVisits ${opts.visits}`,
    `kata-set-param maxTime ${stage.toFixed(3)}`,
    `setfen ${board} ${side}`,
    `genmove ${colour}`,
    `genmove ${colour}`,
  ];
}

/** The setup commands before the two genmoves; a refusal of any is no move. */
const SETUP_COMMANDS = 5;

export type KatagoJungleResult = {
  /** The move in our coordinates ("a1b1"), or null when the engine passed,
   *  resigned, refused the position or answered with something that is not a square. */
  best: string | null;
  /** What it was asked for and what it spent, for the decision artifact. */
  visits: number;
  elapsedMs: number;
  /** Whether the move found the process loaded ('warm') or started it ('cold'). */
  process: 'warm' | 'cold';
  /** Queue wait plus any start, before the move's commands were sent. */
  waitedMs: number;
  /** The raw GTP replies, kept for the artifact when something goes wrong. */
  replies: string[];
};

// The queue waits out a cold start and two worst-case moves at the live 6 s
// ceiling (the one running and the one ahead): 26 s, under the 30 s cap
// MISTBOARD_KATAGO_JUNGLE_QUEUE_TIMEOUT_MS is clamped to.
export const KATAGO_JUNGLE_QUEUE_TIMEOUT_MS =
  KATAGO_SESSION_START_TIMEOUT_MS +
  2 * katagoMoveDeadlineMs(KATAGO_JUNGLE_TIERS.get(KATAGO_JUNGLE_ENGINE_ID)!.movetimeCapMs);

/** The GTP command line for the seat's binary, net and config. */
export function katagoJungleCommand(): { bin: string; args: string[] } {
  return {
    bin: katagoJungleEnginePath(),
    args: ['gtp', '-model', katagoJungleNetPath(), '-config', katagoJungleConfigPath()],
  };
}

let sharedSession: KatagoJungleSession | null = null;

/** The one process every jungle game shares; created on first use. */
export function katagoJungleSession(): KatagoJungleSession {
  sharedSession ??= new KatagoJungleSession({
    spawner: gtpProcessSpawner(katagoJungleCommand),
    queueTimeoutMs: () =>
      boundedEnvInt(
        'MISTBOARD_KATAGO_JUNGLE_QUEUE_TIMEOUT_MS',
        KATAGO_JUNGLE_QUEUE_TIMEOUT_MS,
        100,
        30_000,
      ),
  });
  return sharedSession;
}

/** Shutdown: kill the process and fail anything queued. The next use starts afresh. */
export function closeKatagoJungleSession(): void {
  sharedSession?.close('shut down');
  sharedSession = null;
}

/**
 * Load the net now, so a new game's first move does not pay it. Called when a
 * room is created against the KataGo seat; a no-op where the assets do not
 * resolve, and a failure is only logged (the move itself retries the start).
 */
export function prewarmKatagoJungle(session: KatagoJungleSession = katagoJungleSession()): void {
  if (!katagoJungleAvailable()) return;
  void session.prewarm().catch((err: Error) => {
    logger.warn({ kind: 'katago_jungle_prewarm_failed', error: err.message });
  });
}

/**
 * One move from a full-board FEN. The FEN is server-built and trusted; the
 * engine's reply is not, so a vertex it does not recognise comes back as null
 * and the caller's engine-move guard decides what to do (it validates every
 * engine move against the kernel before it is appended, as it does for every
 * other engine). A timeout or a dead process rejects; the session has already
 * killed it, and the next move starts a fresh one.
 */
export async function katagoJungleMove(
  fen: string,
  mover: JungleColor,
  opts: { visits?: number; movetimeCapMs?: number; session?: KatagoJungleSession } = {},
): Promise<KatagoJungleResult> {
  const visits = opts.visits ?? 150;
  const movetimeCapMs = opts.movetimeCapMs ?? 6_000;
  const session = opts.session ?? katagoJungleSession();
  // The stage time is set when the move reaches the process, from what is left
  // of its budget: the seat's clock is charged the wall time, wait included.
  const result = await session.request(({ waitedMs }) => ({
    commands: katagoMoveCommands(fen, mover, { visits, movetimeCapMs, waitedMs }),
    deadlineMs:
      Math.round(katagoStageSecondsForMove(movetimeCapMs, waitedMs) * 1000) * 2 + REPLY_SLACK_MS,
  }));
  const refused = result.replies.slice(0, SETUP_COMMANDS).some((reply) => reply.startsWith('?'));
  return {
    best: refused ? null : katagoMoveFromReplies(result.replies),
    visits,
    elapsedMs: result.totalMs,
    process: result.warm ? 'warm' : 'cold',
    waitedMs: result.waitedMs,
    replies: result.replies,
  };
}

/** What the jungle seat and the EvE runner record for a KataGo move. */
export type KatagoJungleEval = UciEval & { process?: 'warm' | 'cold' };

/**
 * The same move in the shape the jungle seat and the EvE runner record for every
 * engine (UciEval). KataGo reports no score or depth on this path, so those stay
 * empty and only the move and the wall time are real.
 */
export async function katagoJungleLiveEngineMove(
  fen: string,
  mover: JungleColor,
  opts: { visits?: number; movetimeCapMs?: number; session?: KatagoJungleSession } = {},
): Promise<KatagoJungleEval> {
  const result = await katagoJungleMove(fen, mover, opts);
  if (result.best === null) {
    logger.warn({
      kind: 'katago_jungle_no_move',
      replies: result.replies.slice(-4),
      elapsed_ms: result.elapsedMs,
    });
  }
  return {
    best: result.best,
    cp: null,
    mate: null,
    depth: 0,
    timeMs: result.elapsedMs,
    process: result.process,
  };
}

/**
 * The move out of a GTP transcript, or null.
 *
 * The two halves of the move are the LAST two vertex replies: everything before
 * them acknowledges a parameter or the position, and those acknowledgements are
 * empty ("= "), so they cannot be mistaken for a square. A pass, a resignation
 * or an error ("?") leaves fewer than two, which is null rather than a guess:
 * the engine-move guard turns that into the same retry, then resignation, every
 * other engine's bad reply gets.
 */
export function katagoMoveFromReplies(replies: readonly string[]): string | null {
  // Both halves must be the last two replies that carry anything: "= G1" then
  // "= pass" is a forfeited move, not G1 paired with an earlier vertex.
  const tail = replies
    .filter((reply) => reply.replace(/^[=?]\s*/, '').trim() !== '')
    .slice(-2)
    .map((reply) => /^=\s*([A-Ga-g][1-9])\s*$/.exec(reply)?.[1] ?? null);
  if (tail.length < 2 || !tail[0] || !tail[1]) return null;
  const from = fromKatagoVertex(tail[0]);
  const to = fromKatagoVertex(tail[1]);
  return from && to ? `${from}${to}` : null;
}
