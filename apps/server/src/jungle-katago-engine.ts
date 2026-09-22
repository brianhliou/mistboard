// KataGo-AnimalChess as a Jungle move provider (#434).
//
// hzyhhzy's KataGomo branch `AnimalChess2025` (MIT, like upstream KataGo) with
// Kouza's `b10c384` net won the jungle challenge on brianhliou.com/challenges:
// 82-0-118 against MistyJungle 0.0.6 at matched time, so the bot seat is its.
// MistyJungle keeps the rungs below it (jungle-engine.ts); this file is the top
// rung only.
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
// move rather than a game. Loading the net costs ~1.0 s (measured, Modal CPU
// container) against ~1.7 s of search at the shipped budget, so a warm session
// would save about a third of the latency; it is not the 2.8 s catastrophe that
// forced warm sessions for jieqi, and a stateless driver is worth more here
// until the seat is busy enough to care.
//
// Strength is a VISIT budget, not a clock: visits are CPU-independent, so the
// bot plays the same strength on a loaded box as on an idle one, and the
// movetime ceiling only bounds latency. Measured 2026-09-22 (lab/modal_katago_speed.py):
// 150 visits is ~1.7 s a move on four cores and ~3.9 s on one. The prod box runs
// ~1.45x slower than that reference and its load swings a search by ~1.5x
// (jungle-engine.ts records the same two effects), so the ceiling has to clear
// ~3.7 s in the worst case: 6 s, the same ceiling MistyJungle carries.

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

/** The engine id the bot seat carries, and the only one a new room may take. */
export const KATAGO_JUNGLE_ENGINE_ID = 'katago-jungle-level-1';

/**
 * Net + engine identity, recorded per game so a configHash means something. The
 * net is Kouza's, dated 2026-02-28, shipped inside Dandelion 4; bump this when
 * either the binary or the net moves.
 */
export const KATAGO_JUNGLE_ENGINE_VERSION = 'animalchess2025-b10c384-20260228';

export type KatagoJungleTier = {
  id: string;
  /** Search budget. 150 measured at 0.690 against MistyJungle over 50 games,
   *  indistinguishable from the 1000 that scored 0.705 over 200 (-0.015 ± 0.075). */
  visits: number;
  /** Latency ceiling. Halts the search at whichever binds first. */
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

export function katagoJungleEngineEnabled(): boolean {
  return process.env.MISTBOARD_KATAGO_JUNGLE_ENGINE === 'true';
}

/** Binary, net and config: an env override each, else the dev build, else the
 *  prod (railpack-fetched) location. Mirrors jungleEnginePath. */
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

export function katagoJungleConfigPath(): string {
  return resolveAsset(
    'MISTBOARD_KATAGO_JUNGLE_CONFIG_PATH',
    ['projects', 'mistboard-engine', 'lab', 'jungle-katago-2026-09-21', 'katago-gtp.cfg'],
    [resolve(process.cwd(), 'bin', 'katago-jungle.cfg'), '/app/bin/katago-jungle.cfg'],
    'config',
  );
}

/** True iff every piece resolves on this box, so the server can fall back to
 *  MistyJungle when the flag is on but the assets were not shipped. */
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
  const { board, side } = toKatagoFen(fen);
  const colour = katagoGenmoveColor(mover);
  // maxVisits is the strength dial; maxTime is the ceiling. Both are overridden
  // per call rather than baked into the config, so a tier is one place.
  const commands = [
    `kata-set-param maxVisits ${visits}`,
    `kata-set-param maxTime ${(movetimeCapMs / 1000).toFixed(2)}`,
    `setfen ${board} ${side}`,
    `genmove ${colour}`,
    `genmove ${colour}`,
    'quit',
  ];
  // Timed around the whole call, process start included: what the seat's clock
  // is charged is the wall time, not the search's own idea of it.
  const started = Date.now();
  return runKatagoGtp(commands, movetimeCapMs * 2 + 8_000).then((replies) => ({
    best: katagoMoveFromReplies(replies),
    visits,
    elapsedMs: Date.now() - started,
    replies,
  }));
}

/**
 * The move out of a GTP transcript, or null.
 *
 * The two halves of the move are the LAST two vertex replies: everything before
 * them acknowledges a parameter or the position, and those acknowledgements are
 * empty ("= "), so they cannot be mistaken for a square. A pass, a resignation
 * or an error ("?") leaves fewer than two, which is null rather than a guess —
 * the engine-move guard turns that into the same fallback every other engine's
 * bad reply gets.
 */
export function katagoMoveFromReplies(replies: readonly string[]): string | null {
  const vertices = replies
    .filter((reply) => /^=\s*[A-Ga-g][1-9]\s*$/.test(reply))
    .map((reply) => reply.replace(/^=\s*/, '').trim());
  if (vertices.length < 2) return null;
  const from = fromKatagoVertex(vertices[vertices.length - 2] as string);
  const to = fromKatagoVertex(vertices[vertices.length - 1] as string);
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
    child.stdin.write(`${commands.join('\n')}\n`);
    child.stdin.end();
  });
}
