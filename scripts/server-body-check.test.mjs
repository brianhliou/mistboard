import assert from 'node:assert/strict';
import test from 'node:test';
import { serverBodyProblems } from './server-body-check.mjs';

const css = '.crawler-copy { animation: crawler-copy-reveal 0s 4s both; }';
const page = (body) => `<div id="app">${body}</div>`;
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
