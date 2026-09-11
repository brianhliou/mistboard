import { describe, expect, it } from 'vitest';
import {
  DUCK_XIANGQI_CANNON_SCREEN,
  DUCK_XIANGQI_ELEPHANT_PAIR,
  DUCK_XIANGQI_FACING_PIN,
  DUCK_XIANGQI_HORSE_PAIR,
  DUCK_XIANGQI_INTRO_BOARD,
  DUCK_XIANGQI_SHARED_SCREEN,
  DUCK_XIANGQI_START_BOARD,
  DUCK_XIANGQI_THUMBNAIL,
  DUCK_XIANGQI_TURN_PAIR,
} from './duck-xiangqi-rules-diagrams.js';

// The duck is drawn by an OVERLAY that takes the board's x origin as an
// argument, so it is the one mark on these figures whose position is not
// derived from the board it belongs to. Pass an origin that does not match the
// board's own `x` and the duck silently lands somewhere else -- off the figure
// entirely when the mismatch is a board width.
//
// That has now happened three times in this file: a facing diagram whose board
// moved to PAIR_GAP_X / 2 while its overlay stayed at 0, the same in reverse on
// the shared-screen figure, and the thumbnail, which drew its board at 0 and
// its duck at PAIR_GAP_X / 2 and therefore showed an empty starting position
// on every surface that used it. Nothing failed; the duck was simply absent.
//
// Rendering is the only way to catch it, because the mismatch is between two
// numbers that are individually valid.
const DIAGRAMS: ReadonlyArray<readonly [string, () => string]> = [
  ['START_BOARD', DUCK_XIANGQI_START_BOARD],
  ['THUMBNAIL', DUCK_XIANGQI_THUMBNAIL],
  ['INTRO_BOARD', DUCK_XIANGQI_INTRO_BOARD],
  ['TURN_PAIR', DUCK_XIANGQI_TURN_PAIR],
  ['HORSE_PAIR', DUCK_XIANGQI_HORSE_PAIR],
  ['ELEPHANT_PAIR', DUCK_XIANGQI_ELEPHANT_PAIR],
  ['CANNON_SCREEN', DUCK_XIANGQI_CANNON_SCREEN],
  ['FACING_PIN', DUCK_XIANGQI_FACING_PIN],
  ['SHARED_SCREEN', DUCK_XIANGQI_SHARED_SCREEN],
];

/** Where the overlay actually put each duck, and how big it is.
 *
 *  The BOX matters, not just the origin: the thumbnail regression drew its
 *  duck at x=284 on a 292-wide figure, so the origin was technically inside
 *  and all but a few pixels of the bird was clipped off the right edge. A
 *  check on the corner alone passes that. The group is
 *  `translate(x - size/2, y - size/2) scale(size/100)` over 100-unit art, so
 *  the scale recovers the size. */
function duckBoxes(svg: string): { x: number; y: number; size: number }[] {
  const boxes: { x: number; y: number; size: number }[] = [];
  const duckGroup =
    /<g aria-label="duck">\s*<g transform="translate\(([-\d.]+),([-\d.]+)\) scale\(([\d.]+)\)/g;
  for (const match of svg.matchAll(duckGroup)) {
    boxes.push({ x: Number(match[1]), y: Number(match[2]), size: Number(match[3]) * 100 });
  }
  return boxes;
}

function viewBoxOf(svg: string): { width: number; height: number } {
  const raw = svg.match(/viewBox="([^"]+)"/)?.[1];
  const [, , width, height] = (raw ?? '0 0 0 0').split(/\s+/).map(Number);
  return { width, height };
}

describe('duck xiangqi rules diagrams', () => {
  for (const [name, render] of DIAGRAMS) {
    it(`${name}: every duck is drawn inside the figure`, () => {
      const svg = render();
      const { width, height } = viewBoxOf(svg);
      expect(width, 'figure has a width').toBeGreaterThan(0);

      // Not every figure has a duck -- START_BOARD is the "no duck yet"
      // position on purpose -- so this bounds whatever ducks are present
      // rather than demanding one. Which figures MUST have one is asserted
      // separately below.
      for (const box of duckBoxes(svg)) {
        expect(box.x, `${name}: duck left edge`).toBeGreaterThanOrEqual(0);
        expect(box.y, `${name}: duck top edge`).toBeGreaterThanOrEqual(0);
        // The WHOLE mark has to fit, which is what the corner check missed.
        expect(box.x + box.size, `${name}: duck right edge within the figure`).toBeLessThanOrEqual(
          width,
        );
        expect(box.y + box.size, `${name}: duck bottom edge within the figure`).toBeLessThanOrEqual(
          height,
        );
      }
    });
  }

  it('the thumbnail carries exactly one duck, and the start board none', () => {
    // The thumbnail is the surface the regression hit: it rendered fine and
    // the duck was simply clipped off the edge, which no "does it render"
    // check would notice. The start board is the control -- it is captioned
    // "STARTING POSITION, NO DUCK YET" and a duck appearing there would be its
    // own bug.
    expect(duckBoxes(DUCK_XIANGQI_THUMBNAIL())).toHaveLength(1);
    expect(duckBoxes(DUCK_XIANGQI_START_BOARD())).toHaveLength(0);
  });
});
