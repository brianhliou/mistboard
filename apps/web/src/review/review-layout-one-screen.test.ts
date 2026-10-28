import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JIEQI_GEO } from '../live-jieqi-render.js';
import { LIVE_BOARD_GEO } from '../xiangqi-board.js';
import { xiangqiBoardAspect } from '../xiangqi-board-aspect.js';
import { oneScreenBoardWidth } from './review-layout.js';

// #619: on a phone the game review's board shrinks so the board, the arrow bar
// and the move strip share one screen. happy-dom has no layout, so the boxes are
// stubbed with what a 320x568 jieqi review measured before the fit.

function box(top: number, bottom: number): DOMRect {
  return {
    top,
    bottom,
    height: bottom - top,
    left: 0,
    right: 0,
    width: 0,
    x: 0,
    y: top,
  } as DOMRect;
}

function phoneReview(): HTMLElement {
  const shell = document.createElement('main');
  shell.className = 'review-shell';
  shell.style.paddingBottom = '24px';
  const stage = document.createElement('div');
  stage.className = 'review-stage';
  const rail = document.createElement('div');
  rail.className = 'review-rail-main';
  const moves = document.createElement('section');
  moves.className = 'review-move-list';
  rail.append(moves);
  shell.append(stage, rail);
  document.body.append(shell);
  // Board 300x333 at 90; seat row, bar, gaps and the strip end at 563.
  stage.getBoundingClientRect = () => box(90, 451);
  moves.getBoundingClientRect = () => box(517, 563);
  return stage;
}

function stubPhone(matches: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({ matches, media: query }) as unknown as MediaQueryList),
  );
}

describe('oneScreenBoardWidth', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('caps the board so the stack ends inside a 568px phone screen', () => {
    stubPhone(true);
    vi.stubGlobal('innerHeight', 568);
    const stage = phoneReview();
    // 568 - 90 (board top) - 24 (shell padding) - 140 (under the board) - 2 = 312 tall.
    const width = oneScreenBoardWidth(stage, 333, 0.9);
    expect(width).toBe(280);
    // The board that width gives keeps the strip's bottom inside the screen.
    expect(90 + width / 0.9 + 140 + 24).toBeLessThanOrEqual(568);
  });

  it('leaves the board alone above the phone breakpoint', () => {
    stubPhone(false);
    vi.stubGlobal('innerHeight', 568);
    expect(oneScreenBoardWidth(phoneReview(), 333, 0.9)).toBe(Number.POSITIVE_INFINITY);
  });
});

// #619 round 3 (Brian, 2026-10-28: "I don't really love that the board has been
// shrunk so much"): the xiangqi and jieqi board is at least 340px wide on a
// 390x664 phone in the chart state, engine off or on. The chrome heights come
// from the phone stylesheets themselves, so loosening any of them fails here;
// the rest are the seat rows and borders the browser measured (52px site nav,
// 28px top seat room, 28px bottom seat room, the arrow bar's two 1px borders
// and the move strip's top one; the function measures to the list's foot).
describe('phone game review board size', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  const read = (name: string) =>
    readFileSync(resolve(__dirname, name), 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ');
  const sheetCss = read('review-info-sheet.css');
  const stripCss = read('review-phone-analysis.css');
  const phoneOnly = (css: string) => css.slice(css.indexOf('@media (max-width: 600px)'));

  /** The first px number of `prop` in the rule whose selector ends with `selectorEnd`. */
  function px(css: string, selectorEnd: string, prop: string): number {
    const at = css.indexOf(`${selectorEnd} {`);
    expect(at, selectorEnd).toBeGreaterThanOrEqual(0);
    const body = css.slice(at + selectorEnd.length + 2, css.indexOf('}', at));
    const match = new RegExp(`(?:^|;|\\s)${prop}: [^;]*?(-?\\d+(?:\\.\\d+)?)px`).exec(body);
    expect(match, `${selectorEnd} ${prop}`).not.toBeNull();
    return Number(match?.[1]);
  }

  function chrome() {
    const sheet = phoneOnly(sheetCss);
    const strip = phoneOnly(stripCss);
    return {
      shellTop: px(sheet, '.has-review-info-sheet .review-shell', 'padding-top'),
      shellBottom: px(sheet, '.has-review-info-sheet .review-shell', 'padding-bottom'),
      gap: px(sheet, '.review-shell__cluster.review-shell__cluster--col1-stack', 'row-gap'),
      chart:
        px(strip, '.review-phone-analysis .advantage-chart__svg', 'height') +
        2 * px(strip, '.review-phone-analysis', 'padding'),
      bar: px(sheet, '.move-nav-bar.review-controls > .move-nav-bar__button', 'height') + 2,
      strip: px(sheet, '.review-move-list .review-move-list__rows', 'height') + 1,
      engineBar: px(sheet, '.review-shell__cluster .analysis-engine-bar', 'height'),
      engineRoom:
        px(sheet, ':has(.review-board-wrap--captures) .analysis-engine-bar', 'margin') + 24,
    };
  }

  function boardWidth(
    viewportHeight: number,
    engineOn: boolean,
    aspect = xiangqiBoardAspect(LIVE_BOARD_GEO),
  ): number {
    const c = chrome();
    const engine = engineOn ? c.engineBar + c.engineRoom + c.gap : 0;
    const boardTop = 52 + c.shellTop + 28 + engine;
    // Seat room, gap, chart strip, gap, arrow bar, gap, move strip.
    const under = 28 + c.gap + c.chart + c.gap + c.bar + c.gap + c.strip;
    stubPhone(true);
    vi.stubGlobal('innerHeight', viewportHeight);
    const stage = phoneReview();
    stage.closest<HTMLElement>('.review-shell')!.style.paddingBottom = `${c.shellBottom}px`;
    const boardHeight = 300;
    stage.getBoundingClientRect = () => box(boardTop, boardTop + boardHeight);
    stage.parentElement!.querySelector<HTMLElement>('.review-move-list')!.getBoundingClientRect =
      () => box(boardTop, boardTop + boardHeight + under);
    return oneScreenBoardWidth(stage, boardHeight, aspect);
  }

  it('gives the xiangqi and jieqi boards at least 340px on a 390x664 phone, engine off and on', () => {
    const jieqi = xiangqiBoardAspect(JIEQI_GEO);
    expect(boardWidth(664, false)).toBeGreaterThanOrEqual(340);
    expect(boardWidth(664, true)).toBeGreaterThanOrEqual(340);
    expect(boardWidth(664, false, jieqi)).toBeGreaterThanOrEqual(340);
    expect(boardWidth(664, true, jieqi)).toBeGreaterThanOrEqual(340);
  });

  it('keeps the arrows at a 40px tap floor while packing the chrome', () => {
    const c = chrome();
    expect(c.gap).toBeLessThanOrEqual(4);
    expect(c.chart).toBeLessThanOrEqual(40);
    // Tap floor for the arrows.
    expect(c.bar - 2).toBeGreaterThanOrEqual(40);
    expect(c.gap * 3 + c.chart + c.bar + c.strip + c.shellBottom).toBeLessThanOrEqual(143);
  });
});
