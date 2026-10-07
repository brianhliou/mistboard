import { createInitialJieqiState, type JieqiGameState } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import {
  jieqiRevealOdds,
  LUCK_SIZE_THRESHOLDS,
  luckPoints,
  luckSize,
  luckSizePips,
  luckSizeTone,
} from './jieqi-luck-mark.js';

describe('jieqiRevealOdds', () => {
  const start = (): JieqiGameState => createInitialJieqiState('t');

  it('counts the mover’s face-down pieces, most likely first', () => {
    const before = start();
    expect(before.board.a1?.role).toBe('chariot');
    const odds = jieqiRevealOdds(before, { from: 'a1', to: 'a2' });
    expect(odds).toEqual({
      role: 'chariot',
      count: 2,
      total: 15,
      pool: [
        { role: 'soldier', count: 5 },
        { role: 'chariot', count: 2 },
        { role: 'cannon', count: 2 },
        { role: 'horse', count: 2 },
        { role: 'elephant', count: 2 },
        { role: 'advisor', count: 2 },
      ],
    });
  });

  it('adds the mover’s pieces captured while still dark, and only those', () => {
    const before = start();
    before.captures = [
      // Red's soldier taken face-down: red never saw it, so it is still in red's bag.
      { owner: 'red', role: 'soldier', revealedAtCapture: false },
      // Red's horse taken after it was revealed: known, not in the bag.
      { owner: 'red', role: 'horse', revealedAtCapture: true },
      // Black's piece: a different bag.
      { owner: 'black', role: 'chariot', revealedAtCapture: false },
    ];
    const odds = jieqiRevealOdds(before, { from: 'a1', to: 'a2' });
    expect(odds?.total).toBe(16);
    expect(odds?.count).toBe(2);
    expect(odds?.pool[0]).toEqual({ role: 'soldier', count: 6 });
    expect(odds?.pool.find((e) => e.role === 'horse')?.count).toBe(2);
  });

  it('has no odds for a face-up piece or an empty square', () => {
    const before = start();
    expect(jieqiRevealOdds(before, { from: 'e1', to: 'e2' })).toBeNull();
    expect(jieqiRevealOdds(before, { from: 'e5', to: 'e6' })).toBeNull();
  });

  it('has no odds when any identity in the bag was never dealt', () => {
    const before = start();
    const other = before.board.b1;
    if (other) other.unknown = true;
    expect(jieqiRevealOdds(before, { from: 'a1', to: 'a2' })).toBeNull();
  });
});

describe('die size buckets', () => {
  it('puts each bound in the bucket above it (rounded points, inclusive lower bound)', () => {
    expect(LUCK_SIZE_THRESHOLDS).toEqual([2, 5, 10, 20, 35]);
    const cases: Array<[number, number]> = [
      [0, 1],
      [1.49, 1],
      [1.6, 2], // rounds to 2: the card says "2 points", so the face agrees
      [4, 2],
      [4.6, 3],
      [5, 3],
      [9, 3],
      [10, 4],
      [14, 4],
      [19.4, 4],
      [20, 5],
      [34, 5],
      [35, 6],
      [90, 6],
    ];
    for (const [luck, pips] of cases) {
      expect(luckSizePips(luck), `+${luck}`).toBe(pips);
      expect(luckSizePips(-luck), `-${luck}`).toBe(pips);
    }
  });

  it('names the buckets, small to decisive', () => {
    expect([0, 3, 7, 14, 25, -35].map(luckSize)).toEqual([
      'tiny',
      'small',
      'moderate',
      'big',
      'huge',
      'decisive',
    ]);
  });

  it('greys out the tiny bucket and colours the rest by direction', () => {
    expect(luckSizeTone(0)).toBe('even');
    expect(luckSizeTone(1.4)).toBe('even');
    expect(luckSizeTone(-1)).toBe('even');
    expect(luckSizeTone(1.6)).toBe('lucky');
    expect(luckSizeTone(3)).toBe('lucky');
    expect(luckSizeTone(-2)).toBe('unlucky');
    expect(luckSizeTone(-35)).toBe('unlucky');
  });

  it('states whole unsigned points', () => {
    expect(luckPoints(-34.6)).toBe(35);
    expect(luckPoints(13.7)).toBe(14);
    expect(luckPoints(-0.3)).toBe(0);
  });
});
