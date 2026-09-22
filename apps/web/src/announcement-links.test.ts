import { describe, expect, it } from 'vitest';
import { allAnnouncements } from './announcements.js';
import { articleIsLive } from './articles/publish-time.js';
import { articles } from './articles-data.js';

// An announcement is a promise that the thing it links to is there. The feed,
// the homepage News box and the RSS document all render the href, and RSS in
// particular is delivered once and kept, so a dead link does not get a second
// chance to be right.
//
// This is not hypothetical: the champions article was announced on 2026-08-27
// while it was still a draft, and its link 404d in production until it was
// published on 2026-08-29. Nothing failed, because nothing was looking.
describe('announcement links', () => {
  const articleBySlug = new Map(articles.map((a) => [a.slug, a]));

  it('never points at an article the production build hides', () => {
    const dead: string[] = [];
    for (const entry of allAnnouncements()) {
      const match = /^\/(blog|rules)\/([a-z0-9-]+)$/.exec(entry.href ?? '');
      if (!match) continue;
      const article = articleBySlug.get(match[2]);
      if (!article) {
        dead.push(`${entry.date} "${entry.headline}" -> ${entry.href} (no such article)`);
      } else if (article.status !== 'published') {
        dead.push(
          `${entry.date} "${entry.headline}" -> ${entry.href} (status '${article.status}')`,
        );
      } else if (
        article.publishedAt &&
        article.publishedAt > entry.date &&
        !articleIsLive(article)
      ) {
        // Both go live at the publish moment of their date, so an entry dated
        // before its article is live for a while with a link the server 404s.
        // Checked only while the article is still ahead: once both are past,
        // the link works, and the 2026-05-09 fog-chess entry predates its rules
        // page by design.
        dead.push(
          `${entry.date} "${entry.headline}" -> ${entry.href} (article scheduled ${article.publishedAt})`,
        );
      }
    }
    expect(dead, `announcements linking to hidden pages:\n${dead.join('\n')}`).toEqual([]);
  });

  it('has article links to check, so the guard is not vacuous', () => {
    const checked = allAnnouncements().filter((e) => /^\/(blog|rules)\//.test(e.href ?? ''));
    expect(checked.length).toBeGreaterThan(0);
  });
});
