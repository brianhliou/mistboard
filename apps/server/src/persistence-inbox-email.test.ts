import { sweepInboxEmails } from './inbox-email.js';
import { dmEmailUnsubscribe } from './inbox-email-unsubscribe.js';
import {
  blockUser,
  createUser,
  deleteDmThreadForUser,
  dmThreadId,
  getDmConversation,
  sendDmMessage,
  updateUserAccountPreference,
  updateUserLocale,
} from './persistence.js';
import { getPool } from './persistence-db.js';
import { listInboxEmailCandidates, markInboxEmailSent } from './persistence-inbox-email.js';
import { assert, definePersistenceTests, test } from './persistence-test-support.js';
import type { TransactionalEmail } from './send-email.js';

const HOUR = 60 * 60 * 1000;
const now = new Date('2026-11-06T18:00:00Z');
const stale = new Date(now.getTime() - 12 * HOUR);
const body = 'PRIVATE MESSAGE sentinel: never include this or its preview in email candidates';
const later = (hours: number) => new Date(now.getTime() + hours * HOUR);

async function makeUser(id: string) {
  return createUser({
    id,
    email: `${id}@example.com`,
    emailVerifiedAt: stale,
    handle: id,
    displayName: `Name ${id}`,
    now: stale,
  });
}

async function send(
  senderId = 'a-sender',
  targetHandle = 'm-recipient',
  id = 'message-1',
  at = stale,
) {
  const result = await sendDmMessage({
    messageId: id,
    senderId,
    targetHandle,
    bodyText: body,
    now: at,
  });
  assert.equal(result.ok, true);
}

async function fixture() {
  await makeUser('a-sender');
  await makeUser('m-recipient');
  await send();
}

definePersistenceTests('inbox email', () => {
  test('sender sweeps at 12h, retries failures, caps all threads, and requires new messages next day', async () => {
    await fixture();
    const sent: TransactionalEmail[] = [];
    let accepted = false;
    const deps = {
      enabled: true,
      fromAddress: 'Mistboard <play@example.com>',
      unsubscribe: (userId: string) =>
        dmEmailUnsubscribe(userId, {
          MISTBOARD_ENGINE_SECRET: 'test-only-inbox-sweeper-key',
        }),
      send: async (email: TransactionalEmail) => {
        sent.push(email);
        return { ok: accepted };
      },
    };
    // The real candidate query and real mark run through the sender.
    await sweepInboxEmails(new Date(stale.getTime() + 11 * HOUR), deps);
    assert.equal(sent.length, 0);
    await sweepInboxEmails(now, deps);
    assert.equal(sent.length, 1);
    assert.equal((await listInboxEmailCandidates({ now })).length, 1);
    accepted = true;
    await sweepInboxEmails(now, deps);
    await sweepInboxEmails(new Date(now.getTime() + 60_000), deps);
    assert.equal(sent.length, 2, 'repeat sweeps do not resend accepted messages');

    await makeUser('z-sender');
    await send('z-sender', 'm-recipient', 'new-message', later(1));
    await sweepInboxEmails(new Date(later(24).getTime() - 1), deps);
    assert.equal(sent.length, 2, 'rolling daily cap spans threads and midnight');
    await sweepInboxEmails(later(24), deps);
    assert.equal(sent.length, 3, 'new unread message is eligible next day');
    await sweepInboxEmails(later(48), deps);
    assert.equal(sent.length, 3, 'older messages across both threads stay covered');
    for (const email of sent) {
      assert.ok(!JSON.stringify(email).includes(body));
      assert.ok(!JSON.stringify(email).includes('PRIVATE MESSAGE sentinel'));
    }
  });

  test('12-hour boundary is inclusive; candidates serialize metadata only, for either thread side', async () => {
    await fixture();
    await makeUser('z-sender');
    await makeUser('b-recipient');
    await send('z-sender', 'b-recipient', 'message-2');
    await updateUserLocale('m-recipient', 'zh-Hant', now);

    assert.deepEqual(await listInboxEmailCandidates({ now: new Date(now.getTime() - 1) }), []);
    const candidates = await listInboxEmailCandidates({ now });
    assert.deepEqual(candidates, [
      {
        userId: 'b-recipient',
        email: 'b-recipient@example.com',
        locale: null,
        threadId: dmThreadId('z-sender', 'b-recipient'),
        messageId: 'message-2',
        messageAt: stale,
        senderHandle: 'z-sender',
        senderName: 'Name z-sender',
      },
      {
        userId: 'm-recipient',
        email: 'm-recipient@example.com',
        locale: 'zh-Hant',
        threadId: dmThreadId('a-sender', 'm-recipient'),
        messageId: 'message-1',
        messageAt: stale,
        senderHandle: 'a-sender',
        senderName: 'Name a-sender',
      },
    ]);
    const serialized = JSON.stringify(candidates);
    assert.equal(serialized.includes(body), false);
    assert.equal(serialized.includes('PRIVATE MESSAGE'), false);
    assert.equal(serialized.includes('bodyText'), false);
    assert.equal(serialized.includes('lastText'), false);
  });

  const exclusions: [string, () => Promise<unknown>][] = [
    ['read thread', () => getDmConversation('m-recipient', 'a-sender', { limit: 100 })],
    ['recipient was last sender', () => send('m-recipient', 'a-sender', 'reply')],
    [
      'fresh last message after an old unread message',
      () => send('a-sender', 'm-recipient', 'fresh', now),
    ],
    [
      'recipient blocks sender',
      () => blockUser({ actorId: 'm-recipient', targetHandle: 'a-sender', now }),
    ],
    [
      'sender blocks recipient',
      () => blockUser({ actorId: 'a-sender', targetHandle: 'm-recipient', now }),
    ],
    [
      'unverified email',
      () => getPool().query(`UPDATE users SET email_verified_at = NULL WHERE id = 'm-recipient'`),
    ],
    ['absent email', () => getPool().query(`UPDATE users SET email = '' WHERE id = 'm-recipient'`)],
    [
      'whitespace email',
      () => getPool().query(`UPDATE users SET email = '   ' WHERE id = 'm-recipient'`),
    ],
    [
      'play-locked recipient',
      () =>
        getPool().query(`UPDATE users SET play_disabled_at = $1 WHERE id = 'm-recipient'`, [now]),
    ],
    [
      'closed recipient',
      () => getPool().query(`UPDATE users SET closed_at = $1 WHERE id = 'm-recipient'`, [now]),
    ],
    [
      'inboxEmail opt-out',
      () => updateUserAccountPreference('m-recipient', 'inboxEmail', false, now),
    ],
    [
      'recipient hides thread on hi side',
      () => deleteDmThreadForUser('m-recipient', 'a-sender', now),
    ],
  ];
  for (const [name, exclude] of exclusions) {
    test(`eligibility excludes ${name}`, async () => {
      await fixture();
      assert.equal((await listInboxEmailCandidates({ now })).length, 1);
      await exclude();
      // An outgoing reply may make the OTHER account eligible, never its sender.
      assert.equal(
        (await listInboxEmailCandidates({ now })).some((c) => c.userId === 'm-recipient'),
        false,
      );
    });
  }

  test('lo-side hide excludes recipient; sender-side hide does not; only inboxEmail controls eligibility', async () => {
    await makeUser('a-recipient');
    await makeUser('z-sender');
    await send('z-sender', 'a-recipient');
    await updateUserAccountPreference('a-recipient', 'inboxEmail', true, now);
    await updateUserAccountPreference('a-recipient', 'inboxBell', false, now);
    await deleteDmThreadForUser('z-sender', 'a-recipient', now);
    assert.equal((await listInboxEmailCandidates({ now })).length, 1);
    await deleteDmThreadForUser('a-recipient', 'z-sender', now);
    assert.deepEqual(await listInboxEmailCandidates({ now }), []);
  });

  test('one newest eligible candidate per account, independent of message id ordering and fresh threads', async () => {
    await fixture();
    await makeUser('z-sender');
    await send('z-sender', 'm-recipient', 'aaa-newer', new Date(stale.getTime() + 1));
    assert.equal((await listInboxEmailCandidates({ now }))[0]?.messageId, 'message-1');
    const candidates = await listInboxEmailCandidates({ now: new Date(now.getTime() + 1) });
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.messageId, 'aaa-newer');
    assert.equal(await markInboxEmailSent('m-recipient', 'aaa-newer', later(1)), true);
    // Both threads are covered, including the older thread never selected.
    assert.deepEqual(await listInboxEmailCandidates({ now: later(48) }), []);
  });

  test('daily cap is a rolling 24 hours per account, across threads and UTC midnight', async () => {
    await fixture();
    assert.equal(await markInboxEmailSent('m-recipient', 'message-1', now), true);
    await makeUser('z-sender');
    await send('z-sender', 'm-recipient', 'message-next', later(1));
    await makeUser('other-recipient');
    await send('a-sender', 'other-recipient', 'message-other', later(1));
    const beforeBoundary = new Date(later(24).getTime() - 1);
    assert.deepEqual(
      (await listInboxEmailCandidates({ now: beforeBoundary })).map((c) => c.userId),
      ['other-recipient'],
    );
    assert.equal(await markInboxEmailSent('m-recipient', 'message-next', beforeBoundary), false);
    assert.deepEqual(
      (await listInboxEmailCandidates({ now: later(24) })).map((c) => c.userId),
      ['m-recipient', 'other-recipient'],
    );
    assert.equal(await markInboxEmailSent('m-recipient', 'message-next', later(24)), true);
    assert.equal(await markInboxEmailSent('m-recipient', 'message-next', later(48)), false);
    assert.equal(
      (await listInboxEmailCandidates({ now: later(72) })).some((c) => c.userId === 'm-recipient'),
      false,
    );
    const { rows } = await getPool().query(
      `SELECT inbox_email_sent_at, inbox_email_last_message_id, inbox_email_last_message_at FROM users WHERE id = 'm-recipient'`,
    );
    assert.deepEqual(rows, [
      {
        inbox_email_sent_at: later(24),
        inbox_email_last_message_id: 'message-next',
        inbox_email_last_message_at: later(1),
      },
    ]);
  });

  test('equal message timestamps have deterministic identity deduplication across threads', async () => {
    await fixture();
    await makeUser('z-sender');
    await send('z-sender', 'm-recipient', 'zzz-message', stale);
    assert.equal((await listInboxEmailCandidates({ now }))[0]?.messageId, 'zzz-message');
    assert.equal(await markInboxEmailSent('m-recipient', 'zzz-message', now), true);
    assert.deepEqual(await listInboxEmailCandidates({ now: later(24) }), []);
    assert.equal(await markInboxEmailSent('m-recipient', 'message-1', later(24)), false);
    // Even deleting the selected message cannot erase the account-wide watermark.
    await getPool().query(`DELETE FROM dm_messages WHERE id = 'zzz-message'`);
    assert.deepEqual(await listInboxEmailCandidates({ now: later(48) }), []);
  });

  test('marking is idempotent, rejects foreign/outgoing/missing identities, and cannot regress state', async () => {
    await fixture();
    await makeUser('unrelated');
    assert.equal(await markInboxEmailSent('unrelated', 'message-1', now), false);
    assert.equal(await markInboxEmailSent('a-sender', 'message-1', now), false);
    assert.equal(await markInboxEmailSent('missing', 'message-1', now), false);
    assert.equal(await markInboxEmailSent('m-recipient', 'missing', now), false);
    assert.equal(await markInboxEmailSent('m-recipient', 'message-1', now), true);
    assert.equal(await markInboxEmailSent('m-recipient', 'message-1', now), false);
    await send('a-sender', 'm-recipient', 'newer', later(1));
    assert.equal(await markInboxEmailSent('m-recipient', 'newer', later(24)), true);
    assert.equal(await markInboxEmailSent('m-recipient', 'message-1', later(48)), false);
    assert.equal(await markInboxEmailSent('m-recipient', 'newer', now), false);
    assert.deepEqual(await listInboxEmailCandidates({ now: later(72) }), []);
  });

  test('listing does not mark delivery; unsent candidates remain retryable', async () => {
    await fixture();
    const candidates = await listInboxEmailCandidates({ now });
    assert.equal(candidates.length, 1);
    assert.deepEqual(await listInboxEmailCandidates({ now: later(24) }), candidates);
    assert.equal(await markInboxEmailSent('m-recipient', 'message-1', later(24)), true);
    assert.deepEqual(await listInboxEmailCandidates({ now: later(48) }), []);
  });
});
