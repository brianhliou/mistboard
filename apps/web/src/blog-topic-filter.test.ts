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
  // Vitest runs as DEV, where drafts and scheduled posts list too.
  !article.sourceLang &&
  article.showInIndex !== false;
const deepDiveBase = realArticles.find((a) => listed(a) && a.homeRow === 'deep-dives');
const plainBase = realArticles.find((a) => listed(a) && !a.homeRow);

// A clone with no topic, so a base that happens to be an engineering post
// cannot leak its tag into the player-facing fixtures.
function playerFacing(article: Article): Article {
  if (article.kind !== 'article') return article;
  const { topic: _topic, ...rest } = article;
  return rest;
}

function useFixture(deepDives: number, plain: number, engineering = 0): void {
  if (!deepDiveBase || !plainBase) throw new Error('no listed deep dive or plain post to clone');
  const fixture: Article[] = [];
  for (let i = 0; i < deepDives; i += 1) {
    fixture.push({
      ...playerFacing(deepDiveBase),
      slug: `fixture-dive-${i}`,
      title: `Fixture dive ${i}`,
      publishedAt: `2026-09-${String(10 + i).padStart(2, '0')}`,
    });
  }
  for (let i = 0; i < plain; i += 1) {
    const { homeRow: _homeRow, ...rest } = playerFacing(plainBase);
    fixture.push({
      ...rest,
      slug: `fixture-plain-${i}`,
      title: `Fixture plain ${i}`,
      publishedAt: `2026-08-${String(10 + i).padStart(2, '0')}`,
    });
  }
  for (let i = 0; i < engineering; i += 1) {
    const { homeRow: _homeRow, ...rest } = playerFacing(plainBase);
    if (rest.kind !== 'article') throw new Error('plain base is not a blog post');
    fixture.push({
      ...rest,
      topic: 'engineering',
      slug: `fixture-eng-${i}`,
      title: `Fixture engineering ${i}`,
      publishedAt: `2026-07-${String(10 + i).padStart(2, '0')}`,
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

describe('blog index engineering chip', () => {
  const slugsUnder = (topic: string | undefined): string[] =>
    visibleSlugs(buildArticlesIndex(undefined, 'mistboard', topic)).sort();

  it('adds an Engineering chip once an engineering post exists', () => {
    useFixture(2, 2, 2);
    const index = buildArticlesIndex(undefined, 'mistboard');
    // Deep dives before Engineering: the blog is for players first (2026-10-21).
    expect(chips(index).map((chip) => chip.textContent)).toEqual([
      'All',
      'Xiangqi deep dives',
      'Engineering',
    ]);
    expect(chips(index).map((chip) => chip.getAttribute('href'))).toEqual([
      '/blog',
      '/blog?topic=deep-dives',
      '/blog?topic=engineering',
    ]);
    expect(slugsUnder(undefined)).toHaveLength(6);
    expect(slugsUnder('engineering')).toEqual(['/blog/fixture-eng-0', '/blog/fixture-eng-1']);
    expect(slugsUnder('deep-dives')).toEqual(['/blog/fixture-dive-0', '/blog/fixture-dive-1']);
  });

  it('offers no Engineering chip before the first engineering post', () => {
    useFixture(2, 3, 0);
    const labels = chips(buildArticlesIndex(undefined, 'mistboard')).map((c) => c.textContent);
    expect(labels).toEqual(['All', 'Xiangqi deep dives']);
    // An unknown ?topic= link, like the retired players chip, lands on the whole list.
    expect(slugsUnder('players')).toHaveLength(5);
  });

  it('localizes the new chip', () => {
    useFixture(1, 1, 1);
    const hans = chips(buildArticlesIndex('zh-Hans', 'mistboard'));
    expect(hans.map((chip) => chip.getAttribute('href'))).toContain(
      '/zh-hans/blog?topic=engineering',
    );
    expect(hans.map((chip) => chip.textContent)).not.toContain('Engineering');
    for (const chip of hans) expect(chip.textContent).not.toMatch(/\u2014/);
  });

  it('shows exactly the tagged posts under Engineering on the real blog', () => {
    const listedEngineering = realArticles
      .filter((article) => listed(article) && article.kind === 'article')
      .filter((article) => article.kind === 'article' && article.topic === 'engineering')
      .map((article) => `/blog/${article.slug}`)
      .sort();
    expect(listedEngineering).toEqual([
      '/blog/chariot-cannon-repetition-key',
      '/blog/en-passant-under-fog',
      '/blog/how-puzzle-mining-works',
      '/blog/pikafish-reveal-bug',
      '/blog/server-enforced-fog',
      '/blog/unstyled-first-paint',
    ]);
    expect(slugsUnder('engineering')).toEqual(listedEngineering);
  });
});

describe('homepage article rows and engineering posts', () => {
  const slugs = (row: HTMLElement | null): string[] =>
    [...(row?.querySelectorAll<HTMLAnchorElement>('a.landing-article-card') ?? [])].map(
      (card) => card.getAttribute('href') ?? '',
    );
  const ALL = { maxAgeDays: Number.POSITIVE_INFINITY };

  it('keeps engineering posts out of the latest row, which holds the other player posts', () => {
    useFixture(2, 2, 2);
    const latest = slugs(buildHomeArticleCards(20, 'en', { ...ALL, row: 'latest' }));
    expect(latest.filter((href) => href.includes('fixture-eng'))).toEqual([]);
    expect(latest.filter((href) => href.includes('fixture-'))).toEqual([
      '/blog/fixture-plain-1',
      '/blog/fixture-plain-0',
    ]);
  });

  it('keeps an engineering post out of the deep-dives row even if it is tagged for it', () => {
    useFixture(2, 0, 0);
    const [dive] = articles;
    if (dive?.kind !== 'article') throw new Error('fixture dive is not a blog post');
    articles.push({ ...dive, topic: 'engineering', slug: 'fixture-eng-dive' });
    const dives = slugs(buildHomeArticleCards(20, 'en', { ...ALL, row: 'deep-dives' }));
    expect(dives).toEqual(['/blog/fixture-dive-1', '/blog/fixture-dive-0']);
  });
});
