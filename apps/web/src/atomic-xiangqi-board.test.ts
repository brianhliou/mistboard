import {
  applyAtomicXiangqiMove,
  atomicXiangqiStateFromFen,
  getAtomicXiangqiPlayerView,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { atomicXiangqiBlastKey, atomicXiangqiBlastMarkers } from './atomic-xiangqi-board.js';

// Red chariot d9 takes the advisor on d10 beside the black general on e10:
// the game ends by explosion. Red chariot e3 takes the horse on e6 with a
// black chariot on d6 and a soldier on e7 beside it: an ordinary blast.
const WIN = atomicXiangqiStateFromFen('3ak4/3R5/9/9/9/9/9/9/9/4K4 w - - 0 1', 'fx');
const BLAST = atomicXiangqiStateFromFen('4k4/9/9/4p4/3rn4/9/9/4R4/9/4K4 w - - 0 1', 'fx');

describe('atomic xiangqi board marks', () => {
  it('rings every cleared point, and only on a fresh ply adds the shockwave', () => {
    if (!BLAST) throw new Error('fixture');
    const after = applyAtomicXiangqiMove(BLAST, { from: 'e3', to: 'e6' });
    const view = getAtomicXiangqiPlayerView(after, 'red');
    const still = atomicXiangqiBlastMarkers(view);
    expect(still.map((m) => `${m.square}:${m.className}`).sort()).toEqual([
      'd6:xq-marker--blast',
      'e6:xq-marker--blast',
    ]);
    const fresh = atomicXiangqiBlastMarkers(view, { fresh: true });
    expect(fresh.filter((m) => m.className?.includes('blast-fresh'))).toHaveLength(2);
    expect(fresh.find((m) => m.className === 'xq-marker--shock')?.square).toBe('e6');
  });

  it('draws nothing after a quiet move, fresh or not', () => {
    if (!BLAST) throw new Error('fixture');
    const after = applyAtomicXiangqiMove(BLAST, { from: 'e3', to: 'e4' });
    const view = getAtomicXiangqiPlayerView(after, 'red');
    expect(atomicXiangqiBlastMarkers(view, { fresh: true })).toEqual([]);
  });

  it('marks the general\u2019s point like any other when the game ended by explosion', () => {
    if (!WIN) throw new Error('fixture');
    const after = applyAtomicXiangqiMove(WIN, { from: 'd9', to: 'd10' });
    expect(after.status).toEqual({ type: 'finished', winner: 'red', reason: 'general-captured' });
    const view = getAtomicXiangqiPlayerView(after, 'red');
    expect(
      atomicXiangqiBlastMarkers(view)
        .map((m) => `${m.square}:${m.className}`)
        .sort(),
    ).toEqual(['d10:xq-marker--blast', 'e10:xq-marker--blast']);
  });

  it('keys a position by its ply so a repaint is not a new detonation', () => {
    if (!BLAST) throw new Error('fixture');
    const a = getAtomicXiangqiPlayerView(BLAST, 'red');
    const b = getAtomicXiangqiPlayerView(
      applyAtomicXiangqiMove(BLAST, { from: 'e3', to: 'e6' }),
      'red',
    );
    expect(atomicXiangqiBlastKey(a)).toBe(atomicXiangqiBlastKey(a));
    expect(atomicXiangqiBlastKey(a)).not.toBe(atomicXiangqiBlastKey(b));
  });
});
