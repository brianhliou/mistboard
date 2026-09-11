import { piecesToBoard, renderBoardComposition } from '@mistboard/board-render';
import {
  type LiveBoardsController,
  mountLiveBoards,
  mountSteppedBoards,
  mountThumbnailBoard,
  type StepperController,
  type ThumbnailBoardController,
} from '@mistboard/board-render/interactive';
import {
  type Color,
  canonicalVariantOrderIndex,
  DARK_SHOGI_SPEC_ID,
  type GameFamilyId,
  gameSpecForId,
  type Square,
} from '@mistboard/game';
import { track } from './analytics.js';
import { makeFigureZoomable } from './figure-lightbox.js';
import './community-rail.css';
import './articles.css';
import { localizeAnnouncementString } from './announcement-i18n.js';
import { type Announcement, announcements } from './announcements.js';
import {
  type ArticleLang,
  localizedArticleHref,
  publishedArticleLang,
  translateArticle,
  translateArticleText,
} from './article-i18n.js';
import {
  type Article,
  type ArticleBlock,
  type ArticleSection,
  type ArticleThumbnail,
  articles,
  type BanqiReplayBlock,
  type ChessReplayBlock,
  type CodeBlock,
  type CrossroadsReplayBlock,
  type CtaBlock,
  type DropMiniXiangqiReplayBlock,
  type DuckXiangqiReplayBlock,
  type FaqBlock,
  type FortressXiangqiReplayBlock,
  findArticle,
  type ImageFigureBlock,
  type InteractiveBlock,
  type JieqiReplayBlock,
  type JungleFlipReplayBlock,
  type JungleReplayBlock,
  type LiveBoardsBlock,
  type MiniXiangqiReplayBlock,
  type RawSvgBlock,
  type RawSvgStepperBlock,
  type ShogiReplayBlock,
  type StaticBoardsBlock,
  type SubHeadingBlock,
  type SvgRowBlock,
  type TableBlock,
  withXiangqiBoardLayout,
  withXiangqiPieceSet,
  type XiangqiReplayBlock,
} from './articles-data.js';
import { type BanqiReplayController, mountBanqiReplay } from './banqi-replay.js';
import { type ChessReplayController, mountChessReplay } from './chess-replay.js';
import {
  type CrossroadsChessReplayController,
  mountCrossroadsChessReplay,
} from './crossroads-chess-replay.js';
import {
  type DropMiniXiangqiReplayController,
  mountDropMiniXiangqiReplay,
} from './drop-mini-xiangqi-replay.js';
import { type DuckXiangqiReplayController, mountDuckXiangqiReplay } from './duck-xiangqi-replay.js';
import {
  type FortressXiangqiReplayController,
  mountFortressXiangqiReplay,
} from './fortress-xiangqi-replay.js';
import { type I18nKey, t } from './i18n/catalog.js';
import { currentLocale, LOCALE_META, type Locale, localizedHref } from './i18n/locale.js';
import { type JieqiReplayController, mountJieqiReplay } from './jieqi-replay.js';
import { type JungleFlipReplayController, mountJungleFlipReplay } from './jungle-flip-replay.js';
import { type JungleReplayController, mountJungleReplay } from './jungle-replay.js';
import { type MiniXiangqiReplayController, mountMiniXiangqiReplay } from './mini-xiangqi-replay.js';
import { prependTitleBadge } from './player-titles.js';
import { mountShogiReplay, type ShogiReplayController } from './shogi-replay.js';
import {
  boardAppearanceChangedEvent,
  readStoredXiangqiBoardLayout,
  readStoredXiangqiPieceSet,
  shogiAppearanceChangedEvent,
  xiangqiAppearanceChangedEvent,
} from './theme.js';
import { buildUiIcon, uiIconForAnnouncementKind } from './ui-icon.js';
import { hasFinalVariantMarker, renderVariantMarker } from './variant-markers.js';
import type { VariantMiniId } from './variant-mini-boards.js';
import {
  gameSpecIdFromRulesSlug,
  isGameSpecId,
  rulesHrefPublicSurfaceEnabled,
  rulesSlugPublicSurfaceEnabled,
  variantSupportsPve,
} from './variant-public-surfaces.js';
import { DEFAULT_XIANGQI_PIECE_SET, type XiangqiPieceSet } from './xiangqi-piece-sets.js';
import { mountXiangqiReplay, type XiangqiReplayController } from './xiangqi-replay.js';

// Nav + footer come from landing.ts. We avoid re-implementing them by accepting
// pre-built nodes from the caller — keeps this module standalone and testable.

export type ChromeNodes = {
  nav: HTMLElement;
  footer: HTMLElement;
};

// Production hides non-published articles from both the index list and direct
// URL access (the URL 404s). Dev shows everything so we can review outlines
// and drafts locally before promoting them. Vite injects import.meta.env.DEV
// as true in the dev server and false in the production build.
function isArticleVisibleInThisEnv(article: Article): boolean {
  if (article.status === 'published') return true;
  return import.meta.env.DEV;
}

function isArticleListedInThisEnv(article: Article): boolean {
  if (!isArticleVisibleInThisEnv(article)) return false;
  if (article.showInIndex === false) return false;
  // A page written in a language the interface does not speak never lists here.
  // The index is one reader's shelf, and a Vietnamese card in an English list is
  // noise to everyone: an English reader cannot read it, and a Vietnamese reader
  // never sees the list, because they arrive from a search for `luật cờ úp`
  // straight onto the page. Search and the sitemap are the discovery path for
  // these, plus a link from the English original; the index is not.
  //
  // Structural rather than per-file (`showInIndex: false` on each) so the next
  // translated page cannot forget it.
  if (article.sourceLang) return false;
  if (
    article.kind === 'rules' &&
    !rulesSlugPublicSurfaceEnabled(article.gameSpecId ?? article.slug)
  ) {
    return false;
  }
  return true;
}

type RulesArticleGroupId = 'chess' | 'xiangqi' | 'shogi' | 'jungle' | 'other';

// Group order mirrors CANONICAL_VARIANT_ORDER (game-specs.ts) by each family's
// first appearance there: xiangqi leads, Fog Chess bridges into the chess
// family, then Jungle. The rules rail itself is globally sorted, not grouped.
const RULES_ARTICLE_GROUP_ORDER: readonly RulesArticleGroupId[] = [
  'xiangqi',
  'chess',
  'jungle',
  'shogi',
  'other',
];

const BASE_RULE_GROUP_BY_SLUG: Record<string, RulesArticleGroupId> = {
  chess: 'chess',
  xiangqi: 'xiangqi',
  shogi: 'shogi',
  shogi4: 'shogi',
};

// Floats a family's base-rules article to the top of its group. Only for base
// games NOT in CANONICAL_VARIANT_ORDER (chess, shogi) — they'd otherwise sort to
// the bottom. Xiangqi IS in the canonical order, so it is left unpinned and takes
// its canonical slot.
const BASE_RULE_ORDER: Record<string, number> = {
  chess: -100,
  shogi: -100,
  shogi4: 100,
};

const RULES_ARTICLE_RAIL_HIDDEN_SLUGS = new Set(['shogi']);

const RULES_GROUP_TITLE_KEYS: Record<RulesArticleGroupId, I18nKey> = {
  chess: 'rules.group.chess',
  xiangqi: 'rules.group.xiangqi',
  shogi: 'rules.group.shogi',
  jungle: 'rules.group.jungle',
  other: 'rules.group.other',
};

const ARTICLE_STATUS_KEYS: Record<'draft' | 'outline', I18nKey> = {
  draft: 'articles.status.draft',
  outline: 'articles.status.outline',
};

type RulesArticleGroup = {
  title: string;
  items: Article[];
};

function articleLocale(lang?: ArticleLang): Locale {
  return lang ?? currentLocale();
}

function isArticleStatusBadge(status: Article['status']): status is 'draft' | 'outline' {
  return status === 'draft' || status === 'outline';
}

export type ArticleIndexView = 'community' | 'mistboard';

export function buildArticlesIndex(
  lang?: ArticleLang,
  view: ArticleIndexView = 'mistboard',
): HTMLElement {
  return buildContentIndex('article', lang, view);
}

export function buildRulesIndex(lang?: ArticleLang): HTMLElement {
  return buildRulesLanding(lang);
}

function buildContentIndex(
  kind: Article['kind'],
  lang?: ArticleLang,
  articleView: ArticleIndexView = 'community',
): HTMLElement {
  const locale = articleLocale(lang);
  const main = document.createElement('main');
  main.className =
    kind === 'article'
      ? 'community-shell articles-community-shell articles-index'
      : 'site-section article-shell articles-index';

  const layout = document.createElement('div');
  if (kind === 'article') {
    layout.className = 'community-layout articles-community-layout';
    layout.append(buildArticleCommunityRail(locale, articleView));
  }

  const sheet = document.createElement('div');
  sheet.className = 'article-sheet';

  const headingBlock = document.createElement('div');
  headingBlock.className = 'articles-index-heading';

  const heading = document.createElement('h1');
  heading.className = 'site-section-heading';
  heading.textContent = kind === 'article' ? 'Recent posts' : t('rules.heading', {}, locale);
  headingBlock.append(heading);

  const list = document.createElement('ul');
  list.className = 'articles-index-list';

  const entries = articles
    .filter((article) => {
      if (article.kind !== kind || !isArticleListedInThisEnv(article)) return false;
      if (article.kind !== 'article') return true;
      return article.publisher === articleView;
    })
    .sort(compareArticlesNewestFirst);
  for (const article of entries) {
    list.append(articleCard(article, lang));
  }

  sheet.append(headingBlock);
  if (kind !== 'article') {
    const intro = document.createElement('p');
    intro.className = 'articles-index-intro';
    intro.textContent = t('rules.intro', {}, locale);
    sheet.append(intro);
  }
  if (entries.length > 0) {
    sheet.append(list);
  } else if (kind === 'article') {
    const empty = document.createElement('p');
    empty.className = 'articles-index-empty';
    empty.textContent = 'No community posts yet.';
    sheet.append(empty);
  }
  if (kind === 'article') {
    layout.append(sheet);
    main.append(layout);
  } else {
    main.append(sheet);
  }
  return main;
}

function buildArticleCommunityRail(locale: Locale, activeView: ArticleIndexView): HTMLElement {
  const rail = document.createElement('aside');
  rail.className = 'community-rail articles-community-rail';
  rail.setAttribute('aria-label', 'Blog navigation');

  const links: Array<{ label: string; href: string; view: ArticleIndexView }> = [
    { label: 'By Mistboard', href: localizedHref('/blog', locale), view: 'mistboard' },
    { label: 'Community', href: localizedHref('/blog/community', locale), view: 'community' },
  ];

  for (const item of links) {
    const link = document.createElement('a');
    link.href = item.href;
    link.textContent = item.label;
    if (item.view === activeView) {
      link.className = 'community-rail-active';
      link.setAttribute('aria-current', 'page');
    }
    rail.append(link);
  }

  return rail;
}

// /rules is a landing page in the pychess shape: a short intro in the sheet
// with the variant rail as the selector. Below the rail breakpoint a
// thumbnail tile grid takes over as the picker.
function buildRulesLanding(lang?: ArticleLang): HTMLElement {
  const locale = articleLocale(lang);
  const main = document.createElement('main');
  main.className = 'site-section article-shell articles-index rules-landing';

  const sheet = document.createElement('div');
  sheet.className = 'article-sheet';

  const heading = document.createElement('h1');
  heading.className = 'site-section-heading';
  heading.textContent = t('rules.heading', {}, locale);

  const intro = document.createElement('p');
  intro.className = 'articles-index-intro';
  intro.textContent = t('rules.intro', {}, locale);

  sheet.append(heading, intro);

  const body = document.createElement('p');
  body.className = 'rules-landing-paragraph';
  body.textContent = t('rules.body1', {}, locale);
  sheet.append(body);

  const entries = articles.filter(
    (article) => article.kind === 'rules' && isArticleListedInThisEnv(article),
  );
  const tileGroups = buildRulesArticleGroups(entries, locale);
  for (const group of tileGroups) {
    const groupTitle = document.createElement('h2');
    groupTitle.className = 'rules-landing-group-title';
    groupTitle.textContent = group.title;
    const grid = document.createElement('ul');
    grid.className = 'rules-landing-grid';
    for (const article of group.items) {
      const articleLang = publishedArticleLang(article.slug, lang);
      const localized = articleLang ? translateArticle(article, articleLang) : article;
      const li = document.createElement('li');
      const tile = document.createElement('a');
      tile.className = 'rules-landing-tile';
      tile.href = localizedArticleHref(article, locale);
      const miniTile = renderVariantMiniThumb(article.slug);
      if (miniTile) tile.append(miniTile);
      else if (article.thumbnail) tile.append(renderArticleThumbnail(article.thumbnail));
      const label = document.createElement('span');
      label.className = 'rules-landing-tile-label';
      label.textContent = variantNavLabel(localized.title);
      tile.append(label);
      if (article.playableOnMistboard) {
        const playable = document.createElement('span');
        playable.className = 'rules-playable-badge';
        playable.textContent = t('rules.playableHere', {}, locale);
        tile.append(playable);
      }
      li.append(tile);
      grid.append(li);
    }
    sheet.append(groupTitle, grid);
  }

  const variantNav = buildVariantSidebar(null, lang);
  if (variantNav) main.append(variantNav);
  main.append(sheet);
  return main;
}

// Compact article carousel for the homepage center column: a single row of
// compact cards (thumb on top, title below) spanning the column width, that
// auto-rotates like the lichess blog row. Returns null when there are no
// articles, so the caller can omit it. Thumbnails are bound by the caller's
// mountArticleThumbnails pass; rotation is started by initLandingCarousel once
// the section is in the document (it needs measured widths).
// Editorial articles only. Rules reference pages are surfaced on the /rules
// index (and each variant's card marker), not in this homepage row, so this
// list is curated down to blog/concept pieces; the kind guard in
// buildHomeArticleCards drops any rules slug that slips back in.
export const HOME_ARTICLE_SLUGS = [
  // The jieqi pair, shipped together on 2026-09-03 and dated a day apart. The
  // platform page is the clearest case of a page that sends a reader straight
  // into something they can do here rather than something to read about; the
  // openings article is where that reader goes next, and it exists in no
  // language but Chinese anywhere else.
  'jieqi-openings',
  'jieqi-platform',
  // Held the lead until the jieqi pair shipped, on the same reasoning: it sends
  // a reader into something they can do rather than something to read about,
  // and the method it documents is not published anywhere else for xiangqi.
  'how-puzzle-mining-works',
  // The one page here that exists nowhere else in English. It sits directly
  // above the two champion lists it explains, which is the order a reader
  // wants them in.
  'xiangqi-match-fixing',
  'xiangqi-champions',
  'xiangqi-world-championship',
  'titled-players',
  'riverbank-cannon',
  'skill-vs-luck',
  'misty',
  'mistybanqi',
  'server-enforced-fog',
] as const;

type HomeCardItem =
  | {
      kind: 'announcement';
      date: string;
      order: number;
      announcement: Announcement;
    }
  | {
      kind: 'article';
      date: string;
      order: number;
      article: Article;
    };

/**
 * How far back the homepage row reaches, and how short it is allowed to get.
 *
 * The row is a "what's new" strip, and with the curated list at eight entries it
 * was showing articles from June beside ones from yesterday: the oldest card was
 * roughly eighty days old, which reads as an archive rather than as news.
 *
 * The floor is the part that matters. A pure age cut empties the row during any
 * quiet stretch, and an empty strip on the homepage is a worse failure than a
 * stale one: it looks broken, where an old article merely looks old. So age
 * trims the row while there is enough fresh material, and below the floor the
 * newest cards are kept whatever their age.
 */
const HOME_CARD_MAX_AGE_DAYS = 60;
const HOME_CARD_MIN = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

export type HomeArticleCardOptions = {
  /** Reference point for the age cut. Injected so tests are not time-dependent. */
  now?: Date;
  /** Days of history the row reaches back over. Infinity disables the cut. */
  maxAgeDays?: number;
  /** Cards kept regardless of age, so a quiet month cannot empty the row. */
  minCards?: number;
};

export function buildHomeArticleCards(
  limit = 8,
  locale: Locale = currentLocale(),
  options: HomeArticleCardOptions = {},
): HTMLElement | null {
  const eligible = new Map(
    articles.filter(isArticleListedInThisEnv).map((article) => [article.slug, article]),
  );
  const articleItems = HOME_ARTICLE_SLUGS.flatMap<HomeCardItem>((slug, index) => {
    const article = eligible.get(slug);
    // Rules reference pages live on /rules, never this editorial row.
    return article && article.kind !== 'rules'
      ? [{ kind: 'article', date: articleDateKey(article), order: index + 1, article }]
      : [];
  });
  const latestAnnouncement = latestVisibleAnnouncement();
  const announcementItems: HomeCardItem[] = latestAnnouncement
    ? [
        {
          kind: 'announcement',
          date: latestAnnouncement.date,
          order: 0,
          announcement: latestAnnouncement,
        },
      ]
    : [];
  const ordered = [...announcementItems, ...articleItems].sort(compareHomeCardItems);

  const maxAgeDays = options.maxAgeDays ?? HOME_CARD_MAX_AGE_DAYS;
  const minCards = options.minCards ?? HOME_CARD_MIN;
  const now = options.now ?? new Date();
  // A card with an unparseable date counts as fresh rather than being dropped:
  // failing to read a date is not evidence that the article is old.
  const fresh = ordered.filter((item) => {
    const published = Date.parse(item.date);
    if (!Number.isFinite(published)) return true;
    return (now.getTime() - published) / DAY_MS <= maxAgeDays;
  });
  const kept = fresh.length >= minCards ? fresh : ordered.slice(0, minCards);

  const cards = kept
    .map((item) =>
      item.kind === 'announcement'
        ? landingAnnouncementCard(item.announcement, locale)
        : landingArticleCard(item.article, locale),
    )
    .slice(0, limit);
  if (cards.length === 0) return null;

  const section = document.createElement('section');
  section.className = 'landing-articles';
  section.setAttribute('aria-label', t('articles.heading', {}, locale));

  // No header row: the label ("Read") and the "All articles →" link are dropped
  // to match lichess's blog strip (cards only) and to reclaim vertical space for
  // the taller 8:5 thumbnails. The whole /blog index stays reachable from
  // the primary nav.
  const carousel = document.createElement('div');
  carousel.className = 'landing-carousel';

  const track = document.createElement('div');
  track.className = 'landing-carousel-track';
  for (const card of cards) track.append(card);

  const prev = carouselNavButton('prev', '‹', locale);
  const next = carouselNavButton('next', '›', locale);

  carousel.append(prev, track, next);
  section.append(carousel);
  return section;
}

function articleDateKey(article: Article): string {
  return article.publishedAt ?? article.updatedAt ?? '';
}

function compareArticlesNewestFirst(a: Article, b: Article): number {
  const dateCompare = articleDateKey(b).localeCompare(articleDateKey(a));
  if (dateCompare !== 0) return dateCompare;
  return a.title.localeCompare(b.title);
}

function compareHomeCardItems(a: HomeCardItem, b: HomeCardItem): number {
  const dateCompare = b.date.localeCompare(a.date);
  if (dateCompare !== 0) return dateCompare;
  return a.order - b.order;
}

function latestVisibleAnnouncement(): Announcement | undefined {
  return [...announcements()]
    .filter((announcement) => announcement.showInHomeArticleWidget === true)
    .filter((announcement) => rulesHrefPublicSurfaceEnabled(announcement.href))
    .sort((a, b) => b.date.localeCompare(a.date))[0];
}

function carouselNavButton(dir: 'prev' | 'next', glyph: string, locale: Locale): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `landing-carousel-nav landing-carousel-nav-${dir}`;
  button.setAttribute(
    'aria-label',
    t(dir === 'prev' ? 'articles.previousArticles' : 'articles.moreArticles', {}, locale),
  );
  button.textContent = glyph;
  return button;
}

function landingArticleCard(article: Article, locale: Locale): HTMLElement {
  const requestedLang: ArticleLang | undefined =
    locale === 'zh-Hans' || locale === 'zh-Hant' ? locale : undefined;
  const articleLang = publishedArticleLang(article.slug, requestedLang);
  const localized = articleLang ? translateArticle(article, articleLang) : article;
  const link = document.createElement('a');
  link.className = 'landing-article-card';
  link.dataset.cardKind = 'article';
  link.href = localizedArticleHref(article, locale);

  const thumb = document.createElement('div');
  thumb.className = 'landing-article-card-thumb';
  // Variant articles use their shared marker;
  // non-variant articles (e.g. concept pieces) keep their own diagram.
  const mini = renderVariantMiniThumb(article.slug);
  if (mini) {
    thumb.append(mini);
  } else if (article.thumbnail) {
    thumb.append(renderArticleThumbnail(article.thumbnail));
  } else {
    thumb.classList.add('is-empty');
  }

  // Date pill overlaid on the thumbnail, lichess blog-card style.
  const dateIso = article.publishedAt ?? article.updatedAt;
  if (dateIso) {
    const date = document.createElement('span');
    date.className = 'landing-article-card-date';
    date.textContent = formatCardDate(dateIso, locale);
    thumb.append(date);
  }
  thumb.append(articleCardStarBadge('landing-article-card-star'));

  const title = document.createElement('strong');
  title.className = 'landing-article-card-title';
  title.textContent = localized.title;

  link.append(thumb, title);
  return link;
}

function articleCardStarBadge(className: string): HTMLSpanElement {
  const star = document.createElement('span');
  star.className = className;
  star.setAttribute('aria-hidden', 'true');
  star.textContent = '★';
  return star;
}

function landingAnnouncementCard(announcement: Announcement, locale: Locale): HTMLElement {
  const link = document.createElement('a');
  link.className = 'landing-article-card landing-announcement-card';
  link.dataset.cardKind = 'announcement';
  const href = announcement.href ?? '/feed';
  link.href = /^https?:/.test(href) ? href : localizedHref(href, locale);
  if (/^https?:/.test(href)) {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }

  const thumb = document.createElement('div');
  thumb.className = 'landing-article-card-thumb landing-announcement-thumb';

  const icon = document.createElement('span');
  icon.className = 'landing-announcement-thumb-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.append(buildUiIcon(uiIconForAnnouncementKind(announcement.kind)));
  thumb.append(icon);

  const date = document.createElement('span');
  date.className = 'landing-article-card-date';
  date.textContent = formatCardDate(announcement.date, locale);
  thumb.append(date);

  const title = document.createElement('strong');
  title.className = 'landing-article-card-title';
  title.textContent = localizeAnnouncementString(announcement.headline, locale);

  link.append(thumb, title);
  return link;
}

function formatCardDate(iso: string, locale: Locale): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleDateString(LOCALE_META[locale].dateLocale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatArticleDate(iso: string, locale: Locale): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleDateString(LOCALE_META[locale].dateLocale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

// Auto-rotating horizontal carousel for the homepage article row. Ping-pongs
// the track between its start and the point where the last card is flush right,
// so any overflow scrolls into view without a jarring rewind. No-ops (and hides
// the arrows) when every card already fits. Self-clears its timer once the
// carousel leaves the DOM, matching the other landing pollers.
// Wires every `.landing-carousel` on the page (the blog strip and, since band 4,
// the video strip) so each auto-rotates and drives its own arrows independently.
const LANDING_CAROUSEL_ROTATION_MS = 10_000;

export function initLandingCarousel(root: HTMLElement): void {
  for (const carousel of root.querySelectorAll<HTMLElement>('.landing-carousel')) {
    initSingleCarousel(carousel);
  }
}

function initSingleCarousel(carousel: HTMLElement): void {
  const track = carousel.querySelector<HTMLElement>('.landing-carousel-track');
  if (!track) return;
  const cards = [...track.children] as HTMLElement[];
  const prev = carousel.querySelector<HTMLButtonElement>('.landing-carousel-nav-prev');
  const next = carousel.querySelector<HTMLButtonElement>('.landing-carousel-nav-next');
  if (cards.length === 0) return;

  let index = 0;
  let dir = 1;
  let timer: number | null = null;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  const stepPx = (): number => {
    if (cards.length < 2) return 0;
    return cards[1]!.getBoundingClientRect().left - cards[0]!.getBoundingClientRect().left;
  };
  const maxIndex = (): number => {
    const step = stepPx();
    if (step <= 0) return 0;
    const overflow = Math.max(0, track.scrollWidth - carousel.clientWidth);
    return Math.round(overflow / step);
  };

  const apply = () => {
    const mi = maxIndex();
    carousel.classList.toggle('is-static', mi <= 0);
    if (prev) prev.disabled = index <= 0;
    if (next) next.disabled = index >= mi;
    if (mi <= 0) {
      index = 0;
      track.style.transform = 'none';
      return;
    }
    index = Math.max(0, Math.min(index, mi));
    track.style.transform = `translateX(${-(index * stepPx())}px)`;
  };

  const tick = () => {
    const mi = maxIndex();
    if (mi <= 0) return;
    if (index >= mi) dir = -1;
    else if (index <= 0) dir = 1;
    index += dir;
    apply();
  };

  const stop = () => {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  };
  const start = () => {
    stop();
    if (reduceMotion) return;
    timer = window.setInterval(() => {
      if (!document.body.contains(carousel)) {
        stop();
        return;
      }
      tick();
    }, LANDING_CAROUSEL_ROTATION_MS);
  };

  const nudge = (delta: number) => {
    const mi = maxIndex();
    if (mi <= 0) return;
    index = Math.max(0, Math.min(index + delta, mi));
    dir = delta >= 0 ? 1 : -1;
    apply();
  };
  prev?.addEventListener('click', () => nudge(-1));
  next?.addEventListener('click', () => nudge(1));

  carousel.addEventListener('mouseenter', stop);
  carousel.addEventListener('mouseleave', start);
  window.addEventListener('resize', apply);

  apply();
  start();
}

export function buildArticlePage(slug: string, lang?: ArticleLang): HTMLElement {
  const base = findArticle(slug);
  const articleLang = base ? publishedArticleLang(base.slug, lang) : undefined;
  const locale = articleLocale(articleLang);
  if (!base) return buildArticleNotFound(locale);
  if (!isArticleVisibleInThisEnv(base)) return buildArticleNotFound(locale);
  const article = articleLang ? translateArticle(base, articleLang) : base;

  const main = document.createElement('main');
  main.className = 'site-section article-shell article-page';
  main.dataset.articleSlug = article.slug;
  if (articleLang) main.dataset.articleLang = articleLang;

  // The sheet is the page's single anchoring panel; both rails sit beside
  // it directly on the page background (pychess grammar).
  const sheet = document.createElement('div');
  sheet.className = 'article-sheet';

  // Centered header block (lichess ublog grammar): fluid regular-weight
  // title, one quiet meta row (kind chip, dates, status), summary as lede.
  const header = document.createElement('header');
  header.className = 'article-header';

  const heading = document.createElement('h1');
  heading.className = 'article-title';
  heading.textContent = article.title;
  header.append(heading);

  const metaRow = document.createElement('p');
  metaRow.className = 'article-meta-row';
  if (isArticleStatusBadge(article.status)) {
    const badge = document.createElement('span');
    badge.className = `article-status-badge article-status-${article.status}`;
    badge.textContent = t(ARTICLE_STATUS_KEYS[article.status], {}, locale);
    metaRow.append(badge);
  }
  // Guest byline leads the meta row, before the dates: who wrote it matters
  // more to a reader than when. Absent on everything Mistboard wrote itself.
  if (article.author) {
    const byline = document.createElement('span');
    byline.className = 'article-meta-byline';
    byline.append(`${t('articles.by', {}, locale)} `);
    const nameEl = article.author.handle
      ? document.createElement('a')
      : document.createElement('span');
    if (nameEl instanceof HTMLAnchorElement) {
      nameEl.href = `/@/${encodeURIComponent(article.author.handle ?? '')}`;
    }
    nameEl.className = 'article-meta-author';
    prependTitleBadge(nameEl, article.author.title, locale);
    const name = document.createElement('span');
    name.className = 'article-meta-author-name';
    name.textContent = article.author.displayName;
    nameEl.append(name);
    byline.append(nameEl);
    metaRow.append(byline);
  }
  if (article.publishedAt) {
    const dates = document.createElement('span');
    dates.className = 'article-meta-dates';
    dates.textContent = `${t('articles.published', {}, locale)} ${formatArticleDate(
      article.publishedAt,
      locale,
    )}`;
    if (article.updatedAt && article.updatedAt !== article.publishedAt) {
      dates.textContent += ` · ${t('articles.updated', {}, locale)} ${formatArticleDate(
        article.updatedAt,
        locale,
      )}`;
    }
    metaRow.append(dates);
  }
  if (metaRow.childElementCount > 0) header.append(metaRow);

  const showSummaryOnPage = article.showSummaryOnPage ?? true;
  if (showSummaryOnPage) {
    const lede = document.createElement('p');
    lede.className = 'article-lede';
    lede.textContent = article.summary;
    header.append(lede);
  }

  if (article.kind === 'article') {
    const breadcrumb = document.createElement('p');
    breadcrumb.className = 'article-breadcrumb';
    const back = document.createElement('a');
    back.href = localizedHref('/blog', locale);
    back.textContent = `← ${t('articles.allArticles', {}, locale)}`;
    breadcrumb.append(back);
    sheet.append(breadcrumb);
  }
  sheet.append(header);

  // Above the intro on purpose: the reader who arrived from a search for this
  // game already knows they want it, and should not have to read to the bottom
  // to find the board.
  if (article.kind === 'rules') {
    const playCta = buildRulesPlayCta(base.slug, article.title, locale);
    if (playCta) sheet.append(playCta);
  }

  if (article.intro && article.intro.length > 0) {
    const intro = document.createElement('div');
    intro.className = 'article-intro';
    for (const block of article.intro) intro.append(renderBlock(block, articleLang));
    sheet.append(intro);
  }

  if (article.tldr && article.tldr.length > 0) {
    const tldr = document.createElement('aside');
    tldr.className = 'article-tldr';
    const tldrHeading = document.createElement('strong');
    tldrHeading.className = 'article-tldr-heading';
    tldrHeading.textContent = t('articles.tldr', {}, locale);
    const tldrList = document.createElement('ul');
    tldrList.className = 'article-tldr-list';
    for (const line of article.tldr) {
      const li = document.createElement('li');
      appendRichText(li, line);
      tldrList.append(li);
    }
    tldr.append(tldrHeading, tldrList);
    sheet.append(tldr);
  }

  const body = document.createElement('div');
  body.className = 'article-body';

  const usedIds = new Set<string>();
  let headingIndex = 0;
  for (const section of article.sections) {
    const h2 = document.createElement('h2');
    h2.className = 'article-section-heading';
    h2.textContent = section.heading;
    h2.id = uniqueId(section.heading, usedIds, headingIndex++);
    body.append(h2);
    for (const node of renderSectionBody(section, articleLang)) {
      if (node instanceof HTMLHeadingElement && node.tagName === 'H3') {
        node.id = uniqueId(node.textContent ?? '', usedIds, headingIndex++);
      }
      body.append(node);
    }
  }

  if (article.kind === 'rules') {
    const variantNav = buildVariantSidebar(base.slug, articleLang);
    if (variantNav) main.append(variantNav);
  }
  sheet.append(body);
  const footer = buildArticleFooter(base, articleLang);
  if (footer) sheet.append(footer);
  main.append(sheet);
  const sidebar = buildTocSidebar(body, articleLang);
  if (sidebar) main.append(sidebar);

  return main;
}

// Blog posts used to end at the last section: no footer (the site footer is
// homepage-only by design), no onward link, nothing. Every post was a dead end
// for a reader and for a crawler. This is the lichess ublog footer minus the
// social half — the "you may also like" row, which is the part that costs no
// social proof we don't have yet.
//
// Rules docs already carry the variant rail as their onward path, so they keep
// their current shape and only /blog gets this.
function buildArticleFooter(article: Article, lang?: ArticleLang): HTMLElement | null {
  if (article.kind !== 'article') return null;
  const related = relatedArticles(article);
  if (related.length === 0) return null;
  const locale = articleLocale(lang);

  const footer = document.createElement('footer');
  footer.className = 'article-footer';

  const heading = document.createElement('h2');
  heading.className = 'article-footer-heading';
  heading.textContent = t('articles.readNext', {}, locale);

  const list = document.createElement('ul');
  list.className = 'articles-index-list article-footer-list';
  for (const entry of related) {
    list.append(articleCard(entry, lang, { showStarBadge: false }));
  }

  footer.append(heading, list);
  return footer;
}

const ARTICLE_FOOTER_RELATED_COUNT = 3;

// `publisher` lives only on the blog arm of the union, so the related-post walk
// works in the narrowed type rather than re-checking `kind` at every access.
type BlogArticle = Extract<Article, { kind: 'article' }>;

// Deterministic on purpose: the page is baked at build time, so a shuffle (what
// lichess does here) would make the prerendered HTML disagree with what the
// client re-renders on takeover. Straight recency would point every post at the
// same newest three, so we walk the date-sorted ring starting just after the
// current post: every post gets a distinct trio and it reads as "the posts
// either side of this one".
//
// No topic weighting, deliberately. `boardFamily` is the obvious candidate and
// it is the wrong field: it selects which appearance pickers an article shows,
// so it is set on the banqi engine write-up and unset on the xiangqi champions
// list. Ranking by it demoted a xiangqi article below a banqi one on a xiangqi
// page. A real topic signal needs a field that means topic; until the schema has
// one, recency is the honest answer.
function relatedArticles(article: BlogArticle): BlogArticle[] {
  // A content-language page walks its OWN language's ring. `isArticleListedInThisEnv`
  // rejects everything with `sourceLang` set, so an unqualified pool leaves a
  // Vietnamese reader a footer of three English cards, one of which is this page's
  // own English source: the reader dead-ends and the two pages read as duplicates
  // of each other rather than as a pair. Same-language candidates only need to be
  // visible; they are absent from the index by design, not unpublished.
  const sameLanguage = (candidate: BlogArticle): boolean =>
    article.sourceLang
      ? candidate.sourceLang === article.sourceLang && isArticleVisibleInThisEnv(candidate)
      : isArticleListedInThisEnv(candidate);
  const pool = articles
    .filter(
      (candidate): candidate is BlogArticle =>
        candidate.kind === 'article' &&
        candidate.slug !== article.slug &&
        candidate.publisher === article.publisher &&
        sameLanguage(candidate),
    )
    .sort(compareArticlesNewestFirst);
  if (pool.length === 0) return [];

  // Slot this post back into the same ordering so the ring can start at its
  // next-older neighbour and wrap around to the newest.
  const ordered = [...pool, article].sort(compareArticlesNewestFirst);
  const start = ordered.findIndex((candidate) => candidate.slug === article.slug);
  return Array.from(
    { length: Math.min(ARTICLE_FOOTER_RELATED_COUNT, ordered.length - 1) },
    (_, i) => ordered[(start + 1 + i) % ordered.length]!,
  );
}

// Left rail on rules surfaces (pychess variant-page grammar): every listed
// rules article with the current one highlighted. Pass null for the rules
// index, which shares the shell without a current page. The order follows the
// global canonical variant order so the rail scans as one list.
// The current page is force-included so a dev-only draft still shows itself
// highlighted — but NOT when it opted out of listings via showInIndex:false
// (a guest page like shogi4): those render the rail without self-including, so
// nothing is highlighted and the page reads as "other games on this site."
function buildVariantSidebar(currentSlug: string | null, lang?: ArticleLang): HTMLElement | null {
  const locale = articleLocale(lang);
  const entries = articles.filter(
    (article) =>
      article.kind === 'rules' &&
      !RULES_ARTICLE_RAIL_HIDDEN_SLUGS.has(article.slug) &&
      (isArticleListedInThisEnv(article) ||
        (article.slug === currentSlug &&
          article.showInIndex !== false &&
          rulesSlugPublicSurfaceEnabled(article.slug))),
  );
  if (entries.length < 2) return null;

  const aside = document.createElement('aside');
  aside.className = 'article-variant-sidebar';
  aside.setAttribute('aria-label', t('rules.navigation', {}, locale));

  const box = document.createElement('div');
  box.className = 'article-toc-sticky';

  const nav = document.createElement('nav');
  nav.className = 'article-toc-nav';
  const list = document.createElement('ul');
  for (const entry of buildRulesArticleRailEntries(entries)) {
    const entryLang = publishedArticleLang(entry.slug, lang);
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.className = 'article-variant-link';
    link.href = localizedArticleHref(entry, locale);
    const miniRail = renderVariantMiniThumb(entry.slug);
    if (miniRail) link.append(miniRail);
    else if (entry.thumbnail) link.append(renderArticleThumbnail(entry.thumbnail));
    const localized = entryLang ? translateArticle(entry, entryLang) : entry;
    const label = document.createElement('span');
    label.className = 'article-variant-label';
    label.textContent = variantNavLabel(localized.title);
    link.append(label);
    if (entry.slug === currentSlug) {
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');
    }
    li.append(link);
    list.append(li);
  }
  nav.append(list);
  box.append(nav);

  aside.append(box);
  return aside;
}

// Sidebar labels are variant names, not page titles. Page titles carry search
// terms that the rail must not: an alias parenthetical ("Banqi Rules (Chinese
// Dark Chess)") or a zh subtitle after a fullwidth colon ("暗棋规则：玩法详解…")
// would otherwise render in full and widen the rail enough to push the article
// column off centre. Strip the search freight first, then the "Rules" suffix.
function variantNavLabel(title: string): string {
  return title
    .replace(/：.*$/u, '')
    .replace(/\s*\([^)]*\)\s*$/u, '')
    .replace(/\s*Rules$/i, '')
    .replace(/(规则|規則)$/u, '')
    .trim();
}

function buildRulesArticleGroups(entries: readonly Article[], locale: Locale): RulesArticleGroup[] {
  return RULES_ARTICLE_GROUP_ORDER.map((id) => ({
    title: t(RULES_GROUP_TITLE_KEYS[id], {}, locale),
    items: entries
      .filter((article) => rulesArticleGroup(article) === id)
      .sort(compareRulesArticles),
  })).filter((group) => group.items.length > 0);
}

function buildRulesArticleRailEntries(entries: readonly Article[]): Article[] {
  return [...entries].sort(compareRulesArticleRailEntries);
}

function compareRulesArticles(a: Article, b: Article): number {
  const order = rulesArticleSortIndex(a) - rulesArticleSortIndex(b);
  if (order !== 0) return order;
  return a.title.localeCompare(b.title);
}

function compareRulesArticleRailEntries(a: Article, b: Article): number {
  const order = rulesArticleRailSortIndex(a) - rulesArticleRailSortIndex(b);
  if (order !== 0) return order;
  return a.title.localeCompare(b.title);
}

function rulesArticleGroup(article: Article): RulesArticleGroupId {
  const baseGroup = BASE_RULE_GROUP_BY_SLUG[article.slug];
  if (baseGroup) return baseGroup;
  const gameSpecId = article.gameSpecId ?? article.slug;
  if (!isGameSpecId(gameSpecId)) return 'other';
  return rulesGroupForFamily(gameSpecForId(gameSpecId).family);
}

function rulesGroupForFamily(family: GameFamilyId): RulesArticleGroupId {
  if (family === 'chess') return 'chess';
  if (family === 'xiangqi') return 'xiangqi';
  if (family === 'shogi') return 'shogi';
  if (family === 'jungle') return 'jungle';
  return 'other';
}

function rulesArticleSortIndex(article: Article): number {
  const baseOrder = BASE_RULE_ORDER[article.slug];
  if (baseOrder !== undefined) return baseOrder;
  const gameSpecId = article.gameSpecId ?? article.slug;
  if (isGameSpecId(gameSpecId)) return canonicalVariantOrderIndex(gameSpecId);
  return Number.MAX_SAFE_INTEGER;
}

function rulesArticleRailSortIndex(article: Article): number {
  if (article.slug === 'shogi') return canonicalVariantOrderIndex(DARK_SHOGI_SPEC_ID) - 0.5;
  if (article.slug === 'shogi4') return canonicalVariantOrderIndex(DARK_SHOGI_SPEC_ID) + 0.5;
  const gameSpecId = article.gameSpecId ?? article.slug;
  if (isGameSpecId(gameSpecId)) return canonicalVariantOrderIndex(gameSpecId);
  return Number.MAX_SAFE_INTEGER;
}

function uniqueId(text: string, used: Set<string>, fallback: number): string {
  let base = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!base) base = `section-${fallback}`;
  let id = base;
  let n = 2;
  while (used.has(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  used.add(id);
  return id;
}

function buildTocSidebar(body: HTMLElement, lang?: ArticleLang): HTMLElement | null {
  const headings = body.querySelectorAll<HTMLHeadingElement>('h2, h3');
  if (headings.length === 0) return null;
  const locale = articleLocale(lang);

  const aside = document.createElement('aside');
  aside.className = 'article-toc-sidebar';
  const sticky = document.createElement('div');
  sticky.className = 'article-toc-sticky';
  const title = document.createElement('h3');
  title.className = 'article-toc-title';
  title.textContent = t('articles.tocTitle', {}, locale);
  const nav = document.createElement('nav');
  nav.className = 'article-toc-nav';
  nav.setAttribute('aria-label', t('articles.tableOfContents', {}, locale));

  const rootList = document.createElement('ul');
  let currentH2Li: HTMLLIElement | null = null;
  let currentH3Ul: HTMLUListElement | null = null;

  headings.forEach((h) => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `#${h.id}`;
    a.textContent = h.textContent ?? '';
    a.dataset.headingId = h.id;
    li.append(a);
    if (h.tagName === 'H2') {
      rootList.append(li);
      currentH2Li = li;
      currentH3Ul = null;
    } else if (currentH2Li) {
      if (!currentH3Ul) {
        currentH3Ul = document.createElement('ul');
        currentH2Li.append(currentH3Ul);
      }
      currentH3Ul.append(li);
    } else {
      rootList.append(li);
    }
  });

  nav.append(rootList);
  sticky.append(title, nav);
  aside.append(sticky);
  return aside;
}

// Click any article figure to see it full size. Screenshots of the review panel
// are unreadable at article-column width, which is where most of this page's
// evidence lives.
//
// A native <dialog> opened with showModal(), because it brings focus trapping,
// Esc-to-close and inertness of the page behind it for free; hand-rolling a
// modal means reimplementing all three and getting one of them wrong. Delegated
// from the root rather than bound per figure, so it covers prerendered HTML and
// any figure mounted later without a second wiring pass.
export function mountArticleLightbox(root: HTMLElement): () => void {
  const dialog = document.createElement('dialog');
  dialog.className = 'article-lightbox';
  const frame = document.createElement('div');
  frame.className = 'article-lightbox-frame';
  dialog.append(frame);

  const close = (): void => {
    if (dialog.open) dialog.close();
  };

  const onClick = (event: Event): void => {
    const trigger = (event.target as HTMLElement | null)?.closest?.('.article-figure-zoom');
    if (!trigger || !root.contains(trigger)) return;
    const source = trigger.querySelector('img, svg');
    if (!source) return;
    frame.replaceChildren(source.cloneNode(true));
    // The caption is part of the evidence, so it comes along.
    const caption = trigger.closest('figure')?.querySelector('.article-figure-caption');
    if (caption) {
      const copy = document.createElement('p');
      copy.className = 'article-lightbox-caption';
      copy.textContent = caption.textContent;
      frame.append(copy);
    }
    if (!dialog.isConnected) document.body.append(dialog);
    dialog.showModal();
  };

  // Clicking the backdrop closes. The dialog element itself is the backdrop, so a
  // click that lands on it rather than on the frame inside it means "outside".
  const onDialogClick = (event: MouseEvent): void => {
    if (event.target === dialog) close();
  };

  root.addEventListener('click', onClick);
  dialog.addEventListener('click', onDialogClick);
  return () => {
    root.removeEventListener('click', onClick);
    dialog.removeEventListener('click', onDialogClick);
    close();
    dialog.remove();
  };
}

export function mountArticleEnhancements(root: HTMLElement): () => void {
  const sidebar = root.querySelector<HTMLElement>('.article-toc-sidebar');
  const body = root.querySelector<HTMLElement>('.article-body');
  if (!sidebar || !body) return () => {};

  const headings = Array.from(body.querySelectorAll<HTMLHeadingElement>('h2, h3'));
  if (headings.length === 0) {
    sidebar.style.display = 'none';
    return () => {};
  }

  const links = Array.from(sidebar.querySelectorAll<HTMLAnchorElement>('a[data-heading-id]'));
  const linkById = new Map(links.map((l) => [l.dataset.headingId!, l]));

  const setActive = (id: string): void => {
    for (const l of links) l.classList.remove('active');
    const active = linkById.get(id);
    if (!active) return;
    active.classList.add('active');
    // Auto-scroll the TOC pane to keep the active item visible.
    const sidebarRect = sidebar.getBoundingClientRect();
    const linkRect = active.getBoundingClientRect();
    if (linkRect.top < sidebarRect.top || linkRect.bottom > sidebarRect.bottom) {
      active.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };

  const observer = new IntersectionObserver(
    (entries) => {
      // The most-recently-intersected heading wins. With the rootMargin we
      // use, only one heading is typically intersecting at a time.
      const intersecting = entries.filter((e) => e.isIntersecting);
      if (intersecting.length === 0) return;
      const last = intersecting[intersecting.length - 1]!;
      setActive(last.target.id);
    },
    { rootMargin: '-80px 0px -75% 0px' },
  );
  for (const h of headings) observer.observe(h);

  const onLinkClick = (e: Event): void => {
    const target = e.currentTarget as HTMLAnchorElement;
    e.preventDefault();
    const id = target.getAttribute('href')!.slice(1);
    const el = document.getElementById(id);
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.pageYOffset - 64;
    window.scrollTo({ top, behavior: 'smooth' });
    history.replaceState(null, '', `#${id}`);
  };
  for (const l of links) l.addEventListener('click', onLinkClick);

  let scrollFrame: number | null = null;
  const onScroll = (): void => {
    if (scrollFrame !== null) return;
    scrollFrame = window.requestAnimationFrame(() => {
      scrollFrame = null;
      const atBottom = window.innerHeight + window.scrollY >= document.body.offsetHeight - 10;
      if (atBottom) {
        const last = headings[headings.length - 1]!;
        setActive(last.id);
      }
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });

  return () => {
    observer.disconnect();
    for (const l of links) l.removeEventListener('click', onLinkClick);
    window.removeEventListener('scroll', onScroll);
    if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
  };
}

function renderSectionBody(section: ArticleSection, lang?: ArticleLang): HTMLElement[] {
  if (section.blocks && section.blocks.length > 0) {
    return section.blocks.map((block) => renderBlock(block, lang));
  }
  if (section.paragraphs) {
    return section.paragraphs.map(paragraphNode);
  }
  return [];
}

// Interactive blocks need their parent DOM tree to be sized before chessground
// boots, so we defer the actual mount until the article element is attached.
// renderBlock stamps the wrapper with a `data-pending-widget` marker that
// mountPendingWidgets() picks up and dispatches by widget kind.
type PendingBlock =
  | InteractiveBlock
  | LiveBoardsBlock
  | XiangqiReplayBlock
  | ChessReplayBlock
  | MiniXiangqiReplayBlock
  | DropMiniXiangqiReplayBlock
  | FortressXiangqiReplayBlock
  | DuckXiangqiReplayBlock
  | ShogiReplayBlock
  | CrossroadsReplayBlock
  | JieqiReplayBlock
  | BanqiReplayBlock
  | JungleReplayBlock
  | JungleFlipReplayBlock;
type PendingMount = {
  block: PendingBlock;
  lang?: ArticleLang;
};
const pendingMounts = new WeakMap<HTMLElement, PendingMount>();

function rememberPendingMount(figure: HTMLElement, block: PendingBlock, lang?: ArticleLang): void {
  pendingMounts.set(figure, { block, lang });
}

function renderBlock(block: ArticleBlock, lang?: ArticleLang): HTMLElement {
  if (block.kind === 'paragraph') return paragraphNode(block.text);
  if (block.kind === 'sub-heading') return subHeadingNode(block);
  if (block.kind === 'static-boards') return renderStaticBoardsBlock(block);
  if (block.kind === 'cta') return renderCtaBlock(block);
  if (block.kind === 'image-figure') return renderImageFigureBlock(block);
  if (block.kind === 'raw-svg') return renderRawSvgBlock(block, lang);
  if (block.kind === 'svg-row') return renderSvgRowBlock(block, lang);
  if (block.kind === 'raw-svg-stepper') return renderRawSvgStepperBlock(block, lang);
  if (block.kind === 'code') return renderCodeBlock(block);
  if (block.kind === 'table') return renderTableBlock(block);
  if (block.kind === 'faq') return renderFaqBlock(block);
  if (block.kind === 'live-boards') return renderLiveBoardsBlock(block);
  if (block.kind === 'xq-replay') return renderXiangqiReplayBlock(block, lang);
  if (block.kind === 'mxq-replay') return renderMiniXiangqiReplayBlock(block, lang);
  if (block.kind === 'drop-mini-xiangqi-replay')
    return renderDropMiniXiangqiReplayBlock(block, lang);
  if (block.kind === 'fortress-xiangqi-replay')
    return renderFortressXiangqiReplayBlock(block, lang);
  if (block.kind === 'duck-xiangqi-replay') return renderDuckXiangqiReplayBlock(block, lang);
  if (block.kind === 'shogi-replay') return renderShogiReplayBlock(block, lang);
  if (block.kind === 'chess-replay') return renderChessReplayBlock(block, lang);
  if (block.kind === 'crossroads-replay') return renderCrossroadsReplayBlock(block, lang);
  if (block.kind === 'jieqi-replay') return renderJieqiReplayBlock(block, lang);
  if (block.kind === 'banqi-replay') return renderBanqiReplayBlock(block, lang);
  if (block.kind === 'jungle-replay') return renderJungleReplayBlock(block, lang);
  if (block.kind === 'jungle-flip-replay') return renderJungleFlipReplayBlock(block, lang);
  return renderInteractiveBlock(block);
}

function renderChessReplayBlock(block: ChessReplayBlock, lang?: ArticleLang): HTMLElement {
  const figure = document.createElement('figure');
  figure.className = 'article-figure article-figure-interactive';
  figure.dataset.pendingWidget = 'chess-replay';

  const mountTarget = document.createElement('div');
  mountTarget.className = 'article-interactive-target';
  figure.append(mountTarget);

  if (block.caption) {
    const cap = document.createElement('figcaption');
    cap.className = 'article-figure-caption';
    cap.textContent = block.caption;
    figure.append(cap);
  }

  rememberPendingMount(figure, block, lang);
  return figure;
}

function renderCrossroadsReplayBlock(
  block: CrossroadsReplayBlock,
  lang?: ArticleLang,
): HTMLElement {
  const figure = document.createElement('figure');
  figure.className = 'article-figure article-figure-interactive article-figure-crossroads';
  figure.dataset.pendingWidget = 'crossroads-replay';

  const mountTarget = document.createElement('div');
  mountTarget.className = 'article-interactive-target';
  figure.append(mountTarget);

  if (block.caption) {
    const cap = document.createElement('figcaption');
    cap.className = 'article-figure-caption';
    cap.textContent = block.caption;
    figure.append(cap);
  }

  rememberPendingMount(figure, block, lang);
  return figure;
}

function renderJieqiReplayBlock(block: JieqiReplayBlock, lang?: ArticleLang): HTMLElement {
  const figure = document.createElement('figure');
  figure.className = 'article-figure article-figure-interactive article-figure-jieqi';
  figure.dataset.pendingWidget = 'jieqi-replay';

  const mountTarget = document.createElement('div');
  mountTarget.className = 'article-interactive-target';
  figure.append(mountTarget);

  if (block.caption) {
    const cap = document.createElement('figcaption');
    cap.className = 'article-figure-caption';
    cap.textContent = block.caption;
    figure.append(cap);
  }

  rememberPendingMount(figure, block, lang);
  return figure;
}

function renderBanqiReplayBlock(block: BanqiReplayBlock, lang?: ArticleLang): HTMLElement {
  const figure = document.createElement('figure');
  figure.className = 'article-figure article-figure-interactive article-figure-banqi';
  figure.dataset.pendingWidget = 'banqi-replay';

  const mountTarget = document.createElement('div');
  mountTarget.className = 'article-interactive-target';
  figure.append(mountTarget);

  if (block.caption) {
    const cap = document.createElement('figcaption');
    cap.className = 'article-figure-caption';
    cap.textContent = block.caption;
    figure.append(cap);
  }

  rememberPendingMount(figure, block, lang);
  return figure;
}

function renderJungleReplayBlock(block: JungleReplayBlock, lang?: ArticleLang): HTMLElement {
  const figure = document.createElement('figure');
  figure.className = 'article-figure article-figure-interactive article-figure-jungle';
  figure.dataset.pendingWidget = 'jungle-replay';

  const mountTarget = document.createElement('div');
  mountTarget.className = 'article-interactive-target';
  figure.append(mountTarget);

  if (block.caption) {
    const cap = document.createElement('figcaption');
    cap.className = 'article-figure-caption';
    cap.textContent = block.caption;
    figure.append(cap);
  }

  rememberPendingMount(figure, block, lang);
  return figure;
}

function renderJungleFlipReplayBlock(
  block: JungleFlipReplayBlock,
  lang?: ArticleLang,
): HTMLElement {
  const figure = document.createElement('figure');
  figure.className = 'article-figure article-figure-interactive article-figure-jungle-flip';
  figure.dataset.pendingWidget = 'jungle-flip-replay';

  const mountTarget = document.createElement('div');
  mountTarget.className = 'article-interactive-target';
  figure.append(mountTarget);

  if (block.caption) {
    const cap = document.createElement('figcaption');
    cap.className = 'article-figure-caption';
    cap.textContent = block.caption;
    figure.append(cap);
  }

  rememberPendingMount(figure, block, lang);
  return figure;
}

function renderXiangqiReplayBlock(block: XiangqiReplayBlock, lang?: ArticleLang): HTMLElement {
  const figure = document.createElement('figure');
  figure.className = 'article-figure article-figure-interactive article-figure-xq';
  figure.dataset.pendingWidget = 'xq-replay';

  const mountTarget = document.createElement('div');
  mountTarget.className = 'article-interactive-target';
  figure.append(mountTarget);

  if (block.caption) {
    const cap = document.createElement('figcaption');
    cap.className = 'article-figure-caption';
    cap.textContent = block.caption;
    figure.append(cap);
  }

  rememberPendingMount(figure, block, lang);
  return figure;
}

function renderMiniXiangqiReplayBlock(
  block: MiniXiangqiReplayBlock,
  lang?: ArticleLang,
): HTMLElement {
  const figure = document.createElement('figure');
  figure.className = 'article-figure article-figure-interactive article-figure-xq';
  figure.dataset.pendingWidget = 'mxq-replay';

  const mountTarget = document.createElement('div');
  mountTarget.className = 'article-interactive-target';
  figure.append(mountTarget);

  if (block.caption) {
    const cap = document.createElement('figcaption');
    cap.className = 'article-figure-caption';
    cap.textContent = block.caption;
    figure.append(cap);
  }

  rememberPendingMount(figure, block, lang);
  return figure;
}

function renderDropMiniXiangqiReplayBlock(
  block: DropMiniXiangqiReplayBlock,
  lang?: ArticleLang,
): HTMLElement {
  const figure = document.createElement('figure');
  figure.className =
    'article-figure article-figure-interactive article-figure-xq article-figure-drop-mini-xiangqi';
  figure.dataset.pendingWidget = 'drop-mini-xiangqi-replay';

  const mountTarget = document.createElement('div');
  mountTarget.className = 'article-interactive-target';
  figure.append(mountTarget);

  if (block.caption) {
    const cap = document.createElement('figcaption');
    cap.className = 'article-figure-caption';
    cap.textContent = block.caption;
    figure.append(cap);
  }

  rememberPendingMount(figure, block, lang);
  return figure;
}

function renderDuckXiangqiReplayBlock(
  block: DuckXiangqiReplayBlock,
  lang?: ArticleLang,
): HTMLElement {
  const figure = document.createElement('figure');
  // No reserve rail on this board, so it takes the plain xiangqi figure classes
  // rather than the drop-mini ones the fortress replay borrows.
  figure.className = 'article-figure article-figure-interactive article-figure-xq';
  figure.dataset.pendingWidget = 'duck-xiangqi-replay';

  const mountTarget = document.createElement('div');
  mountTarget.className = 'article-interactive-target';
  figure.append(mountTarget);

  if (block.caption) {
    const cap = document.createElement('figcaption');
    cap.className = 'article-figure-caption';
    cap.textContent = block.caption;
    figure.append(cap);
  }
  rememberPendingMount(figure, block, lang);
  return figure;
}

function renderFortressXiangqiReplayBlock(
  block: FortressXiangqiReplayBlock,
  lang?: ArticleLang,
): HTMLElement {
  const figure = document.createElement('figure');
  figure.className =
    'article-figure article-figure-interactive article-figure-xq article-figure-drop-mini-xiangqi';
  figure.dataset.pendingWidget = 'fortress-xiangqi-replay';

  const mountTarget = document.createElement('div');
  mountTarget.className = 'article-interactive-target';
  figure.append(mountTarget);

  if (block.caption) {
    const cap = document.createElement('figcaption');
    cap.className = 'article-figure-caption';
    cap.textContent = block.caption;
    figure.append(cap);
  }

  rememberPendingMount(figure, block, lang);
  return figure;
}

function renderShogiReplayBlock(block: ShogiReplayBlock, lang?: ArticleLang): HTMLElement {
  const figure = document.createElement('figure');
  figure.className = 'article-figure article-figure-interactive article-figure-shogi';
  figure.dataset.pendingWidget = 'shogi-replay';

  const mountTarget = document.createElement('div');
  mountTarget.className = 'article-interactive-target';
  figure.append(mountTarget);

  if (block.caption) {
    const cap = document.createElement('figcaption');
    cap.className = 'article-figure-caption';
    cap.textContent = block.caption;
    figure.append(cap);
  }

  rememberPendingMount(figure, block, lang);
  return figure;
}

function renderLiveBoardsBlock(block: LiveBoardsBlock): HTMLElement {
  const figure = document.createElement('figure');
  figure.className = 'article-figure article-figure-interactive';
  figure.dataset.pendingWidget = 'live-boards';

  const mountTarget = document.createElement('div');
  mountTarget.className = 'article-interactive-target';
  figure.append(mountTarget);

  if (block.caption) {
    const cap = document.createElement('figcaption');
    cap.className = 'article-figure-caption';
    cap.textContent = block.caption;
    figure.append(cap);
  }

  rememberPendingMount(figure, block);
  return figure;
}

// Xiangqi diagrams draw pieces as inline SVG glyphs, so — unlike chess diagrams,
// which restyle through chessground CSS sprites — they must be re-rendered when
// the piece-set picker changes. Each reactive holder keeps its render thunk; a
// single app-life listener repaints every in-document holder on appearance
// change. Holders detached by SPA navigation drop out of the query and are
// garbage-collected with their WeakMap entry, so there is no per-figure listener
// and no leak. Board theme + fog react through CSS vars, so they need no JS.
const xqDiagramThunks = new WeakMap<HTMLElement, () => string>();
let xqDiagramListenerInstalled = false;

function markNoTranslate(element: Element): void {
  element.classList.add('notranslate');
  element.setAttribute('translate', 'no');
}

function markXqDiagramsNoTranslate(root: ParentNode): void {
  root.querySelectorAll('.xq-article-svg').forEach(markNoTranslate);
}

// Replace the holder's <svg> in place so the diagram stays a direct child (the
// article CSS targets `.article-figure-xq > .xq-article-svg`) and any caption is
// preserved. Each diagram thunk returns exactly one <svg> root.
function paintXqDiagram(holder: HTMLElement, set: XiangqiPieceSet): void {
  const thunk = xqDiagramThunks.get(holder);
  if (!thunk) return;
  const caption =
    Array.from(holder.children).find((child) =>
      child.classList.contains('article-figure-caption'),
    ) ?? null;
  const layout = readStoredXiangqiBoardLayout();
  let html: string;
  try {
    html = withXiangqiBoardLayout(layout, () => withXiangqiPieceSet(set, thunk));
  } catch (err) {
    console.warn('xiangqi diagram render failed; falling back to default piece set', err);
    html = withXiangqiBoardLayout(layout, () =>
      withXiangqiPieceSet(DEFAULT_XIANGQI_PIECE_SET, thunk),
    );
  }
  const scratch = document.createElement('div');
  scratch.innerHTML = html;
  const nodes = Array.from(scratch.childNodes);
  holder.replaceChildren(...nodes, ...(caption ? [caption] : []));
  markXqDiagramsNoTranslate(holder);
}

// Index/announcement card thumbnails are also xiangqi SVGs, but they re-apply
// their own sizing attributes, so they carry a bespoke painter rather than the
// in-place diagram repaint. Same single listener drives both.
const xqThumbPainters = new WeakMap<HTMLElement, () => void>();

function ensureXqDiagramListener(): void {
  if (xqDiagramListenerInstalled) return;
  xqDiagramListenerInstalled = true;
  window.addEventListener(xiangqiAppearanceChangedEvent, () => {
    const set = readStoredXiangqiPieceSet();
    document.querySelectorAll<HTMLElement>('[data-xq-diagram]').forEach((holder) => {
      paintXqDiagram(holder, set);
    });
    document.querySelectorAll<HTMLElement>('[data-xq-thumb]').forEach((wrap) => {
      xqThumbPainters.get(wrap)?.();
    });
  });
}

function trackXqDiagram(holder: HTMLElement, thunk: () => string): void {
  holder.dataset.xqDiagram = '';
  xqDiagramThunks.set(holder, thunk);
  ensureXqDiagramListener();
}

// Shogi diagram repaint, the shogi twin of the xiangqi machinery above. Unlike
// xiangqi (board theme rides on CSS vars), the shogi board bakes its palette into
// the SVG, so BOTH the piece set and the board theme need a JS re-render — the
// thunk already reads both from storage, so the painter just re-runs it.
const shogiDiagramThunks = new WeakMap<HTMLElement, () => string>();
let shogiDiagramListenerInstalled = false;

function paintShogiDiagram(holder: HTMLElement): void {
  const thunk = shogiDiagramThunks.get(holder);
  if (!thunk) return;
  const caption =
    Array.from(holder.children).find((child) =>
      child.classList.contains('article-figure-caption'),
    ) ?? null;
  const scratch = document.createElement('div');
  scratch.innerHTML = thunk();
  holder.replaceChildren(...Array.from(scratch.childNodes), ...(caption ? [caption] : []));
}

function ensureShogiDiagramListener(): void {
  if (shogiDiagramListenerInstalled) return;
  shogiDiagramListenerInstalled = true;
  window.addEventListener(shogiAppearanceChangedEvent, () => {
    document.querySelectorAll<HTMLElement>('[data-shogi-diagram]').forEach(paintShogiDiagram);
  });
}

function trackShogiDiagram(holder: HTMLElement, thunk: () => string): void {
  holder.dataset.shogiDiagram = '';
  shogiDiagramThunks.set(holder, thunk);
  ensureShogiDiagramListener();
}

// Crossroads Chess is a hybrid: chess piece art and xiangqi disk art both come
// from the live appearance settings, and xiangqi changes also dispatch the
// board-appearance event. Re-run the thunk when either side of the hybrid piece
// set changes.
const crossroadsDiagramThunks = new WeakMap<HTMLElement, () => string>();
let crossroadsDiagramListenerInstalled = false;

function paintCrossroadsDiagram(holder: HTMLElement): void {
  const thunk = crossroadsDiagramThunks.get(holder);
  if (!thunk) return;
  const caption =
    Array.from(holder.children).find((child) =>
      child.classList.contains('article-figure-caption'),
    ) ?? null;
  const scratch = document.createElement('div');
  scratch.innerHTML = thunk();
  holder.replaceChildren(...Array.from(scratch.childNodes), ...(caption ? [caption] : []));
  markNoTranslate(holder);
}

const crossroadsThumbPainters = new WeakMap<HTMLElement, () => void>();

function ensureCrossroadsDiagramListener(): void {
  if (crossroadsDiagramListenerInstalled) return;
  crossroadsDiagramListenerInstalled = true;
  window.addEventListener(boardAppearanceChangedEvent, () => {
    document
      .querySelectorAll<HTMLElement>('[data-crossroads-diagram]')
      .forEach(paintCrossroadsDiagram);
    document.querySelectorAll<HTMLElement>('[data-crossroads-thumb]').forEach((wrap) => {
      crossroadsThumbPainters.get(wrap)?.();
    });
  });
}

function trackCrossroadsDiagram(holder: HTMLElement, thunk: () => string): void {
  holder.dataset.crossroadsDiagram = '';
  crossroadsDiagramThunks.set(holder, thunk);
  ensureCrossroadsDiagramListener();
  markNoTranslate(holder);
}

function localizeSvgMarkup(raw: string, lang?: ArticleLang): string {
  if (!lang) return raw;
  const template = document.createElement('template');
  template.innerHTML = raw;
  localizeInlineSvgText(template.content, lang);
  return template.innerHTML;
}

function localizeInlineSvgText(root: ParentNode, lang?: ArticleLang): void {
  if (!lang) return;
  root
    .querySelectorAll<SVGTextElement | SVGTitleElement | SVGDescElement>(
      'svg text, svg title, svg desc',
    )
    .forEach((node) => {
      const text = node.textContent;
      if (!text) return;
      node.textContent = translateArticleText(lang, text.trim());
    });
}

function renderImageFigureBlock(block: ImageFigureBlock): HTMLElement {
  const figure = document.createElement('figure');
  figure.className = 'article-figure article-figure-image';
  if (block.className) figure.classList.add(...block.className.split(/\s+/).filter(Boolean));
  const img = document.createElement('img');
  img.src = block.src;
  img.alt = block.alt;
  img.loading = 'lazy';
  // A real <button>, so the zoom is keyboard-reachable and announced, and so the
  // markup carries the affordance rather than a click handler that the prerender
  // cannot serialize. mountArticleLightbox wires the behaviour in the browser.
  const zoom = document.createElement('button');
  zoom.type = 'button';
  zoom.className = 'article-figure-zoom';
  zoom.append(img);
  figure.append(zoom);
  if (block.caption) {
    const cap = document.createElement('figcaption');
    cap.className = 'article-figure-caption';
    cap.textContent = block.caption;
    figure.append(cap);
  }
  return figure;
}

function renderRawSvgBlock(block: RawSvgBlock, lang?: ArticleLang): HTMLElement {
  const figure = document.createElement('figure');
  figure.className = 'article-figure article-figure-static';
  if (block.className) figure.classList.add(...block.className.split(/\s+/).filter(Boolean));
  if (typeof block.svg === 'function') {
    const rawSvg = block.svg;
    const svgThunk = () => localizeSvgMarkup(rawSvg(), lang);
    // Render once to detect the family (and seed the figure), then track for
    // re-render on that family's appearance event.
    figure.innerHTML = svgThunk();
    if (figure.querySelector('.shogi-board-svg')) {
      trackShogiDiagram(figure, svgThunk);
    } else if (figure.querySelector('.crossroads-live-svg, .crossroads-article-svg')) {
      trackCrossroadsDiagram(figure, svgThunk);
    } else {
      trackXqDiagram(figure, svgThunk);
      paintXqDiagram(figure, readStoredXiangqiPieceSet());
      if (figure.querySelector('.xq-article-svg')) {
        figure.classList.add('article-figure-xq');
      }
    }
  } else {
    figure.innerHTML = localizeSvgMarkup(block.svg, lang);
    if (figure.querySelector('.xq-article-svg')) {
      figure.classList.add('article-figure-xq');
      markXqDiagramsNoTranslate(figure);
    }
  }
  if (block.zoomable) {
    makeFigureZoomable(figure, block.caption ?? 'Figure');
  }
  if (block.caption) {
    const cap = document.createElement('figcaption');
    cap.className = 'article-figure-caption';
    cap.textContent = block.caption;
    figure.append(cap);
  }
  return figure;
}

// A row of raw-SVG figures. Each item goes through renderRawSvgBlock, so the
// per-family tracking (shogi / crossroads / xiangqi appearance re-render),
// localization and caption handling stay in ONE place; this only owns the
// layout wrapper.
function renderSvgRowBlock(block: SvgRowBlock, lang?: ArticleLang): HTMLElement {
  const row = document.createElement('div');
  row.className = 'article-figure-row';
  if (block.className) row.classList.add(...block.className.split(/\s+/).filter(Boolean));
  row.dataset.columns = String(block.items.length);
  for (const item of block.items) {
    row.append(renderRawSvgBlock({ kind: 'raw-svg', ...item }, lang));
  }
  if (block.caption) {
    const cap = document.createElement('p');
    cap.className = 'article-figure-caption article-figure-row-caption';
    cap.textContent = block.caption;
    row.append(cap);
  }
  return row;
}

function renderRawSvgStepperBlock(block: RawSvgStepperBlock, lang?: ArticleLang): HTMLElement {
  const figure = document.createElement('figure');
  figure.className = 'article-figure article-figure-interactive article-figure-raw-svg-stepper';

  const host = document.createElement('div');
  host.className = 'raw-svg-stepper stepper';
  host.tabIndex = 0;

  const frame = document.createElement('div');
  frame.className = 'raw-svg-stepper-frame';

  const controls = document.createElement('div');
  controls.className = 'stepper-controls';

  const prev = document.createElement('button');
  prev.type = 'button';
  prev.className = 'stepper-button stepper-button-prev';
  prev.setAttribute('aria-label', 'Previous step');
  prev.textContent = '←';

  const counter = document.createElement('span');
  counter.className = 'stepper-counter';

  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'stepper-button stepper-button-next';
  next.setAttribute('aria-label', 'Next step');
  next.textContent = '→';

  const narrative = document.createElement('div');
  narrative.className = 'stepper-narrative';

  controls.append(prev, counter, next);
  if (block.header) {
    const header = document.createElement('div');
    header.className = 'xq-replay-header';
    const players = document.createElement('div');
    players.textContent = block.header.players;
    const event = document.createElement('div');
    event.className = 'xq-replay-header-event';
    event.textContent = block.header.event;
    header.append(players, event);
    host.append(header);
  }
  host.append(frame, controls, narrative);
  figure.append(host);

  if (block.caption) {
    const cap = document.createElement('figcaption');
    cap.className = 'article-figure-caption';
    cap.textContent = block.caption;
    figure.append(cap);
  }

  let stepIdx = 0;

  function render(): void {
    const step = block.steps[stepIdx];
    if (!step) return;
    frame.innerHTML =
      typeof step.svg === 'function'
        ? localizeSvgMarkup(
            withXiangqiBoardLayout(readStoredXiangqiBoardLayout(), () =>
              withXiangqiPieceSet(readStoredXiangqiPieceSet(), step.svg as () => string),
            ),
            lang,
          )
        : localizeSvgMarkup(step.svg, lang);
    const hasXiangqiDiagram = Boolean(frame.querySelector('.xq-article-svg'));
    frame.classList.toggle('raw-svg-stepper-frame-xq', hasXiangqiDiagram);
    figure.classList.toggle('article-figure-xq', hasXiangqiDiagram);
    if (hasXiangqiDiagram) markXqDiagramsNoTranslate(frame);
    narrative.textContent = step.narrative ?? '';
    counter.textContent = `${stepIdx + 1} / ${block.steps.length}`;

    const willDisablePrev = stepIdx === 0;
    const willDisableNext = stepIdx === block.steps.length - 1;
    const focused = document.activeElement;
    if ((focused === prev && willDisablePrev) || (focused === next && willDisableNext)) {
      host.focus();
    }
    prev.disabled = willDisablePrev;
    next.disabled = willDisableNext;
  }

  function onPrev(): void {
    if (stepIdx <= 0) return;
    stepIdx -= 1;
    render();
  }

  function onNext(): void {
    if (stepIdx >= block.steps.length - 1) return;
    stepIdx += 1;
    render();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    switch (event.key) {
      case 'ArrowLeft':
      case 'q':
      case 'Q':
        event.preventDefault();
        onPrev();
        return;
      case 'ArrowRight':
      case 'e':
      case 'E':
        event.preventDefault();
        onNext();
        return;
    }
  }

  prev.addEventListener('click', onPrev);
  next.addEventListener('click', onNext);
  host.addEventListener('keydown', onKeyDown);
  render();

  // Reactive piece set: repaint the frame's current step when the picker
  // changes. render() already painted it; the global listener handles changes.
  if (block.steps.some((step) => typeof step.svg === 'function')) {
    trackXqDiagram(frame, () => {
      const step = block.steps[stepIdx];
      if (!step) return '';
      const raw = typeof step.svg === 'function' ? step.svg() : step.svg;
      return localizeSvgMarkup(raw, lang);
    });
  }

  return figure;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Minimal dark-theme tokenizer for the article's JSON and TypeScript blocks.
// One left-to-right pass: whichever token starts first wins, so words inside
// strings or comments are never re-tokenized. Run on already-escaped text.
const CODE_TOKEN =
  /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*"(?=\s*:))|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\b\d[\d_.eE+-]*\b)|\b(true|false|null|undefined)\b|\b(function|return|const|let|new|for|of|if|else|in|typeof|void)\b/g;

function highlightCode(text: string): string {
  return escapeHtml(text).replace(CODE_TOKEN, (m, comment, key, str, num, bool, kw) => {
    const cls = comment
      ? 'tok-comment'
      : key
        ? 'tok-key'
        : str
          ? 'tok-string'
          : num
            ? 'tok-number'
            : bool
              ? 'tok-bool'
              : kw
                ? 'tok-keyword'
                : '';
    return cls ? `<span class="${cls}">${m}</span>` : m;
  });
}

// A <dl> rather than heading/paragraph pairs: the questions are labels for their
// answers, not sections of the document, and keeping them out of the heading
// hierarchy stops them colonising the on-this-page rail. The prerender reads the
// same block to emit FAQPage JSON-LD, so the markup and the structured data can
// never describe different questions.
function renderFaqBlock(block: FaqBlock): HTMLElement {
  const list = document.createElement('dl');
  list.className = 'article-faq';
  for (const item of block.items) {
    const dt = document.createElement('dt');
    dt.className = 'article-faq-question';
    dt.textContent = item.question;
    const dd = document.createElement('dd');
    dd.className = 'article-faq-answer';
    dd.textContent = item.answer;
    list.append(dt, dd);
  }
  return list;
}

function renderTableBlock(block: TableBlock): HTMLElement {
  const figure = document.createElement('figure');
  figure.className = 'article-figure article-figure-table';
  const table = document.createElement('table');
  table.className = 'article-table';
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const h of block.headers) {
    const th = document.createElement('th');
    appendRichText(th, h);
    headRow.append(th);
  }
  thead.append(headRow);
  const tbody = document.createElement('tbody');
  const highlight = new Set(block.highlightRows ?? []);
  block.rows.forEach((row, i) => {
    const tr = document.createElement('tr');
    if (highlight.has(i)) tr.className = 'article-table-row-emphasis';
    for (const cell of row) {
      const td = document.createElement('td');
      // Cells take the same inline markdown as paragraphs. They rendered as raw
      // textContent until 2026-08-27, so a [label](/href) in a cell showed its
      // own brackets.
      appendRichText(td, cell);
      tr.append(td);
    }
    tbody.append(tr);
  });
  table.append(thead, tbody);
  figure.append(table);
  if (block.caption) {
    const cap = document.createElement('figcaption');
    cap.className = 'article-figure-caption';
    cap.textContent = block.caption;
    figure.append(cap);
  }
  return figure;
}

function renderCodeBlock(block: CodeBlock): HTMLElement {
  const figure = document.createElement('figure');
  figure.className = 'article-figure article-figure-code';
  const pre = document.createElement('pre');
  pre.className = 'article-code-block';
  if (block.language) pre.dataset.language = block.language;
  const code = document.createElement('code');
  code.innerHTML = highlightCode(block.text);
  pre.append(code);
  figure.append(pre);
  if (block.caption) {
    const cap = document.createElement('figcaption');
    cap.className = 'article-figure-caption';
    cap.textContent = block.caption;
    figure.append(cap);
  }
  return figure;
}

/** The slug of the article being read, for event attribution. */
function currentArticleSlug(): string {
  return document.querySelector('[data-article-slug]')?.getAttribute('data-article-slug') ?? '';
}

/**
 * An internal /blog or /rules link whose target is not visible in this build.
 * A draft's URL 404s in production, so a published page linking to one ships a
 * dead button; in dev everything is visible, so the link renders and can be
 * reviewed. This is what lets a piece carry a link to its companion before the
 * companion publishes: the button appears when the target does.
 */
function pointsAtHiddenArticle(href: string): boolean {
  const match = /^\/(blog|rules)\/([^/?#]+)/.exec(href);
  if (!match) return false;
  const target = articles.find((a) => a.slug === decodeURIComponent(match[2] as string));
  if (!target) return false;
  return !isArticleVisibleInThisEnv(target);
}

/** What a CTA actually offers the reader: a game, or another page. */
function ctaKindForHref(href: string): 'play' | 'nav' {
  return /[?&]play=/.test(href) ? 'play' : 'nav';
}

/** The play row on a rules page.
 *
 *  Rules pages are where search traffic lands (they are the pages that rank),
 *  and until this existed 22 of them, including every flagship variant, had no
 *  path to a board at all: a reader who arrived on /rules/banqi wanting to play
 *  banqi had to find "Play" in the nav, land back on the homepage, and pick the
 *  variant again from scratch. The play CTA was an authored body block, so it
 *  was present only where someone had remembered to add one.
 *
 *  Whether a bot is offered comes from `variantSupportsPve`, the same helper the
 *  play dialog uses, so this row can never advertise an opponent the dialog then
 *  fails to provide. Variants with no bot get the friend link alone rather than
 *  a dead "play the computer".
 */
function buildRulesPlayCta(slug: string, title: string, locale: Locale): HTMLElement | null {
  const gameSpecId = gameSpecIdFromRulesSlug(slug);
  if (!gameSpecId) return null;
  if (!rulesSlugPublicSurfaceEnabled(slug)) return null;

  const game = variantNavLabel(title);
  const row = document.createElement('div');
  row.className = 'article-cta-row article-play-cta';

  const buttons: { label: string; href: string; emphasis: 'primary' | 'secondary' }[] = [];
  const spec = encodeURIComponent(gameSpecId);
  if (variantSupportsPve(gameSpecId)) {
    buttons.push({
      label: t('articles.playThisGame', { game }, locale),
      href: `/?play=computer&gameSpecId=${spec}`,
      emphasis: 'primary',
    });
    buttons.push({
      label: t('articles.playAFriend', {}, locale),
      href: `/?play=friend&gameSpecId=${spec}`,
      emphasis: 'secondary',
    });
  } else {
    buttons.push({
      label: t('articles.playThisGame', { game }, locale),
      href: `/?play=friend&gameSpecId=${spec}`,
      emphasis: 'primary',
    });
  }

  for (const btn of buttons) {
    const a = document.createElement('a');
    a.className = `article-cta article-cta-${btn.emphasis}`;
    a.href = btn.href;
    a.textContent = btn.label;
    a.addEventListener('click', () => {
      track('article_cta_clicked', {
        slug,
        label: btn.label,
        href: btn.href,
        emphasis: btn.emphasis,
        kind: 'play',
        placement: 'rules-header',
      });
    });
    row.append(a);
  }
  return row;
}

function renderCtaBlock(block: CtaBlock): HTMLElement {
  const row = document.createElement('div');
  row.className = 'article-cta-row';
  if (block.layout) row.classList.add(`article-cta-row-${block.layout}`);
  for (const btn of block.buttons) {
    if (pointsAtHiddenArticle(btn.href)) continue;
    const a = document.createElement('a');
    a.className = `article-cta article-cta-${btn.emphasis ?? 'primary'}`;
    a.href = btn.href;
    a.textContent = btn.label;
    if (btn.external) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
    // Article CTAs were the one conversion step on these pages with no signal
    // at all: navigation to another route fires its own pageview, but nothing
    // said which article sent the reader or which button they took.
    //
    // `kind` splits the two things this event was conflating. Most authored CTA
    // blocks are cross-links to another article ("Back to all rules"), and
    // counting those beside the handful that open the play dialog made the
    // event's conversion rate meaningless: it read as "CTA clickers convert at
    // 89%" when the denominator was mostly navigation.
    a.addEventListener('click', () => {
      track('article_cta_clicked', {
        slug: currentArticleSlug(),
        label: btn.label,
        href: btn.href,
        emphasis: btn.emphasis ?? 'primary',
        kind: ctaKindForHref(btn.href),
      });
    });
    row.append(a);
  }
  return row;
}

function subHeadingNode(block: SubHeadingBlock): HTMLHeadingElement {
  const h3 = document.createElement('h3');
  h3.className = 'article-sub-heading';
  h3.textContent = block.text;
  return h3;
}

function paragraphNode(text: string): HTMLParagraphElement {
  const p = document.createElement('p');
  p.className = 'article-paragraph';
  appendRichText(p, text);
  return p;
}

// Lightweight inline parser. Recognizes Markdown-style `code`, [text](href) for
// links, and **text** for bold. External link hrefs (http/https) open in a new
// tab; internal hrefs (/foo, #foo) do not. Anything that isn't a recognized
// token is appended as a plain text node.
const INLINE_REGEX = /`([^`\n]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;
function appendRichText(el: HTMLElement, text: string): void {
  let lastIndex = 0;
  for (const match of text.matchAll(INLINE_REGEX)) {
    const start = match.index ?? 0;
    if (start > lastIndex) el.append(text.slice(lastIndex, start));
    if (match[1] !== undefined) {
      const code = document.createElement('code');
      code.textContent = match[1];
      el.append(code);
    } else if (match[2] !== undefined) {
      const strong = document.createElement('strong');
      strong.textContent = match[2];
      el.append(strong);
    } else {
      const linkText = match[3]!;
      const href = match[4]!;
      const a = document.createElement('a');
      a.href = href;
      a.textContent = linkText;
      if (/^https?:\/\//.test(href)) {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      }
      el.append(a);
    }
    lastIndex = start + match[0].length;
  }
  if (lastIndex < text.length) el.append(text.slice(lastIndex));
}

function renderInteractiveBlock(block: InteractiveBlock): HTMLElement {
  const figure = document.createElement('figure');
  figure.className = 'article-figure article-figure-interactive';
  figure.dataset.pendingWidget = block.widget;

  const mountTarget = document.createElement('div');
  mountTarget.className = 'article-interactive-target';
  figure.append(mountTarget);

  if (block.caption) {
    const cap = document.createElement('figcaption');
    cap.className = 'article-figure-caption';
    cap.textContent = block.caption;
    figure.append(cap);
  }

  rememberPendingMount(figure, block);
  return figure;
}

export function mountPendingWidgets(
  root: HTMLElement,
): Array<
  | StepperController
  | LiveBoardsController
  | XiangqiReplayController
  | ChessReplayController
  | MiniXiangqiReplayController
  | DropMiniXiangqiReplayController
  | FortressXiangqiReplayController
  | DuckXiangqiReplayController
  | ShogiReplayController
  | CrossroadsChessReplayController
  | JieqiReplayController
  | BanqiReplayController
  | JungleReplayController
  | JungleFlipReplayController
> {
  const controllers: Array<
    | StepperController
    | LiveBoardsController
    | XiangqiReplayController
    | ChessReplayController
    | MiniXiangqiReplayController
    | DropMiniXiangqiReplayController
    | ShogiReplayController
    | CrossroadsChessReplayController
    | JieqiReplayController
    | BanqiReplayController
    | JungleReplayController
    | JungleFlipReplayController
  > = [];
  const pending = root.querySelectorAll<HTMLElement>('[data-pending-widget]');
  pending.forEach((figure) => {
    const pendingMount = pendingMounts.get(figure);
    if (!pendingMount) return;
    const { block, lang } = pendingMount;
    const target = figure.querySelector<HTMLElement>('.article-interactive-target');
    if (!target) return;
    if (block.kind === 'interactive' && block.widget === 'stepper') {
      controllers.push(mountSteppedBoards(target, block.spec));
    } else if (block.kind === 'live-boards') {
      controllers.push(mountLiveBoards(target, block.spec));
    } else if (block.kind === 'xq-replay') {
      controllers.push(mountXiangqiReplay(target, block.spec, { lang }));
    } else if (block.kind === 'mxq-replay') {
      controllers.push(mountMiniXiangqiReplay(target, block.spec, { lang }));
    } else if (block.kind === 'drop-mini-xiangqi-replay') {
      controllers.push(mountDropMiniXiangqiReplay(target, block.spec, { lang }));
    } else if (block.kind === 'fortress-xiangqi-replay') {
      controllers.push(mountFortressXiangqiReplay(target, block.spec, { lang }));
    } else if (block.kind === 'duck-xiangqi-replay') {
      controllers.push(mountDuckXiangqiReplay(target, block.spec, { lang }));
    } else if (block.kind === 'shogi-replay') {
      controllers.push(mountShogiReplay(target, block.spec, { lang }));
    } else if (block.kind === 'chess-replay') {
      controllers.push(mountChessReplay(target, block.spec, { lang }));
    } else if (block.kind === 'crossroads-replay') {
      controllers.push(mountCrossroadsChessReplay(target, block.spec, { lang }));
    } else if (block.kind === 'jieqi-replay') {
      controllers.push(mountJieqiReplay(target, block.spec, { lang }));
    } else if (block.kind === 'banqi-replay') {
      controllers.push(mountBanqiReplay(target, block.spec, { lang }));
    } else if (block.kind === 'jungle-replay') {
      controllers.push(mountJungleReplay(target, block.spec, { lang }));
    } else if (block.kind === 'jungle-flip-replay') {
      controllers.push(mountJungleFlipReplay(target, block.spec, { lang }));
    }
    pendingMounts.delete(figure);
    delete figure.dataset.pendingWidget;
  });
  return controllers;
}

function renderStaticBoardsBlock(block: StaticBoardsBlock): HTMLElement {
  const figure = document.createElement('figure');
  figure.className = 'article-figure article-figure-static';

  const inner = renderBoardComposition({
    layout: block.layout,
    boards: block.boards,
    canvasWidth: block.canvasWidth,
    boardY: block.boardY,
    boardSize: block.boardSize,
    gap: block.gap,
    labelY: block.labelY,
    labelFill: block.labelFill,
    labelFontSize: block.labelFontSize,
    labelLetterSpacing: block.labelLetterSpacing,
  });

  const bg = block.background ?? 'transparent';
  const bgRect =
    bg === 'transparent'
      ? ''
      : `<rect width="${block.canvasWidth}" height="${block.canvasHeight}" fill="${bg}"/>`;
  figure.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${block.canvasWidth} ${block.canvasHeight}" width="100%" preserveAspectRatio="xMidYMid meet" role="img">${bgRect}${inner}</svg>`;

  if (block.caption) {
    const cap = document.createElement('figcaption');
    cap.className = 'article-figure-caption';
    cap.textContent = block.caption;
    figure.append(cap);
  }
  return figure;
}

// Article thumbnails are bound to chessground after the index lands in the
// DOM (chessground needs the host sized to render correctly). We stash the
// spec on each pending wrap and consume it in mountArticleThumbnails.
const pendingThumbnails = new WeakMap<HTMLElement, ArticleThumbnail>();

function articleCard(
  baseArticle: Article,
  lang?: ArticleLang,
  // The star is an index affordance: one per card in a long grid, repeating
  // often enough that it reads as texture. Three of them in a row at the foot
  // of an article read as a rating or a "featured" mark instead, and they are
  // neither, so the footer opts out rather than hiding them in CSS.
  options: { showStarBadge?: boolean } = {},
): HTMLLIElement {
  const locale = articleLocale(lang);
  const articleLang = publishedArticleLang(baseArticle.slug, lang);
  const article = articleLang ? translateArticle(baseArticle, articleLang) : baseArticle;
  const item = document.createElement('li');
  item.className = 'articles-index-item';

  const link = document.createElement('a');
  link.className = 'articles-index-card';
  link.href = localizedArticleHref(article, locale);

  const thumb = document.createElement('div');
  thumb.className = 'articles-index-card-media';
  const mini = renderVariantMiniThumb(article.slug);
  if (mini) {
    thumb.append(mini);
  } else if (article.thumbnail) {
    thumb.append(renderArticleThumbnail(article.thumbnail));
  } else {
    thumb.classList.add('is-empty');
  }

  const dateIso = article.publishedAt ?? article.updatedAt;
  if (dateIso) {
    const date = document.createElement('span');
    date.className = 'articles-index-card-over-image articles-index-card-date';
    date.textContent = formatCardDate(dateIso, locale);
    thumb.append(date);
  }

  if (options.showStarBadge ?? true) {
    thumb.append(articleCardStarBadge('articles-index-card-over-image articles-index-card-author'));
  }

  if (isArticleStatusBadge(article.status)) {
    const badge = document.createElement('span');
    badge.className = `article-status-badge article-status-${article.status} articles-index-card-status`;
    badge.textContent = t(ARTICLE_STATUS_KEYS[article.status], {}, locale);
    thumb.append(badge);
  }

  const body = document.createElement('div');
  body.className = 'articles-index-card-body';

  const title = document.createElement('strong');
  title.className = 'articles-index-card-title';
  title.textContent = article.title;

  const summary = document.createElement('p');
  summary.className = 'articles-index-card-summary';
  summary.textContent = article.summary;

  body.append(title, summary);

  link.append(thumb, body);
  item.append(link);
  return item;
}

export function renderArticleThumbnail(thumb: ArticleThumbnail): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'articles-index-card-thumb';
  wrap.setAttribute('aria-hidden', 'true');
  if (thumb.kind === 'svg') {
    markNoTranslate(wrap);
    const applySvg = (raw: string): void => {
      const template = document.createElement('template');
      template.innerHTML = raw.trim();
      const svg = template.content.firstElementChild;
      if (svg instanceof SVGSVGElement) {
        markNoTranslate(svg);
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', '100%');
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        svg.style.display = 'block';
        wrap.replaceChildren(svg);
      }
    };
    if (typeof thumb.svg === 'function') {
      const svgThunk = thumb.svg;
      const first = svgThunk();
      if (first.includes('crossroads-live-svg') || first.includes('crossroads-article-svg')) {
        const paint = () => applySvg(svgThunk());
        applySvg(first);
        wrap.dataset.crossroadsThumb = '';
        crossroadsThumbPainters.set(wrap, paint);
        ensureCrossroadsDiagramListener();
      } else {
        const paint = () =>
          applySvg(
            withXiangqiBoardLayout(readStoredXiangqiBoardLayout(), () =>
              withXiangqiPieceSet(readStoredXiangqiPieceSet(), svgThunk),
            ),
          );
        paint();
        wrap.dataset.xqThumb = '';
        xqThumbPainters.set(wrap, paint);
        ensureXqDiagramListener();
      }
    } else {
      applySvg(thumb.svg);
    }
    return wrap;
  }
  if (thumb.kind === 'image') {
    const img = document.createElement('img');
    img.src = thumb.src;
    img.alt = thumb.alt ?? '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    img.style.display = 'block';
    wrap.replaceChildren(img);
    return wrap;
  }
  const board = document.createElement('div');
  board.className = 'articles-thumb-board cg-wrap';
  wrap.append(board);
  pendingThumbnails.set(board, thumb);
  return wrap;
}

// Variant rules articles whose rail/landing thumbnail is the shared variant
// marker. Base-game articles map to their no-fog markers so the whole rail
// reads in one visual language.
const VARIANT_MINI_BY_SLUG: Record<string, VariantMiniId> = {
  chess: 'chess',
  'fog-chess': 'dark-chess',
  'dark-draft960': 'draft960',
  xiangqi: 'xiangqi',
  'fog-xiangqi': 'dark-xiangqi',
  'mini-xiangqi': 'mini-xiangqi',
  'dark-mini-xiangqi': 'dark-mini-xiangqi',
  'drop-mini-xiangqi': 'drop-mini-xiangqi',
  'fortress-xiangqi': 'fortress-xiangqi',
  'duck-xiangqi': 'duck-xiangqi',
  jieqi: 'jieqi',
  banqi: 'banqi',
  'crossroads-chess': 'crossroads',
  'dark-crossroads-chess': 'dark-crossroads',
  kriegspiel: 'kriegspiel',
  'reveal-chess': 'reveal-chess',
  shogi: 'shogi',
  'dark-shogi': 'dark-shogi',
  'dark-crazyhouse': 'dark-crazyhouse',
  jungle: 'jungle',
  'jungle-flip': 'jungle-flip',
};

// A rail/landing thumbnail rendered as the variant's marker, or null if the
// slug has no mini (caller falls back to the article's own thumbnail).
function renderVariantMiniThumb(slug: string): HTMLElement | null {
  const miniId = VARIANT_MINI_BY_SLUG[slug];
  if (!miniId) return null;
  const wrap = document.createElement('div');
  wrap.className = hasFinalVariantMarker(miniId)
    ? 'articles-index-card-thumb variant-mini-thumb variant-marker-thumb'
    : 'articles-index-card-thumb variant-mini-thumb';
  wrap.setAttribute('aria-hidden', 'true');
  markNoTranslate(wrap);
  wrap.innerHTML = renderVariantMarker(miniId, { size: 100 });
  const marker = wrap.firstElementChild;
  if (marker instanceof HTMLElement) {
    marker.style.display = 'block';
  }
  return wrap;
}

export function mountArticleThumbnails(root: HTMLElement): ThumbnailBoardController[] {
  const controllers: ThumbnailBoardController[] = [];
  const hosts = root.querySelectorAll<HTMLElement>('.articles-thumb-board.cg-wrap');
  hosts.forEach((host) => {
    const thumb = pendingThumbnails.get(host);
    if (!thumb) return;
    if (thumb.kind === 'svg' || thumb.kind === 'image') return;
    const orientation = thumb.orientation ?? 'white';
    const isSplitFog = Boolean(thumb.splitFogSquares);
    const controller = mountThumbnailBoard(host, {
      board: piecesToBoard(thumb.pieces),
      fogSquares: thumb.splitFogSquares
        ? splitFogSquaresForThumbnail(thumb.splitFogSquares, orientation)
        : thumb.fogSquares,
      orientation,
    });
    if (isSplitFog) markSplitFogDivider(host);
    controllers.push(
      isSplitFog
        ? {
            destroy(): void {
              unmarkSplitFogDivider(host);
              controller.destroy();
            },
          }
        : controller,
    );
    pendingThumbnails.delete(host);
  });
  return controllers;
}

function markSplitFogDivider(host: HTMLElement): void {
  host.querySelector<HTMLElement>('cg-container')?.classList.add('article-thumb-split-board');
}

function unmarkSplitFogDivider(host: HTMLElement): void {
  host.querySelector<HTMLElement>('cg-container')?.classList.remove('article-thumb-split-board');
}

function splitFogSquaresForThumbnail(
  fogSquares: { left: Square[]; right: Square[] },
  orientation: Color,
): Square[] {
  const leftFog = new Set<Square>(fogSquares.left);
  const rightFog = new Set<Square>(fogSquares.right);
  const splitFog: Square[] = [];

  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const square = squareFromVisualPosition(col, row, orientation);
      const sideFog = col < 4 ? leftFog : rightFog;
      if (sideFog.has(square)) splitFog.push(square);
    }
  }

  return splitFog;
}

function squareFromVisualPosition(col: number, row: number, orientation: Color): Square {
  const fileIdx = orientation === 'white' ? col : 7 - col;
  const rankIdx = orientation === 'white' ? 7 - row : row;
  return `${String.fromCharCode('a'.charCodeAt(0) + fileIdx)}${rankIdx + 1}` as Square;
}

function buildArticleNotFound(locale: Locale = currentLocale()): HTMLElement {
  const main = document.createElement('main');
  main.className = 'site-section article-page';
  const heading = document.createElement('h1');
  heading.className = 'site-section-heading';
  heading.textContent = t('articles.notFoundTitle', {}, locale);
  const body = document.createElement('p');
  body.textContent = t('articles.notFoundBody', {}, locale);
  const back = document.createElement('p');
  const backLink = document.createElement('a');
  backLink.href = localizedHref('/blog', locale);
  backLink.textContent = `← ${t('articles.allArticles', {}, locale)}`;
  back.append(backLink);
  main.append(heading, body, back);
  return main;
}
