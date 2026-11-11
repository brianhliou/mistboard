import type { JungleFlipPlayerView } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import {
  classifyJungleFlipOpponentSound,
  jungleFlipTerminalSoundKey,
  soundForOwnJungleFlipMove,
} from './live-jungle-flip-sound.js';

type Board = JungleFlipPlayerView['board'];
const faceDown = { faceDown: true } as const;

function view(opts: {
  perspective?: 'red' | 'black';
  board?: Board;
  status?: JungleFlipPlayerView['status'];
  firstColor?: 'red' | 'black' | null;
  moveNumber?: number;
  ply?: number;
}): JungleFlipPlayerView {
  return {
    id: 'v',
    perspective: opts.perspective ?? 'red',
    board: opts.board ?? {},
    legalMoves: [],
    captured: [],
    status: opts.status ?? { type: 'playing', turn: 'red' },
    ply: opts.ply ?? 0,
    firstColor: opts.firstColor ?? null,
    moveNumber: opts.moveNumber ?? 1,
  };
}

describe('soundForOwnJungleFlipMove', () => {
  it('plays flip for a self-move (face-down tile turned over)', () => {
    expect(soundForOwnJungleFlipMove(view({}), { from: 'b2', to: 'b2' })).toBe('flip');
  });

  it('plays move onto an empty square', () => {
    const v = view({ board: { a1: { color: 'red', role: 'lion', faceDown: false } } });
    expect(soundForOwnJungleFlipMove(v, { from: 'a1', to: 'a2' })).toBe('move');
  });

  it('plays capture onto a revealed enemy animal', () => {
    const v = view({
      board: {
        a1: { color: 'red', role: 'lion', faceDown: false },
        a2: { color: 'black', role: 'cat', faceDown: false },
      },
    });
    expect(soundForOwnJungleFlipMove(v, { from: 'a1', to: 'a2' })).toBe('capture');
  });
});

describe('jungleFlipTerminalSoundKey', () => {
  it('returns null while playing', () => {
    expect(jungleFlipTerminalSoundKey(view({}), 'red')).toBeNull();
  });

  it('returns a win key for the winner', () => {
    const v = view({
      status: { type: 'finished', winner: 'red', reason: 'stalemate' },
      moveNumber: 20,
    });
    expect(jungleFlipTerminalSoundKey(v, 'red')).toBe('win:20');
  });

  it('returns a lose key for the loser', () => {
    const v = view({ status: { type: 'finished', winner: 'black', reason: 'stalemate' } });
    expect(jungleFlipTerminalSoundKey(v, 'red')).toBe('lose:1');
  });

  it('returns a draw key for a winnerless finish', () => {
    const v = view({ status: { type: 'finished', winner: null, reason: 'no-progress' } });
    expect(jungleFlipTerminalSoundKey(v, 'red')).toBe('draw:1');
  });

  it('returns null for a spectator', () => {
    const v = view({ status: { type: 'finished', winner: 'red', reason: 'stalemate' } });
    expect(jungleFlipTerminalSoundKey(v, 'spectator')).toBeNull();
  });
});

describe('classifyJungleFlipOpponentSound', () => {
  const playingBlack: JungleFlipPlayerView['status'] = { type: 'playing', turn: 'black' };
  const playingRed: JungleFlipPlayerView['status'] = { type: 'playing', turn: 'red' };
  // Red seat owns the firstColor ink once bound.
  const myAnimal = { color: 'red', role: 'wolf', faceDown: false } as const;

  it('plays flip when the opponent turns a face-down tile over', () => {
    const prev = view({ board: { a1: faceDown }, status: playingBlack, firstColor: 'red' });
    const next = view({
      board: { a1: { color: 'black', role: 'dog', faceDown: false } },
      status: playingRed,
      firstColor: 'red',
    });
    expect(classifyJungleFlipOpponentSound(prev, next, 'red')).toBe('flip');
  });

  it('plays capture when our revealed-piece count drops', () => {
    const prev = view({ board: { a1: myAnimal }, status: playingBlack, firstColor: 'red' });
    const next = view({ board: {}, status: playingRed, firstColor: 'red' });
    expect(classifyJungleFlipOpponentSound(prev, next, 'red')).toBe('capture');
  });

  it('plays move after a plain opponent board move', () => {
    const prev = view({ board: { a1: myAnimal }, status: playingBlack, firstColor: 'red' });
    const next = view({ board: { a1: myAnimal }, status: playingRed, firstColor: 'red' });
    expect(classifyJungleFlipOpponentSound(prev, next, 'red')).toBe('move');
  });

  it('does not read face-down identities: a persistent face-down enemy tile stays silent', () => {
    // A face-down tile present in both snapshots must never be counted or revealed.
    const prev = view({
      board: { a1: myAnimal, c3: faceDown },
      status: playingBlack,
      firstColor: 'red',
    });
    const next = view({
      board: { a1: myAnimal, c3: faceDown },
      status: playingRed,
      firstColor: 'red',
    });
    expect(classifyJungleFlipOpponentSound(prev, next, 'red')).toBe('move');
  });

  it('returns null for our own move (it was our turn before)', () => {
    const prev = view({ status: playingRed });
    const next = view({ status: playingBlack });
    expect(classifyJungleFlipOpponentSound(prev, next, 'red')).toBeNull();
  });

  it('returns null for a spectator', () => {
    const prev = view({ status: playingBlack });
    const next = view({ status: playingRed });
    expect(classifyJungleFlipOpponentSound(prev, next, 'spectator')).toBeNull();
  });
});
