import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  type AccountSession,
  addForumPost,
  blockUser,
  createAccountSession,
  createForumTopic,
  createUser,
  getForumTopic,
  isWatchingForumTopic,
  listForumCategories,
  markForumTopicSeen,
  markNotificationsSeen,
  unreadWatchedForumTopics,
  unwatchForumTopic,
  watchForumTopic,
} from './persistence.js';
import {
  assert,
  definePersistenceTests,
  pg,
  sha256,
  TEST_DATABASE_URL,
  test,
} from './persistence-test-support.js';
import { tryHandle as tryHandleForumRoute } from './routes/forum.js';

type ResponseCapture = { body: string; status: number | null };

const DAY_MS = 24 * 60 * 60 * 1000;

definePersistenceTests('forum-watches', () => {
  test('starting a topic and replying in it both watch the thread; unwatch stops the bell', async () => {
    const t0 = new Date('2026-08-01T00:00:00Z');
    await makeUser('fw_author', 'fwauthor', t0);
    await makeUser('fw_replier', 'fwreplier', t0);
    await makeUser('fw_bystander', 'fwbystander', t0);
    const topicId = await makeTopic('fw_author', 'fw_topic_cannon', 'Cannon openings', at(0));

    // The author's own thread is watched from the start; nobody else's is.
    assert.equal(await isWatchingForumTopic('fw_author', topicId), true);
    assert.equal(await isWatchingForumTopic('fw_bystander', topicId), false);
    assert.equal((await unreadWatchedForumTopics('fw_author')).total, 0);

    await reply('fw_replier', topicId, 'fw_post_reply_one', at(1));
    assert.equal(await isWatchingForumTopic('fw_replier', topicId), true);
    const authorUnread = await unreadWatchedForumTopics('fw_author');
    assert.equal(authorUnread.total, 1);
    assert.deepEqual(authorUnread.topics, [
      {
        topicId,
        slug: 'cannon-openings',
        title: 'Cannon openings',
        unread: 1,
        firstUnreadPostId: 'fw_post_reply_one',
        quote: null,
      },
    ]);
    // The replier's own reply is not unread for them.
    assert.equal((await unreadWatchedForumTopics('fw_replier')).total, 0);

    // Unwatching takes the badge with it.
    assert.deepEqual(await unwatchForumTopic({ accountId: 'fw_author', topicId }), {
      ok: true,
      watching: false,
    });
    assert.equal(await isWatchingForumTopic('fw_author', topicId), false);
    assert.equal((await unreadWatchedForumTopics('fw_author')).total, 0);

    // Replying again opts back in (and counts as having read up to now).
    await reply('fw_author', topicId, 'fw_post_author_back', at(2));
    assert.equal(await isWatchingForumTopic('fw_author', topicId), true);
    assert.equal((await unreadWatchedForumTopics('fw_author')).total, 0);
    // ...and lands in the replier's bell, because replying subscribed them.
    const replierUnread = await unreadWatchedForumTopics('fw_replier');
    assert.equal(replierUnread.total, 1);
    assert.equal(replierUnread.topics[0]?.firstUnreadPostId, 'fw_post_author_back');

    // Visiting the topic is the per-thread read receipt.
    await markForumTopicSeen({ accountId: 'fw_replier', topicId, now: at(3) });
    assert.equal((await unreadWatchedForumTopics('fw_replier')).total, 0);

    // An explicit watch starts read-up-to-now, then collects later replies, and
    // opening the bell (the account-wide watermark) clears it too.
    assert.deepEqual(await watchForumTopic({ accountId: 'fw_bystander', topicId, now: at(3) }), {
      ok: true,
      watching: true,
    });
    assert.equal((await unreadWatchedForumTopics('fw_bystander')).total, 0);
    await reply('fw_author', topicId, 'fw_post_author_more', at(4));
    assert.equal((await unreadWatchedForumTopics('fw_bystander')).total, 1);
    await markNotificationsSeen('fw_bystander', 'forum-replies', at(5));
    assert.equal((await unreadWatchedForumTopics('fw_bystander')).total, 0);

    // The receipt never moves backwards: a stale tab cannot un-read a thread.
    await markForumTopicSeen({ accountId: 'fw_bystander', topicId, now: at(1) });
    await reply('fw_author', topicId, 'fw_post_author_late', at(6));
    await markForumTopicSeen({ accountId: 'fw_bystander', topicId, now: at(2) });
    assert.equal((await unreadWatchedForumTopics('fw_bystander')).total, 1);

    assert.deepEqual(
      await watchForumTopic({ accountId: 'fw_bystander', topicId: 'fw_missing', now: at(6) }),
      { ok: false, error: 'topic_not_found' },
    );
    assert.deepEqual(
      await unwatchForumTopic({ accountId: 'fw_bystander', topicId: 'fw_missing' }),
      {
        ok: false,
        error: 'topic_not_found',
      },
    );
  });

  test('the badge counts topics, rows deep-link to the oldest unread reply, and old threads age out', async () => {
    // Accounts older than every fixture post, so the 30-day window (not the
    // bell watermark makeUser pins to this date) is what excludes the stale ones.
    await makeUser('fw_watcher', 'fwwatcher', daysAgo(90));
    await makeUser('fw_poster', 'fwposter', daysAgo(90));

    // Topic 1: one reply outside the window, two inside.
    const topicOld = await makeTopic('fw_watcher', 'fw_topic_old', 'An old thread', daysAgo(60));
    await reply('fw_poster', topicOld, 'fw_old_stale', daysAgo(40));
    await reply('fw_poster', topicOld, 'fw_old_fresh_one', daysAgo(1));
    await reply('fw_poster', topicOld, 'fw_old_fresh_two', daysAgo(1, 1));

    // Topic 2: only stale activity, so it drops off the bell by itself.
    const topicDead = await makeTopic('fw_watcher', 'fw_topic_dead', 'A dead thread', daysAgo(50));
    await reply('fw_poster', topicDead, 'fw_dead_stale', daysAgo(45));

    // Topic 3: the busiest and most recent.
    const topicHot = await makeTopic('fw_watcher', 'fw_topic_hot', 'A hot thread', daysAgo(2));
    await reply('fw_poster', topicHot, 'fw_hot_one', daysAgo(1, 2));
    await reply('fw_poster', topicHot, 'fw_hot_two', daysAgo(1, 3));
    await reply('fw_poster', topicHot, 'fw_hot_three', daysAgo(1, 4));

    const unread = await unreadWatchedForumTopics('fw_watcher');
    // Two conversations, not five replies.
    assert.equal(unread.total, 2);
    assert.deepEqual(
      unread.topics.map((row) => [row.topicId, row.unread, row.firstUnreadPostId]),
      [
        [topicHot, 3, 'fw_hot_one'],
        [topicOld, 2, 'fw_old_fresh_one'],
      ],
    );

    // The cap trims rows, not the total the badge shows.
    const capped = await unreadWatchedForumTopics('fw_watcher', { limit: 1 });
    assert.equal(capped.total, 2);
    assert.deepEqual(
      capped.topics.map((row) => row.topicId),
      [topicHot],
    );
  });

  test('blocked accounts and moderated threads cannot ring the bell', async () => {
    const t0 = new Date('2026-08-01T00:00:00Z');
    await makeUser('fw_target', 'fwtarget', t0);
    await makeUser('fw_pest', 'fwpest', t0);
    const topicId = await makeTopic('fw_target', 'fw_topic_target', 'My thread', at(0));

    await reply('fw_pest', topicId, 'fw_pest_reply', at(1));
    assert.equal((await unreadWatchedForumTopics('fw_target')).total, 1);

    // Blocking silences replies from the blocked account, even in a thread the
    // target started: otherwise a block leaves a channel open into their bell.
    assert.equal((await blockUser({ actorId: 'fw_target', targetHandle: 'fwpest' })).ok, true);
    assert.equal((await unreadWatchedForumTopics('fw_target')).total, 0);

    // A hidden topic is neither counted nor watchable.
    await runSql(`UPDATE forum_topics SET hidden_at = now() WHERE id = $1`, [topicId]);
    await makeUser('fw_late', 'fwlate', t0);
    assert.deepEqual(await watchForumTopic({ accountId: 'fw_late', topicId, now: at(2) }), {
      ok: false,
      error: 'topic_not_found',
    });
    // Getting out of a hidden topic is still allowed.
    assert.deepEqual(await unwatchForumTopic({ accountId: 'fw_target', topicId }), {
      ok: true,
      watching: false,
    });
  });

  test('a quote reaches the quoted author even in a thread they do not watch, and never subscribes them', async () => {
    const t0 = new Date('2026-08-01T00:00:00Z');
    await makeUser('fq_quoted', 'fqquoted', t0);
    await makeUser('fq_quoter', 'fqquoter', t0);
    const topicId = await makeTopic('fq_quoter', 'fq_topic', 'Quote thread', at(0));
    await reply('fq_quoted', topicId, 'fq_post_original', at(1));
    // Replying watched the thread; step back out so only a quote can reach them.
    await unwatchForumTopic({ accountId: 'fq_quoted', topicId });
    await reply('fq_quoter', topicId, 'fq_post_plain', at(2));
    assert.equal((await unreadWatchedForumTopics('fq_quoted')).total, 0);

    await reply('fq_quoter', topicId, 'fq_post_quote', at(3), ['fq_post_original']);
    const quoted = await unreadWatchedForumTopics('fq_quoted');
    assert.equal(quoted.total, 1);
    assert.deepEqual(quoted.topics[0], {
      topicId,
      slug: 'quote-thread',
      title: 'Quote thread',
      unread: 1,
      firstUnreadPostId: 'fq_post_quote',
      quote: { postId: 'fq_post_quote', by: 'fqquoter' },
    });
    // Being quoted is a one-off row, not a subscription.
    assert.equal(await isWatchingForumTopic('fq_quoted', topicId), false);
    await markNotificationsSeen('fq_quoted', 'forum-replies', at(4));
    assert.equal((await unreadWatchedForumTopics('fq_quoted')).total, 0);

    // Watched AND quoted: still one row, the quote wins the label, and the
    // per-topic receipt clears both.
    assert.equal((await watchForumTopic({ accountId: 'fq_quoted', topicId, now: at(4) })).ok, true);
    await reply('fq_quoter', topicId, 'fq_post_more', at(5));
    await reply('fq_quoter', topicId, 'fq_post_quote_two', at(6), ['fq_post_original']);
    const both = await unreadWatchedForumTopics('fq_quoted');
    assert.equal(both.total, 1);
    assert.equal(both.topics[0]?.unread, 2);
    assert.equal(both.topics[0]?.firstUnreadPostId, 'fq_post_more');
    assert.deepEqual(both.topics[0]?.quote, { postId: 'fq_post_quote_two', by: 'fqquoter' });
    await markForumTopicSeen({ accountId: 'fq_quoted', topicId, now: at(7) });
    assert.equal((await unreadWatchedForumTopics('fq_quoted')).total, 0);

    // Self-quotes never ring; a quote of a post from another topic links
    // nothing; a quote from a blocked account is silent.
    await reply('fq_quoter', topicId, 'fq_post_self', at(8), ['fq_post_plain']);
    assert.equal((await unreadWatchedForumTopics('fq_quoter')).total, 0);
    // (That reply is an ordinary unread one for the watcher; read it away so
    // the next two assertions isolate the quote rules.)
    await markForumTopicSeen({ accountId: 'fq_quoted', topicId, now: at(9) });
    const otherTopic = await makeTopic('fq_quoter', 'fq_topic_other', 'Other thread', at(9));
    await reply('fq_quoter', otherTopic, 'fq_post_cross', at(10), ['fq_post_original']);
    assert.equal((await unreadWatchedForumTopics('fq_quoted')).total, 0);
    assert.equal((await blockUser({ actorId: 'fq_quoted', targetHandle: 'fqquoter' })).ok, true);
    await reply('fq_quoter', topicId, 'fq_post_blocked_quote', at(11), ['fq_post_original']);
    assert.equal((await unreadWatchedForumTopics('fq_quoted')).total, 0);
  });

  test('watch routes: PUT/DELETE toggle, the topic GET carries viewer state, seen is a receipt', async () => {
    const t0 = new Date('2026-08-01T00:00:00Z');
    await makeUser('fw_route_author', 'fwrouteauthor', t0);
    await makeUser('fw_route_reader', 'fwroutereader', t0);
    // Real time throughout: the routes stamp watch/seen with the wall clock,
    // so a fixture post dated ahead of it would stay "unread" forever.
    const topicId = await makeTopic(
      'fw_route_author',
      'fw_topic_route',
      'Route thread',
      new Date(Date.now() - 60_000),
    );
    const cookie = await makeSessionCookie('fw_route_reader');
    const topicUrl = `/api/forum/topics/${topicId}`;

    // Anonymous reads keep the pre-123 shape: no viewer block at all.
    const anonymous = await call('GET', topicUrl);
    assert.equal(anonymous.status, 200);
    assert.equal(JSON.parse(anonymous.body).topic.viewer, null);

    const signedIn = await call('GET', topicUrl, cookie);
    assert.deepEqual(JSON.parse(signedIn.body).topic.viewer, { watching: false });
    assert.deepEqual((await getForumTopic(topicId))?.viewer, null);

    // Signed-out and wrong-method writes are refused before touching state.
    assert.equal((await call('PUT', `${topicUrl}/watch`)).status, 401);
    assert.equal((await call('PATCH', `${topicUrl}/watch`, cookie)).status, 405);
    assert.equal((await call('PUT', '/api/forum/topics/fw_missing/watch', cookie)).status, 404);
    assert.equal((await call('GET', `${topicUrl}/seen`, cookie)).status, 405);
    assert.equal((await call('POST', `${topicUrl}/seen`)).status, 401);

    const watched = await call('PUT', `${topicUrl}/watch`, cookie);
    assert.equal(watched.status, 200);
    assert.deepEqual(JSON.parse(watched.body), { watching: true });
    assert.deepEqual(JSON.parse((await call('GET', topicUrl, cookie)).body).topic.viewer, {
      watching: true,
    });

    // A reply after the watch rings the bell; visiting the topic clears it.
    await runSql(
      `UPDATE forum_topic_watches SET seen_at = now() - interval '1 minute'
       WHERE account_id = $1 AND topic_id = $2`,
      ['fw_route_reader', topicId],
    );
    await reply('fw_route_author', topicId, 'fw_route_reply', new Date());
    assert.equal((await unreadWatchedForumTopics('fw_route_reader')).total, 1);
    const seen = await call('POST', `${topicUrl}/seen`, cookie);
    assert.equal(seen.status, 200);
    assert.equal((await unreadWatchedForumTopics('fw_route_reader')).total, 0);

    const unwatched = await call('DELETE', `${topicUrl}/watch`, cookie);
    assert.deepEqual(JSON.parse(unwatched.body), { watching: false });
    assert.equal(await isWatchingForumTopic('fw_route_reader', topicId), false);

    // Quote links ride the reply route: ids are validated, junk is dropped.
    await reply('fw_route_reader', topicId, 'fw_route_reader_post', new Date());
    await runSql(
      `UPDATE forum_topic_watches SET seen_at = now() - interval '1 minute'
       WHERE account_id = $1 AND topic_id = $2`,
      ['fw_route_reader', topicId],
    );
    const authorCookie = await makeSessionCookie('fw_route_author');
    const quoting = await callJson(
      'POST',
      `${topicUrl}/posts`,
      { body: 'Quoting you.', quotedPostIds: ['fw_route_reader_post', 'nope', 42] },
      authorCookie,
    );
    assert.equal(quoting.status, 201);
    const bell = await unreadWatchedForumTopics('fw_route_reader');
    assert.equal(bell.total, 1);
    assert.equal(bell.topics[0]?.quote?.by, 'fwrouteauthor');
    assert.equal(bell.topics[0]?.quote?.postId, JSON.parse(quoting.body).post.id);
  });
});

// Fixture clock: seconds after module load, so ordering is explicit and never a
// same-ms tie. Nothing here may depend on how long after load a test runs:
// makeUser pins each account's bell watermark to its fixture `now`, so a post
// dated at(n) is in front of it however slow the runner. (Until 2026-09-17 the
// base sat 5 s ahead of load and the watermark stayed at the DB's now(); a CI
// shard whose migrations plus first tests took longer than that read 0.)
const BASE_MS = Date.now();
function at(seconds: number): Date {
  return new Date(BASE_MS + seconds * 1000);
}

function daysAgo(days: number, plusSeconds = 0): Date {
  return new Date(Date.now() - days * DAY_MS + plusSeconds * 1000);
}

async function makeUser(id: string, handle: string, now: Date): Promise<void> {
  await createUser({
    id,
    email: `${handle}@example.com`,
    emailVerifiedAt: now,
    handle,
    displayName: handle,
    now,
  });
  // 121 seeds the bell watermark with the DB's now(), and createUser leaves it
  // there; pin it to the fixture clock so only the per-topic rules decide what
  // counts, whatever the wall clock reads when this test finally runs.
  await runSql(`UPDATE users SET forum_replies_seen_at = $2 WHERE id = $1`, [id, now]);
}

async function makeTopic(
  authorAccountId: string,
  id: string,
  title: string,
  now: Date,
): Promise<string> {
  const category = (await listForumCategories())[0];
  assert.ok(category, 'expected a seeded forum category');
  const created = await createForumTopic({
    id,
    postId: `${id}_open`,
    categorySlug: category.slug,
    authorAccountId,
    authorRole: 'player',
    title,
    slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    bodyText: 'Opening post.',
    now,
  });
  assert.equal(created.ok, true);
  return id;
}

async function reply(
  authorAccountId: string,
  topicId: string,
  id: string,
  now: Date,
  quotedPostIds?: string[],
): Promise<void> {
  const posted = await addForumPost({
    id,
    topicId,
    authorAccountId,
    bodyText: 'A reply.',
    now,
    quotedPostIds,
  });
  assert.equal(posted.ok, true);
}

async function makeSessionCookie(userId: string): Promise<string> {
  const sessionId = `sess_${userId}`;
  const token = `tok_${userId}`;
  // currentAccountUser checks expiry against the wall clock, so the session
  // must outlive new Date() regardless of the fixture dates.
  const session: AccountSession = {
    id: sessionId,
    userId,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  };
  await createAccountSession(session);
  return `mistboard_session=${sessionId}.${token}`;
}

async function call(method: string, path: string, cookie?: string): Promise<ResponseCapture> {
  return dispatch(
    {
      method,
      headers: cookie ? { cookie } : {},
      async *[Symbol.asyncIterator]() {},
    } as unknown as IncomingMessage,
    method,
    path,
  );
}

async function callJson(
  method: string,
  path: string,
  body: unknown,
  cookie?: string,
): Promise<ResponseCapture> {
  const chunks = [Buffer.from(JSON.stringify(body))];
  return dispatch(
    {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      async *[Symbol.asyncIterator]() {
        yield* chunks;
      },
    } as unknown as IncomingMessage,
    method,
    path,
  );
}

async function dispatch(
  request: IncomingMessage,
  method: string,
  path: string,
): Promise<ResponseCapture> {
  const capture = {
    body: '',
    status: null as number | null,
    writeHead(status: number) {
      capture.status = status;
      return capture;
    },
    end(chunk?: string) {
      capture.body += chunk ?? '';
      return capture;
    },
  };
  const handled = await tryHandleForumRoute(
    {},
    request,
    capture as unknown as ServerResponse,
    path,
    new URL(`http://localhost${path}`),
  );
  assert.equal(handled, true, `expected ${method} ${path} to be handled by the forum router`);
  return capture;
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
