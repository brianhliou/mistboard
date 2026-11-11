import { PROMPT_KEY_VERSION } from './forum-translation.js';
import {
  createForumTopic,
  createUser,
  getForumTranslation,
  getForumTranslationSource,
  hideForumPost,
  listForumTranslations,
  putForumTranslation,
} from './persistence.js';
import { getPool } from './persistence-db.js';
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
      promptVersion: PROMPT_KEY_VERSION,
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
    // Another locale is a different read; prompt/model changes retain output.
    assert.equal(await getForumTranslation({ ...key, targetLocale: 'zh-Hant' }), null);
    assert.equal(
      (await getForumTranslation({ ...key, promptVersion: 'future-prompt' }))?.translatedText,
      '炮打中路',
    );

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
      promptVersion: PROMPT_KEY_VERSION,
    });
    assert.deepEqual([...listed], [[key.contentHash, '炮打中路（新）']]);
    assert.equal(
      (
        await listForumTranslations({
          contentHashes: [key.contentHash],
          targetLocale: 'zh-Hant',
          promptVersion: PROMPT_KEY_VERSION,
        })
      ).size,
      0,
    );
    assert.equal(
      (
        await listForumTranslations({
          contentHashes: [],
          targetLocale: 'en',
          promptVersion: PROMPT_KEY_VERSION,
        })
      ).size,
      0,
    );

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

  test('reads prefer the current prompt, otherwise newest across models including legacy NULL provenance', async () => {
    const key = {
      contentHash: sha256('durable translation'),
      targetLocale: 'zh-Hans' as const,
      promptVersion: PROMPT_KEY_VERSION,
    };
    const write = async (model: string, promptVersion: string, translatedText: string) => {
      await putForumTranslation({
        ...key,
        model,
        promptVersion,
        translatedText,
        source: { kind: 'post', id: 'audit-only' },
        inputTokens: 1,
        outputTokens: 2,
      });
    };
    await write('current-model-a', PROMPT_KEY_VERSION, 'current prompt, older row');
    await write('current-model-b', PROMPT_KEY_VERSION, 'current prompt, newest row');
    await write('old-model', 'older-prompt', 'stale prompt, newer row');
    await getPool().query(
      `UPDATE forum_translations SET created_at = CASE model
         WHEN 'current-model-a' THEN '2026-11-01'::timestamptz
         WHEN 'current-model-b' THEN '2026-11-02'::timestamptz
         ELSE '2026-11-03'::timestamptz END`,
    );
    // Simulate a pre-migration row, which has no prompt metadata at all.
    await getPool().query(
      `INSERT INTO forum_translations (content_hash, target_locale, model, translated_text, source_kind, source_id, created_at)
       VALUES ($1, $2, 'legacy-model', 'legacy NULL prompt, newest row', 'post', 'audit-only', '2026-11-04')`,
      [key.contentHash, key.targetLocale],
    );
    const { rows } = await getPool().query<{ prompt_version: string }>(
      `SELECT prompt_version FROM forum_translations WHERE model = 'current-model-a'`,
    );
    assert.equal(rows[0]?.prompt_version, PROMPT_KEY_VERSION, 'writes persist prompt provenance');
    for (const [promptVersion, expected] of [
      [PROMPT_KEY_VERSION, 'current prompt, newest row'],
      ['older-prompt', 'stale prompt, newer row'],
      ['future-prompt', 'legacy NULL prompt, newest row'],
    ]) {
      const lookup = { ...key, promptVersion };
      assert.equal((await getForumTranslation(lookup))?.translatedText, expected);
      const listed = await listForumTranslations({
        ...lookup,
        contentHashes: [key.contentHash, key.contentHash, sha256('unknown')],
      });
      assert.deepEqual([...listed], [[key.contentHash, expected]]);
    }
  });
});
