import type { GameEvent, PlayerView, Square } from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { holdBoardSettle, resetBoardSettleForTests, trackPieceAnimation } from './board-anim.js';
import {
  initialOpponentMoveSoundForSnapshot,
  initLiveSound,
  playTerminalPlan,
  shouldDeferHiddenPveOpeningSound,
  soundForMove,
  soundForOwnMove,
  terminalSoundPlan,
  tonesForSound,
} from './live-sound.js';
import { liveState } from './live-state.js';

function makeView(overrides: Partial<PlayerView> = {}): PlayerView {
  return {
    id: 'sound-test',
    variant: 'dark-chess',
    board: {},
    visibleSquares: [],
    legalMoves: [],
    status: { type: 'playing', turn: 'white' },
    perspective: 'white',
    moveNumber: 1,
    ...overrides,
  };
}

function finishAt(
  kind: Parameters<typeof tonesForSound>[0],
  set: Parameters<typeof tonesForSound>[1] = 'mist',
): number {
  return Math.max(...tonesForSound(kind, set).map((tone) => tone.delay + tone.duration));
}

function maxGain(
  kind: Parameters<typeof tonesForSound>[0],
  set: Parameters<typeof tonesForSound>[1] = 'mist',
): number {
  return Math.max(...tonesForSound(kind, set).map((tone) => tone.gain));
}

describe('generic capture routing', () => {
  afterEach(() => {
    liveState.seat = 'spectator';
  });

  const roomId = 'sound-test';
  const created: GameEvent = { type: 'room-created', at: 0, roomId, variant: 'dark-chess' };
  const move = (
    color: 'white' | 'black',
    from: Square,
    to: Square,
  ): Extract<GameEvent, { type: 'move-played' }> => ({
    type: 'move-played',
    at: 1,
    roomId,
    color,
    move: { from, to },
  });
  const before = [created, move('white', 'e2', 'e4'), move('black', 'd7', 'd5')];
  const capture = move('white', 'e4', 'd5');

  it.each(['white', 'black', 'spectator'] as const)(
    'uses the same revealed capture cue for %s',
    (seat) => {
      liveState.seat = seat;
      expect(soundForMove(before, capture)).toBe('capture');
    },
  );

  it.each([
    ['white', 'king-capture'],
    ['black', 'capture'],
    ['spectator', 'king-capture'],
  ] as const)('preserves the revealed king-capture policy for %s', (seat, expected) => {
    liveState.seat = seat;
    const kingCaptureHistory = [
      created,
      move('white', 'e2', 'e4'),
      move('black', 'f7', 'f6'),
      move('white', 'd1', 'h5'),
      move('black', 'a7', 'a6'),
    ];
    expect(soundForMove(kingCaptureHistory, move('white', 'h5', 'e8'))).toBe(expected);
  });

  it('keeps quiet moves and own visible king captures distinct', () => {
    expect(soundForMove([created], move('white', 'e2', 'e4'))).toBe('move');
    expect(
      soundForOwnMove(
        makeView({
          board: {
            e6: { color: 'white', role: 'queen' },
            e7: { color: 'black', role: 'king' },
          },
        }),
        { from: 'e6', to: 'e7' },
      ),
    ).toBe('king-capture');
  });
});

describe('Mist finish sound tone plans', () => {
  it('makes the win tone prominent and ascending', () => {
    const tones = tonesForSound('win', 'mist');
    expect(finishAt('win')).toBeLessThanOrEqual(0.8);
    expect(maxGain('win')).toBeGreaterThanOrEqual(0.06);
    expect(tones.map((tone) => tone.frequency)).toEqual([392, 493.88, 587.33, 783.99]);
    expect(tones.every((tone) => tone.type === 'sine')).toBe(true);
  });

  it('makes the loss tone prominent and descending', () => {
    const tones = tonesForSound('lose', 'mist');
    expect(finishAt('lose')).toBeLessThanOrEqual(0.8);
    expect(maxGain('lose')).toBeGreaterThanOrEqual(0.06);
    expect(tones.map((tone) => tone.frequency)).toEqual([329.63, 261.63, 220]);
  });

  it('makes the draw tone prominent without rising or falling', () => {
    const tones = tonesForSound('draw', 'mist');
    expect(finishAt('draw')).toBeLessThanOrEqual(0.7);
    expect(maxGain('draw')).toBeGreaterThanOrEqual(0.055);
    expect(tones.map((tone) => tone.frequency)).toEqual([329.63, 246.94, 329.63]);
  });
});

describe('puzzle solved sound tone plan', () => {
  it('resolves a rising phrase into a warm major chord across every sound set', () => {
    const mist = tonesForSound('puzzle-solved', 'mist');
    const wood = tonesForSound('puzzle-solved', 'wood');

    expect(wood).toEqual(mist);
    expect(finishAt('puzzle-solved')).toBeLessThanOrEqual(0.9);
    expect(mist.slice(0, 3).map((tone) => tone.frequency)).toEqual([392, 523.25, 659.25]);
    expect(mist.slice(-4).map((tone) => tone.frequency)).toEqual([523.25, 659.25, 783.99, 1046.5]);
    expect(mist.every((tone) => tone.type === 'sine')).toBe(true);
  });
});

describe('Wood finish sound tone plans', () => {
  it.each(['win', 'lose', 'draw'] as const)('gives %s its own percussive pattern', (kind) => {
    const wood = tonesForSound(kind, 'wood');
    expect(wood).not.toEqual(tonesForSound(kind, 'mist'));
    expect(wood.some((tone) => tone.noise)).toBe(true);
  });

  it('uses rising board resonances for a win and falling resonances for a loss', () => {
    const winBodies = tonesForSound('win', 'wood').filter((tone) => !tone.noise);
    const lossBodies = tonesForSound('lose', 'wood').filter((tone) => !tone.noise);

    expect(winBodies.map((tone) => tone.frequency)).toEqual([220, 277.18, 329.63, 440]);
    expect(lossBodies.map((tone) => tone.frequency)).toEqual([180, 135, 90]);
  });
});

describe('terminal sound sequencing', () => {
  it('suppresses the win jingle when the king was captured (the arpeggio is the fanfare)', () => {
    expect(terminalSoundPlan('win', 'king-captured')).toEqual([]);
    expect(terminalSoundPlan('win', 'general-captured')).toEqual([]);
  });

  it('plays a normal win for non-capture finishes', () => {
    expect(terminalSoundPlan('win', 'timeout')).toEqual([{ kind: 'win', delayMs: 0 }]);
    expect(terminalSoundPlan('win', null)).toEqual([{ kind: 'win', delayMs: 0 }]);
  });

  it('gives the loser a king-fall sting before the defeat sound on capture deaths', () => {
    expect(terminalSoundPlan('lose', 'king-captured')).toEqual([
      { kind: 'king-fall', delayMs: 0 },
      { kind: 'lose', delayMs: 550 },
    ]);
    expect(terminalSoundPlan('lose', 'timeout')).toEqual([{ kind: 'lose', delayMs: 0 }]);
  });

  it('draws play the draw sound regardless of reason', () => {
    expect(terminalSoundPlan('draw', 'repetition')).toEqual([{ kind: 'draw', delayMs: 0 }]);
  });
});

describe('opening opponent sound policy', () => {
  it('infers the hidden PvE white opening from black-to-move first snapshot', () => {
    const events: GameEvent[] = [
      { type: 'room-created', at: 1, roomId: 'sound-test', variant: 'dark-chess' },
      {
        type: 'seat-assigned',
        at: 2,
        roomId: 'sound-test',
        clientId: 'builtin-random-legal',
        seat: 'white',
      },
      { type: 'seat-assigned', at: 3, roomId: 'sound-test', clientId: 'human', seat: 'black' },
    ];
    const view = makeView({ status: { type: 'playing', turn: 'black' }, perspective: 'black' });

    expect(initialOpponentMoveSoundForSnapshot(events, view, 'black', 'pve')).toBe('move');
  });

  it('does not infer an opening sound before the engine has moved', () => {
    const view = makeView({ status: { type: 'playing', turn: 'white' }, perspective: 'black' });

    expect(initialOpponentMoveSoundForSnapshot([], view, 'black', 'pve')).toBeNull();
  });

  it('defers the hidden PvE opening delta until audio unlock', () => {
    const previousView = makeView({
      status: { type: 'playing', turn: 'white' },
      perspective: 'black',
    });
    const nextView = makeView({
      status: { type: 'playing', turn: 'black' },
      perspective: 'black',
    });

    expect(shouldDeferHiddenPveOpeningSound(previousView, nextView, 'black', 'pve')).toBe(true);
  });

  it('does not defer ordinary later opponent moves', () => {
    const previousView = makeView({
      moveNumber: 2,
      status: { type: 'playing', turn: 'white' },
      perspective: 'black',
    });
    const nextView = makeView({
      moveNumber: 2,
      status: { type: 'playing', turn: 'black' },
      perspective: 'black',
    });

    expect(shouldDeferHiddenPveOpeningSound(previousView, nextView, 'black', 'pve')).toBe(false);
  });
});

// The reported symptom: arriving in an engine-white PvE room via a full page
// reload leaves the AudioContext suspended (no in-document gesture yet), so the
// engine's opening move only sounds when the visitor first clicks. The SPA
// landing -> room transition keeps the document alive, so the starting click's
// sticky activation lets the room unlock its audio immediately. These tests pin
// both halves of that contract by exercising the real sound controller against a
// fake AudioContext.
describe('audio unlock and sticky activation', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: memoryStorage(),
    });
  });

  function installFakeAudio(): {
    noiseFilterCount: () => number;
    oscillatorCount: () => number;
    peakGain: () => number;
    frequencies: number[];
  } {
    let count = 0;
    let noiseFilters = 0;
    const gainTargets: number[] = [];
    const frequencies: number[] = [];
    class FakeAudioContext {
      currentTime = 0;
      destination = {};
      sampleRate = 48_000;
      state = 'suspended';
      async resume(): Promise<void> {
        this.state = 'running';
      }
      createOscillator() {
        count += 1;
        return {
          type: 'sine',
          frequency: {
            setValueAtTime(value: number) {
              frequencies.push(value);
            },
          },
          connect: (node: unknown) => node,
          start() {},
          stop() {},
        };
      }
      createGain() {
        return {
          gain: {
            value: 1,
            setValueAtTime() {},
            exponentialRampToValueAtTime(value: number) {
              gainTargets.push(value);
            },
          },
          connect: (node: unknown) => node,
        };
      }
      createBuffer(_channels: number, length: number) {
        const samples = new Float32Array(length);
        return { getChannelData: () => samples };
      }
      createBufferSource() {
        return {
          buffer: null,
          playbackRate: { value: 1 },
          connect: (node: unknown) => node,
          start() {},
          stop() {},
        };
      }
      createBiquadFilter() {
        noiseFilters += 1;
        return {
          type: 'bandpass',
          frequency: { setValueAtTime() {} },
          Q: { value: 1 },
          connect: (node: unknown) => node,
        };
      }
    }
    (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    return {
      frequencies,
      noiseFilterCount: () => noiseFilters,
      oscillatorCount: () => count,
      peakGain: () => Math.max(0, ...gainTargets),
    };
  }

  function setUserActivation(hasBeenActive: boolean): void {
    Object.defineProperty(navigator, 'userActivation', {
      configurable: true,
      value: { hasBeenActive, isActive: hasBeenActive },
    });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(window as unknown as Record<string, unknown>, 'AudioContext');
    Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'userActivation');
    Reflect.deleteProperty(window as unknown as Record<string, unknown>, 'localStorage');
    vi.resetModules();
  });

  it.each(['white', 'black'] as const)(
    'sounds a hidden opponent capture for %s using only redacted snapshots',
    async (seat) => {
      const audio = installFakeAudio();
      setUserActivation(true);
      window.localStorage.setItem('mistboard.soundSet', 'mist');
      vi.resetModules();
      const mod = await import('./live-sound.js');
      const { liveState: state } = await import('./live-state.js');
      state.seat = seat;
      state.roomMode = 'pvp';
      const opponent = seat === 'white' ? 'black' : 'white';
      const prev = makeView({
        perspective: seat,
        moveNumber: 3,
        board: { e1: { color: seat, role: 'king' }, e4: { color: seat, role: 'pawn' } },
        visibleSquares: ['e1', 'e4'],
        status: { type: 'playing', turn: opponent },
      });
      const next = makeView({
        perspective: seat,
        moveNumber: 4,
        board: { e1: { color: seat, role: 'king' } },
        visibleSquares: ['e1'],
        status: { type: 'playing', turn: seat },
      });
      // No opponent move or hidden identity is added to the payload to classify audio.
      const payload = { events: [] as GameEvent[], prev, next };
      const serialized = JSON.stringify(payload);
      mod.initLiveSound();
      mod.maybePlaySnapshotSound(payload.events, payload.prev);
      mod.maybePlaySnapshotSound(payload.events, payload.next);
      expect(audio.frequencies).toEqual(
        mod.tonesForSound('capture', 'mist').map((tone) => tone.frequency),
      );
      expect(JSON.stringify(payload)).toBe(serialized);
      expect(serialized).not.toMatch(/capturedRole|lastMove|queen|rook|bishop|knight/);
      state.seat = 'spectator';
    },
  );

  it('unlocks immediately and sounds a move when the document already has sticky activation', async () => {
    const audio = installFakeAudio();
    setUserActivation(true);
    vi.resetModules();
    const mod = await import('./live-sound.js');

    mod.initLiveSound();
    mod.playSound('move');

    expect(audio.oscillatorCount()).toBeGreaterThan(0);
  });

  it('drives 100% volume with the louder master gain', async () => {
    const audio = installFakeAudio();
    setUserActivation(true);
    window.localStorage.setItem('mistboard.soundVolume', '1');
    window.localStorage.setItem('mistboard.soundMuted', 'false');
    vi.resetModules();
    const mod = await import('./live-sound.js');

    mod.initLiveSound();
    mod.playSound('move');

    expect(audio.peakGain()).toBeCloseTo(0.675);
  });

  it('stays locked on a cold load until the first gesture, then plays', async () => {
    const audio = installFakeAudio();
    setUserActivation(false);
    vi.resetModules();
    const mod = await import('./live-sound.js');

    mod.initLiveSound();
    mod.playSound('move');
    expect(audio.oscillatorCount()).toBe(0);

    window.dispatchEvent(new Event('pointerdown'));
    mod.playSound('move');
    expect(audio.oscillatorCount()).toBeGreaterThan(0);
  });

  it('plays every sound queued before the first gesture: the start notify and the opening move', async () => {
    const audio = installFakeAudio();
    setUserActivation(false);
    window.localStorage.setItem('mistboard.soundSet', 'mist');
    vi.resetModules();
    const mod = await import('./live-sound.js');
    const oscillators = (kind: Parameters<typeof tonesForSound>[0]) =>
      mod.tonesForSound(kind, 'mist').filter((tone) => !tone.noise).length;

    mod.initLiveSound();
    mod.playSoundWhenUnlocked('game-start');
    mod.playSoundWhenUnlocked('move');
    expect(audio.oscillatorCount()).toBe(0);

    window.dispatchEvent(new Event('pointerdown'));
    expect(audio.oscillatorCount()).toBe(oscillators('game-start') + oscillators('move'));
  });

  it('switches the running controller from Mist tones to Wood percussion', async () => {
    const audio = installFakeAudio();
    setUserActivation(true);
    window.localStorage.setItem('mistboard.soundSet', 'mist');
    vi.resetModules();
    const mod = await import('./live-sound.js');

    mod.initLiveSound();
    mod.playSound('win');
    expect(audio.noiseFilterCount()).toBe(0);

    window.localStorage.setItem('mistboard.soundSet', 'wood');
    window.dispatchEvent(new Event('mistboard:sound-set-changed'));
    mod.playSound('win');

    // The real wood file is loading on this first play, so the controller must
    // immediately use the wood-specific percussive fallback, never Mist.
    expect(audio.noiseFilterCount()).toBeGreaterThan(0);
  });

  it('suppresses the critical-time warning when the account preference is disabled', async () => {
    const audio = installFakeAudio();
    setUserActivation(true);
    window.localStorage.setItem(
      'mistboard.accountPreferences.v1',
      JSON.stringify({ lowTimeSound: false }),
    );
    vi.resetModules();
    const mod = await import('./live-sound.js');

    mod.initLiveSound();
    mod.maybePlayLowTimeSound('sound-pref-disabled', 5_000, 60_000);

    expect(audio.oscillatorCount()).toBe(0);
  });
});

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

// #825: the result sounded as the final move began to glide. It now waits for
// the board to settle: the frame's render, then the glide that render started.
describe('playTerminalPlan waits for the final move to land', () => {
  let started = 0;
  // Any audio node: every method returns the node, every property is a node.
  function audioNode(): unknown {
    const fn = () => node;
    const node: unknown = new Proxy(fn, {
      get: (_target, key) => (key === 'then' ? undefined : node),
      set: () => true,
      apply: () => node,
    });
    return node;
  }
  class FakeAudioContext {
    currentTime = 0;
    sampleRate = 44100;
    destination = audioNode();
    resume() {
      return Promise.resolve();
    }
    createGain() {
      return audioNode();
    }
    createOscillator() {
      started += 1;
      return audioNode();
    }
    createBufferSource() {
      started += 1;
      return audioNode();
    }
    createBiquadFilter() {
      return audioNode();
    }
    createBuffer(_channels: number, length: number) {
      return { getChannelData: () => new Float32Array(length) };
    }
    decodeAudioData() {
      return Promise.reject(new Error('no audio in tests'));
    }
  }
  function fakeGlide(): EventTarget & { finish(): void } {
    const target = new EventTarget();
    return Object.assign(target, { finish: () => target.dispatchEvent(new Event('finish')) });
  }
  const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

  beforeEach(() => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    initLiveSound();
    window.dispatchEvent(new Event('pointerdown'));
    started = 0;
  });
  afterEach(() => {
    resetBoardSettleForTests();
    vi.unstubAllGlobals();
  });

  it('plays at once when nothing is moving (a resignation, reduced motion)', () => {
    playTerminalPlan('win', 'resignation');
    expect(started).toBeGreaterThan(0);
  });

  it('holds the sound through the render and the final glide, then plays it', async () => {
    // The live core holds the board from the frame until the render that draws it.
    const release = holdBoardSettle();
    playTerminalPlan('lose', 'score');
    expect(started).toBe(0);
    // The render: the hold goes, and the final move starts gliding.
    release();
    const glide = fakeGlide();
    trackPieceAnimation(glide);
    await flush();
    expect(started).toBe(0);
    glide.finish();
    await flush();
    expect(started).toBeGreaterThan(0);
  });
});

// 2026-11-13: Wood at the default volume read as loud and clacky. The pick
// from an audition was about 30% quieter overall with the capture's click
// filtered off; this pins what the browser plays, not just the table.
describe('Wood file playback is the softened mix', () => {
  const filters: Array<{ type: string; frequency: { value: number }; Q: { value: number } }> = [];
  const gains: number[] = [];

  beforeEach(() => {
    filters.length = 0;
    gains.length = 0;
    class FakeAudioContext {
      currentTime = 0;
      destination = {};
      sampleRate = 48_000;
      state = 'running';
      async resume(): Promise<void> {}
      createGain() {
        return {
          gain: {
            setValueAtTime() {},
            linearRampToValueAtTime() {},
            exponentialRampToValueAtTime() {},
            set value(next: number) {
              gains.push(next);
            },
            get value() {
              return gains.at(-1) ?? 1;
            },
          },
          connect: (node: unknown) => node,
        };
      }
      createBiquadFilter() {
        const filter = {
          type: 'bandpass',
          frequency: { value: 0, setValueAtTime() {} },
          Q: { value: 1 },
          connect: (node: unknown) => node,
        };
        filters.push(filter);
        return filter;
      }
      createBufferSource() {
        return {
          buffer: null,
          playbackRate: { value: 1 },
          connect: (node: unknown) => node,
          start() {},
          stop() {},
        };
      }
      createOscillator() {
        return {
          type: 'sine',
          frequency: { setValueAtTime() {} },
          connect: (node: unknown) => node,
          start() {},
          stop() {},
        };
      }
      createBuffer(_channels: number, length: number) {
        const samples = new Float32Array(length);
        return { getChannelData: () => samples };
      }
      decodeAudioData() {
        return Promise.resolve({ duration: 0.2 });
      }
    }
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('fetch', async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
    Object.defineProperty(window, 'localStorage', { configurable: true, value: memoryStorage() });
    Object.defineProperty(navigator, 'userActivation', {
      configurable: true,
      value: { hasBeenActive: true, isActive: true },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'userActivation');
    Reflect.deleteProperty(window as unknown as Record<string, unknown>, 'localStorage');
    vi.resetModules();
  });

  async function loadedWood() {
    vi.resetModules();
    const mod = await import('./live-sound.js');
    mod.initLiveSound();
    // fetch, arrayBuffer and decode each settle on their own tick.
    await new Promise((resolve) => setTimeout(resolve, 0));
    filters.length = 0;
    gains.length = 0;
    return mod;
  }

  it('plays a move at the auditioned level with no filter', async () => {
    const mod = await loadedWood();
    mod.playSound('move');
    expect(filters).toHaveLength(0);
    // Default volume 0.7 times the Wood master: 0.40, down from 0.56.
    expect(gains.at(-1)).toBeCloseTo(0.4, 2);
  });

  it('plays captures and cannon captures through a flat low-pass, below a move', async () => {
    const mod = await loadedWood();
    for (const kind of ['capture', 'cannon-capture'] as const) {
      filters.length = 0;
      mod.playSound(kind);
      expect(filters).toHaveLength(1);
      expect(filters[0]).toMatchObject({ type: 'lowpass', frequency: { value: 2500 } });
      expect(filters[0]?.Q.value).toBeCloseTo(-3.01, 2);
    }
    gains.length = 0;
    mod.playSound('capture');
    expect(gains.at(-1)).toBeLessThan(0.4);
  });
});
