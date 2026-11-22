import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  analyticsRoomPairing,
  isRoomPairing,
  ROOM_PAIRINGS,
  UNKNOWN_ROOM_PAIRING,
} from './room-pairing.js';

// The values analytics reads (#1229). Adding or renaming one is a dashboard
// change, so it changes this list on purpose.
test('room pairings: the full set of values is pinned', () => {
  assert.deepEqual(
    [...ROOM_PAIRINGS],
    [
      'lobby',
      'friend-link',
      'live-challenge',
      'rematch',
      'correspondence-board',
      'correspondence-quick-pair',
      'correspondence-link',
      'correspondence-challenge',
      'correspondence-host',
      'correspondence-friend-link',
    ],
  );
  assert.equal((ROOM_PAIRINGS as readonly string[]).includes(UNKNOWN_ROOM_PAIRING), false);
});

test('room pairings: every known value passes through unchanged', () => {
  for (const pairing of ROOM_PAIRINGS) {
    assert.equal(isRoomPairing(pairing), true, pairing);
    assert.equal(analyticsRoomPairing(pairing), pairing);
  }
});

// Fail closed: a room whose route reported nothing, or anything unrecognised,
// reads `unknown`, never a neighbouring known value.
test('room pairings: a missing or unknown value reports unknown', () => {
  for (const value of [
    undefined,
    null,
    '',
    'carrier-pigeon',
    'Lobby',
    ' lobby',
    42,
    {},
    ['lobby'],
  ]) {
    assert.equal(isRoomPairing(value), false, String(value));
    assert.equal(analyticsRoomPairing(value), 'unknown', String(value));
  }
});
