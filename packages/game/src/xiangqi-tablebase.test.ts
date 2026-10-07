import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareXiangqiTablebaseMoves,
  createInitialXiangqiState,
  isXiangqiTablebaseCandidate,
  parseChessdbQueryAll,
  parseStandardXiangqiFen,
  type XiangqiGameState,
  type XiangqiTablebaseMove,
  xiangqiTablebaseMateMoves,
} from './index.js';

function stateOf(fen: string): XiangqiGameState {
  const parsed = parseStandardXiangqiFen(fen);
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error);
  return parsed.state;
}

// Horse vs elephant caught on one flank (corpus `horse-vs-elephant-zugzwang`),
// answered by chessdb.cn on 2026-10-07. Red wins only with the horse to d7.
const ZUGZWANG_FEN = '3k5/9/5N3/9/2b6/9/9/9/4K4/9 w - - 0 1';
const ZUGZWANG_ANSWER = [
  'move:f7d6,score:29991,rank:2,note:! (W-M-0009)',
  'move:e1e0,score:0,rank:0,note:? (D-M-0000)',
  'move:e1f1,score:0,rank:0,note:? (D-M-0000)',
  'move:e1e2,score:0,rank:0,note:? (D-M-0000)',
  'move:f7g5,score:0,rank:0,note:? (D-M-0000)',
  'move:f7e5,score:0,rank:0,note:? (D-M-0000)',
  'move:f7h6,score:0,rank:0,note:? (D-M-0000)',
  'move:f7h8,score:0,rank:0,note:? (D-M-0000)',
  'move:f7d8,score:0,rank:0,note:? (D-M-0000)',
  'move:f7g9,score:0,rank:0,note:? (D-M-0000)',
  'move:f7e9,score:0,rank:0,note:? (D-M-0000)',
].join('|');

test('an exact chessdb answer parses into every legal move in our squares', () => {
  const result = parseChessdbQueryAll(`${ZUGZWANG_ANSWER} `, stateOf(ZUGZWANG_FEN));
  assert.ok(result);
  assert.equal(result.result, 'win');
  assert.equal(result.dtm, 9);
  assert.equal(result.moves.length, 11);
  // Rank-0 dialect converted: f7d6 is our f8 -> d7.
  assert.deepEqual(result.moves[0], { from: 'f8', to: 'd7', result: 'win', dtm: 9 });
  assert.ok(result.moves.slice(1).every((m) => m.result === 'draw' && m.dtm === null));
});

test('the side to move losing reads as loss rows, longest resistance first', () => {
  // Black to move in the same zugzwang: one elephant move holds, the other loses.
  const state = stateOf('3k5/9/5N3/9/2b6/9/9/9/4K4/9 b - - 0 1');
  const result = parseChessdbQueryAll(
    'move:c5a7,score:-29980,rank:0,note:? (L-M-0020)|move:c5e7,score:0,rank:2,note:! (D-M-0000)',
    state,
  );
  assert.ok(result);
  assert.equal(result.result, 'draw');
  assert.deepEqual(
    result.moves.map((m) => [m.from, m.to, m.result, m.dtm]),
    [
      ['c6', 'e8', 'draw', null],
      ['c6', 'a8', 'loss', 20],
    ],
  );
});

test('anything short of complete and exact is no data, never a draw', () => {
  const state = stateOf(ZUGZWANG_FEN);
  for (const text of [
    'unknown',
    'invalid board',
    'rate limit exceeded',
    '',
    // A book/search note is an engine figure, not an outcome.
    ZUGZWANG_ANSWER.replace('note:! (W-M-0009)', 'note:! (45-02)'),
    // One legal move missing: the table would claim it is not playable.
    ZUGZWANG_ANSWER.split('|').slice(0, 10).join('|'),
    // A move our kernel rejects.
    `${ZUGZWANG_ANSWER}|move:a0a1,score:0,rank:0,note:? (D-M-0000)`,
    // Malformed rows.
    'move:zz,note:(W-M-0001)',
    '<html>502 Bad Gateway</html>',
  ]) {
    assert.equal(parseChessdbQueryAll(text, state), null, JSON.stringify(text.slice(0, 60)));
  }
});

test('a middlegame book answer is not exact', () => {
  const start = createInitialXiangqiState('t');
  assert.equal(
    parseChessdbQueryAll(
      'move:b2e2,score:0,rank:2,note:! (45-02),winrate:50.00|move:h2e2,score:0,rank:2,note:! (45-02),winrate:50.00',
      start,
    ),
    null,
  );
});

test('best first: fastest win, draws, then the slowest loss', () => {
  const row = (to: string, result: XiangqiTablebaseMove['result'], dtm: number | null) =>
    ({ from: 'a1', to, result, dtm }) as XiangqiTablebaseMove;
  const rows = [
    row('a2', 'loss', 4),
    row('a3', 'draw', null),
    row('a4', 'win', 21),
    row('a5', 'loss', 30),
    row('a6', 'win', 9),
    row('a7', 'win', null),
    row('a8', 'loss', null),
  ];
  rows.sort(compareXiangqiTablebaseMoves);
  assert.deepEqual(
    rows.map((r) => r.to),
    ['a6', 'a4', 'a7', 'a3', 'a5', 'a2', 'a8'],
  );
});

test('only endgame material is worth asking about', () => {
  assert.equal(isXiangqiTablebaseCandidate(createInitialXiangqiState('t')), false);
  assert.equal(isXiangqiTablebaseCandidate(stateOf(ZUGZWANG_FEN)), true);
  // Five attackers still asks; six does not.
  assert.equal(isXiangqiTablebaseCandidate(stateOf('3k5/9/9/p1p1p4/9/9/P8/9/9/4K4 w')), true);
  assert.equal(isXiangqiTablebaseCandidate(stateOf('3k5/9/9/p1p1p1p2/9/9/P8/9/9/4K4 w')), true);
  assert.equal(isXiangqiTablebaseCandidate(stateOf('3k5/9/9/p1p1p1p2/9/9/P1P6/9/9/4K4 w')), false);
});

test('mate distance reads in full moves', () => {
  assert.equal(xiangqiTablebaseMateMoves(9), 5);
  assert.equal(xiangqiTablebaseMateMoves(20), 10);
  assert.equal(xiangqiTablebaseMateMoves(1), 1);
});
