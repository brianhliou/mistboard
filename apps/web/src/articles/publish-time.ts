// When a `status: 'published'` article with a future `publishedAt` goes live.
//
// Scheduling is a date on the article, not a deploy. Everything that lists or
// serves an article asks `articleIsLive` with the current clock: the client
// index and homepage row at render time, the prerender at build time (so a
// scheduled post is not baked into blog.html, the feed, or a page file), and
// the server at request time through `dist/article-schedule.json`, which the
// prerender writes for every published-but-not-yet-live slug. A post scheduled
// for a day nothing deploys still appears that morning: the client renders it
// from the bundle, the server stops 404ing it, and the next deploy prerenders
// it. Only the RSS feed waits for that deploy.
//
// Dev shows every published article regardless of date (articles.ts), so a
// scheduled post can be reviewed at its URL before its day.

// 09:00 Pacific in summer, 08:00 in winter: a post goes out at the start of
// the working day where the site is run, without a timezone table.
export const ARTICLE_PUBLISH_HOUR_UTC = 16;

/** Epoch ms at which an article dated `publishedAt` (YYYY-MM-DD) goes live. */
export function articleGoesLiveAt(publishedAt: string): number {
  return Date.parse(`${publishedAt}T${String(ARTICLE_PUBLISH_HOUR_UTC).padStart(2, '0')}:00:00Z`);
}

/**
 * Published and past its live moment. An undated published article is live
 * (the legacy shape); a malformed date is treated as live rather than hiding
 * the page forever on a typo.
 */
export function articleIsLive(
  article: { status: string; publishedAt?: string },
  now: number = Date.now(),
): boolean {
  if (article.status !== 'published') return false;
  if (!article.publishedAt) return true;
  const liveAt = articleGoesLiveAt(article.publishedAt);
  return Number.isNaN(liveAt) ? true : liveAt <= now;
}
