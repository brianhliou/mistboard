import assert from 'node:assert/strict';
import test from 'node:test';
import { embedPathForTarget, embedTargetFromUrl } from './embed-contract.js';

// The forum expands a line that is only a URL, and the oEmbed provider answers
// for the same URL; both read this parser, so the table below is the whole
// agreement. Add a row when a new surface becomes embeddable.

test('games match on the permalink, a tenant route, and the embed path', () => {
  for (const url of [
    'https://mistboard.com/game/abc-123',
    'https://mistboard.com/xiangqi/game/abc-123',
    'https://mistboard.com/dark-xiangqi/game/abc-123/',
    'https://mistboard.com/embed/game/abc-123',
    '/game/abc-123',
  ]) {
    assert.deepEqual(
      embedTargetFromUrl(url),
      { kind: 'game', roomId: 'abc-123', ply: null, pov: null },
      url,
    );
  }
});

test('a game link can name a ply and a side, in our spelling or in lichess spelling', () => {
  const game = (ply: number | null, pov: 'white' | 'black' | 'truth' | null) => ({
    kind: 'game',
    roomId: 'abc-123',
    ply,
    pov,
  });
  assert.deepEqual(embedTargetFromUrl('https://mistboard.com/game/abc-123?ply=30'), game(30, null));
  assert.deepEqual(embedTargetFromUrl('https://mistboard.com/game/abc-123#30'), game(30, null));
  assert.deepEqual(
    embedTargetFromUrl('https://mistboard.com/xiangqi/game/abc-123/black#59'),
    game(59, 'black'),
  );
  assert.deepEqual(
    embedTargetFromUrl('https://mistboard.com/game/abc-123?pov=truth&ply=7'),
    game(7, 'truth'),
  );
  // Ours wins when both spellings appear; junk falls back to the default.
  assert.deepEqual(
    embedTargetFromUrl('https://mistboard.com/game/abc-123/black?pov=white'),
    game(null, 'white'),
  );
  assert.deepEqual(
    embedTargetFromUrl('https://mistboard.com/game/abc-123?ply=-1&pov=red#last'),
    game(null, null),
  );
});

test('studies match on the chapter permalink and the embed path', () => {
  for (const url of [
    'https://mistboard.com/study/ytSzepET/Ue0EgpS7',
    'https://mistboard.com/embed/study/ytSzepET/Ue0EgpS7',
  ]) {
    assert.deepEqual(
      embedTargetFromUrl(url),
      { kind: 'study', studyId: 'ytSzepET', chapterId: 'Ue0EgpS7' },
      url,
    );
  }
  // A study without a chapter is the study page, not a board.
  assert.equal(embedTargetFromUrl('https://mistboard.com/study/ytSzepET'), null);
});

test('puzzles match by id on the permalink and by id or daily on the embed path', () => {
  assert.deepEqual(embedTargetFromUrl('https://mistboard.com/puzzles/xq_0001'), {
    kind: 'puzzle',
    puzzleId: 'xq_0001',
  });
  assert.deepEqual(embedTargetFromUrl('https://mistboard.com/embed/puzzle/xq_0001'), {
    kind: 'puzzle',
    puzzleId: 'xq_0001',
  });
  assert.deepEqual(embedTargetFromUrl('https://mistboard.com/embed/puzzle'), {
    kind: 'puzzle',
    puzzleId: null,
  });
  // The puzzles hub is a page.
  assert.equal(embedTargetFromUrl('https://mistboard.com/puzzles'), null);
});

test('tv and the analysis board match only on their embed paths', () => {
  assert.deepEqual(embedTargetFromUrl('https://mistboard.com/embed/tv'), {
    kind: 'tv',
    channel: null,
  });
  assert.deepEqual(embedTargetFromUrl('https://mistboard.com/embed/tv?channel=xiangqi'), {
    kind: 'tv',
    channel: 'xiangqi',
  });
  assert.deepEqual(embedTargetFromUrl('https://mistboard.com/embed/tv?channel=Not%20An%20Id'), {
    kind: 'tv',
    channel: null,
  });
  assert.deepEqual(embedTargetFromUrl('https://mistboard.com/embed/analysis'), {
    kind: 'analysis',
  });
  assert.deepEqual(embedTargetFromUrl('https://mistboard.com/embed/analysis/xiangqi'), {
    kind: 'analysis',
  });
  assert.equal(embedTargetFromUrl('https://mistboard.com/watch'), null);
  assert.equal(embedTargetFromUrl('https://mistboard.com/analysis'), null);
});

test('pages, malformed ids, and junk are not targets', () => {
  for (const url of [
    'https://mistboard.com/',
    'https://mistboard.com/blog/xiangqi-champions',
    'https://mistboard.com/game',
    'https://mistboard.com/game/abc/extra',
    'https://mistboard.com/game/has%20space',
    'https://mistboard.com/forum/general-discussion',
    'not a url at all',
    '',
  ]) {
    assert.equal(embedTargetFromUrl(url), null, url);
  }
});

test('the frameable path round-trips through the target', () => {
  const cases: Array<[string, string]> = [
    ['https://mistboard.com/xiangqi/game/abc-123', '/embed/game/abc-123'],
    ['https://mistboard.com/xiangqi/game/abc-123/black#59', '/embed/game/abc-123?ply=59&pov=black'],
    ['https://mistboard.com/study/ytSzepET/Ue0EgpS7', '/embed/study/ytSzepET/Ue0EgpS7'],
    ['https://mistboard.com/puzzles/xq_0001', '/embed/puzzle/xq_0001'],
    ['https://mistboard.com/embed/puzzle', '/embed/puzzle'],
    ['https://mistboard.com/embed/tv?channel=xiangqi', '/embed/tv?channel=xiangqi'],
    ['https://mistboard.com/embed/tv', '/embed/tv'],
    ['https://mistboard.com/embed/analysis', '/embed/analysis/xiangqi'],
  ];
  for (const [url, path] of cases) {
    const target = embedTargetFromUrl(url);
    assert.ok(target, url);
    assert.equal(embedPathForTarget(target), path, url);
    // The embed path is itself a target, and the same one.
    assert.deepEqual(embedTargetFromUrl(`https://mistboard.com${path}`), target, path);
  }
});
