// RSS 2.0 for the announcement archive (/feed.xml) and the blog (/blog/feed.xml),
// written by the prerender (scripts/prerender-articles.mjs). Hand-rolled rather
// than a dependency: the document is a dozen lines and the only hard parts are
// escaping and the RFC-822 date.
//
// An announcement of a blog post carries the post's own headline and card
// thumbnail, not the announcement's summary line: a reader that lists posts
// from this feed (brianhliou.com's home page tiles) shows what /blog shows.

import type { Announcement } from './announcements.js';

export const MEDIA_RSS_NS = 'http://search.yahoo.com/mrss/';

export const xmlEscape = (value: unknown): string =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Announcements carry a date with no time. Noon UTC keeps every reader's local
// date equal to the authored one.
export const rssDate = (iso: string): string => {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!, 12)).toUTCString();
};

/** The live blog post an announcement points at, as much as the feed needs. */
export type FeedPost = { title: string };

export type FeedOptions = {
  host: string;
  /** A live blog post by slug, or undefined (draft, scheduled, or no post). */
  postForSlug?: (slug: string) => FeedPost | undefined;
  /** The absolute URL of a post's card thumbnail PNG, when it has one. */
  thumbnailUrl?: (slug: string) => string | undefined;
};

const BLOG_HREF = /^\/blog\/([a-z0-9-]+)\/?$/;

/** The blog slug an announcement links to, for an article announcement only. */
export function announcedPostSlug(entry: Pick<Announcement, 'kind' | 'href'>): string | null {
  if (entry.kind !== 'article' || !entry.href) return null;
  return BLOG_HREF.exec(entry.href)?.[1] ?? null;
}

function mediaLine(url: string | undefined): string | null {
  if (!url) return null;
  return `      <media:content url="${xmlEscape(url)}" medium="image" type="image/png" />`;
}

export function renderNewsRss(entries: readonly Announcement[], options: FeedOptions): string {
  const { host } = options;
  const absoluteHref = (href: string | undefined): string => {
    if (!href) return `${host}/feed`;
    return /^https?:/.test(href) ? href : `${host}${href}`;
  };
  const items = entries
    .map((entry) => {
      // Stable id that does not change when an entry's link or title does, so
      // a reader that has seen an item never sees it twice. Keyed by the
      // authored headline, never the post title the item may display.
      const slug = entry.headline
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60);
      const postSlug = announcedPostSlug(entry);
      const post = postSlug ? options.postForSlug?.(postSlug) : undefined;
      const title = post?.title ?? entry.headline;
      // The authored CTA ("Open the editor") is a UI label, not prose. In a
      // reader, and in a tweet built from this document, the link is the call
      // to action, so the label would only read as a dangling imperative.
      const description = entry.body ?? '';
      return [
        '    <item>',
        `      <title>${xmlEscape(title)}</title>`,
        `      <link>${xmlEscape(absoluteHref(entry.href))}</link>`,
        `      <guid isPermaLink="false">mistboard:${entry.date}:${slug}</guid>`,
        `      <pubDate>${rssDate(entry.date)}</pubDate>`,
        `      <category>${xmlEscape(entry.kind)}</category>`,
        description ? `      <description>${xmlEscape(description)}</description>` : null,
        post && postSlug ? mediaLine(options.thumbnailUrl?.(postSlug)) : null,
        '    </item>',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="${MEDIA_RSS_NS}">
  <channel>
    <title>Mistboard updates</title>
    <link>${host}/feed</link>
    <atom:link href="${host}/feed.xml" rel="self" type="application/rss+xml" />
    <description>Releases, articles, and status updates from Mistboard.</description>
    <language>en</language>
${items}
  </channel>
</rss>
`;
}

export type BlogFeedEntry = {
  slug: string;
  title: string;
  summary: string;
  publishedAt?: string;
};

// The blog's own feed, separate from /feed.xml (which carries announcements:
// one-line release notes, not posts). A reader who subscribes to a blog wants
// the posts, and mixing the two means either the announcements drown the posts
// or subscribing to the posts signs you up for changelog entries.
export function renderArticlesRss(
  entries: readonly BlogFeedEntry[],
  options: Pick<FeedOptions, 'host' | 'thumbnailUrl'>,
): string {
  const { host } = options;
  const items = entries
    .map((entry) => {
      const url = `${host}/blog/${encodeURIComponent(entry.slug)}`;
      return [
        '    <item>',
        `      <title>${xmlEscape(entry.title)}</title>`,
        `      <link>${xmlEscape(url)}</link>`,
        // Keyed by slug, not URL: a renamed slug 301s (RENAMED_ARTICLE_SLUGS)
        // and the post is still the same post, so the id has to survive it.
        `      <guid isPermaLink="false">mistboard:blog:${xmlEscape(entry.slug)}</guid>`,
        entry.publishedAt ? `      <pubDate>${rssDate(entry.publishedAt)}</pubDate>` : null,
        `      <description>${xmlEscape(entry.summary)}</description>`,
        mediaLine(options.thumbnailUrl?.(entry.slug)),
        '    </item>',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="${MEDIA_RSS_NS}">
  <channel>
    <title>Mistboard blog</title>
    <link>${host}/blog</link>
    <atom:link href="${host}/blog/feed.xml" rel="self" type="application/rss+xml" />
    <description>Xiangqi, fog variants, and engine work from Mistboard.</description>
    <language>en</language>
${items}
  </channel>
</rss>
`;
}

/** The feed thumbnail's public path; `version` busts caches when the art changes. */
export function feedThumbnailPath(slug: string, version?: string): string {
  const path = `/thumb/article/${encodeURIComponent(slug)}.png`;
  return version ? `${path}?v=${encodeURIComponent(version)}` : path;
}
