// A blog card's art as one self-contained SVG, for the feed thumbnail
// (/thumb/article/<slug>.png, rasterised by the server's resvg). The prerender
// writes one per live post to dist/thumb/article/<slug>.svg; the feeds link the
// PNG with <media:content>.
//
// The card's art is styled by the site's stylesheets: diagram classes take
// their board colour, grid ink and title colour from CSS, and some attributes
// carry `var(--token, fallback)`. resvg has neither the stylesheets nor CSS
// variables (an unstyled <rect> renders black), so this module bakes both in:
// a <style> block that mirrors the card rules with the dark theme's values
// (brianhliou.com, the one reader of these images, shows the dark card), and a
// pass that resolves every var() to that theme's value or its fallback.
//
// FEED_THUMB_STYLED_CLASSES and FEED_THUMB_UNPAINTED_CLASSES together list
// every class a live card may carry; feed-thumbnail.test.ts fails on a class in
// neither, so new card art that is painted by a stylesheet rule cannot ship a
// black feed thumbnail unseen.

import {
  type BoardSpec,
  fogPatternDefs,
  type PieceOnBoard,
  renderBoardSvg,
} from '@mistboard/board-render';
import { withXiangqiBoardLayout, withXiangqiPieceSet } from './diagrams.js';
import type { Article, ArticleThumbnail } from './types.js';

export const FEED_THUMB_WIDTH = 480;
export const FEED_THUMB_HEIGHT = 300;

// The dark card's tokens (app-base.css `:root[data-effective-theme="dark"]`,
// and the board tokens, which no site theme changes).
const TOKENS: Readonly<Record<string, string>> = {
  '--site-text': 'hsl(0, 0%, 73%)',
  '--site-heading': 'hsl(0, 0%, 82%)',
  '--site-muted': 'hsl(0, 0%, 58%)',
  '--site-panel': 'hsl(40, 7%, 14%)',
  '--site-panel-soft': 'hsl(40, 5%, 19%)',
  '--site-border': 'hsl(40, 4%, 25%)',
  '--site-border-soft': 'hsl(40, 4%, 21%)',
  '--site-accent': 'hsl(165, 44%, 45%)',
  '--site-on-accent': '#ffffff',
  '--xq-board-bg': '#f5dca8',
  '--xq-board-ink': '#5a3a14',
  '--xq-diagram-bg': '#f5dca8',
  '--xq-diagram-ink': '#5a3a14',
  '--xq-diagram-palace-band': 'rgba(255, 255, 255, 0)',
  '--xq-diagram-fog': 'rgba(36, 25, 15, 0.55)',
  '--xq-live-ink': '#5a3a14',
  '--xq-live-board-bg': '#f5dca8',
};

const t = (name: string): string => TOKENS[name]!;

// The card rules a resvg render needs, mirrored from articles.css (the
// `.xq-article-svg` diagram block), atomic-xiangqi.css (`.xq-marker--blast`)
// and xiangqi-board-surface.css (`.xq-surface`), with the selectors kept so a
// class paints only where the site paints it.
const FEED_THUMB_RULES: ReadonlyArray<readonly [selector: string, declarations: string]> = [
  ['.xq-article-svg .xq-diagram-bg', `fill:${t('--xq-diagram-bg')}`],
  ['.xq-article-svg .xq-diagram-palace-band', `fill:${t('--xq-diagram-palace-band')}`],
  ['.xq-article-svg .xq-diagram-line', `stroke:${t('--xq-diagram-ink')}`],
  ['.xq-article-svg .xq-diagram-ink', `fill:${t('--xq-diagram-ink')}`],
  ['.xq-article-svg .xq-diagram-river-label', 'display:none'],
  ['.xq-article-svg .xq-diagram-river-brand', 'display:none'],
  ['.xq-article-svg .xq-diagram-title', `fill:${t('--site-heading')}`],
  ['.xq-article-svg .xq-diagram-outside-text', `fill:${t('--site-text')}`],
  ['.xq-article-svg .xq-diagram-fog', `fill:${t('--xq-diagram-fog')}`],
  [
    '.xq-article-svg .xq-diagram-hand',
    `fill:${t('--site-panel-soft')};stroke:${t('--site-border-soft')};stroke-width:1`,
  ],
  [
    '.xq-article-svg .xq-diagram-hand-badge',
    `fill:${t('--site-accent')};stroke:${t('--site-panel')}`,
  ],
  ['.xq-article-svg .xq-diagram-hand-badge-count', `fill:${t('--site-on-accent')}`],
  [
    '.xq-article-svg .xq-jieqi-capture-card',
    `fill:${t('--site-panel-soft')};stroke:${t('--site-border-soft')}`,
  ],
  ['.xq-article-svg .xq-jieqi-capture-label', `fill:${t('--site-heading')}`],
  ['.xq-article-svg .xq-jieqi-capture-detail', `fill:${t('--site-text')}`],
  [
    '.xq-marker--blast',
    'stroke:#d99a1e;stroke-opacity:0.55;stroke-width:3;fill:rgba(217, 154, 30, 0.28)',
  ],
  ['.xq-surface .xq-live-line', `stroke:${t('--xq-live-ink')};stroke-width:1.2`],
  [
    '.xq-article-svg.xq-surface .xq-live-line',
    `stroke:${t('--xq-diagram-ink')};stroke-width:1`,
  ],
  [
    '.xq-article-svg.xq-surface .xq-live-start-mark',
    `stroke:${t('--xq-diagram-ink')};stroke-width:1`,
  ],
  ['.xq-surface .xq-live-river-label', 'display:none'],
  ['.xq-surface .xq-live-river-brand', 'display:none'],
];

/** Classes the feed style block paints (the last class of each selector). */
export const FEED_THUMB_STYLED_CLASSES: ReadonlySet<string> = new Set(
  FEED_THUMB_RULES.flatMap(([selector]) =>
    selector.split(/[\s.]+/).filter((part) => part.length > 0),
  ),
);

/** Classes a card carries that no stylesheet paints: script hooks, layout
 *  markers and scoping roots. Their elements draw with inline attributes. */
export const FEED_THUMB_UNPAINTED_CLASSES: ReadonlySet<string> = new Set([
  'xq-diagram-piece-slot',
  'xq-piece-back-mark',
  'duck-tree-mark',
  'banqi-diagram-piece-slot',
  'xq-half-thumb',
  'xq-diagram-hand-piece',
]);

/** Every class in `svg` that the feed render would leave unstyled. */
export function unstyledFeedThumbClasses(svg: string): string[] {
  const out = new Set<string>();
  for (const match of svg.matchAll(/\sclass="([^"]*)"/g)) {
    for (const name of match[1]!.split(/\s+/)) {
      if (!name) continue;
      if (FEED_THUMB_STYLED_CLASSES.has(name) || FEED_THUMB_UNPAINTED_CLASSES.has(name)) continue;
      out.add(name);
    }
  }
  return [...out].sort();
}

/** Replace each `var(--token, fallback)` with the token's dark-card value, or
 *  its fallback when the site does not define it. Innermost first, so a
 *  fallback that is itself a var() resolves too. */
export function resolveCssVars(text: string): string {
  let current = text;
  // The last var( in the text has no var( inside it, so it is innermost.
  for (let start = current.lastIndexOf('var('); start >= 0; start = current.lastIndexOf('var(')) {
    let depth = 0;
    let end = -1;
    for (let i = start + 3; i < current.length; i += 1) {
      if (current[i] === '(') depth += 1;
      else if (current[i] === ')') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) break;
    const inner = current.slice(start + 4, end);
    const comma = inner.indexOf(',');
    const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
    const fallback = comma < 0 ? undefined : inner.slice(comma + 1).trim();
    current = current.slice(0, start) + (TOKENS[name] ?? fallback ?? 'none') + current.slice(end + 1);
  }
  return current;
}

const escapeAttr = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function frame(inner: string): string {
  const style = FEED_THUMB_RULES.map(([selector, body]) => `${selector}{${body}}`).join('');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${FEED_THUMB_WIDTH}" height="${FEED_THUMB_HEIGHT}" viewBox="0 0 ${FEED_THUMB_WIDTH} ${FEED_THUMB_HEIGHT}" color="${t('--site-text')}">`,
    `<style>${style}</style>`,
    `<rect width="${FEED_THUMB_WIDTH}" height="${FEED_THUMB_HEIGHT}" fill="${t('--site-panel-soft')}"/>`,
    inner,
    '</svg>',
  ].join('');
}

// The card fits an SVG thumbnail with `meet` across the full media box
// (articles.ts renderArticleThumbnail). Here the thumbnail's root <svg> becomes
// a nested viewport over the frame, its own sizing attributes replaced.
function svgThumb(raw: string): string | null {
  const svg = resolveCssVars(raw.trim());
  const open = svg.match(/^<svg\b([^>]*)>/);
  if (!open || !svg.endsWith('</svg>')) return null;
  const attrs = open[1]!
    .replace(/\s(?:width|height|x|y|preserveAspectRatio|style)="[^"]*"/g, '')
    .replace(/\sxmlns(?::xlink)?="[^"]*"/g, '');
  const viewBox = /\sviewBox="[^"]*"/.test(attrs);
  if (!viewBox) return null;
  const nested = `<svg x="0" y="0" width="${FEED_THUMB_WIDTH}" height="${FEED_THUMB_HEIGHT}" preserveAspectRatio="xMidYMid meet"${attrs}>`;
  return frame(`${nested}${svg.slice(open[0].length)}`);
}

// The card centres a square chessground board on the panel, 10px in from top
// and bottom (articles.css `.articles-index-card-media .articles-thumb-board`).
// The static renderer draws the same brown board and cburnett pieces.
function boardThumb(thumb: {
  pieces: BoardSpec['pieces'];
  fogSquares?: BoardSpec['fogSquares'];
  orientation?: BoardSpec['orientation'];
}): string {
  const inset = 10 * (FEED_THUMB_HEIGHT / 200);
  const size = FEED_THUMB_HEIGHT - 2 * inset;
  const x = (FEED_THUMB_WIDTH - size) / 2;
  const pieces: PieceOnBoard[] = thumb.pieces;
  return frame(
    fogPatternDefs(size) +
      renderBoardSvg(pieces, thumb.fogSquares ?? [], x, inset, size, thumb.orientation ?? 'white', {
        fogStyle: 'striped',
        clipId: 'feed-thumb-board',
      }),
  );
}

// object-position keywords and percentages, mapped to the nearest
// preserveAspectRatio alignment (resvg has no object-position).
function alignFor(position: string | undefined): string {
  const parts = (position ?? 'center').trim().split(/\s+/);
  const axis = (part: string | undefined, low: string, high: string): string => {
    if (!part || part === 'center') return 'Mid';
    if (part === low) return 'Min';
    if (part === high) return 'Max';
    const pct = Number.parseFloat(part);
    if (Number.isFinite(pct) && part.endsWith('%')) return pct < 33 ? 'Min' : pct > 67 ? 'Max' : 'Mid';
    return 'Mid';
  };
  const [first, second] = parts;
  const vertical = first === 'top' || first === 'bottom';
  const xPart = vertical ? second : first;
  const yPart = vertical ? first : second;
  return `x${axis(xPart, 'left', 'right')}Y${axis(yPart, 'top', 'bottom')}`;
}

function imageThumb(src: string, position: string | undefined): string | null {
  // Root-relative public files only: the server inlines them from the build,
  // and resvg never fetches.
  if (!src.startsWith('/') || src.startsWith('//')) return null;
  return frame(
    `<image href="${escapeAttr(src)}" x="0" y="0" width="${FEED_THUMB_WIDTH}" height="${FEED_THUMB_HEIGHT}" preserveAspectRatio="${alignFor(position)} slice"/>`,
  );
}

/** The card art of `thumb` as a 480x300 self-contained SVG, drawn as the
 *  English card draws it (international pieces, intersection layout). Null
 *  when there is nothing to draw. */
export function feedThumbnailSvg(thumb: ArticleThumbnail | undefined): string | null {
  if (!thumb) return null;
  if (thumb.kind === 'svg') {
    const source = thumb.svg;
    const raw =
      typeof source === 'function'
        ? withXiangqiBoardLayout('intersection', () =>
            withXiangqiPieceSet('international', () => source('en')),
          )
        : source;
    return svgThumb(raw);
  }
  if (thumb.kind === 'image') return imageThumb(thumb.src, thumb.position);
  return boardThumb(thumb);
}

/** A blog post's feed thumbnail SVG; null for a rules page (the feeds carry
 *  posts only) or a post with no card art. */
export function articleFeedThumbnailSvg(article: Article): string | null {
  if (article.kind !== 'article') return null;
  return feedThumbnailSvg(article.thumbnail);
}

/**
 * The server renderer's output revision (apps/server/src/article-thumb.ts
 * ARTICLE_THUMB_RENDER_REVISION; feed-thumbnail-render.test.ts pins the two
 * equal). The PNG's bytes depend on the SVG and on how the server draws it, so
 * both go into the `?v=`: 2 is the 480x300 palette PNG (2026-10-25), 1 the
 * 960x600 32-bit one before it.
 */
export const FEED_THUMB_RENDER_REVISION = 2;

/** A short content hash for the thumbnail URL's `?v=`, so a changed card or a
 *  changed renderer is a new URL under the PNG route's immutable cache header
 *  (FNV-1a, 32 bits). */
export function feedThumbnailVersion(svg: string): string {
  const input = `r${FEED_THUMB_RENDER_REVISION}\n${svg}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export type FeedThumbnail = { slug: string; svg: string; version: string };

/** The feed thumbnail of every post in `live` that has card art. */
export function feedThumbnails(live: readonly Article[]): Map<string, FeedThumbnail> {
  const out = new Map<string, FeedThumbnail>();
  for (const article of live) {
    const svg = articleFeedThumbnailSvg(article);
    if (svg) out.set(article.slug, { slug: article.slug, svg, version: feedThumbnailVersion(svg) });
  }
  return out;
}
