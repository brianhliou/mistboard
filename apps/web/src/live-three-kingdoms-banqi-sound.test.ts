import { describe, expect, it } from 'vitest';
import type { ThreeKingdomsBanqiWireView } from './live-three-kingdoms-banqi.js';
import { classifyTkOpponentSound, tkTerminalSoundKey } from './live-three-kingdoms-banqi-sound.js';

type View = ThreeKingdomsBanqiWireView;

function view(opts: {
  board?: View['board'];
  status?: View['status'];
  firstColor?: View['firstColor'];
  moveNumber?: number;
}): View {
  return {
    id: 'tk-sound-test',
    perspective: 'red',
    board: opts.board ?? {},
    status: opts.status ?? { type: 'playing', turn: 'red' },
    ply: 0,
    moveNumber: opts.moveNumber ?? 1,
    // Seat red flipped first and drew black: seat red plays the black ink.
    firstColor: opts.firstColor === undefined ? 'black' : opts.firstColor,
    scores: { red: 0, black: 0 },
    noProgressClock: 0,
    captured: [],
    legalMoves: [],
  };
}

const down = { faceDown: true } as const;
const blackHorse = { faceDown: false, color: 'black', role: 'horse' } as const;
const redChariot = { faceDown: false, color: 'red', role: 'chariot' } as const;
const opponentToMove = { type: 'playing', turn: 'black' } as const;
const myTurn = { type: 'playing', turn: 'red' } as const;

describe('classifyTkOpponentSound', () => {
  it('plays flip when the opponent turns a tile over', () => {
    const prev = view({ board: { a1: down }, status: opponentToMove });
    const next = view({ board: { a1: redChariot }, status: myTurn });
    expect(classifyTkOpponentSound(prev, next, 'red')).toBe('flip');
  });

  // Seat red plays black here, so a black piece gone is a capture of mine;
  // reading the seat name as the colour would miss it.
  it('plays capture when one of my ink is taken', () => {
    const prev = view({ board: { a1: redChariot, a2: blackHorse }, status: opponentToMove });
    const next = view({ board: { a2: redChariot }, status: myTurn });
    expect(classifyTkOpponentSound(prev, next, 'red')).toBe('capture');
  });

  it('plays move for a plain opponent move', () => {
    const prev = view({ board: { a1: redChariot }, status: opponentToMove });
    const next = view({ board: { a2: redChariot }, status: myTurn });
    expect(classifyTkOpponentSound(prev, next, 'red')).toBe('move');
  });

  it('stays quiet on my own move and for spectators', () => {
    const prev = view({ board: { a1: blackHorse }, status: myTurn });
    const next = view({ board: { a2: blackHorse }, status: opponentToMove });
    expect(classifyTkOpponentSound(prev, next, 'red')).toBeNull();
    expect(classifyTkOpponentSound(prev, next, 'spectator')).toBeNull();
  });
});

describe('tkTerminalSoundKey', () => {
  const finished = (winner: 'red' | 'black' | null) =>
    view({ status: { type: 'finished', winner, reason: 'score' }, moveNumber: 30 });

  it('keys win, lose and draw by seat', () => {
    expect(tkTerminalSoundKey(finished('red'), 'red')).toBe('win:30');
    expect(tkTerminalSoundKey(finished('red'), 'black')).toBe('lose:30');
    expect(tkTerminalSoundKey(finished(null), 'red')).toBe('draw:30');
  });

  it('is null while playing and for spectators', () => {
    expect(tkTerminalSoundKey(view({}), 'red')).toBeNull();
    expect(tkTerminalSoundKey(finished('red'), 'spectator')).toBeNull();
  });
});
