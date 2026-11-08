import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boardPageSamples, paintsBareCopy, routeShape } from './served-first-paint.mjs';

const page = (app) =>
  `<html><head></head><body>${app}<script type="module" src="/assets/index.js"></script></body></html>`;

test('flags the classless crawler copy /players painted before 2026-10-17', () => {
  // Planted failure: the shape prod served, text with no class and no wrapper.
  assert.equal(
    paintsBareCopy(
      page(
        '<div id="app"><main><h1>Xiangqi players</h1><ol><li>Meng Fanrui</li></ol></main></div>',
      ),
    ),
    true,
  );
});

test('passes the same copy inside the crawler-copy wrapper, baked markup, and the empty shell', () => {
  assert.equal(
    paintsBareCopy(
      page(
        '<div id="app"><div class="crawler-copy"><main><h1>Xiangqi players</h1></main></div></div>',
      ),
    ),
    false,
  );
  assert.equal(
    paintsBareCopy(
      page(
        '<div id="app" class="landing-page"><main class="article-page"><h1>Rules</h1></main></div>',
      ),
    ),
    false,
  );
  assert.equal(paintsBareCopy(page('<div id="app"></div>')), false);
});

// Known blind spot: a copy with a single stray class passes, as does a page
// whose classes exist but whose stylesheet the client brings late; the second
// is the stylesheet half of the same script (unlinkedMatchingRules).
test('groups paths by route shape, keeping the locale prefix', () => {
  assert.equal(routeShape('/players/zuo-wenjing'), '/players/*');
  assert.equal(routeShape('/zh-hans/study/abc'), '/zh-hans/study/*');
  assert.equal(routeShape('/players'), '/players');
  assert.equal(routeShape('/'), '/');
});

test('first-paint samples cover the unsitemapped board templates and reject a missing public sample', () => {
  const samples = {
    games: [{ kind: 'historical', id: 'hxq_public' }],
    puzzles: [{ id: 'puzzle' }],
    players: [{ handle: 'public-player' }],
  };
  assert.deepEqual(boardPageSamples(samples), [
    '/historical-xiangqi/game/hxq_public',
    '/puzzles/puzzle',
    '/@/public-player',
  ]);
  for (const key of ['games', 'puzzles', 'players'])
    assert.throws(() => boardPageSamples({ ...samples, [key]: [] }), /needs a public/);
  assert.throws(
    () => boardPageSamples({ ...samples, games: [{ kind: 'mistboard', id: 'live' }] }),
    /needs a public/,
  );
});
