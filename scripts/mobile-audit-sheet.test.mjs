import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderSheet } from './lib/mobile-audit-sheet.mjs';

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
