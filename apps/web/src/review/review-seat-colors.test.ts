import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHESS_SEAT_COLORS, type ReviewInk, reviewColorForSeat } from './review-seat-colors.js';

describe('reviewColorForSeat', () => {
  it('passes a seat straight through when the variant declares no mapping', () => {
    expect(reviewColorForSeat('red', undefined)).toBe('red');
    expect(reviewColorForSeat('black', undefined)).toBe('black');
  });

  it('resolves the chess family first seat to White', () => {
    // The regression this exists for: the analysis SLOTS are named red/black as
    // move-order positions, so every surface that painted the slot name gave a
    // chess player a RED dot, bar and chart area.
    expect(reviewColorForSeat('red', CHESS_SEAT_COLORS)).toBe('white');
    expect(reviewColorForSeat('black', CHESS_SEAT_COLORS)).toBe('black');
  });

  it('maps the two seats to two different inks', () => {
    // A mapping that collapsed both seats onto one ink would render a game in
    // which both players look like the same side, which is worse than the bug.
    expect(reviewColorForSeat('red', CHESS_SEAT_COLORS)).not.toBe(
      reviewColorForSeat('black', CHESS_SEAT_COLORS),
    );
  });
});

describe('ink coverage across the review surfaces', () => {
  // Every surface that builds a class from `reviewColorForSeat` needs a rule for
  // every ink the resolver can return. Miss one and the element renders unstyled,
  // which is silent: no error, no test failure, just a seat that says nothing.
  const INKS: ReviewInk[] = ['red', 'black', 'white'];
  const surfaces: ReadonlyArray<[string, string, string]> = [
    ['move-time bar', 'src/review/review-shell.css', '.review-move-times__bar--'],
    ['advantage area', 'src/review/advantage-chart.css', '.advantage-chart__area--'],
    ['advantage zone', 'src/review/advantage-chart.css', '.advantage-chart__zone--'],
  ];

  for (const [name, file, prefix] of surfaces) {
    it(`${name} styles every ink`, () => {
      const css = readFileSync(file, 'utf8');
      for (const ink of INKS) expect(css).toContain(`${prefix}${ink}`);
    });
  }

  it('has no leftover page-class override for the chess move-time bar', () => {
    // The override this replaced repainted a bar that was still CALLED red. Leaving
    // it beside the rule that superseded it is how a dead selector silently wins a
    // later cascade fight, so its removal is part of the contract.
    const css = readFileSync('src/review/review-shell.css', 'utf8');
    expect(css).not.toContain('.dark-chess-review .review-move-times__bar--red');
  });
});
