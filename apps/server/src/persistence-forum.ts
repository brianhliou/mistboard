import { forumExcerpt } from './forum-excerpt.js';
import type { AccountRole } from './persistence-accounts.js';
import { getPool, withTransaction } from './persistence-db.js';
import { ensureForumTopicWatch, isWatchingForumTopic } from './persistence-forum-watches.js';
import type { PlayerTitle } from './persistence-titles.js';

export type ForumTopicWritePolicy = 'account' | 'admin';

// How many earlier posts one reply may link as quotes (124). A cap, not a
// rule about the text: the body may quote more, only the first few link.
export const MAX_QUOTED_POSTS = 5;

export type ForumCategory = {
  id: string;
  slug: string;
  name: string;
  description: string;
  /** Per-locale overrides for name/description (migration 135), resolved by the
   *  client against its current locale. Empty when nothing is translated. */
  i18n: Record<string, unknown>;
  sortOrder: number;
  topicWritePolicy: ForumTopicWritePolicy;
  topicCount: number;
  postCount: number;
  latestPost: ForumCategoryLatestPost | null;
};

/** The category a topic or post belongs to, as a client needs it: enough to link
 *  and to label, including the locale overlay so the label can be localized. */
export type ForumCategoryRef = {
  slug: string;
  name: string;
  i18n: Record<string, unknown>;
};

export type ForumAuthor = {
  handle: string;
  displayName: string;
  // Verified player title (088), null for everyone else. Named `title` on the
  // AUTHOR, never on the topic: forum topics have their own unrelated title.
  title: PlayerTitle | null;
} | null;

export type ForumCategoryLatestPost = {
  post: {
    id: string;
  };
  topic: {
    id: string;
    slug: string;
    title: string;
    postCount: number;
  };
  author: ForumAuthor;
  createdAt: Date;
};

export type ForumTopicSummary = {
  id: string;
  slug: string;
  title: string;
  category: ForumCategoryRef;
  author: ForumAuthor;
  latestPost: ForumTopicLatestPost | null;
  postCount: number;
  pinnedAt: Date | null;
  lockedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lastPostAt: Date;
};

export type ForumTopicLatestPost = {
  post: {
    id: string;
  };
  author: ForumAuthor;
  createdAt: Date;
  /** Opening words of the post, plain text, for list surfaces (see forum-excerpt.ts). */
  excerpt: string;
  /** The whole post, server-side only: the translation cache is keyed by the
   *  hash of the full text, so an excerpt cannot be looked up. Never serialized. */
  bodyText: string;
};

export type ForumPost = {
  id: string;
  author: ForumAuthor;
  bodyText: string;
  createdAt: Date;
  updatedAt: Date;
  hiddenAt: Date | null;
};

export type ForumTopicDetail = ForumTopicSummary & {
  posts: ForumPost[];
  // The signed-in reader's own watch state (123); null for anonymous reads,
  // which keep the pre-123 shape.
  viewer: { watching: boolean } | null;
};

export type ForumPostSearchPage = {
  posts: ForumPostSearchResult[];
  total: number;
};

export type ForumPostSearchResult = {
  post: {
    id: string;
    page: number;
    snippet: string;
  };
  topic: {
    id: string;
    slug: string;
    title: string;
    postCount: number;
    category: ForumCategoryRef;
  };
  author: ForumAuthor;
  createdAt: Date;
};

export type ForumPostLocation = {
  postId: string;
  page: number;
  topic: {
    id: string;
    slug: string;
  };
};

export type ForumReportStatus = 'open' | 'resolved' | 'dismissed';

export type ForumReportResolutionStatus = Exclude<ForumReportStatus, 'open'>;

export type ForumReport = {
  id: string;
  status: ForumReportStatus;
  targetType: 'topic' | 'post';
  reason: string;
  resolutionNote: string | null;
  reporter: ForumAuthor;
  resolver: ForumAuthor;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
  topic: {
    id: string;
    slug: string;
    title: string;
    category: ForumCategoryRef;
    hiddenAt: Date | null;
  };
  post: {
    id: string;
    page: number;
    snippet: string;
    author: ForumAuthor;
    createdAt: Date;
    hiddenAt: Date | null;
  } | null;
};

export type CreateForumTopicResult =
  | { ok: true; topic: ForumTopicDetail }
  | { ok: false; error: 'category_not_found' | 'category_admin_only' };

export type AddForumPostResult =
  | { ok: true; post: ForumPost }
  | { ok: false; error: 'topic_not_found' | 'topic_locked' };

export type UpdateForumPostResult =
  | { ok: true; post: ForumPost }
  | { ok: false; error: 'post_not_found' | 'forbidden' | 'topic_locked' };

export type UpdateForumTopicResult =
  | { ok: true; topic: ForumTopicDetail }
  | { ok: false; error: 'topic_not_found' | 'forbidden' };

export type MoveForumTopicResult =
  | { ok: true; topic: ForumTopicDetail }
  | { ok: false; error: 'topic_not_found' | 'category_not_found' };

export type ForumTopicModerationAction = 'pin' | 'unpin' | 'lock' | 'unlock' | 'hide';

export type ModerateForumTopicResult =
  | { ok: true; topic: ForumTopicDetail | null }
  | { ok: false; error: 'topic_not_found' };

export type HideForumPostResult =
  | { ok: true; topicHidden: boolean }
  | { ok: false; error: 'post_not_found' };

export type CreateForumReportResult =
  | { ok: true; report: ForumReport }
  | {
      ok: false;
      error: 'topic_not_found' | 'post_not_found' | 'already_reported' | 'self_report';
    };

export type ResolveForumReportResult =
  | { ok: true; report: ForumReport }
  | { ok: false; error: 'report_not_found' };

export async function listForumCategories(): Promise<ForumCategory[]> {
  const { rows } = await getPool().query<ForumCategoryRow>(
    `SELECT c.id, c.slug, c.name, c.description, c.i18n, c.sort_order, c.topic_write_policy,
            COUNT(t.id)::int AS topic_count,
            COALESCE(SUM(t.post_count), 0)::int AS post_count,
            latest.topic_id AS latest_topic_id,
            latest.topic_slug AS latest_topic_slug,
            latest.topic_title AS latest_topic_title,
            latest.topic_post_count AS latest_topic_post_count,
            latest.post_id AS latest_post_id,
            latest.created_at AS latest_post_created_at,
            latest.author_handle AS latest_post_author_handle,
            latest.author_display_name AS latest_post_author_display_name,
            latest.author_title AS latest_post_author_title
     FROM forum_categories c
     LEFT JOIN forum_topics t ON t.category_id = c.id AND t.hidden_at IS NULL
     LEFT JOIN LATERAL (
       SELECT latest_topic.id AS topic_id,
              latest_topic.slug AS topic_slug,
              latest_topic.title AS topic_title,
              latest_topic.post_count AS topic_post_count,
              latest_post.id AS post_id,
              latest_post.created_at AS created_at,
              u.handle AS author_handle,
              COALESCE(u.display_name, u.handle) AS author_display_name, u.title AS author_title
       FROM forum_topics latest_topic
       LEFT JOIN LATERAL (
         SELECT p.id, p.author_account_id, p.created_at
         FROM forum_posts p
         WHERE p.topic_id = latest_topic.id AND p.hidden_at IS NULL
         ORDER BY p.created_at DESC, p.id DESC
         LIMIT 1
       ) latest_post ON TRUE
       LEFT JOIN users u ON u.id = latest_post.author_account_id
       WHERE latest_topic.category_id = c.id AND latest_topic.hidden_at IS NULL
       ORDER BY latest_post.created_at DESC NULLS LAST, latest_topic.created_at DESC
       LIMIT 1
     ) latest ON TRUE
     GROUP BY c.id, latest.topic_id, latest.topic_slug, latest.topic_title,
              latest.topic_post_count, latest.post_id, latest.created_at,
              latest.author_handle, latest.author_display_name, latest.author_title
     ORDER BY c.sort_order ASC, c.name ASC`,
  );
  return rows.map(categoryFromRow);
}

export async function listForumTopics(
  options: { categorySlug?: string | null; limit?: number; offset?: number } = {},
): Promise<ForumTopicSummary[]> {
  const limit = clampInt(options.limit ?? 20, 1, 50);
  const offset = clampInt(options.offset ?? 0, 0, 10_000);
  const categorySlug = options.categorySlug?.trim() || null;
  const { rows } = await getPool().query<ForumTopicRow>(
    `${FORUM_TOPIC_SELECT}
     WHERE t.hidden_at IS NULL
       AND ($1::text IS NULL OR c.slug = $1)
     ORDER BY (t.pinned_at IS NOT NULL) DESC, t.pinned_at DESC NULLS LAST,
              t.last_post_at DESC, t.created_at DESC
     LIMIT $2 OFFSET $3`,
    [categorySlug, limit, offset],
  );
  return rows.map(topicFromRow);
}

export async function searchForumTopics(options: {
  query: string;
  limit?: number;
  offset?: number;
}): Promise<ForumTopicSummary[]> {
  const query = options.query.trim();
  if (query.length < 2) return [];
  const limit = clampInt(options.limit ?? 20, 1, 50);
  const offset = clampInt(options.offset ?? 0, 0, 10_000);
  const pattern = `%${escapeLike(query)}%`;
  const { rows } = await getPool().query<ForumTopicRow>(
    `${FORUM_TOPIC_SELECT}
     WHERE t.hidden_at IS NULL
       AND (
         t.title ILIKE $1 ESCAPE '\\'
         OR EXISTS (
           SELECT 1
           FROM forum_posts matched_post
           WHERE matched_post.topic_id = t.id
             AND matched_post.hidden_at IS NULL
             AND matched_post.body_text ILIKE $1 ESCAPE '\\'
         )
       )
     ORDER BY (t.pinned_at IS NOT NULL) DESC, t.pinned_at DESC NULLS LAST,
              t.last_post_at DESC, t.created_at DESC
     LIMIT $2 OFFSET $3`,
    [pattern, limit, offset],
  );
  return rows.map(topicFromRow);
}

export async function searchForumPosts(options: {
  query: string;
  limit?: number;
  offset?: number;
}): Promise<ForumPostSearchPage> {
  const query = options.query.trim();
  if (query.length < 2) return { posts: [], total: 0 };
  const limit = clampInt(options.limit ?? 20, 1, 50);
  const offset = clampInt(options.offset ?? 0, 0, 10_000);
  const pattern = `%${escapeLike(query)}%`;
  const [matches, count] = await Promise.all([
    getPool().query<ForumPostSearchRow>(
      `SELECT p.id AS post_id,
              p.body_text,
              p.created_at AS post_created_at,
              u.handle AS author_handle,
              COALESCE(u.display_name, u.handle) AS author_display_name, u.title AS author_title,
              t.id AS topic_id,
              t.slug AS topic_slug,
              t.title AS topic_title,
              t.post_count AS topic_post_count,
              c.slug AS category_slug,
              c.name AS category_name,
              c.i18n AS category_i18n,
              GREATEST(1, (
                (
                  SELECT COUNT(*)::int
                  FROM forum_posts before_post
                  WHERE before_post.topic_id = p.topic_id
                    AND (
                      before_post.created_at < p.created_at
                      OR (
                        before_post.created_at = p.created_at
                        AND before_post.id <= p.id
                      )
                    )
                ) - 1
              ) / 25 + 1) AS post_page
       FROM forum_posts p
       JOIN forum_topics t ON t.id = p.topic_id
       JOIN forum_categories c ON c.id = t.category_id
       LEFT JOIN users u ON u.id = p.author_account_id
       WHERE p.hidden_at IS NULL
         AND t.hidden_at IS NULL
         AND (
           p.body_text ILIKE $1 ESCAPE '\\'
           OR t.title ILIKE $1 ESCAPE '\\'
         )
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT $2 OFFSET $3`,
      [pattern, limit, offset],
    ),
    getPool().query<{ total_count: number }>(
      `SELECT COUNT(*)::int AS total_count
       FROM forum_posts p
       JOIN forum_topics t ON t.id = p.topic_id
       WHERE p.hidden_at IS NULL
         AND t.hidden_at IS NULL
         AND (
           p.body_text ILIKE $1 ESCAPE '\\'
           OR t.title ILIKE $1 ESCAPE '\\'
         )`,
      [pattern],
    ),
  ]);
  const rows = matches.rows;
  return {
    posts: rows.map((row) => postSearchResultFromRow(row, query)),
    total: count.rows[0]?.total_count ?? 0,
  };
}

// Newest visible posts across all topics (opening posts and replies alike),
// for the homepage "latest forum posts" widget. Reuses the search result shape
// so the route can serialize both with one path.
export async function listLatestForumPosts(
  options: { limit?: number } = {},
): Promise<ForumPostSearchResult[]> {
  const limit = clampInt(options.limit ?? 8, 1, 20);
  const { rows } = await getPool().query<ForumPostSearchRow>(
    `SELECT p.id AS post_id,
            p.body_text,
            p.created_at AS post_created_at,
            u.handle AS author_handle,
            COALESCE(u.display_name, u.handle) AS author_display_name, u.title AS author_title,
            t.id AS topic_id,
            t.slug AS topic_slug,
            t.title AS topic_title,
            t.post_count AS topic_post_count,
            c.slug AS category_slug,
            c.name AS category_name,
            c.i18n AS category_i18n,
            GREATEST(1, (
              (
                SELECT COUNT(*)::int
                FROM forum_posts before_post
                WHERE before_post.topic_id = p.topic_id
                  AND (
                    before_post.created_at < p.created_at
                    OR (
                      before_post.created_at = p.created_at
                      AND before_post.id <= p.id
                    )
                  )
              ) - 1
            ) / 25 + 1) AS post_page
     FROM forum_posts p
     JOIN forum_topics t ON t.id = p.topic_id
     JOIN forum_categories c ON c.id = t.category_id
     LEFT JOIN users u ON u.id = p.author_account_id
     WHERE p.hidden_at IS NULL
       AND t.hidden_at IS NULL
     ORDER BY p.created_at DESC, p.id DESC
     LIMIT $1`,
    [limit],
  );
  return rows.map((row) => postSearchResultFromRow(row));
}

export async function getForumPostLocation(
  postId: string,
  options: { pageSize?: number } = {},
): Promise<ForumPostLocation | null> {
  const pageSize = clampInt(options.pageSize ?? 25, 1, 100);
  const { rows } = await getPool().query<{
    post_id: string;
    topic_id: string;
    topic_slug: string;
    post_position: number;
  }>(
    `SELECT p.id AS post_id,
            t.id AS topic_id,
            t.slug AS topic_slug,
            (
              SELECT COUNT(*)::int
              FROM forum_posts before_post
              WHERE before_post.topic_id = p.topic_id
                AND (
                  before_post.created_at < p.created_at
                  OR (
                    before_post.created_at = p.created_at
                    AND before_post.id <= p.id
                  )
                )
            ) AS post_position
     FROM forum_posts p
     JOIN forum_topics t ON t.id = p.topic_id
     WHERE p.id = $1
       AND p.hidden_at IS NULL
       AND t.hidden_at IS NULL`,
    [postId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    postId: row.post_id,
    page: Math.max(1, Math.ceil(row.post_position / pageSize)),
    topic: {
      id: row.topic_id,
      slug: row.topic_slug,
    },
  };
}

export async function getForumTopic(
  id: string,
  options: { postLimit?: number; postOffset?: number; viewerAccountId?: string | null } = {},
): Promise<ForumTopicDetail | null> {
  const { rows } = await getPool().query<ForumTopicRow>(
    `${FORUM_TOPIC_SELECT}
     WHERE t.id = $1 AND t.hidden_at IS NULL`,
    [id],
  );
  const topic = rows[0] ? topicFromRow(rows[0]) : null;
  if (!topic) return null;
  const [posts, watching] = await Promise.all([
    listForumPosts(id, { limit: options.postLimit, offset: options.postOffset }),
    options.viewerAccountId
      ? isWatchingForumTopic(options.viewerAccountId, id)
      : Promise.resolve(null),
  ]);
  return { ...topic, posts, viewer: watching === null ? null : { watching } };
}

export async function createForumTopic(input: {
  id: string;
  postId: string;
  categorySlug: string;
  authorAccountId: string;
  authorRole: AccountRole;
  title: string;
  slug: string;
  bodyText: string;
  now: Date;
}): Promise<CreateForumTopicResult> {
  const result = await withTransaction<
    { ok: true } | { ok: false; error: 'category_not_found' | 'category_admin_only' }
  >(async (client) => {
    const { rows: categories } = await client.query<{
      id: string;
      topic_write_policy: ForumTopicWritePolicy;
    }>(
      `SELECT id, topic_write_policy
       FROM forum_categories
       WHERE slug = $1`,
      [input.categorySlug],
    );
    const category = categories[0];
    if (!category) return { ok: false, error: 'category_not_found' };
    if (category.topic_write_policy === 'admin' && input.authorRole !== 'admin') {
      return { ok: false, error: 'category_admin_only' };
    }

    await client.query(
      `INSERT INTO forum_topics
         (id, category_id, author_account_id, slug, title, post_count, last_post_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 1, $6, $6, $6)`,
      [input.id, category.id, input.authorAccountId, input.slug, input.title, input.now],
    );
    await client.query(
      `INSERT INTO forum_posts
         (id, topic_id, author_account_id, body_text, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $5)`,
      [input.postId, input.id, input.authorAccountId, input.bodyText, input.now],
    );
    // Starting a thread watches it (123): replies land in the author's bell.
    await ensureForumTopicWatch(client, {
      accountId: input.authorAccountId,
      topicId: input.id,
      now: input.now,
    });
    return { ok: true };
  });
  if (!result.ok) return result;
  const topic = await getForumTopic(input.id);
  if (!topic) throw new Error(`forum topic ${input.id} missing after insert`);
  return { ok: true, topic };
}

export async function addForumPost(input: {
  id: string;
  topicId: string;
  authorAccountId: string;
  bodyText: string;
  now: Date;
  // Earlier posts this reply quotes (124), as sent by the Quote button.
  // Validated here to visible posts in the same topic; anything else is
  // dropped silently, since the quoted text stands on its own either way.
  quotedPostIds?: readonly string[];
}): Promise<AddForumPostResult> {
  return withTransaction(async (client) => {
    const { rows: topics } = await client.query<{
      id: string;
      locked_at: Date | null;
      hidden_at: Date | null;
    }>(
      `SELECT id, locked_at, hidden_at
       FROM forum_topics
       WHERE id = $1
       FOR UPDATE`,
      [input.topicId],
    );
    const topic = topics[0];
    if (!topic || topic.hidden_at) return { ok: false, error: 'topic_not_found' };
    if (topic.locked_at) return { ok: false, error: 'topic_locked' };

    const { rows } = await client.query<ForumPostRow>(
      `WITH inserted AS (
         INSERT INTO forum_posts
           (id, topic_id, author_account_id, body_text, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $5)
         RETURNING id, author_account_id, body_text, created_at, updated_at, hidden_at
       )
       SELECT i.id, i.body_text, i.created_at, i.updated_at, i.hidden_at,
              u.handle AS author_handle, COALESCE(u.display_name, u.handle) AS author_display_name, u.title AS author_title
       FROM inserted i
       LEFT JOIN users u ON u.id = i.author_account_id`,
      [input.id, input.topicId, input.authorAccountId, input.bodyText, input.now],
    );
    await client.query(
      `UPDATE forum_topics
       SET post_count = post_count + 1,
           last_post_at = $2,
           updated_at = $2
       WHERE id = $1`,
      [input.topicId, input.now],
    );
    // Replying watches the thread (123), and counts as having read it up to
    // this moment. Overrides a prior unwatch on purpose: replying is opting in.
    await ensureForumTopicWatch(client, {
      accountId: input.authorAccountId,
      topicId: input.topicId,
      now: input.now,
    });
    const quotedPostIds = [...new Set(input.quotedPostIds ?? [])].slice(0, MAX_QUOTED_POSTS);
    if (quotedPostIds.length > 0) {
      await client.query(
        `INSERT INTO forum_post_quotes (post_id, quoted_post_id, created_at)
         SELECT $1, q.id, $4
         FROM forum_posts q
         WHERE q.id = ANY($2::text[])
           AND q.topic_id = $3
           AND q.hidden_at IS NULL
         ON CONFLICT DO NOTHING`,
        [input.id, quotedPostIds, input.topicId, input.now],
      );
    }
    const post = postFromRow(rows[0]!);
    return { ok: true, post };
  });
}

export async function updateForumPost(input: {
  postId: string;
  editorAccountId: string;
  editorRole: AccountRole;
  bodyText: string;
  now: Date;
}): Promise<UpdateForumPostResult> {
  return withTransaction(async (client) => {
    const { rows: targets } = await client.query<{
      author_account_id: string;
      topic_id: string;
      locked_at: Date | null;
    }>(
      `SELECT p.author_account_id, p.topic_id, t.locked_at
       FROM forum_posts p
       JOIN forum_topics t ON t.id = p.topic_id
       WHERE p.id = $1
         AND p.hidden_at IS NULL
         AND t.hidden_at IS NULL
       FOR UPDATE OF p`,
      [input.postId],
    );
    const target = targets[0];
    if (!target) return { ok: false, error: 'post_not_found' };
    if (target.author_account_id !== input.editorAccountId && input.editorRole !== 'admin') {
      return { ok: false, error: 'forbidden' };
    }
    // A lock freezes the thread as it stands: an author rewriting an old post
    // under it would be the one edit nobody can answer. Admins still can, the
    // same way they can still hide.
    if (target.locked_at && input.editorRole !== 'admin') {
      return { ok: false, error: 'topic_locked' };
    }

    const { rows } = await client.query<ForumPostRow>(
      `WITH updated AS (
         UPDATE forum_posts
         SET body_text = $2,
             updated_at = $3
         WHERE id = $1
         RETURNING id, author_account_id, body_text, created_at, updated_at, hidden_at
       )
       SELECT p.id, p.body_text, p.created_at, p.updated_at, p.hidden_at,
              u.handle AS author_handle, COALESCE(u.display_name, u.handle) AS author_display_name, u.title AS author_title
       FROM updated p
       LEFT JOIN users u ON u.id = p.author_account_id`,
      [input.postId, input.bodyText, input.now],
    );
    await client.query(
      `UPDATE forum_topics
       SET updated_at = $2
       WHERE id = $1`,
      [target.topic_id, input.now],
    );
    return { ok: true, post: postFromRow(rows[0]!) };
  });
}

export async function updateForumTopic(input: {
  topicId: string;
  editorAccountId: string;
  editorRole: AccountRole;
  title: string;
  slug: string;
  now: Date;
}): Promise<UpdateForumTopicResult> {
  const result = await withTransaction<
    { ok: true } | { ok: false; error: 'topic_not_found' | 'forbidden' }
  >(async (client) => {
    const { rows: targets } = await client.query<{ author_account_id: string | null }>(
      `SELECT author_account_id
       FROM forum_topics
       WHERE id = $1 AND hidden_at IS NULL
       FOR UPDATE`,
      [input.topicId],
    );
    const target = targets[0];
    if (!target) return { ok: false, error: 'topic_not_found' };
    if (target.author_account_id !== input.editorAccountId && input.editorRole !== 'admin') {
      return { ok: false, error: 'forbidden' };
    }

    await client.query(
      `UPDATE forum_topics
       SET title = $2,
           slug = $3,
           updated_at = $4
       WHERE id = $1`,
      [input.topicId, input.title, input.slug, input.now],
    );
    return { ok: true };
  });
  if (!result.ok) return result;
  const topic = await getForumTopic(input.topicId);
  if (!topic) throw new Error(`forum topic ${input.topicId} missing after update`);
  return { ok: true, topic };
}

export async function moveForumTopic(input: {
  topicId: string;
  categorySlug: string;
  now: Date;
}): Promise<MoveForumTopicResult> {
  const result = await withTransaction<
    { ok: true } | { ok: false; error: 'topic_not_found' | 'category_not_found' }
  >(async (client) => {
    const { rows: categories } = await client.query<{ id: string }>(
      `SELECT id
       FROM forum_categories
       WHERE slug = $1`,
      [input.categorySlug],
    );
    const category = categories[0];
    if (!category) return { ok: false, error: 'category_not_found' };

    const { rowCount } = await client.query(
      `UPDATE forum_topics
       SET category_id = $2,
           updated_at = $3
       WHERE id = $1 AND hidden_at IS NULL`,
      [input.topicId, category.id, input.now],
    );
    if (rowCount === 0) return { ok: false, error: 'topic_not_found' };
    return { ok: true };
  });
  if (!result.ok) return result;
  const topic = await getForumTopic(input.topicId);
  if (!topic) throw new Error(`forum topic ${input.topicId} missing after move`);
  return { ok: true, topic };
}

export async function moderateForumTopic(input: {
  topicId: string;
  moderatorAccountId: string | null;
  action: ForumTopicModerationAction;
  reason: string | null;
  now: Date;
}): Promise<ModerateForumTopicResult> {
  const result = await withTransaction<{ ok: true } | { ok: false; error: 'topic_not_found' }>(
    async (client) => {
      const patch = topicModerationPatch(input.action);
      const { rowCount } = await client.query(
        `UPDATE forum_topics
         SET ${patch}, updated_at = $2
         WHERE id = $1 AND hidden_at IS NULL`,
        input.action === 'hide'
          ? [input.topicId, input.now, input.moderatorAccountId, input.reason]
          : [input.topicId, input.now],
      );
      if (rowCount === 0) return { ok: false, error: 'topic_not_found' };
      return { ok: true };
    },
  );
  if (!result.ok) return result;
  if (input.action === 'hide') return { ok: true, topic: null };
  const topic = await getForumTopic(input.topicId);
  if (!topic) throw new Error(`forum topic ${input.topicId} missing after moderation`);
  return { ok: true, topic };
}

export async function hideForumPost(input: {
  postId: string;
  moderatorAccountId: string | null;
  reason: string | null;
  now: Date;
}): Promise<HideForumPostResult> {
  return withTransaction(async (client) => {
    const { rows: posts } = await client.query<{ topic_id: string }>(
      `UPDATE forum_posts
       SET hidden_at = $2,
           hidden_by_account_id = $3,
           hidden_reason = $4,
           updated_at = $2
       WHERE id = $1 AND hidden_at IS NULL
       RETURNING topic_id`,
      [input.postId, input.now, input.moderatorAccountId, input.reason],
    );
    const post = posts[0];
    if (!post) return { ok: false, error: 'post_not_found' };

    const { rows: visibleRows } = await client.query<{
      visible_count: number;
      last_visible_post_at: Date | null;
    }>(
      `SELECT COUNT(*)::int AS visible_count, MAX(created_at) AS last_visible_post_at
       FROM forum_posts
       WHERE topic_id = $1 AND hidden_at IS NULL`,
      [post.topic_id],
    );
    const visible = visibleRows[0] ?? { visible_count: 0, last_visible_post_at: null };
    const topicHidden = visible.visible_count === 0;
    await client.query(
      `UPDATE forum_topics
       SET post_count = $2,
           last_post_at = COALESCE($3, last_post_at),
           hidden_at = CASE WHEN $4 THEN $5 ELSE hidden_at END,
           hidden_by_account_id = CASE WHEN $4 THEN $6 ELSE hidden_by_account_id END,
           hidden_reason = CASE WHEN $4 THEN $7 ELSE hidden_reason END,
           updated_at = $5
       WHERE id = $1`,
      [
        post.topic_id,
        visible.visible_count,
        visible.last_visible_post_at,
        topicHidden,
        input.now,
        input.moderatorAccountId,
        input.reason,
      ],
    );
    return { ok: true, topicHidden };
  });
}

export async function createForumTopicReport(input: {
  id: string;
  topicId: string;
  reporterAccountId: string;
  reason: string;
  now: Date;
}): Promise<CreateForumReportResult> {
  const result = await withTransaction<
    { ok: true } | { ok: false; error: 'topic_not_found' | 'already_reported' | 'self_report' }
  >(async (client) => {
    const { rows: topics } = await client.query<{ author_account_id: string; id: string }>(
      `SELECT id, author_account_id
       FROM forum_topics
       WHERE id = $1 AND hidden_at IS NULL`,
      [input.topicId],
    );
    const topic = topics[0];
    if (!topic) return { ok: false, error: 'topic_not_found' };
    if (topic.author_account_id === input.reporterAccountId) {
      return { ok: false, error: 'self_report' };
    }

    const { rows: existingReports } = await client.query<{ id: string }>(
      `SELECT id
       FROM forum_reports
       WHERE reporter_account_id = $1
         AND topic_id = $2
         AND status = 'open'
       LIMIT 1`,
      [input.reporterAccountId, input.topicId],
    );
    if (existingReports[0]) return { ok: false, error: 'already_reported' };

    await client.query(
      `INSERT INTO forum_reports
         (id, reporter_account_id, target_type, topic_id, reason, created_at, updated_at)
       VALUES ($1, $2, 'topic', $3, $4, $5, $5)`,
      [input.id, input.reporterAccountId, input.topicId, input.reason, input.now],
    );
    return { ok: true };
  });
  if (!result.ok) return result;
  const report = await getForumReportById(input.id);
  if (!report) throw new Error(`forum report ${input.id} missing after insert`);
  return { ok: true, report };
}

export async function createForumPostReport(input: {
  id: string;
  postId: string;
  reporterAccountId: string;
  reason: string;
  now: Date;
}): Promise<CreateForumReportResult> {
  const result = await withTransaction<
    { ok: true } | { ok: false; error: 'post_not_found' | 'already_reported' | 'self_report' }
  >(async (client) => {
    const { rows: posts } = await client.query<{ author_account_id: string; id: string }>(
      `SELECT p.id, p.author_account_id
       FROM forum_posts p
       JOIN forum_topics t ON t.id = p.topic_id
       WHERE p.id = $1
         AND p.hidden_at IS NULL
         AND t.hidden_at IS NULL`,
      [input.postId],
    );
    const post = posts[0];
    if (!post) return { ok: false, error: 'post_not_found' };
    if (post.author_account_id === input.reporterAccountId) {
      return { ok: false, error: 'self_report' };
    }

    const { rows: existingReports } = await client.query<{ id: string }>(
      `SELECT id
       FROM forum_reports
       WHERE reporter_account_id = $1
         AND post_id = $2
         AND status = 'open'
       LIMIT 1`,
      [input.reporterAccountId, input.postId],
    );
    if (existingReports[0]) return { ok: false, error: 'already_reported' };

    await client.query(
      `INSERT INTO forum_reports
         (id, reporter_account_id, target_type, post_id, reason, created_at, updated_at)
       VALUES ($1, $2, 'post', $3, $4, $5, $5)`,
      [input.id, input.reporterAccountId, input.postId, input.reason, input.now],
    );
    return { ok: true };
  });
  if (!result.ok) return result;
  const report = await getForumReportById(input.id);
  if (!report) throw new Error(`forum report ${input.id} missing after insert`);
  return { ok: true, report };
}

export async function listForumReports(
  options: { status?: ForumReportStatus | 'all'; limit?: number; offset?: number } = {},
): Promise<ForumReport[]> {
  const status = options.status && options.status !== 'all' ? options.status : null;
  const limit = clampInt(options.limit ?? 50, 1, 100);
  const offset = clampInt(options.offset ?? 0, 0, 10_000);
  const { rows } = await getPool().query<ForumReportRow>(
    `${FORUM_REPORT_SELECT}
     WHERE ($1::text IS NULL OR r.status = $1)
     ORDER BY (r.status = 'open') DESC, r.created_at DESC, r.id DESC
     LIMIT $2 OFFSET $3`,
    [status, limit, offset],
  );
  return rows.map(reportFromRow);
}

export async function resolveForumReport(input: {
  reportId: string;
  moderatorAccountId: string | null;
  status: ForumReportResolutionStatus;
  resolutionNote: string | null;
  now: Date;
}): Promise<ResolveForumReportResult> {
  const { rowCount } = await getPool().query(
    `UPDATE forum_reports
     SET status = $2,
         resolution_note = $3,
         resolved_by_account_id = $4,
         resolved_at = $5,
         updated_at = $5
     WHERE id = $1`,
    [input.reportId, input.status, input.resolutionNote, input.moderatorAccountId, input.now],
  );
  if (rowCount === 0) return { ok: false, error: 'report_not_found' };
  const report = await getForumReportById(input.reportId);
  if (!report) throw new Error(`forum report ${input.reportId} missing after resolution`);
  return { ok: true, report };
}

export async function countRecentForumTopicsByUser(userId: string, since: Date): Promise<number> {
  const { rows } = await getPool().query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM forum_topics
     WHERE author_account_id = $1 AND created_at >= $2`,
    [userId, since],
  );
  return Number(rows[0]?.count ?? '0');
}

export async function countRecentForumPostsByUser(userId: string, since: Date): Promise<number> {
  const { rows } = await getPool().query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM forum_posts
     WHERE author_account_id = $1 AND created_at >= $2`,
    [userId, since],
  );
  return Number(rows[0]?.count ?? '0');
}

async function listForumPosts(
  topicId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<ForumPost[]> {
  const limit = options.limit === undefined ? null : clampInt(options.limit, 1, 100);
  const offset = clampInt(options.offset ?? 0, 0, 10_000);
  const { rows } = await getPool().query<ForumPostRow>(
    `SELECT p.id,
            CASE WHEN p.hidden_at IS NULL THEN p.body_text ELSE '' END AS body_text,
            p.created_at, p.updated_at, p.hidden_at,
            u.handle AS author_handle, COALESCE(u.display_name, u.handle) AS author_display_name, u.title AS author_title
     FROM forum_posts p
     LEFT JOIN users u ON u.id = p.author_account_id
     WHERE p.topic_id = $1
     ORDER BY p.created_at ASC, p.id ASC
     LIMIT $2::int OFFSET $3::int`,
    [topicId, limit, offset],
  );
  return rows.map(postFromRow);
}

const FORUM_TOPIC_SELECT = `SELECT t.id, t.slug, t.title, t.post_count, t.pinned_at, t.locked_at,
          t.created_at, t.updated_at, t.last_post_at,
          c.slug AS category_slug, c.name AS category_name, c.i18n AS category_i18n,
          u.handle AS author_handle, COALESCE(u.display_name, u.handle) AS author_display_name, u.title AS author_title,
          latest_post.id AS latest_post_id,
          latest_post.created_at AS latest_post_created_at,
          latest_u.handle AS latest_post_author_handle,
          COALESCE(latest_u.display_name, latest_u.handle) AS latest_post_author_display_name, latest_u.title AS latest_post_author_title,
          latest_post.body_text AS latest_post_body_text
   FROM forum_topics t
   JOIN forum_categories c ON c.id = t.category_id
   LEFT JOIN users u ON u.id = t.author_account_id
   LEFT JOIN LATERAL (
     SELECT p.id, p.author_account_id, p.created_at, p.body_text
     FROM forum_posts p
     WHERE p.topic_id = t.id AND p.hidden_at IS NULL
     ORDER BY p.created_at DESC, p.id DESC
     LIMIT 1
   ) latest_post ON TRUE
  LEFT JOIN users latest_u ON latest_u.id = latest_post.author_account_id`;

const FORUM_REPORT_SELECT = `SELECT r.id, r.status, r.target_type, r.reason, r.resolution_note,
          r.created_at, r.updated_at, r.resolved_at,
          reporter.handle AS reporter_handle,
          COALESCE(reporter.display_name, reporter.handle) AS reporter_display_name, reporter.title AS reporter_title,
          resolver.handle AS resolver_handle,
          COALESCE(resolver.display_name, resolver.handle) AS resolver_display_name, resolver.title AS resolver_title,
          t.id AS topic_id,
          t.slug AS topic_slug,
          t.title AS topic_title,
          t.hidden_at AS topic_hidden_at,
          c.slug AS category_slug,
          c.name AS category_name,
          c.i18n AS category_i18n,
          p.id AS post_id,
          p.body_text AS post_body_text,
          p.created_at AS post_created_at,
          p.hidden_at AS post_hidden_at,
          post_author.handle AS post_author_handle,
          COALESCE(post_author.display_name, post_author.handle) AS post_author_display_name, post_author.title AS post_author_title,
          CASE
            WHEN p.id IS NULL THEN NULL
            ELSE GREATEST(1, (
              (
                SELECT COUNT(*)::int
                FROM forum_posts before_post
                WHERE before_post.topic_id = p.topic_id
                  AND (
                    before_post.created_at < p.created_at
                    OR (
                      before_post.created_at = p.created_at
                      AND before_post.id <= p.id
                    )
                  )
              ) - 1
            ) / 25 + 1)
          END AS post_page
   FROM forum_reports r
   LEFT JOIN forum_posts p ON p.id = r.post_id
   JOIN forum_topics t ON t.id = COALESCE(r.topic_id, p.topic_id)
   JOIN forum_categories c ON c.id = t.category_id
   LEFT JOIN users reporter ON reporter.id = r.reporter_account_id
   LEFT JOIN users resolver ON resolver.id = r.resolved_by_account_id
   LEFT JOIN users post_author ON post_author.id = p.author_account_id`;

async function getForumReportById(reportId: string): Promise<ForumReport | null> {
  const { rows } = await getPool().query<ForumReportRow>(
    `${FORUM_REPORT_SELECT}
     WHERE r.id = $1`,
    [reportId],
  );
  return rows[0] ? reportFromRow(rows[0]) : null;
}

function topicModerationPatch(action: ForumTopicModerationAction): string {
  switch (action) {
    case 'pin':
      return 'pinned_at = $2';
    case 'unpin':
      return 'pinned_at = NULL';
    case 'lock':
      return 'locked_at = $2';
    case 'unlock':
      return 'locked_at = NULL';
    case 'hide':
      return 'hidden_at = $2, hidden_by_account_id = $3, hidden_reason = $4';
  }
}

type ForumCategoryRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  i18n: Record<string, unknown> | null;
  sort_order: number;
  topic_write_policy: ForumTopicWritePolicy;
  topic_count: number;
  post_count: number;
  latest_topic_id: string | null;
  latest_topic_slug: string | null;
  latest_topic_title: string | null;
  latest_topic_post_count: number | null;
  latest_post_id: string | null;
  latest_post_created_at: Date | null;
  latest_post_author_handle: string | null;
  latest_post_author_display_name: string | null;
  latest_post_author_title: PlayerTitle | null;
};

type ForumTopicRow = {
  id: string;
  slug: string;
  title: string;
  post_count: number;
  pinned_at: Date | null;
  locked_at: Date | null;
  created_at: Date;
  updated_at: Date;
  last_post_at: Date;
  category_slug: string;
  category_name: string;
  category_i18n: Record<string, unknown> | null;
  author_handle: string | null;
  author_display_name: string | null;
  author_title: PlayerTitle | null;
  latest_post_id: string | null;
  latest_post_created_at: Date | null;
  latest_post_author_handle: string | null;
  latest_post_author_display_name: string | null;
  latest_post_author_title: PlayerTitle | null;
  latest_post_body_text: string | null;
};

type ForumPostRow = {
  id: string;
  body_text: string;
  created_at: Date;
  updated_at: Date;
  hidden_at: Date | null;
  author_handle: string | null;
  author_display_name: string | null;
  author_title: PlayerTitle | null;
};

type ForumPostSearchRow = {
  post_id: string;
  post_page: number;
  body_text: string;
  post_created_at: Date;
  author_handle: string | null;
  author_display_name: string | null;
  author_title: PlayerTitle | null;
  topic_id: string;
  topic_slug: string;
  topic_title: string;
  topic_post_count: number;
  category_slug: string;
  category_name: string;
  category_i18n: Record<string, unknown> | null;
  total_count: number;
};

type ForumReportRow = {
  id: string;
  status: ForumReportStatus;
  target_type: 'topic' | 'post';
  reason: string;
  resolution_note: string | null;
  created_at: Date;
  updated_at: Date;
  resolved_at: Date | null;
  reporter_handle: string | null;
  reporter_display_name: string | null;
  reporter_title: PlayerTitle | null;
  resolver_handle: string | null;
  resolver_display_name: string | null;
  resolver_title: PlayerTitle | null;
  topic_id: string;
  topic_slug: string;
  topic_title: string;
  topic_hidden_at: Date | null;
  category_slug: string;
  category_name: string;
  category_i18n: Record<string, unknown> | null;
  post_id: string | null;
  post_body_text: string | null;
  post_created_at: Date | null;
  post_hidden_at: Date | null;
  post_author_handle: string | null;
  post_author_display_name: string | null;
  post_author_title: PlayerTitle | null;
  post_page: number | null;
};

function categoryFromRow(row: ForumCategoryRow): ForumCategory {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    i18n: row.i18n ?? {},
    sortOrder: row.sort_order,
    topicWritePolicy: row.topic_write_policy,
    topicCount: row.topic_count,
    postCount: row.post_count,
    latestPost:
      row.latest_topic_id &&
      row.latest_topic_slug &&
      row.latest_topic_title &&
      row.latest_post_id &&
      row.latest_post_created_at
        ? {
            post: {
              id: row.latest_post_id,
            },
            topic: {
              id: row.latest_topic_id,
              slug: row.latest_topic_slug,
              title: row.latest_topic_title,
              postCount: row.latest_topic_post_count ?? 1,
            },
            author: authorFromRow(
              row.latest_post_author_handle,
              row.latest_post_author_display_name,
              row.latest_post_author_title,
            ),
            createdAt: row.latest_post_created_at,
          }
        : null,
  };
}

function topicFromRow(row: ForumTopicRow): ForumTopicSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    category: {
      slug: row.category_slug,
      name: row.category_name,
      i18n: row.category_i18n ?? {},
    },
    author: authorFromRow(row.author_handle, row.author_display_name, row.author_title),
    latestPost:
      row.latest_post_id && row.latest_post_created_at
        ? {
            post: {
              id: row.latest_post_id,
            },
            author: authorFromRow(
              row.latest_post_author_handle,
              row.latest_post_author_display_name,
              row.latest_post_author_title,
            ),
            createdAt: row.latest_post_created_at,
            excerpt: forumExcerpt(row.latest_post_body_text ?? ''),
            bodyText: row.latest_post_body_text ?? '',
          }
        : null,
    postCount: row.post_count,
    pinnedAt: row.pinned_at,
    lockedAt: row.locked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastPostAt: row.last_post_at,
  };
}

function postFromRow(row: ForumPostRow): ForumPost {
  return {
    id: row.id,
    author: authorFromRow(row.author_handle, row.author_display_name, row.author_title),
    bodyText: row.body_text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    hiddenAt: row.hidden_at,
  };
}

function postSearchResultFromRow(row: ForumPostSearchRow, query?: string): ForumPostSearchResult {
  return {
    post: {
      id: row.post_id,
      page: row.post_page,
      snippet:
        query === undefined
          ? forumPlainSnippet(row.body_text)
          : forumSearchSnippet(row.body_text, query),
    },
    topic: {
      id: row.topic_id,
      slug: row.topic_slug,
      title: row.topic_title,
      postCount: row.topic_post_count,
      category: {
        slug: row.category_slug,
        name: row.category_name,
        i18n: row.category_i18n ?? {},
      },
    },
    author: authorFromRow(row.author_handle, row.author_display_name, row.author_title),
    createdAt: row.post_created_at,
  };
}

function reportFromRow(row: ForumReportRow): ForumReport {
  return {
    id: row.id,
    status: row.status,
    targetType: row.target_type,
    reason: row.reason,
    resolutionNote: row.resolution_note,
    reporter: authorFromRow(row.reporter_handle, row.reporter_display_name, row.reporter_title),
    resolver: authorFromRow(row.resolver_handle, row.resolver_display_name, row.resolver_title),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
    topic: {
      id: row.topic_id,
      slug: row.topic_slug,
      title: row.topic_title,
      category: {
        slug: row.category_slug,
        name: row.category_name,
        i18n: row.category_i18n ?? {},
      },
      hiddenAt: row.topic_hidden_at,
    },
    post: row.post_id
      ? {
          id: row.post_id,
          page: row.post_page ?? 1,
          snippet: forumPlainSnippet(row.post_body_text ?? ''),
          author: authorFromRow(
            row.post_author_handle,
            row.post_author_display_name,
            row.post_author_title,
          ),
          createdAt: row.post_created_at ?? row.created_at,
          hiddenAt: row.post_hidden_at,
        }
      : null,
  };
}

function authorFromRow(
  handle: string | null,
  displayName: string | null,
  title: PlayerTitle | null = null,
): ForumAuthor {
  if (!handle) return null;
  return { handle, displayName: displayName ?? handle, title };
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(Math.trunc(value), max));
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function forumSearchSnippet(value: string, query: string): string {
  const text = value.trim().replace(/\s+/g, ' ');
  if (text.length <= 220) return text;
  const matchIndex = text.toLowerCase().indexOf(query.toLowerCase());
  if (matchIndex < 0) return `${text.slice(0, 217).trimEnd()}...`;
  const start = Math.max(0, matchIndex - 70);
  const end = Math.min(text.length, matchIndex + query.length + 140);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < text.length ? '...' : '';
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

function forumPlainSnippet(value: string): string {
  const text = value.trim().replace(/\s+/g, ' ');
  if (text.length <= 180) return text;
  return `${text.slice(0, 177).trimEnd()}...`;
}
