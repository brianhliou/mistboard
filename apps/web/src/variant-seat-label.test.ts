import { describe, expect, it } from 'vitest';
import { brandsBlackAsBlue, seatColorWord, seatInkFamily } from './variant-seat-label.js';

describe('seatColorWord', () => {
  it('brands the Jungle family dark seat "Blue", keeps every other variant literal', () => {
    // Jungle Chess + Flip Jungle: the navy side is "Blue".
    expect(seatColorWord('jungle', 'black')).toBe('Blue');
    expect(seatColorWord('jungle-flip', 'black')).toBe('Blue');
    // The first seat is Red in the Jungle family.
    expect(seatColorWord('jungle', 'red')).toBe('Red');
    // Non-jungle variants keep "Black".
    expect(seatColorWord('xiangqi', 'black')).toBe('Black');
    expect(seatColorWord('dark-chess', 'black')).toBe('Black');
  });

  it('is safe on a missing/unknown variant and unknown color ids', () => {
    // No variant → cannot be jungle, so 'black' stays "Black".
    expect(seatColorWord(undefined, 'black')).toBe('Black');
    expect(seatColorWord(null, 'black')).toBe('Black');
    expect(seatColorWord('not-a-variant', 'black')).toBe('Black');
    // Unknown color id title-cases rather than throwing.
    expect(seatColorWord('jungle', 'green')).toBe('Green');
  });
});

describe('seatInkFamily', () => {
  // The seat DISC has to key on the same predicate as the seat WORD. A jungle page
  // reading "Blue is victorious" beside a black dot is the defect this exists to
  // stop, so these assertions are what pins the two together.
  it('names the jungle family and nothing else', () => {
    expect(seatInkFamily('jungle')).toBe('jungle');
    expect(seatInkFamily('jungle-flip')).toBe('jungle');
    // Every other red-vs-black variant keeps the default dark disc. A leak here
    // would repaint xiangqi, jieqi and banqi blue on /watch.
    for (const variant of ['xiangqi', 'dark-xiangqi', 'jieqi', 'banqi', 'dark-chess']) {
      expect(seatInkFamily(variant)).toBeNull();
    }
    expect(seatInkFamily(null)).toBeNull();
    expect(seatInkFamily('not-a-variant')).toBeNull();
  });

  it('agrees with the word rename it shares a predicate with', () => {
    for (const variant of ['jungle', 'jungle-flip', 'xiangqi', 'banqi', 'dark-chess', null]) {
      expect(brandsBlackAsBlue(variant)).toBe(seatColorWord(variant, 'black') === 'Blue');
    }
  });
});
