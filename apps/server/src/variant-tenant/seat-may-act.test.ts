import assert from 'node:assert/strict';
import test from 'node:test';

import { type TenantGameStateLike, tenantSeatMayAct } from './tenant.js';

type Seat = 'e' | 's' | 'w' | 'n';
type State = TenantGameStateLike<Seat>;

const playing = (turn: Seat): State => ({ status: { type: 'playing', turn }, moveNumber: 1 });

/** A tenant stub holding only what the predicate reads. */
type Stub = { rules: { seatMayAct?(state: State, seat: Seat): boolean } };

const alternating: Stub = { rules: {} };
const simultaneous: Stub = {
  rules: {
    // Stands in for a mahjong claim window: the seat to move may act, and so
    // may anyone the window is still owed an answer from.
    seatMayAct: (state, seat) =>
      state.status.type === 'playing' &&
      (state.status.turn === seat || seat === 'w' || seat === 'n'),
  },
};

test('with no hook, only the seat to move may act', () => {
  assert.equal(tenantSeatMayAct(alternating, playing('e'), 'e'), true);
  assert.equal(tenantSeatMayAct(alternating, playing('e'), 's'), false);
  assert.equal(tenantSeatMayAct(alternating, playing('e'), 'w'), false);
});

test('a tenant hook can widen who may act beyond the seat to move', () => {
  assert.equal(tenantSeatMayAct(simultaneous, playing('e'), 'e'), true);
  assert.equal(tenantSeatMayAct(simultaneous, playing('e'), 'w'), true);
  assert.equal(tenantSeatMayAct(simultaneous, playing('e'), 'n'), true);
  // and it can still refuse a seat
  assert.equal(tenantSeatMayAct(simultaneous, playing('e'), 's'), false);
});

test('nobody may act on a state that is not playing, hook or no hook', () => {
  // Both call sites lean on this instead of checking status themselves, so a
  // hook that forgot the status check must not be able to resurrect a finished
  // game by accepting a late claim.
  const reckless: Stub = { rules: { seatMayAct: () => true } };
  for (const state of [
    { status: { type: 'setup' }, moveNumber: 0 },
    { status: { type: 'finished', winner: 'e', reason: 'win' }, moveNumber: 9 },
    { status: { type: 'aborted', reason: 'user-abort' }, moveNumber: 0 },
  ] satisfies State[]) {
    assert.equal(tenantSeatMayAct(alternating, state, 'e'), false);
    assert.equal(tenantSeatMayAct(reckless, state, 'e'), false);
  }
});
