import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isArticleTranslationPublished } from './article-i18n.js';
import {
  BANQI_BOARD_W,
  BANQI_ENGINE_THUMBNAIL,
  BANQI_RULES_THUMBNAIL,
  BANQI_SETUP_BOARD,
  JUNGLE_ELEPHANT_STUCK,
  JUNGLE_FLIP_REVEAL,
  JUNGLE_LION_LEAP_ACROSS,
  JUNGLE_LION_LEAP_CAPTURE,
  JUNGLE_RAT_BLOCKS,
  JUNGLE_TIGER_NO_HORIZONTAL,
  XQ_FOG_SAMPLE_STATES,
  XQ_FOG_SAMPLE_STEPS,
  XQ_PRIMER_FACING_LEGAL,
  XQ_PRIMER_HORSE_BLOCKED,
} from './articles/diagrams.js';
import { articleIsLive } from './articles/publish-time.js';
import {
  buildArticlePage,
  buildArticlesIndex,
  buildHomeArticleCards,
  buildRulesIndex,
  mountPendingWidgets,
} from './articles.js';
import { articles } from './articles-data.js';

const articleStyles = readFileSync('src/articles.css', 'utf8');

// These assertions are about which slugs are curated, how they order, and what
// each card renders. None is about recency, and several name articles from June
// on purpose, so they opt out of the homepage row's age cut rather than being
// rewritten every time the calendar moves past one of them.
const NO_AGE_CUT = { maxAgeDays: Number.POSITIVE_INFINITY };

describe('article public listing gates', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllEnvs();
  });

  it('uses a timeless introduction on the rules landing', () => {
    const rules = buildRulesIndex();
    const intro = rules.querySelector('.articles-index-intro')?.textContent;
    const paragraphs = [...rules.querySelectorAll('.rules-landing-paragraph')].map(
      (paragraph) => paragraph.textContent,
    );

    expect(intro).toBe('Learn the rules for every game you can play on Mistboard.');
    expect(paragraphs).toEqual([
      'Each guide explains the board, how the pieces move, and how the game ends, with interactive examples you can step through.',
    ]);
  });

  it('orders the articles page by publish date newest first', () => {
    vi.stubEnv('DEV', true);

    const hrefs = [
      ...buildArticlesIndex().querySelectorAll<HTMLAnchorElement>('.articles-index-card'),
    ].map((link) => link.getAttribute('href'));

    expect(hrefs).toEqual([
      // The Pikafish page is scheduled for 2026-09-22 (DEV shows it early for
      // review), the newest on the site.
      '/blog/pikafish',
      // The first player page, dated 2026-09-21.
      '/blog/yin-sheng',
      // The atomic-xiangqi launch note is dated 2026-09-16, the horde-xiangqi
      // and anti-xiangqi write-ups 2026-09-15 and 2026-09-13, and this index
      // is ordered by date alone.
      '/blog/atomic-xiangqi-build',
      '/blog/horde-xiangqi',
      '/blog/anti-xiangqi',
      // Published with the variant on 2026-09-11, the same date as the
      // puzzles post; ties break on HOME_ARTICLE_SLUGS position, and this
      // index is ordered by date alone, so the newest pair leads.
      '/blog/duck-xiangqi-build',
      '/blog/puzzles-with-more-than-one-solution',
      // The jieqi pair shipped as one batch on 2026-09-03, because each of the
      // five jieqi pages links another in prose and a published page cannot link
      // a draft. They are dated a day apart anyway, the way the champion pair
      // below is: two halves of one launch landing on the same date read as a
      // dump, and the platform page takes the earlier date because it is the one
      // the openings article links to.
      '/blog/jieqi-openings',
      '/blog/jieqi-platform',
      // jieqi-platform's Vietnamese derivation (co-up) inherits its date but
      // never appears here: a page with sourceLang set is out of the index by
      // rule, so moving that date still moves two articles, it just moves one
      // of them somewhere this list cannot see.
      '/blog/how-puzzle-mining-works',
      '/blog/xiangqi-match-fixing',
      // The two champion articles, newest first. They shipped hours apart on
      // 2026-08-29 and are deliberately dated a day apart: two halves of one
      // argument landing on the same date read as a dump, and the world-title
      // piece is the one that answers the other.
      '/blog/xiangqi-world-championship',
      '/blog/xiangqi-champions',
      '/blog/titled-players',
      '/blog/riverbank-cannon',
      '/blog/skill-vs-luck',
      '/blog/fog-openings',
      '/blog/misty',
      '/blog/mistybanqi',
      '/blog/server-enforced-fog',
      '/blog/fog-chess-concepts',
    ]);
  });

  it('keeps Vietnamese pages out of the index, in every locale, drafts included', () => {
    // They are not hidden, they are unlisted: search and the sitemap are their
    // discovery path, and they stay reachable by direct URL. An English index
    // card for a Vietnamese page is noise to both readers.
    vi.stubEnv('DEV', true);

    for (const locale of [undefined, 'zh-Hans', 'zh-Hant'] as const) {
      const index = buildArticlesIndex(locale);
      expect(index.querySelector('.articles-index-card[href$="/blog/co-up"]')).toBeNull();
      expect(index.querySelector('.articles-index-card[href$="/blog/luat-co-up"]')).toBeNull();
    }
  });

  it('keeps only working Community and By Mistboard blog navigation', () => {
    const official = buildArticlesIndex();
    const community = buildArticlesIndex(undefined, 'community');
    const officialLinks = [
      ...official.querySelectorAll<HTMLAnchorElement>('.articles-community-rail a'),
    ].map((link) => ({
      label: link.textContent,
      href: link.getAttribute('href'),
      current: link.getAttribute('aria-current'),
    }));

    expect(officialLinks).toEqual([
      { label: 'By Mistboard', href: '/blog', current: 'page' },
      { label: 'Community', href: '/blog/community', current: null },
    ]);
    expect(
      community.querySelector('.articles-community-rail a[aria-current="page"]')?.textContent,
    ).toBe('Community');
    expect(official.querySelector('.articles-index-controls')).toBeNull();
    expect(official.querySelectorAll('button')).toHaveLength(0);
    expect(official.textContent).not.toContain('All languages');
    expect(community.querySelector('.articles-index-card')).toBeNull();
    expect(community.querySelector('.articles-index-empty')?.textContent).toBe(
      'No community posts yet.',
    );
  });

  it('filters community-authored posts out of the By Mistboard view', () => {
    const post = articles.find((article) => article.slug === 'server-enforced-fog');
    if (post?.kind !== 'article') throw new Error('missing server-enforced-fog article');
    const originalPublisher = post.publisher;

    try {
      post.publisher = 'community';
      expect(
        buildArticlesIndex(undefined, 'community').querySelector(
          'a[href="/blog/server-enforced-fog"]',
        ),
      ).not.toBeNull();
      expect(buildArticlesIndex().querySelector('a[href="/blog/server-enforced-fog"]')).toBeNull();
    } finally {
      post.publisher = originalPublisher;
    }
  });

  it('localizes both blog rail destinations', () => {
    const index = buildArticlesIndex('zh-Hans', 'community');
    const hrefs = [...index.querySelectorAll<HTMLAnchorElement>('.articles-community-rail a')].map(
      (link) => link.getAttribute('href'),
    );

    expect(hrefs).toEqual(['/zh-hans/blog', '/zh-hans/blog/community']);
  });

  it('localizes only publication-ready zh-Hans article cards', () => {
    vi.stubEnv('DEV', false);

    const index = buildArticlesIndex('zh-Hans');
    const text = index.textContent ?? '';

    expect(index.querySelector('a[href="/zh-hans/blog/mistybanqi"]')).not.toBeNull();
    expect(index.querySelector('a[href="/zh-hans/blog/misty"]')).not.toBeNull();
    expect(index.querySelector('a[href="/zh-hans/blog/server-enforced-fog"]')).not.toBeNull();
    expect(text).toContain('MistyBanqi 是怎么下棋的');
    expect(text).toContain('Misty 是怎么下棋的');
    expect(text).toContain('用服务器端真实局面实现迷雾国际象棋');
  });

  it('localizes Traditional Chinese article chrome and content links', () => {
    vi.stubEnv('DEV', false);

    const home = buildHomeArticleCards(50, 'zh-Hant', NO_AGE_CUT);
    expect(home?.getAttribute('aria-label')).toBe('文章');
    expect(home?.querySelector('.landing-carousel-nav-prev')?.getAttribute('aria-label')).toBe(
      '上一篇文章',
    );
    expect(home?.querySelector('.landing-carousel-nav-next')?.getAttribute('aria-label')).toBe(
      '更多文章',
    );
    expect(home?.querySelector('a[href="/zh-hant/blog/misty"]')).not.toBeNull();
    expect(home?.querySelector('a[href="/zh-hant/blog/mistybanqi"]')).not.toBeNull();
    expect(home?.querySelector('a[href="/zh-hant/blog/server-enforced-fog"]')).not.toBeNull();

    const page = buildArticlePage('banqi', 'zh-Hant');
    expect(page.querySelector('.article-breadcrumb')).toBeNull();
    expect(page.querySelector('.article-chip')).toBeNull();
    expect(page.querySelector('.article-meta-dates')?.textContent).toContain('發布於');
    expect(page.querySelector('.article-variant-sidebar')?.getAttribute('aria-label')).toBe(
      '規則導覽',
    );
    expect(page.querySelector('.article-toc-sidebar .article-toc-title')?.textContent).toBe(
      '本頁內容',
    );
    expect(
      page.querySelector('.article-toc-sidebar .article-toc-nav')?.getAttribute('aria-label'),
    ).toBe('目錄');
    expect(
      page.querySelector('.article-variant-sidebar a[href="/zh-hant/rules/banqi"]'),
    ).not.toBeNull();
  });

  it('publishes the completed Fortress Xiangqi localization', () => {
    const simplified = buildArticlePage('fortress-xiangqi', 'zh-Hans');
    const traditional = buildArticlePage('fortress-xiangqi', 'zh-Hant');

    expect(simplified.dataset.articleLang).toBe('zh-Hans');
    expect(simplified.querySelector('.article-title')?.textContent).toBe('堡垒象棋规则');
    expect(simplified.querySelector('.article-meta-dates')?.textContent).toContain('发布于');
    expect(traditional.dataset.articleLang).toBe('zh-Hant');
    expect(traditional.querySelector('.article-title')?.textContent).toBe('堡壘象棋規則');
    expect(traditional.querySelector('.article-meta-dates')?.textContent).toContain('發布於');
  });

  it('limits the homepage article widget to editorial article cards ordered by publish date', () => {
    const hrefs = [
      ...(buildHomeArticleCards(50, undefined, NO_AGE_CUT)?.querySelectorAll<HTMLAnchorElement>(
        '.landing-article-card[data-card-kind="article"]',
      ) ?? []),
    ].map((link) => link.getAttribute('href'));

    // Rules reference pages are excluded from this row; only editorial
    // (blog/concept) articles appear, newest first.
    expect(hrefs).toEqual([
      '/blog/pikafish',
      '/blog/yin-sheng',
      '/blog/atomic-xiangqi-build',
      '/blog/horde-xiangqi',
      '/blog/anti-xiangqi',
      '/blog/duck-xiangqi-build',
      '/blog/puzzles-with-more-than-one-solution',
      '/blog/jieqi-openings',
      '/blog/jieqi-platform',
      '/blog/how-puzzle-mining-works',
      '/blog/xiangqi-match-fixing',
      '/blog/xiangqi-world-championship',
      '/blog/xiangqi-champions',
      '/blog/titled-players',
      '/blog/riverbank-cannon',
      '/blog/skill-vs-luck',
      '/blog/misty',
      '/blog/mistybanqi',
      '/blog/server-enforced-fog',
    ]);
  });

  it('keeps still-gated release announcements out of the homepage article widget by default', () => {
    vi.stubEnv('DEV', false);

    const cards = buildHomeArticleCards(50, undefined, NO_AGE_CUT);

    expect(cards?.textContent).not.toContain('Reveal Chess is open for alpha play.');
  });

  it('keeps the rated xiangqi announcement out of the homepage article row', () => {
    const cards = buildHomeArticleCards(50, undefined, NO_AGE_CUT);

    expect(cards?.textContent).not.toContain('Rated xiangqi is live.');
    expect(cards?.querySelector('.landing-announcement-card[href="/leaderboard"]')).toBeNull();
  });

  it('keeps the Secret in the Tangerine announcement out of the homepage article row', () => {
    const cards = buildHomeArticleCards(50, undefined, NO_AGE_CUT);

    expect(cards?.textContent).not.toContain('Secret in the Tangerine, both game volumes.');
    expect(cards?.querySelector('.landing-announcement-card[href="/study/Dfi3NpRE"]')).toBeNull();
  });

  it('does not show the Banqi alpha announcement in the homepage article widget', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_BANQI_ENABLED', 'true');

    const cards = buildHomeArticleCards(50, undefined, NO_AGE_CUT);

    expect(cards?.querySelector('.landing-announcement-card[href="/rules/banqi"]')).toBeNull();
    expect(cards?.textContent).not.toContain('Banqi (半棋) is open for alpha play.');
  });

  it('keeps Banqi rules surfaces on the variant marker while the MistyBanqi thumbnail renders a full-board card', () => {
    const rules = buildRulesIndex();
    expect(
      rules.querySelector(
        '.rules-landing-tile[href="/rules/banqi"] span[data-variant-marker-id="banqi"]',
      ),
    ).not.toBeNull();
    expect(BANQI_RULES_THUMBNAIL()).not.toContain('data-banqi-thumbnail-crop');

    const thumbnail = BANQI_ENGINE_THUMBNAIL();
    expect(thumbnail).toContain('data-banqi-thumbnail-layout="engine-full-board"');
    expect(thumbnail).toContain(`--xq-svg-width: ${BANQI_BOARD_W + 8}px`);

    const articles = buildArticlesIndex();
    const card = articles.querySelector<HTMLAnchorElement>(
      '.articles-index-card[href="/blog/mistybanqi"]',
    );
    expect(
      card?.querySelector('svg g[data-banqi-thumbnail-layout="engine-full-board"]'),
    ).not.toBeNull();

    // The Banqi rules page carries the shared variant marker on the /rules
    // index (it no longer rides the homepage editorial row)...
    const rulesIndex = buildRulesIndex();
    expect(
      rulesIndex.querySelector('a[href="/rules/banqi"] span[data-variant-marker-id="banqi"]'),
    ).not.toBeNull();

    // ...while the MistyBanqi editorial card keeps the full-board thumbnail in
    // the homepage row.
    const home = buildHomeArticleCards(50, undefined, NO_AGE_CUT);
    expect(
      home?.querySelector(
        '.landing-article-card[href="/blog/mistybanqi"] svg g[data-banqi-thumbnail-layout="engine-full-board"]',
      ),
    ).not.toBeNull();
  });

  it('renders Misty with the generated thumbnail and uses star blog badges', () => {
    const articles = buildArticlesIndex();
    const card = articles.querySelector<HTMLAnchorElement>(
      '.articles-index-card[href="/blog/misty"]',
    );
    expect(card?.querySelector('img')?.getAttribute('src')).toBe(
      '/article-thumbs/misty-engine-belief-20260708.jpg',
    );
    expect(card?.querySelector('.articles-index-card-author')?.textContent).toBe('★');

    const home = buildHomeArticleCards(50, undefined, NO_AGE_CUT);
    expect(
      home?.querySelector('.landing-article-card[href="/blog/misty"] img')?.getAttribute('src'),
    ).toBe('/article-thumbs/misty-engine-belief-20260708.jpg');
    expect(
      home?.querySelector('.landing-article-card[href="/blog/misty"] .landing-article-card-star')
        ?.textContent,
    ).toBe('★');
  });

  it('renders the server-side truth article with the generated truth-core thumbnail', () => {
    const articles = buildArticlesIndex();
    expect(
      articles
        .querySelector(
          '.articles-index-card[href="/blog/server-enforced-fog"] img[src="/article-thumbs/server-fog-cutaway-truth-20260708.jpg"]',
        )
        ?.getAttribute('alt'),
    ).toBe('A foggy visible board layer floating above a hidden golden truth layer.');

    const home = buildHomeArticleCards(50, undefined, NO_AGE_CUT);
    expect(
      home?.querySelector(
        '.landing-article-card[href="/blog/server-enforced-fog"] img[src="/article-thumbs/server-fog-cutaway-truth-20260708.jpg"]',
      ),
    ).not.toBeNull();
  });

  // Mini Xiangqi is registered but never built: every request 501s, and the
  // page kept its rules article after the game went away. It used to close by
  // offering Dark Mini Xiangqi, which is disabled in production, so the link
  // silently dropped the reader on the homepage with no mention of either
  // game. It now sends them to the one live game on the page's own subject.

  it('links the Dark Chess rules CTA to engine play', () => {
    const page = buildArticlePage('dark-chess');
    const links = [...page.querySelectorAll<HTMLAnchorElement>('a')].map((link) => ({
      href: link.getAttribute('href'),
      text: link.textContent,
    }));

    expect(links).toContainEqual({
      href: '/?play=computer&gameSpecId=dark-chess',
      text: 'Play vs computer',
    });
    expect(links).not.toContainEqual({
      href: '/?play=lobby',
      text: 'Play dark chess',
    });
  });

  it('uses quiet headers and one standardized closing on public playable rules pages', () => {
    const publicPlayableSlugs = [
      'xiangqi',
      'banqi',
      'jungle',
      'jungle-flip',
      'fortress-xiangqi',
      'jieqi',
      'fog-xiangqi',
      'fog-chess',
    ];

    for (const slug of publicPlayableSlugs) {
      const page = buildArticlePage(slug);
      expect(page.querySelector('.article-breadcrumb'), slug).toBeNull();
      expect(page.querySelector('.article-chip'), slug).toBeNull();
      const closing = [...page.querySelectorAll('h2')].find(
        (heading) => heading.textContent === 'Play on Mistboard',
      );
      expect(closing, slug).toBeTruthy();

      // Two play affordances, deliberately: the header row for a reader who
      // arrived from a search already knowing they want this game, and the
      // standardized closing for one who read the doc through. The closing
      // leads with the two play buttons (engine, friend); a page may add a
      // secondary button after them, a companion study or the bot's own
      // post, so the section's links are buttons rather than prose links.
      const headerRow = page.querySelector('.article-cta-row.article-play-cta');
      expect(headerRow, slug).toBeTruthy();
      expect(headerRow?.querySelectorAll('.article-cta').length, slug).toBeGreaterThan(0);
      const headerCtas = headerRow?.querySelectorAll('.article-cta').length ?? 0;
      expect(page.querySelectorAll('.article-cta').length - headerCtas, slug).toBeGreaterThanOrEqual(2);
      expect(page.textContent, slug).toContain('No account required.');
    }
  });

  // A rules tile is a marker and a label, nothing else. The landing used to
  // hang a "Playable here" badge off every tile, which carried no information:
  // playableOnMistboard is true for every rules article that exists, so the
  // badge appeared on all of them and distinguished nothing. If a genuinely
  // unplayable variant ever gets a rules page, mark THAT one, not all the rest.
  it('renders rules tiles as marker plus label, with no per-tile badge', () => {
    const index = buildRulesIndex();
    const tiles = [...index.querySelectorAll('.rules-landing-tile')];

    expect(tiles.length).toBeGreaterThan(0);
    expect(index.textContent).not.toContain('Playable here');
    for (const tile of tiles) {
      const href = tile.getAttribute('href') ?? '';
      expect(tile.querySelectorAll('.rules-landing-tile-label'), href).toHaveLength(1);
      expect(tile.children, href).toHaveLength(2);
    }
  });
});

function _memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe('rules variant sidebar', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllEnvs();
  });

  it('lists variants on rules pages with the current one highlighted', () => {
    const page = buildArticlePage('dark-chess');
    const sidebar = page.querySelector('.article-variant-sidebar');
    expect(sidebar).not.toBeNull();

    const current = sidebar?.querySelector('a[aria-current="page"]');
    expect(current?.getAttribute('href')).toBe('/rules/fog-chess');
    expect(current?.querySelector('.article-variant-label')?.textContent).toBe('Fog Chess');
    // Xiangqi pivot: the chess reference article is de-listed (showInIndex=false),
    // so the rail no longer links it (still reachable at /rules/chess directly).
    expect(sidebar?.querySelector('a[href="/rules/chess"]')).toBeNull();
  });

  // Regression: page titles carry search terms the rail must not. When banqi
  // became "Banqi Rules (Chinese Dark Chess)" and jungle gained its alias
  // parenthetical, the rail rendered them whole, widened, and pushed the
  // article column off centre on /rules. Titles may grow; rail labels may not.
  it('keeps rail labels to the bare variant name however long the page title is', () => {
    const sidebar = buildArticlePage('jungle').querySelector('.article-variant-sidebar');
    const labels = [...(sidebar?.querySelectorAll('.article-variant-label') ?? [])].map(
      (node) => node.textContent,
    );
    expect(labels).toContain('Banqi');
    expect(labels).toContain('Jieqi');
    expect(labels).toContain('Jungle Chess');
    expect(labels).toContain('Flip Jungle');
    for (const label of labels) {
      expect(label, `rail label "${label}" leaks page-title freight`).not.toMatch(/Rules|\(|：/);
    }
  });

  it('omits the variant sidebar on non-rules articles', () => {
    const page = buildArticlePage('fog-chess-concepts');
    expect(page.querySelector('.article-variant-sidebar')).toBeNull();
  });

  it('lists the rail as one flat variant list in canonical order', () => {
    const page = buildArticlePage('dark-chess');
    const sidebar = page.querySelector('.article-variant-sidebar');
    const titles = [...(sidebar?.querySelectorAll('.article-toc-title') ?? [])].map(
      (title) => title.textContent,
    );
    expect(titles).toEqual([]);

    const navs = sidebar?.querySelectorAll('.article-toc-nav');
    expect(navs).toHaveLength(1);
    const nav = navs?.[0];
    const hrefs = [...(nav?.querySelectorAll('a') ?? [])].map((link) => link.getAttribute('href'));
    // The mini xiangqi trio is de-listed; the rail uses the eight-variant
    // public shelf order.
    expect(nav?.querySelector('a[href="/rules/fog-xiangqi"]')).not.toBeNull();
    expect(nav?.querySelector('a[href="/rules/jieqi"]')).not.toBeNull();
    expect(nav?.querySelector('a[href="/rules/jungle"]')).not.toBeNull();
    expect(nav?.querySelector('a[href="/rules/jungle-flip"]')).not.toBeNull();
    expect(nav?.querySelector('a[href="/rules/banqi"]')).not.toBeNull();
    expect(nav?.querySelector('a[href="/rules/fog-chess"]')).not.toBeNull();
    // Xiangqi pivot: the chess reference article is de-listed from the rail.
    expect(nav?.querySelector('a[href="/rules/chess"]')).toBeNull();
    expect(hrefs.indexOf('/rules/xiangqi')).toBeLessThan(hrefs.indexOf('/rules/jieqi'));
    expect(hrefs.indexOf('/rules/jieqi')).toBeLessThan(hrefs.indexOf('/rules/banqi'));
    expect(hrefs.indexOf('/rules/banqi')).toBeLessThan(hrefs.indexOf('/rules/atomic-xiangqi'));
    expect(hrefs.indexOf('/rules/atomic-xiangqi')).toBeLessThan(
      hrefs.indexOf('/rules/fog-xiangqi'),
    );
    expect(hrefs.indexOf('/rules/fog-xiangqi')).toBeLessThan(hrefs.indexOf('/rules/duck-xiangqi'));
    expect(hrefs.indexOf('/rules/duck-xiangqi')).toBeLessThan(
      hrefs.indexOf('/rules/fortress-xiangqi'),
    );
    expect(hrefs.indexOf('/rules/fortress-xiangqi')).toBeLessThan(
      hrefs.indexOf('/rules/fog-chess'),
    );
    expect(hrefs.indexOf('/rules/fog-chess')).toBeLessThan(hrefs.indexOf('/rules/jungle'));
    expect(hrefs.indexOf('/rules/jungle')).toBeLessThan(hrefs.indexOf('/rules/jungle-flip'));
  });

  it('lists the elevated xiangqi variants (not the hidden mini trio) by default', () => {
    // Xiangqi pivot: the mini trio is de-listed; the rail leads with standard
    // Xiangqi as the open-info anchor.
    const page = buildArticlePage('dark-chess');
    const links = [...page.querySelectorAll('.article-variant-sidebar a')];
    expect(links[0]?.getAttribute('href')).toBe('/rules/xiangqi');
    expect(
      page.querySelector('.article-variant-sidebar a[href="/rules/dark-mini-xiangqi"]'),
    ).toBeNull();
    expect(page.querySelector('.article-variant-sidebar a[href="/rules/mini-xiangqi"]')).toBeNull();
    expect(
      page.querySelector('.article-variant-sidebar a[href="/rules/fog-xiangqi"]'),
    ).not.toBeNull();
  });

  // The rail is the desktop picker and the grid is the same list reflowed for
  // narrow widths, so both render and CSS chooses. They must agree on entries
  // and order: a swap at 1280px that also reorders (or regroups) the list is
  // what makes the compressed page read as a different page.
  it('renders the rules landing with the rail and a matching tile grid', () => {
    const landing = buildRulesIndex();
    expect(landing.querySelector('.article-variant-sidebar')).not.toBeNull();
    expect(landing.querySelector('.rules-landing-paragraph')).not.toBeNull();
    expect(landing.querySelector('.rules-landing-group-title')).toBeNull();

    const railHrefs = [...landing.querySelectorAll('.article-variant-sidebar a')].map((link) =>
      link.getAttribute('href'),
    );
    const tileHrefs = [...landing.querySelectorAll('.rules-landing-tile')].map((tile) =>
      tile.getAttribute('href'),
    );
    expect(tileHrefs.length).toBeGreaterThan(0);
    expect(tileHrefs).toEqual(railHrefs);
    const tile = landing.querySelector<HTMLAnchorElement>(
      '.rules-landing-tile[href="/rules/fog-chess"]',
    );
    expect(tile?.querySelector('.rules-landing-tile-label')?.textContent).toBe('Fog Chess');
  });

  // One flat grid, mirroring the rail. The de-listing assertions are the point
  // of this test and outlive the layout: parked and de-listed slugs stay out of
  // the picker while remaining reachable by direct URL.
  it('lists the tile grid as one flat picker without the parked families', () => {
    const landing = buildRulesIndex();
    const grids = landing.querySelectorAll('.rules-landing-grid');
    expect(grids).toHaveLength(1);
    expect(landing.querySelectorAll('.rules-landing-group-title')).toHaveLength(0);

    const grid = grids[0];
    for (const href of [
      '/rules/xiangqi',
      '/rules/fog-xiangqi',
      '/rules/fog-chess',
      '/rules/jungle',
      '/rules/jungle-flip',
    ]) {
      expect(grid?.querySelector(`a[href="${href}"]`), href).not.toBeNull();
    }
    // Xiangqi pivot: the mini xiangqi trio and the chess reference article are
    // de-listed from the tile grid (still reachable by direct URL).
    for (const href of ['/rules/chess', '/rules/shogi4']) {
      expect(grid?.querySelector(`a[href="${href}"]`), href).toBeNull();
    }
  });

  it('renders Jieqi visual diagrams instead of placeholder notes', () => {
    const page = buildArticlePage('jieqi');
    const pageText = page.textContent ?? '';

    expect(pageText).not.toContain('[VISUAL:');
    expect(pageText).not.toMatch(/\bsquares?\b/i);
    expect(pageText).toContain('starting point it occupies');
    expect(pageText).toContain('120 plies, or 60 moves by each player');
    expect(pageText).toContain('Repeated positions do not trigger a separate automatic draw');
    const jieqiSvgs = [...page.querySelectorAll('.article-figure .xq-article-svg')];
    expect(jieqiSvgs.length).toBeGreaterThanOrEqual(4);
    // The shuffled-start board is the section hero (a single enlarged board,
    // matching the Xiangqi page); the movement diagrams are paired boards.
    const jieqiHero = jieqiSvgs.filter((svg) => svg.classList.contains('xq-article-svg--hero'));
    expect(jieqiHero).toHaveLength(1);
    expect(jieqiHero[0]!.getAttribute('data-xq-layout')).toBe('single');
    expect(articleStyles).toContain(
      '.article-figure-xq > .xq-article-svg.xq-article-svg--hero {\n  width: min(480px, 100%);',
    );
    expect(
      jieqiSvgs
        .filter((svg) => !svg.classList.contains('xq-article-svg--hero'))
        .every((svg) => svg.getAttribute('data-xq-layout') === 'pair'),
    ).toBe(true);
    const figureText = [...page.querySelectorAll('.article-figure')]
      .map((figure) => figure.textContent)
      .join('');
    expect(figureText).not.toContain('?');
    expect(page.querySelector('.xq-piece-back-mark')).not.toBeNull();
    expect(page.innerHTML).toContain('fill="#2f7d62"');
    expect(page.innerHTML).toContain('fill="#a95f4a"');
    expect(page.innerHTML).toContain('stroke="#6f342c"');
    expect(page.innerHTML).not.toContain('fill="#286d55"');
    expect(page.innerHTML).not.toContain('stroke="#c8ead2"');
    expect(page.innerHTML).not.toContain('fill="#2563eb"');
    expect(page.innerHTML).not.toContain('C40 39 60 39 66 50');
    const captions = [...page.querySelectorAll('.article-figure-caption')].map(
      (caption) => caption.textContent,
    );
    expect(captions).toEqual([]);
    expect(pageText).toContain('BEFORE: HORSE POINT');
    expect(pageText).toContain('CAPTURED PIECE KNOWLEDGE');
    expect(pageText).toContain('RED KNOWS');
    expect(pageText).toContain('BLACK KNOWS');
  });

  it('renders Banqi diagrams and states the Mistboard cannon rule clearly', () => {
    const page = buildArticlePage('banqi');
    const pageText = page.textContent ?? '';

    expect(pageText).not.toContain('[VISUAL:');
    expect(pageText).toContain('General > Advisor > Elephant > Chariot > Horse > Soldier');
    expect(pageText).toContain('Strongest to weakest: general, advisor, elephant, chariot, horse, soldier');
    expect(pageText).toContain('40 plies (single moves) with no flip or capture');
    expect(pageText).toContain('threefold repetition');
    expect(pageText).toContain('On your turn you do exactly one of two things.');
    expect(pageText).toContain('it captures by jumping, not by stepping');
    expect(pageText).toContain('jumping exactly one piece, the screen');
    expect(pageText).toContain('Without a capture it moves one square like everything else.');
    expect(pageText).not.toContain('Rules used on Mistboard');
    expect(pageText).not.toContain('Names');
    expect(pageText).not.toContain('any revealed enemy piece except a soldier can capture it');
    expect(pageText).not.toContain('It slides any distance');
    // The rules are drawn on the real board renderer with its own move hints:
    // every diagram is a live-board SVG, and at least one shows a capture ring.
    const boards = [...page.querySelectorAll('.article-figure svg.banqi-board')];
    expect(boards.length).toBeGreaterThanOrEqual(10);
    expect(page.querySelector('.article-figure svg.banqi-board circle.banqi-hint-capture')).not.toBeNull();
    expect(page.querySelector('.article-figure svg.banqi-board circle.banqi-hint')).not.toBeNull();
    // No custom panel diagrams left: no titled canvases, no HIGH/LOW.
    expect(pageText).not.toContain('CAPTURE RANK LADDER');
    expect(pageText).not.toContain('CANNON SCREEN CAPTURE');
    expect(pageText).not.toContain('HIGH');
    // The ladder is the jungle page's row: seven named slots.
    expect(page.querySelector('.article-figure svg.banqi-rank-ladder')).not.toBeNull();
    expect(page.innerHTML).toContain('aria-label="red advisor"');
    expect(page.textContent).not.toContain('What makes it Fortress Xiangqi');
    expect(page.textContent).not.toContain('chasing rule');
  });

  it('keeps the Fog Chess ending focused on play', () => {
    const page = buildArticlePage('dark-chess');
    const text = page.textContent ?? '';

    expect(text).not.toContain('The full source is AGPL-3.0');
    expect([...page.querySelectorAll('h2')].map((h) => h.textContent)).not.toContain('Names');
  });

  it('localizes zh-Hans Banqi diagram captions and the engine-game embed', () => {
    const page = buildArticlePage('banqi', 'zh-Hans');
    document.body.append(page);

    const text = page.textContent ?? '';
    expect(text).toContain('第一次翻子之前。谁都还没有颜色。');
    expect(text).toContain('最大在左，最小在右。');
    expect(text).toContain('一颗炮架，再来是目标。大小不重要：炮吃将。');
    expect(text).not.toContain('Before the first flip.');
    expect(text).not.toContain('One screen, then the target.');
    // The engine game is a study-chapter embed, the same card every other
    // variant's rules page uses; its title is localized like any string.
    const embed = page.querySelector('iframe[src*="/embed/study/"]');
    expect(embed).not.toBeNull();
    expect(embed?.getAttribute('title')).toBe('暗棋：比赛规则下的一盘引擎对局');
    page.remove();
  });

  it('keeps fogged xiangqi blockers as question-mark pieces', () => {
    const page = buildArticlePage('dark-xiangqi');
    const figureText = [...page.querySelectorAll('.article-figure')]
      .map((figure) => figure.textContent)
      .join('');

    expect(figureText).toContain('?');
  });
});

describe('blog post read-next footer', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllEnvs();
  });

  // Live, not merely published: a scheduled post (dated ahead) is hidden in
  // production and has no footer of its own until its moment.
  const publishedBlogSlugs = (): string[] => {
    vi.stubEnv('DEV', false);
    return articles
      .filter(
        (article) =>
          article.kind === 'article' &&
          articleIsLive(article) &&
          article.showInIndex !== false &&
          article.publisher === 'mistboard',
      )
      .map((article) => article.slug);
  };

  const footerLinks = (slug: string): string[] =>
    [...buildArticlePage(slug).querySelectorAll('.article-footer .articles-index-card')].map(
      (card) => card.getAttribute('href') ?? '',
    );

  // The date ring has no topic signal, so a platform page whose neighbours by
  // date are unrelated variant write-ups names its own onward posts. Missing
  // slugs are skipped and the ring fills the rest, so the footer never shrinks.
  it('honours an author-chosen readNext list before the date ring', () => {
    // DEV so the page renders while it is still scheduled.
    vi.stubEnv('DEV', true);
    expect(footerLinks('pikafish')).toEqual([
      '/blog/jieqi-platform',
      '/blog/skill-vs-luck',
      '/blog/jieqi-openings',
    ]);
  });

  it('closes a blog post with three onward posts instead of nothing', () => {
    vi.stubEnv('DEV', false);
    const page = buildArticlePage('riverbank-cannon');
    const footer = page.querySelector('.article-footer');

    expect(footer).not.toBeNull();
    expect(footer?.querySelector('.article-footer-heading')?.textContent).toBe('Read next');
    expect(footer?.querySelectorAll('.articles-index-card')).toHaveLength(3);
  });

  // Rules docs already carry the variant rail as their onward path; a second
  // list of unrelated blog posts under it would be noise, not navigation.
  it('leaves rules pages on the variant rail alone', () => {
    expect(buildArticlePage('fog-xiangqi').querySelector('.article-footer')).toBeNull();
  });

  // One star per card is texture in a long index grid. Three in a row under an
  // article read as a rating, so the footer drops the badge outright rather
  // than shipping DOM it then hides.
  it('drops the index star badge, which /blog keeps', () => {
    vi.stubEnv('DEV', false);
    const footer = buildArticlePage('riverbank-cannon').querySelector('.article-footer');
    expect(footer?.querySelector('.articles-index-card-author')).toBeNull();
    expect(buildArticlesIndex().querySelector('.articles-index-card-author')).not.toBeNull();
  });

  // The whole point is that a reader who finishes a post has somewhere to go.
  // A post linking itself, or linking a page the index hides, is a dead end
  // wearing a card.
  it('never points a post at itself or at an unlisted page', () => {
    const listed = new Set(publishedBlogSlugs().map((slug) => `/blog/${slug}`));
    for (const slug of publishedBlogSlugs()) {
      const links = footerLinks(slug);
      // A translated page walks its OWN language's ring, so its trio is capped by
      // how many pages exist in that language. Three Vietnamese pages means two
      // onward links, not a broken footer: asserting a flat 3 here would force
      // the ring back to English and dead-end the reader it was built for.
      const article = articles.find((a) => a.slug === slug);
      const pool = articles.filter(
        (a) =>
          a.kind === 'article' &&
          a.status === 'published' &&
          a.publisher === 'mistboard' &&
          a.sourceLang === article?.sourceLang &&
          a.slug !== slug,
      );
      const expected = Math.min(3, pool.length);
      expect(expected, `${slug} has no same-language siblings at all`).toBeGreaterThan(0);
      expect(links, `${slug} has no onward posts`).toHaveLength(expected);
      expect(links, `${slug} links itself`).not.toContain(`/blog/${slug}`);
      for (const href of links) {
        expect(listed, `${slug} links ${href}, which the index does not list`).toContain(href);
      }
    }
  });

  // Recency alone would hand all nine posts the same newest three, which makes
  // the row furniture rather than navigation. Walking the date ring from each
  // post is what keeps the trios distinct, so assert the property, not the
  // implementation.
  it('gives each post a different trio', () => {
    const seen = new Map<string, string>();
    for (const slug of publishedBlogSlugs()) {
      const key = footerLinks(slug).join(',');
      expect(seen.get(key), `${slug} repeats the row on ${seen.get(key)}`).toBeUndefined();
      seen.set(key, slug);
    }
  });

  // The row overrides the index's column ladder at two classes of specificity,
  // which outranks the index's own media queries. That is deliberate (three
  // cards in a two-column grid orphan one), but it means the footer owns the
  // whole ladder: without its own narrow-width rule the row stays three across
  // on a phone, and nothing else in the file can rescue it.
  it('collapses its own column ladder instead of inheriting the index one', () => {
    expect(articleStyles).toMatch(
      /\.article-footer \.article-footer-list \{[^}]*grid-template-columns: repeat\(3/,
    );
    expect(articleStyles).toMatch(
      /@media \(max-width: \d+px\) \{\s*\.article-footer \.article-footer-list \{\s*grid-template-columns: 1fr/,
    );
  });
});
