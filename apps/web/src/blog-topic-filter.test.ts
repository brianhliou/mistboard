import { afterEach, describe, expect, it, vi } from 'vitest';

const trackMock = vi.hoisted(() => vi.fn());
vi.mock('./analytics.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./analytics.js')>()),
  track: trackMock,
}));

const {
  ARTICLE_TOPICS,
  articleTopicFromSearch,
  articleTopicHref,
  buildArticlesIndex,
  buildHomeArticleCards,
  HOME_ARTICLE_ROW_SIZE,
} = await import('./articles.js');
const { articles } = await import('./articles-data.js');
type Article = (typeof articles)[number];

// The real corpus moves every day (a seventh deep dive is being written as this
// lands), so these tests swap in a fixed set of posts cloned from real ones and
// put the corpus back afterwards.
const realArticles = [...articles];
const listed = (article: Article): boolean =>
  article.kind === 'article' &&
  article.publisher === 'mistboard' &&
  article.status === 'published' &&
  !article.sourceLang &&
  article.showInIndex !== false;
const deepDiveBase = realArticles.find((a) => listed(a) && a.homeRow === 'deep-dives');
const plainBase = realArticles.find((a) => listed(a) && !a.homeRow);

function useFixture(deepDives: number, plain: number): void {
  if (!deepDiveBase || !plainBase) throw new Error('no listed deep dive or plain post to clone');
  const fixture: Article[] = [];
  for (let i = 0; i < deepDives; i += 1) {
    fixture.push({
      ...deepDiveBase,
      slug: `fixture-dive-${i}`,
      title: `Fixture dive ${i}`,
      publishedAt: `2026-09-${String(10 + i).padStart(2, '0')}`,
    });
  }
  for (let i = 0; i < plain; i += 1) {
    const { homeRow: _homeRow, ...rest } = plainBase;
    fixture.push({
      ...rest,
      slug: `fixture-plain-${i}`,
      title: `Fixture plain ${i}`,
      publishedAt: `2026-08-${String(10 + i).padStart(2, '0')}`,
    });
  }
  articles.splice(0, articles.length, ...fixture);
}

afterEach(() => {
  articles.splice(0, articles.length, ...realArticles);
  trackMock.mockClear();
  window.history.replaceState(null, '', '/');
});

const NO_AGE_CUT = { row: 'deep-dives' as const, maxAgeDays: Number.POSITIVE_INFINITY };

function moreLink(section: HTMLElement | null): HTMLAnchorElement | null {
  return (
    section?.querySelector<HTMLAnchorElement>('.landing-row-header a.landing-row-more') ?? null
  );
}

describe('homepage deep-dives row More link', () => {
  it('is absent while the row shows every deep dive (6 of 6)', () => {
    useFixture(HOME_ARTICLE_ROW_SIZE, 2);
    const row = buildHomeArticleCards(HOME_ARTICLE_ROW_SIZE, 'en', NO_AGE_CUT);
    expect(row?.querySelectorAll('.landing-article-card')).toHaveLength(HOME_ARTICLE_ROW_SIZE);
    expect(moreLink(row)).toBeNull();
  });

  it('appears on its own when a seventh deep dive lands, linking to the filtered blog', () => {
    useFixture(HOME_ARTICLE_ROW_SIZE + 1, 2);
    const row = buildHomeArticleCards(HOME_ARTICLE_ROW_SIZE, 'en', NO_AGE_CUT);
    const more = moreLink(row);
    expect(more?.getAttribute('href')).toBe('/blog?topic=deep-dives');
    more?.addEventListener('click', (event) => event.preventDefault());
    more?.click();
    expect(trackMock).toHaveBeenCalledWith('landing_row_more_clicked', {
      row: 'deep-dives',
      href: '/blog?topic=deep-dives',
    });
  });

  it('keeps the locale prefix on the filtered link', () => {
    useFixture(HOME_ARTICLE_ROW_SIZE + 1, 0);
    const row = buildHomeArticleCards(HOME_ARTICLE_ROW_SIZE, 'zh-Hans', NO_AGE_CUT);
    expect(moreLink(row)?.getAttribute('href')).toBe('/zh-hans/blog?topic=deep-dives');
  });
});

function chips(index: HTMLElement): HTMLAnchorElement[] {
  return [...index.querySelectorAll<HTMLAnchorElement>('.articles-topic-chips a')];
}

function visibleSlugs(index: HTMLElement): string[] {
  return [...index.querySelectorAll<HTMLLIElement>('.articles-index-list > li')]
    .filter((item) => !item.hidden)
    .map((item) => item.querySelector('a')?.getAttribute('href') ?? '');
}

describe('blog index topic chips', () => {
  it('offers All and Xiangqi deep dives, All selected, every post shown', () => {
    useFixture(2, 3);
    const index = buildArticlesIndex(undefined, 'mistboard');
    expect(chips(index).map((chip) => chip.textContent)).toEqual(['All', 'Xiangqi deep dives']);
    expect(chips(index).map((chip) => chip.getAttribute('href'))).toEqual([
      '/blog',
      '/blog?topic=deep-dives',
    ]);
    expect(chips(index)[0]?.getAttribute('aria-current')).toBe('true');
    expect(visibleSlugs(index)).toHaveLength(5);
  });

  it('narrows the list to the topic named in ?topic=', () => {
    useFixture(2, 3);
    const index = buildArticlesIndex(undefined, 'mistboard', 'deep-dives');
    expect(visibleSlugs(index).sort()).toEqual(['/blog/fixture-dive-0', '/blog/fixture-dive-1']);
    expect(chips(index)[1]?.getAttribute('aria-current')).toBe('true');
    expect(chips(index)[0]?.hasAttribute('aria-current')).toBe(false);
  });

  it('falls back to All for an unknown topic rather than opening empty', () => {
    useFixture(2, 3);
    const index = buildArticlesIndex(undefined, 'mistboard', 'no-such-topic');
    expect(visibleSlugs(index)).toHaveLength(5);
    expect(chips(index)[0]?.getAttribute('aria-current')).toBe('true');
  });

  it('renders no chip row when no topic has posts', () => {
    useFixture(0, 3);
    const index = buildArticlesIndex(undefined, 'mistboard', 'deep-dives');
    expect(index.querySelector('.articles-topic-chips')).toBeNull();
    expect(visibleSlugs(index)).toHaveLength(3);
  });

  it('filters in place on a chip click and keeps the URL shareable', () => {
    useFixture(2, 3);
    const index = buildArticlesIndex(undefined, 'mistboard');
    document.body.append(index);
    try {
      chips(index)[1]?.click();
      expect(visibleSlugs(index)).toHaveLength(2);
      expect(window.location.search).toBe('?topic=deep-dives');
      expect(trackMock).toHaveBeenCalledWith('blog_topic_selected', { topic: 'deep-dives' });
      chips(index)[0]?.click();
      expect(visibleSlugs(index)).toHaveLength(5);
      expect(window.location.search).toBe('');
    } finally {
      index.remove();
    }
  });

  it('localizes the chips and keeps the locale prefix', () => {
    useFixture(2, 1);
    const hans = buildArticlesIndex('zh-Hans', 'mistboard');
    expect(chips(hans).map((chip) => chip.getAttribute('href'))).toEqual([
      '/zh-hans/blog',
      '/zh-hans/blog?topic=deep-dives',
    ]);
    expect(chips(hans)[0]?.textContent).not.toBe('All');
  });

  it('reads the topic from a search string and builds its href from data', () => {
    expect(articleTopicFromSearch('?topic=deep-dives')).toBe('deep-dives');
    expect(articleTopicFromSearch('')).toBeNull();
    for (const topic of ARTICLE_TOPICS) {
      expect(articleTopicHref(topic.id, 'en')).toBe(`/blog?topic=${topic.id}`);
    }
  });
});
