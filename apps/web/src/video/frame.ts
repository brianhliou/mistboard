// Compose one shot into a full-canvas SVG string: dark stage, centered board
// (the product renderer, so videos and the site are pixel-siblings), plus the
// video-only overlay layers (glow/dim, rays, region, red flash, moving piece).
// Pure string work; rasterization lives in raster.ts.

import type {
  StandardXiangqiPlayerView,
  XiangqiGameState,
  XiangqiMove,
  XiangqiPiece,
  XiangqiSquare,
} from '@mistboard/game';
import { getLegalMovesFrom } from '@mistboard/game';
import { xiangqiBoardSvg } from '../xiangqi-board.js';
import { renderXiangqiPiece } from '../xiangqi-pieces.js';
import {
  BOARD_FILES,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  fileLineX,
  lerpPoint,
  MARGIN,
  PIECE_SIZE,
  RANK_COUNT,
  RIVER_BOTTOM,
  RIVER_TOP,
  squareCenter,
} from './geometry.js';
import type { ScenePlan, VideoMeasureSpec, VideoRegion } from './manifest.js';
import {
  BOARD_HEIGHT_FILL,
  SHOW_SECTION_LABEL,
  VIDEO_ARROW_DASH,
  VIDEO_BOARD_STYLE,
  VIDEO_PIECE_SET,
} from './theme.js';
import type { Shot } from './timeline.js';

export function renderShotSvg(plan: ScenePlan, shot: Shot): string {
  const perspective = plan.perspective ?? 'red';
  const raysMoves = shot.overlays.raysFrom ? raysFor(shot, shot.overlays.raysFrom) : [];

  const view: StandardXiangqiPlayerView = {
    id: 'video',
    perspective,
    board: shot.board,
    legalMoves: raysMoves,
    status: { type: 'playing', turn: 'red' },
    moveNumber: 1,
    ...(shot.lastMove ? { lastMove: shot.lastMove } : {}),
  };

  let boardSvg = xiangqiBoardSvg(view, perspective, {
    // Video framing is authored against the board's own edges; the coordinate
    // gutter belongs to the interactive surfaces only.
    coordinates: false,
    interactive: false,
    selectedSquare: shot.overlays.raysFrom,
    draggingFrom: null,
    // Pin layout and piece set. Both product defaults come from localStorage,
    // which does not exist in the render process, so leaving them unset means
    // the channel look is whatever the app happens to default to that month.
    // geometry.ts also mirrors the intersection coordinate system the overlay
    // math depends on.
    layout: 'intersection',
    pieceSet: VIDEO_PIECE_SET,
    arrows: shot.overlays.arrows.map((arrow) => ({
      from: arrow.from,
      to: arrow.to,
      ...(arrow.dashed !== undefined
        ? { dashed: arrow.dashed, dashPattern: VIDEO_ARROW_DASH }
        : {}),
    })),
  });

  boardSvg = withExplicitSize(boardSvg);
  boardSvg = injectBeforeClose(boardSvg, overlayMarkup(shot, perspective));

  const scale = (plan.height * BOARD_HEIGHT_FILL) / BOARD_HEIGHT;
  const tx = (plan.width - BOARD_WIDTH * scale) / 2;
  const ty = (plan.height - BOARD_HEIGHT * scale) / 2;

  // The gutter is only as wide as the board's offset, and the rank column eats
  // the right edge of it. Section titles are sentences, not surnames, so they
  // wrap rather than run under the board.
  const label =
    SHOW_SECTION_LABEL && shot.label ? labelMarkup(shot.label, tx - LABEL_X - RANK_GUTTER_W) : '';

  const watermark = plan.watermark
    ? `<text x="${plan.width - 28}" y="${plan.height - 26}" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="26" fill="rgba(255,255,255,0.30)" letter-spacing="1">${escapeXml(plan.watermark)}</text>`
    : '';

  return [
    `<svg width="${plan.width}" height="${plan.height}" viewBox="0 0 ${plan.width} ${plan.height}" xmlns="http://www.w3.org/2000/svg">`,
    `<style>${VIDEO_BOARD_STYLE}</style>`,
    `<rect x="0" y="0" width="${plan.width}" height="${plan.height}" fill="${plan.background}"/>`,
    `<g transform="translate(${round2(tx)} ${round2(ty)}) scale(${round2(scale)})">`,
    boardSvg,
    `</g>`,
    coordinateMarkup(perspective, tx, ty, scale),
    label,
    watermark,
    `</svg>`,
  ].join('');
}

const LABEL_X = 40;
const LABEL_TOP = 56;
const LABEL_FONT_SIZE = 26;
const LABEL_LINE_HEIGHT = 34;
/** Width the rank column claims at the right of the gutter. */
const RANK_GUTTER_W = 60;

/** Section title in the gutter, greedy-wrapped to the space actually available.
 *  Width is estimated from the font size rather than measured — there is no text
 *  metrics API here, so the advance is deliberately generous and the result errs
 *  toward wrapping early instead of running under the board. */
function labelMarkup(text: string, maxWidth: number): string {
  const advance = LABEL_FONT_SIZE * 0.66 + 3;
  const perLine = Math.max(1, Math.floor(maxWidth / advance));
  const lines: string[] = [];
  let line = '';
  for (const word of text.toUpperCase().split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && candidate.length > perLine) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines
    .map(
      (text2, index) =>
        `<text class="xqv-label" x="${LABEL_X}" y="${LABEL_TOP + index * LABEL_LINE_HEIGHT}">${escapeXml(text2)}</text>`,
    )
    .join('');
}

/** Rank numbers down the stage gutter, the way a broadcast board carries them.
 *  Canonical xiangqi coordinates per the notation decision: ranks 1-10 with
 *  Red's back rank at 1. Video-only; the product board draws no coordinates.
 *
 *  These sit in canvas space rather than the board's own margin: that margin is
 *  36 units and a piece radius is 27, so anything drawn there lands under the
 *  edge pieces. File letters are omitted for the same reason — at full bleed
 *  there is no gutter below the board to put them in. */
function coordinateMarkup(
  perspective: 'red' | 'black',
  tx: number,
  ty: number,
  scale: number,
): string {
  const parts: string[] = [];
  for (let rank = 1; rank <= RANK_COUNT; rank += 1) {
    const { y } = squareCenter(`a${rank}` as XiangqiSquare, perspective);
    const cy = ty + y * scale;
    parts.push(`<text class="xqv-coord" x="${round2(tx - 26)}" y="${round2(cy)}">${rank}</text>`);
  }
  return `<g class="xqv-coords" aria-hidden="true">${parts.join('')}</g>`;
}

/** Give the product board's root <svg> explicit pixel dimensions. Without them a
 *  nested <svg> defaults to 100% of the viewport, and the outer scale() then
 *  throws the board off-canvas. This is a string seam onto another module's
 *  markup, so it matches the tag rather than an exact class string (the root
 *  carries layout modifier classes) and throws instead of silently no-oping —
 *  a missed patch here is invisible until someone watches the rendered video. */
function withExplicitSize(boardSvg: string): string {
  const rootTag = boardSvg.match(/<svg\b[^>]*>/)?.[0];
  if (!rootTag) {
    throw new Error('board SVG has no root <svg> tag; the frame composition seam moved');
  }
  const sized = rootTag
    .replace(/\s(?:width|height)="[^"]*"/g, '')
    .replace(/<svg\b/, `<svg width="${BOARD_WIDTH}" height="${BOARD_HEIGHT}"`);
  return boardSvg.replace(rootTag, sized);
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Mirrors the board layer's rule (xiangqi-board.ts): a soldier past the river
 *  draws with the promoted art. The overlay and moving layers render pieces
 *  themselves, so without this a crossed soldier reverts to the unpromoted
 *  glyph mid-glide and snaps back on landing. */
function drawsCrossed(piece: XiangqiPiece, square: XiangqiSquare): boolean {
  if (piece.role !== 'soldier') return false;
  const rank = Number(square.slice(1));
  return piece.color === 'red' ? rank >= 6 : rank <= 5;
}

/** Video overlays live in board viewBox coordinates, injected inside the board
 *  SVG so one transform moves everything together. */
function overlayMarkup(shot: Shot, perspective: 'red' | 'black'): string {
  const parts: string[] = [];
  const { overlays, moving } = shot;

  if (overlays.region) parts.push(regionRect(overlays.region, perspective));

  if (overlays.measures.length > 0) {
    if (overlays.measuresDim) {
      parts.push(
        `<rect class="xqv-dim" x="0" y="0" width="${BOARD_WIDTH}" height="${BOARD_HEIGHT}" rx="16"/>`,
      );
    }
    for (const measure of overlays.measures) parts.push(measureMarkup(measure));
  }

  if (overlays.points.length > 0) {
    for (const square of overlays.points) {
      const center = squareCenter(square, perspective);
      if (overlays.pointsBlocked) {
        // A cross, drawn at piece scale so it reads as "not here" rather than
        // as another marker on the board.
        const r = 17;
        parts.push(
          `<g class="xqv-blocked">` +
            `<circle cx="${center.x}" cy="${center.y}" r="${r + 6}" class="xqv-blocked-disc"/>` +
            `<line x1="${center.x - r}" y1="${center.y - r}" x2="${center.x + r}" y2="${center.y + r}"/>` +
            `<line x1="${center.x - r}" y1="${center.y + r}" x2="${center.x + r}" y2="${center.y - r}"/>` +
            `</g>`,
        );
      } else {
        parts.push(
          overlays.pointsCapture
            ? `<circle class="xq-live-hint-capture" cx="${center.x}" cy="${center.y}" r="28"/>`
            : `<circle class="xq-live-hint-dot" cx="${center.x}" cy="${center.y}" r="7"/>`,
        );
      }
    }
  }

  if (overlays.glow.length > 0) {
    if (overlays.dimOthers) {
      parts.push(
        `<rect class="xqv-dim" x="0" y="0" width="${BOARD_WIDTH}" height="${BOARD_HEIGHT}" rx="16"/>`,
      );
      // Re-draw the spotlit pieces above the wash.
      for (const square of overlays.glow) {
        const piece = shot.board[square];
        if (!piece) continue;
        const center = squareCenter(square, perspective);
        parts.push(
          renderXiangqiPiece(piece, {
            x: center.x - PIECE_SIZE / 2,
            y: center.y - PIECE_SIZE / 2,
            size: PIECE_SIZE,
            className: 'xq-piece',
            pieceSet: VIDEO_PIECE_SET,
            crossed: drawsCrossed(piece, square),
          }),
        );
      }
    }
    for (const square of overlays.glow) {
      const center = squareCenter(square, perspective);
      parts.push(`<circle class="xqv-glow-ring" cx="${center.x}" cy="${center.y}" r="31"/>`);
    }
  }

  if (overlays.flash) {
    const from = squareCenter(overlays.flash.from, perspective);
    const to = squareCenter(overlays.flash.to, perspective);
    parts.push(`<circle class="xqv-flash-ring" cx="${from.x}" cy="${from.y}" r="31"/>`);
    parts.push(`<circle class="xqv-flash-ring" cx="${to.x}" cy="${to.y}" r="31"/>`);
    parts.push(flashArrow(from, to));
  }

  if (moving) {
    const from = squareCenter(moving.from, perspective);
    const to = squareCenter(moving.to, perspective);
    const at = lerpPoint(from, to, moving.t);
    parts.push(
      renderXiangqiPiece(moving.piece, {
        crossed: drawsCrossed(moving.piece, moving.to),
        x: at.x - PIECE_SIZE / 2,
        y: at.y - PIECE_SIZE / 2,
        size: PIECE_SIZE,
        className: 'xq-piece',
        pieceSet: VIDEO_PIECE_SET,
      }),
    );
  }

  return parts.length > 0 ? `<g class="xqv-overlays">${parts.join('')}</g>` : '';
}

function regionRect(region: VideoRegion, perspective: 'red' | 'black'): string {
  if (region === 'river') {
    return `<rect class="xqv-region" x="${MARGIN - 18}" y="${RIVER_TOP}" width="${BOARD_WIDTH - (MARGIN - 18) * 2}" height="${RIVER_BOTTOM - RIVER_TOP}" rx="8"/>`;
  }
  if (region === 'palace-red' || region === 'palace-black') {
    const ranks: [number, number] = region === 'palace-red' ? [1, 3] : [8, 10];
    const a = squareCenter(`d${ranks[0]}` as XiangqiSquare, perspective);
    const b = squareCenter(`f${ranks[1]}` as XiangqiSquare, perspective);
    const pad = 14;
    return `<rect class="xqv-region" x="${Math.min(a.x, b.x) - pad}" y="${Math.min(a.y, b.y) - pad}" width="${Math.abs(b.x - a.x) + pad * 2}" height="${Math.abs(b.y - a.y) + pad * 2}" rx="8"/>`;
  }
  const fileIndex = Math.max(0, BOARD_FILES.indexOf(region.file));
  const x = fileLineX(fileIndex, perspective);
  return `<rect class="xqv-region" x="${x - 20}" y="${MARGIN - 20}" width="40" height="${BOARD_HEIGHT - (MARGIN - 20) * 2}" rx="8"/>`;
}

/** Board dimension callout, engineering-drawing style: a double-headed line
 *  with end ticks and a centred label plate. Placed in the board's own margin
 *  band, which is narrower than a piece, so the caller dims the board behind it
 *  (default) and the measurement becomes the subject rather than a line
 *  competing with thirty-two pieces. */
function measureMarkup(spec: VideoMeasureSpec): string {
  const files = spec.axis === 'files';
  const label = spec.label ?? (files ? '9 lines wide' : '10 lines deep');
  // Half the margin: clear of the outer grid line, inside the viewBox so it
  // cannot clip.
  const offset = MARGIN / 2;
  const from = files ? { x: MARGIN, y: offset } : { x: offset, y: MARGIN };
  const to = files
    ? { x: BOARD_WIDTH - MARGIN, y: offset }
    : { x: offset, y: BOARD_HEIGHT - MARGIN };
  const tick = 11;
  const head = 13;
  const parts: string[] = [`<g class="xqv-measure">`];
  // A ruler bar behind the whole run. The board margin is narrower than a
  // piece, so without it the measure crosses the back rank and reads as
  // clutter; with it, the callout is its own object sitting on the board.
  const bar = 32;
  parts.push(
    files
      ? `<rect x="${round2(from.x - 16)}" y="${round2(offset - bar / 2)}" width="${round2(to.x - from.x + 32)}" height="${bar}" rx="${bar / 2}" class="xqv-measure-plate"/>`
      : `<rect x="${round2(offset - bar / 2)}" y="${round2(from.y - 16)}" width="${bar}" height="${round2(to.y - from.y + 32)}" rx="${bar / 2}" class="xqv-measure-plate"/>`,
  );
  // Extension ticks at both ends, perpendicular to the run.
  for (const end of [from, to]) {
    parts.push(
      files
        ? `<line x1="${round2(end.x)}" y1="${round2(end.y - tick)}" x2="${round2(end.x)}" y2="${round2(end.y + tick)}" class="xqv-measure-tick"/>`
        : `<line x1="${round2(end.x - tick)}" y1="${round2(end.y)}" x2="${round2(end.x + tick)}" y2="${round2(end.y)}" class="xqv-measure-tick"/>`,
    );
  }
  parts.push(
    `<line x1="${round2(from.x)}" y1="${round2(from.y)}" x2="${round2(to.x)}" y2="${round2(to.y)}" class="xqv-measure-line"/>`,
  );
  // Arrowheads pointing outward at each end: extent, not direction.
  const heads: [{ x: number; y: number }, number][] = files
    ? [
        [from, 1],
        [to, -1],
      ]
    : [
        [from, 1],
        [to, -1],
      ];
  for (const [end, sign] of heads) {
    const points = files
      ? `${round2(end.x)},${round2(end.y)} ${round2(end.x + sign * head)},${round2(end.y - 7)} ${round2(end.x + sign * head)},${round2(end.y + 7)}`
      : `${round2(end.x)},${round2(end.y)} ${round2(end.x - 7)},${round2(end.y + sign * head)} ${round2(end.x + 7)},${round2(end.y + sign * head)}`;
    parts.push(`<polygon points="${points}" class="xqv-measure-head"/>`);
  }
  // Label plate at the midpoint, so the text survives whatever is behind it.
  const mid = files
    ? { x: (from.x + to.x) / 2, y: offset + 34 }
    : { x: offset + 34, y: (from.y + to.y) / 2 };
  const width = label.length * 11 + 26;
  const height = 30;
  const rotate = files ? '' : ` transform="rotate(-90 ${round2(mid.x)} ${round2(mid.y)})"`;
  parts.push(
    `<g${rotate}>` +
      `<rect x="${round2(mid.x - width / 2)}" y="${round2(mid.y - height / 2)}" width="${width}" height="${height}" rx="8" class="xqv-measure-plate"/>` +
      `<text x="${round2(mid.x)}" y="${round2(mid.y + 7)}" text-anchor="middle" class="xqv-measure-label">${escapeXml(label)}</text>` +
      `</g>`,
  );
  parts.push(`</g>`);
  return parts.join('');
}

function flashArrow(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return '';
  const ux = dx / dist;
  const uy = dy / dist;
  // Clear the piece discs at both ends, but never by more than the arrow is
  // long: a one-square arrow is 60 units, and fixed 34/36 insets put the tip
  // BEHIND the start, drawing the whole arrow backwards. Adjacent-square flashes
  // (an illegal general step, a one-point shuffle) are exactly that case.
  const startInset = Math.min(34, dist * 0.3);
  const tipInset = Math.min(36, dist * 0.3);
  const startX = a.x + ux * startInset;
  const startY = a.y + uy * startInset;
  const tipX = b.x - ux * tipInset;
  const tipY = b.y - uy * tipInset;
  const headLength = Math.min(18, (dist - startInset - tipInset) * 0.8);
  const baseX = tipX - ux * headLength;
  const baseY = tipY - uy * headLength;
  const px = -uy;
  const py = ux;
  return (
    `<g class="xqv-flash-arrow" opacity="0.9">` +
    `<line x1="${round2(startX)}" y1="${round2(startY)}" x2="${round2(baseX)}" y2="${round2(baseY)}" stroke-width="8" stroke-linecap="round"/>` +
    `<polygon points="${round2(tipX)},${round2(tipY)} ${round2(baseX + px * 10)},${round2(baseY + py * 10)} ${round2(baseX - px * 10)},${round2(baseY - py * 10)}" stroke="none"/>` +
    `</g>`
  );
}

/** Pseudo-legal destinations from the FoW kernel: works on sparse demo boards
 *  (no general required), which is exactly what explainer scenes are. */
function raysFor(shot: Shot, square: XiangqiSquare): XiangqiMove[] {
  const piece = shot.board[square];
  if (!piece) return [];
  const state: XiangqiGameState = {
    id: 'video-rays',
    board: shot.board,
    status: { type: 'playing', turn: piece.color },
    moveNumber: 1,
    progressClock: 0,
    positionCounts: {},
  };
  return getLegalMovesFrom(state, square);
}

function injectBeforeClose(svg: string, markup: string): string {
  if (!markup) return svg;
  const at = svg.lastIndexOf('</svg>');
  if (at === -1) throw new Error('board svg had no closing tag');
  return `${svg.slice(0, at)}${markup}${svg.slice(at)}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
