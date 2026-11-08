import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { serverBodyProblems } from './server-body-check.mjs';

const css = '.crawler-copy { animation: crawler-copy-reveal 0s 4s both; }';
const page = (body) => `<div id="app">${body}</div>`;
test('first-paint CSS passes in source and Vite-minified animation order', () => {
  const source = readFileSync(new URL('../apps/web/src/app-base.css', import.meta.url), 'utf8');
  // Captured from Vite's built index stylesheet: the animation name moves last.
  const minified = '.crawler-copy{animation:0s 4s both crawler-copy-reveal}';
  for (const stylesheet of [source, css, minified]) {
    assert.deepEqual(
      serverBodyProblems(page('<div class="crawler-copy">Board</div>'), stylesheet),
      [],
    );
  }
});

test('both animation orders still reject incorrect first-paint protection', () => {
  for (const animation of ['crawler-copy-reveal 0s 4s both', '0s 4s both crawler-copy-reveal']) {
    for (const planted of [
      animation.replace('0s', '1s'),
      animation.replace('4s', '0s'),
      animation.replace('both', 'forwards'),
      animation.replace('crawler-copy-reveal', 'unrelated-reveal'),
      animation.replace('crawler-copy-reveal', 'crawler-copy-reveal-extra'),
    ]) {
      assert.deepEqual(
        serverBodyProblems(
          page('<div class="crawler-copy">Board</div>'),
          `.crawler-copy{animation:${planted}}`,
        ),
        ['crawler-copy first-paint stylesheet is not linked'],
        planted,
      );
    }
  }
});

test('every byte of server copy belongs inside the wrapper, even with stray classes or siblings', () => {
  assert.deepEqual(
    serverBodyProblems(page('<div class="crawler-copy"><h1>Board</h1></div>'), css),
    [],
  );
  for (const planted of [
    '<h1>Board</h1>',
    '<main class="looks-styled"><h1>Board</h1></main>',
    '<div class="crawler-copy"><h1>Board</h1></div><p>Leaked copy</p>',
    'Leaked copy<div class="crawler-copy"><h1>Board</h1></div>',
  ]) {
    assert.deepEqual(serverBodyProblems(page(planted), css), [
      'server body text outside .crawler-copy',
    ]);
  }
});
test('a wrapper without its linked first-paint CSS fails, and an empty shell passes', () => {
  assert.deepEqual(serverBodyProblems(page('<div class="crawler-copy">Board</div>'), ''), [
    'crawler-copy first-paint stylesheet is not linked',
  ]);
  assert.deepEqual(serverBodyProblems(page(''), ''), []);
});
