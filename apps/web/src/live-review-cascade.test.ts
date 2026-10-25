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

// The finished room's result and actions, as a phone renders them (10-24
// phone review): the result sat taller than the 44px moves strip, so it
// touched the strip's top edge and pushed the current-move pill off centre;
// a spectator's lone Review game sat in the left half of a two-line band and
// the board gave up the empty line.
function finishedRoom(width: number, height: number, actions: string): Window {
  const win = new Window({ width, height });
  win.document.head.innerHTML = [LIVE_REVIEW, REVIEW_SHELL]
    .map((css) => `<style>${css}</style>`)
    .join('');
  win.document.body.innerHTML = `<div class="review-shell__cluster live-review__cluster"><div class="game-table-moves"><div class="move-list"></div><div class="game-result"><strong class="game-result__score">0-1</strong><span class="game-result__summary">Timeout</span></div></div><div class="round-table__row"><div class="room-actions"><div class="postgame-actions">${actions}</div></div></div></div>`;
  return win;
}

function need<T>(el: T | null | undefined, what: string): T {
  if (!el) throw new Error(`${what} did not mount`);
  return el;
}

function px(value: string): number {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) throw new Error(`not a length: ${value}`);
  return n;
}

const REVIEW = '<a href="/review/x">Review game</a>';

describe('finished phone room (10-24 review)', () => {
  it.each([
    [390, 664],
    [360, 740],
  ])('keeps the result inside the moves strip with room above and below at %ix%i', (w, h) => {
    const win = finishedRoom(w, h, REVIEW);
    try {
      const doc = win.document;
      const result = need(doc.querySelector('.game-result'), '.game-result');
      const score = need(doc.querySelector('.game-result__score'), '.game-result__score');
      const summary = need(doc.querySelector('.game-result__summary'), '.game-result__summary');
      const strip = need(doc.querySelector('.game-table-moves'), '.game-table-moves');
      const rs = win.getComputedStyle(result);
      const top = px(rs.paddingTop);
      const bottom = px(rs.paddingBottom);
      expect(top).toBeGreaterThanOrEqual(4);
      expect(bottom).toBe(top);
      expect(rs.alignSelf).toBe('center');
      const lh = px(rs.lineHeight) || Number(rs.lineHeight);
      expect(lh).toBeLessThanOrEqual(1.2);
      const scorePx = px(win.getComputedStyle(score).fontSize);
      const summaryPx = px(win.getComputedStyle(summary).fontSize);
      expect(scorePx).toBeLessThan(18);
      expect(summaryPx).toBeGreaterThanOrEqual(11);
      // Content plus padding stays under the strip's band, so the flex line
      // is the strip's own height and the move pill centres in it.
      const band = px(win.getComputedStyle(strip).height);
      const content = (scorePx + summaryPx) * lh + px(rs.rowGap || rs.gap) + top + bottom;
      expect(content).toBeLessThanOrEqual(band - 4);
    } finally {
      void win.happyDOM.close();
    }
  });

  // Not here: the band height (--phone-room-post, 48px for one line, 96px for
  // two). happy-dom matches `:has(A > B)` whenever A exists, so it cannot
  // tell one action from four; that rule was checked in Chromium on a built
  // room with one, two, three and four actions instead (10-24).
  it('spans a lone action across the line instead of leaving it in the left half', () => {
    const span = (actions: string, index: number) => {
      const win = finishedRoom(390, 664, actions);
      try {
        const items = win.document.querySelectorAll('.postgame-actions > *');
        return win.getComputedStyle(need(items[index], 'action')).gridColumn;
      } finally {
        void win.happyDOM.close();
      }
    };
    expect(span(REVIEW, 0)).toBe('1 / -1');
    expect(span(`<button>Rematch</button><a>New</a>${REVIEW}`, 2)).toBe('1 / -1');
    expect(span(`<div class="room-rematch"></div>${REVIEW}`, 1)).toBe('1 / -1');
    expect(span(`<button>Rematch</button>${REVIEW}`, 1)).not.toBe('1 / -1');
    expect(span(`<button>Rematch</button>${REVIEW}`, 0)).not.toBe('1 / -1');
  });
});
