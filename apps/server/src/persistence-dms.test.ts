import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  countRecentDmMessagesByUser,
  countRecentDmThreadsStartedByUser,
  countUnreadDmThreads,
  createDmReport,
  createUser,
  deleteDmThreadForUser,
  dmThreadId,
  followUser,
  getDmConversation,
  getDmThreadForAdmin,
  getUserDmPolicy,
  hasFollow,
  listDmReports,
  listDmThreads,
  resolveDmReport,
  sendDmMessage,
  updateUserDmPolicy,
} from './persistence.js';
import { assert, definePersistenceTests, test } from './persistence-test-support.js';
import { tryHandle as tryHandleInboxRoute } from './routes/inbox.js';

type ResponseCapture = {
  body: string;
  headers: Record<string, string | string[]>;
  status: number | null;
};

definePersistenceTests('dms', () => {
  test('thread id is the sorted pair, so both directions land in one thread', async () => {
    const now = new Date('2026-07-02T00:00:00Z');
    await makeUser('dm_user_ana', 'dmana', now);
    await makeUser('dm_user_bo', 'dmbo', now);

    assert.equal(dmThreadId('dm_user_ana', 'dm_user_bo'), dmThreadId('dm_user_bo', 'dm_user_ana'));

    const first = await sendDmMessage({
      messageId: 'dmsg_1',
      senderId: 'dm_user_ana',
      targetHandle: 'dmbo',
      bodyText: 'hello bo',
      now,
    });
    assert.equal(first.ok, true);
    assert.equal(first.ok && first.isNewThread, true);

    const reply = await sendDmMessage({
      messageId: 'dmsg_2',
      senderId: 'dm_user_bo',
      targetHandle: 'DMANA',
      bodyText: 'hello ana',
      now: new Date('2026-07-02T00:01:00Z'),
    });
    assert.equal(reply.ok, true);
    assert.equal(reply.ok && reply.isNewThread, false);

    const anaThreads = await listDmThreads('dm_user_ana', { limit: 50 });
    assert.equal(anaThreads.length, 1);
    assert.equal(anaThreads[0]?.other.handle, 'dmbo');
    assert.equal(anaThreads[0]?.lastText, 'hello ana');
    assert.equal(anaThreads[0]?.lastFromMe, false);
    assert.equal(anaThreads[0]?.unread, true);

    const convo = await getDmConversation('dm_user_ana', 'dmbo', { limit: 100 });
    assert.equal(convo?.messages.length, 2);
    assert.equal(convo?.messages[0]?.bodyText, 'hello bo');
    assert.equal(convo?.messages[0]?.fromMe, true);
    assert.equal(convo?.messages[1]?.fromMe, false);
  });

  test('read state lives on the last message only and marks on recipient view', async () => {
    const now = new Date('2026-07-02T01:00:00Z');
    await makeUser('dm_user_cara', 'dmcara', now);
    await makeUser('dm_user_dan', 'dmdan', now);

    await sendDmMessage({
      messageId: 'dmsg_read_1',
      senderId: 'dm_user_cara',
      targetHandle: 'dmdan',
      bodyText: 'ping',
      now,
    });

    assert.equal(await countUnreadDmThreads('dm_user_dan'), 1);
    // The sender viewing their own sent message is not a read receipt.
    await getDmConversation('dm_user_cara', 'dmdan', { limit: 100 });
    assert.equal(await countUnreadDmThreads('dm_user_dan'), 1);

    // The recipient opening the conversation marks it read.
    await getDmConversation('dm_user_dan', 'dmcara', { limit: 100 });
    assert.equal(await countUnreadDmThreads('dm_user_dan'), 0);

    const danThreads = await listDmThreads('dm_user_dan', { limit: 50 });
    assert.equal(danThreads[0]?.unread, false);
  });

  test('per-side delete hides the list entry and a new message resurrects it', async () => {
    const now = new Date('2026-07-02T02:00:00Z');
    await makeUser('dm_user_eve', 'dmeve', now);
    await makeUser('dm_user_finn', 'dmfinn', now);

    await sendDmMessage({
      messageId: 'dmsg_del_1',
      senderId: 'dm_user_eve',
      targetHandle: 'dmfinn',
      bodyText: 'first',
      now,
    });

    assert.equal(await deleteDmThreadForUser('dm_user_finn', 'dmeve'), true);
    assert.equal((await listDmThreads('dm_user_finn', { limit: 50 })).length, 0);
    // The other side still sees the thread.
    assert.equal((await listDmThreads('dm_user_eve', { limit: 50 })).length, 1);
    // Deleted threads do not count toward the unread badge.
    assert.equal(await countUnreadDmThreads('dm_user_finn'), 0);

    await sendDmMessage({
      messageId: 'dmsg_del_2',
      senderId: 'dm_user_eve',
      targetHandle: 'dmfinn',
      bodyText: 'are you there?',
      now: new Date('2026-07-02T02:05:00Z'),
    });
    const finnThreads = await listDmThreads('dm_user_finn', { limit: 50 });
    assert.equal(finnThreads.length, 1);
    assert.equal(finnThreads[0]?.lastText, 'are you there?');
  });

  test('rate-limit counters track thread starts and messages per sender', async () => {
    const now = new Date('2026-07-02T03:00:00Z');
    await makeUser('dm_user_gil', 'dmgil', now);
    await makeUser('dm_user_hana', 'dmhana', now);
    await makeUser('dm_user_iris', 'dmiris', now);

    await sendDmMessage({
      messageId: 'dmsg_rate_1',
      senderId: 'dm_user_gil',
      targetHandle: 'dmhana',
      bodyText: 'one',
      now,
    });
    await sendDmMessage({
      messageId: 'dmsg_rate_2',
      senderId: 'dm_user_gil',
      targetHandle: 'dmiris',
      bodyText: 'two',
      now,
    });
    await sendDmMessage({
      messageId: 'dmsg_rate_3',
      senderId: 'dm_user_gil',
      targetHandle: 'dmhana',
      bodyText: 'three (reply, not a new thread)',
      now,
    });

    const since = new Date('2026-07-02T02:59:00Z');
    assert.equal(await countRecentDmThreadsStartedByUser('dm_user_gil', since), 2);
    assert.equal(await countRecentDmMessagesByUser('dm_user_gil', since), 3);
    assert.equal(await countRecentDmThreadsStartedByUser('dm_user_hana', since), 0);
  });

  test('reports dedupe while open and resolve through the admin queue', async () => {
    const now = new Date('2026-07-02T04:00:00Z');
    await makeUser('dm_user_jo', 'dmjo', now);
    await makeUser('dm_user_kim', 'dmkim', now);
    await makeUser('dm_user_admin', 'dmadmin', now);

    await sendDmMessage({
      messageId: 'dmsg_rep_1',
      senderId: 'dm_user_jo',
      targetHandle: 'dmkim',
      bodyText: 'rude message',
      now,
    });

    // Before anyone reports the thread, the admin reader sees nothing: staff read
    // reported threads only, never an arbitrary thread id.
    assert.equal(await getDmThreadForAdmin(dmThreadId('dm_user_jo', 'dm_user_kim')), null);

    const missing = await createDmReport({
      id: 'dmrpt_missing',
      reporterId: 'dm_user_jo',
      otherHandle: 'dmadmin',
      reason: 'no thread exists',
      now,
    });
    assert.deepEqual(missing, { ok: false, error: 'unknown_thread' });

    const created = await createDmReport({
      id: 'dmrpt_1',
      reporterId: 'dm_user_kim',
      otherHandle: 'dmjo',
      reason: 'harassment',
      now,
    });
    assert.equal(created.ok, true);

    const duplicate = await createDmReport({
      id: 'dmrpt_2',
      reporterId: 'dm_user_kim',
      otherHandle: 'dmjo',
      reason: 'harassment again',
      now,
    });
    assert.deepEqual(duplicate, { ok: false, error: 'already_reported' });

    const open = await listDmReports({ limit: 10 });
    assert.equal(
      open.some((report) => report.id === 'dmrpt_1'),
      true,
    );

    const thread = await getDmThreadForAdmin(dmThreadId('dm_user_jo', 'dm_user_kim'));
    assert.equal(thread?.messages[0]?.bodyText, 'rude message');
    assert.deepEqual(thread?.participants.map((participant) => participant.handle).sort(), [
      'dmjo',
      'dmkim',
    ]);

    assert.equal(
      await resolveDmReport({
        reportId: 'dmrpt_1',
        status: 'resolved',
        resolvedById: 'dm_user_admin',
        note: 'warned the sender',
        now,
      }),
      true,
    );
    assert.equal(
      (await listDmReports({ limit: 10 })).some((r) => r.id === 'dmrpt_1'),
      false,
    );
    // A resolved report still lets staff re-read the thread it was about.
    assert.equal(
      (await getDmThreadForAdmin(dmThreadId('dm_user_jo', 'dm_user_kim')))?.messages.length,
      1,
    );

    // After resolution the same reporter can file a fresh report.
    const again = await createDmReport({
      id: 'dmrpt_3',
      reporterId: 'dm_user_kim',
      otherHandle: 'dmjo',
      reason: 'it continued',
      now,
    });
    assert.equal(again.ok, true);
  });

  test('dm policy round-trips and hasFollow reads the directed edge', async () => {
    const now = new Date('2026-07-02T05:00:00Z');
    await makeUser('dm_user_lena', 'dmlena', now);
    await makeUser('dm_user_mo', 'dmmo', now);

    // Column default is the current behavior; unknown users read fail-closed.
    assert.equal(await getUserDmPolicy('dm_user_lena'), 'always');
    assert.equal(await getUserDmPolicy('dm_user_never_existed'), 'never');

    const updated = await updateUserDmPolicy('dm_user_lena', 'friends', now);
    assert.equal(updated?.dmPolicy, 'friends');
    assert.equal(await getUserDmPolicy('dm_user_lena'), 'friends');

    // The friends gate reads the DIRECTED edge: recipient follows sender.
    assert.equal(await hasFollow('dm_user_lena', 'dm_user_mo'), false);
    assert.equal(
      (await followUser({ actorId: 'dm_user_lena', targetHandle: 'dmmo', now })).ok,
      true,
    );
    assert.equal(await hasFollow('dm_user_lena', 'dm_user_mo'), true);
    assert.equal(await hasFollow('dm_user_mo', 'dm_user_lena'), false);
  });

  test('inbox routes require a session and reserve literal segments', async () => {
    for (const [method, path] of [
      ['GET', '/api/inbox'],
      ['GET', '/api/inbox/unread-count'],
      ['GET', '/api/inbox/somebody'],
      ['POST', '/api/inbox/somebody'],
      ['DELETE', '/api/inbox/somebody'],
      ['POST', '/api/inbox/somebody/report'],
    ] as const) {
      const capture = captureResponse();
      const handled = await tryHandleInboxRoute(
        {},
        { method, headers: {} } as unknown as IncomingMessage,
        capture,
        path,
        new URL(`http://localhost${path}`),
      );
      assert.equal(handled, true, `${method} ${path} should be claimed`);
      assert.equal(capture.status, 401, `${method} ${path} should 401 anonymously`);
    }

    // The reports literal is claimed BEFORE the :handle pattern. The admin
    // session gate is deliberately open outside production-like runtimes (same
    // as /database), so here the proof of correct routing is the reports-list
    // envelope: the handle branch would have answered 401 for an anonymous
    // request instead.
    const reports = captureResponse();
    await tryHandleInboxRoute(
      {},
      { method: 'GET', headers: {} } as unknown as IncomingMessage,
      reports,
      '/api/inbox/reports',
      new URL('http://localhost/api/inbox/reports'),
    );
    assert.equal(reports.status, 200);
    assert.equal(Array.isArray(JSON.parse(reports.body).reports), true);

    const badMethod = captureResponse();
    await tryHandleInboxRoute(
      {},
      { method: 'PATCH', headers: {} } as unknown as IncomingMessage,
      badMethod,
      '/api/inbox',
      new URL('http://localhost/api/inbox'),
    );
    assert.equal(badMethod.status, 405);
  });
});

async function makeUser(id: string, handle: string, now: Date): Promise<void> {
  await createUser({
    id,
    email: `${handle}@example.com`,
    emailVerifiedAt: now,
    handle,
    displayName: handle,
    now,
  });
}

function captureResponse(): ServerResponse & ResponseCapture {
  const capture = {
    body: '',
    headers: {} as Record<string, string | string[]>,
    status: null as number | null,
    writeHead(status: number, headers?: Record<string, string | string[]>) {
      capture.status = status;
      capture.headers = headers ?? {};
      return capture;
    },
    end(chunk?: string) {
      capture.body += chunk ?? '';
      return capture;
    },
  };
  return capture as unknown as ServerResponse & ResponseCapture;
}
