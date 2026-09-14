import './study-thumbnails.css';
import { parseStandardXiangqiFen } from '@mistboard/game';
import { FINAL_VARIANT_MARKERS, renderVariantMarker } from './variant-markers.js';

// A study card's thumbnail, in precedence order:
//
//   1. An archival cover scan for the five flagship studies below. Hand-sourced
//      with rights checks (public/study-thumbnails/CREDITS.md) and keyed by id,
//      so the list is deliberately manual and stays short: only a study with a
//      public-domain source scan can ever get one.
//   2. Chapter 1's position, drawn from the `previewBoard` the list API derives
//      (server study-preview-board.ts): a composition is its diagram; a game
//      from the standard start shows its opening a few plies in. Zero authoring,
//      so every study a user creates gets one.
//   3. The variant's one-colour marker (variant-markers.ts, the current set;
//      the older mini-board crops are retired), for a variant the server cannot
//      yet derive a board for (every non-xiangqi study today).
//
// At card size a 9x10 board is a fingerprint rather than a readable position:
// endgames read as sparse, compositions as lopsided, openings as full. That is
// what a card thumbnail is for, and it is why the board draws pieces as solid
// red and black discs on a faint grid instead of reusing the glyph-drawn OG
// board: at ~6 px a glyph inside a disc only greys the disc out.

type StudyThumbnail = {
  src: string;
  sourceLabel: string;
};

export type StudyPreviewBoard = { variant: string; fen: string | null };

const FLAGSHIP_STUDY_THUMBNAILS: Readonly<Record<string, StudyThumbnail>> = {
  Dfi3NpRE: {
    src: '/study-thumbnails/tangerine-vol-1.webp',
    sourceLabel: 'Cover from the National Archives of Japan scan',
  },
  XBQuhA9n: {
    src: '/study-thumbnails/tangerine-vol-2.webp',
    sourceLabel: 'Cover from the National Archives of Japan scan',
  },
  EarRoCib: {
    src: '/study-thumbnails/tangerine-vol-3.webp',
    sourceLabel: 'Cover from the National Archives of Japan scan',
  },
  uXnuObfx: {
    src: '/study-thumbnails/seven-stars.webp',
    sourceLabel: 'Cover from the 1916 Internet Archive scan',
  },
  rhrGqFnM: {
    src: '/study-thumbnails/golden-roc.webp',
    sourceLabel: 'Title leaf from the Bavarian State Library scan',
  },
};

// Board geometry in SVG units: 9 files by 10 ranks on a unit cell, with a
// half-cell margin so edge discs are not clipped.
const XQ_CELL = 10;
const XQ_MARGIN = 6;
const XQ_BOARD_WIDTH = 8 * XQ_CELL + 2 * XQ_MARGIN;
const XQ_BOARD_HEIGHT = 9 * XQ_CELL + 2 * XQ_MARGIN;

export function buildStudyThumbnail(
  studyId: string,
  className: string,
  loading: 'eager' | 'lazy' = 'lazy',
  previewBoard: StudyPreviewBoard | null = null,
): HTMLElement | null {
  const archival = FLAGSHIP_STUDY_THUMBNAILS[studyId];
  if (archival) return archivalThumbnail(archival, className, loading);
  if (!previewBoard) return null;
  if (previewBoard.fen !== null) {
    const board = xiangqiBoardSvg(previewBoard.fen);
    if (board) {
      const el = frame(className, 'study-thumbnail--board', board);
      // The frame's shape comes from the same constants as the viewBox, so the
      // SVG fills it exactly; a CSS aspect typed by hand drifted once already.
      el.style.aspectRatio = `${XQ_BOARD_WIDTH} / ${XQ_BOARD_HEIGHT}`;
      return el;
    }
  }
  if (hasVariantMarker(previewBoard.variant)) {
    return frame(
      className,
      'study-thumbnail--variant',
      // Nominal; the CSS scales the marker to its frame.
      renderVariantMarker(previewBoard.variant, { size: 40 }),
    );
  }
  return null;
}

function archivalThumbnail(
  thumbnail: StudyThumbnail,
  className: string,
  loading: 'eager' | 'lazy',
): HTMLElement {
  const image = document.createElement('img');
  image.src = thumbnail.src;
  image.alt = '';
  image.loading = loading;
  image.decoding = 'async';
  const el = frame(className, 'study-thumbnail--archival');
  el.title = thumbnail.sourceLabel;
  el.append(image);
  return el;
}

function frame(className: string, kind: string, innerSvg?: string): HTMLElement {
  const el = document.createElement('span');
  el.className = `study-thumbnail ${kind} ${className}`;
  el.setAttribute('aria-hidden', 'true');
  if (innerSvg !== undefined) el.innerHTML = innerSvg;
  return el;
}

function xiangqiBoardSvg(fen: string): string | null {
  const parsed = parseStandardXiangqiFen(fen, 'study-thumbnail');
  if (!parsed.ok) return null;
  const px = (file: number) => XQ_MARGIN + file * XQ_CELL;
  const py = (rank: number) => XQ_MARGIN + (10 - rank) * XQ_CELL;
  const grid: string[] = [];
  for (let rank = 1; rank <= 10; rank += 1) {
    grid.push(`M${px(0)} ${py(rank)}H${px(8)}`);
  }
  for (let file = 0; file <= 8; file += 1) {
    if (file === 0 || file === 8) grid.push(`M${px(file)} ${py(10)}V${py(1)}`);
    else grid.push(`M${px(file)} ${py(10)}V${py(6)}M${px(file)} ${py(5)}V${py(1)}`);
  }
  // Palace diagonals, both ends.
  grid.push(`M${px(3)} ${py(1)}L${px(5)} ${py(3)}M${px(5)} ${py(1)}L${px(3)} ${py(3)}`);
  grid.push(`M${px(3)} ${py(8)}L${px(5)} ${py(10)}M${px(5)} ${py(8)}L${px(3)} ${py(10)}`);
  const discs: string[] = [];
  for (const [square, piece] of Object.entries(parsed.state.board)) {
    if (!piece) continue;
    const file = square.charCodeAt(0) - 97;
    const rank = Number(square.slice(1));
    discs.push(
      `<circle class="study-thumbnail__${piece.color}" cx="${px(file)}" cy="${py(rank)}" r="${XQ_CELL * 0.42}"/>`,
    );
  }
  return [
    `<svg viewBox="0 0 ${XQ_BOARD_WIDTH} ${XQ_BOARD_HEIGHT}" preserveAspectRatio="xMidYMid meet">`,
    `<rect class="study-thumbnail__wood" x="0.5" y="0.5" width="${XQ_BOARD_WIDTH - 1}" height="${XQ_BOARD_HEIGHT - 1}" rx="2"/>`,
    `<path class="study-thumbnail__grid" d="${grid.join('')}" fill="none" stroke-width="0.6"/>`,
    discs.join(''),
    `</svg>`,
  ].join('');
}

function hasVariantMarker(variant: string): variant is keyof typeof FINAL_VARIANT_MARKERS {
  return variant in FINAL_VARIANT_MARKERS;
}
