import { readFileSync } from 'node:fs';
import { XIANGQI_GLYPH_PATHS } from '@mistboard/board-render';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
import {
  buildArticlePage,
  buildArticlesIndex,
  buildHomeArticleCards,
  buildRulesIndex,
  mountPendingWidgets,
} from './articles.js';
import { articles } from './articles-data.js';
import { boardAppearanceChangedEvent } from './theme.js';

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

  it('de-lists the mini xiangqi trio from public rules surfaces but keeps the pages reachable', () => {
    // Xiangqi pivot: the mini xiangqi trio is hidden from public rules surfaces
    // (variantPublicSurfaceEnabled=false) but the rules pages stay reachable by
    // direct URL — they were de-listed, not deleted.
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_DARK_MINI_XIANGQI_ENABLED', 'false');

    const rules = buildRulesIndex();
    expect(rules.querySelector('a[href="/rules/mini-xiangqi"]')).toBeNull();
    expect(rules.querySelector('a[href="/rules/dark-mini-xiangqi"]')).toBeNull();
    expect(rules.querySelector('a[href="/rules/drop-mini-xiangqi"]')).toBeNull();
    expect(buildArticlePage('dark-mini-xiangqi').textContent).toContain('Dark Mini Xiangqi');
    expect(buildArticlePage('mini-xiangqi').textContent).toContain('Mini Xiangqi');
  });

  it('keeps the mini xiangqi trio de-listed from the rules index regardless of env flags', () => {
    vi.stubEnv('DEV', false);

    const rules = buildRulesIndex();
    expect(rules.querySelector('a[href="/rules/dark-mini-xiangqi"]')).toBeNull();
    expect(rules.querySelector('a[href="/rules/mini-xiangqi"]')).toBeNull();
  });

  it('orders the articles page by publish date newest first', () => {
    vi.stubEnv('DEV', true);

    const hrefs = [
      ...buildArticlesIndex().querySelectorAll<HTMLAnchorElement>('.articles-index-card'),
    ].map((link) => link.getAttribute('href'));

    expect(hrefs).toEqual([
      // The Duck Xiangqi build post is a DRAFT and only appears because this
      // case stubs DEV. It ships with the variant, for the same reason the
      // rules page does: it argues from positions nobody can set up yet.
      '/blog/duck-xiangqi-build',
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
      '/blog/puzzles-with-more-than-one-solution',
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

  it('renders an unfinished localized article wholly in English', () => {
    const page = buildArticlePage('reveal-chess', 'zh-Hans');

    expect(page.dataset.articleLang).toBeUndefined();
    expect(page.querySelector('.article-title')?.textContent).toBe('Reveal Chess Rules');
    expect(page.querySelector('.article-meta-dates')?.textContent).toContain('Published');
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
    vi.stubEnv('VITE_DARK_MINI_XIANGQI_ENABLED', 'true');

    const hrefs = [
      ...(buildHomeArticleCards(50, undefined, NO_AGE_CUT)?.querySelectorAll<HTMLAnchorElement>(
        '.landing-article-card[data-card-kind="article"]',
      ) ?? []),
    ].map((link) => link.getAttribute('href'));

    // Rules reference pages are excluded from this row; only editorial
    // (blog/concept) articles appear, newest first.
    expect(hrefs).toEqual([
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

  it('keeps parked chess variant rules out of the homepage widget and rules rail', () => {
    vi.stubEnv('DEV', false);

    const home = buildHomeArticleCards(50, undefined, NO_AGE_CUT);
    const landing = buildRulesIndex();
    const darkChess = buildArticlePage('dark-chess');
    const darkCrossroads = buildArticlePage('dark-crossroads-chess');
    const parkedHrefs = [
      '/rules/reveal-chess',
      '/rules/crossroads-chess',
      '/rules/dark-crossroads-chess',
    ];

    for (const href of parkedHrefs) {
      expect(home?.querySelector(`.landing-article-card[href="${href}"]`)).toBeNull();
      expect(landing.querySelector(`.rules-landing-tile[href="${href}"]`)).toBeNull();
      expect(darkChess.querySelector(`.article-variant-sidebar a[href="${href}"]`)).toBeNull();
    }
    expect(darkCrossroads.textContent).toContain('Dark Crossroads Chess Rules');
    expect(
      darkCrossroads.querySelector('.article-variant-sidebar a[aria-current="page"]'),
    ).toBeNull();
  });

  it('keeps Shogi rules out of discovery while leaving direct pages reachable', () => {
    vi.stubEnv('DEV', true);

    const landing = buildRulesIndex();
    const darkShogi = buildArticlePage('dark-shogi');
    const shogi = buildArticlePage('shogi');

    expect(landing.querySelector('a[href="/rules/shogi"]')).toBeNull();
    expect(landing.querySelector('a[href="/rules/shogi4"]')).toBeNull();
    expect(darkShogi.querySelector('.article-variant-sidebar a[href="/rules/shogi"]')).toBeNull();
    expect(
      darkShogi.querySelector('.article-variant-sidebar a[href="/rules/dark-shogi"]'),
    ).toBeNull();
    expect(shogi.textContent).toContain('Shogi Rules');
    expect(shogi.querySelector('.article-variant-sidebar a[href="/rules/shogi"]')).toBeNull();
  });

  it('keeps still-gated release announcements out of the homepage article widget by default', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_KRIEGSPIEL_ENABLED', 'true');

    const cards = buildHomeArticleCards(50, undefined, NO_AGE_CUT);

    expect(cards?.textContent).not.toContain('Reveal Chess is open for alpha play.');
    expect(cards?.textContent).not.toContain('Kriegspiel is open for alpha play.');
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

  it('does not show the Drop Mini Xiangqi launch announcement in the homepage article widget', () => {
    vi.stubEnv('DEV', false);

    const cards = buildHomeArticleCards(50, undefined, NO_AGE_CUT);
    const announcement = cards?.querySelector<HTMLAnchorElement>(
      '.landing-announcement-card[href="/rules/drop-mini-xiangqi"]',
    );

    expect(announcement).toBeNull();
    expect(cards?.textContent).not.toContain('Drop Mini Xiangqi has launched.');
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

  it('describes Kriegspiel as playable with a friend-room CTA', () => {
    vi.stubEnv('DEV', false);

    const page = buildArticlePage('kriegspiel');
    const landing = buildRulesIndex();
    const darkChess = buildArticlePage('dark-chess');
    const links = [...page.querySelectorAll<HTMLAnchorElement>('a')].map((link) => ({
      href: link.getAttribute('href'),
      text: link.textContent,
    }));

    expect(landing.querySelector('a[href="/rules/kriegspiel"]')).toBeNull();
    expect(
      darkChess.querySelector('.article-variant-sidebar a[href="/rules/kriegspiel"]'),
    ).toBeNull();
    expect(page.querySelector('.article-variant-sidebar a[href="/rules/kriegspiel"]')).toBeNull();
    expect(page.textContent).toContain('Kriegspiel is playable on Mistboard');
    expect(page.textContent).not.toContain("Kriegspiel isn't playable");
    expect(links).toContainEqual({
      href: '/?play=friend&gameSpecId=kriegspiel',
      text: 'Challenge a friend',
    });
  });

  it('describes Dark Mini Xiangqi as playable alpha with play CTAs', () => {
    const page = buildArticlePage('dark-mini-xiangqi');
    const links = [...page.querySelectorAll<HTMLAnchorElement>('a')].map((link) => ({
      href: link.getAttribute('href'),
      text: link.textContent,
    }));

    expect(page.textContent).toContain('Dark Mini Xiangqi is open for alpha play');
    expect(page.textContent).not.toContain('not yet a public game mode');
    expect(links).toContainEqual({
      href: '/?play=computer&gameSpecId=dark-mini-xiangqi',
      text: 'Play Misty DMX',
    });
    expect(links).toContainEqual({
      href: '/?play=friend&gameSpecId=dark-mini-xiangqi',
      text: 'Create invite',
    });
  });

  // Mini Xiangqi is registered but never built: every request 501s, and the
  // page kept its rules article after the game went away. It used to close by
  // offering Dark Mini Xiangqi, which is disabled in production, so the link
  // silently dropped the reader on the homepage with no mention of either
  // game. It now sends them to the one live game on the page's own subject.
  it('sends Mini Xiangqi readers to a game that exists', () => {
    const page = buildArticlePage('mini-xiangqi');
    const ctaLinks = [...page.querySelectorAll<HTMLAnchorElement>('.article-cta')].map((link) => ({
      href: link.getAttribute('href'),
      text: link.textContent,
    }));

    expect(page.textContent).toContain('not playable on Mistboard');
    expect(page.innerHTML).toContain('xq-diagram-palace-band');
    expect(ctaLinks).toEqual([
      {
        href: '/?play=computer&gameSpecId=xiangqi',
        text: 'Play xiangqi',
      },
    ]);
    // The page wins "xiangqi was invented in" on a literal phrase match about
    // a 1973 Japanese variant, so it has to route that reader rather than
    // leave them with the wrong answer.
    expect(page.textContent).toContain('Xiangqi itself is many centuries older');
  });

  it('keeps the Dark Crossroads Chess rules page directly reachable while unlisted', () => {
    vi.stubEnv('DEV', false);

    const page = buildArticlePage('dark-crossroads-chess');
    const landing = buildRulesIndex();
    const links = [...page.querySelectorAll<HTMLAnchorElement>('a')].map((link) => ({
      href: link.getAttribute('href'),
      text: link.textContent,
    }));

    expect(page.textContent).toContain('Dark Crossroads Chess Rules');
    expect(page.textContent).toContain('available for invite games');
    expect(page.textContent).not.toContain('not playable yet');
    expect(page.querySelectorAll('.dark-crossroads-figure > svg.crossroads-live-svg')).toHaveLength(
      4,
    );
    expect(links).toContainEqual({
      href: '/?play=friend&gameSpecId=dark-crossroads-chess',
      text: 'Create invite',
    });
    expect(landing.textContent).not.toContain('Dark Crossroads Chess');
    expect(landing.querySelector('a[href="/rules/dark-crossroads-chess"]')).toBeNull();
    expect(
      landing.querySelector(
        'a[href="/rules/dark-crossroads-chess"] svg[data-mini-id="dark-crossroads"]',
      ),
    ).toBeNull();
    expect(
      page.querySelector(
        '.article-variant-sidebar a[aria-current="page"] svg[data-mini-id="dark-crossroads"]',
      ),
    ).toBeNull();
  });

  it('keeps the Dark Crazyhouse rules page directly reachable while unlisted', () => {
    // Xiangqi pivot: Dark Crazyhouse is de-listed from public rules surfaces
    // (variantPublicSurfaceEnabled=false) but the page stays reachable by direct
    // URL and still offers invite play — de-listed, not deleted.
    vi.stubEnv('DEV', false);

    const page = buildArticlePage('dark-crazyhouse');
    const landing = buildRulesIndex();
    const links = [...page.querySelectorAll<HTMLAnchorElement>('a')].map((link) => ({
      href: link.getAttribute('href'),
      text: link.textContent,
    }));

    expect(page.textContent).toContain('Dark Crazyhouse Rules');
    expect(page.textContent).toContain('available for invite games');
    expect(page.textContent).not.toContain('not playable yet');
    expect(links).toContainEqual({
      href: '/?play=friend&gameSpecId=dark-crazyhouse',
      text: 'Create invite',
    });
    expect(landing.querySelector('a[href="/rules/dark-crazyhouse"]')).toBeNull();
    expect(
      landing.querySelector('a[href="/rules/dark-crazyhouse"] svg[data-mini-id="dark-crazyhouse"]'),
    ).toBeNull();
    expect(
      page.querySelector(
        '.article-variant-sidebar a[aria-current="page"] svg[data-mini-id="dark-crazyhouse"]',
      ),
    ).toBeNull();
  });

  it('keeps the Drop Mini Xiangqi rules page directly reachable while unlisted', () => {
    // Xiangqi pivot: Drop Mini Xiangqi is de-listed from public rules surfaces
    // (variantPublicSurfaceEnabled=false) but the page stays reachable by direct
    // URL with its full play CTAs and sample-game widget — de-listed, not deleted.
    const page = buildArticlePage('drop-mini-xiangqi');
    const landing = buildRulesIndex();
    const links = [...page.querySelectorAll<HTMLAnchorElement>('a')].map((link) => ({
      href: link.getAttribute('href'),
      text: link.textContent,
    }));

    expect(page.textContent).toContain('Drop Mini Xiangqi Rules');
    expect(page.textContent).toContain('open for alpha play');
    expect(page.textContent).toContain('A sample game');
    expect(page.querySelector('[data-pending-widget="drop-mini-xiangqi-replay"]')).not.toBeNull();
    expect(links).toContainEqual({
      href: '/?play=computer&gameSpecId=drop-mini-xiangqi',
      text: 'Play the bot',
    });
    expect(links).toContainEqual({
      href: '/?play=friend&gameSpecId=drop-mini-xiangqi',
      text: 'Create invite',
    });
    expect(links).toContainEqual({
      href: '/?play=lobby&gameSpecId=drop-mini-xiangqi',
      text: 'Find opponent',
    });
    // De-listed from the rules index (no grid or sidebar entry).
    expect(landing.querySelector('a[href="/rules/drop-mini-xiangqi"]')).toBeNull();
    expect(
      page.querySelector(
        '.article-variant-sidebar a[aria-current="page"] svg[data-mini-id="drop-mini-xiangqi"]',
      ),
    ).toBeNull();
  });

  it('rerenders Dark Crossroads diagrams from the piece settings', () => {
    Object.defineProperty(window, 'localStorage', { configurable: true, value: memoryStorage() });
    // Pin the glyph set so the baseline CJK-disk assertion is stable; the test
    // then proves a switch to western re-renders the diagrams. Stamp the
    // piece-set rollout version so the one-time default reset doesn't override
    // this explicit choice (simulates a post-rollout user).
    window.localStorage.setItem('mistboard.xiangqiPieceSetVersion', '3');
    window.localStorage.setItem('mistboard.xiangqiPieceSet', 'traditional');
    const page = buildArticlePage('dark-crossroads-chess');
    document.body.append(page);

    expect(page.innerHTML).toContain(XIANGQI_GLYPH_PATHS.車);

    // Chess ships ONE piece set now, so the xiangqi side is the only axis left
    // that can prove the diagrams re-render on the appearance event.
    window.localStorage.setItem('mistboard.xiangqiPieceSet', 'western');
    window.dispatchEvent(new Event(boardAppearanceChangedEvent));

    expect(page.innerHTML).toContain('>R</text>');
    expect(page.innerHTML).not.toContain(XIANGQI_GLYPH_PATHS.車);
  });

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
      // standardized closing for one who read the doc through. The closing is
      // still exactly two buttons; counting them separately keeps this test
      // honest about which one it is asserting.
      const headerRow = page.querySelector('.article-cta-row.article-play-cta');
      expect(headerRow, slug).toBeTruthy();
      expect(headerRow?.querySelectorAll('.article-cta').length, slug).toBeGreaterThan(0);
      const headerCtas = headerRow?.querySelectorAll('.article-cta').length ?? 0;
      expect(page.querySelectorAll('.article-cta').length - headerCtas, slug).toBe(2);
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

function memoryStorage(): Storage {
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

  it('de-lists the mini xiangqi trio from the rules sidebar but keeps pages reachable', () => {
    // Xiangqi pivot: the mini xiangqi trio is de-listed from the rules rail; the
    // pages stay reachable by direct URL (their own sidebar no longer links them).
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_DARK_MINI_XIANGQI_ENABLED', 'false');

    const darkChess = buildArticlePage('dark-chess');
    expect(
      darkChess.querySelector('.article-variant-sidebar a[href="/rules/mini-xiangqi"]'),
    ).toBeNull();
    expect(
      darkChess.querySelector('.article-variant-sidebar a[href="/rules/dark-mini-xiangqi"]'),
    ).toBeNull();

    const miniXiangqi = buildArticlePage('mini-xiangqi');
    expect(miniXiangqi.textContent).toContain('Mini Xiangqi');
    expect(
      miniXiangqi.querySelector('.article-variant-sidebar a[href="/rules/mini-xiangqi"]'),
    ).toBeNull();
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
    expect(nav?.querySelector('a[href="/rules/mini-xiangqi"]')).toBeNull();
    expect(nav?.querySelector('a[href="/rules/dark-mini-xiangqi"]')).toBeNull();
    expect(nav?.querySelector('a[href="/rules/fog-xiangqi"]')).not.toBeNull();
    expect(nav?.querySelector('a[href="/rules/jieqi"]')).not.toBeNull();
    expect(nav?.querySelector('a[href="/rules/jungle"]')).not.toBeNull();
    expect(nav?.querySelector('a[href="/rules/jungle-flip"]')).not.toBeNull();
    expect(nav?.querySelector('a[href="/rules/banqi"]')).not.toBeNull();
    expect(nav?.querySelector('a[href="/rules/fog-chess"]')).not.toBeNull();
    // Xiangqi pivot: the chess reference article is de-listed from the rail.
    expect(nav?.querySelector('a[href="/rules/chess"]')).toBeNull();
    // Draft960 is a pregame option that has not shipped as a playable mode.
    expect(nav?.querySelector('a[href="/rules/dark-draft960"]')).toBeNull();
    expect(nav?.querySelector('a[href="/rules/shogi"]')).toBeNull();
    expect(nav?.querySelector('a[href="/rules/dark-shogi"]')).toBeNull();
    expect(hrefs.indexOf('/rules/xiangqi')).toBeLessThan(hrefs.indexOf('/rules/banqi'));
    expect(hrefs.indexOf('/rules/banqi')).toBeLessThan(hrefs.indexOf('/rules/jieqi'));
    expect(hrefs.indexOf('/rules/jieqi')).toBeLessThan(hrefs.indexOf('/rules/fortress-xiangqi'));
    expect(hrefs.indexOf('/rules/fortress-xiangqi')).toBeLessThan(
      hrefs.indexOf('/rules/fog-xiangqi'),
    );
    expect(hrefs.indexOf('/rules/fog-xiangqi')).toBeLessThan(hrefs.indexOf('/rules/fog-chess'));
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

  it('does not expose Shogi markers on listed rule article surfaces', () => {
    const landing = buildRulesIndex();
    expect(
      landing.querySelector('.rules-landing-tile[href="/rules/shogi"] svg[data-mini-id="shogi"]'),
    ).toBeNull();
    expect(
      landing.querySelector(
        '.rules-landing-tile[href="/rules/dark-shogi"] span[data-variant-marker-id="dark-shogi"]',
      ),
    ).toBeNull();

    const shogi = buildArticlePage('shogi');
    expect(
      shogi.querySelector(
        '.article-variant-sidebar a[href="/rules/shogi"] svg[data-mini-id="shogi"]',
      ),
    ).toBeNull();

    const darkShogi = buildArticlePage('dark-shogi');
    expect(
      darkShogi.querySelector(
        '.article-variant-sidebar a[aria-current="page"] span[data-variant-marker-id="dark-shogi"]',
      ),
    ).toBeNull();
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
    for (const href of ['/rules/drop-mini-xiangqi', '/rules/chess', '/rules/shogi']) {
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
    expect(pageText).toContain('it sits outside the ladder when capturing');
    expect(pageText).toContain('40 plies (single moves) with no flip or capture');
    expect(pageText).toContain('threefold repetition');
    expect(pageText).toContain('do exactly one of two things');
    expect(pageText).toContain('The cannon ignores rank when it captures');
    expect(pageText).toContain('Without a capture, the cannon moves one square');
    expect(pageText).not.toContain('Rules used on Mistboard');
    expect(pageText).not.toContain('Names');
    expect(pageText).not.toContain('any revealed enemy piece except a soldier can capture it');
    expect(pageText).not.toContain('It slides any distance');
    expect(pageText).not.toContain('horse, cannon, soldier');
    const banqiSvgs = [...page.querySelectorAll('.article-figure .xq-article-svg')];
    expect(banqiSvgs.length).toBeGreaterThanOrEqual(3);
    expect(
      banqiSvgs.every((svg) => {
        const [, , width, height] = svg.getAttribute('viewBox')?.split(/\s+/).map(Number) ?? [];
        return width > height;
      }),
    ).toBe(true);
    expect(page.querySelector('.xq-piece-back-mark')).not.toBeNull();
    expect(page.innerHTML).toContain('aria-label="red advisor"');
    expect(page.innerHTML).toContain('aria-label="black advisor"');
    expect(page.querySelectorAll('.xq-diagram-title').length).toBeGreaterThanOrEqual(3);
    expect(page.innerHTML).not.toContain('fill="#5f4a2c"');
    const figureText = [...page.querySelectorAll('.article-figure')]
      .map((figure) => figure.textContent)
      .join('');
    expect(figureText).not.toContain('?');
    expect(figureText).toContain('FIRST FLIP ASSIGNS COLOR');
    expect(figureText).toContain('CAPTURE RANK LADDER');
    expect(figureText).toContain('CANNON SCREEN CAPTURE');
    // Header play row plus the two-button closing.
    expect(page.querySelectorAll('.article-cta-row.article-play-cta .article-cta')).toHaveLength(2);
    expect(page.querySelectorAll('.article-cta')).toHaveLength(4);
  });

  it('keeps the first rules-polish pass on a consistent editorial path', () => {
    const headings = (slug: string) =>
      [...buildArticlePage(slug).querySelectorAll('h2')].map((heading) => heading.textContent);

    expect(headings('xiangqi')).toEqual([
      'The board',
      'The pieces',
      'Check, checkmate, and endings',
      'A famous game',
      'Play on Mistboard',
    ]);
    expect(headings('banqi')).toEqual([
      'Board and setup',
      'Turns',
      'Capture by rank',
      'The cannon',
      'Winning and draws',
      'A sample game',
      'Play on Mistboard',
    ]);
    expect(headings('jieqi')).toEqual([
      'Setup',
      'First moves use starting points',
      'Revealed pieces use identity',
      'Captured dark pieces',
      'Checks, wins, and draws',
      'A sample game',
      'Play on Mistboard',
    ]);
  });

  it('embeds the complete production Fog Xiangqi sample and its flying-general finish', () => {
    const page = buildArticlePage('dark-xiangqi');
    const finalState = XQ_FOG_SAMPLE_STATES.at(-1);

    expect(XQ_FOG_SAMPLE_STATES).toHaveLength(32);
    expect(XQ_FOG_SAMPLE_STEPS).toHaveLength(32);
    expect(finalState?.status).toEqual({
      type: 'finished',
      winner: 'red',
      reason: 'general-captured',
    });
    expect(finalState?.lastMove).toEqual({ from: 'd1', to: 'd10' });
    expect([...page.querySelectorAll('h2')].map((heading) => heading.textContent)).toContain(
      'A sample game',
    );
    expect(
      page.querySelector('a[href="/dark-xiangqi/game/dxq_ef889df8-a1eb-4d0a-bd0a-ffd7e8bc30f4"]'),
    ).not.toBeNull();

    const sample = [...page.querySelectorAll<HTMLElement>('.article-figure-raw-svg-stepper')].at(
      -1,
    );
    const next = sample?.querySelector<HTMLButtonElement>('.stepper-button-next');
    for (let ply = 0; ply < 31; ply += 1) next?.click();
    expect(sample?.querySelector('.stepper-counter')?.textContent).toBe('32 / 32');
    expect(sample?.querySelector('.stepper-narrative')?.textContent).toBe(
      'Red’s general flies from d1 to d10 and captures Black’s general. Fog Xiangqi ends immediately.',
    );
  });

  // Guards against translated prose bleeding into the English render: a zh
  // catalog value returned for an English page shows up as one of these game
  // names or phrases in the body text. Romanized alternate names (Dou Shou Qi,
  // Animal Chess, banqi, jieqi, cờ úp) are deliberately NOT banned — they are
  // what English speakers search for, and keeping them off the page cost real
  // search traffic. Relaxed 2026-08-03; see docs-private/seo/backlog.md.
  it('keeps translated Chinese game names out of the English rules pages', () => {
    const translationBleed = /象棋|揭棋|暗棋|斗兽棋|鬥獸棋|翻翻棋|同归于尽|同歸於盡/;
    const slugs = [
      'xiangqi',
      'banqi',
      'jieqi',
      'fortress-xiangqi',
      'dark-xiangqi',
      'dark-chess',
      'jungle',
      'jungle-flip',
    ];

    for (const slug of slugs) {
      const page = buildArticlePage(slug);
      document.body.append(page);
      const controllers = mountPendingWidgets(page);
      expect(page.textContent, slug).not.toMatch(translationBleed);
      for (const controller of controllers) controller.destroy();
      page.remove();
    }
  });

  it('pins the requested Xiangqi diagram positions', () => {
    expect(XQ_PRIMER_FACING_LEGAL.board.e5).toBeUndefined();
    expect(XQ_PRIMER_FACING_LEGAL.board.e6).toEqual({ color: 'black', role: 'soldier' });
    expect(XQ_PRIMER_HORSE_BLOCKED.board.g5).toEqual({ color: 'red', role: 'soldier' });
    expect(BANQI_SETUP_BOARD()).toContain('aria-label="red elephant"');
    expect(BANQI_SETUP_BOARD()).not.toContain('aria-label="red horse"');
  });

  it("marks the sample game's last move the way every other board does", () => {
    // The replay used to draw its own green arrow, which made an article embed
    // look like a different product from the game page. It now emits the shared
    // origin-wash + destination-ring markers from board-lastmove.ts.
    const page = buildArticlePage('xiangqi');
    document.body.append(page);
    const controllers = mountPendingWidgets(page);
    try {
      page.querySelector<HTMLButtonElement>('.xq-replay .stepper-button-next')?.click();
      expect(page.querySelector('.xq-replay line[marker-end]')).toBeNull();
      expect(page.querySelector('.xq-replay .xq-live-lastmove-from')).not.toBeNull();
      expect(page.querySelector('.xq-replay .xq-live-lastmove-ring')).not.toBeNull();
    } finally {
      for (const controller of controllers) controller.destroy();
      page.remove();
    }
  });

  it('teaches Jungle movement and terminal rules in kernel order', () => {
    const page = buildArticlePage('jungle');
    const headings = [...page.querySelectorAll('h2')].map((heading) => heading.textContent);

    expect(headings).toEqual([
      'Board and setup',
      'How the animals move',
      'Ranks and captures',
      'Traps',
      'Winning and draws',
      'A sample game',
      'Play on Mistboard',
    ]);
    expect(page.textContent).toContain('no piece can capture across the shoreline');
    expect(page.textContent).toContain('Unlike the lion, it cannot leap horizontally');
    expect(page.textContent).toContain('leaving your opponent with no legal move');
    expect(page.innerHTML).toContain('red-elephant.png');
    expect(page.innerHTML).toContain('black-elephant.png');
    expect(page.innerHTML).toContain('tiger-leap');
    expect(page.innerHTML).toContain('rat-elephant');
    // Every movement case is paired with its contrast, two boards to a row.
    expect(page.querySelectorAll('.article-figure-row').length).toBeGreaterThanOrEqual(5);
  });

  it('draws Jungle leaps as arrows and shows what cancels them', () => {
    const arrows = (svg: string): number => (svg.match(/class="xq-arrow"/g) ?? []).length;

    // The lion on the dry lane clears BOTH rivers sideways; the tiger on the
    // same square has no horizontal leap at all. Same position, different
    // repertoire — the arrows are the whole difference.
    expect(arrows(JUNGLE_LION_LEAP_ACROSS)).toBe(2);
    expect(arrows(JUNGLE_TIGER_NO_HORIZONTAL)).toBe(0);

    // A leap onto an occupied square keeps its capture ring, so the diagram
    // shows the landing AND the capture.
    expect(arrows(JUNGLE_LION_LEAP_CAPTURE)).toBe(1);
    expect(JUNGLE_LION_LEAP_CAPTURE).toContain('mb-grid-target-ring');

    // A rat in the water cancels the jump but not the ordinary steps.
    expect(arrows(JUNGLE_RAT_BLOCKS)).toBe(0);
    expect(JUNGLE_RAT_BLOCKS).toContain('mb-grid-target-dot');

    // The rat-beats-elephant wrap runs one way only: the elephant beside a rat
    // has steps but no capture ring to take it with.
    expect(JUNGLE_ELEPHANT_STUCK).toContain('mb-grid-target-dot');
    expect(JUNGLE_ELEPHANT_STUCK).not.toContain('mb-grid-target-ring');

    expect(JUNGLE_FLIP_REVEAL).toContain('red-elephant.png');
  });

  it('shows Flip Jungle turn, capture, and ending choices as paired examples', () => {
    const page = buildArticlePage('jungle-flip');
    const headings = [...page.querySelectorAll('h2')].map((heading) => heading.textContent);

    expect(headings).toEqual([
      'Board and setup',
      'Turns',
      'Captures and trades',
      'Winning and draws',
      'A sample game',
      'Play on Mistboard',
    ]);
    expect(page.textContent).toContain('Face-down tiles block movement and cannot be captured');
    expect(page.textContent).toContain('If the last animal of each color is removed');
    expect(page.textContent).not.toContain('Its turn structure is especially close');
    expect(page.innerHTML).toContain('flip-reveal');
    expect(page.innerHTML).toContain('flip-move');
    expect(page.innerHTML).toContain('flip-capture');
    expect(page.innerHTML).toContain('flip-mutual');
    // The rat/elephant wrap is shown both ways, not just asserted in prose.
    expect(page.innerHTML).toContain('flip-rat-elephant');
    expect(page.innerHTML).toContain('flip-elephant-rat');
    expect(page.innerHTML).toContain('red-elephant.png');
    expect(page.innerHTML).toContain('black-elephant.png');
  });

  it('keeps Fortress Xiangqi focused on the playable rules', () => {
    const page = buildArticlePage('fortress-xiangqi');
    const headings = [...page.querySelectorAll('h2')].map((heading) => heading.textContent);

    expect(headings).toEqual([
      'Board and setup',
      'The pieces',
      'Capture, hold, drop',
      'How games end',
      'A sample game',
      'Play on Mistboard',
    ]);
    expect(page.textContent).toContain('Generals are never captured or held in reserve');
    expect(page.textContent).toContain('a player who gave check on every one of their moves');
    expect(page.textContent).not.toContain('What makes it Fortress Xiangqi');
    expect(page.textContent).not.toContain('chasing rule');
  });

  it('keeps the Fog Chess ending focused on play', () => {
    const page = buildArticlePage('dark-chess');
    const text = page.textContent ?? '';

    expect(text).not.toContain('The full source is AGPL-3.0');
    expect([...page.querySelectorAll('h2')].map((h) => h.textContent)).not.toContain('Names');
  });

  it('localizes zh-Hans Banqi SVG labels and replay chrome', () => {
    const page = buildArticlePage('banqi', 'zh-Hans');
    document.body.append(page);

    const textBeforeMount = page.textContent ?? '';
    expect(textBeforeMount).toContain('首次翻子决定颜色');
    expect(textBeforeMount).toContain('吃子等级序列');
    expect(textBeforeMount).toContain('炮隔子吃');
    expect(textBeforeMount).toContain('炮进攻时隔一子跳吃，不看等级。');
    expect(textBeforeMount).not.toContain('FIRST FLIP ASSIGNS COLOR');
    expect(textBeforeMount).not.toContain('TAIWAN RANK LADDER');
    expect(textBeforeMount).not.toContain('CANNON SCREEN CAPTURE');

    const controllers = mountPendingWidgets(page);
    try {
      const textAfterMount = page.textContent ?? '';
      expect(textAfterMount).toContain('MistyBanqi · 最强（先手） vs 人类（后手）');
      expect(textAfterMount).toContain('人类对引擎');
      expect(textAfterMount).toContain('MistyBanqi（红方）因对手认输获胜 · 49 回合');
      expect(textAfterMount).toContain('逐步回放这盘棋。红方先走');
      expect(textAfterMount).not.toContain('Human vs engine');
      expect(textAfterMount).not.toContain('(first)');
      expect(textAfterMount).not.toContain('49 moves');
    } finally {
      for (const controller of controllers) controller.destroy();
    }
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

  const publishedBlogSlugs = (): string[] => {
    vi.stubEnv('DEV', false);
    return articles
      .filter(
        (article) =>
          article.kind === 'article' &&
          article.status === 'published' &&
          article.showInIndex !== false &&
          article.publisher === 'mistboard',
      )
      .map((article) => article.slug);
  };

  const footerLinks = (slug: string): string[] =>
    [...buildArticlePage(slug).querySelectorAll('.article-footer .articles-index-card')].map(
      (card) => card.getAttribute('href') ?? '',
    );

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
