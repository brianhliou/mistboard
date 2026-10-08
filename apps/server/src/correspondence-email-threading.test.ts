// Gmail threads mail by subject. Every correspondence email used to carry one
// fixed subject per kind ("Your game has started", "Your move is running out
// of time", "Your move in 1 correspondence game"), so two different games
// landed in one conversation and the newer one hid under the older. These
// tests drive each kind through its real send path, with the provider call
// captured, and require two different games to get two different subjects.
//
// The env is set before the modules load (send-email.ts and the senders read
// it at import), hence the dynamic imports. The key is a placeholder and fetch
// is stubbed, so nothing leaves the process.

import assert from 'node:assert/strict';
import test from 'node:test';

process.env.RESEND_API_KEY = 're_placeholder_for_tests';
process.env.MISTBOARD_AUTH_EMAIL_FROM = 'Mistboard <play@example.com>';

type SentBody = { to: string[]; subject: string; text: string; html?: string };
const sent: SentBody[] = [];
globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
  sent.push(JSON.parse(String(init?.body)) as SentBody);
  return new Response('{}', { status: 200 });
}) as typeof fetch;

const { sendCorrespondenceStartEmail } = await import('./correspondence-start-email.js');
const { sweepDeadlineWarnings } = await import('./correspondence-deadline-warning.js');
const { sweepCorrespondenceTurnDigests } = await import('./correspondence-turn-digest.js');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

test('two started games get two subjects, each naming the variant and opponent', async () => {
  sent.length = 0;
  const deps = { enabled: true, loadRecipient: async () => ({ email: 'creator@example.com' }) };
  for (const [roomId, gameSpecId, accepterName] of [
    ['bq_1', 'banqi', 'rebirthfox333'],
    ['xq_2', 'xiangqi', 'countallloss'],
  ] as const) {
    await sendCorrespondenceStartEmail(
      {
        roomId,
        gameSpecId,
        creatorUserId: 'u1',
        accepterName,
        creatorOnMove: true,
        daysPerMove: 1,
      },
      deps,
    );
  }
  assert.equal(sent.length, 2);
  assert.notEqual(sent[0]?.subject, sent[1]?.subject);
  assert.match(sent[0]?.subject ?? '', /Banqi/);
  assert.match(sent[0]?.subject ?? '', /rebirthfox333/);
  assert.match(sent[1]?.subject ?? '', /Xiangqi/i);
  assert.match(sent[1]?.subject ?? '', /countallloss/);
});

test('two deadline warnings get two subjects, each naming the variant and opponent', async () => {
  sent.length = 0;
  const now = new Date('2026-10-08T12:00:00Z');
  const candidate = (roomId: string, gameSpecId: string, opponentName: string) => ({
    roomId,
    gameSpecId,
    dueAt: new Date(now.getTime() + 2 * HOUR_MS),
    allowanceMs: DAY_MS,
    recipientEmail: 'player@example.com',
    recipientUserId: 'u1',
    recipientLocale: null,
    opponentName,
  });
  await sweepDeadlineWarnings(now, {
    enabled: true,
    listCandidates: async () => [
      candidate('dxq_1', 'dark-xiangqi', 'mistwalker'),
      candidate('jq_2', 'jieqi', 'flipper'),
    ],
    markWarned: async () => {},
  });
  assert.equal(sent.length, 2);
  assert.notEqual(sent[0]?.subject, sent[1]?.subject);
  assert.match(sent[0]?.subject ?? '', /Fog Xiangqi/);
  assert.match(sent[0]?.subject ?? '', /mistwalker/);
  assert.match(sent[1]?.subject ?? '', /jieqi/i);
  assert.match(sent[1]?.subject ?? '', /flipper/);
});

test('two digests about different games get two subjects', async () => {
  sent.length = 0;
  const now = new Date('2026-10-08T15:00:00Z');
  const user = (userId: string, roomId: string, gameSpecId: string, opponentName: string) => ({
    userId,
    email: `${userId}@example.com`,
    locale: null,
    games: [
      { roomId, gameSpecId, opponentName, dueAt: new Date(now.getTime() + DAY_MS), warned: false },
    ],
  });
  await sweepCorrespondenceTurnDigests(now, {
    enabled: true,
    listCandidates: async () => [
      user('u1', 'bq_1', 'banqi', 'rebirthfox333'),
      user('u2', 'jg_2', 'jungle', 'tigerlily'),
    ],
    markSent: async () => {},
  });
  assert.equal(sent.length, 2);
  assert.notEqual(sent[0]?.subject, sent[1]?.subject);
  assert.match(sent[0]?.subject ?? '', /banqi/i);
  assert.match(sent[0]?.subject ?? '', /rebirthfox333/);
  assert.match(sent[1]?.subject ?? '', /Jungle Chess/);
  assert.match(sent[1]?.subject ?? '', /tigerlily/);
});
