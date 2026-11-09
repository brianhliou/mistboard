import type { BanqiPlayerView } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import {
  banqiTerminalSoundKey,
  classifyBanqiOpponentSound,
  soundForOwnBanqiMove,
} from './live-banqi-sound.js';

type Board = BanqiPlayerView['board'];

function view(opts: {
  board?: Board;
  perspective?: BanqiPlayerView['perspective'];
  status?: BanqiPlayerView['status'];
  moveNumber?: number;
}): BanqiPlayerView {
  return {
    id: 'banqi-sound-test',
    perspective: opts.perspective ?? 'red',
    board: opts.board ?? {},
    legalMoves: [],
    captured: [],
    status: opts.status ?? { type: 'playing', turn: 'red' },
    ply: 0,
    firstColor: 'red',
    moveNumber: opts.moveNumber ?? 1,
  };
}

const redChariot = { color: 'red', role: 'chariot', faceDown: false } as const;
const redCannon = { color: 'red', role: 'cannon', faceDown: false } as const;
const blackSoldier = { color: 'black', role: 'soldier', faceDown: false } as const;
const faceDown = { faceDown: true } as const;

describe('soundForOwnBanqiMove', () => {
  it('plays flip when revealing a face-down tile (a self-move)', () => {
    expect(soundForOwnBanqiMove(view({ board: { a1: faceDown } }), { from: 'a1', to: 'a1' })).toBe(
      'flip',
    );
  });

  it('plays move onto an empty square', () => {
    const v = view({ board: { a1: redChariot } });
    expect(soundForOwnBanqiMove(v, { from: 'a1', to: 'a2' })).toBe('move');
  });

  it('plays capture onto a revealed enemy', () => {
    const v = view({ board: { a1: redChariot, a2: blackSoldier } });
    expect(soundForOwnBanqiMove(v, { from: 'a1', to: 'a2' })).toBe('capture');
  });

  it('plays the cannon boom when your own cannon captures', () => {
    const v = view({ board: { a1: redCannon, a4: blackSoldier } });
    expect(soundForOwnBanqiMove(v, { from: 'a1', to: 'a4' })).toBe('cannon-capture');
  });
});

describe('banqiTerminalSoundKey', () => {
  it('returns null while playing', () => {
    expect(banqiTerminalSoundKey(view({}), 'red')).toBeNull();
  });

  it('returns a win key for the winning seat', () => {
    const v = view({
      status: { type: 'finished', winner: 'red', reason: 'stalemate' },
      moveNumber: 9,
    });
    expect(banqiTerminalSoundKey(v, 'red')).toBe('win:9');
  });

  it('returns a lose key for the losing seat', () => {
    const v = view({ status: { type: 'finished', winner: 'red', reason: 'stalemate' } });
    expect(banqiTerminalSoundKey(v, 'black')).toBe('lose:1');
  });

  it('returns a draw key for a finished game with no winner', () => {
    const v = view({ status: { type: 'finished', winner: null, reason: 'repetition' } });
    expect(banqiTerminalSoundKey(v, 'red')).toBe('draw:1');
  });

  it('returns null for spectators', () => {
    const v = view({ status: { type: 'finished', winner: 'red', reason: 'stalemate' } });
    expect(banqiTerminalSoundKey(v, 'spectator')).toBeNull();
  });
});

describe('classifyBanqiOpponentSound', () => {
  const playingAfterOpponent = { type: 'playing', turn: 'red' } as const; // back to my (red) turn
  const opponentToMove = { type: 'playing', turn: 'black' } as const;

  it('plays move after a completed opponent move with no flip or capture', () => {
    const prev = view({ board: { a1: redChariot }, status: opponentToMove });
    const next = view({ board: { a2: redChariot }, status: playingAfterOpponent });
    expect(classifyBanqiOpponentSound(prev, next, 'red')).toBe('move');
  });

  it('plays capture when our revealed-piece count drops', () => {
    const prev = view({ board: { a1: redChariot }, status: opponentToMove });
    const next = view({ board: {}, status: playingAfterOpponent });
    expect(classifyBanqiOpponentSound(prev, next, 'red')).toBe('capture');
  });

  it.each(['red', 'black'] as const)('uses capture for both players when %s captures', (color) => {
    const victim = color === 'red' ? 'black' : 'red';
    const mover = { ...redChariot, color };
    const target = { ...blackSoldier, color: victim } as const;
    const board = { a1: mover, a2: target, b1: faceDown };
    const status = { type: 'playing', turn: color } as const;
    const ownView = view({ board, status, perspective: color });
    const prev = view({ board, status, perspective: victim });
    const next = view({
      board: { a2: mover, b1: faceDown },
      status: { type: 'playing', turn: victim },
      perspective: victim,
    });

    expect(soundForOwnBanqiMove(ownView, { from: 'a1', to: 'a2' })).toBe('capture');
    expect(classifyBanqiOpponentSound(prev, next, victim)).toBe('capture');
  });

  it('plays flip when the opponent turns a face-down tile face-up', () => {
    const prev = view({ board: { a1: faceDown }, status: opponentToMove });
    const next = view({ board: { a1: blackSoldier }, status: playingAfterOpponent });
    expect(classifyBanqiOpponentSound(prev, next, 'red')).toBe('flip');
  });

  it('does not spuriously flip when a face-down tile stays face-down', () => {
    const prev = view({ board: { a1: redChariot, b1: faceDown }, status: opponentToMove });
    const next = view({ board: { a2: redChariot, b1: faceDown }, status: playingAfterOpponent });
    expect(classifyBanqiOpponentSound(prev, next, 'red')).toBe('move');
  });

  it('returns null for our own move', () => {
    const prev = view({ status: { type: 'playing', turn: 'red' } });
    const next = view({ status: { type: 'playing', turn: 'black' } });
    expect(classifyBanqiOpponentSound(prev, next, 'red')).toBeNull();
  });

  it('returns null when the opponent move is not completed yet', () => {
    const prev = view({ status: opponentToMove });
    const next = view({ status: opponentToMove });
    expect(classifyBanqiOpponentSound(prev, next, 'red')).toBeNull();
  });

  it('returns null for spectators', () => {
    const prev = view({ status: opponentToMove });
    const next = view({ status: playingAfterOpponent });
    expect(classifyBanqiOpponentSound(prev, next, 'spectator')).toBeNull();
  });
});
