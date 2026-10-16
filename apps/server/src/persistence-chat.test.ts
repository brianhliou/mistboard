import type { IncomingMessage, ServerResponse } from 'node:http';
import pg from 'pg';
import {
  activeChatTimeout,
  addChatLine,
  CHAT_ROOM_LOBBY,
  countRecentChatLinesByUser,
  countRecentMatchingChatLinesByUser,
  createChatReport,
  createChatTimeout,
  createUser,
  hideChatLine,
  isRoomSeatUser,
  listChatLines,
  listChatReports,
  pruneChatLines,
  resolveChatReport,
  upsertRoomSeatToken,
} from './persistence.js';
import {
  assert,
  definePersistenceTests,
  TEST_DATABASE_URL,
  test,
} from './persistence-test-support.js';
import { tryHandle as tryHandleChatRoute } from './routes/chat.js';

type ResponseCapture = {
  body: string;
  headers: Record<string, string | string[]>;
  status: number | null;
};

definePersistenceTests('chat', () => {
  test('lines append, list oldest-first, and prune to the retention cap', async () => {
    const now = new Date('2026-07-02T06:00:00Z');
    await makeUser('chat_user_ana', 'chatana', now);

    for (let i = 0; i < 5; i += 1) {
      await addChatLine({
        id: `chln_test_${i}`,
        room: CHAT_ROOM_LOBBY,
        authorId: 'chat_user_ana',
        bodyText: `line ${i}`,
        now: new Date(now.getTime() + i * 1000),
      });
    }

    const lines = await listChatLines(CHAT_ROOM_LOBBY, 100);
    assert.equal(lines.length, 5);
    assert.equal(lines[0]?.bodyText, 'line 0');
    assert.equal(lines[4]?.bodyText, 'line 4');
    assert.equal(lines[0]?.authorHandle, 'chatana');

    await pruneChatLines(CHAT_ROOM_LOBBY, 2);
    const pruned = await listChatLines(CHAT_ROOM_LOBBY, 100);
    assert.deepEqual(
      pruned.map((line) => line.bodyText),
      ['line 3', 'line 4'],
    );

    assert.equal(
      await countRecentChatLinesByUser('chat_user_ana', new Date(now.getTime() - 1000)),
      2,
    );
  });

  test('timeout hides the offender lines and blocks until expiry', async () => {
    const now = new Date('2026-07-02T07:00:00Z');
    await makeUser('chat_user_bo', 'chatbo', now);
    await makeUser('chat_user_admin', 'chatadmin', now);

    await addChatLine({
      id: 'chln_bad_1',
      room: CHAT_ROOM_LOBBY,
      authorId: 'chat_user_bo',
      bodyText: 'something rude',
      now,
    });

    const missing = await createChatTimeout({
      id: 'chto_missing',
      room: CHAT_ROOM_LOBBY,
      targetHandle: 'nobody-here',
      durationMs: 15 * 60 * 1000,
      createdById: 'chat_user_admin',
      now,
    });
    assert.deepEqual(missing, { ok: false, error: 'unknown_user' });

    const result = await createChatTimeout({
      id: 'chto_1',
      room: CHAT_ROOM_LOBBY,
      targetHandle: 'CHATBO',
      durationMs: 15 * 60 * 1000,
      reason: 'insults',
      createdById: 'chat_user_admin',
      now,
    });
    assert.equal(result.ok, true);

    // The offender's lines vanish from the public list; the timeout holds
    // inside the window and expires after it.
    const visible = await listChatLines(CHAT_ROOM_LOBBY, 100);
    assert.equal(
      visible.some((line) => line.bodyText === 'something rude'),
      false,
    );
    assert.notEqual(await activeChatTimeout(CHAT_ROOM_LOBBY, 'chat_user_bo', now), null);
    assert.equal(
      await activeChatTimeout(
        CHAT_ROOM_LOBBY,
        'chat_user_bo',
        new Date(now.getTime() + 16 * 60 * 1000),
      ),
      null,
    );
  });

  test('single-line hide removes one line and is idempotent', async () => {
    const now = new Date('2026-07-02T08:00:00Z');
    await makeUser('chat_user_cara', 'chatcara', now);
    await makeUser('chat_user_mod', 'chatmod', now);

    await addChatLine({
      id: 'chln_hide_1',
      room: CHAT_ROOM_LOBBY,
      authorId: 'chat_user_cara',
      bodyText: 'borderline',
      now,
    });
    assert.equal(await hideChatLine({ lineId: 'chln_hide_1', hiddenById: 'chat_user_mod' }), true);
    assert.equal(await hideChatLine({ lineId: 'chln_hide_1', hiddenById: 'chat_user_mod' }), false);
    const lines = await listChatLines(CHAT_ROOM_LOBBY, 100);
    assert.equal(
      lines.some((line) => line.id === 'chln_hide_1'),
      false,
    );
  });

  test('reports deduplicate per reporter and can be resolved by admins', async () => {
    const now = new Date('2026-07-02T09:00:00Z');
    await makeUser('chat_user_reported', 'chatreported', now);
    await makeUser('chat_user_reporter', 'chatreporter', now);
    await makeUser('chat_user_report_admin', 'chatreportadmin', now);

    await addChatLine({
      id: 'chln_report_1',
      room: CHAT_ROOM_LOBBY,
      authorId: 'chat_user_reported',
      bodyText: 'borderline',
      moderationStatus: 'flagged',
      moderationReason: 'profanity',
      now,
    });

    const self = await createChatReport({
      id: 'chrpt_self',
      lineId: 'chln_report_1',
      reporterId: 'chat_user_reported',
      reason: 'self',
      now,
    });
    assert.deepEqual(self, { ok: false, error: 'self_report' });

    const created = await createChatReport({
      id: 'chrpt_1',
      lineId: 'chln_report_1',
      reporterId: 'chat_user_reporter',
      reason: 'spam',
      now,
    });
    assert.equal(created.ok, true);
    if (!created.ok) throw new Error('expected report creation');
    assert.equal(created.openReportsForLine, 1);
    assert.equal(created.report.lineAuthorHandle, 'chatreported');
    assert.equal(created.report.reporterHandle, 'chatreporter');
    assert.equal(created.report.moderationStatus, 'flagged');

    const duplicate = await createChatReport({
      id: 'chrpt_2',
      lineId: 'chln_report_1',
      reporterId: 'chat_user_reporter',
      reason: 'again',
      now,
    });
    assert.deepEqual(duplicate, { ok: false, error: 'already_reported' });

    const open = await listChatReports({ status: 'open', limit: 10 });
    assert.equal(
      open.some((report) => report.id === 'chrpt_1'),
      true,
    );

    assert.equal(
      await resolveChatReport({
        reportId: 'chrpt_1',
        status: 'resolved',
        resolvedById: 'chat_user_report_admin',
        note: 'handled',
        now,
      }),
      true,
    );
    assert.equal(
      (await listChatReports({ status: 'open', limit: 10 })).some(
        (report) => report.id === 'chrpt_1',
      ),
      false,
    );
  });

  test('recent matching line counter supports duplicate-message throttling', async () => {
    const now = new Date('2026-07-02T10:00:00Z');
    await makeUser('chat_user_echo', 'chatecho', now);
    await addChatLine({
      id: 'chln_echo_1',
      room: CHAT_ROOM_LOBBY,
      authorId: 'chat_user_echo',
      bodyText: 'Same line',
      now,
    });
    await addChatLine({
      id: 'chln_echo_2',
      room: CHAT_ROOM_LOBBY,
      authorId: 'chat_user_echo',
      bodyText: 'same line',
      now: new Date(now.getTime() + 1000),
    });

    assert.equal(
      await countRecentMatchingChatLinesByUser({
        userId: 'chat_user_echo',
        bodyText: ' same line ',
        since: new Date(now.getTime() - 1000),
      }),
      2,
    );
  });

  test('chat routes: flag off answers chat_disabled, flag on gates posting', async () => {
    // Flag off (default in the test env): every chat path is a 404.
    const disabled = captureResponse();
    const handled = await tryHandleChatRoute(
      {},
      { method: 'GET', headers: {} } as unknown as IncomingMessage,
      disabled,
      '/api/chat/lobby',
      new URL('http://test.local/api/chat/lobby'),
    );
    assert.equal(handled, true);
    assert.equal(disabled.status, 404);
    assert.equal(JSON.parse(disabled.body).error, 'chat_disabled');

    // Flag on: anonymous read works, anonymous post is refused.
    process.env.MISTBOARD_LOBBY_CHAT_ENABLED = 'true';
    try {
      const read = captureResponse();
      await tryHandleChatRoute(
        {},
        { method: 'GET', headers: {} } as unknown as IncomingMessage,
        read,
        '/api/chat/lobby',
        new URL('http://test.local/api/chat/lobby'),
      );
      assert.equal(read.status, 200);
      const payload = JSON.parse(read.body);
      assert.equal(Array.isArray(payload.lines), true);
      assert.equal(payload.canPost, false);
      assert.equal(payload.viewerHandle, null);

      const post = captureResponse();
      await tryHandleChatRoute(
        {},
        { method: 'POST', headers: {} } as unknown as IncomingMessage,
        post,
        '/api/chat/lobby',
        new URL('http://test.local/api/chat/lobby'),
      );
      assert.equal(post.status, 401);
    } finally {
      delete process.env.MISTBOARD_LOBBY_CHAT_ENABLED;
    }
  });

  test('game chat route reads from a per-game persistent room without the lobby flag', async () => {
    delete process.env.MISTBOARD_LOBBY_CHAT_ENABLED;
    const now = new Date('2026-07-02T11:00:00Z');
    await makeUser('chat_user_review', 'chatreview', now);
    await addChatLine({
      id: 'chln_game_room_1',
      room: 'game:xq_review_room',
      authorId: 'chat_user_review',
      bodyText: 'review room line',
      now,
    });
    await addChatLine({
      id: 'chln_other_game_room_1',
      room: 'game:xq_other_room',
      authorId: 'chat_user_review',
      bodyText: 'other room line',
      now,
    });

    const read = captureResponse();
    const handled = await tryHandleChatRoute(
      {},
      { method: 'GET', headers: {} } as unknown as IncomingMessage,
      read,
      '/api/chat/game/xq_review_room',
      new URL('http://test.local/api/chat/game/xq_review_room'),
    );

    assert.equal(handled, true);
    assert.equal(read.status, 200);
    const payload = JSON.parse(read.body);
    assert.deepEqual(
      payload.lines.map((line: { text: string }) => line.text),
      ['review room line'],
    );
    assert.equal(payload.canPost, false);
  });

  test('study chat route reads from a per-study room isolated from game rooms', async () => {
    delete process.env.MISTBOARD_LOBBY_CHAT_ENABLED;
    const now = new Date('2026-07-02T11:00:00Z');
    await makeUser('chat_user_study', 'chatstudy', now);
    await addChatLine({
      id: 'chln_study_room_1',
      room: 'study:st_review_study',
      authorId: 'chat_user_study',
      bodyText: 'study room line',
      now,
    });
    // Same id under the game prefix must not bleed into the study room.
    await addChatLine({
      id: 'chln_study_room_2',
      room: 'game:st_review_study',
      authorId: 'chat_user_study',
      bodyText: 'game room line',
      now,
    });

    const read = captureResponse();
    const handled = await tryHandleChatRoute(
      {},
      { method: 'GET', headers: {} } as unknown as IncomingMessage,
      read,
      '/api/chat/study/st_review_study',
      new URL('http://test.local/api/chat/study/st_review_study'),
    );

    assert.equal(handled, true);
    assert.equal(read.status, 200);
    const payload = JSON.parse(read.body);
    assert.deepEqual(
      payload.lines.map((line: { text: string }) => line.text),
      ['study room line'],
    );
    assert.equal(payload.canPost, false);
  });

  test('broadcast chat is one room per event, and only an event that exists has one', async () => {
    delete process.env.MISTBOARD_LOBBY_CHAT_ENABLED;
    const now = new Date('2026-07-02T11:30:00Z');
    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO xiangqi_broadcast_tours (slug, name, payload) VALUES ('chat-tour', '联赛', '{}')`,
      );
    } finally {
      await client.end();
    }
    await makeUser('chat_user_relay', 'chatrelay', now);
    await addChatLine({
      id: 'chln_broadcast_room_1',
      room: 'broadcast:chat-tour',
      authorId: 'chat_user_relay',
      bodyText: 'relay room line',
      now,
    });

    const read = captureResponse();
    await tryHandleChatRoute(
      {},
      { method: 'GET', headers: {} } as unknown as IncomingMessage,
      read,
      '/api/chat/broadcast/chat-tour',
      new URL('http://test.local/api/chat/broadcast/chat-tour'),
    );
    assert.equal(read.status, 200);
    assert.deepEqual(
      JSON.parse(read.body).lines.map((line: { text: string }) => line.text),
      ['relay room line'],
    );

    const unknown = captureResponse();
    await tryHandleChatRoute(
      {},
      { method: 'GET', headers: {} } as unknown as IncomingMessage,
      unknown,
      '/api/chat/broadcast/no-such-tour',
      new URL('http://test.local/api/chat/broadcast/no-such-tour'),
    );
    assert.equal(unknown.status, 404);
  });

  test('player chat room is seat-gated and never bleeds into the spectator room', async () => {
    delete process.env.MISTBOARD_LOBBY_CHAT_ENABLED;
    const now = new Date('2026-07-02T12:00:00Z');
    await makeUser('chat_user_seat', 'chatseat', now);
    await makeUser('chat_user_watch', 'chatwatch', now);
    await upsertRoomSeatToken('bq_seat_room', {
      seat: 'red',
      clientId: 'client_seat',
      tokenHash: 'a'.repeat(64),
      userId: 'chat_user_seat',
      userHandle: 'chatseat',
      userDisplayName: 'chatseat',
      issuedAt: now,
      lastSeenAt: now,
    });
    await addChatLine({
      id: 'chln_player_room_1',
      room: 'player:bq_seat_room',
      authorId: 'chat_user_seat',
      bodyText: 'good luck',
      now,
    });

    // The seated account is a member; a spectator account is not.
    assert.equal(await isRoomSeatUser('bq_seat_room', 'chat_user_seat'), true);
    assert.equal(await isRoomSeatUser('bq_seat_room', 'chat_user_watch'), false);

    // Anonymous read of the player room is refused outright — the gate is
    // fail-closed, so a refusal returns no lines at all.
    const refused = captureResponse();
    const handled = await tryHandleChatRoute(
      {},
      { method: 'GET', headers: {} } as unknown as IncomingMessage,
      refused,
      '/api/chat/player/bq_seat_room',
      new URL('http://test.local/api/chat/player/bq_seat_room'),
    );
    assert.equal(handled, true);
    assert.equal(refused.status, 401);
    assert.equal(JSON.parse(refused.body).error, 'not_signed_in');

    // The spectator room for the same game (what the review page reads) does not
    // carry the players' line.
    const spectator = captureResponse();
    await tryHandleChatRoute(
      {},
      { method: 'GET', headers: {} } as unknown as IncomingMessage,
      spectator,
      '/api/chat/game/bq_seat_room',
      new URL('http://test.local/api/chat/game/bq_seat_room'),
    );
    assert.equal(spectator.status, 200);
    assert.deepEqual(JSON.parse(spectator.body).lines, []);
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
