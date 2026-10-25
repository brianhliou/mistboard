import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';

// The build ships live-review.css and review-shell.css in one chunk with
// review-shell.css LAST, and a room opened from its URL links them in that
// order (route-preload-manifest.json, 10-24 build). The phone room layout must
// win in either order, so it may not rest on equal specificity (#618).
const LIVE_REVIEW = readFileSync(resolve(__dirname, 'live-review.css'), 'utf8');
const REVIEW_SHELL = readFileSync(resolve(__dirname, 'review/review-shell.css'), 'utf8');
const LIFECYCLE = readFileSync(resolve(__dirname, 'live-lifecycle-effects.css'), 'utf8');

function clusterDisplay(width: number, height: number, sheets: string[]): string {
  const win = new Window({ width, height });
  try {
    win.document.head.innerHTML = sheets.map((css) => `<style>${css}</style>`).join('');
    const cluster = win.document.createElement('div');
    cluster.className = 'review-shell__cluster live-review__cluster';
    win.document.body.append(cluster);
    return win.getComputedStyle(cluster).display;
  } finally {
    void win.happyDOM.close();
  }
}

function stageFrameInset(width: number): string {
  const win = new Window({ width, height: 740 });
  try {
    // happy-dom computes no pseudo-elements, so the frame stands in as a real
    // child: same selectors, same cascade, `::after` read as `> .after`.
    win.document.head.innerHTML = [LIFECYCLE, LIVE_REVIEW]
      .map(
        (css) => `<style>${css.replaceAll('.board-stage::after', '.board-stage > .after')}</style>`,
      )
      .join('');
    win.document.body.innerHTML =
      '<div class="review-shell__cluster live-review__cluster"><div class="board-shell"><div class="board-stage"><i class="after"></i></div></div></div>';
    const frame = win.document.querySelector('.after');
    if (!frame) throw new Error('frame stand-in did not mount');
    return win.getComputedStyle(frame).getPropertyValue('inset');
  } finally {
    void win.happyDOM.close();
  }
}

describe('room cluster cascade (#618)', () => {
  const orders: [string, string[]][] = [
    ['build order (review shell last)', [LIVE_REVIEW, REVIEW_SHELL]],
    ['review shell first', [REVIEW_SHELL, LIVE_REVIEW]],
  ];

  it.each(orders)('a phone room is the flex column with %s', (_label, sheets) => {
    expect(clusterDisplay(390, 664, sheets)).toBe('flex');
    expect(clusterDisplay(360, 740, sheets)).toBe('flex');
  });

  it.each(orders)('a desktop room keeps the review grid with %s', (_label, sheets) => {
    expect(clusterDisplay(1280, 800, sheets)).toBe('grid');
  });

  // The lifecycle frame sat 2px outside a stage that fills a 360px screen,
  // widening the page to 364px, and mobile Chrome zoomed the room out.
  it('keeps the lifecycle frame inside a full-width phone board', () => {
    expect(stageFrameInset(360)).toBe('0');
    expect(stageFrameInset(1280)).toBe('-2px');
  });

  // Banqi's 80px pool band is the live odds layout (two 40px lines). The
  // finished tally keeps its caption and 30px discs, 91px of content, so the
  // band cut its second row off; it takes the 96px default instead.
  it('gives the finished banqi tally room for both rows, and keeps the live odds band', () => {
    expect(banqiPoolHeight(390, 664, false)).toBe('96px');
    expect(banqiPoolHeight(360, 740, false)).toBe('96px');
    expect(banqiPoolHeight(390, 664, true)).toBe('80px');
  });
});

function banqiPoolHeight(width: number, height: number, odds: boolean): string {
  const win = new Window({ width, height });
  try {
    win.document.head.innerHTML = [LIVE_REVIEW, REVIEW_SHELL]
      .map((css) => `<style>${css}</style>`)
      .join('');
    const poolClass = odds ? 'hidden-pool hidden-pool--odds' : 'hidden-pool';
    win.document.body.innerHTML = `<div class="live-route--banqi"><div class="review-shell__cluster live-review__cluster"><div class="${poolClass}"><div class="hidden-pool__row"></div></div></div></div>`;
    const pool = win.document.querySelector('.hidden-pool');
    if (!pool) throw new Error('pool did not mount');
    return win.getComputedStyle(pool).height;
  } finally {
    void win.happyDOM.close();
  }
}
