import { GAME_SPECS } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { liveObservePolicy } from '../../server/src/server-policy.js';
import {
  CHANNEL_ALL,
  type CurrentGame,
  deadlineFractionLeft,
  emptyHeadline,
  filterByPlayers,
  finishedMatchesFilter,
  finishedTileKind,
  isLowClock,
  parsePlayerFilter,
  splitSections,
  variantChips,
} from './current-games-model.js';

function game(overrides: Partial<CurrentGame>): CurrentGame {
  return {
    channelId: 'xiangqi',
    clock: null,
    composition: 'pvp',
    deadline: null,
    gameSpecId: 'xiangqi',
    lastActivityAt: null,
    observe: 'open',
    players: [],
    ply: 0,
    rated: false,
    roomId: 'room',
    startedAt: null,
    timeClass: 'blitz',
    timeControl: { incrementMs: 5_000, initialMs: 300_000 },
    url: '/room/room',
    ...overrides,
  };
}

describe('variantChips', () => {
  const channels = [
    { count: 3, id: 'xiangqi' },
    { count: 0, id: 'jieqi' },
    { count: 2, id: 'dark-chess' },
    { count: 0, id: 'banqi' },
  ];

  it('lists All plus only the channels with games, in rail order', () => {
    expect(variantChips(channels, 5, CHANNEL_ALL)).toEqual([
      { count: 5, id: CHANNEL_ALL, selected: true },
      { count: 3, id: 'xiangqi', selected: false },
      { count: 2, id: 'dark-chess', selected: false },
    ]);
  });

  it('keeps a URL-selected channel at zero games, selected, in its place', () => {
    expect(variantChips(channels, 5, 'banqi').map((chip) => [chip.id, chip.selected])).toEqual([
      [CHANNEL_ALL, false],
      ['xiangqi', false],
      ['dark-chess', false],
      ['banqi', true],
    ]);
  });

  it('is just All when nothing is in play', () => {
    expect(
      variantChips(
        channels.map((channel) => ({ ...channel, count: 0 })),
        0,
        CHANNEL_ALL,
      ),
    ).toEqual([{ count: 0, id: CHANNEL_ALL, selected: true }]);
  });
});

describe('players filter', () => {
  const games = [
    game({ composition: 'pvp', roomId: 'a' }),
    game({ composition: 'pve', roomId: 'b' }),
    game({ composition: 'pvp', roomId: 'c' }),
  ];

  it('parses the URL param, defaulting unknown values to everyone', () => {
    expect(parsePlayerFilter(null)).toBe('everyone');
    expect(parsePlayerFilter('people')).toBe('people');
    expect(parsePlayerFilter('bots')).toBe('bots');
    expect(parsePlayerFilter('robots')).toBe('everyone');
  });

  it('filters on the server composition flag, keeping order', () => {
    expect(filterByPlayers(games, 'everyone').map((g) => g.roomId)).toEqual(['a', 'b', 'c']);
    expect(filterByPlayers(games, 'people').map((g) => g.roomId)).toEqual(['a', 'c']);
    expect(filterByPlayers(games, 'bots').map((g) => g.roomId)).toEqual(['b']);
  });

  it('maps finished-game modes: pvp is people, pve and eve are bots', () => {
    expect(finishedMatchesFilter('pvp', 'people')).toBe(true);
    expect(finishedMatchesFilter('pve', 'people')).toBe(false);
    expect(finishedMatchesFilter('pve', 'bots')).toBe(true);
    expect(finishedMatchesFilter('eve', 'bots')).toBe(true);
    expect(finishedMatchesFilter('pvp', 'bots')).toBe(false);
    expect(finishedMatchesFilter(undefined, 'everyone')).toBe(true);
  });
});

describe('splitSections', () => {
  it('puts correspondence in its own section and keeps server order in each', () => {
    const sections = splitSections([
      game({ roomId: 'live-1', timeClass: 'blitz' }),
      game({ roomId: 'corr-1', timeClass: 'correspondence' }),
      game({ roomId: 'live-2', timeClass: null }),
      game({ roomId: 'corr-2', timeClass: 'correspondence' }),
    ]);
    expect(sections.live.map((g) => g.roomId)).toEqual(['live-1', 'live-2']);
    expect(sections.correspondence.map((g) => g.roomId)).toEqual(['corr-1', 'corr-2']);
  });
});

describe('emptyHeadline', () => {
  it('is null while anything is shown', () => {
    expect(emptyHeadline(2, CHANNEL_ALL, 'everyone')).toBeNull();
  });

  it('names the narrowest filter in force', () => {
    expect(emptyHeadline(0, CHANNEL_ALL, 'everyone')).toEqual({ kind: 'none' });
    expect(emptyHeadline(0, CHANNEL_ALL, 'people')).toEqual({ kind: 'people' });
    expect(emptyHeadline(0, CHANNEL_ALL, 'bots')).toEqual({ kind: 'bots' });
    expect(emptyHeadline(0, 'jieqi', 'bots')).toEqual({ channelId: 'jieqi', kind: 'channel' });
  });
});

describe('clock urgency and the correspondence bar', () => {
  it('turns low inside the room clock emergency band (an eighth, 10-60 s)', () => {
    expect(isLowClock(37_000, 300_000)).toBe(true); // 5+5: band is 37.5 s
    expect(isLowClock(38_000, 300_000)).toBe(false);
    expect(isLowClock(59_000, 1_800_000)).toBe(true); // capped at 60 s
    expect(isLowClock(9_000, 60_000)).toBe(true); // floored at 10 s
    expect(isLowClock(0, null)).toBe(false);
  });

  it('measures time left against the days-per-move allowance', () => {
    const now = Date.parse('2026-10-02T00:00:00Z');
    const corr = game({
      deadline: { dueAt: '2026-10-03T12:00:00Z', seat: 'red' },
      timeClass: 'correspondence',
      timeControl: { daysPerMove: 3, incrementMs: 0, initialMs: 259_200_000 },
    });
    expect(deadlineFractionLeft(corr, now)).toBeCloseTo(0.5);
    expect(deadlineFractionLeft(corr, Date.parse('2026-10-05T00:00:00Z'))).toBe(0);
    expect(deadlineFractionLeft({ ...corr, deadline: null }, now)).toBeNull();
    expect(deadlineFractionLeft(game({}), now)).toBeNull();
  });
});

describe('finishedTileKind', () => {
  it('draws a board for open variants and mists every hidden one', () => {
    expect(finishedTileKind('xiangqi')).toBe('board');
    expect(finishedTileKind('fog')).toBe('fog');
    expect(finishedTileKind('dark-chess')).toBe('fog');
    expect(finishedTileKind('dark-xiangqi')).toBe('fog');
    expect(finishedTileKind('banqi')).toBe('fog');
    expect(finishedTileKind('jieqi')).toBe('fog');
    expect(finishedTileKind('no-such-variant')).toBe('fog');
  });

  // Hidden-info guard: the client never decides on its own to draw a board the
  // server would not draw live. Every spec this page draws must be one the
  // server's own spectator policy calls open.
  it('never draws a spec the server would not show a spectator live', () => {
    for (const spec of GAME_SPECS) {
      if (finishedTileKind(spec.id) !== 'board') continue;
      expect([spec.id, liveObservePolicy(spec.visibility, spec.id)]).toEqual([spec.id, 'open']);
    }
  });
});
