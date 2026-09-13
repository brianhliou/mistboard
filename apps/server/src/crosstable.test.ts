import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCrosstable,
  type CrosstablePlayer,
  type CrosstableTenantLookup,
  crosstableOutcome,
  crosstableReviewUrl,
  crosstableSeatForColor,
  resolveCrosstablePair,
} from './crosstable.js';
import type { GameParticipant } from './persistence-games.js';

// A registry stand-in: xiangqi + banqi bind a route base, the dark-chess
// correspondence registration (dchx_) binds none, nothing else is registered.
const LOOKUP: CrosstableTenantLookup = {
  forRoomId: (roomId) => {
    if (roomId.startsWith('xq_'))
      return { export: { gameRouteBase: '/xiangqi/game', finishedGame: () => null } };
    if (roomId.startsWith('bq_'))
      return { export: { gameRouteBase: '/banqi/game', finishedGame: () => null } };
    if (roomId.startsWith('dchx_')) return { export: null };
    return null;
  },
  forSpecId: (specId) => {
    if (specId === 'xiangqi')
      return { export: { gameRouteBase: '/xiangqi/game', finishedGame: () => null } };
    if (specId === 'banqi')
      return { export: { gameRouteBase: '/banqi/game', finishedGame: () => null } };
    return null;
  },
};

function user(
  color: GameParticipant['color'],
  id: string,
  visibility: GameParticipant['visibility'] = 'public',
): GameParticipant {
  return { color, displayName: `User ${id}`, subjectType: 'user', subjectId: id, visibility };
}

function engine(color: GameParticipant['color'], id: string): GameParticipant {
  return {
    color,
    displayName: `Engine ${id}`,
    subjectType: 'engine-version',
    subjectId: id,
    visibility: 'public',
  };
}

function guest(color: GameParticipant['color']): GameParticipant {
  return {
    color,
    displayName: 'Guest',
    subjectType: 'guest',
    subjectId: null,
    visibility: 'public',
  };
}

test('crosstable pair: two public accounts resolve in seat order', () => {
  const resolution = resolveCrosstablePair(
    {
      roomId: 'xq_abc',
      variant: 'xiangqi',
      participants: [user('black', 'bob'), user('red', 'alice')],
    },
    LOOKUP,
  );
  assert.deepEqual(resolution, {
    ok: true,
    pair: {
      a: { subjectType: 'user', subjectId: 'alice' },
      b: { subjectType: 'user', subjectId: 'bob' },
    },
    players: [
      { name: 'User alice', kind: 'account', handle: null, botId: null },
      { name: 'User bob', kind: 'account', handle: null, botId: null },
    ],
  });
});

test('crosstable pair: an engine seat against an account is fine, a bot is an account', () => {
  const vsEngine = resolveCrosstablePair(
    {
      roomId: 'bq_1',
      variant: 'banqi',
      participants: [user('red', 'alice'), engine('black', 'misty-banqi')],
    },
    LOOKUP,
  );
  assert.equal(vsEngine.ok, true);
  assert.deepEqual(vsEngine.ok && vsEngine.players[1], {
    name: 'Engine misty-banqi',
    kind: 'engine',
    // A raw engine version has no public page, so it stays unlinkable.
    handle: null,
    botId: null,
  });
  assert.deepEqual(vsEngine.ok && vsEngine.pair.b, {
    subjectType: 'engine-version',
    subjectId: 'misty-banqi',
  });

  const vsBot = resolveCrosstablePair(
    {
      roomId: 'room-1',
      variant: 'dark-chess',
      participants: [
        user('white', 'alice'),
        {
          color: 'black',
          displayName: 'Misty',
          subjectType: 'bot',
          subjectId: 'misty',
          visibility: 'public',
        },
      ],
    },
    LOOKUP,
  );
  // 'account' merges the bot with human seats; botId is what actually addresses
  // its /bot/:id page, which is why the row carries it separately from `kind`.
  assert.deepEqual(vsBot.ok && vsBot.players[1], {
    name: 'Misty',
    kind: 'account',
    handle: null,
    botId: 'misty',
  });
});

test('crosstable pair: a guest, manual, imported or subject-less seat is reason guest', () => {
  const guestSeat = resolveCrosstablePair(
    {
      roomId: 'room-1',
      variant: 'dark-chess',
      participants: [guest('white'), user('black', 'bob')],
    },
    LOOKUP,
  );
  assert.deepEqual(guestSeat, { ok: false, reason: 'guest' });

  const imported = resolveCrosstablePair(
    {
      roomId: 'xq_1',
      variant: 'xiangqi',
      participants: [
        user('red', 'alice'),
        {
          color: 'black',
          displayName: 'Hu Ronghua',
          subjectType: 'imported',
          subjectId: null,
          visibility: 'public',
        },
      ],
    },
    LOOKUP,
  );
  assert.deepEqual(imported, { ok: false, reason: 'guest' });

  const nullId = resolveCrosstablePair(
    {
      roomId: 'xq_1',
      variant: 'xiangqi',
      participants: [
        user('red', 'alice'),
        {
          color: 'black',
          displayName: 'Bob',
          subjectType: 'user',
          subjectId: null,
          visibility: 'public',
        },
      ],
    },
    LOOKUP,
  );
  assert.deepEqual(nullId, { ok: false, reason: 'guest' });

  // A guest seat that is also private reads as 'guest': signing in is the fix.
  const privateGuest = resolveCrosstablePair(
    {
      roomId: 'room-1',
      variant: 'dark-chess',
      participants: [{ ...guest('white'), visibility: 'private' }, user('black', 'bob')],
    },
    LOOKUP,
  );
  assert.deepEqual(privateGuest, { ok: false, reason: 'guest' });
});

test('crosstable pair: a private (redacted) account seat is reason private', () => {
  const resolution = resolveCrosstablePair(
    {
      roomId: 'room-1',
      variant: 'dark-chess',
      participants: [user('white', 'alice', 'private'), user('black', 'bob')],
    },
    LOOKUP,
  );
  assert.deepEqual(resolution, { ok: false, reason: 'private' });
});

test('crosstable pair: a variant with no review route is unsupported, before any seat check', () => {
  const resolution = resolveCrosstablePair(
    {
      roomId: 'zz_1',
      variant: 'no-such-variant',
      participants: [guest('white'), user('black', 'bob')],
    },
    LOOKUP,
  );
  assert.deepEqual(resolution, { ok: false, reason: 'unsupported' });
});

test('crosstable pair: the same subject on both seats is unsupported', () => {
  const resolution = resolveCrosstablePair(
    {
      roomId: 'bq_self',
      variant: 'banqi',
      participants: [engine('red', 'misty-banqi'), engine('black', 'misty-banqi')],
    },
    LOOKUP,
  );
  assert.deepEqual(resolution, { ok: false, reason: 'unsupported' });
});

test('crosstable seats: red is the first seat everywhere', () => {
  assert.equal(crosstableSeatForColor('xiangqi', 'red'), 'white');
  assert.equal(crosstableSeatForColor('xiangqi', 'black'), 'black');
  assert.equal(crosstableSeatForColor('banqi', 'red'), 'white');
  assert.equal(crosstableSeatForColor('jungle', 'red'), 'white');
  assert.equal(crosstableSeatForColor('dark-chess', 'white'), 'white');
  assert.equal(crosstableSeatForColor('dark-chess', 'black'), 'black');
});

test('crosstable outcome: a xiangqi red-wins with a on black is a loss for a', () => {
  assert.equal(crosstableOutcome('red-wins', 'xiangqi', 'black'), 'b');
  assert.equal(crosstableOutcome('red-wins', 'xiangqi', 'white'), 'a');
  assert.equal(crosstableOutcome('black-wins', 'xiangqi', 'black'), 'a');
  assert.equal(crosstableOutcome('black-wins', 'xiangqi', 'white'), 'b');
  assert.equal(crosstableOutcome('draw', 'xiangqi', 'white'), 'draw');
});

test('crosstable outcome: chess results map on the seat directly', () => {
  assert.equal(crosstableOutcome('white-wins', 'dark-chess', 'white'), 'a');
  assert.equal(crosstableOutcome('white-wins', 'dark-chess', 'black'), 'b');
  assert.equal(crosstableOutcome('black-wins', 'dark-chess', 'black'), 'a');
  assert.equal(crosstableOutcome('draw', 'dark-chess', 'black'), 'draw');
});

test('crosstable review url: chess stack, tenant room, legacy room id, unknown variant', () => {
  assert.equal(crosstableReviewUrl('room-1', 'dark-chess', LOOKUP), '/game/room-1');
  assert.equal(crosstableReviewUrl('room-3', 'fog', LOOKUP), '/game/room-3');
  // Dark-chess correspondence: a registered prefix with no route base still
  // reviews at the chess stack's /game/:id.
  assert.equal(crosstableReviewUrl('dchx_1', 'dark-chess', LOOKUP), '/game/dchx_1');
  assert.equal(crosstableReviewUrl('xq_1', 'xiangqi', LOOKUP), '/xiangqi/game/xq_1');
  assert.equal(crosstableReviewUrl('bq_1', 'banqi', LOOKUP), '/banqi/game/bq_1');
  // A legacy room id with no tenant prefix resolves through the spec.
  assert.equal(crosstableReviewUrl('legacy-1', 'xiangqi', LOOKUP), '/xiangqi/game/legacy-1');
  // Unknown variants and un-registered tenants get no URL, never a guess.
  assert.equal(crosstableReviewUrl('room-9', 'no-such-variant', LOOKUP), null);
  assert.equal(crosstableReviewUrl('a b', 'dark-chess', LOOKUP), '/game/a%20b');
});

test('crosstable build: score tallies the whole record from a side, games list newest first', () => {
  const players: [CrosstablePlayer, CrosstablePlayer] = [
    { name: 'Alice', kind: 'account', handle: null, botId: null },
    { name: 'Bob', kind: 'account', handle: null, botId: null },
  ];
  const body = buildCrosstable({
    variant: 'xiangqi',
    players,
    games: [
      {
        roomId: 'xq_3',
        variant: 'xiangqi',
        result: 'black-wins',
        endedAt: new Date('2026-08-03T00:00:00Z'),
        aColor: 'black',
      },
      {
        roomId: 'xq_2',
        variant: 'xiangqi',
        result: 'red-wins',
        endedAt: new Date('2026-08-02T00:00:00Z'),
        aColor: 'black',
      },
      {
        roomId: 'xq_1',
        variant: 'xiangqi',
        result: 'draw',
        endedAt: new Date('2026-08-01T00:00:00Z'),
        aColor: 'red',
      },
    ],
    tallies: [
      { aColor: 'red', result: 'red-wins', count: 4 },
      { aColor: 'black', result: 'red-wins', count: 2 },
      { aColor: 'black', result: 'black-wins', count: 1 },
      { aColor: 'red', result: 'draw', count: 3 },
    ],
    lookup: LOOKUP,
  });
  assert.deepEqual(body, {
    available: true,
    variant: 'xiangqi',
    players,
    score: { a: 5, b: 2, draws: 3, total: 10 },
    games: [
      {
        roomId: 'xq_3',
        reviewUrl: '/xiangqi/game/xq_3',
        endedAt: '2026-08-03T00:00:00.000Z',
        aSeat: 'black',
        outcome: 'a',
      },
      {
        roomId: 'xq_2',
        reviewUrl: '/xiangqi/game/xq_2',
        endedAt: '2026-08-02T00:00:00.000Z',
        aSeat: 'black',
        outcome: 'b',
      },
      {
        roomId: 'xq_1',
        reviewUrl: '/xiangqi/game/xq_1',
        endedAt: '2026-08-01T00:00:00.000Z',
        aSeat: 'white',
        outcome: 'draw',
      },
    ],
  });
});
