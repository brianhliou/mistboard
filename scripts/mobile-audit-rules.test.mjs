import assert from 'node:assert/strict';
import { test } from 'node:test';

import { groupTargets, judgeBoardNav, judgePage } from './lib/mobile-audit-rules.mjs';

function measured(overrides = {}) {
  return {
    vw: 390,
    vh: 844,
    layoutWidth: 390,
    scrollWidth: 390,
    docHeight: 2000,
    viewportMeta: 'width=device-width, initial-scale=1',
    offscreen: [],
    offscreenCount: 0,
    clipped: [],
    clippedCount: 0,
    textClipped: [],
    smallTargets: [],
    smallInputs: [],
    tinyTextCount: 0,
    tinyTextSamples: [],
    board: null,
    prev: null,
    next: null,
    moveList: null,
    ...overrides,
  };
}

const rect = (top, height, extra = {}) => ({
  top,
  bottom: top + height,
  left: 0,
  right: 360,
  width: 360,
  height,
  ...extra,
});

test('a clean page passes', () => {
  assert.equal(judgePage(measured()).verdict, 'pass');
});

test('sideways page scroll fails', () => {
  const r = judgePage(measured({ scrollWidth: 420 }));
  assert.equal(r.verdict, 'fail');
  assert.ok(r.findings.some((f) => f.rule === 'page-scrolls-sideways'));
});

test('missing device-width viewport meta fails', () => {
  assert.ok(
    judgePage(measured({ viewportMeta: null })).findings.some((f) => f.rule === 'viewport-meta'),
  );
});

test('tap targets: under 24px fails, 24-39px warns, grouped by element', () => {
  const targets = [
    ...Array.from({ length: 30 }, () => ({ el: 'button.move', text: 'e4', w: 160, h: 26 })),
    { el: 'button.gear', text: 'Settings', w: 16, h: 16 },
  ];
  const r = judgePage(measured({ smallTargets: targets }));
  assert.equal(r.verdict, 'fail');
  const tiny = r.findings.find((f) => f.rule === 'tap-target-tiny');
  const small = r.findings.find((f) => f.rule === 'tap-target-small');
  assert.match(tiny.detail, /button\.gear x1 16x16/);
  assert.match(small.detail, /button\.move x30 160x26/);
  assert.equal(groupTargets(targets)[0].el, 'button.gear');
});

test('board page: arrows far below the board is a split', () => {
  const m = measured({
    board: rect(105, 398),
    prev: rect(1439, 38, { width: 71 }),
    next: rect(1439, 38, { width: 71 }),
    moveList: rect(1000, 400),
  });
  const nav = judgeBoardNav(m);
  assert.equal(nav.status, 'split');
  assert.equal(nav.span, 1477 - 105);
  assert.equal(nav.movesWithBoard, false);
  const r = judgePage(m, { boardPage: true });
  assert.ok(r.findings.some((f) => f.rule === 'board-nav-split' && f.severity === 'fail'));
});

test('board page: arrows right under the board fit', () => {
  const m = measured({
    board: rect(60, 400),
    prev: rect(470, 44),
    next: rect(470, 44),
    moveList: rect(520, 200),
  });
  const nav = judgeBoardNav(m);
  assert.equal(nav.status, 'fits');
  assert.equal(nav.movesWithBoard, true);
  assert.equal(judgePage(m, { boardPage: true }).verdict, 'pass');
});

test('board page: a fixed arrow bar only needs board + bar to fit', () => {
  const m = measured({
    board: rect(60, 400),
    prev: rect(1800, 48, { fixed: 'fixed' }),
    next: rect(1800, 48),
  });
  assert.equal(judgeBoardNav(m).status, 'fits');
});

test('board page with no board fails; with no arrows warns', () => {
  assert.ok(
    judgePage(measured(), { boardPage: true }).findings.some((f) => f.rule === 'board-missing'),
  );
  const r = judgePage(measured({ board: rect(60, 400) }), { boardPage: true });
  assert.equal(r.verdict, 'warn');
  assert.ok(r.findings.some((f) => f.rule === 'board-nav-missing'));
});

test('non-board pages skip the board rule', () => {
  assert.equal(judgePage(measured()).boardNav, null);
});

test('a layout viewport wider than the screen (mobile Chrome zoom-out) fails', () => {
  const r = judgePage(measured({ vw: 360, layoutWidth: 715, scrollWidth: 715 }));
  assert.ok(r.findings.some((f) => f.rule === 'page-zoomed-out'));
  assert.ok(!r.findings.some((f) => f.rule === 'page-scrolls-sideways'));
});
