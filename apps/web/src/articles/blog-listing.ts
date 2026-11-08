// Which posts /blog lists, as one predicate the index (articles.ts) and the
// feeds (scripts/prerender-articles.mjs → feed-rss.ts) share. /feed.xml used to
// carry only the posts someone remembered to write an announcement for, so
// brianhliou.com, which tiles our newest posts from it, missed four that /blog
// showed (2026-10-25: helpmates-in-xiangqi, general-blunder-challenge,
// unstyled-first-paint among them).

import { articleIsLive } from './publish-time.js';
import type { Article } from './types.js';

/**
 * The listing rules that hold in every environment: what an index never shows
 * even when the page itself is served. Liveness is the caller's (dev lists
 * drafts and scheduled posts for review; production and the feeds do not).
 */
export function articleListable(
  article: Pick<Article, 'showInIndex' | 'noindex' | 'sourceLang'>,
): boolean {
  if (article.showInIndex === false || article.noindex === true) return false;
  // A page written in a language the interface does not speak never lists: the
  // index is one reader's shelf (articles.ts, isArticleListedInThisEnv).
  if (article.sourceLang) return false;
  return true;
}

/** A post on /blog (the "By Mistboard" view) at `now`, as production shows it. */
export function blogListsPost(article: Article, now: number): boolean {
  return (
    article.kind === 'article' &&
    article.publisher === 'mistboard' &&
    articleIsLive(article, now) &&
    articleListable(article)
  );
}

/** The posts /blog lists at `now`, newest first. */
export function blogPosts(all: readonly Article[], now: number): Article[] {
  return all
    .filter((article) => blogListsPost(article, now))
    .sort(
      (a, b) =>
        (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '') || a.title.localeCompare(b.title),
    );
}
