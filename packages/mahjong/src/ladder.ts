/**
 * Engine-versus-engine calibration.
 *
 * A bot level only means something if it beats the level below it over enough
 * hands that the result is not variance. That is the same shape the repo
 * already uses for xiangqi - enqueue a tournament, then read an Elo report -
 * and it is available here for free because the hand loop is itself the
 * simulator.
 */

import { playHand } from './autoplay.js';
import type { PlayOptions } from './autoplay.js';
import type { Bot } from './bots.js';
import type { Seat } from './claims.js';
import { dealGame, shuffleWall } from './game.js';

export interface LadderResult {
  readonly hands: number;
  readonly exhausted: number;
  /** Wins credited to each bot NAME, so seats can be rotated freely. */
  readonly winsByBot: Readonly<Record<string, number>>;
  readonly decided: number;
}

/** Deterministic source so a ladder run is reproducible from its seed. */
export function seededRng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

export function runLadder(
  makeBots: (hand: number) => Record<Seat, Bot>,
  hands: number,
  seedBase: number,
  options: PlayOptions = {},
): LadderResult {
  const winsByBot: Record<string, number> = {};
  let exhausted = 0;
  let decided = 0;

  for (let i = 0; i < hands; i += 1) {
    const bots = makeBots(i);
    const played = playHand(dealGame(shuffleWall(seededRng(seedBase + i))), bots, options);
    if (played.phase.type !== 'won') {
      exhausted += 1;
      continue;
    }
    for (const seat of played.phase.winners) {
      const name = (bots[seat] as Bot).name;
      winsByBot[name] = (winsByBot[name] ?? 0) + 1;
      decided += 1;
    }
  }

  return { hands, exhausted, winsByBot, decided };
}
