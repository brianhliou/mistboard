// The Three Kingdoms banqi dealt FEN (#628) is a study chapter's stored root: a
// reader replays every line from it, so the deal it pins must survive the trip
// exactly, and the fields it does not spell (seat scores, the mover's seat) must
// be rebuilt so play continues as it would have.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initialStartFen, normalizeStartFen, startIsDealt } from './start-fen.js';
import {
  parseThreeKingdomsBanqiFen,
  threeKingdomsBanqiStateToDealtFen,
} from './three-kingdoms-banqi-fen.js';
import { banqiInkForSeat } from './variants-banqi.js';
import {
  applyThreeKingdomsBanqiMove,
  createInitialThreeKingdomsBanqiState,
  getThreeKingdomsBanqiLegalMoves,
  type ThreeKingdomsBanqiMove,
  type ThreeKingdomsBanqiState,
  threeKingdomsBanqiSeatToMove,
  threeKingdomsBanqiStateToFen,
} from './variants-three-kingdoms-banqi.js';

const START_PUBLIC = 'XXXX1XXXX/XXXX1XXXX/9/XXXX1XXXX/XXXX1XXXX - G1A2E2R2H2C2S5g1a2e2r2h2c2s5 0 1';

/** Plays flips and the first available capture until `plies` moves are made. */
function playOut(state: ThreeKingdomsBanqiState, plies: number): ThreeKingdomsBanqiState {
  let current = state;
  for (let i = 0; i < plies; i += 1) {
    const legal = getThreeKingdomsBanqiLegalMoves(current);
    if (legal.length === 0) break;
    const capture = legal.find(
      (m: ThreeKingdomsBanqiMove) => m.from !== m.to && current.board[m.to],
    );
    current = applyThreeKingdomsBanqiMove(current, capture ?? legal[0]!);
  }
  return current;
}

test('the opening deal round-trips exactly, every identity in place', () => {
  const state = createInitialThreeKingdomsBanqiState('t', 11);
  const fen = threeKingdomsBanqiStateToDealtFen(state);
  assert.equal(fen.split(' ').slice(0, 5).join(' '), START_PUBLIC);
  const parsed = parseThreeKingdomsBanqiFen(fen);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  assert.equal(parsed.sampled, false);
  assert.deepEqual(parsed.state.board, state.board);
  assert.equal(parsed.state.firstColor, null);
  assert.equal(threeKingdomsBanqiStateToDealtFen(parsed.state), fen);
});

test('a mid-game position rebuilds its scores, mover ink and legal moves', () => {
  let found: ThreeKingdomsBanqiState | null = null;
  for (let seed = 1; seed < 60 && !found; seed += 1) {
    const played = playOut(createInitialThreeKingdomsBanqiState('t', seed), 45);
    if (played.captures.length > 0 && played.status.type === 'playing') found = played;
  }
  assert.ok(found, 'no seed produced a capture in 45 plies');
  const fen = threeKingdomsBanqiStateToDealtFen(found);
  const parsed = parseThreeKingdomsBanqiFen(fen);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const rebuilt = parsed.state;
  assert.deepEqual(rebuilt.board, found.board);
  // The rebuilt red seat is the mover, holding the original mover's ink and score.
  const moverSeat = threeKingdomsBanqiSeatToMove(found);
  const otherSeat = moverSeat === 'red' ? 'black' : 'red';
  assert.equal(threeKingdomsBanqiSeatToMove(rebuilt), 'red');
  assert.equal(banqiInkForSeat(rebuilt, 'red'), banqiInkForSeat(found, moverSeat));
  assert.equal(rebuilt.scores.red, found.scores[moverSeat]);
  assert.equal(rebuilt.scores.black, found.scores[otherSeat]);
  assert.equal(rebuilt.noProgressClock, found.noProgressClock);
  assert.deepEqual(
    getThreeKingdomsBanqiLegalMoves(rebuilt)
      .map((m) => `${m.from}${m.to}`)
      .sort(),
    getThreeKingdomsBanqiLegalMoves({ ...found, repCounts: {} })
      .map((m) => `${m.from}${m.to}`)
      .sort(),
  );
  assert.equal(threeKingdomsBanqiStateToDealtFen(rebuilt), fen);
});

test('the dealt FEN never reaches the live projection', () => {
  // The live room's public FEN is a different, deal-free string: the study
  // format must not leak into it.
  const state = createInitialThreeKingdomsBanqiState('t', 3);
  const publicFen = threeKingdomsBanqiStateToFen(state);
  assert.equal(publicFen.split(' ').length, 7);
  assert.doesNotMatch(publicFen.split(' ')[0]!, /[GAERHCSgaerhcs]/);
});

test('refuses positions play cannot produce', () => {
  const cases: Array<[string, RegExp]> = [
    // Every tile face-down but an ink already bound.
    [
      'XXXX1XXXX/XXXX1XXXX/9/XXXX1XXXX/XXXX1XXXX r G1A2E2R2H2C2S5g1a2e2r2h2c2s5 0 1',
      /every tile is still face-down/,
    ],
    // One tile up, yet no ink bound.
    [
      'GXXX1XXXX/XXXX1XXXX/9/XXXX1XXXX/XXXX1XXXX - A2E2R2H2C2S5g1a2e2r2h2c2s5 0 1',
      /only legal before the first flip/,
    ],
    // Eight files on a nine-file board.
    ['XXXXXXXX/XXXX1XXXX/9/XXXX1XXXX/XXXX1XXXX - G1 0 1', /covers 8 files/],
    // Four ranks.
    ['XXXX1XXXX/9/XXXX1XXXX/XXXX1XXXX - G1 0 1', /Expected 5 ranks/],
    // Two red generals.
    ['G8/G8/9/9/9 r - 0 5', /Too many red generals/],
  ];
  for (const [fen, pattern] of cases) {
    const parsed = parseThreeKingdomsBanqiFen(fen);
    assert.ok(!parsed.ok && pattern.test(parsed.error), `${fen}: ${JSON.stringify(parsed)}`);
  }
});

test('a composed position already won on points opens finished', () => {
  // Red ink to move, holding its general; black has lost everything but one
  // soldier, so the red seat has 130 points of captures.
  const parsed = parseThreeKingdomsBanqiFen('G8/9/9/9/8s r - 0 30');
  assert.ok(parsed.ok, JSON.stringify(parsed));
  assert.equal(parsed.state.scores.red, 130);
  assert.equal(parsed.state.status.type, 'finished');
});

test('a study mints a fresh deal and the start-fen dispatch knows the variant', () => {
  assert.equal(startIsDealt('three-kingdoms-banqi'), true);
  let seed = 5;
  const rng = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const fen = initialStartFen('three-kingdoms-banqi', rng);
  assert.ok(fen);
  const fields = fen.split(' ');
  assert.equal(fields.length, 6);
  assert.equal(fields.slice(0, 5).join(' '), START_PUBLIC);
  assert.equal(fields[5]!.length, 32);
  const normalized = normalizeStartFen('three-kingdoms-banqi', fen);
  assert.ok(normalized.ok);
  assert.equal(normalized.fen, fen);
});
