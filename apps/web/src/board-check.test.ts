import {
  type FortressXiangqiPlayerView,
  type JieqiPlayerView,
  type StandardXiangqiPlayerView,
  standardXiangqiCheckedGeneral,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { boardCheckGlowSvg } from './board-check.js';
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

  it('keeps the halo tight: at most 20% past the disc, never reaching a neighbour', () => {
    // Xiangqi's piece is 54 units on a 60-unit cell.
    const svg = boardCheckGlowSvg({ x: 100, y: 100 }, 54);
    const r = Number(/class="board-check__glow"[^>]*\br="([\d.]+)"/.exec(svg)?.[1]);
    expect(r).toBeGreaterThan(27);
    expect(r).toBeLessThanOrEqual(27 * 1.2);
    expect(r + 27).toBeLessThan(60);
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
