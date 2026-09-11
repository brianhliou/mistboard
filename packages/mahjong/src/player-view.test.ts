import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyMahjongMove,
  createMahjongState,
  MAHJONG_SEATS,
  type MahjongTenantState,
  mahjongRevealedView,
  mahjongViewFor,
  orderedWall,
} from './index.js';

// Mahjong hides three whole hands and the entire future of the deal. These are
// the regression tests for that: every one of them is about something the
// server must NOT send, which is the class of bug a rendering check cannot see.

const deal = (): MahjongTenantState => createMahjongState(orderedWall());

/** Every array anywhere in a structure, with the path that reached it. */
function arraysIn(value: unknown, path = '$'): { path: string; value: unknown[] }[] {
  if (Array.isArray(value)) {
    return [
      { path, value },
      ...value.flatMap((item, i) => arraysIn(item, `${path}[${i}]`)),
    ];
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => arraysIn(item, `${path}.${key}`));
  }
  return [];
}

test('a seat sees its own hand and no other hand', () => {
  const state = deal();
  for (const [index, seat] of MAHJONG_SEATS.entries()) {
    const view = mahjongViewFor(state, seat);
    for (const [otherIndex, other] of view.seats.entries()) {
      if (otherIndex === index) {
        assert.ok(other.hand, `${seat} should see their own tiles`);
        assert.ok(other.hand.length > 0);
      } else {
        assert.equal(other.hand, undefined, `${seat} must not see ${other.seat}'s tiles`);
      }
    }
  }
});

test('a spectator sees no hand at all', () => {
  const view = mahjongViewFor(deal(), 'spectator');
  for (const seat of view.seats) {
    assert.equal(seat.hand, undefined, `a watcher must not see ${seat.seat}'s tiles`);
  }
  assert.deepEqual(view.ownClaims, []);
});

test('hand sizes are public even though the tiles are not', () => {
  // Counting tiles is legal and normal at a table; it is how you notice
  // somebody has melded. Hiding it would be wrong, not safer.
  const view = mahjongViewFor(deal(), 'east');
  assert.equal(view.seats[0]?.handSize, 14, 'the dealer holds fourteen');
  for (const seat of view.seats.slice(1)) {
    assert.equal(seat.handSize, 13);
  }
});

test('no view anywhere carries the wall', () => {
  // The wall is the whole future of the hand in order. One client holding it
  // knows every tile every player will draw for the rest of the game, so this
  // asserts on structure rather than on a field name somebody might add later.
  const state = deal();
  const wall = [...state.game.wall];
  const deadWall = [...state.game.deadWall];
  assert.ok(wall.length > 50, 'fixture should have a real wall to leak');

  for (const perspective of [...MAHJONG_SEATS, 'spectator' as const]) {
    const view = mahjongViewFor(state, perspective);
    for (const { path, value } of arraysIn(view)) {
      assert.notDeepEqual(value, wall, `${perspective} view leaks the wall at ${path}`);
      assert.notDeepEqual(value, deadWall, `${perspective} view leaks the dead wall at ${path}`);
    }
    const keys = JSON.stringify(view).match(/"[a-zA-Z]*[Ww]all[a-zA-Z]*"/g) ?? [];
    assert.deepEqual(
      [...new Set(keys)],
      ['"wallRemaining"'],
      `${perspective} view should expose only the wall COUNT`,
    );
  }
});

test('only the viewer is offered claims', () => {
  let state = deal();
  const hand = state.game.hands[0] as readonly number[];
  const tile = hand.findIndex((count) => count > 0);
  state = applyMahjongMove(state, { by: 'east', at: 1_000, action: 'discard', tile });

  const awaiting = mahjongViewFor(state, 'east').awaiting;
  assert.ok(awaiting.length > 0, 'fixture should open a contested window');
  // Who the table is waiting on is public, which is how a client shows the
  // other seats thinking. What they could claim is not.
  for (const seat of MAHJONG_SEATS) {
    const view = mahjongViewFor(state, seat);
    assert.deepEqual(view.awaiting, awaiting, 'who is thinking is public');
    if (!awaiting.includes(seat)) assert.deepEqual(view.ownClaims, []);
  }
});

test('revealing hands is refused while the game is still being played', () => {
  // The reveal path exists for the end of a hand. Called a move early it would
  // hand one seat the other three hands.
  assert.throws(() => mahjongRevealedView(deal(), 'east'), /still being played/);
});
