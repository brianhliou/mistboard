/**
 * Bots, and the view they are allowed to have.
 *
 * The important decision here is the first one: a bot is handed a PlayerView,
 * never a MahjongGame. The game object holds the wall and all four hands, so a
 * bot given one could read the tiles it is supposed to be guessing at, and
 * nothing in a test would notice. Passing a view makes that impossible rather
 * than merely discouraged, and it is the same boundary the rest of the platform
 * draws between canonical state and what a client renders.
 *
 * It also means these bots move to the server unchanged when the four-seat
 * tenant exists. They never knew where they were running.
 */

import { type Claim, SEATS, type Seat } from './claims.js';
import type { HandSet } from './decompose.js';
import type { MahjongGame, Phase } from './game.js';
import { shanten } from './shanten.js';
import { TILE_COUNT, type TileIndex } from './tiles.js';
import { rankDiscards } from './ukeire.js';

/** Everything one seat can legitimately know. Notably NOT the wall's contents. */
export interface PlayerView {
  readonly seat: Seat;
  /** Own concealed tiles. Other seats' hands are absent, not redacted. */
  readonly hand: readonly number[];
  readonly melds: readonly (readonly HandSet[])[];
  readonly discards: readonly (readonly TileIndex[])[];
  readonly flowers: readonly (readonly number[])[];
  /** How many tiles are left, never which ones. */
  readonly wallRemaining: number;
  readonly drawn: TileIndex | null;
  readonly turn: Seat;
  readonly phase: Phase;
  readonly dealer: Seat;
  readonly roundWind: TileIndex;
}

export function viewFor(game: MahjongGame, seat: Seat): PlayerView {
  return {
    seat,
    hand: game.hands[seat] as readonly number[],
    melds: game.melds,
    discards: game.discards,
    flowers: game.flowers,
    wallRemaining: game.wall.length,
    drawn: game.turn === seat ? game.drawn : null,
    turn: game.turn,
    phase: game.phase,
    dealer: game.dealer,
    roundWind: game.roundWind,
  };
}

/**
 * Tiles this seat can see that are NOT in its own hand.
 *
 * The exclusion matters: `acceptance` computes live copies as
 * `4 - held - visible`, so folding the hand into `visible` too would subtract
 * every held tile twice and quietly halve the count of everything the hand is
 * waiting on.
 */
export function seenByOthers(view: PlayerView): number[] {
  const seen = new Array<number>(TILE_COUNT).fill(0);
  for (const pond of view.discards) {
    for (const tile of pond) seen[tile] = (seen[tile] ?? 0) + 1;
  }
  for (const melds of view.melds) {
    for (const meld of melds) {
      if (meld.kind === 'chow') {
        for (let i = 0; i < 3; i += 1) seen[meld.tile + i] = (seen[meld.tile + i] ?? 0) + 1;
      } else {
        seen[meld.tile] = (seen[meld.tile] ?? 0) + (meld.kind === 'kong' ? 4 : 3);
      }
    }
  }
  return seen;
}

export interface Bot {
  readonly name: string;
  /** Called when this seat holds a tile too many. */
  chooseDiscard(view: PlayerView): TileIndex;
  /** Called with the claims this seat could legally make. Null declines. */
  chooseClaim(view: PlayerView, claims: readonly Claim[]): Claim | null;
}

const meldCountOf = (view: PlayerView) => (view.melds[view.seat] as readonly HandSet[]).length;

/** Baseline for calibration: legal, and nothing more. */
export function randomBot(rng: () => number): Bot {
  return {
    name: 'random',
    chooseDiscard(view) {
      const held: TileIndex[] = [];
      for (let tile = 0; tile < TILE_COUNT; tile += 1) {
        for (let n = 0; n < (view.hand[tile] ?? 0); n += 1) held.push(tile);
      }
      return held[Math.floor(rng() * held.length)] as TileIndex;
    },
    chooseClaim(_view, claims) {
      // Still takes a win, or it would never finish a hand.
      return claims.find((claim) => claim.kind === 'win') ?? null;
    },
  };
}

/**
 * Pure tile efficiency. Discards for the widest acceptance, claims only when
 * the claim actually advances the hand.
 *
 * It knows nothing about what a hand is worth, so it will happily break a flush
 * to gain one acceptance tile. That is L3's problem, and the reason this one is
 * the floor rather than the target.
 */
export function efficiencyBot(): Bot {
  return {
    name: 'efficiency',
    chooseDiscard(view) {
      const options = rankDiscards(view.hand, { meldCount: meldCountOf(view) }, seenByOthers(view));
      const best = options[0];
      if (!best) throw new Error('asked to discard from an empty hand');
      return best.discard;
    },

    chooseClaim(view, claims) {
      const win = claims.find((claim) => claim.kind === 'win');
      if (win) return win;

      const melds = meldCountOf(view);
      const current = shanten(view.hand, { meldCount: melds }).shanten;
      const seen = seenByOthers(view);

      let best: { claim: Claim; shanten: number; acceptance: number } | null = null;
      for (const claim of claims) {
        const hand = [...view.hand];
        let legal = true;
        for (const tile of claim.fromHand) {
          if ((hand[tile] ?? 0) === 0) {
            legal = false;
            break;
          }
          hand[tile] = (hand[tile] as number) - 1;
        }
        if (!legal) continue;

        // A claim leaves the hand one tile long, so judge it by what it looks
        // like after the discard that must follow, not before.
        const after = rankDiscards(hand, { meldCount: melds + 1 }, seen)[0];
        if (!after) continue;
        if (after.shanten >= current) continue;

        if (
          !best ||
          after.shanten < best.shanten ||
          (after.shanten === best.shanten && after.acceptance.total > best.acceptance)
        ) {
          best = { claim, shanten: after.shanten, acceptance: after.acceptance.total };
        }
      }

      return best?.claim ?? null;
    },
  };
}

/** Four bots, one per seat. */
export function seatBots(make: (seat: Seat) => Bot): Record<Seat, Bot> {
  return Object.fromEntries(SEATS.map((seat) => [seat, make(seat)])) as Record<Seat, Bot>;
}
