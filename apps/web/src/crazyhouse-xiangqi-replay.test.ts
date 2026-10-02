import { isCrazyhouseXiangqiDropMove, isCrazyhouseXiangqiGeneralInCheck } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { replayCrazyhouseXiangqiNotation } from './crazyhouse-xiangqi-replay.js';
import { CRAZYHOUSE_XIANGQI_SAMPLE_GAME_MOVES } from './crazyhouse-xiangqi-sample-game.js';

// The rules page's caption names these moments by move number; the kernel
// has to agree with every one of them.
describe('Crazyhouse Xiangqi replay notation', () => {
  const replay = replayCrazyhouseXiangqiNotation(CRAZYHOUSE_XIANGQI_SAMPLE_GAME_MOVES);
  // Ply n (1-based) is move ceil(n/2); Red's move m is ply 2m-1, Black's 2m.
  const red = (move: number) => replay.moves[2 * move - 2]!;
  const black = (move: number) => replay.moves[2 * move - 1]!;
  const checksAfter = (ply: number) => {
    const state = replay.states[ply]!;
    return isCrazyhouseXiangqiGeneralInCheck(state.board, ply % 2 === 1 ? 'black' : 'red');
  };

  it('replays the sample game through the kernel to Red’s mate on move 49', () => {
    expect(replay.moves).toHaveLength(97);
    expect(replay.states).toHaveLength(98);
    expect(replay.moves.filter(isCrazyhouseXiangqiDropMove)).toHaveLength(28);
    expect(replay.states.at(-1)?.status).toMatchObject({
      type: 'finished',
      winner: 'red',
      reason: 'checkmate',
    });
    expect(red(49)).toEqual({ drop: 'soldier', to: 'e9' });
  });

  it('has the moments the caption names', () => {
    // Move 6: Red drops an advisor on d4, outside the palace.
    expect(red(6)).toEqual({ drop: 'advisor', to: 'd4' });
    // Move 18: Black drops an elephant on a10, a corner no xiangqi elephant reaches.
    expect(black(18)).toEqual({ drop: 'elephant', to: 'a10' });
    // Move 31: Red drops a cannon on e6 with check.
    expect(red(31)).toEqual({ drop: 'cannon', to: 'e6' });
    expect(checksAfter(2 * 31 - 1)).toBe(true);
  });

  it('gives Red seven checks by drop, the last of them mate', () => {
    const redDropChecks = replay.moves
      .map((move, i) => ({ move, ply: i + 1 }))
      .filter(({ move, ply }) => ply % 2 === 1 && isCrazyhouseXiangqiDropMove(move))
      .filter(({ ply }) => checksAfter(ply))
      .map(({ ply }) => (ply + 1) / 2);
    expect(redDropChecks).toEqual([31, 38, 39, 40, 41, 47, 49]);
  });
});
