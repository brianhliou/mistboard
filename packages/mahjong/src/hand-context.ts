/**
 * The scoring context a seat carries into every faan count.
 *
 * Seat wind, round wind and flowers are facts about the TABLE, not about the
 * tiles in the hand, and they change what the same fourteen tiles are worth.
 * Before this module each scoring path built its own subset: the live claim
 * check passed nothing at all, the hand-status line passed winds but no
 * flowers, and the self-play harness counted every flower as a seat flower. A
 * hand holding two seat flowers and a dragon pung is a legal 3-faan win, and
 * the live table refused it. There is one builder now, and every caller uses
 * it.
 */

import type { Seat } from './claims.js';
import type { MahjongGame } from './game.js';
import type { HkHandContext } from './hk-detect.js';
import { flowerSeat, WINDS } from './tiles.js';

/** 門風: the wind this seat plays as, counted from the dealer. */
export function seatWindFor(game: MahjongGame, seat: Seat): number {
  return WINDS[(seat - game.dealer + 4) % 4] as number;
}

/**
 * Everything about the table that scores, for one seat. `selfDrawn` is left to
 * the caller because it is a property of the winning tile, not of the seat.
 */
export function handContextFor(game: MahjongGame, seat: Seat): HkHandContext {
  const flowers = (game.flowers[seat] ?? []) as readonly number[];
  const seatWind = seatWindFor(game, seat);
  // 正花: a flower or season whose number matches the seat. One of each can
  // score, so the count is capped at two, not at the number held.
  const seatFlowers = Math.min(
    2,
    flowers.filter((flower) => flowerSeat(flower) === seatWind).length,
  );
  const hasAll = (from: number) => [0, 1, 2, 3].every((i) => flowers.includes(from + i));
  return {
    seatWind,
    roundWind: game.roundWind,
    seatFlowers,
    noFlowers: flowers.length === 0,
    fullFlowerSet: hasAll(0) || hasAll(4),
  };
}
