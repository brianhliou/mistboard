import assert from 'node:assert/strict';
import test from 'node:test';

import { createTenantClock, nextTenantClockForMove } from './runtime.js';

type Seat = 'east' | 'south' | 'west' | 'north';
const tenant = {
  colors: ['east', 'south', 'west', 'north'] as const satisfies readonly Seat[],
  armsClockOnFirstMove: true,
};
const playing = (turn: Seat) => ({ type: 'playing' as const, turn });

// The owner-driven clock exists for a table where a move is an action rather
// than a turn and a seat can act out of turn. These walk a mahjong turn:
// east draws, east discards (window opens, nobody on the clock), south claims
// (south on the clock), south discards, and so on.

test('arms on the first move with the owner on the clock, not the mover', () => {
  const clock = createTenantClock(tenant, 300_000, 5_000);
  const armed = nextTenantClockForMove(
    tenant,
    clock,
    1_000,
    'east',
    0,
    playing('east'),
    'live',
    'east',
  );
  assert.equal(armed?.activeColor, 'east');
  assert.equal(armed?.runningSince, 1_000);
});

test('a window pauses the clock: nobody is charged and it still reads as armed', () => {
  let clock = createTenantClock(tenant, 300_000, 5_000);
  clock = nextTenantClockForMove(tenant, clock, 1_000, 'east', 0, playing('east'), 'live', 'east')!;
  // East thinks for 4 s, then discards; the window opens and the owner is null.
  const paused = nextTenantClockForMove(
    tenant,
    clock,
    5_000,
    'east',
    1,
    playing('east'),
    'live',
    null,
  )!;
  assert.equal(paused.activeColor, null);
  assert.notEqual(paused.runningSince, null, 'paused is not un-armed');
  // East spent 4 s and earned the increment for handing the clock on.
  assert.equal(paused.remainingMs.east, 300_000 + 5_000 - 4_000 + 5_000);
  // Six seconds of window later, a claim by south: nobody paid for the window.
  const claimed = nextTenantClockForMove(
    tenant,
    paused,
    11_000,
    'south',
    2,
    playing('south'),
    'live',
    'south',
  )!;
  assert.equal(claimed.activeColor, 'south');
  assert.equal(claimed.runningSince, 11_000);
  assert.equal(claimed.remainingMs.east, paused.remainingMs.east);
  assert.equal(claimed.remainingMs.south, 300_000);
});

test('a turn of several actions earns the increment once, on the action that hands on', () => {
  let clock = createTenantClock(tenant, 300_000, 5_000);
  clock = nextTenantClockForMove(tenant, clock, 0, 'east', 0, playing('east'), 'live', 'east')!;
  clock = nextTenantClockForMove(tenant, clock, 2_000, 'east', 1, playing('east'), 'live', null)!;
  clock = nextTenantClockForMove(
    tenant,
    clock,
    2_000,
    'east',
    2,
    playing('south'),
    'live',
    'south',
  )!;
  // South draws (still south's clock: no increment) then discards (increment).
  const drawn = nextTenantClockForMove(
    tenant,
    clock,
    3_000,
    'south',
    3,
    playing('south'),
    'live',
    'south',
  )!;
  assert.equal(drawn.activeColor, 'south');
  assert.equal(drawn.remainingMs.south, 300_000 - 1_000);
  const discarded = nextTenantClockForMove(
    tenant,
    drawn,
    6_000,
    'south',
    4,
    playing('south'),
    'live',
    null,
  )!;
  assert.equal(discarded.remainingMs.south, 300_000 - 1_000 - 3_000 + 5_000);
});

test('the clock follows a claim to a seat whose turn it was not', () => {
  let clock = createTenantClock(tenant, 300_000, 5_000);
  clock = nextTenantClockForMove(tenant, clock, 0, 'east', 0, playing('east'), 'live', 'east')!;
  clock = nextTenantClockForMove(tenant, clock, 1_000, 'east', 1, playing('east'), 'live', null)!;
  // West pungs east's discard out of turn.
  const west = nextTenantClockForMove(
    tenant,
    clock,
    3_000,
    'west',
    2,
    playing('west'),
    'live',
    'west',
  )!;
  assert.equal(west.activeColor, 'west');
  // The turn-driven default leaves east on the clock here: the discard kept
  // east as the turn (a window is the discarder's), and a move by any other
  // seat does not advance a clock it is not running.
  let legacy = createTenantClock(tenant, 300_000, 5_000);
  legacy = nextTenantClockForMove(tenant, legacy, 0, 'east', 0, playing('east'))!;
  legacy = nextTenantClockForMove(tenant, legacy, 1_000, 'east', 1, playing('east'))!;
  legacy = nextTenantClockForMove(tenant, legacy, 3_000, 'west', 2, playing('west'))!;
  assert.equal(
    legacy.activeColor,
    'east',
    'the default path never moved the clock off the discarder',
  );
});

test('a game-ending move stops the clock and settles the running seat', () => {
  let clock = createTenantClock(tenant, 300_000, 5_000);
  clock = nextTenantClockForMove(tenant, clock, 0, 'east', 0, playing('east'), 'live', 'east')!;
  const finished = nextTenantClockForMove(
    tenant,
    clock,
    7_000,
    'east',
    1,
    { type: 'finished', winner: 'east', reason: 'self-draw' },
    'live',
    null,
  )!;
  assert.equal(finished.activeColor, null);
  assert.equal(finished.runningSince, null);
  assert.equal(finished.remainingMs.east, 300_000 + 5_000 - 7_000, 'no increment on the last move');
});
