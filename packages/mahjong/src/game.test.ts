import assert from 'node:assert/strict';
import test from 'node:test';

import type { Claim, Seat } from './claims.js';
import {
  DEAD_WALL_SIZE,
  FLOWER_BASE,
  type MahjongGame,
  WALL_SIZE,
  applyClaim,
  applyDiscard,
  applyDraw,
  applyPass,
  applySelfDraw,
  dealGame,
  isFinished,
  orderedWall,
  shuffleWall,
  visibleToSeat,
} from './game.js';
import { TILE_COUNT, tileIndex } from './tiles.js';

const rng = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
};

const handSize = (game: MahjongGame, seat: Seat) =>
  (game.hands[seat] as readonly number[]).reduce((a, b) => a + b, 0);

const tilesInPlay = (game: MahjongGame) => {
  let total = game.wall.length + game.deadWall.length;
  for (const seat of [0, 1, 2, 3] as Seat[]) {
    total += handSize(game, seat);
    total += (game.discards[seat] as readonly number[]).length;
    total += (game.flowers[seat] as readonly number[]).length;
    for (const meld of game.melds[seat] as readonly { kind: string }[]) {
      total += meld.kind === 'kong' ? 4 : 3;
    }
  }
  return total;
};

test('a wall is 144 tiles: 136 plus eight flowers', () => {
  const wall = orderedWall();
  assert.equal(wall.length, WALL_SIZE);
  assert.equal(wall.filter((t) => t >= FLOWER_BASE).length, 8);
  assert.equal(wall.filter((t) => t < FLOWER_BASE).length, 136);
});

test('shuffling preserves the multiset', () => {
  const shuffled = shuffleWall(rng(7));
  assert.equal(shuffled.length, WALL_SIZE);
  assert.deepEqual([...shuffled].sort((a, b) => a - b), [...orderedWall()].sort((a, b) => a - b));
});

test('the deal gives thirteen tiles each and fourteen to the dealer', () => {
  const game = dealGame(shuffleWall(rng(11)));
  assert.equal(handSize(game, 0), 14);
  for (const seat of [1, 2, 3] as Seat[]) assert.equal(handSize(game, seat), 13);
  assert.equal(game.turn, 0);
  assert.equal(game.phase.type, 'discard');
});

test('flowers are set aside during the deal, never counted as hand tiles', () => {
  const game = dealGame(shuffleWall(rng(3)));
  const drawnFlowers = game.flowers.reduce((n, f) => n + f.length, 0);
  // Every flower held is one that was replaced, so hands stay at the right size.
  assert.ok(drawnFlowers >= 0);
  assert.equal(handSize(game, 0), 14);
  for (const hand of game.hands) {
    assert.equal(hand.length, TILE_COUNT, 'flowers must not extend the hand array');
  }
});

test('no tile is lost or invented across a deal', () => {
  for (const seed of [1, 2, 3, 5, 8, 13]) {
    const game = dealGame(shuffleWall(rng(seed)));
    assert.equal(tilesInPlay(game), WALL_SIZE, `seed ${seed}`);
  }
});

test('the dead wall stays at fourteen however many flowers the deal turns up', () => {
  // Every flower takes a replacement from the dead wall, which is then topped
  // up from the back of the live wall. Skip the top-up and a flower-heavy deal
  // leaves too few tiles to draw a kong replacement from later in the hand.
  let sawFlowers = false;
  for (const seed of [1, 2, 3, 5, 8, 13, 21, 34, 55, 89]) {
    const game = dealGame(shuffleWall(rng(seed)));
    if (game.flowers.some((f) => f.length > 0)) sawFlowers = true;
    assert.equal(game.deadWall.length, DEAD_WALL_SIZE, `seed ${seed}`);
  }
  assert.ok(sawFlowers, 'no deal drew a flower, so this proved nothing');
});

test('a malformed wall is rejected rather than dealt', () => {
  assert.throws(() => dealGame(orderedWall().slice(0, 100)), /144 tiles/);
});

test('discarding opens a claim window and passing closes it', () => {
  let game = dealGame(shuffleWall(rng(21)));
  const tile = (game.hands[0] as readonly number[]).findIndex((n) => n > 0);
  game = applyDiscard(game, tile);

  assert.equal(game.phase.type, 'claim-window');
  assert.equal(handSize(game, 0), 13);
  assert.deepEqual(game.discards[0], [tile]);

  game = applyPass(game);
  assert.equal(game.turn, 1);
  assert.equal(game.phase.type, 'draw');
});

test('the phases refuse actions that belong to another phase', () => {
  const game = dealGame(shuffleWall(rng(31)));
  assert.throws(() => applyDraw(game), /cannot draw in phase discard/);
  assert.throws(() => applyPass(game), /no claim window open/);

  const tile = (game.hands[0] as readonly number[]).findIndex((n) => n > 0);
  const open = applyDiscard(game, tile);
  assert.throws(() => applyDiscard(open, tile), /cannot discard in phase claim-window/);
  assert.throws(() => applySelfDraw(open), /cannot declare a self-draw/);
});

test('a tile not in hand cannot be discarded', () => {
  const game = dealGame(shuffleWall(rng(41)));
  const missing = (game.hands[0] as readonly number[]).findIndex((n) => n === 0);
  assert.throws(() => applyDiscard(game, missing), /not in hand/);
});

test('a claim takes the turn out of order, skipping seats', () => {
  let game = dealGame(shuffleWall(rng(51)));
  // Force a pung for West on East's discard.
  const tile = tileIndex('m', 5);
  const hands = game.hands.map((h) => [...h]);
  hands[0][tile] = 1;
  hands[2][tile] = 2;
  game = { ...game, hands };

  const before = handSize(game, 2);
  game = applyDiscard(game, tile);
  const claim: Claim = { seat: 2, kind: 'pung', fromHand: [tile, tile] };
  game = applyClaim(game, claim);

  // South never got a turn.
  assert.equal(game.turn, 2);
  assert.equal(game.phase.type, 'discard');
  assert.deepEqual(game.discards[0], [], 'the claimed tile leaves the pond');
  assert.equal((game.melds[2] as readonly unknown[]).length, 1);
  assert.equal(handSize(game, 2), before - 2, 'two tiles left the hand into the meld');
});

test('a chow melds from the lowest tile of the run', () => {
  let game = dealGame(shuffleWall(rng(61)));
  const four = tileIndex('m', 4);
  const hands = game.hands.map((h) => [...h]);
  hands[0][four] = 1;
  hands[1][tileIndex('m', 5)] = 1;
  hands[1][tileIndex('m', 6)] = 1;
  game = { ...game, hands };

  game = applyDiscard(game, four);
  game = applyClaim(game, {
    seat: 1,
    kind: 'chow',
    fromHand: [tileIndex('m', 5), tileIndex('m', 6)],
  });

  const meld = (game.melds[1] as readonly { kind: string; tile: number }[])[0];
  assert.equal(meld?.kind, 'chow');
  assert.equal(meld?.tile, four);
});

test('a kong draws a replacement so the hand is not left short', () => {
  let game = dealGame(shuffleWall(rng(71)));
  const tile = tileIndex('s', 3);
  const hands = game.hands.map((h) => [...h]);
  hands[0][tile] = 1;
  hands[3][tile] = 3;
  game = { ...game, hands };
  const before = tilesInPlay(game);

  game = applyDiscard(game, tile);
  game = applyClaim(game, { seat: 3, kind: 'kong', fromHand: [tile, tile, tile] });

  assert.equal(game.turn, 3);
  assert.equal(game.phase.type, 'discard');
  assert.equal(game.deadWall.length, DEAD_WALL_SIZE, 'dead wall is topped up from the live wall');
  assert.equal(tilesInPlay(game), before, 'the kong replacement invented no tiles');
});

test('claiming a stale discard is refused', () => {
  let game = dealGame(shuffleWall(rng(81)));
  const tile = (game.hands[0] as readonly number[]).findIndex((n) => n > 0);
  game = applyDiscard(game, tile);
  const wrong = { ...game, discards: game.discards.map(() => []) } as MahjongGame;
  assert.throws(
    () => applyClaim(wrong, { seat: 1, kind: 'pung', fromHand: [tile, tile] }),
    /not the last one/,
  );
});

test('a win claim ends the hand without melding', () => {
  let game = dealGame(shuffleWall(rng(91)));
  const tile = (game.hands[0] as readonly number[]).findIndex((n) => n > 0);
  game = applyDiscard(game, tile);
  game = applyClaim(game, { seat: 2, kind: 'win', fromHand: [] });

  assert.equal(game.phase.type, 'won');
  assert.ok(isFinished(game));
  if (game.phase.type === 'won') {
    assert.deepEqual(game.phase.winners, [2]);
    assert.equal(game.phase.selfDrawn, false);
  }
});

test('a self-drawn win is marked as one', () => {
  const game = applySelfDraw(dealGame(shuffleWall(rng(101))));
  assert.equal(game.phase.type, 'won');
  if (game.phase.type === 'won') assert.equal(game.phase.selfDrawn, true);
});

test('a hand played out to the end exhausts rather than hanging', () => {
  let game = dealGame(shuffleWall(rng(111)));
  let guard = 0;
  while (!isFinished(game) && guard < 500) {
    guard += 1;
    if (game.phase.type === 'draw') {
      game = applyDraw(game);
      continue;
    }
    if (game.phase.type === 'discard') {
      const hand = game.hands[game.turn] as readonly number[];
      game = applyDiscard(game, hand.findIndex((n) => n > 0));
      continue;
    }
    if (game.phase.type === 'claim-window') game = applyPass(game);
  }
  assert.ok(guard < 500, 'the loop should terminate on its own');
  assert.equal(game.phase.type, 'exhausted');
  assert.equal(tilesInPlay(game), WALL_SIZE, 'no tile lost over a whole hand');
});

test('what a seat can see counts ponds, melds and its own hand only', () => {
  let game = dealGame(shuffleWall(rng(121)));
  const tile = (game.hands[0] as readonly number[]).findIndex((n) => n > 0);
  game = applyPass(applyDiscard(game, tile));

  const seen = visibleToSeat(game, 1);
  const own = game.hands[1] as readonly number[];
  assert.equal(seen[tile], (own[tile] ?? 0) + 1, 'the discard is visible to everyone');

  // Another seat's concealed hand is not.
  const total = seen.reduce((a, b) => a + b, 0);
  const ownTotal = own.reduce((a, b) => a + b, 0);
  assert.equal(total, ownTotal + 1);
});
