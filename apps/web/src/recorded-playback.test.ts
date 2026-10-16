import { describe, expect, it } from 'vitest';
import {
  anchorForPly,
  offsetsFromDurations,
  offsetsFromTimestamps,
  positionAt,
} from './recorded-playback.js';

describe('offsetsFromTimestamps', () => {
  it('measures each ply from the game start, so the first move waits as long as it did', () => {
    expect(offsetsFromTimestamps(1_000, [4_000, 6_000, 25_000])).toEqual([0, 3_000, 5_000, 24_000]);
  });

  it('anchors on the first move when the start is missing or later than it', () => {
    expect(offsetsFromTimestamps(null, [4_000, 6_000])).toEqual([0, 0, 2_000]);
    expect(offsetsFromTimestamps(9_000, [4_000, 6_000])).toEqual([0, 0, 2_000]);
  });

  it('holds time level across a backwards timestamp', () => {
    expect(offsetsFromTimestamps(0, [1_000, 500, 2_000])).toEqual([0, 1_000, 1_000, 2_000]);
  });
});

describe('positionAt', () => {
  const offsets = offsetsFromDurations([1_000, 2_000, 19_000, 2_000]); // [0,1000,3000,22000,24000]

  it('is the ply whose recorded time has come, with the think elapsed and its full length', () => {
    expect(positionAt(offsets, 0)).toEqual({ ply: 0, plyElapsedMs: 0, windowMs: 1_000 });
    expect(positionAt(offsets, 999)).toEqual({ ply: 0, plyElapsedMs: 999, windowMs: 1_000 });
    expect(positionAt(offsets, 3_000)).toEqual({ ply: 2, plyElapsedMs: 0, windowMs: 19_000 });
    expect(positionAt(offsets, 10_000)).toEqual({ ply: 2, plyElapsedMs: 7_000, windowMs: 19_000 });
  });

  it('parks on the last ply after the end and on ply 0 before the start', () => {
    expect(positionAt(offsets, 60_000)).toEqual({ ply: 4, plyElapsedMs: 36_000, windowMs: null });
    expect(positionAt(offsets, -5_000)).toEqual({ ply: 0, plyElapsedMs: 0, windowMs: 1_000 });
  });

  it('round-trips through anchorForPly', () => {
    const anchor = anchorForPly(offsets, 3, 100_000);
    expect(positionAt(offsets, 100_000 - anchor)).toMatchObject({ ply: 3, plyElapsedMs: 0 });
  });
});
