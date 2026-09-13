import assert from 'node:assert/strict';
import test from 'node:test';
import { fitStudyTitleLines, studyChapterOgPieces } from './og-image.js';

// Golden Roc composition 1 ("The horse leaps Tan Creek"), taken from the live
// study. A 排局 IS its diagram, so the card has to key off the chapter's own
// hand-set position rather than the variant's start.
const COMPOSITION_FEN = '3ak4/4a4/b3b3P/9/4N2R1/9/2p6/1p1AB4/3KA4/n3r1B2 r - - 0 1';

test('a composition chapter renders its own hand-set position', () => {
  const pieces = studyChapterOgPieces({
    version: 1,
    root: { children: [] },
    rootFen: COMPOSITION_FEN,
  });
  assert.ok(pieces);
  assert.equal(pieces.length, 17);
  // The red soldier on i8 is the piece the composition turns on; if the rank or
  // file mapping ever flips, this moves.
  assert.ok(
    pieces.some((p) => p.color === 'red' && p.role === 'soldier' && p.file === 8 && p.rank === 8),
  );
  assert.ok(pieces.some((p) => p.color === 'black' && p.role === 'general'));
});

test('a chapter with no rootFen renders the standard start', () => {
  const pieces = studyChapterOgPieces({ version: 1, root: { children: [] } });
  assert.ok(pieces);
  assert.equal(pieces.length, 32);
});

// Falling back to the default card is the only safe answer: rendering the
// standard start for a composition would publish a board that is not the one
// the study actually holds.
test('an unparseable rootFen falls back rather than rendering a wrong board', () => {
  assert.equal(
    studyChapterOgPieces({ version: 1, root: { children: [] }, rootFen: 'nonsense' }),
    null,
  );
  assert.equal(studyChapterOgPieces({ version: 1, root: { children: [] }, rootFen: '' }), null);
});

test('a malformed tree blob still yields the standard start rather than throwing', () => {
  for (const root of [null, undefined, 'x', {}, { rootFen: 42 }]) {
    assert.equal(studyChapterOgPieces(root)?.length, 32);
  }
});

// Mirrors the route in server-http.ts. Both forms have to resolve, and a deeper
// path must NOT match (it would silently render the wrong chapter).
const STUDY_OG_ROUTE = /^\/og\/study\/([^/]+?)(?:\/([^/]+?))?\.png$/;

test('the og route resolves study and chapter forms', () => {
  const study = STUDY_OG_ROUTE.exec('/og/study/Dfi3NpRE.png');
  assert.deepEqual([study?.[1], study?.[2]], ['Dfi3NpRE', undefined]);

  const chapter = STUDY_OG_ROUTE.exec('/og/study/Dfi3NpRE/Xzlg0GwU.png');
  assert.deepEqual([chapter?.[1], chapter?.[2]], ['Dfi3NpRE', 'Xzlg0GwU']);

  assert.equal(STUDY_OG_ROUTE.exec('/og/study/a/b/c.png'), null);
  assert.equal(STUDY_OG_ROUTE.exec('/og/study/.png'), null);
  assert.equal(STUDY_OG_ROUTE.exec('/og/study/Dfi3NpRE'), null);
});

// --- card titles ---------------------------------------------------------------

// Composition titles are sentences. 50 of the 52 published chapter titles exceed
// the 24-char cap the game card applies to player names, so the study card wrapped
// instead of inheriting a limit tuned for a different layout.
test('a short title stays on one line', () => {
  assert.deepEqual(fitStudyTitleLines('1. The horse leaps Tan Creek'), [
    '1. The horse leaps Tan Creek',
  ]);
});

test('the longest published title wraps whole, at a word boundary', () => {
  const lines = fitStudyTitleLines(
    'Small opposing cannons give up the elephant to trap the chariot',
  );
  assert.equal(lines.length, 2);
  assert.equal(lines.join(' '), 'Small opposing cannons give up the elephant to trap the chariot');
  assert.ok(!lines[0]!.endsWith(' '));
});

// CJK has no spaces, so word-boundary wrapping would return one unbreakable
// token and overflow the card.
test('a CJK title wraps per character and counts double width', () => {
  assert.deepEqual(fitStudyTitleLines('雙車難破馬砲士象全'), ['雙車難破馬砲士象全']);
  const long = fitStudyTitleLines('橘中秘卷三車卒殘局第十七局又局兌車和單車肘心變着詳解補遺');
  assert.equal(long.length, 2);
  assert.ok(long[0]!.length <= 23, 'a wide-script line holds at most half the half-widths');
});

test('a title too long for both lines is ellipsized rather than overrunning', () => {
  const lines = fitStudyTitleLines('x'.repeat(200));
  assert.equal(lines.length, 2);
  assert.ok(lines[1]!.endsWith('…'));
});

test('an empty or whitespace title degrades to one empty line', () => {
  assert.deepEqual(fitStudyTitleLines(''), ['']);
  assert.deepEqual(fitStudyTitleLines('   '), ['']);
});

// The article prerender writes the og:image URL itself and cannot import this
// module, so its copy of the version is pinned here: a bump on one side that
// misses the other ships a card scrapers never refetch.
test('the article prerender carries the same article card version', async () => {
  const { readFile } = await import('node:fs/promises');
  const { resolve } = await import('node:path');
  const { ARTICLE_OG_IMAGE_VERSION } = await import('./og-image.js');
  const source = await readFile(
    resolve(import.meta.dirname, '../../web/scripts/prerender-articles.mjs'),
    'utf-8',
  );
  assert.ok(
    source.includes(`const ARTICLE_OG_IMAGE_VERSION = ${ARTICLE_OG_IMAGE_VERSION};`),
    `prerender-articles.mjs must declare ARTICLE_OG_IMAGE_VERSION = ${ARTICLE_OG_IMAGE_VERSION}`,
  );
  assert.ok(source.includes('.png?v=${ARTICLE_OG_IMAGE_VERSION}`'), 'the og:image URL carries ?v=');
});
