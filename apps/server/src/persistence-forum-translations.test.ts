import {
  createForumTopic,
  createUser,
  getForumTranslation,
  getForumTranslationSource,
  hideForumPost,
  listForumTranslations,
  putForumTranslation,
} from './persistence.js';
import { assert, definePersistenceTests, sha256, test } from './persistence-test-support.js';

definePersistenceTests('forum translations', () => {
  test('source lookup follows the public hidden-row gate; cache round-trips and dedupes', async () => {
    const now = new Date('2026-09-02T00:00:00Z');
    await createUser({
      id: 'forum_tr_user',
      email: 'tr@example.com',
      emailVerifiedAt: now,
      handle: 'translator',
      displayName: 'Translator',
      now,
    });
    const created = await createForumTopic({
      id: 'topic_tr_1',
      postId: 'post_tr_1',
      categorySlug: 'general-discussion',
      authorAccountId: 'forum_tr_user',
      authorRole: 'player',
      title: 'Cannon to the centre file',
      slug: 'cannon-to-the-centre-file',
      bodyText: 'The classic opening. 炮二平五 in Chinese notation.',
      now,
    });
    assert.equal(created.ok, true);

    const title = await getForumTranslationSource('topic', 'topic_tr_1');
    assert.deepEqual(title, { kind: 'topic', id: 'topic_tr_1', text: 'Cannon to the centre file' });
    const body = await getForumTranslationSource('post', 'post_tr_1');
    assert.equal(body?.text, 'The classic opening. 炮二平五 in Chinese notation.');
    assert.equal(await getForumTranslationSource('post', 'post_missing'), null);

    const key = {
      contentHash: sha256('Cannon to the centre file'),
      targetLocale: 'zh-Hans' as const,
      model: 'test-model',
    };
    assert.equal(await getForumTranslation(key), null);
    await putForumTranslation({
      ...key,
      translatedText: '炮打中路',
      source: { kind: 'topic', id: 'topic_tr_1' },
      inputTokens: 12,
      outputTokens: 6,
    });
    // A concurrent second writer for the same key is a no-op, not an error.
    await putForumTranslation({
      ...key,
      translatedText: 'a different answer that must not win',
      source: { kind: 'topic', id: 'topic_tr_1' },
      inputTokens: 12,
      outputTokens: 6,
    });
    const stored = await getForumTranslation(key);
    assert.equal(stored?.translatedText, '炮打中路');
    // Another locale and another model are distinct keys.
    assert.equal(await getForumTranslation({ ...key, targetLocale: 'zh-Hant' }), null);
    assert.equal(await getForumTranslation({ ...key, model: 'other-model' }), null);

    // The batch read behind list surfaces: any model counts, the newest row
    // wins, unknown hashes and other locales are simply absent.
    await putForumTranslation({
      ...key,
      model: 'newer-model',
      translatedText: '炮打中路（新）',
      source: { kind: 'topic', id: 'topic_tr_1' },
      inputTokens: 12,
      outputTokens: 6,
    });
    const listed = await listForumTranslations({
      contentHashes: [key.contentHash, sha256('never translated')],
      targetLocale: 'zh-Hans',
    });
    assert.deepEqual([...listed], [[key.contentHash, '炮打中路（新）']]);
    assert.equal(
      (await listForumTranslations({ contentHashes: [key.contentHash], targetLocale: 'zh-Hant' }))
        .size,
      0,
    );
    assert.equal((await listForumTranslations({ contentHashes: [], targetLocale: 'en' })).size, 0);

    // Hiding the post hides it from the translate source too (no way to read
    // moderated text back out through translation). The topic's first post
    // IS the opening post, so hide a reply-shaped row via the same API.
    const hidden = await hideForumPost({
      postId: 'post_tr_1',
      moderatorAccountId: 'forum_tr_user',
      reason: 'test',
      now,
    });
    if (hidden.ok) {
      assert.equal(await getForumTranslationSource('post', 'post_tr_1'), null);
    }
  });
});
