// Selection marks on 3D pieces (board-select-3d.ts) on the xiangqi and jieqi
// boards: no rings on a 3D piece, the selected piece's side (or face) in green,
// capture targets' faces tinted, a hovered target's side green; flat pieces keep
// their rings.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  applyMove as applyXiangqiMove,
  createInitialJieqiState,
  createInitialXiangqiState,
  getJieqiPlayerView,
  getStandardXiangqiPlayerView,
} from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installJieqiBoardStyles, renderJieqiBoardSvg } from './live-jieqi-render.js';
import { xiangqiBoardSvg } from './xiangqi-board.js';

beforeEach(() => {
  document.documentElement.dataset.banqiTile3d = 'off';
});
afterEach(() => {
  delete document.documentElement.dataset.banqiTile3d;
});

/** The markup of one top-level layer group, found by its class. */
function group(svg: string, cls: string): string {
  const doc = new DOMParser().parseFromString(svg.trim(), 'image/svg+xml');
  const el = doc.querySelector(`.${cls}`);
  return el ? el.outerHTML : '';
}

/** The class lists of the top-level layers, in paint order. */
function layerOrder(svg: string): string[] {
  const doc = new DOMParser().parseFromString(svg.trim(), 'image/svg+xml');
  return [...(doc.documentElement.children as unknown as Element[])].map(
    (el) => el.getAttribute('class') ?? '',
  );
}

function hit(svg: string, square: string): string {
  const doc = new DOMParser().parseFromString(svg.trim(), 'image/svg+xml');
  return doc.querySelector(`[data-square="${square}"]`)?.outerHTML ?? '';
}

describe('flat capture ring colours', () => {
  it.each(['light', 'dark'])('uses the move-hint token in the %s site theme', (theme) => {
    const style = document.createElement('style');
    style.textContent = readFileSync(resolve(__dirname, 'live-xiangqi.css'), 'utf-8');
    document.head.append(style);
    installJieqiBoardStyles();
    const root = document.documentElement;
    const oldTheme = root.dataset.effectiveTheme;
    const oldHint = root.style.getPropertyValue('--board-move-hint');
    root.dataset.effectiveTheme = theme;
    // Override the shared token: capture rings and quiet dots must follow it.
    root.style.setProperty('--board-move-hint', 'rgb(31, 111, 91)');
    const host = document.createElement('div');
    host.innerHTML =
      '<svg><circle class="jieqi-hint-capture"/><circle class="xq-live-hint-capture"/></svg>';
    document.body.append(host);
    try {
      for (const ring of host.querySelectorAll('circle')) {
        const computed = getComputedStyle(ring);
        expect(computed.getPropertyValue('stroke')).toBe('rgb(31, 111, 91)');
        expect(computed.getPropertyValue('stroke-width')).toBe('4');
        expect(computed.getPropertyValue('fill')).toBe('none');
      }
    } finally {
      host.remove();
      style.remove();
      if (oldTheme === undefined) delete root.dataset.effectiveTheme;
      else root.dataset.effectiveTheme = oldTheme;
      if (oldHint) root.style.setProperty('--board-move-hint', oldHint);
      else root.style.removeProperty('--board-move-hint');
    }
  });
});

describe('xiangqi board selection on 3D pieces', () => {
  // Red cannon b3 captures the black horse on b10 over the cannon on b8.
  const view = getStandardXiangqiPlayerView(createInitialXiangqiState('sel3d'), 'red');
  const render = (tile3d: boolean, extra: Partial<Parameters<typeof xiangqiBoardSvg>[2]> = {}) =>
    xiangqiBoardSvg(view, 'red', {
      interactive: true,
      selectedSquare: 'b3',
      draggingFrom: null,
      layout: 'intersection',
      pieceSet: 'traditional',
      tile3d,
      ...extra,
    });

  it('keeps the flat rings on 2D pieces and draws no 3D marks', () => {
    const svg = render(false);
    expect(svg).toContain('xq-live-selection-cell');
    expect(group(svg, 'xq-live-hints')).toContain('xq-live-hint-capture');
    expect(hit(svg, 'b10')).not.toContain('xq-live-hint-capture');
    expect(hit(svg, 'b10')).toContain('xq-live-target-hover');
    expect(svg).not.toContain('board-select3d');
  });

  it('marks the selected 3D piece by its side, with no ring', () => {
    const svg = render(true);
    expect(svg).not.toContain('xq-live-selection-cell');
    const marks = group(svg, 'board-select3d');
    expect(marks.match(/class="board-select3d-edge"/g)).toHaveLength(1);
  });

  it('tints every 3D capture target face and drops its ring', () => {
    const svg = render(true);
    const captures = view.legalMoves.filter((m) => m.from === 'b3' && view.board[m.to]);
    expect(captures.map((m) => m.to)).toContain('b10');
    const marks = group(svg, 'board-select3d');
    expect(marks.match(/class="board-select3d-face"/g)).toHaveLength(captures.length);
    expect(hit(svg, 'b10')).not.toContain('xq-live-hint-capture');
    expect(hit(svg, 'b10')).not.toContain('xq-live-target-hover');
    // Quiet moves keep their dot and hover wash.
    expect(hit(svg, 'b4')).toContain('xq-live-hint-dot');
    expect(hit(svg, 'b4')).toContain('xq-live-target-hover');
  });

  it('gives a 3D capture target a green side for hover, inside its hit group', () => {
    const svg = render(true);
    expect(hit(svg, 'b10')).toContain('board-select3d-edge board-select3d-edge--hover');
    expect(hit(svg, 'b4')).not.toContain('board-select3d-edge');
    const css = readFileSync(resolve(__dirname, 'board-select-3d.css'), 'utf-8');
    expect(css).toMatch(/\.xq-live-hit--target:hover \.board-select3d-edge--hover/);
    expect(css).toMatch(/\.jieqi-hit--target:hover \.board-select3d-edge--hover/);
  });

  it('tints targets on a non-interactive 3D board instead of ringing them', () => {
    const svg = render(true, { interactive: false });
    expect(group(svg, 'xq-live-hints')).not.toContain('xq-live-hint-capture');
    expect(group(svg, 'board-select3d')).toContain('class="board-select3d-face"');
  });

  it('draws the square grid marks on the rounded square face', () => {
    const svg = render(true, { layout: 'cell' });
    const marks = group(svg, 'board-select3d');
    expect(marks).toMatch(/<rect class="board-select3d-face"[^>]* rx="/);
    expect(marks).toContain('class="board-select3d-edge"');
  });

  it('paints green over the gold last-move edge: selected and hovered target alike', () => {
    // Red's cannon takes the horse on h10, so it is the last move's destination;
    // black's chariot on i10 can take it back.
    const state = applyXiangqiMove(createInitialXiangqiState('sel3d-gold'), {
      from: 'h3',
      to: 'h10',
    });
    const black = getStandardXiangqiPlayerView(state, 'black');
    expect(black.legalMoves.some((m) => m.from === 'i10' && m.to === 'h10')).toBe(true);
    const svg = xiangqiBoardSvg(black, 'black', {
      interactive: true,
      selectedSquare: 'i10',
      draggingFrom: null,
      layout: 'intersection',
      pieceSet: 'traditional',
      tile3d: true,
    });
    const order = layerOrder(svg);
    const gold = order.indexOf('xq-live-lastmove-over');
    const select = order.indexOf('board-select3d');
    const clicks = order.indexOf('xq-live-clicks');
    // The gold edge is on the target; its face tint and the selected side draw
    // after it, and the hover side after that (green wins).
    expect(group(svg, 'xq-live-lastmove-over')).toContain('xq-live-lastmove-edge');
    expect(gold).toBeGreaterThan(-1);
    expect(select).toBeGreaterThan(gold);
    expect(clicks).toBeGreaterThan(select);
    expect(group(svg, 'board-select3d')).toContain('class="board-select3d-face"');
    expect(hit(svg, 'h10')).toContain('board-select3d-edge--hover');
  });
});

describe('jieqi board selection on 3D pieces', () => {
  // A face-down red piece on b3 moves as a cannon: it takes the face-down black
  // piece on b10 over b8.
  const view = getJieqiPlayerView(createInitialJieqiState('sel3d-jieqi'), 'red');
  const moves = view.legalMoves.filter((m) => m.from === 'b3');
  const render = (tile3d: boolean, extra: Parameters<typeof renderJieqiBoardSvg>[2] = {}) =>
    renderJieqiBoardSvg(view, 'red', {
      interactive: true,
      selectedSquare: 'b3',
      legalMoves: moves,
      layout: 'intersection',
      pieceSet: 'traditional',
      tile3d,
      ...extra,
    });

  it('keeps the flat rings on 2D pieces', () => {
    const svg = render(false);
    expect(svg).toContain('jieqi-selection');
    expect(group(svg, 'jieqi-hints')).toContain('jieqi-hint-capture');
    expect(hit(svg, 'b10')).not.toContain('jieqi-hint-capture');
    expect(svg).not.toContain('board-select3d');
  });

  it('marks a face-down selection and target on the piece, with no rings', () => {
    expect(view.board.b10?.faceDown).toBe(true);
    const svg = render(true);
    expect(svg).not.toContain('jieqi-selection');
    expect(hit(svg, 'b10')).not.toContain('jieqi-hint-capture');
    expect(hit(svg, 'b10')).toContain('board-select3d-edge--hover');
    const marks = group(svg, 'board-select3d');
    expect(marks.match(/class="board-select3d-edge"/g)).toHaveLength(1);
    const captures = moves.filter((m) => view.board[m.to]);
    expect(marks.match(/class="board-select3d-face"/g)).toHaveLength(captures.length);
  });

  it('draws the selection marks after the gold edge', () => {
    const order = layerOrder(render(true));
    const gold = order.indexOf('xq-live-lastmove-over');
    expect(gold).toBeGreaterThan(-1);
    expect(order.indexOf('board-select3d')).toBeGreaterThan(gold);
  });
});
