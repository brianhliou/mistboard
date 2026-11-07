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
});

// A correspondence room's "7 days per move" line took a line the phone
// board's budget never gave up, so a finished Fog Chess room (and a seated
// live one) scrolled by 27px at 390x664 and 360x740 (10-24 phone review).
const GAME_SHELL = readFileSync(resolve(__dirname, 'game-shell.css'), 'utf8');

function daysPerMoveNoteDisplay(width: number, height: number): string {
  const win = new Window({ width, height });
  try {
    win.document.head.innerHTML = [GAME_SHELL, LIVE_REVIEW, REVIEW_SHELL]
      .map((css) => `<style>${css}</style>`)
      .join('');
    win.document.body.innerHTML =
      '<div class="review-shell__cluster live-review__cluster"><section class="panel-section game-console"><p data-clocks-note class="clocks-pregame-note">7 days per move</p></section></div>';
    return win.getComputedStyle(need(win.document.querySelector('.clocks-pregame-note'), 'note'))
      .display;
  } finally {
    void win.happyDOM.close();
  }
}

describe('correspondence days-per-move line (#618)', () => {
  it.each([
    [390, 664],
    [360, 740],
  ])('leaves the phone room at %ix%i', (w, h) => {
    expect(daysPerMoveNoteDisplay(w, h)).toBe('none');
  });

  it('stays under the clocks on desktop', () => {
    expect(daysPerMoveNoteDisplay(1280, 800)).toBe('block');
  });
});

// A live spectator's notice ("Watching" and why) took 59-77px the phone
// board's budget never gave up, so every live spectator room scrolled by
// 67-85px (10-24 phone review). A plain notice is now a fixed band; one that
// ends in a button (reconnect, sign in) keeps its own height.
function noticeBand(width: number, extra: string): { section: string; clamp: string } {
  const win = new Window({ width, height: 664 });
  try {
    win.document.head.innerHTML = [GAME_SHELL, LIVE_REVIEW, REVIEW_SHELL]
      .map((css) => `<style>${css}</style>`)
      .join('');
    win.document.body.innerHTML = `<div class="review-shell__cluster live-review__cluster"><div class="round-table__box"><div data-action-section class="round-table__row"><div data-action-status class="action-status"><div class="action-notice default"><strong>Watching</strong><span>Spectators receive a public Fog view while the game is live.</span>${extra}</div></div></div></div></div>`;
    const section = need(win.document.querySelector('[data-action-section]'), 'section');
    const body = need(win.document.querySelector('.action-notice > span'), 'body');
    // happy-dom leaves calc() unresolved; a browser reads 52px.
    const h = win
      .getComputedStyle(section)
      .height.replace(/^calc\((\d+)px - (\d+)px\)$/, (_m, a, b) => `${Number(a) - Number(b)}px`);
    return {
      section: h,
      clamp: win.getComputedStyle(body).getPropertyValue('-webkit-line-clamp'),
    };
  } finally {
    void win.happyDOM.close();
  }
}

describe('live spectator notice on a phone (#618)', () => {
  it('is a fixed band with the body held to two lines', () => {
    expect(noticeBand(390, '')).toEqual({ section: '52px', clamp: '2' });
    expect(noticeBand(360, '')).toEqual({ section: '52px', clamp: '2' });
  });

  // Not here: a notice ending in a button keeping its own height. happy-dom
  // matches `> span:last-child` inside :has() with a button after the span,
  // so that half was checked in WebKit and Chromium on a live spectator room
  // with a Reconnect button appended (52px band, then 85px and no budget).
  it('leaves the desktop notice alone', () => {
    expect(noticeBand(1280, '').section).not.toBe('52px');
  });
});

// A finished room whose one action is Review game (a spectator, a signed-out
// viewer) puts it in the bottom bar, where Resign/Abort sat beside the move
// arrows during play, and drops the 48px band so the board grows (#618,
// Brian 2026-10-24). Seated actions now use the game-over sheet.
function soloReview(width: number, solo: boolean) {
  const win = new Window({ width, height: 664 });
  win.document.head.innerHTML = [GAME_SHELL, LIVE_REVIEW, REVIEW_SHELL]
    .map((css) => `<style>${css}</style>`)
    .join('');
  const actions = solo
    ? '<a class="postgame-actions__link" href="/game/x">Review game</a>'
    : '<a class="postgame-actions__link" href="/">New opponent</a><a class="postgame-actions__link" href="/game/x">Review game</a>';
  const cls = solo ? 'postgame-actions postgame-actions--solo' : 'postgame-actions';
  win.document.body.innerHTML = `<div class="review-shell__cluster live-review__cluster"><section class="panel-section game-console"><div class="round-table__box"><div class="round-table__row"><div data-room-actions class="room-actions"><div class="${cls}">${actions}</div></div></div><div class="replay-console"><div class="move-nav-bar"></div></div></div></section></div>`;
  const doc = win.document;
  const style = (sel: string) => win.getComputedStyle(need(doc.querySelector(sel), sel));
  const review = need(doc.querySelectorAll('.postgame-actions > a'), 'links');
  const link = win.getComputedStyle(need(review[review.length - 1], 'review link'));
  const read = {
    post: style('.live-review__cluster').getPropertyValue('--phone-room-post').trim(),
    row: style('.round-table__row').display,
    roomActions: style('.room-actions').display,
    box: style('.postgame-actions').display,
    order: link.order,
    minHeight: link.minHeight,
    radius: link.borderTopLeftRadius,
    transform: link.textTransform,
    nav: style('.move-nav-bar').order,
  };
  void win.happyDOM.close();
  return read;
}

describe('lone Review game in the phone bar (#618)', () => {
  it.each([390, 360])('sits beside the move arrows with no band at %ipx', (w) => {
    const r = soloReview(w, true);
    expect(r.post).toBe('0px');
    expect([r.row, r.roomActions, r.box]).toEqual(['contents', 'contents', 'contents']);
    // Order 46: the Resign/Abort slot, just before the arrows (47).
    expect(r.order).toBe('46');
    expect(r.nav).toBe('47');
    // The bar's height, a 44px+ tap target.
    expect(r.minHeight).toBe('48px');
    expect(r.radius).toBe('0px');
    expect(r.transform).toBe('none');
  });

  it('leaves the desktop room alone', () => {
    const r = soloReview(1280, true);
    expect(r.box).toBe('grid');
    expect(r.order).not.toBe('46');
  });
});

describe('game-over sheet layout (#671)', () => {
  it.each([360, 390])(
    'keeps the board budget and puts the result above full-width actions at %ipx',
    (width) => {
      const win = new Window({ width, height: 664 });
      try {
        win.document.head.innerHTML = [GAME_SHELL, LIVE_REVIEW, REVIEW_SHELL]
          .map((css) => `<style>${css}</style>`)
          .join('');
        win.document.body.innerHTML = `<div class="review-shell__cluster live-review__cluster"><section class="game-console"><div class="round-table__box"><div class="round-table__row"><div class="room-actions"></div></div></div></section></div>`;
        const doc = win.document;
        const style = (selector: string) =>
          win.getComputedStyle(need(doc.querySelector(selector), selector));
        const playingBudget =
          style('.live-review__cluster').getPropertyValue('--uni-board-h-budget');
        const host = need(doc.querySelector('.room-actions'), 'actions host');
        host.setAttribute('data-postgame-sheet', '');
        host.innerHTML = `<button class="postgame-sheet-toggle">Game over</button><dialog class="postgame-sheet" open><div class="game-result postgame-sheet__result">1-0 White wins</div><div class="postgame-actions"><button>Rematch</button><a>New game</a><a>Review game</a><a>Challenge a friend</a></div></dialog>`;
        expect(style('.live-review__cluster').getPropertyValue('--uni-board-h-budget')).toBe(
          playingBudget,
        );
        expect(style('.postgame-sheet').position).toBe('fixed');
        expect(style('.room-actions').display).toBe('contents');
        expect(style('.round-table__row').display).toBe('contents');
        expect(style('.postgame-sheet-toggle').order).toBe('46');
        expect(style('.postgame-sheet-toggle').minHeight).toBe('48px');
        expect(style('.postgame-actions').gridTemplateColumns).toBe('minmax(0, 1fr)');
        expect(style('.postgame-actions button').minHeight).toBe('48px');
        expect(style('.postgame-actions a').width).toBe('100%');
        doc.querySelector('dialog')?.removeAttribute('open');
        expect(style('.live-review__cluster').getPropertyValue('--uni-board-h-budget')).toBe(
          playingBudget,
        );
      } finally {
        void win.happyDOM.close();
      }
    },
  );
});
