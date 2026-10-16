import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const volume = vi.hoisted(() => ({ value: 1 }));
vi.mock('./theme.js', () => ({ readEffectiveSoundVolume: () => volume.value }));

import {
  DUCK_QUACK_FILE,
  playDuckQuack,
  preloadDuckQuack,
  quackForFrameEvent,
  quackForOwnTurn,
  resetDuckQuackForTests,
} from './duck-xiangqi-quack.js';

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
    resetDuckQuackForTests();
  });

  it('ships the recorded quack it points at', () => {
    expect(DUCK_QUACK_FILE).toBe('/sound/duck/quack.mp3');
    const path = resolve(__dirname, '..', 'public', (DUCK_QUACK_FILE ?? '').replace(/^\//, ''));
    expect(existsSync(path), `${DUCK_QUACK_FILE} missing on disk`).toBe(true);
  });

  // The recording is fetched and decoded ahead of the first placement; until it
  // has decoded the synthesized quack plays, so the first click is never silent.
  it('loads the recorded quack and plays it once decoded, synthesizing until then', async () => {
    const decoded = { duration: 0.28 };
    const sources: unknown[] = [];
    const synthOscillators: unknown[] = [];
    const node = () => ({ connect: vi.fn((next: unknown) => next), gain: { value: 1 } });
    class FakeAudioContext {
      currentTime = 0;
      destination = {};
      resume = vi.fn(async () => {});
      decodeAudioData = vi.fn(async () => decoded);
      createGain = () => ({
        ...node(),
        gain: {
          value: 1,
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
      });
      createBufferSource = () => {
        const source = { ...node(), buffer: null as unknown, start: vi.fn() };
        sources.push(source);
        return source;
      };
      createOscillator = () => {
        const osc = {
          ...node(),
          type: '',
          frequency: {
            value: 0,
            setValueAtTime: vi.fn(),
            linearRampToValueAtTime: vi.fn(),
            exponentialRampToValueAtTime: vi.fn(),
          },
          start: vi.fn(),
          stop: vi.fn(),
        };
        synthOscillators.push(osc);
        return osc;
      };
      createBiquadFilter = () => ({
        ...node(),
        type: '',
        frequency: { value: 0 },
        Q: { value: 0 },
      });
    }
    const fetchMock = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    }));
    vi.stubGlobal('window', { AudioContext: FakeAudioContext });
    vi.stubGlobal('fetch', fetchMock);

    preloadDuckQuack();
    expect(fetchMock).toHaveBeenCalledWith('/sound/duck/quack.mp3');
    // Still decoding: the fallback plays.
    expect(playDuckQuack()).toBe(true);
    expect(sources).toHaveLength(0);
    expect(synthOscillators.length).toBeGreaterThan(0);

    await vi.waitFor(() => {
      playDuckQuack();
      expect(sources).toHaveLength(1);
    });
    expect((sources[0] as { buffer: unknown }).buffer).toBe(decoded);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("is silent when the site's sound is muted or at zero", () => {
    const created = vi.fn();
    vi.stubGlobal('window', { AudioContext: created });
    volume.value = 0;
    expect(playDuckQuack()).toBe(false);
    expect(created).not.toHaveBeenCalled();
  });
});
