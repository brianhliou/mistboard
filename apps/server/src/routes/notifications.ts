// GET  /api/notifications        every bell count in one round-trip
// POST /api/notifications/seen   advance a watermark ({ kind })
//
// The bell used to poll one endpoint per source, so each new notification kind
// cost every signed-in client another request on every refresh. This aggregates
// them: the client fetches once and each registered source reads its field out
// of the shared snapshot. Adding a source is now a field here plus a closure in
// notification-nav.ts, with no extra network cost.
//
// Counts are computed concurrently and each one degrades to 0 on failure rather
// than failing the whole payload — a bell that under-reports is a nuisance, a
// bell that 500s takes the nav down with it.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { DAY_MS } from '@mistboard/game';
import { currentAccountUser } from './../account-session.js';
import * as persistence from './../persistence.js';
import { readJsonBody, requireMethod, requirePersistence, writeJson } from './lib.js';

export type NotificationCounts = {
  inboxUnread: number;
  correspondenceYourMove: number;
  newFollowers: number;
  // Watched forum topics with unread replies (123). Topics, not replies, so
  // one busy thread cannot swamp the badge.
  forumTopics: number;
  incomingChallenges: number;
  // Public board seeks of yours that lapsed with no taker, not yet seen (161).
  seekExpiries: number;
};

// One lapsed board seek, with its terms so the bell can offer to post it again.
export type SeekExpiryNotificationJson = {
  seekId: string;
  gameSpecId: string;
  daysPerMove: number;
  preferredColor: 'first' | 'second' | 'random';
  rated: boolean;
  expiredAt: string;
  // How long a board seek stays up, so the copy never drifts from the rule.
  ttlDays: number;
};

export type ForumWatchNotificationJson = {
  topicId: string;
  slug: string;
  title: string;
  unread: number;
  firstUnreadPostId: string;
  quote: { postId: string; by: string | null } | null;
};

// The bell payload: every count, plus the per-topic rows behind forumTopics
// (capped, most recently active first) so the panel can deep-link each one.
export type NotificationsPayload = NotificationCounts & {
  forumWatched: ForumWatchNotificationJson[];
  seekExpired: SeekExpiryNotificationJson[];
};

const FORUM_BELL_ROWS = 5;
const SEEK_EXPIRY_BELL_ROWS = 3;
const SEEK_TTL_DAYS = Math.round(persistence.CORRESPONDENCE_SEEK_TTL_MS / DAY_MS);

// Read receipts the bell can send: the users.*_seen_at watermarks, plus the
// expired-seek notices, which carry their own per-row seen_at.
type SeenKind = persistence.NotificationWatermarkKind | 'seek-expiries';

async function countOrZero(work: Promise<number>): Promise<number> {
  try {
    return await work;
  } catch {
    return 0;
  }
}

export async function tryHandle(
  _ctx: unknown,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
): Promise<boolean> {
  if (pathname === '/api/notifications') {
    if (!requireMethod(request, response, 'GET')) return true;
    if (!requirePersistence(response)) return true;
    const user = await currentAccountUser(request);
    if (!user) {
      writeJson(response, 401, { error: 'not_signed_in' });
      return true;
    }

    const [
      inboxUnread,
      correspondenceYourMove,
      newFollowers,
      forumWatched,
      incomingChallenges,
      seekExpired,
    ] = await Promise.all([
      countOrZero(persistence.countUnreadDmThreads(user.id)),
      countOrZero(
        persistence
          .listCorrespondenceGamesForUser(user.id)
          .then((games) => games.reduce((count, game) => count + (game.isYourMove ? 1 : 0), 0)),
      ),
      countOrZero(persistence.countNewFollowers(user.id)),
      persistence
        .unreadWatchedForumTopics(user.id, { limit: FORUM_BELL_ROWS })
        .catch((): persistence.UnreadWatchedForumTopics => ({ total: 0, topics: [] })),
      countOrZero(persistence.countIncomingChallenges(user.id)),
      persistence
        .unseenSeekExpiryNotices(user.id, { limit: SEEK_EXPIRY_BELL_ROWS })
        .catch(() => ({ total: 0, notices: [] as persistence.SeekExpiryNotice[] })),
    ]);

    const payload: NotificationsPayload = {
      inboxUnread,
      correspondenceYourMove,
      newFollowers,
      forumTopics: forumWatched.total,
      incomingChallenges,
      forumWatched: forumWatched.topics,
      seekExpiries: seekExpired.total,
      seekExpired: seekExpired.notices.map((notice) => ({
        seekId: notice.seekId,
        gameSpecId: notice.gameSpecId,
        daysPerMove: notice.daysPerMove,
        preferredColor: notice.preferredColor,
        rated: notice.rated,
        expiredAt: notice.expiredAt.toISOString(),
        ttlDays: SEEK_TTL_DAYS,
      })),
    };
    writeJson(response, 200, payload);
    return true;
  }

  if (pathname === '/api/notifications/seen') {
    if (!requireMethod(request, response, 'POST')) return true;
    if (!requirePersistence(response)) return true;
    const user = await currentAccountUser(request);
    if (!user) {
      writeJson(response, 401, { error: 'not_signed_in' });
      return true;
    }
    const body = await readJsonBody(request);
    const kind = body.kind as SeenKind;
    if (kind === 'seek-expiries') {
      await persistence.markSeekExpiryNoticesSeen(user.id);
      writeJson(response, 200, { ok: true });
      return true;
    }
    if (!persistence.isNotificationWatermarkKind(kind)) {
      writeJson(response, 400, { error: 'invalid_kind' });
      return true;
    }
    await persistence.markNotificationsSeen(user.id, kind);
    writeJson(response, 200, { ok: true });
    return true;
  }

  return false;
}
