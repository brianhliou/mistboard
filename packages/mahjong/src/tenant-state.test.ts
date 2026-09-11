import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyMahjongMove,
  CLAIM_WINDOW_MS,
  createMahjongState,
  claimsFor,
  type MahjongTenantState,
  mahjongSeatMayAct,
  orderedWall,
  pendingClaimants,
  seatName,
  shuffleWall,
} from './index.js';

// A deterministic wall: no shuffle, so every test below starts from the same
// deal and a failure names a reproducible hand rather than a seed.
const deal = () => createMahjongState(orderedWall());

/**
 * A contested window: east discards a tile two other seats can claim.
 *
 * The unshuffled wall deals four near-identical hands and its opening discard
 * draws exactly ONE claimant, which quietly turns every "wait for each seat"
 * assertion below into a no-op. Seed 6 is the first that produces two, found by
 * scanning seeds rather than chosen; tile 24 is east's discard that does it.
 * Three claimants on one discard appears in none of the first 4,000 seeds,
 * which is a fact about the game rather than the search: two seats cannot both
 * pung the same tile, so a third claimant needs a second winning hand.
 */
function toContestedWindow(): { state: MahjongTenantState; at: number } {
  const at = 1_000_000;
  let rng = 6 | 0;
  const next = () => {
    rng = (rng + 0x6d2b79f5) | 0;
    let t = Math.imul(rng ^ (rng >>> 15), 1 | rng);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const state = applyMahjongMove(createMahjongState(shuffleWall(next, orderedWall())), {
    by: 'east',
    at,
    action: 'discard',
    tile: 24,
  });
  return { state, at };
}

/** Play through to the first discard, returning the state and the tile. */
function toClaimWindow(): { state: MahjongTenantState; at: number } {
  let state = deal();
  const at = 1_000_000;
  // The deal leaves the dealer holding fourteen tiles and already on discard,
  // so east's first act is a discard, not a draw.
  const hand = state.game.hands[0] as readonly number[];
  const tile = hand.findIndex((count) => count > 0);
  state = applyMahjongMove(state, { by: 'east', at, action: 'discard', tile });
  return { state, at };
}

test('a fresh deal has east to move and nothing claimed', () => {
  const state = deal();
  assert.equal(state.status.type, 'playing');
  assert.deepEqual(state.answers, {});
  assert.equal(state.windowClosesAt, null);
  assert.equal(state.moveNumber, 0);
});

test('a discard opens a window that closes a fixed time after the discard', () => {
  // The deadline comes off the discard's own timestamp, not off "now": if it
  // were read at access time, every answer would restart the window.
  const { state, at } = toClaimWindow();
  assert.equal(state.game.phase.type, 'claim-window');
  assert.equal(state.windowClosesAt, at + CLAIM_WINDOW_MS);
});

test('only seats with a legal claim are waited on', () => {
  const { state } = toClaimWindow();
  const pending = pendingClaimants(state);
  // The discarder is never owed an answer on their own discard.
  assert.ok(!pending.includes('east'));
  for (const seat of pending) {
    assert.ok(claimsFor(state, ['east', 'south', 'west', 'north'].indexOf(seat) as 0).length > 0);
  }
});

test('the discarder may act during their own window, to time it out', () => {
  const { state } = toClaimWindow();
  assert.equal(mahjongSeatMayAct(state, 'east'), true);
});

test('a seat with no claim to make may not act in the window', () => {
  const { state } = toClaimWindow();
  const pending = new Set(pendingClaimants(state));
  const idle = (['south', 'west', 'north'] as const).filter((seat) => !pending.has(seat));
  for (const seat of idle) {
    assert.equal(mahjongSeatMayAct(state, seat), false, `${seat} has nothing to claim`);
  }
});

test('a timeout settles the window and play continues', () => {
  const { state } = toClaimWindow();
  const settled = applyMahjongMove(state, { by: 'east', at: 1_000, action: 'timeout' });
  assert.notEqual(settled.game.phase.type, 'claim-window');
  assert.deepEqual(settled.answers, {});
  assert.equal(settled.windowClosesAt, null);
  assert.equal(settled.status.type, 'playing');
});

test('a window with claimants stays open until each has answered', () => {
  const { state } = toContestedWindow();
  const pending = pendingClaimants(state);
  assert.equal(pending.length, 2, 'the pinned deal must really be contested');
  let next = applyMahjongMove(state, { by: pending[0] as 'south', at: 1_000, action: 'pass' });
  assert.equal(next.game.phase.type, 'claim-window', 'one answer is not every answer');
  for (const seat of pending.slice(1)) {
    next = applyMahjongMove(next, { by: seat, at: 1_000, action: 'pass' });
  }
  assert.notEqual(next.game.phase.type, 'claim-window', 'the last answer closes it');
});

test('a seat cannot answer twice while the window is open', () => {
  const { state } = toContestedWindow();
  const pending = pendingClaimants(state);
  assert.equal(pending.length, 2, 'the pinned deal must really be contested');
  const first = pending[0] as 'south';
  const once = applyMahjongMove(state, { by: first, at: 1_000, action: 'pass' });
  assert.equal(once.game.phase.type, 'claim-window');
  assert.equal(applyMahjongMove(once, { by: first, at: 1_000, action: 'pass' }), once);
});

test('an answer with no window open changes nothing', () => {
  // Without this guard a stray pass would fall through to the resolver and
  // advance the game by a move nobody made.
  const state = deal();
  assert.notEqual(state.game.phase.type, 'claim-window');
  for (const action of ['pass', 'timeout'] as const) {
    assert.equal(applyMahjongMove(state, { by: 'south', at: 1_000, action }), state);
  }
  assert.equal(
    applyMahjongMove(state, { by: 'south', at: 1_000, action: 'claim', kind: 'pung', fromHand: [0, 0] }),
    state,
  );
});

test('a claim naming tiles the seat does not hold is recorded as a decline', () => {
  // Rather than dropped: the window has to stop waiting on this seat, or a
  // client sending nonsense would hang the table until the deadline.
  const { state } = toContestedWindow();
  const [first] = pendingClaimants(state);
  assert.ok(first, 'the pinned deal must have a claimant');
  const next = applyMahjongMove(state, { by: first, at: 1_000, action: 'claim',
    kind: 'pung',
    fromHand: [99, 99] });
  // Either the window resolved (answers cleared) or it recorded the decline;
  // what must hold in both cases is that it is no longer waiting on this seat.
  assert.ok(!pendingClaimants(next).includes(first));
  if (next.game.phase.type === 'claim-window') assert.equal(next.answers[first], null);
});

test('every move advances the move number, and the status tracks the turn', () => {
  const { state } = toClaimWindow();
  assert.equal(state.moveNumber, 1);
  assert.equal(state.status.type === 'playing' && state.status.turn, seatName(state.game.turn));
});
