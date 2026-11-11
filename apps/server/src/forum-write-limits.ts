// Per-account limits on the forum writes the route's post and topic counters
// cannot see. An edit adds no row, so the posts-per-window count never moves
// when the same post is rewritten; and every write pre-pays up to two model
// calls to warm the translation cache. Without these, one account rewriting a
// 5000-character post in a loop could spend the whole day's translation cap in
// minutes and switch translation off for everyone until the UTC day turns.
//
// In memory, per server process, like the other forum limiters.

import { createAuthRateLimiter } from './auth-rate-limit.js';

// Generous for typo fixes (a burst of quick saves passes), tight for a loop.
export const FORUM_EDIT_LIMIT = { limit: 20, windowMs: 10 * 60 * 1000 };
// Model calls a single author's writes may pre-pay. Past either bound the
// write still lands, it just is not translated ahead; a reader who presses
// Translate is then metered on their own budget.
export const FORUM_WARM_HOURLY_LIMIT = { limit: 40, windowMs: 60 * 60 * 1000 };
export const FORUM_WARM_DAILY_LIMIT = { limit: 200, windowMs: 24 * 60 * 60 * 1000 };

export type ForumWriteLimits = {
  allowEdit(accountId: string, now?: number): boolean;
  warmMeter(accountId: string, now?: () => number): () => boolean;
};

export function createForumWriteLimits(): ForumWriteLimits {
  const edits = createAuthRateLimiter(FORUM_EDIT_LIMIT.limit, FORUM_EDIT_LIMIT.windowMs);
  const warmHourly = createAuthRateLimiter(
    FORUM_WARM_HOURLY_LIMIT.limit,
    FORUM_WARM_HOURLY_LIMIT.windowMs,
  );
  const warmDaily = createAuthRateLimiter(
    FORUM_WARM_DAILY_LIMIT.limit,
    FORUM_WARM_DAILY_LIMIT.windowMs,
  );
  return {
    allowEdit(accountId, now = Date.now()) {
      return edits.check(`acct:${accountId}`, now);
    },
    // Called once per cache miss (forum-translation's meter contract), so a
    // save that leaves the text unchanged costs nothing here.
    warmMeter(accountId, now = Date.now) {
      return () => {
        const at = now();
        return (
          warmHourly.check(`acct:${accountId}`, at) && warmDaily.check(`acct:${accountId}`, at)
        );
      };
    },
  };
}
