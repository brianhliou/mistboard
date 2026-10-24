import { describe, expect, it } from 'vitest';
import type { Announcement } from './announcements.js';
import { announcements } from './announcements.js';
import { feedThumbnails } from './articles/feed-thumbnail.js';
import { articleIsLive } from './articles/publish-time.js';
import { articles } from './articles-data.js';
import {
  announcedPostSlug,
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
    postForSlug: (slug) => bySlug.get(slug),
    thumbnailUrl: (slug) => {
      const thumb = thumbs.get(slug);
      return thumb ? `${HOST}${feedThumbnailPath(slug, thumb.version)}` : undefined;
    },
  };
}

type Item = { title: string; link: string; category: string; media: string[] };

function parseItems(xml: string): { root: Element; items: Item[] } {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
  const items = [...doc.getElementsByTagName('item')].map((item) => {
    const text = (tag: string) => item.getElementsByTagName(tag)[0]?.textContent ?? '';
    return {
      title: text('title'),
      link: text('link'),
      category: text('category'),
      media: [...item.getElementsByTagName('media:content')].map(
        (el) => el.getAttribute('url') ?? '',
      ),
    };
  });
  return { root: doc.documentElement, items };
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
