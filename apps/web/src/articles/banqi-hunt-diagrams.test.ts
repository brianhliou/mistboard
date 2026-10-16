import {
  applyBanqiMove,
  type BanqiDeal,
  type BanqiGameState,
  type BanqiMove,
  type BanqiSquare,
  createInitialBanqiState,
  getBanqiLegalMovesFrom,
  isBanqiLegalMove,
  LEGACY_BANQI_RULES,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { BANQI_CONVERSION_GAME, BANQI_GENERAL_HUNT_GAME } from '../banqi-engine-game.js';
import { BANQI_HUNT_STEPS, HUNT_CAPTURE_PLY, HUNT_LAST_PLY, HUNT_START_PLY, huntMove } from './banqi-hunt-diagrams.js';

function parse(moves: string): BanqiMove[] {
  return moves
    .trim()
    .split(/\s+/)
    .map((token) => ({ from: token.slice(0, 2) as BanqiSquare, to: token.slice(2, 4) as BanqiSquare }));
}

// Every state from 0 to the end, each move checked legal before it is applied
// (applyBanqiMove silently ignores an illegal one, which would let a figure drift).
function replay(game: { deal: BanqiDeal; moves: string }): BanqiGameState[] {
  let state = createInitialBanqiState('hunt-test', game.deal, LEGACY_BANQI_RULES);
  const states = [state];
  for (const move of parse(game.moves)) {
    expect(isBanqiLegalMove(state, move), `${move.from}${move.to} at action ${states.length - 1}`).toBe(true);
    state = applyBanqiMove(state, move);
    states.push(state);
  }
  return states;
}

function generalSquare(state: BanqiGameState, color: 'red' | 'black'): string | undefined {
  return Object.entries(state.board).find(
    ([, piece]) => piece && !piece.faceDown && piece.color === color && piece.role === 'general',
  )?.[0];
}

describe('MistyBanqi general-hunt game', () => {
  const states = replay(BANQI_GENERAL_HUNT_GAME);

  it('replays all 153 recorded actions legally to a finished game', () => {
    expect(states).toHaveLength(154);
    expect(states[153]!.status).toMatchObject({ type: 'finished', winner: 'red', reason: 'stalemate' });
    expect(states[152]!.status.type).not.toBe('finished');
  });

  it('MistyBanqi, the first seat, has the black pieces', () => {
    expect(states[153]!.firstColor).toBe('black');
  });

  it('walks the general into the corner, then a red soldier marches b4-b3-a3-a2-a1', () => {
    expect(generalSquare(states[HUNT_START_PLY]!, 'black')).toBe('b1');
    expect(huntMove(HUNT_START_PLY)).toEqual({ from: 'b1', to: 'a1' });
    expect(generalSquare(states[HUNT_START_PLY + 1]!, 'black')).toBe('a1');
    expect(states[HUNT_START_PLY]!.board.b4).toMatchObject({ color: 'red', role: 'soldier', faceDown: false });
    const soldierPath = [50, 52, 54, 56].map((ply) => huntMove(ply - 1));
    expect(soldierPath).toEqual([
      { from: 'b4', to: 'b3' },
      { from: 'b3', to: 'a3' },
      { from: 'a3', to: 'a2' },
      { from: 'a2', to: 'a1' },
    ]);
  });

  it('leaves the general on b1 with no legal move at the last frame', () => {
    const last = states[HUNT_LAST_PLY]!;
    expect(last.board.b1).toMatchObject({ color: 'black', role: 'general', faceDown: false });
    expect(last.board.a1).toMatchObject({ color: 'red', role: 'soldier', faceDown: false });
    expect(last.board.c1?.faceDown).toBe(true);
    expect(last.board.b2?.faceDown).toBe(true);
    // Even ply: the first seat (MistyBanqi, black) is to move.
    expect(HUNT_LAST_PLY % 2).toBe(0);
    expect(getBanqiLegalMovesFrom(last, 'b1')).toEqual([]);
  });

  it('keeps the general stuck on b1 until 85, when it takes a flipped advisor and is captured on 86', () => {
    for (let ply = HUNT_LAST_PLY; ply < HUNT_CAPTURE_PLY - 1; ply += 1) {
      expect(generalSquare(states[ply]!, 'black'), `action ${ply}`).toBe('b1');
    }
    expect(states[HUNT_CAPTURE_PLY - 2]!.board.b2).toMatchObject({ color: 'red', role: 'advisor', faceDown: false });
    expect(huntMove(HUNT_CAPTURE_PLY - 2)).toEqual({ from: 'b1', to: 'b2' });
    expect(generalSquare(states[HUNT_CAPTURE_PLY - 1]!, 'black')).toBe('b2');
    expect(generalSquare(states[HUNT_CAPTURE_PLY]!, 'black')).toBeUndefined();
    expect(states[HUNT_CAPTURE_PLY]!.board.b2).toMatchObject({ color: 'red', role: 'general' });
    expect(HUNT_CAPTURE_PLY - HUNT_LAST_PLY).toBe(28);
  });

  it('draws one frame per action from 44 to 58, the first and last narrated', () => {
    expect(BANQI_HUNT_STEPS).toHaveLength(HUNT_LAST_PLY - HUNT_START_PLY + 1);
    expect(BANQI_HUNT_STEPS[0]!.narrative).toContain('b1');
    expect(BANQI_HUNT_STEPS.at(-1)!.narrative).toContain('move 86');
    for (const step of BANQI_HUNT_STEPS) expect(step.svg()).toContain('<svg');
  });

  it('the conversion game still replays legally', () => {
    expect(replay(BANQI_CONVERSION_GAME).at(-1)!.status.type).toBe('finished');
  });
});
