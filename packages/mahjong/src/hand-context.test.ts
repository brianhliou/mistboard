import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyMahjongMove,
  claimsFor,
  createMahjongState,
  handContextFor,
  type MahjongGame,
  type MahjongTenantState,
  orderedWall,
  pendingClaimants,
  seatWindFor,
} from './index.js';

const counts = (tiles: readonly number[]): number[] => {
  const out = Array<number>(34).fill(0);
  for (const tile of tiles) out[tile] = (out[tile] ?? 0) + 1;
  return out;
};

/** A dealt state with one seat's tiles and flowers replaced. */
function withSeat(
  seat: number,
  patch: { hand?: readonly number[]; flowers?: readonly number[] },
): MahjongTenantState {
  const state = createMahjongState(orderedWall());
  const hands = state.game.hands.map((h, i) => (i === seat && patch.hand ? counts(patch.hand) : h));
  const flowers = state.game.flowers.map((f, i) =>
    i === seat && patch.flowers ? patch.flowers : f,
  );
  const game: MahjongGame = { ...state.game, hands, flowers };
  return { ...state, game };
}

test('seat wind is counted from the dealer, not from the seat index', () => {
  const state = createMahjongState(orderedWall());
  assert.equal(seatWindFor(state.game, 0), 27);
  assert.equal(seatWindFor(state.game, 1), 28);
  const rotated: MahjongGame = { ...state.game, dealer: 1 };
  assert.equal(seatWindFor(rotated, 1), 27, 'the dealer is always east');
  assert.equal(seatWindFor(rotated, 0), 30, 'the seat before the dealer is north');
});

test('the context counts only the flowers that match the seat, capped at one of each', () => {
  // Flowers 0-3 and seasons 4-7 are numbered E/S/W/N, so south's are 1 and 5.
  const south = withSeat(1, { flowers: [1, 5, 2] });
  assert.deepEqual(handContextFor(south.game, 1), {
    seatWind: 28,
    roundWind: south.game.roundWind,
    seatFlowers: 2,
    noFlowers: false,
    fullFlowerSet: false,
  });
  const none = withSeat(1, { flowers: [] });
  assert.equal(handContextFor(none.game, 1).noFlowers, true);
  assert.equal(handContextFor(none.game, 1).seatFlowers, 0);
  const all = withSeat(1, { flowers: [4, 5, 6, 7] });
  assert.equal(handContextFor(all.game, 1).fullFlowerSet, true);
});

test('a win on a discard counts the flowers on the table toward the minimum', () => {
  // South: 白白白, 1-9萬 as three chows, a lone 1筒. 1筒 completes a hand worth
  // two faan (the dragon pung, and 門前清 for a fully concealed hand); the 1筒
  // pair keeps it off a half flush. Holding one flower that is not south's
  // keeps 無花 off the table too. Two seat flowers then make it four, and three
  // is what HK needs to declare.
  const hand = [31, 31, 31, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const discard = { by: 'east', at: 1_000, action: 'discard', tile: 9 } as const;

  const bare = applyMahjongMove(withSeat(1, { hand, flowers: [2] }), discard);
  assert.ok(
    !claimsFor(bare, 1).some((claim) => claim.kind === 'win'),
    'two faan is below the minimum',
  );

  const flowered = applyMahjongMove(withSeat(1, { hand, flowers: [1, 5] }), discard);
  assert.ok(
    claimsFor(flowered, 1).some((claim) => claim.kind === 'win'),
    'the seat flowers lift the same tiles to three faan',
  );
});

test('a discard nobody can claim settles at once instead of opening a window', () => {
  // Every other seat holds only honours nobody is discarding, so no pung, no
  // chow (south would need 萬 neighbours), and no win.
  const honours = [27, 27, 27, 28, 28, 28, 29, 29, 29, 30, 30, 30, 32];
  let state = createMahjongState(orderedWall());
  const hands = state.game.hands.map((h, i) => (i === 0 ? h : counts(honours)));
  state = { ...state, game: { ...state.game, hands } };
  const tile = (state.game.hands[0] as readonly number[]).findIndex((n) => n > 0);

  const after = applyMahjongMove(state, { by: 'east', at: 1_000, action: 'discard', tile });
  assert.equal(after.game.phase.type, 'draw');
  assert.equal(after.status.type === 'playing' && after.status.turn, 'south');
  assert.equal(after.windowClosesAt, null);
  assert.deepEqual(pendingClaimants(after), []);
  assert.equal(after.game.discards[0]?.at(-1), tile, 'the discard still lands in the pond');
});
