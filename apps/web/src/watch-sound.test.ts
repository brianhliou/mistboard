import { afterEach, describe, expect, it, vi } from 'vitest';

// The shared controller needs a real AudioContext; TV only hands it kinds.
const audio = vi.hoisted(() => ({ played: [] as string[] }));
vi.mock('./live-sound.js', () => ({
  playSound: (kind: string) => {
    audio.played.push(kind);
  },
}));

const {
  WATCH_END_TONE_DELAY_MS,
  WATCH_PAIR_GAP_MS,
  playWatchSoundPlan,
  watchLiveEndSoundPlan,
  watchLiveMoveSoundPlan,
} = await import('./watch-sound.js');

afterEach(() => {
  vi.useRealTimers();
  audio.played = [];
});

describe('live move sound gating', () => {
  const soundAt = (ply: number) => (ply === 5 ? 'capture' : 'move');
  const kinds = (plan: Array<{ kind: string }>) => plan.map((step) => step.kind);

  it('sounds one new ply as its mover heard it', () => {
    expect(watchLiveMoveSoundPlan(4, 5, soundAt)).toEqual([{ kind: 'capture', delayMs: 0 }]);
    expect(kinds(watchLiveMoveSoundPlan(3, 4, soundAt))).toEqual(['move']);
  });

  it('sounds a move and its reply that landed in one frame, a beat apart', () => {
    // A bot answers well inside the 4 s poll, so this is the common PvE frame.
    expect(watchLiveMoveSoundPlan(3, 5, soundAt)).toEqual([
      { kind: 'move', delayMs: 0 },
      { kind: 'capture', delayMs: WATCH_PAIR_GAP_MS },
    ]);
  });

  it('is silent on a seed (first frame, a new game, a channel switch)', () => {
    expect(watchLiveMoveSoundPlan(null, 5, soundAt)).toEqual([]);
    expect(watchLiveMoveSoundPlan(null, 0, soundAt)).toEqual([]);
  });

  it('is silent on a catch-up burst, a repeat frame, or a step back', () => {
    expect(watchLiveMoveSoundPlan(2, 5, soundAt)).toEqual([]);
    expect(watchLiveMoveSoundPlan(2, 8, soundAt)).toEqual([]);
    expect(watchLiveMoveSoundPlan(5, 5, soundAt)).toEqual([]);
    expect(watchLiveMoveSoundPlan(6, 5, soundAt)).toEqual([]);
    expect(watchLiveMoveSoundPlan(8, 0, soundAt)).toEqual([]);
  });

  it('falls back to a plain move when the handle has no cue for the ply', () => {
    expect(kinds(watchLiveMoveSoundPlan(4, 5, () => null))).toEqual(['move']);
    expect(kinds(watchLiveMoveSoundPlan(4, 5, () => undefined))).toEqual(['move']);
  });
});

describe('live game end sound', () => {
  it('plays the final move no live frame carried, then one neutral tone', () => {
    expect(watchLiveEndSoundPlan(40, 41, () => 'capture')).toEqual([
      { kind: 'capture', delayMs: 0 },
      { kind: 'draw', delayMs: WATCH_END_TONE_DELAY_MS },
    ]);
  });

  it('plays a final move and its reply when the record is two plies on', () => {
    expect(watchLiveEndSoundPlan(40, 42, (ply) => (ply === 42 ? 'capture' : 'move'))).toEqual([
      { kind: 'move', delayMs: 0 },
      { kind: 'capture', delayMs: WATCH_PAIR_GAP_MS },
      { kind: 'draw', delayMs: WATCH_PAIR_GAP_MS + WATCH_END_TONE_DELAY_MS },
    ]);
  });

  it('plays only the tone for a game that ended off the board (resignation, flag)', () => {
    expect(watchLiveEndSoundPlan(40, 40, () => 'capture')).toEqual([{ kind: 'draw', delayMs: 0 }]);
    expect(watchLiveEndSoundPlan(30, 41, () => 'capture')).toEqual([{ kind: 'draw', delayMs: 0 }]);
    expect(watchLiveEndSoundPlan(null, 41, () => 'capture')).toEqual([
      { kind: 'draw', delayMs: 0 },
    ]);
    expect(watchLiveEndSoundPlan(40, null, () => 'capture')).toEqual([
      { kind: 'draw', delayMs: 0 },
    ]);
  });

  it('lets a general capture be its own fanfare, as the room does', () => {
    expect(watchLiveEndSoundPlan(40, 41, () => 'king-capture')).toEqual([
      { kind: 'king-capture', delayMs: 0 },
    ]);
  });

  it('never frames the end as a win or a loss', () => {
    for (const last of ['move', 'capture', 'flip', 'blast'] as const) {
      const kinds = watchLiveEndSoundPlan(1, 2, () => last).map((step) => step.kind);
      expect(kinds).not.toContain('win');
      expect(kinds).not.toContain('lose');
      expect(kinds).not.toContain('captured');
    }
  });
});

describe('playing a plan', () => {
  it('plays each step at its delay through the shared controller', () => {
    vi.useFakeTimers();
    playWatchSoundPlan([
      { kind: 'move', delayMs: 0 },
      { kind: 'capture', delayMs: WATCH_PAIR_GAP_MS },
    ]);
    expect(audio.played).toEqual(['move']);
    vi.advanceTimersByTime(WATCH_PAIR_GAP_MS);
    expect(audio.played).toEqual(['move', 'capture']);
  });
});
