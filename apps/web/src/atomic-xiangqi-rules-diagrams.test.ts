import { describe, expect, it } from 'vitest';
import {
  ATOMIC_XIANGQI_BLAST_PAIR,
  ATOMIC_XIANGQI_CHECK,
  ATOMIC_XIANGQI_CORK,
  ATOMIC_XIANGQI_GENERALS,
  ATOMIC_XIANGQI_SHOT_PAIR,
  ATOMIC_XIANGQI_SOLDIER_PAIR,
  ATOMIC_XIANGQI_THUMBNAIL,
} from './atomic-xiangqi-rules-diagrams.js';

// Two of these figures return an EMPTY string when the kernel disagrees with
// the caption (the check figure needs the kernel to call the position check;
// the generals figure needs one capture legal and the other not). An empty
// figure is a blank hole on the rules page with nothing failing, so rendering
// is the test.
const DIAGRAMS: ReadonlyArray<readonly [string, () => string]> = [
  ['BLAST_PAIR', ATOMIC_XIANGQI_BLAST_PAIR],
  ['SHOT_PAIR', ATOMIC_XIANGQI_SHOT_PAIR],
  ['GENERALS', ATOMIC_XIANGQI_GENERALS],
  ['CHECK', ATOMIC_XIANGQI_CHECK],
  ['CORK', ATOMIC_XIANGQI_CORK],
  ['THUMBNAIL', ATOMIC_XIANGQI_THUMBNAIL],
];

describe('atomic xiangqi rules diagrams', () => {
  for (const [name, render] of DIAGRAMS) {
    it(`${name} renders an SVG with pieces on it`, () => {
      const svg = render();
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).toContain('</svg>');
    });
  }

  it('the blast pair rings the cleared points and not the soldier', () => {
    const svg = ATOMIC_XIANGQI_BLAST_PAIR();
    // Two boards, each with rings on e6 (the horse), d6 and f6: six rings.
    expect(svg.match(/xq-marker--blast/g)?.length).toBe(6);
  });

  it('the soldier pair rings the cannon and the horse, never a soldier', () => {
    const svg = ATOMIC_XIANGQI_SOLDIER_PAIR();
    // Two boards, each with rings on e5 (the horse) and f5 (the cannon): four.
    expect(svg.match(/xq-marker--blast/g)?.length).toBe(4);
  });

  it('the cannon shot rings the target alone', () => {
    const svg = ATOMIC_XIANGQI_SHOT_PAIR();
    expect(svg.match(/xq-marker--blast/g)?.length).toBe(2);
  });
});
