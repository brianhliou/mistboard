import { describe, expect, it } from 'vitest';
import { articles } from '../articles-data.js';
import {
  articleFeedThumbnailSvg,
  FEED_THUMB_HEIGHT,
  FEED_THUMB_WIDTH,
  feedThumbnailSvg,
  feedThumbnails,
  resolveCssVars,
  unstyledFeedThumbClasses,
} from './feed-thumbnail.js';
import { articleIsLive } from './publish-time.js';

const live = articles.filter((a) => articleIsLive(a, Date.now()) && a.kind === 'article');

describe('feed thumbnails', () => {
  it('draws one for every live post with card art, at 480x300 (16:10)', () => {
    const thumbs = feedThumbnails(live);
    const withArt = live.filter((a) => a.thumbnail);
    expect(thumbs.size).toBe(withArt.length);
    expect(FEED_THUMB_WIDTH).toBeGreaterThanOrEqual(480);
    expect(FEED_THUMB_WIDTH / FEED_THUMB_HEIGHT).toBe(16 / 10);
    for (const { slug, svg } of thumbs.values()) {
      expect(svg, slug).toMatch(/^<svg [^>]*width="480" height="300" viewBox="0 0 480 300"/);
    }
  });

  // resvg has no stylesheet and no CSS variables: a class the feed style does
  // not know renders with SVG defaults (a black fill), and a var() is invalid.
  it('leaves no live card with a class the feed style does not cover, or a var()', () => {
    for (const { slug, svg } of feedThumbnails(live).values()) {
      expect(unstyledFeedThumbClasses(svg), slug).toEqual([]);
      expect(svg.includes('var('), slug).toBe(false);
    }
  });

  it('catches a planted class that a stylesheet paints', () => {
    const planted = feedThumbnailSvg({
      kind: 'svg',
      svg: '<svg viewBox="0 0 10 10" class="xq-article-svg"><rect class="xq-diagram-bg xq-live-cell--light" width="10" height="10"/></svg>',
    });
    expect(unstyledFeedThumbClasses(planted!)).toEqual(['xq-live-cell--light']);
  });

  it('resolves var() to the dark card value or its fallback, innermost first', () => {
    expect(resolveCssVars('fill="var(--xq-diagram-bg, #d9bd82)"')).toBe('fill="#f5dca8"');
    expect(resolveCssVars('fill="var(--site-danger, #b4532a)"')).toBe('fill="#b4532a"');
    expect(resolveCssVars('fill="var(--nope, var(--site-heading, #000))"')).toBe(
      'fill="hsl(0, 0%, 82%)"',
    );
    expect(resolveCssVars('fill="var(--nope, var(--also-nope, hsl(1, 2%, 3%)))"')).toBe(
      'fill="hsl(1, 2%, 3%)"',
    );
  });

  it('nests an SVG card as a meet-fitted viewport over the panel', () => {
    const svg = feedThumbnailSvg({
      kind: 'svg',
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 292 323" width="292" style="--xq-svg-width: 292px" preserveAspectRatio="xMidYMid slice"><circle r="4"/></svg>',
    })!;
    expect(svg).toContain(
      '<svg x="0" y="0" width="480" height="300" preserveAspectRatio="xMidYMid meet" viewBox="0 0 292 323">',
    );
    expect(svg).not.toContain('slice');
  });

  it('covers the frame with an image card, cropped as object-position asks', () => {
    const svg = feedThumbnailSvg({ kind: 'image', src: '/article-thumbs/a.jpg', position: 'center 12%' })!;
    expect(svg).toContain(
      '<image href="/article-thumbs/a.jpg" x="0" y="0" width="480" height="300" preserveAspectRatio="xMidYMin slice"/>',
    );
    expect(feedThumbnailSvg({ kind: 'image', src: 'https://elsewhere.example/a.jpg' })).toBeNull();
  });

  it('has none for a post without card art or a rules page', () => {
    const post = live.find((a) => a.thumbnail)!;
    expect(articleFeedThumbnailSvg({ ...post, thumbnail: undefined })).toBeNull();
    const rules = articles.find((a) => a.kind === 'rules' && a.thumbnail)!;
    expect(articleFeedThumbnailSvg(rules)).toBeNull();
  });
});
