// Notification-bell counts (121_notification_watermarks.sql).
//
// Every count here answers one question: "how many things have happened to me
// since I last looked?" Two shapes appear:
//   - watermarked feeds (new followers, forum replies) are append-only, so the
//     count is rows-after-users.<kind>_seen_at and "reading" them is a single
//     timestamp write. Forum replies add a second, per-topic watermark on the
//     watch row (123) so reading one thread clears just that thread.
//   - live-state counts (unread DMs, your-move games, incoming challenges) have
//     no watermark: the thing itself is either still pending or it is not, so a
//     watermark would let a badge lie about work that is still outstanding.
//
// The watermark columns deliberately stay out of USER_COLUMNS. They change on
// a different cadence from account identity and are read only by this module,
// so putting them on the row every session-load fetches would add width to the
// hottest query in the app for no reader.

import { linkableHandleSql, seekExpirySql } from './persistence-correspondence-seeks.js';
import { getPool } from './persistence-db.js';
import { visibleFollowerSql } from './persistence-relations.js';

export type NotificationWatermarkKind = 'followers' | 'forum-replies';

const WATERMARK_COLUMNS: Record<NotificationWatermarkKind, string> = {
  followers: 'followers_seen_at',
  'forum-replies': 'forum_replies_seen_at',
};

export function isNotificationWatermarkKind(value: unknown): value is NotificationWatermarkKind {
  return value === 'followers' || value === 'forum-replies';
}

// Follows pointed AT this user since they last opened the bell. Only the
// followed account ever reads this (the private Followers list, 2026-10-08),
// and it counts exactly the accounts that list would show (visibleFollowerSql).
export async function countNewFollowers(userId: string): Promise<number> {
  return (await unseenNewFollowers(userId, { limit: 1 })).total;
}

export type NewFollowerNotification = {
  // Null unless the follower's profile may be linked (linkableHandleSql).
  handle: string | null;
  displayName: string;
  followedAt: Date;
};

export type UnseenNewFollowers = {
  // Every unseen follow; the badge counts these.
  total: number;
  // The newest of them, capped by the caller, for one bell row each.
  followers: NewFollowerNotification[];
};

// The bell's new-follower rows: follows since the followers watermark, newest
// first, filtered like the Followers list so a row never names someone the
// list hides (blocked or closed accounts).
export async function unseenNewFollowers(
  userId: string,
  options: { limit?: number } = {},
): Promise<UnseenNewFollowers> {
  const limit = Math.max(1, Math.min(20, Math.floor(options.limit ?? 5)));
  const { rows } = await getPool().query<{
    handle: string | null;
    display_name: string;
    created_at: Date;
    total: number;
  }>(
    `SELECT ${linkableHandleSql('f')} AS handle,
            COALESCE(NULLIF(f.display_name, ''), f.handle) AS display_name,
            r.created_at, (count(*) OVER ())::int AS total
     FROM user_relations r
     JOIN users u ON u.id = $1
     JOIN users f ON f.id = r.actor_id
     WHERE r.target_id = $1
       AND r.relation = 'follow'
       AND r.created_at > u.followers_seen_at
       AND ${visibleFollowerSql('r', 'f')}
     ORDER BY r.created_at DESC, f.handle ASC
     LIMIT $2::int`,
    [userId, limit],
  );
  return {
    total: rows[0]?.total ?? 0,
    followers: rows.map((row) => ({
      handle: row.handle,
      displayName: row.display_name,
      followedAt: row.created_at,
    })),
  };
}

export type ForumWatchNotification = {
  topicId: string;
  slug: string;
  title: string;
  unread: number;
  // The oldest unread reply: the bell row deep-links to it through the post
  // redirect route, so one click lands where the reader left off.
  firstUnreadPostId: string;
  // The newest unread post that quotes one of this user's posts (124), with
  // the quoter's display name (null if that account is gone). When set, the
  // row says "X quoted you" and links to the quoting post instead.
  quote: { postId: string; by: string | null } | null;
};

export type UnreadWatchedForumTopics = {
  // Topics with at least one unread reply. The badge counts THESE, not
  // replies: one busy thread is a 1, not a 40.
  total: number;
  // The most recently active of them, capped by the caller.
  topics: ForumWatchNotification[];
};

// Unread activity older than this drops off the bell by itself. The watch row
// stays; a thread the user walked away from simply stops asking for them.
export const FORUM_UNREAD_WINDOW_DAYS = 30;

// Unread forum activity for this user, grouped per topic, from two sources:
// replies by other people in topics they watch (123), and posts anywhere that
// quote one of their posts (124). A quote does NOT subscribe them to the
// thread; it is a one-off row. A post is unread when it postdates the bell
// watermark (opening the panel) and, if the topic is watched, its seen_at
// (visiting the thread). Left out so the badge never points at something the
// user cannot see or does not want: hidden posts and topics, their own posts,
// posts from accounts they block, and anything older than the window.
export async function unreadWatchedForumTopics(
  userId: string,
  options: { limit?: number } = {},
): Promise<UnreadWatchedForumTopics> {
  const limit = Math.max(1, Math.min(20, Math.floor(options.limit ?? 5)));
  const { rows } = await getPool().query<{
    topic_id: string;
    slug: string;
    title: string;
    unread: number;
    first_unread_post_id: string;
    quote_post_id: string | null;
    quote_by: string | null;
    total: number;
  }>(
    `WITH candidate AS (
       SELECT p.id AS post_id, p.topic_id, p.created_at, false AS quotes_me
       FROM forum_topic_watches w
       JOIN forum_posts p ON p.topic_id = w.topic_id AND p.created_at > w.seen_at
       WHERE w.account_id = $1
       UNION ALL
       SELECT p.id, p.topic_id, p.created_at, true
       FROM forum_post_quotes fq
       JOIN forum_posts q ON q.id = fq.quoted_post_id AND q.author_account_id = $1
       JOIN forum_posts p ON p.id = fq.post_id
       LEFT JOIN forum_topic_watches w ON w.account_id = $1 AND w.topic_id = p.topic_id
       WHERE w.topic_id IS NULL OR p.created_at > w.seen_at
     ),
     unread AS (
       SELECT t.id AS topic_id, t.slug, t.title, t.last_post_at,
              count(DISTINCT c.post_id)::int AS unread,
              (array_agg(c.post_id ORDER BY c.created_at ASC, c.post_id ASC))[1]
                AS first_unread_post_id,
              (array_agg(c.post_id ORDER BY c.created_at DESC, c.post_id DESC)
                 FILTER (WHERE c.quotes_me))[1] AS quote_post_id,
              (array_agg(COALESCE(pu.display_name, pu.handle)
                           ORDER BY c.created_at DESC, c.post_id DESC)
                 FILTER (WHERE c.quotes_me))[1] AS quote_by
       FROM candidate c
       JOIN users u ON u.id = $1
       JOIN forum_topics t ON t.id = c.topic_id AND t.hidden_at IS NULL
       JOIN forum_posts p ON p.id = c.post_id
         AND p.hidden_at IS NULL
         AND p.author_account_id IS DISTINCT FROM $1
         AND p.created_at > u.forum_replies_seen_at
         AND p.created_at > now() - make_interval(days => $2::int)
         AND NOT EXISTS (
           SELECT 1
           FROM user_relations b
           WHERE b.actor_id = $1
             AND b.target_id = p.author_account_id
             AND b.relation = 'block'
         )
       LEFT JOIN users pu ON pu.id = p.author_account_id
       GROUP BY t.id, t.slug, t.title, t.last_post_at
     )
     SELECT topic_id, slug, title, unread, first_unread_post_id, quote_post_id, quote_by,
            (count(*) OVER ())::int AS total
     FROM unread
     ORDER BY last_post_at DESC, topic_id ASC
     LIMIT $3::int`,
    [userId, FORUM_UNREAD_WINDOW_DAYS, limit],
  );
  return {
    total: rows[0]?.total ?? 0,
    topics: rows.map((row) => ({
      topicId: row.topic_id,
      slug: row.slug,
      title: row.title,
      unread: row.unread,
      firstUnreadPostId: row.first_unread_post_id,
      quote: row.quote_post_id ? { postId: row.quote_post_id, by: row.quote_by } : null,
    })),
  };
}

// Directed correspondence challenges still awaiting this user's answer. Live
// state, not a feed: an unanswered challenge stays counted until it is accepted,
// declined, or expires. Same live filter as listChallengesForUser (the
// /correspondence "Challenges for you" list the bell links to), so the badge
// never counts a challenge the list leaves out.
export async function countIncomingChallenges(userId: string): Promise<number> {
  const { rows } = await getPool().query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM correspondence_seeks
     WHERE target_user_id = $1
       AND ${seekExpirySql()} > now()`,
    [userId],
  );
  return Number(rows[0]?.count ?? 0);
}

export async function markNotificationsSeen(
  userId: string,
  kind: NotificationWatermarkKind,
  at: Date = new Date(),
): Promise<void> {
  // Column name comes from the closed map above, never from the request, so
  // the interpolation cannot carry caller-controlled SQL.
  const column = WATERMARK_COLUMNS[kind];
  await getPool().query(`UPDATE users SET ${column} = $2 WHERE id = $1`, [userId, at]);
}
