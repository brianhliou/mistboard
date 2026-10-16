import type { XmjRoomStatus } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { xmjMoveSound, xmjTerminalSound } from './xiangqi-mahjong-terminal-sound.js';

const playing: XmjRoomStatus = { type: 'playing', turn: 'east' };
const eastWins: XmjRoomStatus = { type: 'finished', winner: 'east', reason: 'points' };

describe('xmjTerminalSound', () => {
  it('stays silent when a room is already finished as it mounts', () => {
    // A reload or reconnect: the first status this client sees is the end.
    expect(xmjTerminalSound(null, eastWins, 'east')).toBeNull();
    expect(xmjTerminalSound('finished', eastWins, 'east')).toBeNull();
  });

  it('plays one sting on the live step from playing to finished', () => {
    // The frames a live game sends: playing, playing, finished, finished.
    const frames = [playing, playing, eastWins, eastWins];
    let previous: XmjRoomStatus['type'] | null = null;
    const played: string[] = [];
    for (const status of frames) {
      const sound = xmjTerminalSound(previous, status, 'west');
      if (sound) played.push(sound);
      previous = status.type;
    }
    expect(played).toEqual(['lose']);
    expect(xmjTerminalSound('playing', eastWins, 'east')).toBe('win');
    expect(
      xmjTerminalSound('playing', { type: 'finished', winner: null, reason: 'tie' }, 'east'),
    ).toBe('draw');
  });

  it('plays nothing for a spectator', () => {
    expect(xmjTerminalSound('playing', eastWins, null)).toBeNull();
    expect(xmjTerminalSound('playing', eastWins, 'spectator')).toBeNull();
  });
});

describe('xmjMoveSound', () => {
  const move = (color: string, m: Record<string, unknown>) => ({
    type: 'move-played',
    color,
    move: m,
  });

  it('gives a won hand its own cue, distinct from a claimed set', () => {
    const winClaim = move('east', { action: 'claim', kind: 'win' });
    const selfDraw = move('west', { action: 'self-draw' });
    expect(xmjMoveSound(winClaim, 'east', false)).toBe('level-end');
    expect(xmjMoveSound(winClaim, 'west', false)).toBe('learn-failure');
    expect(xmjMoveSound(selfDraw, 'west', false)).toBe('level-end');
    expect(xmjMoveSound(selfDraw, 'east', false)).toBe('learn-failure');
    expect(xmjMoveSound(move('east', { action: 'claim', kind: 'pung' }), 'east', false)).toBe(
      'capture',
    );
  });

  it('leaves the match-ending hand to the match sting', () => {
    expect(xmjMoveSound(move('east', { action: 'self-draw' }), 'east', true)).toBeNull();
  });

  it('keeps the discard clicks and stays silent on everything else', () => {
    expect(xmjMoveSound(move('east', { action: 'discard' }), 'east', false)).toBe('move');
    expect(xmjMoveSound(move('east', { action: 'discard' }), 'west', false)).toBe('captured');
    expect(xmjMoveSound(move('east', { action: 'pass' }), 'east', false)).toBeNull();
    expect(xmjMoveSound({ type: 'seat-assigned' }, 'east', false)).toBeNull();
  });
});
