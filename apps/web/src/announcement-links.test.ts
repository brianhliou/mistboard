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

  it('never puts an entry in the home article row beside its own article', () => {
    // The row already lists published articles; an entry linking one renders a
    // second card with the same title (2026-09-22, both Pikafish cards live).
    const doubled = allAnnouncements()
      .filter((entry) => entry.showInHomeArticleWidget === true)
      .filter((entry) => /^\/blog\/[a-z0-9-]+$/.test(entry.href ?? ''))
      .map((entry) => `${entry.date} "${entry.headline}" -> ${entry.href}`);
    expect(doubled, `announcements doubling an article card:\n${doubled.join('\n')}`).toEqual([]);
  });

  // An entry announcing a manual links that manual's study, not the /study
  // index: the index lists fifty-odd studies, and a reader had to copy the
  // book's name into the search box to find what the entry was about (Brian,
  // 2026-10-24, five manual entries on bare /study). The body is plain text on
  // /feed, the News box and RSS, so an entry naming several books links the
  // first one it names. The signal is the copy: a manual, a woodblock or a
  // printing in the headline or body.
  const MANUAL_COPY = /\bmanuals?\b|\bwoodblocks?\b|\bprintings?\b/i;
  const manualEntries = () =>
    allAnnouncements().filter((entry) => MANUAL_COPY.test(`${entry.headline} ${entry.body ?? ''}`));

  it('links a manual announcement to the manual, never the bare studies index', () => {
    const bare = manualEntries()
      .filter((entry) => {
        const href = entry.href ?? '';
        return href === '' || href === '/study' || href.startsWith('/study?');
      })
      .map((entry) => `${entry.date} "${entry.headline}" -> ${entry.href ?? '(no link)'}`);
    expect(bare, `manual announcements linking the studies index:\n${bare.join('\n')}`).toEqual([]);
  });

  it('has manual announcements on study pages to check, so the guard is not vacuous', () => {
    const onStudy = manualEntries().filter((e) => /^\/study\/[A-Za-z0-9_-]+$/.test(e.href ?? ''));
    expect(onStudy.length).toBeGreaterThanOrEqual(6);
  });

  it('has article links to check, so the guard is not vacuous', () => {
    const checked = allAnnouncements().filter((e) => /^\/(blog|rules)\//.test(e.href ?? ''));
    expect(checked.length).toBeGreaterThan(0);
  });
});
