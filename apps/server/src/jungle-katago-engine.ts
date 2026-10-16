// KataGo-AnimalChess as a Jungle move provider (#434).
//
// hzyhhzy's KataGomo branch `AnimalChess2025` (MIT, like upstream KataGo) with
// Kouza's `b10c384` net won the jungle challenge on brianhliou.com/challenges:
// 82-0-118 against MistyJungle 0.0.6 at matched time, so the bot seat is its.
// MistyJungle keeps the rung below it (jungle-engine.ts); this file is the top
// rung only. hzyhhzy agreed to the site running his engine with that net
// (hzyhhzy/KataGomo#12), credited on the bot page and /source.
//
// It speaks GTP, not UCI, so it cannot ride uci-engine-harness. Two differences
// from every other engine we drive:
//
//   1. A move is TWO `genmove` calls. The board has a per-move stage (pick the
//      piece, then the square), so one turn is two GTP replies, each a vertex.
//   2. Its board is our left-right mirror and J is its leopard. The mapping is
//      in @mistboard/game (jungle-katago-gtp.ts) rather than here, because the
//      match harness that rated this engine has to use the identical one; if
//      they drifted, the engine we rated would not be the engine we serve.
//
// One process per move, like the MistyJungle driver: `setfen` restores the whole
// position, so nothing is carried between moves and a crashed engine costs one
// move rather than a game. It is also the RAM choice, and RAM is what the web
// box pays for: each Eigen thread holds its own transformed copy of the net, so
// the process peaks near 1 GB on four threads (katago-jungle-gtp.cfg has the
// measurements) and a warm session would hold that all day for a seat that
// moves a few hundred times. Loading the net costs ~1 s against ~1.7 s of search.
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

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  fromKatagoVertex,
  type JungleColor,
  katagoGenmoveColor,
  toKatagoFen,
} from '@mistboard/game';
import { logger } from './obs.js';
import { resolveFsfVariantIniPath, type UciEval } from './uci-engine-harness.js';

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

// What a move pays before either search starts: spawning the process and
// loading the net (~1 s measured). The rest of the ceiling is split between the
// two stages.
const STARTUP_RESERVE_MS = 1_000;
// Each stage searches at least this long, whatever the clock says. With only a
// handful of visits the second stage can answer "pass", which in this engine is
// a forfeit rather than a move (seen at 8 visits, never at 16 or more in
// linux/amd64 smoke runs); 300 ms is ~50 visits on the reference box.
const MIN_STAGE_MS = 300;

/** Per-stage `maxTime` in seconds for a move whose whole budget is `movetimeCapMs`. */
export function katagoStageSeconds(movetimeCapMs: number): number {
  const perStage = Math.max(MIN_STAGE_MS, (movetimeCapMs - STARTUP_RESERVE_MS) / 2);
  return Math.round(perStage) / 1000;
}

/** The GTP script for one move: budget, position, then the two stages. */
export function katagoMoveCommands(
  fen: string,
  mover: JungleColor,
  opts: { visits: number; movetimeCapMs: number },
): string[] {
  const { board, side } = toKatagoFen(fen);
  const colour = katagoGenmoveColor(mover);
  // maxVisits is the strength dial; maxTime is the ceiling, per genmove. Both are
  // set per call rather than baked into the config, so a tier is one place.
  return [
    `kata-set-param maxVisits ${opts.visits}`,
    `kata-set-param maxTime ${katagoStageSeconds(opts.movetimeCapMs).toFixed(3)}`,
    `setfen ${board} ${side}`,
    `genmove ${colour}`,
    `genmove ${colour}`,
    'quit',
  ];
}

export type KatagoJungleResult = {
  /** The move in our coordinates ("a1b1"), or null when the engine passed,
   *  resigned or answered with something that is not a square. */
  best: string | null;
  /** What it was asked for and what it spent, for the decision artifact. */
  visits: number;
  elapsedMs: number;
  /** The raw GTP replies, kept for the artifact when something goes wrong. */
  replies: string[];
};

/**
 * One move from a full-board FEN. The FEN is server-built and trusted; the
 * engine's reply is not, so a vertex it does not recognise comes back as null
 * and the caller's engine-move guard decides what to do (it validates every
 * engine move against the kernel before it is appended, as it does for every
 * other engine).
 */
export function katagoJungleMove(
  fen: string,
  mover: JungleColor,
  opts: { visits?: number; movetimeCapMs?: number } = {},
): Promise<KatagoJungleResult> {
  const visits = opts.visits ?? 150;
  const movetimeCapMs = opts.movetimeCapMs ?? 6_000;
  const commands = katagoMoveCommands(fen, mover, { visits, movetimeCapMs });
  // Timed around the whole call, process start included: what the seat's clock
  // is charged is the wall time, not the search's own idea of it.
  const started = Date.now();
  return runKatagoGtp(commands, movetimeCapMs + MIN_STAGE_MS * 2 + 8_000).then((replies) => ({
    best: katagoMoveFromReplies(replies),
    visits,
    elapsedMs: Date.now() - started,
    replies,
  }));
}

/**
 * The same move in the shape the jungle seat and the EvE runner record for every
 * engine (UciEval). KataGo reports no score or depth on this path, so those stay
 * empty and only the move and the wall time are real.
 */
export async function katagoJungleLiveEngineMove(
  fen: string,
  mover: JungleColor,
  opts: { visits?: number; movetimeCapMs?: number } = {},
): Promise<UciEval> {
  const result = await katagoJungleMove(fen, mover, opts);
  if (result.best === null) {
    logger.warn({
      kind: 'katago_jungle_no_move',
      replies: result.replies.slice(-4),
      elapsed_ms: result.elapsedMs,
    });
  }
  return { best: result.best, cp: null, mate: null, depth: 0, timeMs: result.elapsedMs };
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

/** Drive one GTP process to completion, collecting its replies. */
function runKatagoGtp(commands: string[], timeoutMs: number): Promise<string[]> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      katagoJungleEnginePath(),
      ['gtp', '-model', katagoJungleNetPath(), '-config', katagoJungleConfigPath()],
      { stdio: ['pipe', 'pipe', 'ignore'] },
    );
    const replies: string[] = [];
    let buffer = '';
    let settled = false;
    const done = (err: Error | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      if (err) reject(err);
      else resolvePromise(replies);
    };
    const timer = setTimeout(() => {
      logger.warn({ kind: 'katago_jungle_timeout', timeoutMs, replies: replies.length });
      done(new Error('katago-jungle move timed out'));
    }, timeoutMs);
    timer.unref();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      let nl = buffer.indexOf('\n');
      while (nl >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line.startsWith('=') || line.startsWith('?')) replies.push(line);
        nl = buffer.indexOf('\n');
      }
    });
    child.on('error', (err) => done(err as Error));
    child.on('exit', () => done(null));
    child.stdin.on('error', () => {
      // The process can die before it reads stdin (a missing net); 'exit' reports it.
    });
    child.stdin.write(`${commands.join('\n')}\n`);
    child.stdin.end();
  });
}
