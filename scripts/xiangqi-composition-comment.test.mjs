import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compositionComment, proseFrom } from './xiangqi-compositions/composition-comment.mjs';

const base = {
  zh: '匹马嘶风',
  en: 'A Lone Horse Neighs in the Wind',
  n: 516,
  vol: 6,
  volZh: '卷六',
  bookZh: '適情雅趣',
  variations: 0,
  url: 'http://www.dpxq.com/hldcg/search/view_u_43233.html',
};

test('a chapter with a real line says only what the board does not', () => {
  const text = compositionComment({ ...base, moveCount: 33, prose: [] });
  // Deliberately silent about the line. "The solution runs 33 moves and is
  // played out below" shipped on four hundred chapters and restated the board.
  assert.doesNotMatch(text, /33 moves/);
  assert.doesNotMatch(text, /printed variation/);
  assert.match(text, /Problem 516 of 適情雅趣, volume 6 \(卷六\)/);
  assert.match(text, /Transcribed from http:\/\/www\.dpxq\.com/);
});

test('a one-move record with prose quotes the prose, and drops the false claim', () => {
  const text = compositionComment({
    ...base,
    moveCount: 1,
    prose: ['红先和局', '再三退四，四退三，退占相头，即成和棋。'],
  });
  assert.match(text, /「红先和局」/);
  assert.match(text, /「再三退四，四退三，退占相头，即成和棋。」/);
  // The sentence 53 published chapters carried. It is false whenever the source
  // does give an answer, and that is the whole reason this module exists.
  assert.doesNotMatch(text, /records only the opening move/);
});

test('a one-move record with no prose says exactly that', () => {
  const text = compositionComment({ ...base, moveCount: 1, prose: [] });
  assert.match(text, /records only the opening move of the solution/);
});

test('a missing English rendering falls back to the Chinese title alone', () => {
  const text = compositionComment({ ...base, en: undefined, moveCount: 5, prose: [] });
  assert.ok(text.startsWith('匹马嘶风\n\n'));
  assert.doesNotMatch(text, /—/);
});

test('prose is ordered by ply number, not by string', () => {
  // dpxq keys comments by the ply they hang off, as strings, sparsely. Sorting
  // those as text puts comment10 between comment1 and comment2.
  const rec = { comments: { 10: 'tenth', 2: 'second', 0: 'verdict' } };
  assert.deepEqual(proseFrom(rec), ['verdict', 'second', 'tenth']);
});

test('a record with no comments yields no prose', () => {
  assert.deepEqual(proseFrom({}), []);
  assert.deepEqual(proseFrom(undefined), []);
});
