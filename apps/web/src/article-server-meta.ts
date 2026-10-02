// The server's view of the article list, generated from articles-data.
//
// The server cannot import the web article modules (they pull in CSS, board
// rendering and the game kernel, and sit outside the server's tsc rootDir), so
// it reads a generated JSON file instead: apps/server/src/article-meta.generated.json.
// This module is the one place that decides what goes into that file.
// articles-meta-sync.test.ts compares the committed file with it and fails when
// stale; `npm run articles:meta` runs that same test with UPDATE_ARTICLE_META=1,
// which writes the file instead (the article modules need the web test
// environment to load, so the test is the generator, like a snapshot update).
// Adding, renaming, publishing or re-describing an article is an edit to its
// content module plus that one command; nobody hand-edits the server table.

import type { Article } from './articles/types.js';

/** Repo-relative path of the generated file. */
export const SERVER_ARTICLE_META_FILE = 'apps/server/src/article-meta.generated.json';

export const SERVER_ARTICLE_META_COMMAND = 'npm run articles:meta';

/**
 * The generated file's exact text. Sorted by slug so two sessions adding
 * different articles touch different lines. `description` is the article's
 * summary, which is what the prerendered page already serves as its meta and
 * share-card description; the server only uses it for pages it serves from the
 * shell (drafts), so the two can no longer disagree.
 */
export function renderServerArticleMeta(articles: readonly Article[]): string {
  const sorted = [...articles].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const table: Record<
    string,
    { title: string; kind: Article['kind']; description: string; status: Article['status'] }
  > = {};
  for (const article of sorted) {
    table[article.slug] = {
      title: article.title,
      kind: article.kind,
      description: article.summary,
      status: article.status,
    };
  }
  return `${JSON.stringify(table, null, 2)}\n`;
}
