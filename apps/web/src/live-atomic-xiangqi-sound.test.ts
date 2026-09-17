import type { XiangqiGameStatus, XiangqiPiece, XiangqiSquare } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import {
  classifyAtomicXiangqiOpponentSound,
  soundForOwnAtomicXiangqiMove,
} from './live-atomic-xiangqi-sound.js';

// The module's view param is structural; build the minimal shape it reads.
type View = {
  board: Partial<Record<XiangqiSquare, XiangqiPiece>>;
  perspective: 'red' | 'black';
  status: XiangqiGameStatus;
  moveNumber: number;
  lastBlast: readonly { square: XiangqiSquare; piece: XiangqiPiece }[];
};

function view(opts: {
  board?: View['board'];
  turn?: 'red' | 'black';
  blast?: View['lastBlast'];
}): View {
  return {
    board: opts.board ?? {},
    perspective: 'red',
    status: { type: 'playing', turn: opts.turn ?? 'red' },
    moveNumber: 1,
    lastBlast: opts.blast ?? [],
  };
}

const redChariot = { color: 'red', role: 'chariot' } as const;
const redCannon = { color: 'red', role: 'cannon' } as const;
const redSoldier = { color: 'red', role: 'soldier' } as const;
const blackHorse = { color: 'black', role: 'horse' } as const;
const blackGeneral = { color: 'black', role: 'general' } as const;

describe('soundForOwnAtomicXiangqiMove', () => {
  it('is the blast for an ordinary capture, since the capture explodes', () => {
    const v = view({ board: { e3: redChariot, e6: blackHorse } });
    expect(soundForOwnAtomicXiangqiMove(v, { from: 'e3', to: 'e6' })).toBe('blast');
  });

  it("keeps the cannon's slam: the one capture that does not explode", () => {
    const v = view({ board: { e2: redCannon, e4: redSoldier, e7: blackHorse } });
    expect(soundForOwnAtomicXiangqiMove(v, { from: 'e2', to: 'e7' })).toBe('cannon-capture');
  });

  it('keeps the terminal cue when the general itself is taken', () => {
    const v = view({ board: { e3: redChariot, e10: blackGeneral } });
    expect(soundForOwnAtomicXiangqiMove(v, { from: 'e3', to: 'e10' })).toBe('king-capture');
  });

  it('is a plain move onto an empty point', () => {
    const v = view({ board: { e3: redChariot } });
    expect(soundForOwnAtomicXiangqiMove(v, { from: 'e3', to: 'e5' })).toBe('move');
  });
});

describe('classifyAtomicXiangqiOpponentSound', () => {
  it('is the blast when the opponent’s move left an aftermath, even if it cost us nothing', () => {
    const prev = view({ board: { a1: redChariot, e6: blackHorse, d6: blackHorse }, turn: 'black' });
    // Black took its own neighbour's point: our count is unchanged, the point
    // beside the target was still cleared.
    const next = view({
      board: { a1: redChariot },
      turn: 'red',
      blast: [{ square: 'd6', piece: blackHorse }],
    });
    expect(classifyAtomicXiangqiOpponentSound(prev, next, 'red')).toBe('blast');
  });

  it("is 'captured' for the opponent's cannon shot, which has no aftermath", () => {
    const prev = view({ board: { a1: redChariot, e3: redSoldier }, turn: 'black' });
    const next = view({ board: { a1: redChariot }, turn: 'red' });
    expect(classifyAtomicXiangqiOpponentSound(prev, next, 'red')).toBe('captured');
  });

  it('stays silent for spectators, as standard xiangqi does', () => {
    const prev = view({ board: { e6: blackHorse }, turn: 'black' });
    const next = view({ board: {}, turn: 'red', blast: [{ square: 'e6', piece: blackHorse }] });
    expect(classifyAtomicXiangqiOpponentSound(prev, next, 'spectator')).toBeNull();
  });
});
