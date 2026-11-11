import { describe, expect, it } from 'vitest';
import {
  classifyDarkXiangqiOpponentSound,
  darkXiangqiTerminalSoundKey,
  soundForOwnDarkXiangqiMove,
} from './live-dark-xiangqi-sound.js';

type View = NonNullable<Parameters<typeof classifyDarkXiangqiOpponentSound>[0]>;

function view(opts: Partial<View> = {}): View {
  return {
    board: {},
    perspective: 'red',
    status: { type: 'playing', turn: 'red' },
    moveNumber: 1,
    ...opts,
  };
}

const redChariot = { piece: { color: 'red', role: 'chariot' }, shrouded: false } as const;
const blackSoldier = { piece: { color: 'black', role: 'soldier' }, shrouded: false } as const;
const shroudedBlack = { color: 'black', shrouded: true } as const;
const opponentToMove = { type: 'playing', turn: 'black' } as const;

describe('Dark Xiangqi capture cues', () => {
  it.each(['red', 'black'] as const)(
    'plays capture when the %s seat loses a visible piece',
    (seat) => {
      const opponent = seat === 'red' ? 'black' : 'red';
      const own = { piece: { ...redChariot.piece, color: seat }, shrouded: false } as const;
      // The attacker is redacted in both snapshots; its role is never needed.
      const attacker = { color: opponent, shrouded: true } as const;
      const prev = view({
        board: { a1: own, a2: attacker },
        perspective: seat,
        status: { type: 'playing', turn: opponent },
      });
      const next = view({
        board: { a1: attacker },
        perspective: seat,
        status: { type: 'playing', turn: seat },
      });
      expect(classifyDarkXiangqiOpponentSound(prev, next, seat)).toBe('capture');
    },
  );

  it('does not mistake an enemy becoming shrouded for a capture', () => {
    const prev = view({ board: { a1: redChariot, a2: blackSoldier }, status: opponentToMove });
    const next = view({ board: { a1: redChariot, a3: shroudedBlack } });
    expect(classifyDarkXiangqiOpponentSound(prev, next, 'red')).toBe('move');
  });

  it('uses a plain own capture for an unknown target and keeps the cannon cue', () => {
    const cannon = { piece: { color: 'red', role: 'cannon' }, shrouded: false } as const;
    expect(
      soundForOwnDarkXiangqiMove(view({ board: { a1: redChariot, a2: shroudedBlack } }), {
        from: 'a1',
        to: 'a2',
      }),
    ).toBe('capture');
    expect(
      soundForOwnDarkXiangqiMove(view({ board: { a1: cannon, a3: shroudedBlack } }), {
        from: 'a1',
        to: 'a3',
      }),
    ).toBe('cannon-capture');
  });

  it('keeps the general capture cue only for a visible general', () => {
    const general = { piece: { color: 'black', role: 'general' }, shrouded: false } as const;
    expect(
      soundForOwnDarkXiangqiMove(view({ board: { a1: redChariot, a2: general } }), {
        from: 'a1',
        to: 'a2',
      }),
    ).toBe('king-capture');
  });

  it('suppresses own moves, incomplete snapshots, spectators and reconnects', () => {
    const prev = view({ board: { a1: redChariot }, status: opponentToMove });
    const next = view();
    expect(classifyDarkXiangqiOpponentSound(next, prev, 'red')).toBeNull();
    expect(classifyDarkXiangqiOpponentSound(prev, prev, 'red')).toBeNull();
    expect(classifyDarkXiangqiOpponentSound(prev, next, 'spectator')).toBeNull();
    expect(classifyDarkXiangqiOpponentSound(prev, next, null)).toBeNull();
    expect(classifyDarkXiangqiOpponentSound(null, next, 'red')).toBeNull();
    expect(classifyDarkXiangqiOpponentSound(prev, null, 'red')).toBeNull();
  });

  it('keeps the terminal result keyed by seat', () => {
    const finished = view({
      status: { type: 'finished', winner: 'black', reason: 'general-captured' },
      moveNumber: 12,
    });
    expect(darkXiangqiTerminalSoundKey(finished, 'red')).toBe('lose:12');
    expect(darkXiangqiTerminalSoundKey(finished, 'black')).toBe('win:12');
    expect(darkXiangqiTerminalSoundKey(finished, 'spectator')).toBeNull();
    expect(classifyDarkXiangqiOpponentSound(finished, finished, 'red')).toBeNull();
  });
});
