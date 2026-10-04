import { GAME_SPECS } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { roomViewPolicy } from '../../server/src/server-policy.js';
import {
  type CurrentGame,
  deadlineFractionLeft,
  finishedTileKind,
  isLowClock,
  liveTileKind,
  splitSections,
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

describe('liveTileKind', () => {
  it('mists a Fog Chess correspondence game even if a payload slipped in', () => {
    const fog = game({
      channelId: 'dark-chess',
      gameSpecId: 'dark-chess',
      observe: 'sealed',
      timeClass: 'correspondence',
      payload: { leaked: true },
    });
    expect(liveTileKind(fog)).toBe('fog');
  });

  it('draws an open correspondence game from its payload, placeholder until it arrives', () => {
    const corr = game({ timeClass: 'correspondence' });
    expect(liveTileKind({ ...corr, payload: { view: {} } })).toBe('board');
    expect(liveTileKind(corr)).toBe('placeholder');
  });
});

describe('finishedTileKind', () => {
  it('draws open variants, the fog variants and the public-view jieqi, banqi and Flip Jungle boards', () => {
    expect(finishedTileKind('xiangqi')).toBe('board');
    expect(finishedTileKind('fog')).toBe('board');
    expect(finishedTileKind('dark-chess')).toBe('board');
    expect(finishedTileKind('dark-xiangqi')).toBe('board');
    expect(finishedTileKind('jieqi')).toBe('board');
    expect(finishedTileKind('banqi')).toBe('board');
    expect(finishedTileKind('jungle-flip')).toBe('board');
  });

  it('keeps every unknown variant in the mist', () => {
    expect(finishedTileKind('no-such-variant')).toBe('fog');
  });

  it('draws exactly the open and fog specs plus jieqi, banqi and Flip Jungle', () => {
    const drawn = GAME_SPECS.filter((spec) => finishedTileKind(spec.id) === 'board').map(
      (spec) => spec.id,
    );
    const open = GAME_SPECS.filter(
      (spec) => spec.visibility === 'open' || spec.visibility === 'dark',
    ).map((spec) => spec.id);
    expect(drawn.sort()).toEqual([...open, 'banqi', 'jieqi', 'jungle-flip'].sort());
  });

  // Hidden-info guard: the client never decides on its own to draw a board the
  // server would not show. Every finished board this page draws must be one the
  // server's own room policy opens in full to a spectator once the game is over.
  it('never draws a finished board the server would not show a spectator', () => {
    for (const spec of GAME_SPECS) {
      if (finishedTileKind(spec.id) !== 'board') continue;
      expect([spec.id, roomViewPolicy(spec.visibility, true, 'spectator')]).toEqual([
        spec.id,
        'truth',
      ]);
    }
  });
});
