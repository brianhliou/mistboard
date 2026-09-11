/**
 * The executable form of docs-private/spectator-visibility-matrix.md.
 *
 * This file, not the golden wire fixtures, is the contract for who sees what in
 * a room. The fixtures record a payload shape; this records the RULE. When the
 * two disagree, one of them is wrong on purpose and this one says which.
 *
 * Written before the fixtures were touched, deliberately: a fixture updated
 * until it passes defines the behaviour as "whatever the code now does", which
 * is exactly how a fog leak ships looking correct.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { GAME_SPECS, type VisibilityRulesId } from '@mistboard/game';
import { type RoomViewPolicy, roomViewPolicy } from './server-policy.js';

type Seat = 'player' | 'spectator';

type Cell = {
  visibility: VisibilityRulesId;
  finished: boolean;
  seat: Seat;
  expected: RoomViewPolicy;
};

// One row per cell of the signed-off matrix. Written out longhand rather than
// generated, so a wrong expectation has to be typed by a person rather than
// derived from the implementation it is supposed to check.
const MATRIX: readonly Cell[] = [
  // open: nothing is hidden by the rules, so there is never anything to redact.
  { visibility: 'open', finished: false, seat: 'player', expected: 'truth' },
  { visibility: 'open', finished: false, seat: 'spectator', expected: 'truth' },
  { visibility: 'open', finished: true, seat: 'player', expected: 'truth' },
  { visibility: 'open', finished: true, seat: 'spectator', expected: 'truth' },

  // hidden-identity: a live spectator gets the narrower public view, never a
  // seat's view and never the union of both.
  { visibility: 'hidden-identity', finished: false, seat: 'player', expected: 'own-view' },
  { visibility: 'hidden-identity', finished: false, seat: 'spectator', expected: 'public-view' },
  { visibility: 'hidden-identity', finished: true, seat: 'player', expected: 'truth' },
  { visibility: 'hidden-identity', finished: true, seat: 'spectator', expected: 'truth' },

  // dark: the invariant. A live fog board never leaves the server for anyone
  // but the seat that owns it. This is the only catastrophic row in the table.
  { visibility: 'dark', finished: false, seat: 'player', expected: 'own-view' },
  { visibility: 'dark', finished: false, seat: 'spectator', expected: 'nothing' },
  { visibility: 'dark', finished: true, seat: 'player', expected: 'truth' },
  { visibility: 'dark', finished: true, seat: 'spectator', expected: 'truth' },

  // concealed-hands: mahjong, added to the union after the matrix was signed.
  // A live hand is the same class of secret as a fogged piece. The tenant
  // declares no truthView, so the runtime fails closed before these rows are
  // consulted; they pin what a future truthView would inherit.
  { visibility: 'concealed-hands', finished: false, seat: 'player', expected: 'own-view' },
  { visibility: 'concealed-hands', finished: false, seat: 'spectator', expected: 'nothing' },
  { visibility: 'concealed-hands', finished: true, seat: 'player', expected: 'truth' },
  { visibility: 'concealed-hands', finished: true, seat: 'spectator', expected: 'truth' },
];

test('roomViewPolicy matches the signed-off matrix, cell for cell', () => {
  for (const cell of MATRIX) {
    assert.equal(
      roomViewPolicy(cell.visibility, cell.finished, cell.seat),
      cell.expected,
      `${cell.visibility} / ${cell.finished ? 'finished' : 'live'} / ${cell.seat}`,
    );
  }
});

test('the matrix covers every visibility class in the union', () => {
  // Guards the gap this test could otherwise hide: a new VisibilityRulesId
  // member makes roomViewPolicy fail to compile, but nothing would force a row
  // to be ADDED here, so the new class would ship untested.
  const covered = new Set(MATRIX.map((cell) => cell.visibility));
  const declared = new Set(GAME_SPECS.map((spec) => spec.visibility));
  for (const visibility of declared) {
    assert.ok(covered.has(visibility), `no matrix rows for visibility class '${visibility}'`);
  }
});

test('the matrix covers all four cells for every class it names', () => {
  for (const visibility of new Set(MATRIX.map((cell) => cell.visibility))) {
    for (const finished of [false, true]) {
      for (const seat of ['player', 'spectator'] as const) {
        const found = MATRIX.filter(
          (cell) =>
            cell.visibility === visibility && cell.finished === finished && cell.seat === seat,
        );
        assert.equal(found.length, 1, `${visibility} / ${finished} / ${seat}: expected exactly 1`);
      }
    }
  }
});

test('no live game ever resolves to truth for a spectator, except open', () => {
  // Stated separately from the table because it is the property that actually
  // matters. If someone edits a MATRIX row by hand to make a fixture pass, this
  // still fails.
  for (const visibility of new Set(GAME_SPECS.map((spec) => spec.visibility))) {
    const live = roomViewPolicy(visibility, false, 'spectator');
    if (visibility === 'open') {
      assert.equal(live, 'truth');
      continue;
    }
    assert.notEqual(live, 'truth', `live ${visibility} must never serve truth to a spectator`);
  }
});

test('a live dark room serves a spectator no board at all', () => {
  // The single row whose failure is a hidden-information leak rather than a
  // cosmetic bug. Asserted on its own so it can never be lost in a table edit.
  assert.equal(roomViewPolicy('dark', false, 'spectator'), 'nothing');
});
