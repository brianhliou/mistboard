import { describe, expect, it } from 'vitest';
import { CHESS_SEAT_COLORS } from './review-seat-colors.js';
import { seatStripDisplayInk, seatStripInks, UNBOUND_SEAT_INK } from './seat-strip-ink.js';

// The two shapes every review presentation's `perspective` takes today.
const chess = (flipped: boolean) => (flipped ? 'black' : 'white');
const xiangqi = (flipped: boolean) => (flipped ? 'black' : 'red');

describe('seatStripInks', () => {
  it('gives chess its real inks, not the red/black the seat SLOTS are named', () => {
    // The regression: an `isRed` boolean here painted White's disc red on every
    // fog-chess review page, because "is the first mover" and "is red" are the
    // same question in every variant except this one.
    expect(seatStripInks(chess, false)).toEqual({ bottom: 'white', top: 'black' });
    expect(seatStripInks(chess, true)).toEqual({ bottom: 'black', top: 'white' });
  });

  it('leaves the red/black variants exactly as they were', () => {
    expect(seatStripInks(xiangqi, false)).toEqual({ bottom: 'red', top: 'black' });
    expect(seatStripInks(xiangqi, true)).toEqual({ bottom: 'black', top: 'red' });
  });

  it('always seats opposite inks', () => {
    for (const perspective of [chess, xiangqi]) {
      for (const flipped of [false, true]) {
        const { top, bottom } = seatStripInks(perspective, flipped);
        expect(top).not.toBe(bottom);
      }
    }
  });
});

describe('seatStripDisplayInk', () => {
  // Banqi and Flip Jungle seat their players as first/second MOVER under the ids
  // 'red'/'black'; the opening reveal decides which ink each actually plays. So a
  // raw seat is wrong in about half of all games, not merely inconsistent.
  const bound = { red: 'black', black: 'red' } as const;

  it('routes a flip seat through the binding the opening reveal established', () => {
    expect(seatStripDisplayInk('red', bound, true)).toBe('black');
    expect(seatStripDisplayInk('black', bound, true)).toBe('red');
  });

  it('renders neutral before the flip binds, instead of guessing a colour', () => {
    expect(seatStripDisplayInk('red', undefined, true)).toBe(UNBOUND_SEAT_INK);
    expect(seatStripDisplayInk('black', undefined, true)).toBe(UNBOUND_SEAT_INK);
  });

  it('leaves fixed-ink variants alone', () => {
    // Xiangqi: seat IS the ink, and no mapping is supplied.
    expect(seatStripDisplayInk('red', undefined, false)).toBe('red');
    expect(seatStripDisplayInk('black', undefined, false)).toBe('black');
    // Chess: perspective() already handed us an ink, so there is nothing to map.
    expect(seatStripDisplayInk('white', undefined, false)).toBe('white');
    expect(seatStripDisplayInk('white', CHESS_SEAT_COLORS, false)).toBe('white');
    // Chess's first SLOT resolves to white through the mapping.
    expect(seatStripDisplayInk('red', CHESS_SEAT_COLORS, false)).toBe('white');
  });

  it('agrees with the meta card rather than contradicting it', () => {
    // The reported bug: on one finished Banqi page the strips said Guest was black
    // while the meta card said red. Both now read the same mapping, so for every
    // binding the two seats resolve to different, complementary inks.
    for (const colors of [bound, { red: 'red', black: 'black' } as const]) {
      const red = seatStripDisplayInk('red', colors, true);
      const black = seatStripDisplayInk('black', colors, true);
      expect(red).toBe(colors.red);
      expect(black).toBe(colors.black);
      expect(red).not.toBe(black);
    }
  });
});
