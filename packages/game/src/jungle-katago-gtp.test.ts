import assert from 'node:assert/strict';
import test from 'node:test';
import { jungleStateToEngineFen } from './jungle-fen.js';
import {
  fromKatagoVertex,
  katagoGenmoveColor,
  toKatagoFen,
  toKatagoVertex,
} from './jungle-katago-gtp.js';
import {
  applyJungleMove,
  createInitialJungleState,
  getJungleLegalMovesFrom,
  type JungleSquare,
} from './variants-jungle.js';

test('the vertex mapping is the file mirror, and its own inverse', () => {
  assert.equal(toKatagoVertex('a1' as JungleSquare), 'G1');
  assert.equal(toKatagoVertex('g9' as JungleSquare), 'A9');
  assert.equal(toKatagoVertex('d5' as JungleSquare), 'D5'); // the centre file is fixed
  for (const file of 'abcdefg') {
    for (let rank = 1; rank <= 9; rank += 1) {
      const square = `${file}${rank}` as JungleSquare;
      assert.equal(fromKatagoVertex(toKatagoVertex(square)), square);
    }
  }
});

test('a vertex that is not a square reads as none, rather than as a1', () => {
  // `genmove` answers "pass" or "resign" at a terminal, and the caller has to be
  // able to tell that from a move.
  for (const junk of ['pass', 'resign', '', 'H1', 'a0', 'a10', 'zz']) {
    assert.equal(fromKatagoVertex(junk), null, junk);
  }
});

test('the start position mirrors onto KataGo’s own start, leopard re-lettered', () => {
  const fen = jungleStateToEngineFen(createInitialJungleState('t'));
  // Ours: tiger a9 ... lion g9. KataGo prints lion a9 ... tiger g9, and rank 7 as
  // "r . j . w . e" — this string is its own `showboard` on the AnimalChess2025
  // branch, read off the running engine rather than reasoned out.
  assert.deepEqual(toKatagoFen(fen), {
    board: 'l5t/1d3c1/r1j1w1e/7/7/7/E1W1J1R/1C3D1/T5L',
    side: 'w',
  });
});

test('digit runs survive the mirror: a rank is reversed by square, not by character', () => {
  // "2e4" reversed as characters would be "4e2" only by luck; "2e11" or a rank
  // whose runs differ in width is where a character reverse goes wrong. Both are
  // checked: the elephant must land on the mirrored file either way.
  assert.equal(toKatagoFen('2e4/7/7/7/7/7/7/7/7 r 0 1').board.split('/')[0], '4e2');
  assert.equal(toKatagoFen('e6/7/7/7/7/7/7/7/7 r 0 1').board.split('/')[0], '6e');
  assert.equal(toKatagoFen('1e5/7/7/7/7/7/7/7/7 r 0 1').board.split('/')[0], '5e1');
});

test('the side to move crosses over: our red is KataGo’s w', () => {
  assert.equal(toKatagoFen('7/7/7/7/7/7/7/7/7 r 0 1').side, 'w');
  assert.equal(toKatagoFen('7/7/7/7/7/7/7/7/7 b 0 1').side, 'b');
  assert.equal(katagoGenmoveColor('red'), 'b');
  assert.equal(katagoGenmoveColor('black'), 'w');
});

test('a mirrored move is legal in the mirrored position, including the tiger jump', () => {
  // The property the whole mapping rests on: jungle is symmetric left-to-right,
  // so a move legal for us is legal there and comes back legal. Checked on the
  // sideways river jump, the move that is furthest from symmetric-looking.
  const base = createInitialJungleState('mirror');
  const from = 'a5' as JungleSquare;
  const state = { ...base, board: { ...base.board, [from]: { color: 'red', role: 'tiger' } } };
  const dests = getJungleLegalMovesFrom(state, from).map((m) => m.to);
  assert.ok(dests.includes('d5' as JungleSquare), 'the tiger clears the west lake sideways');
  // Mirrored, that move is G5 -> D5 in KataGo's coordinates.
  assert.equal(toKatagoVertex(from), 'G5');
  assert.equal(toKatagoVertex('d5' as JungleSquare), 'D5');
  const applied = applyJungleMove(state, { from, to: 'd5' as JungleSquare });
  assert.ok(applied, 'and the kernel accepts it');
});

test('a malformed FEN is refused rather than mirrored into a plausible board', () => {
  assert.throws(() => toKatagoFen('7/7/7 r 0 1'), /9 ranks|expected/);
  assert.throws(() => toKatagoFen('8/7/7/7/7/7/7/7/7 r 0 1'), /squares wide/);
  assert.throws(() => toKatagoFen('7/7/7/7/7/7/7/7/7 x 0 1'), /side to move/);
});
