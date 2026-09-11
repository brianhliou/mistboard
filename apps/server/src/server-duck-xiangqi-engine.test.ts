// The Duck Xiangqi <-> Fairy-Stockfish turn encoding.
//
// Every expectation here was measured against the patched binary on 2026-09-09
// (`go perft 1` from the start array, and from a hand-built general-capture
// position), so a failure means the encoding drifted, not that the fixture is a
// guess:
//
//   startpos           2554 tokens, the first being `a1a2,a2a1`
//   4k4/9/9/9/9/4R4/9/9/9/*3K4 w
//                      947 tokens over 11 piece halves; the ten quiet moves
//                      carry 86 duck points each and the general capture
//                      `e5e10` carries 87, for ONE kernel turn.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createInitialDuckXiangqiState,
  type DuckXiangqiGameState,
  getDuckXiangqiLegalTurns,
} from '@mistboard/game';
import { duckXiangqiTurnToFsfUci, legalTurnForUci } from './server-duck-xiangqi-engine.js';

// Red chariot on e5, red general e1, black general e10, duck on a1. Red to move
// and Re5xe10 captures the general, so the kernel emits one `duckTo: null` turn.
function generalCaptureState(): DuckXiangqiGameState {
  return {
    id: 'duck-capture-fixture',
    board: {
      e1: { color: 'red', role: 'general' },
      e5: { color: 'red', role: 'chariot' },
      e10: { color: 'black', role: 'general' },
    },
    duck: 'a1',
    status: { type: 'playing', turn: 'red' },
    moveNumber: 1,
    positionCounts: {},
    progressPlies: 0,
  };
}

test('a turn spells as one token whose duck half echoes the piece destination', () => {
  assert.equal(
    duckXiangqiTurnToFsfUci({ from: 'a1', to: 'a2', duckTo: 'e5' }),
    'a1a2,a2e5',
    'the duck half starts from the PIECE destination, not from where the duck stands',
  );
  // The literal first token of the engine's own perft list at the start array:
  // the duck lands on the square the piece just vacated.
  assert.equal(duckXiangqiTurnToFsfUci({ from: 'a1', to: 'a2', duckTo: 'a1' }), 'a1a2,a2a1');
  // Squares are a1-i10 on both sides. No rank shift (that is Pikafish-only), and
  // two-digit ranks survive.
  assert.equal(duckXiangqiTurnToFsfUci({ from: 'i10', to: 'i9', duckTo: 'i10' }), 'i10i9,i9i10');
});

test('every legal turn at the start array round-trips back to the same turn', () => {
  const state = createInitialDuckXiangqiState('duck-roundtrip-fixture');
  const turns = getDuckXiangqiLegalTurns(state);
  // The count the railpack build gate asserts against the binary; if the kernel
  // moves, the encoding tests below are measuring a different game.
  assert.equal(turns.length, 2554);

  const seen = new Set<string>();
  for (const turn of turns) {
    const uci = duckXiangqiTurnToFsfUci(turn);
    assert.match(
      uci,
      /^[a-i](?:10|[1-9])[a-i](?:10|[1-9]),[a-i](?:10|[1-9])[a-i](?:10|[1-9])$/,
      uci,
    );
    assert.ok(!seen.has(uci), `two turns spell the same token: ${uci}`);
    seen.add(uci);
    // The whole point of generating rather than parsing: the matcher hands back
    // the KERNEL's own object, not one reconstructed from the engine's string.
    assert.equal(legalTurnForUci(turns, uci), turn, uci);
  }
});

test('a duck placement is what distinguishes two turns with the same piece move', () => {
  const state = createInitialDuckXiangqiState('duck-placement-fixture');
  const turns = getDuckXiangqiLegalTurns(state);
  const sameMove = turns.filter((turn) => turn.from === 'a1' && turn.to === 'a2');
  assert.ok(sameMove.length > 50, `expected many duck points for a1a2, got ${sameMove.length}`);

  const first = legalTurnForUci(turns, 'a1a2,a2a1');
  const second = legalTurnForUci(turns, 'a1a2,a2e5');
  assert.deepEqual(first, { from: 'a1', to: 'a2', duckTo: 'a1' });
  assert.deepEqual(second, { from: 'a1', to: 'a2', duckTo: 'e5' });

  // A duck point that is occupied is not a legal turn, and must not resolve.
  assert.equal(legalTurnForUci(turns, 'a1a2,a2e1'), null, 'e1 holds the red general');
});

test('the flying general capture resolves from the token the engine prints', () => {
  // D5 (2026-09-10) added a move class that had never gone through this matcher:
  // the general flying down a clear file to take the other general. It is a
  // general capture, so the kernel gives it `duckTo: null` and one turn.
  //
  // The engine prints it with a duck half anyway. Measured from the patched
  // binary on this exact position: `bestmove e2e9,e9a1`, where a1 is simply
  // where the duck already stands, because the generated move carries no
  // gating square and FSF prints the empty one as a1. The duck half is noise
  // and the piece half is the whole match, which is what the capture branch of
  // legalTurnForUci already does.
  const state: DuckXiangqiGameState = {
    id: 'flying-capture',
    board: {
      e2: { color: 'red', role: 'general' },
      e9: { color: 'black', role: 'general' },
      a4: { color: 'red', role: 'soldier' },
    },
    duck: 'a1',
    status: { type: 'playing', turn: 'red' },
    moveNumber: 1,
    positionCounts: {},
    progressPlies: 0,
  };
  const turns = getDuckXiangqiLegalTurns(state);
  const flight = turns.filter((turn) => turn.from === 'e2' && turn.to === 'e9');
  assert.equal(flight.length, 1, 'one turn, not one per duck point');
  assert.equal(flight[0].duckTo, null);
  assert.equal(duckXiangqiTurnToFsfUci(flight[0]), 'e2e9', 'we spell it as the piece half alone');

  // Both spellings must land on the same kernel turn: ours, and the engine's.
  assert.equal(legalTurnForUci(turns, 'e2e9'), flight[0]);
  assert.equal(legalTurnForUci(turns, 'e2e9,e9a1'), flight[0], "the engine's own token");
});

test('a general capture is one kernel turn against many engine tokens', () => {
  const turns = getDuckXiangqiLegalTurns(generalCaptureState());
  const capture = turns.filter((turn) => turn.duckTo === null);
  assert.equal(capture.length, 1);
  assert.deepEqual(capture[0], { from: 'e5', to: 'e10', duckTo: null });

  // The kernel turn has no one-token FSF spelling, so it spells as the piece
  // half alone. Documented in the loop: it only ever travels engine -> kernel,
  // because the game ends on the capture and the turn is never replayed.
  assert.equal(duckXiangqiTurnToFsfUci(capture[0]!), 'e5e10');

  // FSF places the duck anyway and emits one token per legal point (87 of them
  // on this board). Every one of them must resolve to that single kernel turn.
  for (const token of ['e5e10,e10i10', 'e5e10,e10e5', 'e5e10,e10e9']) {
    assert.equal(legalTurnForUci(turns, token), capture[0], token);
  }
  // And so must the bare piece half, in case a future build stops appending one.
  assert.equal(legalTurnForUci(turns, 'e5e10'), capture[0]);
});

test('the piece-half escape hatch is restricted to capture turns', () => {
  const turns = getDuckXiangqiLegalTurns(generalCaptureState());
  // e5e6 is a legal quiet move, so `e5e6,e6e5` (duck onto the vacated square)
  // resolves...
  assert.deepEqual(legalTurnForUci(turns, 'e5e6,e6e5'), { from: 'e5', to: 'e6', duckTo: 'e5' });
  // ...but its piece half alone is NOT a turn the kernel has, and must not be
  // rescued into one with an arbitrary duck placement.
  assert.equal(legalTurnForUci(turns, 'e5e6'), null);
  // A duck half whose origin is not the piece destination is drift, not a turn.
  assert.equal(legalTurnForUci(turns, 'e5e6,e5a2'), null);
  // The duck may not stay where it stands, so its own square never resolves.
  assert.equal(legalTurnForUci(turns, 'e5e6,e6a1'), null, 'the duck already stands on a1');
});

test('an unmatched engine reply fails closed rather than guessing', () => {
  const turns = getDuckXiangqiLegalTurns(createInitialDuckXiangqiState('duck-reject-fixture'));
  for (const token of [
    '', // no move
    'a1a2', // piece half of a non-capture turn
    'a1a2,', // truncated
    'a1a2,a2z9', // off-board duck point
    'b1c3,c3e8 i10i9,i9b1', // a pv, not a move
    'e5e5,e5a1', // null piece move
    'R@d4', // the fortress drop encoding
    'a2a3,a3a2', // legal SHAPE, but not a legal turn here
  ]) {
    assert.equal(legalTurnForUci(turns, token), null, `should not match: "${token}"`);
  }
});
