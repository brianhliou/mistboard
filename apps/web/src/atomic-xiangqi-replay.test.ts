import { describe, expect, it } from 'vitest';
import { replayAtomicXiangqiNotation } from './atomic-xiangqi-replay.js';

// The rules page's sample game (study dPKhvJKb, "Win 8"): the shortest of the
// engine games, ending with a chariot taking the advisor beside Red's general.
const SAMPLE =
  'g1e3 b10c8 h3h5 c7c6 b3b7 c8d6 d1e2 a10a9 i1i3 d6f5 e1d1 i7i6 h5h2 f5g3 i3h3 g3h1 a4a5 h10i8 i4i5 i6i5 h3h7 i8h6 e4e5 a9d9 b7d7 d9f9 d7d8 f9f4 a1a3 b8b3 d8d4 i10i2 a5a6 h8d8 d4e4 b3b9 h7h8 h6g8 h8h9 f4f9 e2f3 b9d9 d1e1 i2f2 e4f4 f2f1';

describe('atomic xiangqi replay', () => {
  it('replays the sample game through the kernel and ends it by explosion', () => {
    const { moves, states, labels } = replayAtomicXiangqiNotation(SAMPLE);
    expect(moves).toHaveLength(46);
    expect(states).toHaveLength(47);
    expect(labels).toHaveLength(46);
    const last = states[46]!;
    expect(last.status.type).toBe('finished');
    if (last.status.type === 'finished') {
      expect(last.status.winner).toBe('black');
      expect(last.status.reason).toBe('general-captured');
    }
  });

  it('removes the blast victims: 16…Hxh1 takes the cannon on h2 with the horse', () => {
    const { states } = replayAtomicXiangqiNotation(SAMPLE);
    const before = states[15]!;
    const after = states[16]!;
    expect(before.board.h2?.role).toBe('cannon');
    expect(before.board.h1?.role).toBe('horse');
    expect(after.board.h1).toBeUndefined();
    expect(after.board.h2).toBeUndefined();
    expect(after.lastBlast.map((v) => v.square).sort()).toEqual(['h1', 'h2']);
  });

  it('refuses a malformed or illegal token loudly rather than stalling the board', () => {
    expect(() => replayAtomicXiangqiNotation('g1e3 zz9')).toThrow(/bad token "zz9" at ply 2/);
    expect(() => replayAtomicXiangqiNotation('g1e3 e1e2')).toThrow(/illegal move "e1e2" at ply 2/);
  });
});
