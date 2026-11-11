import { describe, expect, it } from 'vitest';
import type { ReviewMetaPlayer } from './game-review-meta.js';
import { retroSideForViewer } from './retro-side.js';

const PLAYERS: ReviewMetaPlayer[] = [
  { color: 'red', kind: 'account', name: 'Alice', handle: 'alice' },
  { color: 'black', kind: 'account', name: 'Bob', handle: 'bob' },
];

describe('retroSideForViewer', () => {
  it.each([
    [{ handle: 'alice' }, 'red'],
    [{ handle: 'bob' }, 'black'],
    [{ handle: 'spectator' }, null],
    [null, null],
  ] as const)('maps viewer %j to %s', (viewer, side) => {
    expect(retroSideForViewer(PLAYERS, viewer)).toBe(side);
  });

  it('maps Gomoku Black and White into the shared red and black slots', () => {
    const players: ReviewMetaPlayer[] = [
      { ...PLAYERS[0]!, color: 'black' },
      { ...PLAYERS[1]!, color: 'white' },
    ];
    expect(retroSideForViewer(players, { handle: 'alice' }, 'black', 'white')).toBe('red');
    expect(retroSideForViewer(players, { handle: 'bob' }, 'black', 'white')).toBe('black');
  });

  it('never infers identity from a display name or a redacted seat', () => {
    expect(retroSideForViewer([{ ...PLAYERS[0]!, handle: null }], { handle: 'Alice' })).toBeNull();
    expect(retroSideForViewer(undefined, { handle: 'alice' })).toBeNull();
  });

  it.each([
    { kind: 'guest' },
    { kind: 'engine' },
    { kind: 'account', botId: 'alice-bot' },
    { kind: undefined },
    { color: 'north' },
  ] satisfies Partial<ReviewMetaPlayer>[])('rejects non-player identity %j', (patch) => {
    expect(retroSideForViewer([{ ...PLAYERS[0]!, ...patch }], { handle: 'alice' })).toBeNull();
  });

  it('fails closed if the same account appears in both seats', () => {
    expect(
      retroSideForViewer([PLAYERS[0]!, { ...PLAYERS[0]!, color: 'black' }], { handle: 'alice' }),
    ).toBeNull();
  });
});
