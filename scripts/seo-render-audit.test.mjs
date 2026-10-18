import assert from 'node:assert/strict';
import test from 'node:test';
import { serverHtmlFacts, serverHtmlFailures } from './seo-render-audit.mjs';

// The shell prod served for every broadcast URL until 2026-10-17: a title, no
// canonical, nothing in #app. The audit passed it, because the client drew a
// page after the fact; this is the planted failure the check must catch.
const EMPTY_SHELL =
  '<html lang="en"><head><title>Mistboard</title><meta name="robots" content="max-image-preview:large" /></head><body><div id="app"></div></body></html>';

const SERVED =
  '<html lang="en"><head><title>Round 2 | Mistboard</title><link rel="canonical" href="https://mistboard.com/broadcast/xiangqi/t/round/t-r02"></head><body><div id="app"><main><h1>Round 2 · <span lang="zh">五羊杯</span></h1><a href="/broadcast/xiangqi/board/b1">1-0</a></main></div></body></html>';

test('an empty shell on a broadcast, player or study URL fails', () => {
  const facts = serverHtmlFacts(EMPTY_SHELL);
  assert.equal(facts.canonical, null);
  assert.equal(facts.h1, null);
  assert.equal(facts.prerendered, false);
  for (const path of [
    '/broadcast/xiangqi',
    '/broadcast/xiangqi/t/round/t-r02',
    '/broadcast/xiangqi/board/b1',
    '/players/wang-tianyi',
    '/study/S1',
    '/zh-hans/study/S1',
  ]) {
    assert.deepEqual(
      serverHtmlFailures(path, facts),
      ['empty shell: no server-rendered body and no canonical'],
      path,
    );
  }
});

test('a server-rendered page records its canonical and h1 and passes', () => {
  const facts = serverHtmlFacts(SERVED);
  assert.equal(facts.canonical, 'https://mistboard.com/broadcast/xiangqi/t/round/t-r02');
  assert.equal(facts.h1, 'Round 2 · 五羊杯');
  assert.equal(facts.prerendered, true);
  assert.deepEqual(serverHtmlFailures('/broadcast/xiangqi/t/round/t-r02', facts), []);
});

test('a canonical alone, a noindexed unknown id, or another section passes', () => {
  const canonicalOnly = serverHtmlFacts(
    EMPTY_SHELL.replace(
      '</head>',
      '<link rel="canonical" href="https://mistboard.com/study/S1"></head>',
    ),
  );
  assert.deepEqual(serverHtmlFailures('/study/S1', canonicalOnly), []);
  const noindexed = serverHtmlFacts(
    EMPTY_SHELL.replace('max-image-preview:large', 'noindex, follow'),
  );
  assert.deepEqual(serverHtmlFailures('/broadcast/xiangqi/board/nope', noindexed), []);
  // Known blind spot: client-only pages outside these sections are not held to
  // the rule (the rendered-DOM checks cover them).
  assert.deepEqual(serverHtmlFailures('/watch', serverHtmlFacts(EMPTY_SHELL)), []);
});
