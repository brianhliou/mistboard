// A strong engine playing the worst move it can find: Fairy-Stockfish on the
// CC0 xiangqi net Level 8 plays (so no licensed Pikafish weights) scores every
// legal move (MultiPV over the whole root), and the bot plays the one that is
// worst for itself. The scores assume best replies, so the bot steers into
// positions where the opponent has a mate, which puts a mate or a free piece in
// front of the player most turns. A beginner's opponent, after Lichess's
// Worstfish; it is not a rung of the strength ladder, so it stays out of
// XIANGQI_PUBLIC_ENGINES (bot-vs-bot pairing reads that list).
//
// The live loop must skip the immediate-loss guard for this tier: the guard
// exists to stop exactly the moves this bot is for.

import type { UciEval, UciMultiPvLine } from './uci-engine-harness.js';
import { splitFairyStockfishCommands, UciWarmSessionCache } from './uci-engine-harness.js';
import {
  fsfXiangqiUciToPikafishUci,
  pikafishUciToFsfXiangqiUci,
  xiangqiFsfLivePool,
  xiangqiFsfNetPath,
  xiangqiFsfPath,
} from './xiangqi-fsf-engine.js';

export const XIANGQI_WORST_ENGINE_ID = 'fairy-stockfish-xiangqi-worst';
// Bump on any change to the pick rule, budget or engine config.
export const XIANGQI_WORST_ENGINE_VERSION = 'worst-v1';

// Above any xiangqi position's legal move count; the engine caps MultiPV at the
// root move count anyway.
const ALL_ROOT_MOVES = 128;

export type XiangqiWorstEngineTier = {
  id: typeof XIANGQI_WORST_ENGINE_ID;
  name: string;
  // Node budget across all root lines: 300k reaches depth 8-9 on every one of
  // the 44 opening moves (local M-series, 2026-10-17), deep enough to see the
  // opponent's short mates.
  nodes: number;
  movetimeMs: number;
  kind: 'worst';
};

const WORST_TIER: XiangqiWorstEngineTier = {
  id: XIANGQI_WORST_ENGINE_ID,
  name: 'Generous General',
  nodes: 300_000,
  movetimeMs: 1_500,
  kind: 'worst',
};

export function isXiangqiWorstEngine(engineId: string | undefined): boolean {
  return engineId === XIANGQI_WORST_ENGINE_ID;
}

export function xiangqiWorstEngineTierFor(
  engineId: string | undefined,
): XiangqiWorstEngineTier | null {
  return engineId === XIANGQI_WORST_ENGINE_ID ? WORST_TIER : null;
}

// One ordering for every score, side-to-move POV: getting mated sooner is worst,
// then centipawns low to high, then mating the opponent (later mates before
// sooner ones).
function worstnessKey(line: Pick<UciMultiPvLine, 'cp' | 'mate'>): number {
  if (line.mate !== null) {
    return line.mate <= 0 ? -1_000_000 - line.mate : 1_000_000 - line.mate;
  }
  return line.cp ?? 0;
}

/**
 * The lowest-scoring root line, a random one among exact ties so the bot does
 * not repeat itself game to game. Null when the table has no move (a terminal
 * position).
 */
export function pickWorstLine(
  lines: readonly UciMultiPvLine[],
  rng: () => number = Math.random,
): UciMultiPvLine | null {
  const playable = lines.filter((line) => line.move !== '');
  if (playable.length === 0) return null;
  const lowest = Math.min(...playable.map(worstnessKey));
  const worst = playable.filter((line) => worstnessKey(line) === lowest);
  return worst[Math.min(worst.length - 1, Math.floor(rng() * worst.length))]!;
}

// Its own parked process: MultiPV is set at init, so it never leaks into the
// ladder tiers' sessions (keyed on binary + init commands).
const warmSessions = new UciWarmSessionCache({ name: 'xiangqi-fsf-worst' });

export async function xiangqiWorstEngineMove(
  moves: string[],
  opts: { movetimeMs?: number; rng?: () => number } = {},
): Promise<UciEval> {
  const bin = xiangqiFsfPath();
  const movetimeMs = Math.max(1, Math.floor(opts.movetimeMs ?? WORST_TIER.movetimeMs));
  const { init, position, go } = splitFairyStockfishCommands({
    moves: moves.map(pikafishUciToFsfXiangqiUci),
    variant: 'xiangqi',
    nodes: WORST_TIER.nodes,
    eval: { evalFile: xiangqiFsfNetPath(bin) },
    movetimeMs,
  });
  const initCommands = [
    ...init.slice(0, -2),
    `setoption name MultiPV value ${ALL_ROOT_MOVES}`,
    ...init.slice(-2),
  ];
  const release = await xiangqiFsfLivePool.acquire();
  try {
    const table = await warmSessions.withSession(
      { bin, initCommands, name: 'xiangqi-fsf-worst' },
      (session) =>
        session.multiPvPosition({
          positionCommand: position,
          goCommand: go,
          timeoutMs: movetimeMs + 4000,
          timeoutMessage: 'fairy-stockfish-xiangqi-worst move timed out',
        }),
    );
    const picked = pickWorstLine(table.lines, opts.rng);
    if (!picked) {
      return {
        best: table.best === null ? null : fsfXiangqiUciToPikafishUci(table.best),
        cp: table.cp,
        mate: table.mate,
        depth: table.depth,
      };
    }
    return {
      best: fsfXiangqiUciToPikafishUci(picked.move),
      cp: picked.cp,
      mate: picked.mate,
      depth: picked.depth,
      pv: picked.pv.map(fsfXiangqiUciToPikafishUci),
    };
  } finally {
    release();
  }
}
