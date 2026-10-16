import assert from 'node:assert/strict';
import test from 'node:test';
import { DAY_MS } from '@mistboard/game';
import { deadlineWarningLeadMs, sweepDeadlineWarnings } from './correspondence-deadline-warning.js';
import type { DeadlineWarningCandidate } from './persistence-room-deadlines.js';

const HOUR_MS = 60 * 60 * 1000;

test('deadlineWarningLeadMs caps at 24h and scales to a third for short allowances', () => {
  assert.equal(deadlineWarningLeadMs(1 * DAY_MS), 8 * HOUR_MS); // 1-day -> 8h
  assert.equal(deadlineWarningLeadMs(3 * DAY_MS), DAY_MS); // 3-day -> 24h cap
  assert.equal(deadlineWarningLeadMs(7 * DAY_MS), DAY_MS); // 7-day -> 24h cap
});

function candidate(
  now: Date,
  roomId: string,
  allowanceMs: number,
  remainingMs: number,
): DeadlineWarningCandidate {
  return {
    roomId,
    gameSpecId: 'xiangqi',
    allowanceMs,
    dueAt: new Date(now.getTime() + remainingMs),
    recipientEmail: `${roomId}@example.com`,
    recipientUserId: `user-${roomId}`,
    recipientLocale: null,
    opponentName: 'Opponent',
  };
}

test('sweepDeadlineWarnings sends + marks only within the per-game lead', async () => {
  const now = new Date('2026-06-12T00:00:00Z');
  // 1-day games (lead 8h): one at 6h left is inside, one at 20h is outside, one
  // already due belongs to the timeout pass.
  const candidates = [
    candidate(now, 'in', DAY_MS, 6 * HOUR_MS),
    candidate(now, 'out', DAY_MS, 20 * HOUR_MS),
    candidate(now, 'due', DAY_MS, -1000),
  ];
  const sent: string[] = [];
  const marked: string[] = [];
  await sweepDeadlineWarnings(now, {
    enabled: true,
    listCandidates: async () => candidates,
    send: async (c) => {
      sent.push(c.roomId);
      return true;
    },
    markWarned: async (roomId) => {
      marked.push(roomId);
    },
  });
  assert.deepEqual(sent, ['in']);
  assert.deepEqual(marked, ['in']);
});

test('a 7-day game warns a full day out (cap), not a third of the week', async () => {
  const now = new Date('2026-06-12T00:00:00Z');
  const sent: string[] = [];
  await sweepDeadlineWarnings(now, {
    enabled: true,
    // 20h left is inside the 24h cap for a 7-day game.
    listCandidates: async () => [candidate(now, 'week', 7 * DAY_MS, 20 * HOUR_MS)],
    send: async (c) => {
      sent.push(c.roomId);
      return true;
    },
    markWarned: async () => {},
  });
  assert.deepEqual(sent, ['week']);
});

test('sweepDeadlineWarnings does not mark when the send fails (so it retries)', async () => {
  const now = new Date('2026-06-12T00:00:00Z');
  const marked: string[] = [];
  await sweepDeadlineWarnings(now, {
    enabled: true,
    listCandidates: async () => [candidate(now, 'r', DAY_MS, 4 * HOUR_MS)],
    send: async () => false,
    markWarned: async (roomId) => {
      marked.push(roomId);
    },
  });
  assert.deepEqual(marked, []);
});

test('sweepDeadlineWarnings is a no-op when disabled', async () => {
  let listed = false;
  await sweepDeadlineWarnings(new Date('2026-06-12T00:00:00Z'), {
    enabled: false,
    listCandidates: async () => {
      listed = true;
      return [];
    },
  });
  assert.equal(listed, false);
});
