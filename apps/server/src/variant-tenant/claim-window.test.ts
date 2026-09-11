import assert from 'node:assert/strict';
import test from 'node:test';

import {
  type ClaimWindow,
  claimWindowClaims,
  claimWindowComplete,
  claimWindowPending,
  claimWindowRemainingMs,
  claimWindowSettled,
  openClaimWindow,
  submitClaim,
} from './claim-window.js';

type Seat = 'e' | 's' | 'w' | 'n';
const open = (eligible: Seat[] = ['s', 'w', 'n'], at = 1_000, ms = 5_000) =>
  openClaimWindow<Seat, string>(eligible, at, ms);

test('a fresh window owes every eligible seat an answer', () => {
  const w = open();
  assert.deepEqual(claimWindowPending(w), ['s', 'w', 'n']);
  assert.equal(claimWindowComplete(w), false);
  assert.equal(claimWindowSettled(w, 1_000), false);
  assert.equal(claimWindowRemainingMs(w, 1_000), 5_000);
});

test('a window with no timeout is refused', () => {
  assert.throws(() => openClaimWindow<Seat, string>(['s'], 0, 0), /positive timeout/);
});

test('it settles early, the moment everyone has answered', () => {
  // Without this the game crawls: every discard would wait out a timer even
  // when all three seats have already passed.
  let w: ClaimWindow<Seat, string> = open();
  w = submitClaim(w, 's', null);
  w = submitClaim(w, 'w', 'pung');
  assert.equal(claimWindowSettled(w, 1_100), false);
  w = submitClaim(w, 'n', null);
  assert.equal(claimWindowComplete(w), true);
  assert.equal(claimWindowSettled(w, 1_100), true);
});

test('it settles on the deadline even if a seat never answers', () => {
  // Without this one dropped connection hangs the room for everyone.
  let w: ClaimWindow<Seat, string> = open();
  w = submitClaim(w, 's', null);
  assert.equal(claimWindowSettled(w, 5_999), false);
  assert.equal(claimWindowSettled(w, 6_000), true);
  assert.deepEqual(claimWindowPending(w), ['w', 'n']);
  assert.equal(claimWindowRemainingMs(w, 9_999), 0);
});

test('silence and a decline are both "no claim", and neither is an answer to resolve', () => {
  let w: ClaimWindow<Seat, string> = open();
  w = submitClaim(w, 's', null);
  assert.deepEqual(claimWindowClaims(w), []);
  // but they are distinguishable: one seat has spoken, two have not
  assert.deepEqual(claimWindowPending(w), ['w', 'n']);
});

test('a seat cannot answer twice', () => {
  // Otherwise a client could pung, watch the window stay open, and upgrade to a
  // win - or simply double-submit on a flaky connection and overwrite an answer
  // that had already been counted.
  let w: ClaimWindow<Seat, string> = open();
  w = submitClaim(w, 'w', 'chow');
  w = submitClaim(w, 'w', 'win');
  assert.deepEqual(claimWindowClaims(w), [{ seat: 'w', response: 'chow' }]);
});

test('a declined seat cannot come back and claim', () => {
  let w: ClaimWindow<Seat, string> = open();
  w = submitClaim(w, 'n', null);
  w = submitClaim(w, 'n', 'win');
  assert.deepEqual(claimWindowClaims(w), []);
});

test('a seat that is not eligible is ignored rather than rejected', () => {
  // The discarder's own socket, or a spectator's, is a normal thing to receive.
  let w: ClaimWindow<Seat, string> = open(['s', 'w', 'n']);
  w = submitClaim(w, 'e', 'win');
  assert.deepEqual(claimWindowClaims(w), []);
  assert.equal(claimWindowComplete(w), false);
});

test('claims come back in eligibility order, not arrival order', () => {
  // Resolution ranks by seat distance from the discarder, and eligibility is
  // built in that order. Arrival order is network noise.
  let w: ClaimWindow<Seat, string> = open(['s', 'w', 'n']);
  w = submitClaim(w, 'n', 'win');
  w = submitClaim(w, 's', 'chow');
  w = submitClaim(w, 'w', 'pung');
  assert.deepEqual(claimWindowClaims(w), [
    { seat: 's', response: 'chow' },
    { seat: 'w', response: 'pung' },
    { seat: 'n', response: 'win' },
  ]);
});

test('submitting never mutates the window it was given', () => {
  const first = open();
  const second = submitClaim(first, 's', 'pung');
  assert.equal(first.responses.size, 0);
  assert.equal(second.responses.size, 1);
  assert.notEqual(first, second);
});

test('a single-seat window settles on that one answer', () => {
  let w = openClaimWindow<Seat, string>(['s'], 0, 1_000);
  w = submitClaim(w, 's', 'pung');
  assert.equal(claimWindowSettled(w, 1), true);
  assert.deepEqual(claimWindowClaims(w), [{ seat: 's', response: 'pung' }]);
});

test('an empty window is settled immediately', () => {
  // Nobody can claim, so there is nothing to wait for. Waiting out the timer
  // here would add a pause to every discard nobody could have taken.
  const w = openClaimWindow<Seat, string>([], 0, 1_000);
  assert.equal(claimWindowComplete(w), true);
  assert.equal(claimWindowSettled(w, 0), true);
  assert.deepEqual(claimWindowClaims(w), []);
});
