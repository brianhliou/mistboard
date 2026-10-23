import assert from 'node:assert/strict';
import { test } from 'node:test';

import { markUnchanged, renderSheet } from './lib/mobile-audit-sheet.mjs';

const base = 'https://mistboard.com';

function row(overrides = {}) {
  return {
    page: 'home',
    device: 'iphone',
    url: '/',
    verdict: 'warn',
    findings: [{ severity: 'warn', rule: 'tiny-text', detail: '2 runs' }],
    shotFile: 'iphone-home.jpg',
    shotHeight: 1992,
    viewportWidth: 390,
    viewportHeight: 664,
    ...overrides,
  };
}

test('one card per page on the chosen device, in run order', () => {
  const html = renderSheet({
    base,
    startedAt: 's',
    device: 'iphone',
    results: [row(), row({ page: 'forum' }), row({ page: 'home', device: 'android' })],
  });
  assert.equal(html.match(/<article/g).length, 2);
  assert.ok(html.indexOf('<h2>home</h2>') < html.indexOf('<h2>forum</h2>'));
});

test('the fold mark sits at the viewport height as a share of the shot', () => {
  const html = renderSheet({ base, startedAt: 's', results: [row()] });
  assert.match(html, /class="fold" style="top: 33\.333%"/);
});

test('no fold mark when the page is shorter than one screen', () => {
  const html = renderSheet({ base, startedAt: 's', results: [row({ shotHeight: 600 })] });
  assert.doesNotMatch(html, /class="fold"/);
});

test('fails list before warns, and a skipped page still gets a card', () => {
  const html = renderSheet({
    base,
    startedAt: 's',
    results: [
      row({
        findings: [
          { severity: 'warn', rule: 'w', detail: '' },
          { severity: 'fail', rule: 'f', detail: '' },
        ],
      }),
      { page: 'review', device: 'iphone', skipped: 'no URL resolved' },
    ],
  });
  assert.ok(html.indexOf('<b>f</b>') < html.indexOf('<b>w</b>'));
  assert.match(html, /no URL resolved/);
});

test('reviewer notes and page text are escaped', () => {
  const html = renderSheet({
    base,
    startedAt: 's',
    results: [row({ findings: [{ severity: 'warn', rule: 'x', detail: '<img onerror=1>' }] })],
    notes: { home: 'Play <b>first</b>' },
  });
  assert.match(html, /Play &lt;b&gt;first&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<img onerror/);
});

test('a compared sheet pairs each screen with its baseline, changed first', () => {
  const after = markUnchanged(
    [row({ layout: 'a' }), row({ page: 'forum', shotFile: 'iphone-forum.jpg', layout: 'b2' })],
    [
      row({ layout: 'a', shotFile: 'before-iphone-home.jpg' }),
      row({ page: 'forum', layout: 'b1', shotFile: 'before-iphone-forum.jpg' }),
    ],
  );
  const html = renderSheet({
    base: 'http://127.0.0.1:3360',
    startedAt: 's',
    results: after,
    beforeBase: base,
    beforeResults: [
      row({ shotFile: 'before-iphone-home.jpg' }),
      row({ page: 'forum', shotFile: 'before-iphone-forum.jpg' }),
    ],
  });
  assert.match(html, /<title>Before and after<\/title>/);
  assert.ok(html.indexOf('<h2>forum') < html.indexOf('<h2>home'), 'changed screen leads');
  assert.match(html, /shots\/before-iphone-forum\.jpg[\s\S]*shots\/iphone-forum\.jpg/);
  assert.match(html, /<h2>home <span class="badge same">unchanged/);
  assert.match(html, /<h2>forum <span class="badge diff">changed/);
});

// Planted failure: a screen whose fingerprint is missing on either side must
// show as changed. If this passes as unchanged, a crashed fingerprint would
// hide every screen from review.
test('a missing fingerprint never counts as unchanged', () => {
  const [both, oneSide] = markUnchanged(
    [row({ layout: null }), row({ page: 'forum', layout: 'x' })],
    [row({ layout: null }), row({ page: 'forum', layout: undefined })],
  );
  assert.equal(both.unchanged, false);
  assert.equal(oneSide.unchanged, false);
});

test('a page missing from the baseline run still gets an after shot', () => {
  const html = renderSheet({
    base,
    startedAt: 's',
    results: [row()],
    beforeBase: base,
    beforeResults: [],
  });
  assert.match(html, /not in the baseline run/);
  assert.match(html, /shots\/iphone-home\.jpg/);
});

test('a desktop shot carries no phone verdict line', () => {
  const html = renderSheet({
    base,
    startedAt: 's',
    results: [row({ device: 'desktop', verdict: 'shot', findings: [], viewportWidth: 1280 })],
  });
  assert.match(html, /<title>Desktop screens<\/title>/);
  assert.doesNotMatch(html, /No rule findings/);
});
