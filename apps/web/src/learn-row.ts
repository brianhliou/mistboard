// Homepage learn row (band 4, beneath the blog row): eight first-party cards
// that walk a visitor from "never played" to "wants more", one card per
// editorial role. It replaced the curated video strip on 2026-09-16.
//
// The video strip had the same roles (rules primer, first tactics, openings, a
// famous game, culture) but filled seven of its eight slots with other
// channels' YouTube videos. Two months live, it had no click instrument, /videos
// drew 27 pageviews in 90 days, and the row was omitted outright for viewers
// where YouTube is blocked (#378), so the mainland audience got a shorter
// homepage. Every card here points at a page on this site, so the row renders
// for everyone and every click is measurable. The one exception is our own
// episode (card 1), which is dropped, not the row, where YouTube is blocked.
//
// Fixed order, no shuffle: the arc is a sequence a new player can walk left to
// right. The video row shuffled because the tail cards were never reached; here
// the tail is "play the bot" and "the manuals", which is exactly where the walk
// should end, so the order carries meaning.
//
// Cards 2, 5 and 8 get better without touching this file as the head-term
// pages land: /rules/xiangqi becomes the how-to-play rebuild (#410), the
// openings card moves from the analysis board's explorer tab to the openings
// hub (#411), and the champions article becomes the champions pages (#412).

import {
  applyMove as applyXiangqiMove,
  parseStandardXiangqiFen,
  type XiangqiMove,
} from '@mistboard/game';
import { track } from './analytics.js';
import { xiangqiArticle } from './articles/content/xiangqi.js';
import { xiangqiChampionsArticle } from './articles/content/xiangqi-champions.js';
import {
  XQ_BOARD_H,
  XQ_BOARD_W,
  XQ_PRIMER_HORSE_OPEN,
  XQ_START,
  xqArrowLayer,
  xqBoardGrid,
  xqDots,
  xqMoveDots,
  xqPiecesLayer,
  xqSvg,
  xqVisionDemoState,
} from './articles/diagrams.js';
import type { ArticleThumbnail } from './articles/types.js';
import { renderArticleThumbnail } from './articles.js';
import { t } from './i18n/catalog.js';
import { currentLocale, type Locale, localizedHref } from './i18n/locale.js';
import { YOUTUBE_BLOCKED_IN } from './nav-items.js';
import {
  FIRST_PARTY_VIDEOS,
  type VideoEntry,
  videoThumbUrl,
  videoWatchUrl,
} from './videos-data.js';
import { isBlockedForViewer } from './viewer-geo.js';

// The editorial roles, in walk order. Exported so the test can assert the arc
// is complete and in order without re-deriving it from the DOM.
export const LEARN_ROLES = [
  'video',
  'rules',
  'lessons',
  'puzzles',
  'openings',
  'play',
  'manuals',
  'champions',
] as const;
export type LearnRole = (typeof LEARN_ROLES)[number];

// 心武残编, the first classical manual made public (2026-09-15).
export const LEARN_MANUAL_STUDY_ID = '9AVw9eEJ';

// Its chapter 1, 七星聚会 (Seven Stars Rejoice Together), the best-known of the
// four great Qing compositions and the position the study opens on. Baked here
// rather than fetched: the list API only knows it where the study exists, and a
// front-door card cannot show an empty frame on a dev pair or a cold cache.
export const LEARN_MANUAL_FEN = '4rk3/3P5/4bP3/9/9/8P/9/1p2p2C1/3p1p3/4K1RR1 r - - 0 1';

type LearnCard = {
  role: LearnRole;
  /** Site-relative path; localized per visitor at render time. */
  href: string;
  thumbnail: ArticleThumbnail | null;
};

// ── Diagrams ─────────────────────────────────────────────────────────────────
// Thumbnails are board diagrams from the article pipeline, so they follow the
// reader's piece set and board layout like the blog row's do. Each is a thunk:
// renderArticleThumbnail re-runs it when the appearance changes.

function boardThumb(body: string): ArticleThumbnail {
  return { kind: 'svg', svg: () => xqSvg(XQ_BOARD_W, XQ_BOARD_H, body) };
}

// A lone horse and its eight destinations: the first thing the lessons teach.
const LESSONS_THUMBNAIL = boardThumb(
  [
    xqBoardGrid(0, 0, 'red'),
    xqMoveDots(xqDots(['c4', 'c6', 'd3', 'd7', 'f3', 'f7', 'g4', 'g6']), 0, 0, 'red'),
    xqPiecesLayer(XQ_PRIMER_HORSE_OPEN, null, 0, 0, 'red'),
  ].join(''),
);

// 马后炮 (horse-behind-cannon), the mate every xiangqi player learns first.
// Red's horse on d8 checks the general on e10 (leg d9 is empty); the cannon on
// e4 checks it too through the horse on e7. A double check cannot be blocked,
// e9 is on the cannon's line, and both advisors fill the other flight squares.
const PUZZLES_STATE = xqVisionDemoState('learn-row-puzzles', {
  e10: { color: 'black', role: 'general' },
  d10: { color: 'black', role: 'advisor' },
  f10: { color: 'black', role: 'advisor' },
  g10: { color: 'black', role: 'elephant' },
  d8: { color: 'red', role: 'horse' },
  e7: { color: 'red', role: 'horse' },
  e4: { color: 'red', role: 'cannon' },
  e1: { color: 'red', role: 'general' },
});
const PUZZLES_THUMBNAIL = boardThumb(
  [
    xqBoardGrid(0, 0, 'red'),
    xqPiecesLayer(PUZZLES_STATE, null, 0, 0, 'red'),
    xqArrowLayer(
      [
        { from: 'd8', to: 'e10' },
        { from: 'e4', to: 'e10' },
      ],
      0,
      0,
      'red',
    ),
  ].join(''),
);

// The most played opening in the game: central cannon (炮二平五) answered by the
// screen horse (马8进7). Drawn from the start position by applying the moves, so
// the diagram cannot disagree with the rules engine about where the pieces go.
const OPENING_MOVES: readonly XiangqiMove[] = [
  { from: 'h3', to: 'e3' },
  { from: 'h10', to: 'g8' },
];
const OPENINGS_STATE = OPENING_MOVES.reduce((state, move) => {
  const next = applyXiangqiMove(state, move);
  if (next === state) throw new Error(`illegal learn-row opening move ${move.from}-${move.to}`);
  return next;
}, XQ_START);
const OPENINGS_THUMBNAIL = boardThumb(
  [
    xqBoardGrid(0, 0, 'red'),
    xqPiecesLayer(OPENINGS_STATE, null, 0, 0, 'red'),
    xqArrowLayer([...OPENING_MOVES], 0, 0, 'red'),
  ].join(''),
);

// The start position from the side the bot gives a first-timer: red, moving
// first.
const PLAY_THUMBNAIL = boardThumb(
  [xqBoardGrid(0, 0, 'red'), xqPiecesLayer(XQ_START, null, 0, 0, 'red')].join(''),
);

export function manualThumbnailFromFen(fen: string): ArticleThumbnail | null {
  const parsed = parseStandardXiangqiFen(fen, 'learn-row-manual');
  if (!parsed.ok) return null;
  const state = parsed.state;
  return boardThumb([xqBoardGrid(0, 0, 'red'), xqPiecesLayer(state, null, 0, 0, 'red')].join(''));
}
const MANUALS_THUMBNAIL = manualThumbnailFromFen(LEARN_MANUAL_FEN);
if (!MANUALS_THUMBNAIL) throw new Error('learn-row: LEARN_MANUAL_FEN does not parse');

const LEARN_CARDS: readonly LearnCard[] = [
  { role: 'video', href: '', thumbnail: null },
  { role: 'rules', href: '/rules/xiangqi', thumbnail: xiangqiArticle.thumbnail ?? null },
  { role: 'lessons', href: '/learn/xiangqi', thumbnail: LESSONS_THUMBNAIL },
  { role: 'puzzles', href: '/puzzles', thumbnail: PUZZLES_THUMBNAIL },
  { role: 'openings', href: '/analysis/xiangqi', thumbnail: OPENINGS_THUMBNAIL },
  { role: 'play', href: '/?play=computer&gameSpecId=xiangqi', thumbnail: PLAY_THUMBNAIL },
  { role: 'manuals', href: `/study/${LEARN_MANUAL_STUDY_ID}`, thumbnail: MANUALS_THUMBNAIL },
  {
    role: 'champions',
    href: '/blog/xiangqi-champions',
    thumbnail: xiangqiChampionsArticle.thumbnail ?? null,
  },
];

// Our newest episode. FIRST_PARTY_VIDEOS is newest-first; an empty list (there
// is none yet in a fresh checkout of the data) drops the card rather than the
// row.
function firstPartyVideo(): VideoEntry | null {
  if (isBlockedForViewer(YOUTUBE_BLOCKED_IN)) return null;
  return FIRST_PARTY_VIDEOS[0] ?? null;
}

// The paths the row links to, for the route-coverage test. The video card is
// external and the play card is a query on `/`, so neither is listed.
export function learnRowRoutes(): string[] {
  return LEARN_CARDS.map((card) => card.href).filter(
    (href) => href !== '' && !href.startsWith('/?'),
  );
}

export interface LearnRowOptions {
  locale?: Locale;
}

// Builds the row: the same `.landing-carousel` structure as the blog strip, so
// initLandingCarousel drives it and the CSS pairs the two rows. Never null: the
// blocked-YouTube case drops one card, and the grid no longer has to handle a
// missing band.
export function buildHomeLearnRow(options: LearnRowOptions = {}): HTMLElement {
  const locale = options.locale ?? currentLocale();
  const section = document.createElement('section');
  section.className = 'landing-learn';
  section.setAttribute('aria-label', t('home.learn.heading', {}, locale));

  const carousel = document.createElement('div');
  carousel.className = 'landing-carousel';
  const trackEl = document.createElement('div');
  trackEl.className = 'landing-carousel-track';

  const video = firstPartyVideo();
  for (const card of LEARN_CARDS) {
    if (card.role === 'video') {
      if (video) trackEl.append(learnVideoCard(video, locale));
      continue;
    }
    trackEl.append(learnCard(card, locale));
  }

  const prev = navButton('prev', '‹', locale);
  const next = navButton('next', '›', locale);
  carousel.append(prev, trackEl, next);
  section.append(carousel);
  return section;
}

function cardShell(role: LearnRole, href: string, locale: Locale): HTMLAnchorElement {
  const link = document.createElement('a');
  link.className = 'landing-article-card landing-learn-card';
  link.dataset.cardKind = 'learn';
  link.dataset.learnRole = role;
  link.href = href;
  // The row's only signal. Pageviews on the target page cannot tell a card
  // click from the nav, and the video row shipped without this for two months.
  link.addEventListener('click', () => {
    track('learn_card_clicked', { role, href, locale });
  });
  return link;
}

function cardText(link: HTMLAnchorElement, role: LearnRole, locale: Locale): void {
  const title = document.createElement('strong');
  title.className = 'landing-article-card-title landing-learn-card-title';
  title.textContent = t(`home.learn.${role}.title`, {}, locale);
  const blurb = document.createElement('span');
  blurb.className = 'landing-learn-card-blurb';
  blurb.textContent = t(`home.learn.${role}.blurb`, {}, locale);
  link.append(title, blurb);
}

function learnCard(card: LearnCard, locale: Locale): HTMLElement {
  const link = cardShell(card.role, localizedHref(card.href, locale), locale);
  const thumb = document.createElement('div');
  thumb.className = 'landing-article-card-thumb landing-learn-card-thumb';
  if (card.thumbnail) thumb.append(renderArticleThumbnail(card.thumbnail));
  else thumb.classList.add('is-empty');
  link.append(thumb);
  cardText(link, card.role, locale);
  return link;
}

// The video card keeps the video grammar (still, play glyph, duration,
// Mistboard badge) inside the learn card frame. It opens YouTube in a new tab
// like every external card on /videos.
function learnVideoCard(video: VideoEntry, locale: Locale): HTMLElement {
  const link = cardShell('video', videoWatchUrl(video), locale);
  link.classList.add('landing-video-card');
  if (video.source === 'youtube') {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }

  const thumb = document.createElement('div');
  thumb.className = 'landing-article-card-thumb landing-learn-card-thumb landing-video-card-thumb';
  const img = document.createElement('img');
  img.className = 'landing-video-card-img';
  img.src = videoThumbUrl(video);
  img.alt = '';
  img.loading = 'lazy';
  thumb.append(img);

  const play = document.createElement('span');
  play.className = 'landing-video-card-play';
  play.setAttribute('aria-hidden', 'true');
  play.textContent = '▶';
  thumb.append(play);

  if (video.durationMinutes !== undefined) {
    const duration = document.createElement('span');
    duration.className = 'landing-video-card-duration';
    duration.textContent = t('videos.duration', { count: video.durationMinutes }, locale);
    thumb.append(duration);
  }

  const badge = document.createElement('span');
  badge.className = 'landing-video-card-badge';
  badge.textContent = t('videos.badge.mistboard', {}, locale);
  thumb.append(badge);

  link.append(thumb);
  cardText(link, 'video', locale);
  return link;
}

function navButton(dir: 'prev' | 'next', glyph: string, locale: Locale): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `landing-carousel-nav landing-carousel-nav-${dir}`;
  button.setAttribute(
    'aria-label',
    t(dir === 'prev' ? 'home.learn.previous' : 'home.learn.more', {}, locale),
  );
  button.textContent = glyph;
  return button;
}
