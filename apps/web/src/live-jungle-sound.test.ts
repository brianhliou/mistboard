import type { JunglePlayerView } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import {
  classifyJungleOpponentSound,
  jungleTerminalSoundKey,
  soundForOwnJungleMove,
} from './live-jungle-sound.js';

type Board = JunglePlayerView['board'];

function view(opts: {
  perspective?: 'red' | 'black';
  board?: Board;
  status?: JunglePlayerView['status'];
  moveNumber?: number;
}): JunglePlayerView {
  return {
    id: 'v',
    perspective: opts.perspective ?? 'red',
    board: opts.board ?? {},
    visibleSquares: [],
    legalMoves: [],
    status: opts.status ?? { type: 'playing', turn: 'red' },
    moveNumber: opts.moveNumber ?? 1,
  };
}

describe('soundForOwnJungleMove', () => {
  const rat = { color: 'red', role: 'rat' } as const;

  it('plays move onto an empty square (den entry sounds via the terminal plan)', () => {
    const v = view({ board: { a1: rat } });
    expect(soundForOwnJungleMove(v, { from: 'a1', to: 'a2' })).toBe('move');
  });

  it('plays capture onto an enemy animal', () => {
    const v = view({
      board: { a1: { color: 'red', role: 'tiger' }, a2: { color: 'black', role: 'cat' } },
    });
    expect(soundForOwnJungleMove(v, { from: 'a1', to: 'a2' })).toBe('capture');
  });
});

describe('jungleTerminalSoundKey', () => {
  it('returns null while playing', () => {
    expect(jungleTerminalSoundKey(view({}), 'red')).toBeNull();
  });

  it('returns a win key when the viewer wins by reaching the den', () => {
    const v = view({
      status: { type: 'finished', winner: 'red', reason: 'den-entered' },
      moveNumber: 12,
    });
    expect(jungleTerminalSoundKey(v, 'red')).toBe('win:12');
  });

  it('returns a lose key when the opponent wins', () => {
    const v = view({ status: { type: 'finished', winner: 'black', reason: 'pieces-captured' } });
    expect(jungleTerminalSoundKey(v, 'red')).toBe('lose:1');
  });

  it('returns a draw key for a winnerless finish', () => {
    const v = view({ status: { type: 'finished', winner: null, reason: 'repetition' } });
    expect(jungleTerminalSoundKey(v, 'red')).toBe('draw:1');
  });

  it('returns null for a spectator', () => {
    const v = view({ status: { type: 'finished', winner: 'red', reason: 'den-entered' } });
    expect(jungleTerminalSoundKey(v, 'spectator')).toBeNull();
  });
});

describe('classifyJungleOpponentSound', () => {
  const myPiece = { color: 'red', role: 'wolf' } as const;
  const playingBlack: JunglePlayerView['status'] = { type: 'playing', turn: 'black' };
  const playingRed: JunglePlayerView['status'] = { type: 'playing', turn: 'red' };

  it('plays move after a completed opponent move with no captures', () => {
    const prev = view({ board: { a1: myPiece }, status: playingBlack });
    const next = view({ board: { a1: myPiece }, status: playingRed });
    expect(classifyJungleOpponentSound(prev, next, 'red')).toBe('move');
  });

  it('plays capture when our piece count drops (covers mutual-destruction trades)', () => {
    const prev = view({ board: { a1: myPiece }, status: playingBlack });
    const next = view({ board: {}, status: playingRed });
    expect(classifyJungleOpponentSound(prev, next, 'red')).toBe('capture');
  });

  it('returns null for our own move (it was our turn before)', () => {
    const prev = view({ status: playingRed });
    const next = view({ status: playingBlack });
    expect(classifyJungleOpponentSound(prev, next, 'red')).toBeNull();
  });

  it('returns null when the opponent move is not yet completed', () => {
    const prev = view({ status: playingBlack });
    const next = view({ status: playingBlack });
    expect(classifyJungleOpponentSound(prev, next, 'red')).toBeNull();
  });

  it('returns null for a spectator', () => {
    const prev = view({ status: playingBlack });
    const next = view({ status: playingRed });
    expect(classifyJungleOpponentSound(prev, next, 'spectator')).toBeNull();
  });
});
