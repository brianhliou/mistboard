import { CORRESPONDENCE_ELIGIBLE_SPEC_IDS, GAME_SPECS } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { liveObservePolicy } from '../../server/src/server-policy.js';
import {
  type CorrespondenceGame,
  deadlineFraction,
  deadlineRemainingMs,
  deadlineUrgency,
  inboxTileKind,
  indexByRoom,
  othersSeeks,
  seekRequestBody,
  splitInbox,
  URGENT_DEADLINE_MS,
} from './correspondence-model.js';

const NOW = Date.parse('2026-10-02T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function game(overrides: Partial<CorrespondenceGame>): CorrespondenceGame {
  return {
    dueAt: new Date(NOW + DAY).toISOString(),
    gameSpecId: 'xiangqi',
    isYourMove: true,
    mySeat: 'red',
    opponentName: 'opp',
    roomId: 'r',
    url: '/room/r',
    ...overrides,
  };
}

describe('splitInbox', () => {
  it('splits by whose move it is, soonest deadline first in each group', () => {
    const games = [
      game({ roomId: 'a', isYourMove: true, dueAt: new Date(NOW + 3 * DAY).toISOString() }),
      game({ roomId: 'b', isYourMove: false, dueAt: new Date(NOW + 2 * DAY).toISOString() }),
      game({ roomId: 'c', isYourMove: true, dueAt: new Date(NOW + HOUR).toISOString() }),
      game({ roomId: 'd', isYourMove: false, dueAt: new Date(NOW + HOUR).toISOString() }),
    ];
    const { yourMove, waiting } = splitInbox(games);
    expect(yourMove.map((g) => g.roomId)).toEqual(['c', 'a']);
    expect(waiting.map((g) => g.roomId)).toEqual(['d', 'b']);
  });

  it('sinks an unreadable deadline to the end instead of dropping it', () => {
    const { yourMove } = splitInbox([
      game({ roomId: 'bad', dueAt: 'nope' }),
      game({ roomId: 'ok', dueAt: new Date(NOW + DAY).toISOString() }),
    ]);
    expect(yourMove.map((g) => g.roomId)).toEqual(['ok', 'bad']);
  });

  it('is empty-safe', () => {
    expect(splitInbox([])).toEqual({ yourMove: [], waiting: [] });
  });
});

describe('deadlines', () => {
  const at = (ms: number): string => new Date(NOW + ms).toISOString();

  it('turns amber inside the last day, due once past', () => {
    expect(deadlineUrgency(at(3 * DAY), NOW)).toBe('calm');
    expect(deadlineUrgency(at(URGENT_DEADLINE_MS), NOW)).toBe('calm');
    expect(deadlineUrgency(at(URGENT_DEADLINE_MS - 1), NOW)).toBe('urgent');
    expect(deadlineUrgency(at(9 * HOUR), NOW)).toBe('urgent');
    expect(deadlineUrgency(at(0), NOW)).toBe('due');
    expect(deadlineUrgency(at(-HOUR), NOW)).toBe('due');
    expect(deadlineUrgency('not a date', NOW)).toBe('calm');
  });

  it('clamps the remaining time at zero', () => {
    expect(deadlineRemainingMs(at(5 * HOUR), NOW)).toBe(5 * HOUR);
    expect(deadlineRemainingMs(at(-5 * HOUR), NOW)).toBe(0);
    expect(deadlineRemainingMs('nope', NOW)).toBeNull();
  });

  it('measures the bar against the move allowance', () => {
    expect(deadlineFraction(at(1.5 * DAY), 3, NOW)).toBeCloseTo(0.5);
    expect(deadlineFraction(at(10 * DAY), 3, NOW)).toBe(1);
    expect(deadlineFraction(at(-DAY), 3, NOW)).toBe(0);
    expect(deadlineFraction(at(DAY), null, NOW)).toBeNull();
    expect(deadlineFraction(at(DAY), 0, NOW)).toBeNull();
    expect(deadlineFraction('nope', 3, NOW)).toBeNull();
  });
});

describe('inboxTileKind', () => {
  it('draws the board only for an open game the public feed sent a payload for', () => {
    expect(inboxTileKind('xiangqi', { observe: 'open', payload: { events: [] } })).toBe('board');
    expect(inboxTileKind('xiangqi', { observe: 'open' })).toBe('placeholder');
    expect(inboxTileKind('xiangqi', null)).toBe('placeholder');
  });

  it('keeps Fog Chess in the mist whatever the feed says', () => {
    expect(inboxTileKind('dark-chess', null)).toBe('fog');
    expect(inboxTileKind('dark-chess', { observe: 'open', payload: { events: [] } })).toBe('fog');
    expect(inboxTileKind('xiangqi', { observe: 'masked', payload: { events: [] } })).toBe('fog');
    expect(inboxTileKind('no-such-spec', null)).toBe('fog');
  });

  it('never draws a board for an eligible spec the server would not show a spectator', () => {
    for (const specId of CORRESPONDENCE_ELIGIBLE_SPEC_IDS) {
      const spec = GAME_SPECS.find((candidate) => candidate.id === specId);
      expect(spec).toBeDefined();
      if (!spec) continue;
      const observe = liveObservePolicy(spec.visibility, spec.id);
      const kind = inboxTileKind(specId, { observe, payload: { events: [] } });
      if (observe !== 'open') expect(kind).toBe('fog');
    }
  });

  it('indexes the feed by room id', () => {
    const index = indexByRoom([{ roomId: 'a' }, { roomId: 'b' }]);
    expect(index.get('b')).toEqual({ roomId: 'b' });
    expect(index.get('c')).toBeUndefined();
  });
});

describe('othersSeeks', () => {
  it('drops your own seeks from the board and keeps server order', () => {
    const seeks = [
      { id: '1', isMine: false },
      { id: '2', isMine: true },
      { id: '3', isMine: false },
    ];
    expect(othersSeeks(seeks).map((seek) => seek.id)).toEqual(['1', '3']);
  });
});

describe('seekRequestBody', () => {
  const base = { daysPerMove: 3, gameSpecId: 'xiangqi', preferredColor: 'random' as const };

  it('posts to the public board by default', () => {
    expect(seekRequestBody({ ...base, kind: 'public' })).toEqual({ ok: true, body: base });
  });

  it('makes a private share link', () => {
    expect(seekRequestBody({ ...base, kind: 'link' })).toEqual({
      ok: true,
      body: { ...base, visibility: 'private' },
    });
  });

  it('directs a challenge by handle, tolerating a leading @', () => {
    expect(seekRequestBody({ ...base, kind: 'direct', handle: '  @riverhorse ' })).toEqual({
      ok: true,
      body: { ...base, targetHandle: 'riverhorse' },
    });
    expect(seekRequestBody({ ...base, kind: 'direct', handle: ' @ ' })).toEqual({
      ok: false,
      error: 'handle_required',
    });
  });
});
