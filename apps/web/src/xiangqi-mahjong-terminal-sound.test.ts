import type { XmjRoomStatus } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { xmjTerminalSound } from './xiangqi-mahjong-terminal-sound.js';

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
