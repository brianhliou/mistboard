// GET /api/correspondence/games/finished: the /correspondence page's "Recently
// finished" list. The query itself is covered in
// persistence-correspondence-finished.test.ts; this covers the window, the cap,
// the history link and the "new" mark.

import assert from 'node:assert/strict';
import test from 'node:test';
import { DAY_MS } from '@mistboard/game';
import type { ProfileGameRecord } from '../persistence-games.js';
import {
  FINISHED_LIMIT,
  FINISHED_WINDOW_DAYS,
  type FinishedCorrespondenceDeps,
  finishedCorrespondenceGamesForUser,
  isNewFinishedGame,
} from './correspondence-games.js';

const NOW = new Date('2026-10-14T12:00:00Z');
const SEEN = new Date('2026-10-13T12:00:00Z');
const BEFORE_SEEN = new Date('2026-10-12T12:00:00Z');
const AFTER_SEEN = new Date('2026-10-14T08:00:00Z');

function game(overrides: Partial<ProfileGameRecord>): ProfileGameRecord {
  return {
    roomId: 'xq_1',
    variant: 'xiangqi',
    mode: 'pvp',
    result: 'black-wins',
    termination: 'resignation',
    plyCount: 40,
    startedAt: new Date('2026-10-01T00:00:00Z'),
    endedAt: AFTER_SEEN,
    whiteName: 'alice',
    blackName: 'bob',
    corpusId: null,
    rated: false,
    visibility: 'public',
    participants: [],
    playerColor: 'red',
    initialMs: DAY_MS,
    incrementMs: 0,
    ...overrides,
  };
}

test('isNewFinishedGame: ended after the watermark by the opponent or the clock', () => {
  // Opponent resigned (the player, red, won).
  assert.equal(
    isNewFinishedGame(game({ result: 'red-wins', termination: 'resignation' }), SEEN),
    true,
  );
  // Opponent mated the player.
  assert.equal(
    isNewFinishedGame(game({ result: 'black-wins', termination: 'checkmate' }), SEEN),
    true,
  );
  // The player ran out of days.
  assert.equal(
    isNewFinishedGame(game({ result: 'black-wins', termination: 'timeout' }), SEEN),
    true,
  );
  // A draw.
  assert.equal(isNewFinishedGame(game({ result: 'draw', termination: 'repetition' }), SEEN), true);
});

test('isNewFinishedGame: not new when the player ended it or had already looked', () => {
  // The player resigned.
  assert.equal(
    isNewFinishedGame(game({ result: 'black-wins', termination: 'resignation' }), SEEN),
    false,
  );
  // The player delivered mate (black seat, black wins).
  assert.equal(
    isNewFinishedGame(
      game({ playerColor: 'black', result: 'black-wins', termination: 'checkmate' }),
      SEEN,
    ),
    false,
  );
  // A chess seat (white) that mated.
  assert.equal(
    isNewFinishedGame(
      game({
        variant: 'dark-chess',
        playerColor: 'white',
        result: 'white-wins',
        termination: 'king-captured',
      }),
      SEEN,
    ),
    false,
  );
  // Ended before the page was last opened.
  assert.equal(
    isNewFinishedGame(game({ endedAt: BEFORE_SEEN, termination: 'timeout' }), SEEN),
    false,
  );
  // No watermark (unknown account): nothing is new.
  assert.equal(isNewFinishedGame(game({ termination: 'timeout' }), null), false);
});

test('the endpoint reads a 14-day window capped at 10 and links the profile', async () => {
  let asked: { userId: string; since: Date; limit: number } | null = null;
  const deps: FinishedCorrespondenceDeps = {
    list: async (userId, options) => {
      asked = { userId, ...options };
      return [
        game({ roomId: 'xq_new', result: 'black-wins', termination: 'checkmate' }),
        game({ roomId: 'xq_old', endedAt: BEFORE_SEEN, result: 'red-wins' }),
      ];
    },
    seenAt: async () => SEEN,
    markUnavailable: async (games) => games,
  };
  const body = await finishedCorrespondenceGamesForUser(
    { id: 'u_alice', handle: 'alice' },
    deps,
    NOW,
  );
  assert.deepEqual(asked, {
    userId: 'u_alice',
    since: new Date(NOW.getTime() - FINISHED_WINDOW_DAYS * DAY_MS),
    limit: FINISHED_LIMIT,
  });
  assert.equal(FINISHED_WINDOW_DAYS, 14);
  assert.equal(FINISHED_LIMIT, 10);
  assert.equal(body.windowDays, 14);
  assert.equal(body.historyHref, '/@/alice');
  assert.deepEqual(
    body.games.map((row) => [row.roomId, row.isNew]),
    [
      ['xq_new', true],
      ['xq_old', false],
    ],
  );
});

test('the endpoint keeps an unopenable game, marked, as the profile does', async () => {
  const deps: FinishedCorrespondenceDeps = {
    list: async () => [game({ roomId: 'old_rules' })],
    seenAt: async () => SEEN,
    markUnavailable: async (games) => games.map((row) => ({ ...row, unavailable: 'old-rules' })),
  };
  const body = await finishedCorrespondenceGamesForUser({ id: 'u', handle: 'a b' }, deps, NOW);
  assert.equal(body.games[0]?.unavailable, 'old-rules');
  assert.equal(body.historyHref, '/@/a%20b');
});
