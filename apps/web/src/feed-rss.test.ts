import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Announcement } from './announcements.js';
import { announcements } from './announcements.js';
import { blogPosts } from './articles/blog-listing.js';
import { feedThumbnails } from './articles/feed-thumbnail.js';
import { articleIsLive } from './articles/publish-time.js';
import { buildArticlesIndex } from './articles.js';
import { articles } from './articles-data.js';
import {
  announcedPostSlug,
  type FeedBlogPost,
  type FeedOptions,
  feedThumbnailPath,
  MEDIA_RSS_NS,
  renderArticlesRss,
  renderNewsRss,
} from './feed-rss.js';

const HOST = 'https://mistboard.com';
const NOW = Date.now();

// The options the prerender builds (scripts/prerender-articles.mjs).
function liveOptions(): FeedOptions {
  const live = articles.filter((a) => articleIsLive(a, NOW));
  const bySlug = new Map(live.filter((a) => a.kind === 'article').map((a) => [a.slug, a]));
  const thumbs = feedThumbnails(live);
  return {
    host: HOST,
    blogPosts: blogPosts(articles, NOW),
    postForSlug: (slug) => bySlug.get(slug),
    thumbnailUrl: (slug) => {
      const thumb = thumbs.get(slug);
      return thumb ? `${HOST}${feedThumbnailPath(slug, thumb.version)}` : undefined;
    },
  };
}

type Item = {
  title: string;
  link: string;
  guid: string;
  pubDate: string;
  category: string;
  media: string[];
};

function parseItems(xml: string): { root: Element; items: Item[] } {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
  const items = [...doc.getElementsByTagName('item')].map((item) => {
    const text = (tag: string) => item.getElementsByTagName(tag)[0]?.textContent ?? '';
    return {
      title: text('title'),
      link: text('link'),
      guid: text('guid'),
      pubDate: text('pubDate'),
      category: text('category'),
      media: [...item.getElementsByTagName('media:content')].map(
        (el) => el.getAttribute('url') ?? '',
      ),
    };
  });
  return { root: doc.documentElement, items };
}

/**
 * Which listed posts the feed lacks, and which links it carries more than once
 * as an article item. The coverage check the live test and the planted test
 * share, so the planted one proves the live one can fail.
 */
function feedCoverage(
  items: readonly Item[],
  posts: readonly FeedBlogPost[],
): { missing: string[]; duplicated: string[] } {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.category !== 'article') continue;
    counts.set(item.link, (counts.get(item.link) ?? 0) + 1);
  }
  const missing = posts
    .filter((post) => {
      const item = items.find(
        (i) => i.category === 'article' && i.link === `${HOST}/blog/${post.slug}`,
      );
      return !item || item.title !== post.title || !item.pubDate;
    })
    .map((post) => post.slug);
  const duplicated = [...counts].filter(([, n]) => n > 1).map(([link]) => link);
  return { missing, duplicated };
}

describe('/feed.xml', () => {
  const entries = announcements(NOW).sort((a, b) => b.date.localeCompare(a.date));
  const options = liveOptions();
  const { root, items } = parseItems(renderNewsRss(entries, options));

  it('declares the Media RSS namespace', () => {
    expect(root.getAttribute('xmlns:media')).toBe(MEDIA_RSS_NS);
  });

  it("titles a post's announcement with the post's headline, not the summary line", () => {
    const posts = items.filter(
      (item) => item.category === 'article' && item.link.includes('/blog/'),
    );
    expect(posts.length).toBeGreaterThan(10);
    for (const item of posts) {
      const slug = item.link.slice(`${HOST}/blog/`.length);
      const post = options.postForSlug!(slug);
      if (!post) continue;
      expect(item.title, slug).toBe(post.title);
    }
    // The 2026-10 example brianhliou.com worked around: the summary line ended
    // in a period and differed from the card's heading.
    const jieqiOpenings = items.find((item) => item.link === `${HOST}/blog/jieqi-openings`);
    expect(jieqiOpenings?.title).toBe(options.postForSlug!('jieqi-openings')?.title);
    expect(jieqiOpenings?.title).not.toBe('What strong jieqi players believe about the opening.');
  });

  it("links each post's card thumbnail with <media:content>", () => {
    const posts = items.filter(
      (item) => item.category === 'article' && item.link.includes('/blog/'),
    );
    let linked = 0;
    for (const item of posts) {
      const slug = item.link.slice(`${HOST}/blog/`.length);
      const url = options.thumbnailUrl!(slug);
      if (!options.postForSlug!(slug)) continue;
      expect(item.media, slug).toEqual(url ? [url] : []);
      if (url) {
        linked += 1;
        expect(url).toMatch(new RegExp(`^${HOST}/thumb/article/${slug}\\.png\\?v=[0-9a-f]{8}$`));
      }
    }
    expect(linked).toBeGreaterThan(10);
  });

  it('carries every post /blog lists, once each, with its thumbnail', () => {
    const posts = options.blogPosts!;
    // 2026-10-25: four of these were missing (no hand-written announcement).
    for (const slug of ['helpmates-in-xiangqi', 'general-blunder-challenge']) {
      expect(
        posts.some((p) => p.slug === slug),
        slug,
      ).toBe(true);
    }
    expect(feedCoverage(items, posts)).toEqual({ missing: [], duplicated: [] });
    for (const post of posts) {
      const item = items.find(
        (i) => i.category === 'article' && i.link === `${HOST}/blog/${post.slug}`,
      )!;
      expect(item.pubDate, post.slug).toBe(new Date(`${post.publishedAt}T12:00:00Z`).toUTCString());
      const url = options.thumbnailUrl!(post.slug);
      expect(item.media, post.slug).toEqual(url ? [url] : []);
    }
  });

  it('never uses one guid twice', () => {
    const guids = items.map((i) => i.guid);
    expect(new Set(guids).size).toBe(guids.length);
  });

  it('leaves release, update and status items as written', () => {
    const others = entries.filter((entry) => entry.kind !== 'article');
    expect(others.length).toBeGreaterThan(0);
    for (const entry of others) {
      const item = items.find((i) => i.category === entry.kind && i.title === entry.headline);
      expect(item, entry.headline).toBeDefined();
      expect(item!.media).toEqual([]);
    }
  });
});

describe('/feed.xml post list', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is the list /blog renders in production', () => {
    vi.stubEnv('DEV', false);
    const index = buildArticlesIndex();
    const hrefs = [...index.querySelectorAll<HTMLAnchorElement>('.articles-index-list a[href]')]
      .map((a) => new URL(a.href, HOST).pathname)
      .filter((path) => /^\/blog\/[a-z0-9-]+$/.test(path));
    const rendered = [...new Set(hrefs)].map((path) => path.slice('/blog/'.length));
    expect(rendered.length).toBeGreaterThan(10);
    expect(rendered.sort()).toEqual(
      blogPosts(articles, Date.now())
        .map((p) => p.slug)
        .sort(),
    );
  });

  const post = (slug: string, publishedAt: string): FeedBlogPost => ({
    slug,
    title: `Title of ${slug}`,
    summary: `Summary of ${slug}.`,
    publishedAt,
  });
  const fixturePosts = [post('kept-post', '2026-10-21'), post('dropped-post', '2026-10-20')];
  const announcement: Announcement = {
    date: '2026-10-21',
    kind: 'article',
    headline: 'Kept post is out.',
    body: 'The announcement body.',
    href: '/blog/kept-post',
  };
  const release: Announcement = { date: '2026-10-22', kind: 'release', headline: 'A release.' };

  it('catches a planted post left out of the feed', () => {
    // The feed was built from a list that lost one post: the check must say so.
    const xml = renderNewsRss([announcement, release], {
      host: HOST,
      blogPosts: fixturePosts.slice(0, 1),
    });
    expect(feedCoverage(parseItems(xml).items, fixturePosts)).toEqual({
      missing: ['dropped-post'],
      duplicated: [],
    });
  });

  it('folds an announcement of a listed post into its one item', () => {
    const xml = renderNewsRss([announcement, release, { ...announcement, date: '2026-10-19' }], {
      host: HOST,
      blogPosts: [...fixturePosts, fixturePosts[0]!],
      thumbnailUrl: (slug) => `${HOST}/thumb/article/${slug}.png?v=abcd1234`,
    });
    const { items } = parseItems(xml);
    expect(feedCoverage(items, fixturePosts)).toEqual({ missing: [], duplicated: [] });
    expect(items.map((i) => [i.category, i.title])).toEqual([
      ['release', 'A release.'],
      ['article', 'Title of kept-post'],
      ['article', 'Title of dropped-post'],
    ]);
    // The announced post keeps the guid a reader (and the tweet ledger) has seen.
    expect(items[1]!.guid).toBe('mistboard:2026-10-21:kept-post-is-out');
    expect(items[2]!.guid).toBe('mistboard:blog:dropped-post');
    expect(items[2]!.media).toEqual([`${HOST}/thumb/article/dropped-post.png?v=abcd1234`]);
    expect(xml).toContain('<description>The announcement body.</description>');
    expect(xml).toContain('<description>Summary of dropped-post.</description>');
  });

  // A falsifiable check is one that can fail; the planted case above is it.
  it('feedCoverage flags a duplicate', () => {
    const one: Item = {
      title: 'Title of kept-post',
      link: `${HOST}/blog/kept-post`,
      guid: 'g',
      pubDate: 'x',
      category: 'article',
      media: [],
    };
    expect(feedCoverage([one, one], fixturePosts.slice(0, 1)).duplicated).toEqual([one.link]);
  });
});

describe('renderNewsRss edge cases', () => {
  const base: Announcement = {
    date: '2026-10-20',
    kind: 'article',
    headline: 'A summary line.',
    href: '/blog/some-post',
  };
  const options: FeedOptions = {
    host: HOST,
    postForSlug: (slug) => (slug === 'some-post' ? { title: 'Some Post' } : undefined),
    thumbnailUrl: () => undefined,
  };

  it('a post with no card art gets its headline and no media line', () => {
    const { items } = parseItems(renderNewsRss([base], options));
    expect(items[0]).toMatchObject({ title: 'Some Post', media: [] });
  });

  it('keeps the headline for a link that is not a live post', () => {
    const { items } = parseItems(
      renderNewsRss(
        [
          { ...base, href: '/blog/scheduled-post' },
          { ...base, href: '/study/abc' },
          { ...base, kind: 'release' },
        ],
        { ...options, thumbnailUrl: () => `${HOST}/thumb/article/x.png` },
      ),
    );
    expect(items.map((i) => i.title)).toEqual([
      'A summary line.',
      'A summary line.',
      'A summary line.',
    ]);
    expect(items.every((i) => i.media.length === 0)).toBe(true);
  });

  it('keys the guid by the authored headline, so a retitled item is not new', () => {
    const xml = renderNewsRss([base], options);
    expect(xml).toContain('<guid isPermaLink="false">mistboard:2026-10-20:a-summary-line</guid>');
  });

  it('only an article announcement names a post', () => {
    expect(announcedPostSlug({ kind: 'article', href: '/blog/x-1' })).toBe('x-1');
    expect(announcedPostSlug({ kind: 'release', href: '/blog/x-1' })).toBeNull();
    expect(announcedPostSlug({ kind: 'article', href: '/blog/x-1#part' })).toBeNull();
  });
});

describe('/blog/feed.xml', () => {
  it("links each post's card thumbnail with <media:content>", () => {
    const options = liveOptions();
    const live = articles.filter(
      (a) => articleIsLive(a, NOW) && a.kind === 'article' && a.showInIndex !== false,
    );
    const { root, items } = parseItems(renderArticlesRss(live, options));
    expect(root.getAttribute('xmlns:media')).toBe(MEDIA_RSS_NS);
    for (const item of items) {
      const slug = item.link.slice(`${HOST}/blog/`.length);
      const url = options.thumbnailUrl!(slug);
      expect(item.media, slug).toEqual(url ? [url] : []);
    }
  });
});
