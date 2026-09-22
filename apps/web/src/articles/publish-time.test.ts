import { describe, expect, it } from 'vitest';
import { ARTICLE_PUBLISH_HOUR_UTC, articleGoesLiveAt, articleIsLive } from './publish-time.js';

describe('scheduled publishing', () => {
  const day = '2026-09-25';
  const liveAt = articleGoesLiveAt(day);

  it('goes live at the publish hour UTC on the dated day', () => {
    expect(new Date(liveAt).toISOString()).toBe(
      `${day}T${String(ARTICLE_PUBLISH_HOUR_UTC).padStart(2, '0')}:00:00.000Z`,
    );
  });

  it('hides a published article until its moment, then shows it', () => {
    const article = { status: 'published', publishedAt: day };
    expect(articleIsLive(article, liveAt - 1)).toBe(false);
    expect(articleIsLive(article, liveAt)).toBe(true);
    expect(articleIsLive(article, liveAt + 86_400_000)).toBe(true);
  });

  it('never shows a draft, whatever its date', () => {
    expect(articleIsLive({ status: 'draft', publishedAt: '2020-01-01' }, liveAt)).toBe(false);
  });

  it('treats an undated or malformed date as live, so a typo cannot hide a page', () => {
    expect(articleIsLive({ status: 'published' })).toBe(true);
    expect(articleIsLive({ status: 'published', publishedAt: 'soon' })).toBe(true);
  });
});
