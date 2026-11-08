import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  type FortressXiangqiPlayerView,
  type JieqiPlayerView,
  type StandardXiangqiPlayerView,
  standardXiangqiCheckedGeneral,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { boardCheckCellSvg, boardCheckGlowSvg } from './board-check.js';
import { renderFortressXiangqiBoardSvg } from './fortress-xiangqi-render.js';
import { type DarkXiangqiWireView, renderDarkXiangqiBoardSvg } from './live-dark-xiangqi.js';
import { renderJieqiBoardSvg } from './live-jieqi-render.js';
import { xiangqiBoardSvg } from './xiangqi-board.js';

// The check glow: a static red aura under the general of the side facing the
// move. Every board with check draws it from its own rule; Fog Xiangqi never
// does (its rules have no check, and a glow would point at a hidden attacker).

const GLOW = 'class="board-check"';

function xiangqiView(turn: 'red' | 'black'): StandardXiangqiPlayerView {
  return {
    id: 'x',
    perspective: 'red',
    board: {
      e10: { color: 'black', role: 'general' },
      e5: { color: 'red', role: 'chariot' },
      d1: { color: 'red', role: 'general' },
    },
    legalMoves: [],
    status: { type: 'playing', turn },
    moveNumber: 5,
  };
}

describe('board check glow', () => {
  it('xiangqi: glows the checked general only when the caller names it', () => {
    const view = xiangqiView('black');
    const square = standardXiangqiCheckedGeneral(view.board, view.status);
    expect(square).toBe('e10');
    const base = { interactive: false, selectedSquare: null, draggingFrom: null };
    const svg = xiangqiBoardSvg(view, 'red', { ...base, checkSquare: square });
    expect(svg).toContain(GLOW);
    // Under the pieces, so the general's disc sits on the glow.
    expect(svg.indexOf(GLOW)).toBeLessThan(svg.indexOf('xq-live-pieces'));
    // Static: nothing animates.
    expect(svg).not.toMatch(/<animate|animation/);
    expect(xiangqiBoardSvg(view, 'red', base)).not.toContain(GLOW);
  });

  it('jieqi: the renderer glows the side to move in check, from the masked board', () => {
    const view = (turn: 'red' | 'black'): JieqiPlayerView => ({
      id: 'j',
      perspective: 'red',
      board: {
        e1: { color: 'red', role: 'general', faceDown: false },
        // Face-down on the cannon square: checks as a cannon over b5.
        b3: { color: 'red', faceDown: true },
        b5: { color: 'black', role: 'soldier', faceDown: false },
        b10: { color: 'black', role: 'general', faceDown: false },
      },
      legalMoves: [],
      captured: [],
      inCheck: false,
      status: { type: 'playing', turn },
      moveNumber: 3,
    });
    expect(renderJieqiBoardSvg(view('black'), 'red')).toContain(GLOW);
    expect(renderJieqiBoardSvg(view('red'), 'red')).not.toContain(GLOW);
    expect(renderJieqiBoardSvg(view('black'), 'red', { check: false })).not.toContain(GLOW);
  });

  it('fortress: the renderer glows the side to move in check', () => {
    const view = (turn: 'red' | 'black'): FortressXiangqiPlayerView => ({
      id: 'f',
      perspective: 'red',
      board: {
        b1: { color: 'red', role: 'general' },
        f8: { color: 'black', role: 'general' },
        f3: { color: 'red', role: 'chariot' },
      },
      hands: { red: {}, black: {} },
      legalMoves: [],
      inCheck: false,
      status: { type: 'playing', turn },
      moveNumber: 3,
    });
    expect(renderFortressXiangqiBoardSvg(view('black'), 'red')).toContain(GLOW);
    expect(renderFortressXiangqiBoardSvg(view('red'), 'red')).not.toContain(GLOW);
  });

  it("square grid: tints the general's whole cell under the tile, on every board", () => {
    // A rounded-square tile nearly fills its cell, so a disc halo only peeked
    // out at the middle of each edge (2026-10-29).
    const CELL_MARK = 'class="board-check__cell"';
    const view = xiangqiView('black');
    const base = { interactive: false, selectedSquare: null, draggingFrom: null };
    const cell = xiangqiBoardSvg(view, 'red', {
      ...base,
      checkSquare: 'e10',
      layout: 'cell',
      pieceSet: 'international',
    });
    expect(cell).toContain(CELL_MARK);
    expect(cell).not.toContain('board-check__glow');
    expect(cell.indexOf(CELL_MARK)).toBeLessThan(cell.indexOf('xq-live-pieces'));
    const intersection = xiangqiBoardSvg(view, 'red', {
      ...base,
      checkSquare: 'e10',
      layout: 'intersection',
      pieceSet: 'international',
    });
    expect(intersection).not.toContain(CELL_MARK);
    expect(intersection).toContain('board-check__glow');

    const jieqi: JieqiPlayerView = {
      id: 'j',
      perspective: 'red',
      board: {
        e1: { color: 'red', role: 'general', faceDown: false },
        e5: { color: 'black', role: 'chariot', faceDown: false },
        d10: { color: 'black', role: 'general', faceDown: false },
      },
      legalMoves: [],
      captured: [],
      inCheck: false,
      status: { type: 'playing', turn: 'red' },
      moveNumber: 3,
    };
    expect(
      renderJieqiBoardSvg(jieqi, 'red', { layout: 'cell', pieceSet: 'international' }),
    ).toContain(CELL_MARK);
    const fortress: FortressXiangqiPlayerView = {
      id: 'f',
      perspective: 'red',
      board: {
        b1: { color: 'red', role: 'general' },
        f8: { color: 'black', role: 'general' },
        f3: { color: 'red', role: 'chariot' },
      },
      hands: { red: {}, black: {} },
      legalMoves: [],
      inCheck: false,
      status: { type: 'playing', turn: 'black' },
      moveNumber: 3,
    };
    expect(
      renderFortressXiangqiBoardSvg(fortress, 'red', { layout: 'cell', pieceSet: 'international' }),
    ).toContain(CELL_MARK);
  });

  it('square grid: fills exactly the cell, and a disc-only set keeps the halo', () => {
    const svg = boardCheckCellSvg({ x: 100, y: 100 }, 60, 'international', 54);
    expect(svg).toContain('x="70" y="70" width="60" height="60"');
    // The asset sets draw their own disc on the square grid too.
    const disc = boardCheckCellSvg({ x: 100, y: 100 }, 60, 'wood', 54);
    expect(disc).toContain('board-check__glow');
    expect(disc).not.toContain('board-check__cell');
  });

  it("keeps the halo close: 36% past the disc, its tail under a neighbour's disc", () => {
    // Xiangqi's piece is 54 units on a 60-unit cell.
    const svg = boardCheckGlowSvg({ x: 100, y: 100 }, 54);
    const r = Number(/class="board-check__glow"[^>]*\br="([\d.]+)"/.exec(svg)?.[1]);
    expect(r).toBeCloseTo(27 * 1.36, 1);
    // The halo draws under the pieces, so a tail that stops inside the outer
    // half of a neighbour's disc is hidden by it.
    expect(r).toBeLessThan(60 - 27 / 2);
  });

  it('paints the core at 0.85 and fades to nothing at the edge', () => {
    // Resolved from the working directory: import.meta.url is not a file: URL here.
    const cssPath = ['src/board-check.css', 'apps/web/src/board-check.css']
      .map((candidate) => resolve(process.cwd(), candidate))
      .find((candidate) => existsSync(candidate));
    const css = readFileSync(cssPath as string, 'utf8');
    expect(css).toMatch(/\.board-check__core\s*\{[^}]*stop-opacity:\s*0\.85;/);
    expect(css).toMatch(/\.board-check__edge\s*\{[^}]*stop-opacity:\s*0;/);
    expect(css).toMatch(/\.board-check__cell\s*\{[^}]*fill-opacity:\s*0\.55;/);
  });

  it('Fog Xiangqi never glows, even with an attacker on the general file', () => {
    const view: DarkXiangqiWireView = {
      id: 'fog',
      perspective: 'black',
      board: {
        e10: { piece: { color: 'black', role: 'general' }, shrouded: false },
        e5: { piece: { color: 'red', role: 'chariot' }, shrouded: false },
        d1: { color: 'red', shrouded: true },
      },
      visibleSquares: ['e10', 'e9', 'e8', 'e7', 'e6', 'e5'],
      legalMoves: [],
      status: { type: 'playing', turn: 'black' },
      moveNumber: 5,
      captures: { red: [], black: [] },
    };
    expect(renderDarkXiangqiBoardSvg(view)).not.toContain('board-check');
  });
});
