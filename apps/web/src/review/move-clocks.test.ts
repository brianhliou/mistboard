import type { GameEvent } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { moveClocksFromEvents, reviewMoveClocks } from './move-clocks.js';

const timeline = [
  { type: 'game-started', at: 0 },
  { type: 'move-played', at: 1000, color: 'red', ply: 1 },
  { type: 'move-played', at: 2000, color: 'black', ply: 2 },
  { type: 'move-played', at: 12000, color: 'red', ply: 3 }, // 10s think
  { type: 'move-played', at: 17000, color: 'black', ply: 4 }, // 5s think
];

describe('reviewMoveClocks', () => {
  it('reads remaining time after each ply, increment credited', () => {
    const series = reviewMoveClocks({
      game: { result: 'red-wins', termination: 'resignation', initialMs: 60000, incrementMs: 2000 },
      timeline,
    })!;
    expect(series).toEqual([
      { first: 60000, second: 60000 },
      { first: 62000, second: 60000 }, // pre-arm: free, earns the increment
      { first: 62000, second: 62000 },
      { first: 54000, second: 62000 }, // 62 - 10 + 2
      { first: 54000, second: 59000 }, // 62 - 5 + 2
    ]);
  });

  it('keys `first` to the side that made ply 1, even when that is black', () => {
    const series = reviewMoveClocks({
      game: { result: 'draw', termination: 'resignation', initialMs: 60000, incrementMs: 0 },
      timeline: timeline.map((event) =>
        'color' in event ? { ...event, color: event.color === 'red' ? 'black' : 'red' } : event,
      ),
    })!;
    expect(series[3]).toEqual({ first: 50000, second: 60000 });
  });

  it('draws nothing for an untimed or correspondence game', () => {
    const base = { result: 'red-wins', termination: 'resignation' };
    expect(reviewMoveClocks({ game: { ...base, initialMs: null }, timeline })).toBeUndefined();
    expect(
      reviewMoveClocks({
        game: { ...base, initialMs: 3 * 24 * 60 * 60 * 1000, incrementMs: 0 },
        timeline,
      }),
    ).toBeUndefined();
    expect(
      reviewMoveClocks({ game: { ...base, initialMs: 60000, incrementMs: 0 }, timeline: [] }),
    ).toBeUndefined();
  });
});

describe('moveClocksFromEvents', () => {
  const clock = (white: number, black: number) => ({
    activeColor: null,
    incrementMs: 0,
    initialMs: 60000,
    remainingMs: { white, black },
    runningSince: null,
  });
  const played = (color: 'white' | 'black', at: number, c?: ReturnType<typeof clock>) =>
    ({
      type: 'move-played',
      at,
      roomId: 'r',
      color,
      move: { from: 'e2', to: 'e4' },
      ...(c ? { clock: c } : {}),
    }) as unknown as GameEvent;

  it('reads the clock stamped on each move', () => {
    expect(
      moveClocksFromEvents([
        played('white', 1, clock(58000, 60000)),
        played('black', 2, clock(58000, 55000)),
      ]),
    ).toEqual([
      { first: 60000, second: 60000 },
      { first: 58000, second: 60000 },
      { first: 58000, second: 55000 },
    ]);
  });

  it('draws nothing when a move carries no clock', () => {
    expect(
      moveClocksFromEvents([played('white', 1, clock(58000, 60000)), played('black', 2)]),
    ).toBeUndefined();
  });
});
