import type { JieqiGameStatus, JieqiMove, JieqiPieceRole, JieqiSquare } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { classifyJieqiOpponentSound, soundForOwnJieqiMove } from './live-jieqi-sound.js';

// The module's view param is structural; build the minimal shape it reads.
type Entry =
  | { color: 'red' | 'black'; role: JieqiPieceRole; faceDown: false }
  | { color: 'red' | 'black'; faceDown: true };
type View = {
  board: Partial<Record<JieqiSquare, Entry>>;
  perspective: 'red' | 'black';
  status: JieqiGameStatus;
  moveNumber: number;
  lastMove?: JieqiMove;
};

function view(opts: {
  board?: View['board'];
  perspective?: 'red' | 'black';
  status?: JieqiGameStatus;
  lastMove?: JieqiMove;
}): View {
  return {
    board: opts.board ?? {},
    perspective: opts.perspective ?? 'red',
    status: opts.status ?? { type: 'playing', turn: 'red' },
    moveNumber: 1,
    lastMove: opts.lastMove,
  };
}

const redChariot = { color: 'red', role: 'chariot', faceDown: false } as const;
const redCannon = { color: 'red', role: 'cannon', faceDown: false } as const;
const redFaceDown = { color: 'red', faceDown: true } as const;
const blackSoldier = { color: 'black', role: 'soldier', faceDown: false } as const;
const blackGeneral = { color: 'black', role: 'general', faceDown: false } as const;
const blackFaceDown = { color: 'black', faceDown: true } as const;

describe('soundForOwnJieqiMove', () => {
  it('plays flip when moving one of your own face-down pieces (it reveals)', () => {
    const v = view({ board: { a1: redFaceDown } });
    expect(soundForOwnJieqiMove(v, { from: 'a1', to: 'a2' })).toBe('flip');
  });

  it('plays move with a revealed piece onto an empty square', () => {
    const v = view({ board: { a1: redChariot } });
    expect(soundForOwnJieqiMove(v, { from: 'a1', to: 'a2' })).toBe('move');
  });

  it('plays capture onto a revealed enemy', () => {
    const v = view({ board: { a1: redChariot, a2: blackSoldier } });
    expect(soundForOwnJieqiMove(v, { from: 'a1', to: 'a2' })).toBe('capture');
  });

  it('plays king-capture onto a revealed enemy general', () => {
    const v = view({ board: { a1: redChariot, a2: blackGeneral } });
    expect(soundForOwnJieqiMove(v, { from: 'a1', to: 'a2' })).toBe('king-capture');
  });

  it('plays only capture onto a FACE-DOWN enemy (its role is unknown pre-capture)', () => {
    const v = view({ board: { a1: redChariot, a2: blackFaceDown } });
    expect(soundForOwnJieqiMove(v, { from: 'a1', to: 'a2' })).toBe('capture');
  });

  it('plays the cannon boom when a revealed cannon captures', () => {
    const v = view({ board: { a1: redCannon, a2: blackSoldier } });
    expect(soundForOwnJieqiMove(v, { from: 'a1', to: 'a2' })).toBe('cannon-capture');
  });
});

describe('classifyJieqiOpponentSound', () => {
  const afterOpponent = { type: 'playing', turn: 'red' } as const;
  const opponentToMove = { type: 'playing', turn: 'black' } as const;

  it('plays move after a completed opponent move with no reveal or capture', () => {
    const prev = view({ board: { a1: redChariot, e5: blackSoldier }, status: opponentToMove });
    const next = view({
      board: { a1: redChariot, e6: blackSoldier },
      status: afterOpponent,
      lastMove: { from: 'e5', to: 'e6' },
    });
    expect(classifyJieqiOpponentSound(prev, next, 'red')).toBe('move');
  });

  it('plays flip when the opponent moves a face-down piece (a public reveal)', () => {
    const prev = view({ board: { a1: redChariot, e5: blackFaceDown }, status: opponentToMove });
    const next = view({
      board: { a1: redChariot, e6: blackSoldier },
      status: afterOpponent,
      lastMove: { from: 'e5', to: 'e6' },
    });
    expect(classifyJieqiOpponentSound(prev, next, 'red')).toBe('flip');
  });

  it('plays capture when the opponent takes our revealed piece', () => {
    const prev = view({ board: { a1: redChariot, e5: blackSoldier }, status: opponentToMove });
    const next = view({
      board: { a1: blackSoldier },
      status: afterOpponent,
      lastMove: { from: 'e5', to: 'a1' },
    });
    expect(classifyJieqiOpponentSound(prev, next, 'red')).toBe('capture');
  });

  it.each(['red', 'black'] as const)('uses capture for both players when %s captures', (color) => {
    const victim = color === 'red' ? 'black' : 'red';
    const mover = { ...redChariot, color };
    const target = { ...blackSoldier, color: victim } as const;
    const board = { a1: mover, a2: target, e5: blackFaceDown };
    const status = { type: 'playing', turn: color } as const;
    const ownView = view({ board, status, perspective: color });
    const prev = view({ board, status, perspective: victim });
    const next = view({
      board: { a2: mover, e5: blackFaceDown },
      status: { type: 'playing', turn: victim },
      perspective: victim,
      lastMove: { from: 'a1', to: 'a2' },
    });

    expect(soundForOwnJieqiMove(ownView, { from: 'a1', to: 'a2' })).toBe('capture');
    expect(classifyJieqiOpponentSound(prev, next, victim)).toBe('capture');
  });

  // The leak guard: when the opponent captures our FACE-DOWN piece, its identity
  // reveals only to the capturer. To us it is a plain `capture` -- never a flip
  // or anything role-specific -- so audio cannot leak what we were not shown.
  it('plays capture (not flip) when the opponent captures our FACE-DOWN piece', () => {
    const prev = view({ board: { a1: redFaceDown, e5: blackSoldier }, status: opponentToMove });
    const next = view({
      board: { a1: blackSoldier },
      status: afterOpponent,
      lastMove: { from: 'e5', to: 'a1' },
    });
    expect(classifyJieqiOpponentSound(prev, next, 'red')).toBe('capture');
  });

  it('prioritizes capture when a face-down attacker reveals while taking a face-down piece', () => {
    const prev = view({ board: { a1: redFaceDown, e5: blackFaceDown }, status: opponentToMove });
    const next = view({
      board: { a1: blackSoldier },
      status: afterOpponent,
      lastMove: { from: 'e5', to: 'a1' },
    });
    expect(classifyJieqiOpponentSound(prev, next, 'red')).toBe('capture');
  });

  it('returns null for our own move', () => {
    const prev = view({ status: { type: 'playing', turn: 'red' } });
    const next = view({ status: { type: 'playing', turn: 'black' } });
    expect(classifyJieqiOpponentSound(prev, next, 'red')).toBeNull();
  });

  it('returns null for spectators', () => {
    const prev = view({ status: opponentToMove });
    const next = view({ status: afterOpponent });
    expect(classifyJieqiOpponentSound(prev, next, 'spectator')).toBeNull();
  });
});
