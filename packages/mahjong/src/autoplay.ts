/**
 * Playing a hand out with bots in every seat.
 *
 * This is the harness the bot ladder is measured with and the loop the table UI
 * will drive, with a human substituted for one seat. Keeping it in one place
 * means the UI and the calibration runs cannot disagree about the rules.
 */

import type { Bot, PlayerView } from './bots.js';
import { viewFor } from './bots.js';
import type { ClaimOptions } from './claims.js';
import { type Claim, legalClaims, resolveClaims, SEATS, type Seat } from './claims.js';
import type { HandSet } from './decompose.js';
import {
  applyClaim,
  applyDiscard,
  applyDraw,
  applyPass,
  applySelfDraw,
  isFinished,
  type MahjongGame,
} from './game.js';
import type { HkHandContext } from './hk-detect.js';
import { scoreHand } from './hk-detect.js';

export interface PlayOptions extends ClaimOptions {
  /** Safety valve. A correct loop terminates long before this. */
  readonly maxSteps?: number;
}

const handContext = (game: MahjongGame, seat: Seat): HkHandContext => ({
  seatWind: (27 + ((seat - game.dealer + 4) % 4)) as number,
  roundWind: game.roundWind,
  seatFlowers: Math.min(2, (game.flowers[seat] as readonly number[]).length),
});

/** Would this seat's current tiles be a legal, declarable win? */
function canDeclareSelfDraw(game: MahjongGame, seat: Seat, options: PlayOptions): boolean {
  const score = scoreHand(
    game.hands[seat] as readonly number[],
    game.melds[seat] as readonly HandSet[],
    { ...handContext(game, seat), selfDrawn: true },
    options,
  );
  return score !== null && score.faan >= (options.minFaan ?? 3);
}

/** Collect every claim the seated bots want to make on the open discard. */
function gatherClaims(
  game: MahjongGame,
  bots: Record<Seat, Bot>,
  discard: number,
  discarder: Seat,
  options: PlayOptions,
): Claim[] {
  const wanted: Claim[] = [];
  for (const seat of SEATS) {
    if (seat === discarder) continue;
    const available = legalClaims(
      game.hands[seat] as readonly number[],
      game.melds[seat] as readonly HandSet[],
      discard,
      seat,
      discarder,
      handContext(game, seat),
      options,
    );
    if (available.length === 0) continue;
    const view: PlayerView = viewFor(game, seat);
    const chosen = (bots[seat] as Bot).chooseClaim(view, available);
    if (chosen) wanted.push(chosen);
  }
  return wanted;
}

/** Play from wherever the game currently is until the hand ends. */
export function playHand(
  start: MahjongGame,
  bots: Record<Seat, Bot>,
  options: PlayOptions = {},
): MahjongGame {
  const maxSteps = options.maxSteps ?? 2000;
  let game = start;

  for (let step = 0; step < maxSteps; step += 1) {
    if (isFinished(game)) return game;

    switch (game.phase.type) {
      case 'draw':
        game = applyDraw(game);
        break;

      case 'discard': {
        if (canDeclareSelfDraw(game, game.turn, options)) {
          game = applySelfDraw(game);
          break;
        }
        const bot = bots[game.turn] as Bot;
        game = applyDiscard(game, bot.chooseDiscard(viewFor(game, game.turn)));
        break;
      }

      case 'claim-window': {
        const { discard, discarder } = game.phase;
        const claims = gatherClaims(game, bots, discard, discarder, options);
        const resolved = resolveClaims(claims, discarder, options);
        const winner = resolved.winners[0];
        game = winner ? applyClaim(game, winner) : applyPass(game);
        break;
      }

      default:
        return game;
    }
  }

  throw new Error(`hand did not finish within ${maxSteps} steps`);
}

export interface HandOutcome {
  readonly winners: readonly Seat[];
  readonly selfDrawn: boolean;
  readonly exhausted: boolean;
  readonly faan: number | null;
}

export function outcomeOf(game: MahjongGame, options: PlayOptions = {}): HandOutcome {
  if (game.phase.type !== 'won') {
    return { winners: [], selfDrawn: false, exhausted: true, faan: null };
  }
  const seat = game.phase.winners[0] as Seat;
  const score = scoreHand(
    game.hands[seat] as readonly number[],
    game.melds[seat] as readonly HandSet[],
    { ...handContext(game, seat), selfDrawn: game.phase.selfDrawn },
    options,
  );
  return {
    winners: game.phase.winners,
    selfDrawn: game.phase.selfDrawn,
    exhausted: false,
    faan: score?.faan ?? null,
  };
}
