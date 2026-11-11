import { describe, expect, it } from 'vitest';
import {
  classifyXiangqiOpponentSound,
  soundForOwnXiangqiMove,
  type XiangqiSoundView,
  xiangqiTerminalSoundKey,
} from './live-xiangqi-sound.js';

function view(opts: Partial<XiangqiSoundView> = {}): XiangqiSoundView {
  return {
    board: {},
    perspective: 'red',
    status: { type: 'playing', turn: 'red' },
    moveNumber: 1,
    ...opts,
  };
}

const redChariot = { color: 'red', role: 'chariot' } as const;
const blackSoldier = { color: 'black', role: 'soldier' } as const;
const opponentToMove = { type: 'playing', turn: 'black' } as const;

describe('Xiangqi capture cues', () => {
  it.each(['red', 'black'] as const)('uses capture for both players when %s captures', (color) => {
    const victim = color === 'red' ? 'black' : 'red';
    const mover = { ...redChariot, color };
    const target = { ...blackSoldier, color: victim } as const;
    const board = { a1: mover, a2: target };
    const status = { type: 'playing', turn: color } as const;
    const ownView = view({ board, status, perspective: color });
    const prev = view({ board, status, perspective: victim });
    const next = view({
      board: { a2: mover },
      status: { type: 'playing', turn: victim },
      perspective: victim,
    });

    expect(soundForOwnXiangqiMove(ownView, { from: 'a1', to: 'a2' })).toBe('capture');
    expect(classifyXiangqiOpponentSound(prev, next, victim)).toBe('capture');
  });

  it('keeps the own cannon and general capture cues', () => {
    const cannon = { color: 'red', role: 'cannon' } as const;
    const general = { color: 'black', role: 'general' } as const;
    expect(
      soundForOwnXiangqiMove(view({ board: { a1: cannon, a3: blackSoldier } }), {
        from: 'a1',
        to: 'a3',
      }),
    ).toBe('cannon-capture');
    expect(
      soundForOwnXiangqiMove(view({ board: { a1: redChariot, a2: general } }), {
        from: 'a1',
        to: 'a2',
      }),
    ).toBe('king-capture');
  });

  it('keeps quiet moves distinct from captures', () => {
    const prev = view({ board: { a1: redChariot, a2: blackSoldier }, status: opponentToMove });
    const next = view({ board: { a1: redChariot, a3: blackSoldier } });
    expect(soundForOwnXiangqiMove(prev, { from: 'a2', to: 'a3' })).toBe('move');
    expect(classifyXiangqiOpponentSound(prev, next, 'red')).toBe('move');
  });

  it('suppresses own moves, incomplete snapshots, spectators and reconnects', () => {
    const prev = view({ board: { a1: redChariot }, status: opponentToMove });
    const next = view();
    expect(classifyXiangqiOpponentSound(next, prev, 'red')).toBeNull();
    expect(classifyXiangqiOpponentSound(prev, prev, 'red')).toBeNull();
    expect(classifyXiangqiOpponentSound(prev, next, 'spectator')).toBeNull();
    expect(classifyXiangqiOpponentSound(prev, next, null)).toBeNull();
    expect(classifyXiangqiOpponentSound(null, next, 'red')).toBeNull();
    expect(classifyXiangqiOpponentSound(prev, null, 'red')).toBeNull();
  });

  it('keeps the terminal result keyed by seat', () => {
    const finished = view({
      status: { type: 'finished', winner: 'black', reason: 'general-captured' },
      moveNumber: 12,
    });
    expect(xiangqiTerminalSoundKey(finished, 'red')).toBe('lose:12');
    expect(xiangqiTerminalSoundKey(finished, 'black')).toBe('win:12');
    expect(xiangqiTerminalSoundKey(finished, 'spectator')).toBeNull();
    expect(classifyXiangqiOpponentSound(finished, finished, 'red')).toBeNull();
  });
});
