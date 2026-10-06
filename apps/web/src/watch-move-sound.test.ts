import type {
  AtomicXiangqiPlayerView,
  BanqiPlayerView,
  CrazyhouseXiangqiPlayerView,
  FortressXiangqiPlayerView,
  JieqiPlayerView,
  JungleFlipPlayerView,
  JunglePlayerView,
  StandardXiangqiPlayerView,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import type { DarkXiangqiWireView } from './live-dark-xiangqi.js';
import {
  watchAtomicXiangqiMoveSound,
  watchBanqiMoveSound,
  watchCrazyhouseXiangqiMoveSound,
  watchDarkXiangqiMoveSound,
  watchFortressXiangqiMoveSound,
  watchJieqiMoveSound,
  watchJungleFlipMoveSound,
  watchJungleMoveSound,
  watchXiangqiMoveSound,
} from './watch-move-sound.js';

// The classifiers read board / perspective / status / lastMove; everything else
// on a view is irrelevant here, so fixtures are built minimal and cast.
function v<T>(
  board: Record<string, unknown>,
  turn: 'red' | 'black',
  lastMove?: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): T {
  return {
    id: 'watch-sound-test',
    // Spectator payloads are drawn from one fixed side (red); the mover must not
    // be assumed to be the perspective.
    perspective: 'red',
    board,
    status: { type: 'playing', turn },
    moveNumber: 1,
    ...(lastMove ? { lastMove } : {}),
    ...extra,
  } as unknown as T;
}

const piece = (color: 'red' | 'black', role: string) => ({ color, role });

describe('watch move sounds: open xiangqi family', () => {
  it('xiangqi: a quiet move is a move, a capture a capture, a cannon shot the cannon boom', () => {
    const prev = v<StandardXiangqiPlayerView>(
      {
        a1: piece('red', 'chariot'),
        b3: piece('red', 'cannon'),
        a7: piece('black', 'soldier'),
        b10: piece('black', 'horse'),
      },
      'red',
    );
    const quiet = { from: 'a1', to: 'a2' };
    expect(watchXiangqiMoveSound(prev, v({}, 'black', quiet))).toBe('move');
    expect(watchXiangqiMoveSound(prev, v({}, 'black', { from: 'a1', to: 'a7' }))).toBe('capture');
    expect(watchXiangqiMoveSound(prev, v({}, 'black', { from: 'b3', to: 'b10' }))).toBe(
      'cannon-capture',
    );
  });

  it("xiangqi: black's capture reads as a capture, not the victim's 'captured'", () => {
    const prev = v<StandardXiangqiPlayerView>(
      { a7: piece('black', 'soldier'), a6: piece('red', 'soldier') },
      'black',
    );
    expect(watchXiangqiMoveSound(prev, v({}, 'red', { from: 'a7', to: 'a6' }))).toBe('capture');
  });

  it('xiangqi: a checking move sounds as the move it is (the site has no check cue)', () => {
    // Red's chariot lands on the open e-file facing the black general.
    const prev = v<StandardXiangqiPlayerView>(
      { a5: piece('red', 'chariot'), e10: piece('black', 'general'), e1: piece('red', 'general') },
      'red',
    );
    expect(watchXiangqiMoveSound(prev, v({}, 'black', { from: 'a5', to: 'e5' }))).toBe('move');
  });

  it('a payload without lastMove still sounds the ply as a move', () => {
    const prev = v<StandardXiangqiPlayerView>({}, 'red');
    expect(watchXiangqiMoveSound(prev, v({}, 'black'))).toBe('move');
  });

  it('atomic: a non-cannon capture is the blast; the cannon keeps its slam', () => {
    const prev = v<AtomicXiangqiPlayerView>(
      { a1: piece('red', 'chariot'), b3: piece('red', 'cannon'), a7: piece('black', 'soldier') },
      'red',
      undefined,
      { lastBlast: [] },
    );
    const next = (move: Record<string, unknown>) =>
      v<AtomicXiangqiPlayerView>({}, 'black', move, { lastBlast: [] });
    expect(watchAtomicXiangqiMoveSound(prev, next({ from: 'a1', to: 'a7' }))).toBe('blast');
    expect(watchAtomicXiangqiMoveSound(prev, next({ from: 'b3', to: 'b5' }))).toBe('move');
  });

  it('crazyhouse: a reserve drop is a drop, a board capture a capture', () => {
    const prev = v<CrazyhouseXiangqiPlayerView>(
      { a1: piece('red', 'chariot'), a7: piece('black', 'soldier') },
      'red',
    );
    expect(watchCrazyhouseXiangqiMoveSound(prev, v({}, 'black', { drop: 'horse', to: 'c5' }))).toBe(
      'drop',
    );
    expect(watchCrazyhouseXiangqiMoveSound(prev, v({}, 'black', { from: 'a1', to: 'a7' }))).toBe(
      'capture',
    );
  });

  it('fortress: drop, capture, move', () => {
    const prev = v<FortressXiangqiPlayerView>(
      { a1: piece('red', 'chariot'), a7: piece('black', 'soldier') },
      'red',
    );
    expect(watchFortressXiangqiMoveSound(prev, v({}, 'black', { drop: 'soldier', to: 'c5' }))).toBe(
      'drop',
    );
    expect(watchFortressXiangqiMoveSound(prev, v({}, 'black', { from: 'a1', to: 'a7' }))).toBe(
      'capture',
    );
    expect(watchFortressXiangqiMoveSound(prev, v({}, 'black', { from: 'a1', to: 'a2' }))).toBe(
      'move',
    );
  });
});

describe('watch move sounds: hidden identity (jieqi, banqi, flip jungle)', () => {
  const faceDown = (color: 'red' | 'black') => ({ color, faceDown: true });
  const faceUp = (color: 'red' | 'black', role: string) => ({ color, role, faceDown: false });

  it('jieqi: moving a face-down piece is the reveal (flip)', () => {
    const prev = v<JieqiPlayerView>({ a4: faceDown('red') }, 'red');
    expect(watchJieqiMoveSound(prev, v({}, 'black', { from: 'a4', to: 'a5' }))).toBe('flip');
  });

  it("jieqi: black's capture is read from black's side (the payload's perspective is red)", () => {
    const prev = v<JieqiPlayerView>(
      { a7: faceUp('black', 'chariot'), a4: faceUp('red', 'soldier') },
      'black',
    );
    expect(watchJieqiMoveSound(prev, v({}, 'red', { from: 'a7', to: 'a4' }))).toBe('capture');
  });

  it('jieqi: a face-down mover is not a cannon to the spectator, whatever it turns out to be', () => {
    // Hidden-info guard. The masked board the spectator sees has the mover
    // face-down, so the cue is a plain capture; the cannon boom would announce an
    // identity the board had not shown when the move was made.
    const prev = v<JieqiPlayerView>({ b8: faceDown('black'), b3: faceDown('red') }, 'black');
    const next = v<JieqiPlayerView>({ b3: faceUp('black', 'cannon') }, 'red', {
      from: 'b8',
      to: 'b3',
    });
    expect(watchJieqiMoveSound(prev, next)).toBe('capture');
  });

  it('jieqi: taking a revealed general is the king capture', () => {
    const prev = v<JieqiPlayerView>(
      { e5: faceUp('red', 'chariot'), e10: faceUp('black', 'general') },
      'red',
    );
    expect(watchJieqiMoveSound(prev, v({}, 'black', { from: 'e5', to: 'e10' }))).toBe(
      'king-capture',
    );
  });

  it('banqi: a self-move is a flip; a revealed capture is a capture', () => {
    const prev = v<BanqiPlayerView>(
      {
        a1: { faceDown: true },
        b1: { color: 'red', role: 'chariot', faceDown: false },
        b2: { color: 'black', role: 'soldier', faceDown: false },
      },
      'red',
    );
    expect(watchBanqiMoveSound(prev, v({}, 'black', { from: 'a1', to: 'a1' }))).toBe('flip');
    expect(watchBanqiMoveSound(prev, v({}, 'black', { from: 'b1', to: 'b2' }))).toBe('capture');
  });

  it('flip jungle: a self-move is a flip', () => {
    const prev = v<JungleFlipPlayerView>({ a1: { faceDown: true } }, 'red');
    expect(watchJungleFlipMoveSound(prev, v({}, 'black', { from: 'a1', to: 'a1' }))).toBe('flip');
  });

  it('jungle: a capture of an enemy animal is a capture', () => {
    const prev = v<JunglePlayerView>({ a1: piece('red', 'rat'), a2: piece('black', 'cat') }, 'red');
    expect(watchJungleMoveSound(prev, v({}, 'black', { from: 'a1', to: 'a2' }))).toBe('capture');
    expect(watchJungleMoveSound(prev, v({}, 'black', { from: 'a1', to: 'b1' }))).toBe('move');
  });
});

describe('watch move sounds: field-of-fire fog (dark xiangqi)', () => {
  it('a shrouded target is a capture of something, never a general', () => {
    // The fogged view shows only occupancy + colour on e10. Even if it is the
    // general in truth, the spectator's board does not say so, so neither may the
    // sound.
    const prev = v<DarkXiangqiWireView>(
      {
        e5: { piece: { color: 'red', role: 'chariot' }, shrouded: false },
        e10: { color: 'black', shrouded: true },
      },
      'red',
      undefined,
      { visibleSquares: [], legalMoves: [] },
    );
    expect(
      watchDarkXiangqiMoveSound(
        prev,
        v({}, 'black', { from: 'e5', to: 'e10' }, { visibleSquares: [] }),
      ),
    ).toBe('capture');
  });
});
