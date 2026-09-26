import type { GameEvent } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import {
  moveEventAtPly,
  recordedDurationForPly,
  recordedPlyOffsets,
  thinkingDurationForPly,
} from './replay-playback.js';
import { FALLBACK_PLAY_MS } from './replay-wall-clock.js';

const ROOM = 'room';

type MoveExt = Extract<GameEvent, { type: 'move-played' }> & {
  compute_ms?: number;
  thinkTimeMs?: number;
};

function roomCreated(at = 0): GameEvent {
  return {
    type: 'room-created',
    at,
    roomId: ROOM,
    variant: 'dark-chess',
    offer: [],
    timeControl: { initialMs: 60_000, incrementMs: 0 },
  } as Extract<GameEvent, { type: 'room-created' }>;
}

function move(
  opts: { at?: number; color?: 'white' | 'black'; thinkTimeMs?: number; compute_ms?: number } = {},
): GameEvent {
  const base = {
    type: 'move-played',
    at: opts.at ?? 1,
    roomId: ROOM,
    color: opts.color ?? 'white',
    move: { from: 'e2' as never, to: 'e4' as never },
  } as Extract<GameEvent, { type: 'move-played' }>;
  return {
    ...base,
    ...(opts.thinkTimeMs !== undefined ? { thinkTimeMs: opts.thinkTimeMs } : {}),
    ...(opts.compute_ms !== undefined ? { compute_ms: opts.compute_ms } : {}),
  } as MoveExt as GameEvent;
}

describe('moveEventAtPly', () => {
  it('is 1-indexed over move-played events and skips non-move events', () => {
    const m1 = move({ at: 10 });
    const m2 = move({ at: 20, color: 'black' });
    const events = [roomCreated(), m1, m2];
    expect(moveEventAtPly(events, 1)).toBe(m1);
    expect(moveEventAtPly(events, 2)).toBe(m2);
  });

  it('returns null for ply < 1 or past the last move', () => {
    const events = [roomCreated(), move()];
    expect(moveEventAtPly(events, 0)).toBeNull();
    expect(moveEventAtPly(events, -1)).toBeNull();
    expect(moveEventAtPly(events, 2)).toBeNull();
    expect(moveEventAtPly([], 1)).toBeNull();
  });
});

describe('thinkingDurationForPly', () => {
  it('prefers thinkTimeMs, falls back to compute_ms, else null', () => {
    expect(thinkingDurationForPly([move({ thinkTimeMs: 1234, compute_ms: 99 })], 1)).toBe(1234);
    expect(thinkingDurationForPly([move({ compute_ms: 50 })], 1)).toBe(50);
    expect(thinkingDurationForPly([move()], 1)).toBeNull();
  });

  it('treats a zero think time as recorded, not absent', () => {
    expect(thinkingDurationForPly([move({ thinkTimeMs: 0 })], 1)).toBe(0);
  });

  it('returns null for an out-of-range ply', () => {
    expect(thinkingDurationForPly([move({ thinkTimeMs: 100 })], 5)).toBeNull();
  });
});

// TRUE TIMING: every path returns the time the move really took. No clamp into a
// watchable band, no scale, no floor.
describe('recordedDurationForPly', () => {
  it('plays a clocked game at its recorded timestamp gaps, however long', () => {
    // room at 0, move at 10 s: ten seconds, not 1.2 s (the retired 0.12 scale).
    const events = [roomCreated(0), move({ at: 10_000 })];
    expect(recordedDurationForPly(events, 1, true)).toBe(10_000);
    // A 45 s think stays 45 s (the retired clamp capped it at 2.5 s).
    const long = [roomCreated(0), move({ at: 1_000 }), move({ at: 46_000, color: 'black' })];
    expect(recordedDurationForPly(long, 2, true)).toBe(45_000);
    // A snap move stays a snap move (the retired floor stretched it to 0.7 s).
    const snap = [roomCreated(0), move({ at: 1_000 }), move({ at: 1_080, color: 'black' })];
    expect(recordedDurationForPly(snap, 2, true)).toBe(80);
  });

  it('uses the timestamp gap on a clocked game even when the engine recorded its think', () => {
    // The clock was charged the gap (think + latency), so playback must span the gap.
    const events = [roomCreated(0), move({ at: 4_000, thinkTimeMs: 3_200 })];
    expect(recordedDurationForPly(events, 1, true)).toBe(4_000);
  });

  it('plays a clockless game at the recorded think time, unfloored', () => {
    expect(recordedDurationForPly([move({ thinkTimeMs: 14_000 })], 1, false)).toBe(14_000);
    expect(recordedDurationForPly([move({ thinkTimeMs: 100 })], 1, false)).toBe(100);
    expect(recordedDurationForPly([move({ thinkTimeMs: 0 })], 1, false)).toBe(0);
  });

  it('prefers think time over a recorded gap and compute time when clockless', () => {
    const events = [roomCreated(0), move({ at: 10_000, thinkTimeMs: 1_300, compute_ms: 30 })];
    expect(recordedDurationForPly(events, 1, false)).toBe(1_300);
  });

  it('treats a sub-150 ms gap on a clockless log as a sequence number, not a think', () => {
    const events = [roomCreated(0), move({ at: 1 }), move({ at: 2, color: 'black' })];
    expect(recordedDurationForPly(events, 2, false)).toBe(FALLBACK_PLAY_MS);
    const real = [roomCreated(0), move({ at: 1_000 }), move({ at: 9_000, color: 'black' })];
    expect(recordedDurationForPly(real, 2, false)).toBe(8_000);
  });

  it('falls back to raw compute time, then the fixed step when nothing is recorded', () => {
    expect(recordedDurationForPly([move({ compute_ms: 30 })], 1, false)).toBe(30);
    expect(recordedDurationForPly([move()], 1, false)).toBe(FALLBACK_PLAY_MS);
    expect(recordedDurationForPly([move({ thinkTimeMs: -5 })], 1, false)).toBe(FALLBACK_PLAY_MS);
  });
});

describe('recordedPlyOffsets', () => {
  it('accumulates the recorded durations from the game start', () => {
    const events = [
      roomCreated(0),
      move({ at: 2_000 }),
      move({ at: 21_000, color: 'black' }),
      move({ at: 23_500 }),
    ];
    expect(recordedPlyOffsets(events, true)).toEqual([0, 2_000, 21_000, 23_500]);
  });
});
