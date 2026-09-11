import assert from 'node:assert/strict';
import test from 'node:test';
import { duckXiangqiFen, parseDuckXiangqiFen } from './duck-xiangqi-fen.js';
import { hasStartFen, normalizeStartFen } from './start-fen.js';
import {
  applyDuckXiangqiTurn,
  createInitialDuckXiangqiState,
  DUCK_XIANGQI_START_FEN,
  getDuckXiangqiLegalTurns,
} from './variants-duck-xiangqi.js';

// The seventh field is the whole point of this module: the duck is part of the
// position, so a FEN that loses it describes a different game. Every assertion
// below is ultimately about that field surviving.

test('the start position writes the duck as off the board', () => {
  const fen = duckXiangqiFen(createInitialDuckXiangqiState('t'));
  assert.equal(fen, `${DUCK_XIANGQI_START_FEN} -`);
});

test('a position with the duck on the board round-trips through the FEN', () => {
  // Play one real turn so the duck is placed by the kernel rather than by hand.
  const start = createInitialDuckXiangqiState('t');
  const turn = getDuckXiangqiLegalTurns(start).find((candidate) => candidate.duckTo !== null);
  assert.ok(turn, 'the opening array has a turn that places the duck');
  const played = applyDuckXiangqiTurn(start, turn);
  assert.ok(played.duck, 'the duck is on the board after one turn');

  const fen = duckXiangqiFen(played);
  assert.equal(fen.split(/\s+/).length, 7);
  assert.equal(fen.split(/\s+/)[6], played.duck);

  const parsed = parseDuckXiangqiFen(fen, 't');
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error);
  assert.equal(parsed.state.duck, played.duck);
  assert.deepEqual(parsed.state.board, played.board);
  // Canonical spelling is stable: re-writing the parsed state reproduces the FEN.
  assert.equal(duckXiangqiFen(parsed.state), fen);
});

test('a six-field xiangqi FEN parses as the duck not yet on the board', () => {
  const parsed = parseDuckXiangqiFen(DUCK_XIANGQI_START_FEN, 't');
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error);
  assert.equal(parsed.state.duck, undefined);
  assert.deepEqual(parsed.state.board, createInitialDuckXiangqiState('t').board);
});

test('the duck may not share a point with a piece', () => {
  const parsed = parseDuckXiangqiFen(`${DUCK_XIANGQI_START_FEN} e1`);
  assert.equal(parsed.ok, false);
  assert.match(parsed.ok ? '' : parsed.error, /shares its point/);
});

test('a malformed duck field is refused rather than dropped', () => {
  const parsed = parseDuckXiangqiFen(`${DUCK_XIANGQI_START_FEN} z9`);
  assert.equal(parsed.ok, false);
  assert.match(parsed.ok ? '' : parsed.error, /duck point/);
});

test('a general standing en prise is legal here, unlike standard xiangqi', () => {
  // D4 removes check: the mover may simply be able to take the enemy general.
  // Red chariot on e5 bearing straight up an empty e-file at the black general.
  const parsed = parseDuckXiangqiFen('4k4/9/9/9/9/4R4/9/9/9/4K4 w - - 0 1 a1');
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error);
});

test('facing generals are refused, and a duck between them makes the position legal', () => {
  const facing = parseDuckXiangqiFen('4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1 -');
  assert.equal(facing.ok, false);
  assert.match(facing.ok ? '' : facing.error, /face each other/);

  // The duck blocks the general file like any piece (D1), so the same placement
  // with the duck on e5 is a legal position.
  const blocked = parseDuckXiangqiFen('4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1 e5');
  assert.ok(blocked.ok, blocked.ok ? '' : blocked.error);
  assert.equal(blocked.ok && blocked.state.duck, 'e5');
});

test('the clocks survive the round trip', () => {
  const fen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b - - 17 9 c5';
  const parsed = parseDuckXiangqiFen(fen, 't');
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error);
  assert.equal(parsed.state.progressPlies, 17);
  assert.equal(parsed.state.moveNumber, 9);
  assert.equal(parsed.state.status.type === 'playing' && parsed.state.status.turn, 'black');
  assert.equal(duckXiangqiFen(parsed.state), fen);
});

test('the shared start-FEN dispatch knows duck xiangqi', () => {
  assert.equal(hasStartFen('duck-xiangqi'), true);
  const normalized = normalizeStartFen('duck-xiangqi', DUCK_XIANGQI_START_FEN);
  assert.ok(normalized.ok, normalized.ok ? '' : normalized.error);
  // A six-field paste is canonicalized into the seven-field form.
  assert.equal(normalized.fen, `${DUCK_XIANGQI_START_FEN} -`);
  assert.equal(normalizeStartFen('duck-xiangqi', 'not a fen at all').ok, false);
});
