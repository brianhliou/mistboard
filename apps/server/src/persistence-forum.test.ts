import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  addForumPost,
  countRecentForumPostsByUser,
  countRecentForumTopicsByUser,
  createForumPostReport,
  createForumTopic,
  createForumTopicReport,
  createUser,
  getForumPostLocation,
  getForumTopic,
  hideForumPost,
  listForumCategories,
  listForumReports,
  listForumTopics,
  listLatestForumPosts,
  moderateForumTopic,
  moveForumTopic,
  putForumTranslation,
  resolveForumReport,
  searchForumPosts,
  searchForumTopics,
  updateForumPost,
  updateForumTopic,
} from './persistence.js';
import { getPool } from './persistence-db.js';
import { assert, definePersistenceTests, sha256, test } from './persistence-test-support.js';
import { tryHandle as tryHandleForumRoute } from './routes/forum.js';

type ResponseCapture = {
  body: string;
  headers: Record<string, string | string[]>;
  status: number | null;
};

definePersistenceTests('forum', () => {
  test('forum categories are seeded with a small starter taxonomy', async () => {
    const categories = await listForumCategories();
    assert.deepEqual(
      categories.map((category) => category.slug),
      ['general-discussion', 'feedback', 'game-analysis', 'off-topic-discussion'],
    );
    assert.equal(categories[0]?.name, 'General Games Discussion');
    assert.equal(categories[0]?.topicWritePolicy, 'account');

    await createUser({
      id: 'forum_user_regular',
      email: 'regular@example.com',
      emailVerifiedAt: new Date('2026-06-01T00:00:00Z'),
      handle: 'regular',
      displayName: 'Regular',
      now: new Date('2026-06-01T00:00:00Z'),
    });

    const result = await createForumTopic({
      id: 'topic_general_seeded',
      postId: 'post_general_seeded',
      categorySlug: 'general-discussion',
      authorAccountId: 'forum_user_regular',
      authorRole: 'player',
      title: 'General discussion works',
      slug: 'general-discussion-works',
      bodyText: 'This should publish.',
      now: new Date('2026-06-01T00:01:00Z'),
    });

    assert.equal(result.ok, true);
  });

  test('forum topics list newest activity and expose plaintext posts', async () => {
    const now = new Date('2026-06-01T00:00:00Z');
    await createUser({
      id: 'forum_user_alice',
      email: 'alice@example.com',
      emailVerifiedAt: now,
      handle: 'alice',
      displayName: 'Alice',
      now,
    });
    await createUser({
      id: 'forum_user_bob',
      email: 'bob@example.com',
      emailVerifiedAt: now,
      handle: 'bob',
      displayName: 'Bob',
      now,
    });

    const created = await createForumTopic({
      id: 'topic_strategy',
      postId: 'post_strategy_open',
      categorySlug: 'general-discussion',
      authorAccountId: 'forum_user_alice',
      authorRole: 'player',
      title: 'How do you scout the center?',
      slug: 'how-do-you-scout-the-center',
      bodyText: 'I like opening with central pawns.\nWhat else works?',
      now,
    });
    assert.equal(created.ok, true);

    const reply = await addForumPost({
      id: 'post_strategy_reply',
      topicId: 'topic_strategy',
      authorAccountId: 'forum_user_bob',
      bodyText: 'Developing knights first keeps more fog pressure.',
      now: new Date('2026-06-01T00:05:00Z'),
    });
    assert.equal(reply.ok, true);

    const topics = await listForumTopics({ limit: 5 });
    assert.equal(topics[0]?.id, 'topic_strategy');
    assert.equal(topics[0]?.postCount, 2);
    assert.equal(topics[0]?.category.slug, 'general-discussion');
    assert.equal(topics[0]?.author?.handle, 'alice');
    assert.equal(topics[0]?.latestPost?.post.id, 'post_strategy_reply');
    assert.equal(topics[0]?.latestPost?.author?.handle, 'bob');
    assert.equal(
      topics[0]?.latestPost?.excerpt,
      'Developing knights first keeps more fog pressure.',
    );

    const categories = await listForumCategories();
    const general = categories.find((category) => category.slug === 'general-discussion');
    assert.equal(general?.topicCount, 1);
    assert.equal(general?.postCount, 2);
    assert.equal(general?.latestPost?.topic.id, 'topic_strategy');
    assert.equal(general?.latestPost?.topic.postCount, 2);
    assert.equal(general?.latestPost?.post.id, 'post_strategy_reply');
    assert.equal(general?.latestPost?.author?.handle, 'bob');

    const detail = await getForumTopic('topic_strategy');
    assert.equal(detail?.posts.length, 2);
    assert.equal(
      detail?.posts[0]?.bodyText,
      'I like opening with central pawns.\nWhat else works?',
    );
    assert.equal(detail?.posts[1]?.author?.handle, 'bob');

    const pagedDetail = await getForumTopic('topic_strategy', { postLimit: 1, postOffset: 1 });
    assert.equal(pagedDetail?.postCount, 2);
    assert.equal(pagedDetail?.posts.length, 1);
    assert.equal(pagedDetail?.posts[0]?.id, 'post_strategy_reply');

    assert.equal(
      await countRecentForumTopicsByUser('forum_user_alice', new Date('2026-05-31T23:59:00Z')),
      1,
    );
    assert.equal(
      await countRecentForumPostsByUser('forum_user_bob', new Date('2026-05-31T23:59:00Z')),
      1,
    );

    const titleMatches = await searchForumTopics({ query: 'scout', limit: 5 });
    assert.equal(titleMatches[0]?.id, 'topic_strategy');
    const bodyMatches = await searchForumTopics({ query: 'knights', limit: 5 });
    assert.equal(bodyMatches[0]?.id, 'topic_strategy');
    const postMatches = await searchForumPosts({ query: 'knights', limit: 5 });
    assert.equal(postMatches.total, 1);
    assert.equal(postMatches.posts[0]?.post.id, 'post_strategy_reply');
    assert.equal(postMatches.posts[0]?.post.page, 1);
    assert.equal(postMatches.posts[0]?.topic.id, 'topic_strategy');
    assert.equal(postMatches.posts[0]?.topic.category.slug, 'general-discussion');
    assert.match(postMatches.posts[0]?.post.snippet ?? '', /knights/);
    const emptyPostPage = await searchForumPosts({ query: 'knights', limit: 5, offset: 5 });
    assert.equal(emptyPostPage.total, 1);
    assert.equal(emptyPostPage.posts.length, 0);
    const latestPosts = await listLatestForumPosts({ limit: 5 });
    assert.equal(latestPosts[0]?.post.id, 'post_strategy_reply');
    assert.equal(latestPosts[0]?.post.page, 1);
    assert.equal(latestPosts[0]?.topic.id, 'topic_strategy');
    assert.equal(latestPosts[0]?.author?.handle, 'bob');
    assert.equal(latestPosts[0]?.post.snippet, 'Developing knights first keeps more fog pressure.');
    assert.equal(latestPosts[1]?.post.id, 'post_strategy_open');
    assert.equal(latestPosts[1]?.author?.handle, 'alice');
    const postLocation = await getForumPostLocation('post_strategy_reply', { pageSize: 1 });
    assert.equal(postLocation?.page, 2);
    assert.equal(postLocation?.topic.slug, 'how-do-you-scout-the-center');

    const forbiddenTopicEdit = await updateForumTopic({
      topicId: 'topic_strategy',
      editorAccountId: 'forum_user_bob',
      editorRole: 'player',
      title: 'Bob should not retitle this',
      slug: 'bob-should-not-retitle-this',
      now: new Date('2026-06-01T00:05:30Z'),
    });
    assert.deepEqual(forbiddenTopicEdit, { ok: false, error: 'forbidden' });

    const editedTopic = await updateForumTopic({
      topicId: 'topic_strategy',
      editorAccountId: 'forum_user_alice',
      editorRole: 'player',
      title: 'How should we scout the center?',
      slug: 'how-should-we-scout-the-center',
      now: new Date('2026-06-01T00:05:45Z'),
    });
    assert.equal(editedTopic.ok, true);
    assert.equal(editedTopic.ok ? editedTopic.topic.title : '', 'How should we scout the center?');
    assert.equal(editedTopic.ok ? editedTopic.topic.slug : '', 'how-should-we-scout-the-center');
    assert.equal(
      editedTopic.ok ? editedTopic.topic.lastPostAt.toISOString() : '',
      '2026-06-01T00:05:00.000Z',
    );
    assert.equal(
      editedTopic.ok ? editedTopic.topic.updatedAt.toISOString() : '',
      '2026-06-01T00:05:45.000Z',
    );

    const forbiddenEdit = await updateForumPost({
      postId: 'post_strategy_reply',
      editorAccountId: 'forum_user_alice',
      editorRole: 'player',
      bodyText: 'Alice should not be able to edit this.',
      now: new Date('2026-06-01T00:06:00Z'),
    });
    assert.deepEqual(forbiddenEdit, { ok: false, error: 'forbidden' });

    const editedReply = await updateForumPost({
      postId: 'post_strategy_reply',
      editorAccountId: 'forum_user_bob',
      editorRole: 'player',
      bodyText: 'Developing knights and bishops keeps more fog pressure.',
      now: new Date('2026-06-01T00:07:00Z'),
    });
    assert.equal(editedReply.ok, true);
    assert.equal(
      editedReply.ok ? editedReply.post.bodyText : '',
      'Developing knights and bishops keeps more fog pressure.',
    );
    const detailAfterEdit = await getForumTopic('topic_strategy');
    assert.equal(
      detailAfterEdit?.posts[1]?.bodyText,
      'Developing knights and bishops keeps more fog pressure.',
    );
    assert.equal(detailAfterEdit?.posts[1]?.updatedAt.toISOString(), '2026-06-01T00:07:00.000Z');

    const searchResponse = captureResponse();
    const handled = await tryHandleForumRoute(
      {},
      { method: 'GET', headers: {} } as unknown as IncomingMessage,
      searchResponse,
      '/api/forum/search',
      new URL('http://localhost/api/forum/search?q=knights'),
    );
    assert.equal(handled, true);
    assert.equal(searchResponse.status, 200);
    assert.equal(JSON.parse(searchResponse.body).posts[0]?.post.id, 'post_strategy_reply');

    const redirectResponse = captureResponse();
    const redirectHandled = await tryHandleForumRoute(
      {},
      { method: 'GET', headers: {} } as unknown as IncomingMessage,
      redirectResponse,
      '/api/forum/posts/post_strategy_reply/redirect',
      new URL('http://localhost/api/forum/posts/post_strategy_reply/redirect'),
    );
    assert.equal(redirectHandled, true);
    assert.equal(redirectResponse.status, 200);
    assert.equal(
      JSON.parse(redirectResponse.body).href,
      '/forum/t/topic_strategy/how-should-we-scout-the-center#post_post_strategy_reply',
    );

    const latestResponse = captureResponse();
    const latestHandled = await tryHandleForumRoute(
      {},
      { method: 'GET', headers: {} } as unknown as IncomingMessage,
      latestResponse,
      '/api/forum/latest-posts',
      new URL('http://localhost/api/forum/latest-posts?limit=5'),
    );
    assert.equal(latestHandled, true);
    assert.equal(latestResponse.status, 200);
    const latestBody = JSON.parse(latestResponse.body);
    assert.equal(latestBody.posts.length, 2);
    assert.equal(latestBody.posts[0]?.post.id, 'post_strategy_reply');
    assert.equal(latestBody.posts[0]?.post.page, 1);
    assert.equal(latestBody.posts[0]?.topic.slug, 'how-should-we-scout-the-center');
    assert.equal(latestBody.posts[0]?.author?.handle, 'bob');
  });

  test('locked forum topics reject replies', async () => {
    const now = new Date('2026-06-01T00:00:00Z');
    await createUser({
      id: 'forum_user_lock',
      email: 'lock@example.com',
      emailVerifiedAt: now,
      handle: 'lock',
      displayName: 'Lock',
      now,
    });
    await createForumTopic({
      id: 'topic_locked',
      postId: 'post_locked_open',
      categorySlug: 'feedback',
      authorAccountId: 'forum_user_lock',
      authorRole: 'player',
      title: 'This feedback topic is locked',
      slug: 'this-feedback-topic-is-locked',
      bodyText: 'Initial report.',
      now,
    });
    await getPool().query('UPDATE forum_topics SET locked_at = $2 WHERE id = $1', [
      'topic_locked',
      new Date('2026-06-01T00:01:00Z'),
    ]);

    const reply = await addForumPost({
      id: 'post_locked_reply',
      topicId: 'topic_locked',
      authorAccountId: 'forum_user_lock',
      bodyText: 'Follow-up.',
      now: new Date('2026-06-01T00:02:00Z'),
    });

    assert.deepEqual(reply, { ok: false, error: 'topic_locked' });
  });

  test('forum moderation can pin, lock, hide posts, and hide topics', async () => {
    const now = new Date('2026-06-01T00:00:00Z');
    await createUser({
      id: 'forum_user_mod_author',
      email: 'mod-author@example.com',
      emailVerifiedAt: now,
      handle: 'modauthor',
      displayName: 'Mod Author',
      now,
    });
    await createUser({
      id: 'forum_user_moderator',
      email: 'moderator@example.com',
      emailVerifiedAt: now,
      handle: 'moderator',
      displayName: 'Moderator',
      accountRole: 'admin',
      now,
    });
    await createForumTopic({
      id: 'topic_moderated',
      postId: 'post_moderated_open',
      categorySlug: 'general-discussion',
      authorAccountId: 'forum_user_mod_author',
      authorRole: 'player',
      title: 'Moderated topic',
      slug: 'moderated-topic',
      bodyText: 'Opening post.',
      now,
    });
    await addForumPost({
      id: 'post_moderated_reply',
      topicId: 'topic_moderated',
      authorAccountId: 'forum_user_mod_author',
      bodyText: 'Reply to hide.',
      now: new Date('2026-06-01T00:05:00Z'),
    });

    const pinned = await moderateForumTopic({
      topicId: 'topic_moderated',
      moderatorAccountId: 'forum_user_moderator',
      action: 'pin',
      reason: null,
      now: new Date('2026-06-01T00:06:00Z'),
    });
    assert.equal(pinned.ok, true);
    assert.equal(pinned.ok ? pinned.topic?.pinnedAt instanceof Date : false, true);

    const locked = await moderateForumTopic({
      topicId: 'topic_moderated',
      moderatorAccountId: 'forum_user_moderator',
      action: 'lock',
      reason: null,
      now: new Date('2026-06-01T00:07:00Z'),
    });
    assert.equal(locked.ok, true);
    assert.equal(locked.ok ? locked.topic?.lockedAt instanceof Date : false, true);

    const lockedEdit = await updateForumPost({
      postId: 'post_moderated_open',
      editorAccountId: 'forum_user_mod_author',
      editorRole: 'player',
      bodyText: 'The author cannot rewrite a locked thread.',
      now: new Date('2026-06-01T00:07:15Z'),
    });
    assert.deepEqual(lockedEdit, { ok: false, error: 'topic_locked' });

    const adminEdit = await updateForumPost({
      postId: 'post_moderated_open',
      editorAccountId: 'forum_user_moderator',
      editorRole: 'admin',
      bodyText: 'Moderator cleanup.',
      now: new Date('2026-06-01T00:07:30Z'),
    });
    assert.equal(adminEdit.ok, true);
    assert.equal(adminEdit.ok ? adminEdit.post.bodyText : '', 'Moderator cleanup.');

    const moved = await moveForumTopic({
      topicId: 'topic_moderated',
      categorySlug: 'feedback',
      now: new Date('2026-06-01T00:07:45Z'),
    });
    assert.equal(moved.ok, true);
    assert.equal(moved.ok ? moved.topic.category.slug : '', 'feedback');
    assert.equal(moved.ok ? moved.topic.lastPostAt.toISOString() : '', '2026-06-01T00:05:00.000Z');
    assert.equal(moved.ok ? moved.topic.updatedAt.toISOString() : '', '2026-06-01T00:07:45.000Z');
    assert.equal(
      (await listForumTopics({ categorySlug: 'feedback', limit: 10 })).some(
        (topic) => topic.id === 'topic_moderated',
      ),
      true,
    );
    assert.equal(
      (await listForumTopics({ categorySlug: 'general-discussion', limit: 10 })).some(
        (topic) => topic.id === 'topic_moderated',
      ),
      false,
    );

    const hiddenPost = await hideForumPost({
      postId: 'post_moderated_reply',
      moderatorAccountId: 'forum_user_moderator',
      reason: 'cleanup',
      now: new Date('2026-06-01T00:08:00Z'),
    });
    assert.deepEqual(hiddenPost, { ok: true, topicHidden: false });
    const detailAfterPostHide = await getForumTopic('topic_moderated');
    assert.equal(detailAfterPostHide?.postCount, 1);
    assert.deepEqual(
      detailAfterPostHide?.posts.map((post) => post.id),
      ['post_moderated_open', 'post_moderated_reply'],
    );
    assert.equal(detailAfterPostHide?.posts[1]?.hiddenAt instanceof Date, true);
    assert.equal(detailAfterPostHide?.posts[1]?.bodyText, '');
    const hiddenSearch = await searchForumPosts({ query: 'Reply to hide', limit: 5 });
    assert.equal(hiddenSearch.total, 0);
    assert.equal(
      (await listLatestForumPosts({ limit: 10 })).some(
        (entry) => entry.post.id === 'post_moderated_reply',
      ),
      false,
    );

    const hiddenTopic = await moderateForumTopic({
      topicId: 'topic_moderated',
      moderatorAccountId: 'forum_user_moderator',
      action: 'hide',
      reason: 'duplicate',
      now: new Date('2026-06-01T00:09:00Z'),
    });
    assert.deepEqual(hiddenTopic, { ok: true, topic: null });
    assert.equal(await getForumTopic('topic_moderated'), null);
    assert.equal(
      (await listForumTopics({ limit: 10 })).some((topic) => topic.id === 'topic_moderated'),
      false,
    );
    assert.equal(
      (await listLatestForumPosts({ limit: 10 })).some(
        (entry) => entry.topic.id === 'topic_moderated',
      ),
      false,
    );
  });

  test('forum reports can be filed, listed, and resolved', async () => {
    const now = new Date('2026-06-01T00:00:00Z');
    await createUser({
      id: 'forum_user_report_author',
      email: 'report-author@example.com',
      emailVerifiedAt: now,
      handle: 'reportauthor',
      displayName: 'Report Author',
      now,
    });
    await createUser({
      id: 'forum_user_reporter',
      email: 'reporter@example.com',
      emailVerifiedAt: now,
      handle: 'reporter',
      displayName: 'Reporter',
      now,
    });
    await createUser({
      id: 'forum_user_report_moderator',
      email: 'report-moderator@example.com',
      emailVerifiedAt: now,
      handle: 'reportmod',
      displayName: 'Report Moderator',
      accountRole: 'admin',
      now,
    });
    await createForumTopic({
      id: 'topic_reported',
      postId: 'post_reported_open',
      categorySlug: 'general-discussion',
      authorAccountId: 'forum_user_report_author',
      authorRole: 'player',
      title: 'Reported topic',
      slug: 'reported-topic',
      bodyText: 'Opening post.',
      now,
    });
    await addForumPost({
      id: 'post_reported_reply',
      topicId: 'topic_reported',
      authorAccountId: 'forum_user_report_author',
      bodyText: 'Reported reply body.',
      now: new Date('2026-06-01T00:01:00Z'),
    });

    const topicReport = await createForumTopicReport({
      id: 'forum_report_topic',
      topicId: 'topic_reported',
      reporterAccountId: 'forum_user_reporter',
      reason: 'Needs moderator review',
      now: new Date('2026-06-01T00:02:00Z'),
    });
    assert.equal(topicReport.ok, true);
    assert.equal(topicReport.ok ? topicReport.report.targetType : '', 'topic');
    assert.equal(topicReport.ok ? topicReport.report.topic.title : '', 'Reported topic');

    const postReport = await createForumPostReport({
      id: 'forum_report_post',
      postId: 'post_reported_reply',
      reporterAccountId: 'forum_user_reporter',
      reason: 'Off topic reply',
      now: new Date('2026-06-01T00:03:00Z'),
    });
    assert.equal(postReport.ok, true);
    assert.equal(postReport.ok ? postReport.report.targetType : '', 'post');
    assert.equal(postReport.ok ? postReport.report.post?.snippet : '', 'Reported reply body.');
    assert.equal(postReport.ok ? postReport.report.post?.page : 0, 1);

    const selfTopicReport = await createForumTopicReport({
      id: 'forum_report_topic_self',
      topicId: 'topic_reported',
      reporterAccountId: 'forum_user_report_author',
      reason: 'My own topic',
      now: new Date('2026-06-01T00:03:30Z'),
    });
    assert.deepEqual(selfTopicReport, { ok: false, error: 'self_report' });

    const selfPostReport = await createForumPostReport({
      id: 'forum_report_post_self',
      postId: 'post_reported_reply',
      reporterAccountId: 'forum_user_report_author',
      reason: 'My own post',
      now: new Date('2026-06-01T00:03:45Z'),
    });
    assert.deepEqual(selfPostReport, { ok: false, error: 'self_report' });

    const duplicatePostReport = await createForumPostReport({
      id: 'forum_report_post_duplicate',
      postId: 'post_reported_reply',
      reporterAccountId: 'forum_user_reporter',
      reason: 'Same report',
      now: new Date('2026-06-01T00:04:00Z'),
    });
    assert.deepEqual(duplicatePostReport, { ok: false, error: 'already_reported' });

    const openReports = await listForumReports({ status: 'open', limit: 10 });
    assert.deepEqual(
      openReports.map((report) => report.id),
      ['forum_report_post', 'forum_report_topic'],
    );

    const resolved = await resolveForumReport({
      reportId: 'forum_report_topic',
      moderatorAccountId: 'forum_user_report_moderator',
      status: 'resolved',
      resolutionNote: 'Handled',
      now: new Date('2026-06-01T00:05:00Z'),
    });
    assert.equal(resolved.ok, true);
    assert.equal(resolved.ok ? resolved.report.status : '', 'resolved');
    assert.equal(resolved.ok ? resolved.report.resolutionNote : '', 'Handled');
    assert.equal(resolved.ok ? resolved.report.resolver?.handle : '', 'reportmod');

    const resolvedReports = await listForumReports({ status: 'resolved', limit: 10 });
    assert.deepEqual(
      resolvedReports.map((report) => report.id),
      ['forum_report_topic'],
    );
    const remainingOpenReports = await listForumReports({ status: 'open', limit: 10 });
    assert.deepEqual(
      remainingOpenReports.map((report) => report.id),
      ['forum_report_post'],
    );
  });

  test('forum reads carry cached translations for ?locale= and never ask the model', async () => {
    const now = new Date('2026-09-12T10:00:00Z');
    await createUser({
      id: 'forum_overlay_user',
      email: 'overlay@example.com',
      emailVerifiedAt: now,
      handle: 'overlay',
      displayName: 'Overlay',
      now,
    });
    const created = await createForumTopic({
      id: 'topic_overlay',
      postId: 'post_overlay_1',
      categorySlug: 'game-analysis',
      authorAccountId: 'forum_overlay_user',
      authorRole: 'player',
      title: 'Paste a game link and it shows as a board',
      slug: 'paste-a-game-link',
      bodyText: 'You can now show a game inside a forum post. Paste the link on its own line.',
      now,
    });
    assert.equal(created.ok, true);
    const reply = await addForumPost({
      id: 'post_overlay_2',
      topicId: 'topic_overlay',
      authorAccountId: 'forum_overlay_user',
      bodyText: 'Nobody has translated this reply.',
      now: new Date(now.getTime() + 60_000),
    });
    assert.equal(reply.ok, true);
    // Two rows a Translate click would have written: the title and the
    // opening post, both into zh-Hans, from an older model than today's.
    for (const [text, translatedText, kind, id] of [
      [
        'Paste a game link and it shows as a board',
        '粘贴对局链接即可显示为棋盘',
        'topic',
        'topic_overlay',
      ],
      [
        'You can now show a game inside a forum post. Paste the link on its own line.',
        '现在可以在论坛帖子中显示对局。把链接单独放在一行。',
        'post',
        'post_overlay_1',
      ],
    ] as const) {
      await putForumTranslation({
        contentHash: sha256(text),
        targetLocale: 'zh-Hans',
        model: 'an-older-model',
        translatedText,
        source: { kind, id },
        inputTokens: 1,
        outputTokens: 1,
      });
    }

    // The overlay is behind the same flag as the Translate route. The key's
    // presence is all the flag reads; this value is not a credential.
    const env = {
      flag: process.env.MISTBOARD_FORUM_TRANSLATION_ENABLED,
      key: process.env.ANTHROPIC_API_KEY,
    };
    process.env.MISTBOARD_FORUM_TRANSLATION_ENABLED = 'true';
    process.env.ANTHROPIC_API_KEY = 'present-for-the-flag-check';
    try {
      const get = async (path: string) => {
        const response = captureResponse();
        const handled = await tryHandleForumRoute(
          {},
          { method: 'GET', headers: {} } as unknown as IncomingMessage,
          response,
          new URL(`http://localhost${path}`).pathname,
          new URL(`http://localhost${path}`),
        );
        assert.equal(handled, true);
        assert.equal(response.status, 200);
        return JSON.parse(response.body);
      };
      type TopicJson = {
        id: string;
        translated?: { title?: string; excerpt?: string };
        posts?: { id: string; translated?: string }[];
      };

      // Lists: the latest post is the reply, which has no translation, so only
      // the title overlays; a zh-Hant or en reader gets nothing; no locale,
      // nothing.
      const zhHans = (await get('/api/forum/topics?locale=zh-Hans')) as { topics: TopicJson[] };
      const overlaid = zhHans.topics.find((topic) => topic.id === 'topic_overlay');
      assert.deepEqual(overlaid?.translated, { title: '粘贴对局链接即可显示为棋盘' });
      const zhHant = (await get('/api/forum/topics?locale=zh-Hant')) as { topics: TopicJson[] };
      assert.equal(
        zhHant.topics.find((topic) => topic.id === 'topic_overlay')?.translated,
        undefined,
      );
      const bare = (await get('/api/forum/topics')) as { topics: TopicJson[] };
      assert.equal(
        bare.topics.find((topic) => topic.id === 'topic_overlay')?.translated,
        undefined,
      );

      // The topic page: title and opening post overlaid, the reply untouched.
      const detail = (await get('/api/forum/topics/topic_overlay?locale=zh-Hans')) as {
        topic: TopicJson;
      };
      assert.equal(detail.topic.translated?.title, '粘贴对局链接即可显示为棋盘');
      assert.deepEqual(
        detail.topic.posts?.map((post) => [post.id, post.translated]),
        [
          ['post_overlay_1', '现在可以在论坛帖子中显示对局。把链接单独放在一行。'],
          ['post_overlay_2', undefined],
        ],
      );

      // The category index's latest-topic title.
      const categories = (await get('/api/forum/categories?locale=zh-Hans')) as {
        categories: { slug: string; latestPost: { topic: { translatedTitle?: string } } | null }[];
      };
      assert.equal(
        categories.categories.find((category) => category.slug === 'game-analysis')?.latestPost
          ?.topic.translatedTitle,
        '粘贴对局链接即可显示为棋盘',
      );

      // Flag off: reads answer exactly as before the overlay existed.
      process.env.MISTBOARD_FORUM_TRANSLATION_ENABLED = 'false';
      const off = (await get('/api/forum/topics/topic_overlay?locale=zh-Hans')) as {
        topic: TopicJson;
      };
      assert.equal(off.topic.translated, undefined);
      assert.equal(off.topic.posts?.[0]?.translated, undefined);
    } finally {
      if (env.flag === undefined) delete process.env.MISTBOARD_FORUM_TRANSLATION_ENABLED;
      else process.env.MISTBOARD_FORUM_TRANSLATION_ENABLED = env.flag;
      if (env.key === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = env.key;
    }
  });

  test('forum write routes require an account session', async () => {
    const response = captureResponse();
    const handled = await tryHandleForumRoute(
      {},
      { method: 'POST', headers: {} } as unknown as IncomingMessage,
      response,
      '/api/forum/topics',
      new URL('http://localhost/api/forum/topics'),
    );

    assert.equal(handled, true);
    assert.equal(response.status, 401);
    assert.deepEqual(JSON.parse(response.body), { error: 'not_signed_in' });

    const topicEditResponse = captureResponse();
    const topicEditHandled = await tryHandleForumRoute(
      {},
      requestWithJson({ title: 'Edited topic title' }, 'PATCH'),
      topicEditResponse,
      '/api/forum/topics/topic_missing',
      new URL('http://localhost/api/forum/topics/topic_missing'),
    );

    assert.equal(topicEditHandled, true);
    assert.equal(topicEditResponse.status, 401);
    assert.deepEqual(JSON.parse(topicEditResponse.body), { error: 'not_signed_in' });

    const editResponse = captureResponse();
    const editHandled = await tryHandleForumRoute(
      {},
      requestWithJson({ body: 'Edited body.' }, 'PATCH'),
      editResponse,
      '/api/forum/posts/post_missing',
      new URL('http://localhost/api/forum/posts/post_missing'),
    );

    assert.equal(editHandled, true);
    assert.equal(editResponse.status, 401);
    assert.deepEqual(JSON.parse(editResponse.body), { error: 'not_signed_in' });

    const reportResponse = captureResponse();
    const reportHandled = await tryHandleForumRoute(
      {},
      requestWithJson({ reason: 'spam' }, 'POST'),
      reportResponse,
      '/api/forum/topics/topic_missing/report',
      new URL('http://localhost/api/forum/topics/topic_missing/report'),
    );

    assert.equal(reportHandled, true);
    assert.equal(reportResponse.status, 401);
    assert.deepEqual(JSON.parse(reportResponse.body), { error: 'not_signed_in' });
  });

  test('forum moderation route rejects unknown actions', async () => {
    const response = captureResponse();
    const handled = await tryHandleForumRoute(
      {},
      requestWithJson({ action: 'feature' }),
      response,
      '/api/forum/topics/topic_missing/moderation',
      new URL('http://localhost/api/forum/topics/topic_missing/moderation'),
    );

    assert.equal(handled, true);
    assert.equal(response.status, 400);
    assert.deepEqual(JSON.parse(response.body), { error: 'invalid_action' });
  });
});

function requestWithJson(body: unknown, method = 'POST'): IncomingMessage {
  const chunks = [Buffer.from(JSON.stringify(body))];
  const request = {
    method,
    headers: { 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() {
      yield* chunks;
    },
  };
  return request as unknown as IncomingMessage;
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
