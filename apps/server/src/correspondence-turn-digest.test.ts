import assert from 'node:assert/strict';
import test from 'node:test';
import {
  digestSubject,
  digestText,
  digestWindowStart,
  MIN_WAIT_MS,
  sweepCorrespondenceTurnDigests,
} from './correspondence-turn-digest.js';
import type { CorrespondenceDigestCandidate } from './persistence-correspondence-digest.js';

const HOUR_MS = 60 * 60 * 1000;

test('digestWindowStart is the latest 14:00 UTC mark at or before now', () => {
  assert.equal(
    digestWindowStart(new Date('2026-09-20T14:30:00Z')).toISOString(),
    '2026-09-20T14:00:00.000Z',
  );
  assert.equal(
    digestWindowStart(new Date('2026-09-20T14:00:00Z')).toISOString(),
    '2026-09-20T14:00:00.000Z',
  );
  assert.equal(
    digestWindowStart(new Date('2026-09-20T13:59:00Z')).toISOString(),
    '2026-09-19T14:00:00.000Z',
  );
  // Month boundary.
  assert.equal(
    digestWindowStart(new Date('2026-10-01T02:00:00Z')).toISOString(),
    '2026-09-30T14:00:00.000Z',
  );
});

function candidate(
  userId: string,
  games: Array<{ roomId: string; warned?: boolean; opponentName?: string | null }>,
  now: Date,
): CorrespondenceDigestCandidate {
  return {
    userId,
    email: `${userId}@example.com`,
    games: games.map((game) => ({
      roomId: game.roomId,
      gameSpecId: 'xiangqi',
      opponentName: game.opponentName === undefined ? 'Opp' : game.opponentName,
      dueAt: new Date(now.getTime() + 2 * 24 * HOUR_MS),
      warned: game.warned ?? false,
    })),
  };
}

test('sweep asks for the current window, sends once per candidate, marks after success', async () => {
  const now = new Date('2026-09-20T15:00:00Z');
  const queries: unknown[] = [];
  const sent: string[] = [];
  const marked: Array<[string, number]> = [];
  await sweepCorrespondenceTurnDigests(now, {
    enabled: true,
    listCandidates: async (query) => {
      queries.push(query);
      return [
        candidate('u1', [{ roomId: 'r1' }, { roomId: 'r2', warned: true }], now),
        candidate('u2', [{ roomId: 'r3' }], now),
      ];
    },
    send: async (c) => {
      sent.push(c.userId);
      return c.userId !== 'u2';
    },
    markSent: async (userId, at) => {
      marked.push([userId, at.getTime()]);
    },
  });
  assert.deepEqual(queries, [
    {
      now,
      sentBefore: new Date('2026-09-20T14:00:00Z'),
      idleSince: new Date(now.getTime() - MIN_WAIT_MS),
    },
  ]);
  assert.deepEqual(sent, ['u1', 'u2']);
  // u2's send failed: unmarked, so the next tick retries.
  assert.deepEqual(marked, [['u1', now.getTime()]]);
});

test('an account whose waiting games were all deadline-warned is skipped', async () => {
  const now = new Date('2026-09-20T15:00:00Z');
  const sent: string[] = [];
  await sweepCorrespondenceTurnDigests(now, {
    enabled: true,
    listCandidates: async () => [
      candidate(
        'warned',
        [
          { roomId: 'r1', warned: true },
          { roomId: 'r2', warned: true },
        ],
        now,
      ),
      candidate('mixed', [{ roomId: 'r3', warned: true }, { roomId: 'r4' }], now),
    ],
    send: async (c) => {
      sent.push(c.userId);
      return true;
    },
    markSent: async () => {},
  });
  assert.deepEqual(sent, ['mixed']);
});

test('a failing send or list never propagates, and disabled is a no-op', async () => {
  const now = new Date('2026-09-20T15:00:00Z');
  let listed = false;
  await sweepCorrespondenceTurnDigests(now, {
    enabled: false,
    listCandidates: async () => {
      listed = true;
      return [];
    },
  });
  assert.equal(listed, false);

  await sweepCorrespondenceTurnDigests(now, {
    enabled: true,
    listCandidates: async () => {
      throw new Error('db down');
    },
  });

  const marked: string[] = [];
  await sweepCorrespondenceTurnDigests(now, {
    enabled: true,
    listCandidates: async () => [candidate('u1', [{ roomId: 'r1' }], now)],
    send: async () => {
      throw new Error('resend down');
    },
    markSent: async (userId) => {
      marked.push(userId);
    },
  });
  assert.deepEqual(marked, []);
});

test('the email names every game with its opponent, time left and link', () => {
  const now = new Date('2026-09-20T15:00:00Z');
  const c = candidate('u1', [{ roomId: 'xq_one' }, { roomId: 'xq_two', opponentName: null }], now);
  assert.equal(digestSubject(1), 'Your move in 1 correspondence game');
  assert.equal(digestSubject(2), 'Your move in 2 correspondence games');
  const text = digestText(c, now);
  assert.match(text, /^2 correspondence games are waiting on your move:/);
  assert.match(text, /- Xiangqi vs Opp, 2 days left: https:\/\/mistboard\.com\/room\/xq_one/);
  assert.match(
    text,
    /- Xiangqi vs your opponent, 2 days left: https:\/\/mistboard\.com\/room\/xq_two/,
  );
  assert.match(text, /\/correspondence\n/);
  assert.match(text, /at most one of these a day/);
});
