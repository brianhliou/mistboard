// Your own Fog seek card draws your seat's start view (seat-start-view.ts). It
// must hold only what that seat sees: no opponent piece identity outside the
// seat's visible squares, and shrouded entries carry colour only, as the
// server's wire view does. Someone else's fog seek draws no board at all.
import { describe, expect, it } from 'vitest';
import {
  fogChessSeatStartView,
  fogXiangqiSeatStartView,
  type SeatSide,
} from './seat-start-view.js';
import { renderStartPositionSvg } from './start-position-board.js';

const SIDES: SeatSide[] = ['first', 'second'];

describe('fogXiangqiSeatStartView', () => {
  for (const side of SIDES) {
    it(`holds only what the ${side} seat sees`, () => {
      const view = fogXiangqiSeatStartView(side);
      const me = side === 'first' ? 'red' : 'black';
      expect(view.perspective).toBe(me);
      const visible = new Set<string>(view.visibleSquares);
      let opponentIdentified = 0;
      for (const [square, entry] of Object.entries(view.board)) {
        if (!entry) continue;
        if (entry.shrouded) {
          // Colour only: no role, no piece object.
          expect(Object.keys(entry).sort(), square).toEqual(['color', 'shrouded']);
          continue;
        }
        if (entry.piece.color !== me) {
          opponentIdentified += 1;
          expect(visible.has(square), `${square} identified outside vision`).toBe(true);
        }
      }
      // The fog hides most of the opponent's army at the start.
      expect(opponentIdentified).toBeLessThan(16);
      expect(view.captures).toEqual({ red: [], black: [] });
    });
  }
});

describe('fogChessSeatStartView', () => {
  for (const side of SIDES) {
    it(`holds only what the ${side} seat sees`, () => {
      const view = fogChessSeatStartView(side);
      const me = side === 'first' ? 'white' : 'black';
      expect(view.perspective).toBe(me);
      const visible = new Set<string>(view.visibleSquares);
      let opponent = 0;
      for (const [square, piece] of Object.entries(view.board)) {
        if (!piece || piece.color === me) continue;
        opponent += 1;
        expect(visible.has(square), `${square} drawn outside vision`).toBe(true);
      }
      expect(opponent).toBeLessThan(16);
    });
  }
});

describe('renderStartPositionSvg for a seat', () => {
  it('draws a fog variant only for a named seat', async () => {
    for (const id of ['dark-xiangqi', 'dark-chess']) {
      expect(await renderStartPositionSvg(id), id).toBeNull();
      for (const side of SIDES) {
        expect(await renderStartPositionSvg(id, side), `${id} ${side}`).toMatch(/^\s*<svg/);
      }
    }
  });

  it('turns a xiangqi-family board to the seat it is drawn for', async () => {
    for (const id of ['xiangqi', 'jieqi', 'fortress-xiangqi']) {
      const red = await renderStartPositionSvg(id, 'first');
      const black = await renderStartPositionSvg(id, 'second');
      expect(red, id).toMatch(/^\s*<svg/);
      expect(black, id).not.toBe(red);
    }
  });
});
