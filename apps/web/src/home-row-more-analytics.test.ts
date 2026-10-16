import { describe, expect, it, vi } from 'vitest';

const trackMock = vi.hoisted(() => vi.fn());
vi.mock('./analytics.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./analytics.js')>()),
  track: trackMock,
}));

const { buildHomeArticleCards } = await import('./articles.js');

describe('homepage Latest row More link', () => {
  it('reports a click, since autocapture is off', () => {
    const row = buildHomeArticleCards(8, 'en', { maxAgeDays: Number.POSITIVE_INFINITY });
    const more = row?.querySelector<HTMLAnchorElement>('.landing-row-header a.landing-row-more');
    expect(more?.getAttribute('href')).toBe('/blog');
    more?.addEventListener('click', (event) => event.preventDefault());
    more?.click();
    expect(trackMock).toHaveBeenCalledWith('landing_row_more_clicked', {
      row: 'latest',
      href: '/blog',
    });
  });
});
