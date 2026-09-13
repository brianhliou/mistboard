import { describe, expect, it } from 'vitest';
import { flipSeatInk, isFlipSeatVariant, seatInkForVariant } from './flip-seat-ink.js';

describe('flipSeatInk', () => {
  it('maps the first-mover seat to the bound ink and the second seat to the other', () => {
    expect(flipSeatInk('red', 'black')).toBe('black');
    expect(flipSeatInk('black', 'black')).toBe('red');
    expect(flipSeatInk('red', 'red')).toBe('red');
    expect(flipSeatInk('black', 'red')).toBe('black');
  });

  it('reports unbound before the opening flip rather than defaulting to the seat', () => {
    expect(flipSeatInk('red', null)).toBeNull();
    expect(flipSeatInk('black', null)).toBeNull();
  });
});

describe('isFlipSeatVariant', () => {
  it('covers the flip-deal variants and nothing else', () => {
    expect(isFlipSeatVariant('banqi')).toBe(true);
    expect(isFlipSeatVariant('jungle-flip')).toBe(true);
    // Jieqi deals face down but each seat owns a fixed ink from move one, and
    // Jungle Chess never flips at all.
    expect(isFlipSeatVariant('jieqi')).toBe(false);
    expect(isFlipSeatVariant('jungle')).toBe(false);
    expect(isFlipSeatVariant('xiangqi')).toBe(false);
    expect(isFlipSeatVariant('not-a-variant')).toBe(false);
    expect(isFlipSeatVariant(null)).toBe(false);
  });
});

describe('seatInkForVariant', () => {
  it('translates flip seats and passes every other variant through untouched', () => {
    expect(seatInkForVariant('banqi', 'red', 'black')).toBe('black');
    expect(seatInkForVariant('jungle-flip', 'black', 'black')).toBe('red');
    // seat == ink everywhere else, including the seats a flip variant never uses.
    expect(seatInkForVariant('xiangqi', 'red', null)).toBe('red');
    expect(seatInkForVariant('dark-chess', 'white', null)).toBe('white');
  });

  it('is unbound for a flip variant with no firstColor, and never invents one', () => {
    expect(seatInkForVariant('banqi', 'red', null)).toBeNull();
    expect(seatInkForVariant('banqi', 'black', undefined)).toBeNull();
  });
});
