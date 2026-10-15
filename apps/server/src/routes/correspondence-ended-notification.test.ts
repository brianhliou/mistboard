// The bell's "your correspondence game ended" rows (GET /api/notifications
// correspondenceFinished). One notice per way a game ends, for the seat that
// did not end it; nothing for the seat whose own act ended it. The query and
// the end-handler re-run are covered against Postgres in
// persistence-correspondence-finished.test.ts.

import assert from 'node:assert/strict';
import test from 'node:test';
import { DAY_MS } from '@mistboard/game';
import type { GameParticipantColor, ProfileGameRecord } from '../persistence-games.js';
import {
  FINISHED_BELL_SCAN,
  FINISHED_WINDOW_DAYS,
  unseenFinishedCorrespondenceGames,
} from './correspondence-games.js';

const NOW = new Date('2026-10-14T12:00:00Z');
const SEEN = new Date('2026-10-13T12:00:00Z');
const ENDED = new Date('2026-10-14T08:00:00Z');

// One finished game between alice (red) and bob (black), as each seat's own
// profile query returns it.
function asSeat(
  seat: GameParticipantColor,
  facts: { result: string; termination: string; roomId?: string },
): ProfileGameRecord {
  return {
    roomId: facts.roomId ?? 'xq_corr',
    variant: 'xiangqi',
    mode: 'pvp',
    result: facts.result,
    termination: facts.termination,
    plyCount: 40,
    startedAt: new Date('2026-10-01T00:00:00Z'),
    endedAt: ENDED,
    whiteName: null,
    blackName: null,
    corpusId: null,
    rated: false,
    visibility: 'public',
    participants: [
      {
        color: 'red',
        displayName: 'Alice',
        subjectType: 'user',
        subjectId: 'u_alice',
        visibility: 'public',
        handle: 'alice',
      },
      {
        color: 'black',
        displayName: 'Bob',
        subjectType: 'user',
        subjectId: 'u_bob',
        visibility: 'public',
        // Bob's profile is private: named, never linked.
        handle: null,
      },
    ],
    playerColor: seat,
    initialMs: DAY_MS,
    incrementMs: 0,
  };
}

async function noticesFor(
  seat: GameParticipantColor,
  facts: { result: string; termination: string },
) {
  return unseenFinishedCorrespondenceGames(
    seat === 'red' ? 'u_alice' : 'u_bob',
    { limit: 3 },
    { list: async () => [asSeat(seat, facts)], seenAt: async () => SEEN },
    NOW,
  );
}

const CASES: Array<{
  how: string;
  facts: { result: string; termination: string };
  red: 'won' | 'lost' | 'draw' | null;
  black: 'won' | 'lost' | 'draw' | null;
}> = [
  // Bob's move mates Alice: Alice is told, Bob made the move.
  {
    how: 'mate',
    facts: { result: 'black-wins', termination: 'checkmate' },
    red: 'lost',
    black: null,
  },
  // Bob resigns: Alice is told, Bob resigned.
  {
    how: 'resign',
    facts: { result: 'red-wins', termination: 'resignation' },
    red: 'won',
    black: null,
  },
  // Alice runs out of days: both are told; nobody acted.
  {
    how: 'timeout',
    facts: { result: 'black-wins', termination: 'timeout' },
    red: 'lost',
    black: 'won',
  },
  // A draw: both are told.
  { how: 'draw', facts: { result: 'draw', termination: 'repetition' }, red: 'draw', black: 'draw' },
];

for (const { how, facts, red, black } of CASES) {
  test(`a game that ends by ${how} tells exactly the seat that did not end it`, async () => {
    for (const [seat, expected] of [
      ['red', red],
      ['black', black],
    ] as const) {
      const notices = await noticesFor(seat, facts);
      if (expected === null) {
        assert.deepEqual(notices, { total: 0, games: [] }, `${seat} ended it: no notice`);
        continue;
      }
      assert.equal(notices.total, 1, `${seat}: one notice`);
      assert.deepEqual(notices.games[0], {
        roomId: 'xq_corr',
        gameSpecId: 'xiangqi',
        outcome: expected,
        termination: facts.termination,
        opponent:
          seat === 'red'
            ? { handle: null, displayName: 'Bob' }
            : { handle: 'alice', displayName: 'Alice' },
        endedAt: ENDED.toISOString(),
      });
    }
  });
}

test('a row carries the result and the reason, never a board', async () => {
  const notices = await noticesFor('red', { result: 'black-wins', termination: 'checkmate' });
  assert.deepEqual(Object.keys(notices.games[0] ?? {}).sort(), [
    'endedAt',
    'gameSpecId',
    'opponent',
    'outcome',
    'roomId',
    'termination',
  ]);
});

test('reads from the watermark, or the page window when the watermark is older', async () => {
  const asked: Array<{ since: Date; limit: number }> = [];
  const list = async (_userId: string, options: { since: Date; limit: number }) => {
    asked.push(options);
    return [];
  };
  await unseenFinishedCorrespondenceGames(
    'u',
    { limit: 3 },
    { list, seenAt: async () => SEEN },
    NOW,
  );
  const longAgo = new Date('2026-01-01T00:00:00Z');
  await unseenFinishedCorrespondenceGames(
    'u',
    { limit: 3 },
    { list, seenAt: async () => longAgo },
    NOW,
  );
  assert.deepEqual(asked, [
    { since: SEEN, limit: FINISHED_BELL_SCAN },
    { since: new Date(NOW.getTime() - FINISHED_WINDOW_DAYS * DAY_MS), limit: FINISHED_BELL_SCAN },
  ]);
});

test('counts every unseen game but returns only the capped rows, and nothing without a watermark', async () => {
  const games = ['a', 'b', 'c', 'd', 'e'].map((roomId) =>
    asSeat('red', { roomId, result: 'black-wins', termination: 'timeout' }),
  );
  // The player's own resignation in the same window is skipped, not counted.
  games.push(asSeat('red', { roomId: 'f', result: 'black-wins', termination: 'resignation' }));
  const notices = await unseenFinishedCorrespondenceGames(
    'u_alice',
    { limit: 3 },
    { list: async () => games, seenAt: async () => SEEN },
    NOW,
  );
  assert.equal(notices.total, 5);
  assert.deepEqual(
    notices.games.map((row) => row.roomId),
    ['a', 'b', 'c'],
  );

  const unknown = await unseenFinishedCorrespondenceGames(
    'u_nobody',
    { limit: 3 },
    { list: async () => games, seenAt: async () => null },
    NOW,
  );
  assert.deepEqual(unknown, { total: 0, games: [] });
});
