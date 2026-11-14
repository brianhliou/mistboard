import {
  applyFFQBanqiMove,
  createInitialFFQBanqiState,
  type FFQBanqiPlayerView,
  getFFQBanqiPlayerView,
} from '@mistboard/game';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  maybePlayFFQBanqiSound,
  resetFFQBanqiSoundState,
  soundForOwnFFQBanqiMove,
} from './live-ffq-banqi-sound.js';
import { playSound, playTerminalPlan } from './live-sound.js';

vi.mock('./live-sound.js', () => ({ playSound: vi.fn(), playTerminalPlan: vi.fn() }));

function state() {
  const game = createInitialFFQBanqiState('ffq-sound-test', 7);
  game.board.fill(null);
  game.board[0] = { color: 'red', role: 'chariot', faceDown: false };
  game.board[8] = { color: 'red', role: 'soldier', faceDown: false };
  game.board[23] = { color: 'black', role: 'soldier', faceDown: false };
  game.board[31] = { color: 'black', role: 'chariot', faceDown: false };
  return game;
}

function capture(covered: boolean) {
  const game = state();
  const move = { from: 0, to: covered ? 2 : 1 };
  if (covered) {
    game.board[0] = { color: 'red', role: 'cannon', faceDown: false };
    game.board[1] = { color: 'black', role: 'soldier', faceDown: false };
  }
  game.board[move.to] = { color: 'black', role: 'horse', faceDown: covered };
  const before = getFFQBanqiPlayerView(game, 'observer');
  const after = getFFQBanqiPlayerView(applyFFQBanqiMove(game, move), 'observer');
  return { before, after, move };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFFQBanqiSoundState();
});

describe('Fanfanqi sound policy', () => {
  it('classifies an own move and flip using only the masked view', () => {
    const game = state();
    game.board[1] = { color: 'black', role: 'horse', faceDown: true };
    const view = getFFQBanqiPlayerView(game, 'red');
    expect(view.board[1]).toEqual({ faceDown: true });
    expect(soundForOwnFFQBanqiMove(view, { from: 0, to: 4 })).toBe('move');
    expect(soundForOwnFFQBanqiMove(view, { from: 1, to: 1 })).toBe('flip');
  });

  it.each([false, true])('sounds a capture with covered victim = %s', (covered) => {
    const { before, after, move } = capture(covered);
    expect(soundForOwnFFQBanqiMove(before, move)).toBe('capture');
    expect(after.captured).toHaveLength(before.captured.length + 1);
    maybePlayFFQBanqiSound(before, 'black');
    maybePlayFFQBanqiSound(after, 'black');
    expect(playSound).toHaveBeenCalledExactlyOnceWith('capture');
  });

  it('sounds a cannon capture of its own covered ink for both viewers', () => {
    const game = state();
    game.board[0] = { color: 'red', role: 'cannon', faceDown: false };
    game.board[1] = { color: 'black', role: 'soldier', faceDown: false };
    game.board[2] = { color: 'red', role: 'horse', faceDown: true };
    const next = applyFFQBanqiMove(game, { from: 0, to: 2 });
    for (const seat of ['black', 'spectator'] as const) {
      resetFFQBanqiSoundState();
      maybePlayFFQBanqiSound(getFFQBanqiPlayerView(game, 'observer'), seat);
      maybePlayFFQBanqiSound(getFFQBanqiPlayerView(next, 'observer'), seat);
    }
    expect(vi.mocked(playSound).mock.calls).toEqual([['capture'], ['capture']]);
  });

  it('sounds an opponent flip without binding the seat to the revealed colour', () => {
    const game = state();
    game.status = { type: 'playing', turn: 'black' };
    game.board[30] = { color: 'red', role: 'horse', faceDown: true };
    const next = applyFFQBanqiMove(game, { from: 30, to: 30 });
    maybePlayFFQBanqiSound(getFFQBanqiPlayerView(game, 'red'), 'red');
    maybePlayFFQBanqiSound(getFFQBanqiPlayerView(next, 'red'), 'red');
    expect(playSound).toHaveBeenCalledExactlyOnceWith('flip');
  });

  it('sounds an opponent move once and ignores the same reconnect view', () => {
    const game = state();
    const next = applyFFQBanqiMove(game, { from: 0, to: 1 });
    const view = getFFQBanqiPlayerView(next, 'black');
    maybePlayFFQBanqiSound(getFFQBanqiPlayerView(game, 'black'), 'black');
    maybePlayFFQBanqiSound(view, 'black');
    maybePlayFFQBanqiSound(structuredClone(view), 'black');
    expect(playSound).toHaveBeenCalledExactlyOnceWith('move');
  });

  it("does not duplicate a seated viewer's own send sound", () => {
    const game = state();
    const next = applyFFQBanqiMove(game, { from: 0, to: 1 });
    maybePlayFFQBanqiSound(getFFQBanqiPlayerView(game, 'red'), 'red');
    maybePlayFFQBanqiSound(getFFQBanqiPlayerView(next, 'red'), 'red');
    expect(playSound).not.toHaveBeenCalled();
  });

  it('lets a spectator hear both seats', () => {
    const first = state();
    const second = applyFFQBanqiMove(first, { from: 0, to: 1 });
    const third = applyFFQBanqiMove(second, { from: 31, to: 30 });
    for (const game of [first, second, third]) {
      maybePlayFFQBanqiSound(getFFQBanqiPlayerView(game, 'observer'), 'spectator');
    }
    expect(vi.mocked(playSound).mock.calls).toEqual([['move'], ['move']]);
  });

  it.each([
    ['red', 'red', 'win'],
    ['red', 'black', 'lose'],
    [null, 'red', 'draw'],
    ['red', 'spectator', 'draw'],
    ['black', 'spectator', 'draw'],
    [null, 'spectator', 'draw'],
  ] as const)('sounds winner %s for %s as %s once', (winner, seat, result) => {
    const view = getFFQBanqiPlayerView(state(), 'observer');
    maybePlayFFQBanqiSound(view, seat);
    const finished: FFQBanqiPlayerView = {
      ...view,
      status: { type: 'finished', winner, reason: winner ? 'resignation' : 'agreement' },
    };
    maybePlayFFQBanqiSound(finished, seat);
    maybePlayFFQBanqiSound(structuredClone(finished), seat);
    expect(playTerminalPlan).toHaveBeenCalledExactlyOnceWith(result, null);
    expect(playSound).not.toHaveBeenCalled();
  });

  it('prioritizes the terminal plan when a capture ends the game', () => {
    const { before, after } = capture(true);
    after.status = { type: 'finished', winner: 'red', reason: 'hp' };
    maybePlayFFQBanqiSound(before, 'black');
    maybePlayFFQBanqiSound(after, 'black');
    expect(playTerminalPlan).toHaveBeenCalledExactlyOnceWith('lose', null);
    expect(playSound).not.toHaveBeenCalled();
  });

  it('stays silent on a finished initial view and an aborted game', () => {
    const view = getFFQBanqiPlayerView(state(), 'observer');
    const finished: FFQBanqiPlayerView = {
      ...view,
      status: { type: 'finished', winner: 'red', reason: 'resignation' },
    };
    maybePlayFFQBanqiSound(finished, 'red');
    maybePlayFFQBanqiSound(structuredClone(finished), 'red');
    resetFFQBanqiSoundState();
    maybePlayFFQBanqiSound(view, 'red');
    maybePlayFFQBanqiSound({ ...view, status: { type: 'aborted', reason: 'user-abort' } }, 'red');
    expect(playTerminalPlan).not.toHaveBeenCalled();
    expect(playSound).not.toHaveBeenCalled();
  });

  it('resets the move baseline and terminal guard for another room', () => {
    const game = state();
    const before = getFFQBanqiPlayerView(game, 'black');
    const after = getFFQBanqiPlayerView(applyFFQBanqiMove(game, { from: 0, to: 1 }), 'black');
    const finished: FFQBanqiPlayerView = {
      ...after,
      status: { type: 'finished', winner: 'red', reason: 'resignation' },
    };
    for (let room = 0; room < 2; room += 1) {
      resetFFQBanqiSoundState();
      maybePlayFFQBanqiSound(before, 'black');
      maybePlayFFQBanqiSound(after, 'black');
      maybePlayFFQBanqiSound(finished, 'black');
    }
    expect(playSound).toHaveBeenCalledTimes(2);
    expect(playTerminalPlan).toHaveBeenCalledTimes(2);
  });
});
