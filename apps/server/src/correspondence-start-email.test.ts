import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type CorrespondenceStartNotice,
  notifyCorrespondenceStart,
  sendCorrespondenceStartEmail,
} from './correspondence-start-email.js';
import { correspondenceStartNoticeFor } from './routes/correspondence-seeks.js';

function notice(overrides: Partial<CorrespondenceStartNotice> = {}): CorrespondenceStartNotice {
  return {
    roomId: 'xq_room',
    gameSpecId: 'xiangqi',
    creatorUserId: 'user-creator',
    accepterName: 'countallloss',
    creatorOnMove: true,
    daysPerMove: 1,
    ...overrides,
  };
}

test('sends to the seek creator, never to the accepter', async () => {
  const asked: string[] = [];
  const sent: Array<{ to: string; notice: CorrespondenceStartNotice }> = [];
  const ok = await sendCorrespondenceStartEmail(notice(), {
    enabled: true,
    loadRecipient: async (userId) => {
      asked.push(userId);
      return { email: 'creator@example.com' };
    },
    send: async (to, n) => {
      sent.push({ to, notice: n });
      return true;
    },
  });
  assert.equal(ok, true);
  assert.deepEqual(asked, ['user-creator']);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.to, 'creator@example.com');
});

test('sends nothing when the recipient query withholds a mailbox', async () => {
  // The opt-out and the closed/no-email cases all surface as a null row, so
  // this module has exactly one "do not send" branch to get wrong.
  let sends = 0;
  const ok = await sendCorrespondenceStartEmail(notice(), {
    enabled: true,
    loadRecipient: async () => null,
    send: async () => {
      sends += 1;
      return true;
    },
  });
  assert.equal(ok, false);
  assert.equal(sends, 0);
});

test('sends nothing when email is not configured', async () => {
  let loads = 0;
  const ok = await sendCorrespondenceStartEmail(notice(), {
    enabled: false,
    loadRecipient: async () => {
      loads += 1;
      return { email: 'creator@example.com' };
    },
    send: async () => true,
  });
  assert.equal(ok, false);
  assert.equal(loads, 0, 'a disabled sender must not touch the database');
});

test('reports the send result rather than assuming success', async () => {
  const ok = await sendCorrespondenceStartEmail(notice(), {
    enabled: true,
    loadRecipient: async () => ({ email: 'creator@example.com' }),
    send: async () => false,
  });
  assert.equal(ok, false);
});

test('carries whether the creator owes the first move', async () => {
  const seen: boolean[] = [];
  const deps = {
    enabled: true,
    loadRecipient: async () => ({ email: 'creator@example.com' }),
    send: async (_to: string, n: CorrespondenceStartNotice) => {
      seen.push(n.creatorOnMove);
      return true;
    },
  };
  await sendCorrespondenceStartEmail(notice({ creatorOnMove: true }), deps);
  await sendCorrespondenceStartEmail(notice({ creatorOnMove: false }), deps);
  assert.deepEqual(seen, [true, false]);
});

test('notifyCorrespondenceStart swallows a rejecting send', async () => {
  // The accept route calls this without awaiting; an unhandled rejection here
  // would take the process down on a mail outage, turning a courtesy email into
  // an availability incident.
  notifyCorrespondenceStart(notice(), {
    enabled: true,
    loadRecipient: async () => {
      throw new Error('database down');
    },
    send: async () => true,
  });
  await new Promise((resolve) => setImmediate(resolve));
});

test('the accept route addresses the creator and gets the mover right', async () => {
  const seek = { creatorUserId: 'user-creator', daysPerMove: 3, gameSpecId: 'banqi' };
  const accepter = { displayName: 'Accepter', handle: 'accepter' };

  // Creator took first: they owe move 1, and the mail still goes to them.
  const first = correspondenceStartNoticeFor('xq_1', seek, accepter, 'first');
  assert.equal(first.creatorUserId, 'user-creator');
  assert.equal(first.accepterName, 'Accepter');
  assert.equal(first.creatorOnMove, true);
  assert.equal(first.daysPerMove, 3);
  assert.equal(first.gameSpecId, 'banqi', 'the email names the variant the seek was for');

  // Creator took second: same recipient, opposite call to action. Getting this
  // backwards would tell a player to move when it is not their turn.
  const second = correspondenceStartNoticeFor('xq_1', seek, accepter, 'second');
  assert.equal(second.creatorUserId, 'user-creator');
  assert.equal(second.creatorOnMove, false);
});

test('falls back to the handle when an accepter has no display name', () => {
  const notice = correspondenceStartNoticeFor(
    'xq_1',
    { creatorUserId: 'user-creator', daysPerMove: 1, gameSpecId: 'xiangqi' },
    { displayName: '', handle: 'countallloss' },
    'first',
  );
  assert.equal(notice.accepterName, 'countallloss');
});
