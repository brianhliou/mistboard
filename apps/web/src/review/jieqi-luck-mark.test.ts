import { createInitialJieqiState, type JieqiGameState, STANDARD_JIEQI_DEAL } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import {
  jieqiCaptureOdds,
  jieqiChanceOdds,
  jieqiRevealOdds,
  LUCK_SIZE_THRESHOLDS,
  luckInk,
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

  it('inks the die on a scale that steps with the pips, grey only at step 1', () => {
    expect([0, 1.4, 1.6, 4.4, 4.6, 9.6, 19.6, 34.4, 34.6, 80].map((l) => luckInk(l))).toEqual([
      { side: 'even', step: 1 },
      { side: 'even', step: 1 },
      { side: 'lucky', step: 2 },
      { side: 'lucky', step: 2 },
      { side: 'lucky', step: 3 },
      { side: 'lucky', step: 4 },
      { side: 'lucky', step: 5 },
      { side: 'lucky', step: 5 },
      { side: 'lucky', step: 6 },
      { side: 'lucky', step: 6 },
    ]);
    // The test game's plies: 14 (+3) is a light step, 27 (-35) the deepest.
    expect(luckInk(3)).toEqual({ side: 'lucky', step: 2 });
    expect(luckInk(-7)).toEqual({ side: 'unlucky', step: 3 });
    expect(luckInk(-35)).toEqual({ side: 'unlucky', step: 6 });
    for (let l = -60; l <= 60; l += 0.5) {
      const ink = luckInk(l);
      expect(ink.step).toBe(luckSizePips(l));
      expect(ink.side === 'even').toBe(ink.step === 1);
    }
  });

  it('states whole unsigned points', () => {
    expect(luckPoints(-34.6)).toBe(35);
    expect(luckPoints(13.7)).toBe(14);
    expect(luckPoints(-0.3)).toBe(0);
  });
});

// ── Face-down captures: the victim's pool as the capturer knew it ────────────────────
// The same constructed states and expected pools as the server's pool test
// (apps/server/src/jieqi-analysis.test.ts, "the luck card's pools match the server's"):
// the card states odds from the pool the server averaged the luck over, so the two must agree.
// Keep the two fixtures in step.
function poolFixture(revealing: boolean): JieqiGameState {
  const s = createInitialJieqiState('t', STANDARD_JIEQI_DEAL);
  expect([s.board.a10?.role, s.board.b10?.role, s.board.c10?.role]).toEqual([
    'chariot',
    'horse',
    'elephant',
  ]);
  // Red took Black's a10 chariot while it was face-down: Red saw it, so it is out of the pool
  // Red believes Black's dark squares hold (it stays in Black's own bag).
  delete s.board.a10;
  s.captures.push({ owner: 'black', role: 'chariot', revealedAtCapture: false });
  // Black revealed its b10 horse by moving it.
  s.board.b10 = { ...s.board.b10!, faceDown: false };
  // Black took Red's b1 horse after it was revealed: known to Red, out of Red's bag.
  delete s.board.b1;
  s.captures.push({ owner: 'red', role: 'horse', revealedAtCapture: true });
  // The capturing piece on a1: face-up for a pure capture, still dark for reveal-and-capture.
  s.board.a1 = { ...s.board.a1!, faceDown: revealing };
  return s;
}
const TAKE_C10 = { from: 'a1', to: 'c10' } as const;
const VICTIM_POOL = [
  { role: 'soldier', count: 5 },
  { role: 'cannon', count: 2 },
  { role: 'elephant', count: 2 },
  { role: 'advisor', count: 2 },
  { role: 'chariot', count: 1 },
  { role: 'horse', count: 1 },
];
const MOVER_POOL = [
  { role: 'soldier', count: 5 },
  { role: 'chariot', count: 2 },
  { role: 'cannon', count: 2 },
  { role: 'elephant', count: 2 },
  { role: 'advisor', count: 2 },
  { role: 'horse', count: 1 },
];

describe('jieqiCaptureOdds', () => {
  it('counts the victim’s face-down pieces still on the board, nothing the capturer saw', () => {
    const odds = jieqiCaptureOdds(poolFixture(false), TAKE_C10);
    expect(odds).toEqual({ role: 'elephant', count: 2, total: 13, pool: VICTIM_POOL });
  });

  it('has no odds for a face-up target, an own piece, or an empty square', () => {
    const before = poolFixture(false);
    expect(jieqiCaptureOdds(before, { from: 'a1', to: 'b10' })).toBeNull();
    expect(jieqiCaptureOdds(before, { from: 'a1', to: 'c1' })).toBeNull();
    expect(jieqiCaptureOdds(before, { from: 'a1', to: 'e5' })).toBeNull();
  });

  it('has no odds when any identity in the victim’s pool was never dealt', () => {
    const before = poolFixture(false);
    before.board.d10!.unknown = true;
    expect(jieqiCaptureOdds(before, TAKE_C10)).toBeNull();
  });
});

describe('jieqiChanceOdds', () => {
  it('names a pure face-down capture and its victim pool', () => {
    const chance = jieqiChanceOdds(poolFixture(false), TAKE_C10);
    expect(chance?.kind).toBe('capture');
    expect(chance?.reveal).toBeNull();
    expect(chance?.capture?.pool).toEqual(VICTIM_POOL);
  });

  it('gives a reveal-and-capture both draws, each from its own pool', () => {
    const chance = jieqiChanceOdds(poolFixture(true), TAKE_C10);
    expect(chance?.kind).toBe('both');
    expect(chance?.reveal).toEqual({ role: 'chariot', count: 2, total: 14, pool: MOVER_POOL });
    expect(chance?.capture).toEqual({ role: 'elephant', count: 2, total: 13, pool: VICTIM_POOL });
  });

  it('leaves a pure reveal as before, and a quiet move with nothing', () => {
    const before = poolFixture(true);
    const chance = jieqiChanceOdds(before, { from: 'a1', to: 'a2' });
    expect(chance).toEqual({
      kind: 'reveal',
      reveal: jieqiRevealOdds(before, { from: 'a1', to: 'a2' }),
      capture: null,
    });
    expect(jieqiChanceOdds(before, { from: 'e1', to: 'e2' })).toBeNull();
  });
});
