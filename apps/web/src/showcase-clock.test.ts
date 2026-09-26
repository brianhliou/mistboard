import { describe, expect, it } from 'vitest';
import {
  projectShowcaseClock,
  reconstructShowcaseClocks,
  showcaseResultMarks,
} from './showcase-clock';

describe('showcaseResultMarks', () => {
  it('marks the first-mover seat as the winner for red-wins and white-wins', () => {
    expect(showcaseResultMarks('red-wins')).toEqual({ first: '1', second: '0' });
    expect(showcaseResultMarks('white-wins')).toEqual({ first: '1', second: '0' });
  });

  it('marks the second seat as the winner for black-wins', () => {
    expect(showcaseResultMarks('black-wins')).toEqual({ first: '0', second: '1' });
  });

  it('marks a draw (or any unknown result) as half points both sides', () => {
    expect(showcaseResultMarks('draw')).toEqual({ first: '½', second: '½' });
    expect(showcaseResultMarks('some-future-result')).toEqual({ first: '½', second: '½' });
  });
});

describe('reconstructShowcaseClocks', () => {
  const base = { initialMs: 180_000, incrementMs: 2_000, firstColor: 'red' as const };

  it('matches the server: first moves free with increment, then Fischer from the previous move', () => {
    const series = reconstructShowcaseClocks({
      ...base,
      moves: [
        { ply: 1, color: 'red', at: 1_000 }, // pre-arm: free, +2000
        { ply: 2, color: 'black', at: 13_000 }, // pre-arm: free (12 s think), +2000
        { ply: 3, color: 'red', at: 13_500 }, // armed: 182000 - 500 + 2000
        { ply: 4, color: 'black', at: 20_500 }, // 182000 - 7000 + 2000
      ],
    });
    expect(series[0]).toEqual({ first: 180_000, second: 180_000 });
    expect(series[1]).toEqual({ first: 182_000, second: 180_000 });
    // Black's 12 s first think is NOT charged: the old reconstruction showed black 12 s
    // low for the whole game.
    expect(series[2]).toEqual({ first: 182_000, second: 182_000 });
    expect(series[3]).toEqual({ first: 183_500, second: 182_000 });
    expect(series[4]).toEqual({ first: 183_500, second: 177_000 });
  });

  it('credits no increment on the game-ending move', () => {
    const moves = [
      { ply: 1, color: 'red', at: 1_000 },
      { ply: 2, color: 'black', at: 2_000 },
      { ply: 3, color: 'red', at: 5_000 },
    ];
    const ended = reconstructShowcaseClocks({ ...base, moves, lastMoveEndsGame: true });
    expect(ended[3]).toEqual({ first: 182_000 - 3_000, second: 182_000 });
    // A game that ended later (resignation, timeout) earned the increment on its last move.
    const resigned = reconstructShowcaseClocks({ ...base, moves, lastMoveEndsGame: false });
    expect(resigned[3]).toEqual({ first: 182_000 - 3_000 + 2_000, second: 182_000 });
  });

  it('sorts by ply and maps the non-first color to the second slot', () => {
    const series = reconstructShowcaseClocks({
      ...base,
      moves: [
        { ply: 2, color: 'black', at: 3_000 },
        { ply: 1, color: 'red', at: 1_000 },
      ],
    });
    expect(series[1]).toEqual({ first: 182_000, second: 180_000 });
    expect(series[2]).toEqual({ first: 182_000, second: 182_000 });
  });

  it('never charges negative time on backwards timestamps and floors at zero', () => {
    const series = reconstructShowcaseClocks({
      initialMs: 1_000,
      incrementMs: 0,
      firstColor: 'red',
      moves: [
        { ply: 1, color: 'red', at: 10_000 },
        { ply: 2, color: 'black', at: 11_000 },
        { ply: 3, color: 'red', at: 5_000 }, // backwards -> spent clamped to 0
        { ply: 4, color: 'black', at: 999_999 }, // huge spend -> floor at 0
      ],
    });
    expect(series[3]!.first).toBe(1_000);
    expect(series[4]!.second).toBe(0);
  });
});

describe('projectShowcaseClock', () => {
  const series = [
    { first: 600_000, second: 600_000 },
    { first: 605_000, second: 600_000 },
    { first: 605_000, second: 605_000 },
    { first: 591_000, second: 605_000 },
  ];

  it('counts the mover down at one second per second and stops at the recorded think', () => {
    // After ply 2 red thinks 19 s (landing on 591_000 = 605_000 - 19_000 + 5_000).
    const at = (elapsedMs: number) =>
      projectShowcaseClock({ series, ply: 2, elapsedMs, windowMs: 19_000, mover: 'first' });
    expect(at(0)).toEqual({ first: 605_000, second: 605_000 });
    expect(at(3_000)).toEqual({ first: 602_000, second: 605_000 });
    expect(at(10_000)).toEqual({ first: 595_000, second: 605_000 });
    // Past the window (a stalled tick) it rests on what the move was charged, never lower.
    expect(at(19_000)).toEqual({ first: 586_000, second: 605_000 });
    expect(at(40_000)).toEqual({ first: 586_000, second: 605_000 });
  });

  it('holds still during a pre-arm first move, as the server clock did', () => {
    expect(
      projectShowcaseClock({ series, ply: 1, elapsedMs: 8_000, windowMs: 12_000, mover: 'second' }),
    ).toEqual({ first: 605_000, second: 600_000 });
  });
});
