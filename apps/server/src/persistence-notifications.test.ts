import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  addForumPost,
  countIncomingChallenges,
  countNewFollowers,
  createAccountSession,
  createCorrespondenceSeek,
  createForumTopic,
  createUser,
  followUser,
  listChallengesForUser,
  listForumCategories,
  markNotificationsSeen,
  unreadWatchedForumTopics,
} from './persistence.js';
import {
  assert,
  definePersistenceTests,
  pg,
  sha256,
  TEST_DATABASE_URL,
  test,
} from './persistence-test-support.js';
import {
  type NotificationsPayload,
  tryHandle as tryHandleNotifications,
} from './routes/notifications.js';

definePersistenceTests('notifications', () => {
  test('new-follower count is watermarked, and opening the bell clears it', async () => {
    const now = new Date('2026-08-01T00:00:00Z');
    await makeUser('notif_target', 'notiftarget', now);
    await makeUser('notif_fan_one', 'notiffanone', now);
    await makeUser('notif_fan_two', 'notiffantwo', now);

    // A brand-new account starts at zero rather than inheriting its history:
    // 121 backfills followers_seen_at to now(), so nothing pre-existing counts.
    assert.equal(await countNewFollowers('notif_target'), 0);

    assert.equal(
      (await followUser({ actorId: 'notif_fan_one', targetHandle: 'notiftarget' })).ok,
      true,
    );
    assert.equal(await countNewFollowers('notif_target'), 1);

    assert.equal(
      (await followUser({ actorId: 'notif_fan_two', targetHandle: 'notiftarget' })).ok,
      true,
    );
    assert.equal(await countNewFollowers('notif_target'), 2);

    // The follow is one-directional, so it never counts for the follower.
    assert.equal(await countNewFollowers('notif_fan_one'), 0);

    await markNotificationsSeen('notif_target', 'followers');
    assert.equal(await countNewFollowers('notif_target'), 0);

    // A follow arriving after the watermark counts again.
    await runSql(
      `UPDATE user_relations SET created_at = now() + interval '1 second'
       WHERE actor_id = $1 AND target_id = $2`,
      ['notif_fan_one', 'notif_target'],
    );
    assert.equal(await countNewFollowers('notif_target'), 1);
  });

  test('bell payload names the newest unseen followers, capped, minus blocked ones', async () => {
    const now = new Date('2026-08-01T00:00:00Z');
    await makeUser('notif_fowner', 'notiffowner', now);
    // Seven followers, each a second newer than the last, all after the
    // owner's now()-seeded watermark.
    for (let index = 0; index < 7; index += 1) {
      await makeUser(`notif_ffan${index}`, `notifffan${index}`, now);
      assert.equal(
        (await followUser({ actorId: `notif_ffan${index}`, targetHandle: 'notiffowner' })).ok,
        true,
      );
      await runSql(
        `UPDATE user_relations SET created_at = now() + make_interval(secs => $3::int)
         WHERE actor_id = $1 AND target_id = $2`,
        [`notif_ffan${index}`, 'notif_fowner', index + 1],
      );
    }
    // The newest follower is blocked (legacy shape: blockUser would have
    // severed the follow), the next newest has a private profile.
    await runSql(
      `INSERT INTO user_relations (actor_id, target_id, relation) VALUES ($1, $2, 'block')`,
      ['notif_fowner', 'notif_ffan6'],
    );
    await runSql(`UPDATE users SET profile_visibility = 'private' WHERE id = 'notif_ffan5'`);

    const cookie = await makeSessionCookie('notif_fowner');
    const payload = await fetchNotifications(cookie);
    // The badge and the rows agree: the blocked follower is in neither.
    assert.equal(payload.newFollowers, 6);
    assert.equal(await countNewFollowers('notif_fowner'), 6);
    assert.deepEqual(
      payload.followedBy.map((row) => [row.handle, row.displayName]),
      [
        [null, 'notifffan5'],
        ['notifffan4', 'notifffan4'],
        ['notifffan3', 'notifffan3'],
        ['notifffan2', 'notifffan2'],
        ['notifffan1', 'notifffan1'],
      ],
    );
    assert.ok(
      payload.followedBy.every((row) => !Number.isNaN(Date.parse(row.followedAt))),
      'followedAt is an ISO timestamp',
    );
    assert.ok(!JSON.stringify(payload).includes('notif_ffan'), 'user ids never reach the client');

    // The follower's own bell never lists the account they follow.
    const fanPayload = await fetchNotifications(await makeSessionCookie('notif_ffan1'));
    assert.equal(fanPayload.newFollowers, 0);
    assert.deepEqual(fanPayload.followedBy, []);

    // Opening the bell advances the watermark past every row.
    await markNotificationsSeen('notif_fowner', 'followers', new Date(Date.now() + 60_000));
    const after = await fetchNotifications(cookie);
    assert.equal(after.newFollowers, 0);
    assert.deepEqual(after.followedBy, []);
  });

  test('unread forum count covers other people in the topics you watch', async () => {
    const now = new Date('2026-08-01T00:00:00Z');
    await makeUser('notif_author', 'notifauthor', now);
    await makeUser('notif_replier', 'notifreplier', now);
    const category = (await listForumCategories())[0];
    assert.ok(category, 'expected a seeded forum category');
    // Fixture clock ahead of every account's now()-seeded bell watermark (121),
    // so posts sit in front of it and only the per-topic rules decide.
    const base = Date.now() + 5_000;
    const at = (seconds: number) => new Date(base + seconds * 1000);
    const unread = async (userId: string) => (await unreadWatchedForumTopics(userId)).total;

    const created = await createForumTopic({
      id: 'notif_topic_cannon',
      postId: 'notif_post_cannon_open',
      categorySlug: category.slug,
      authorAccountId: 'notif_author',
      authorRole: 'player',
      title: 'A topic about cannon openings',
      slug: 'a-topic-about-cannon-openings',
      bodyText: 'Opening post.',
      now: at(0),
    });
    assert.equal(created.ok, true);
    const topicId = 'notif_topic_cannon';

    // The author's own opening post is not a reply to themselves.
    assert.equal(await unread('notif_author'), 0);

    const reply = await addForumPost({
      id: 'notif_post_cannon_reply',
      topicId,
      authorAccountId: 'notif_replier',
      bodyText: 'Try the central cannon.',
      now: at(1),
    });
    assert.equal(reply.ok, true);
    assert.equal(await unread('notif_author'), 1);

    // Replying in the thread is the strongest read receipt there is: the
    // author's own reply clears the earlier one for them, and never counts.
    assert.equal(
      (
        await addForumPost({
          id: 'notif_post_cannon_thanks',
          topicId,
          authorAccountId: 'notif_author',
          bodyText: 'Thanks.',
          now: at(2),
        })
      ).ok,
      true,
    );
    assert.equal(await unread('notif_author'), 0);

    // Replying subscribed the replier (123), so the author's answer is theirs.
    assert.equal(await unread('notif_replier'), 1);

    await markNotificationsSeen('notif_replier', 'forum-replies', at(3));
    assert.equal(await unread('notif_replier'), 0);
  });

  test('a hidden reply does not leave a badge the author can never clear', async () => {
    const now = new Date('2026-08-01T00:00:00Z');
    await makeUser('notif_hauthor', 'notifhauthor', now);
    await makeUser('notif_hspammer', 'notifhspammer', now);
    const category = (await listForumCategories())[0];
    assert.ok(category, 'expected a seeded forum category');
    // Fixture clock ahead of the now()-seeded bell watermark (121) and of any
    // ms-level drift between the Postgres container's clock and this process.
    const base = Date.now() + 5_000;
    const at = (seconds: number) => new Date(base + seconds * 1000);

    const created = await createForumTopic({
      id: 'notif_topic_endgame',
      postId: 'notif_post_endgame_open',
      categorySlug: category.slug,
      authorAccountId: 'notif_hauthor',
      authorRole: 'player',
      title: 'Endgame practice partners wanted',
      slug: 'endgame-practice-partners-wanted',
      bodyText: 'Opening post.',
      now: at(0),
    });
    assert.equal(created.ok, true);
    const topicId = 'notif_topic_endgame';

    const posted = await addForumPost({
      id: 'notif_post_endgame_spam',
      topicId,
      authorAccountId: 'notif_hspammer',
      bodyText: 'Buy my course.',
      now: at(1),
    });
    assert.equal(posted.ok, true);
    assert.equal((await unreadWatchedForumTopics('notif_hauthor')).total, 1);

    await runSql(`UPDATE forum_posts SET hidden_at = now() WHERE id = $1`, [
      'notif_post_endgame_spam',
    ]);
    // Moderating the reply away must take the badge with it; otherwise the
    // author is left with a count pointing at a post that no longer renders.
    assert.equal((await unreadWatchedForumTopics('notif_hauthor')).total, 0);
  });

  test('incoming-challenge count is live state, not a watermarked feed', async () => {
    const now = new Date('2026-08-01T00:00:00Z');
    await makeUser('notif_challenged', 'notifchallenged', now);
    await makeUser('notif_challenger', 'notifchallenger', now);

    assert.equal(await countIncomingChallenges('notif_challenged'), 0);

    await createCorrespondenceSeek({
      id: 'notif_seek_live',
      creatorUserId: 'notif_challenger',
      gameSpecId: 'xiangqi',
      daysPerMove: 3,
      preferredColor: 'random',
      targetUserId: 'notif_challenged',
      visibility: 'private',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    assert.equal(await countIncomingChallenges('notif_challenged'), 1);

    // Nothing about opening the bell clears it: the challenge is still waiting
    // on an answer, so a watermark here would hide outstanding work.
    await markNotificationsSeen('notif_challenged', 'followers');
    await markNotificationsSeen('notif_challenged', 'forum-replies');
    assert.equal(await countIncomingChallenges('notif_challenged'), 1);

    // An expired challenge stops counting, matching listChallengesForUser.
    await runSql(
      `UPDATE correspondence_seeks SET expires_at = now() - interval '1 minute' WHERE id = $1`,
      ['notif_seek_live'],
    );
    assert.equal(await countIncomingChallenges('notif_challenged'), 0);
  });

  test('incoming-challenge count uses the list filter, board TTL included', async () => {
    const now = new Date('2026-08-01T00:00:00Z');
    await makeUser('notif_ttl_target', 'notifttltarget', now);
    await makeUser('notif_ttl_sender', 'notifttlsender', now);
    // A directed row with no stored expiry (written before challenges carried
    // one) lapses on the board TTL like every other read, so the bell agrees
    // with the "Challenges for you" list instead of counting it forever.
    await createCorrespondenceSeek({
      id: 'notif_seek_no_expiry',
      creatorUserId: 'notif_ttl_sender',
      gameSpecId: 'xiangqi',
      daysPerMove: 3,
      preferredColor: 'random',
      targetUserId: 'notif_ttl_target',
      visibility: 'private',
      expiresAt: null,
    });
    assert.equal(await countIncomingChallenges('notif_ttl_target'), 1);
    assert.equal((await listChallengesForUser('notif_ttl_target')).length, 1);

    await runSql(
      `UPDATE correspondence_seeks SET created_at = now() - interval '30 days' WHERE id = $1`,
      ['notif_seek_no_expiry'],
    );
    assert.equal((await listChallengesForUser('notif_ttl_target')).length, 0);
    assert.equal(await countIncomingChallenges('notif_ttl_target'), 0);
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

async function makeSessionCookie(userId: string): Promise<string> {
  const sessionId = `sess_${userId}`;
  const token = `tok_${userId}`;
  await createAccountSession({
    id: sessionId,
    userId,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  return `mistboard_session=${sessionId}.${token}`;
}

async function fetchNotifications(cookie: string): Promise<NotificationsPayload> {
  let status: number | null = null;
  let body = '';
  const response = {
    writeHead(code: number) {
      status = code;
      return response;
    },
    end(chunk?: string) {
      body += chunk ?? '';
      return response;
    },
  };
  const handled = await tryHandleNotifications(
    {},
    { method: 'GET', headers: { cookie } } as unknown as IncomingMessage,
    response as unknown as ServerResponse,
    '/api/notifications',
  );
  assert.equal(handled, true);
  assert.equal(status, 200);
  return JSON.parse(body) as NotificationsPayload;
}

async function runSql(sql: string, params: unknown[] = []): Promise<void> {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query(sql, params);
  } finally {
    await client.end();
  }
}
