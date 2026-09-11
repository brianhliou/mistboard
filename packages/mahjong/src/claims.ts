/**
 * Claims on a discard: the primitive the rest of the platform does not have.
 *
 * Every other game here is strictly alternating - the side to move moves, and
 * anything arriving from another seat is dropped. Mahjong is not. A discard
 * opens a window in which up to three other players may interrupt, their claims
 * outrank each other, and the winner takes the turn out of order.
 *
 * The decision logic lives here, pure, so the server owns only the window: hold
 * the discard, collect what arrives, ask this module who won, apply it. Which
 * claims are LEGAL and which claim BEATS another are rules questions, and they
 * belong with the rules.
 */

import { decompose, type HandSet } from './decompose.js';
import type { HkScoreOptions } from './hk-detect.js';
import { type HkHandContext, scoreHand } from './hk-detect.js';
import { isHonour, suitOf, type TileIndex } from './tiles.js';

/** Seats in turn order: East, South, West, North. Play proceeds 0 -> 1 -> 2 -> 3. */
export type Seat = 0 | 1 | 2 | 3;
export const SEATS: readonly Seat[] = [0, 1, 2, 3];

export function nextSeat(seat: Seat): Seat {
  return ((seat + 1) % 4) as Seat;
}

/** How far `seat` sits after `from` going around the table. 1 is immediately after. */
export function seatDistance(from: Seat, seat: Seat): number {
  return (seat - from + 4) % 4;
}

export type ClaimKind = 'win' | 'kong' | 'pung' | 'chow';

export interface Claim {
  readonly seat: Seat;
  readonly kind: ClaimKind;
  /**
   * The tiles taken FROM HAND to form the set, excluding the discard itself.
   * A chow is ambiguous (a 4 can complete 23, 35 or 56), so the claimant has to
   * say which, and the server must not guess for them.
   */
  readonly fromHand: readonly TileIndex[];
}

export interface ClaimOptions extends HkScoreOptions {
  /**
   * 一炮多響: every claimant wins on the one discard. The alternative, 截糊,
   * awards it to whoever sits nearest after the discarder. Tables must agree
   * this before play; it is not a detail.
   */
  readonly multipleWinners?: boolean;
  /**
   * 三番起糊. A hand below the minimum may not be declared, so under HK rules
   * the minimum is part of whether a win claim is LEGAL, not just what it pays.
   */
  readonly minFaan?: number;
}

/** Chow shapes: the two ranks taken from hand, relative to the discard. */
const CHOW_OFFSETS: readonly (readonly [number, number])[] = [
  [-2, -1],
  [-1, 1],
  [1, 2],
];

/**
 * Every claim `seat` could legally make on `discard`.
 *
 * `hand` is the claimant's concealed tiles as a 34-length count array, not
 * including the discard. `melds` are their existing exposed sets, which matter
 * because a win claim has to score the whole hand.
 */
export function legalClaims(
  hand: readonly number[],
  melds: readonly HandSet[],
  discard: TileIndex,
  seat: Seat,
  discarder: Seat,
  context: HkHandContext = {},
  options: ClaimOptions = {},
): Claim[] {
  if (seat === discarder) return [];

  const claims: Claim[] = [];
  const held = hand[discard] ?? 0;

  // A win on a discard is never self-drawn, whatever the caller passed.
  const withDiscard = [...hand];
  withDiscard[discard] = held + 1;
  if (decompose(withDiscard, melds).length > 0) {
    const score = scoreHand(withDiscard, melds, { ...context, selfDrawn: false }, options);
    const minFaan = options.minFaan ?? 3;
    if (score && score.faan >= minFaan) {
      claims.push({ seat, kind: 'win', fromHand: [] });
    }
  }

  if (held >= 3) claims.push({ seat, kind: 'kong', fromHand: [discard, discard, discard] });
  if (held >= 2) claims.push({ seat, kind: 'pung', fromHand: [discard, discard] });

  // A chow may only be taken by the seat immediately after the discarder, and
  // only inside one numbered suit.
  if (seatDistance(discarder, seat) === 1 && !isHonour(discard)) {
    const rank = discard % 9;
    for (const [a, b] of CHOW_OFFSETS) {
      if (rank + a < 0 || rank + b > 8) continue;
      const first = discard + a;
      const second = discard + b;
      if (suitOf(first) !== suitOf(discard) || suitOf(second) !== suitOf(discard)) continue;
      if ((hand[first] ?? 0) > 0 && (hand[second] ?? 0) > 0) {
        claims.push({ seat, kind: 'chow', fromHand: [first, second] });
      }
    }
  }

  return claims;
}

const RANK: Record<ClaimKind, number> = { win: 3, kong: 2, pung: 2, chow: 1 };

export interface ClaimResolution {
  /** Claims that take effect, in the order they should be applied. */
  readonly winners: readonly Claim[];
  /** Claims that were outranked, with what beat them. */
  readonly rejected: readonly { claim: Claim; beatenBy: Claim }[];
}

/**
 * Decide which of the claims on one discard take effect.
 *
 * A win outranks a kong or pung, which outrank a chow, which is why the chow
 * seat cannot simply take every discard that passes it. Between equal ranks the
 * seat nearest after the discarder wins, going around the table.
 *
 * Only a win can have more than one legitimate claimant, and only when the table
 * plays 一炮多響. Two pungs of the same tile are impossible - between two hands
 * that would need four copies plus the discarded fifth.
 */
export function resolveClaims(
  claims: readonly Claim[],
  discarder: Seat,
  options: ClaimOptions = {},
): ClaimResolution {
  // The discarder cannot claim their own discard. legalClaims already refuses,
  // but this resolver is fed by the network, and a discarder's claim sorts at
  // distance zero - that is, it would beat every honest claim at the table.
  // Drop it here rather than trusting the caller to have filtered.
  const eligible = claims.filter((claim) => claim.seat !== discarder);
  if (eligible.length === 0) return { winners: [], rejected: [] };

  const ordered = [...eligible].sort((a, b) => {
    const byRank = RANK[b.kind] - RANK[a.kind];
    if (byRank !== 0) return byRank;
    return seatDistance(discarder, a.seat) - seatDistance(discarder, b.seat);
  });

  const best = ordered[0] as Claim;
  const wins = ordered.filter((claim) => claim.kind === 'win');

  const winners = best.kind === 'win' && options.multipleWinners && wins.length > 1 ? wins : [best];

  const taken = new Set(winners);
  return {
    winners,
    rejected: ordered.filter((c) => !taken.has(c)).map((claim) => ({ claim, beatenBy: best })),
  };
}

/**
 * Whose turn it is once a claim has been applied.
 *
 * The claimant takes the turn, skipping anyone between them and the discarder.
 * That skip is the whole reason turn order cannot be a counter.
 */
export function seatAfterClaim(claim: Claim): Seat {
  return claim.seat;
}

/** Whose turn it is when a discard passes unclaimed. */
export function seatAfterPass(discarder: Seat): Seat {
  return nextSeat(discarder);
}
