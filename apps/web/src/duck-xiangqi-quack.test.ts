import { afterEach, describe, expect, it, vi } from 'vitest';

const volume = vi.hoisted(() => ({ value: 1 }));
vi.mock('./theme.js', () => ({ readEffectiveSoundVolume: () => volume.value }));

import { playDuckQuack, quackForFrameEvent, quackForOwnTurn } from './duck-xiangqi-quack.js';

describe('when the duck quacks', () => {
  it('quacks on an own turn that placed the duck', () => {
    expect(quackForOwnTurn({ duckTo: 'e6' })).toBe(true);
  });

  // A turn that captures the general ends the game before the duck moves.
  it('stays quiet on a general capture, which places no duck', () => {
    expect(quackForOwnTurn({ duckTo: null })).toBe(false);
  });

  it("quacks on the opponent's placement, read from the room frame", () => {
    const event = {
      type: 'move-played',
      color: 'black',
      move: { from: 'h10', to: 'g8', duckTo: 'd5' },
    };
    expect(quackForFrameEvent(event, 'red')).toBe(true);
  });

  // The own turn already quacked at the click; the echo must not quack again.
  it('does not quack twice for the echo of an own move', () => {
    const event = {
      type: 'move-played',
      color: 'red',
      move: { from: 'h3', to: 'e3', duckTo: 'e6' },
    };
    expect(quackForFrameEvent(event, 'red')).toBe(false);
  });

  it('ignores other events and a general capture with no duck', () => {
    expect(quackForFrameEvent({ type: 'game-ended' }, 'red')).toBe(false);
    expect(
      quackForFrameEvent({ type: 'move-played', color: 'black', move: { duckTo: null } }, 'red'),
    ).toBe(false);
    expect(quackForFrameEvent(null, 'red')).toBe(false);
  });
});

describe('playDuckQuack', () => {
  afterEach(() => {
    volume.value = 1;
    vi.unstubAllGlobals();
  });

  it("is silent when the site's sound is muted or at zero", () => {
    const created = vi.fn();
    vi.stubGlobal('window', { AudioContext: created });
    volume.value = 0;
    expect(playDuckQuack()).toBe(false);
    expect(created).not.toHaveBeenCalled();
  });
});
