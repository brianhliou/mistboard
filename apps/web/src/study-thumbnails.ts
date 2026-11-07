import './study-thumbnails.css';
import { hasOwnKey, parseStandardXiangqiFen } from '@mistboard/game';
import { isVariantMarkerId, renderVariantMarker } from './variant-markers.js';

// A study card's thumbnail, in precedence order:
//
//   1. An archival cover scan for the five flagship studies below. Hand-sourced
//      with rights checks (public/study-thumbnails/CREDITS.md) and keyed by id,
//      so the list is deliberately manual and stays short: only a study with a
//      public-domain source scan can ever get one.
//   2. Chapter 1's position, drawn from the `previewBoard` the list API derives
//      (server study-preview-board.ts): a composition is its diagram; a xiangqi
//      game from the standard start shows its opening a few plies in. Zero
//      authoring, so every study a user creates gets one. Every study variant
//      derives one (#710), each on its own board: xiangqi's points with river
//      and palaces, chess's checkered squares, jungle's rivers, banqi's 8x4.
//   3. The variant's one-colour marker (variant-markers.ts, the current set;
//      the older mini-board crops are retired), for a variant the server cannot
//      derive a board for.
//
// At card size a board is a fingerprint rather than a readable position:
// endgames read as sparse, compositions as lopsided, openings as full. That is
// what a card thumbnail is for, and it is why the board draws pieces as solid
// discs on a faint grid instead of reusing the glyph-drawn OG board: at ~6 px a
// glyph inside a disc only greys the disc out. A face-down piece is the back of
// a tile: a brown disc, ringed in its side's colour where the side is public
// (jieqi) and plain where it is not (banqi, flip jungle, three kingdoms banqi). The server sends
// discs only, never roles, so nothing hidden can reach this drawing.

type StudyThumbnail = {
  src: string;
  sourceLabel: string;
};

export type StudyPreviewShape =
  | 'xiangqi'
  | 'fortress'
  | 'chess'
  | 'jungle'
  | 'banqi'
  | 'jungle-flip'
  | 'three-kingdoms-banqi';

/** One character per cell, top rank first (server study-preview-board.ts):
 *  '.' empty, 'r' red (white in chess), 'b' black, 'R'/'B' face-down with a
 *  public side, '?' face-down, 'd' the duck. */
export type StudyPreviewGrid = {
  shape: StudyPreviewShape;
  files: number;
  ranks: number;
  cells: string;
};

export type StudyPreviewBoard = {
  variant: string;
  fen: string | null;
  grid?: StudyPreviewGrid | null;
};

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

// Board geometry in SVG units: a unit cell of 10 and a margin that keeps edge
// discs whole. Point boards (xiangqi, fortress) put pieces on intersections;
// square boards put them in cells.
const CELL = 10;
const POINT_MARGIN = 6;
const SQUARE_MARGIN = 1.5;
const DISC_R = CELL * 0.42;

export function buildStudyThumbnail(
  studyId: string,
  className: string,
  loading: 'eager' | 'lazy' = 'lazy',
  previewBoard: StudyPreviewBoard | null = null,
): HTMLElement | null {
  const archival = FLAGSHIP_STUDY_THUMBNAILS[studyId];
  if (archival) return archivalThumbnail(archival, className, loading);
  if (!previewBoard) return null;
  const board =
    (previewBoard.grid ? gridBoardSvg(previewBoard.grid) : null) ??
    (previewBoard.fen !== null ? xiangqiFenGrid(previewBoard.fen) : null);
  if (board) {
    const el = frame(className, 'study-thumbnail--board', board.svg);
    el.dataset.boardShape = board.shape;
    // The frame's shape comes from the same numbers as the viewBox, so the SVG
    // fills it exactly; a CSS aspect typed by hand drifted once already.
    el.style.aspectRatio = `${board.width} / ${board.height}`;
    return el;
  }
  if (isVariantMarkerId(previewBoard.variant)) {
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

/** A plain xiangqi FEN as a grid: the API's own `grid` is preferred; this keeps
 *  a response from before the grid existed drawing. */
function xiangqiFenGrid(fen: string): BoardSvg | null {
  const parsed = parseStandardXiangqiFen(fen, 'study-thumbnail');
  if (!parsed.ok) return null;
  let cells = '';
  for (let rank = 10; rank >= 1; rank -= 1) {
    for (const file of 'abcdefghi') {
      const piece = parsed.state.board[`${file}${rank}` as keyof typeof parsed.state.board];
      cells += piece ? (piece.color === 'black' ? 'b' : 'r') : '.';
    }
  }
  return gridBoardSvg({ shape: 'xiangqi', files: 9, ranks: 10, cells });
}

type BoardSvg = { svg: string; shape: StudyPreviewShape; width: number; height: number };

const SHAPES: Readonly<
  Record<StudyPreviewShape, { files: number; ranks: number; points: boolean }>
> = {
  xiangqi: { files: 9, ranks: 10, points: true },
  fortress: { files: 7, ranks: 8, points: true },
  chess: { files: 8, ranks: 8, points: false },
  jungle: { files: 7, ranks: 9, points: false },
  banqi: { files: 8, ranks: 4, points: false },
  'jungle-flip': { files: 4, ranks: 4, points: false },
  'three-kingdoms-banqi': { files: 9, ranks: 5, points: true },
};

/** Draw a disc grid on its variant's board. Fail-closed: a shape this client
 *  does not know, or cells that do not fill the shape, draw nothing (the
 *  caller falls back to the variant marker). */
function gridBoardSvg(grid: StudyPreviewGrid): BoardSvg | null {
  const spec = hasOwnKey(SHAPES, grid.shape) ? SHAPES[grid.shape] : undefined;
  if (!spec || grid.files !== spec.files || grid.ranks !== spec.ranks) return null;
  if (typeof grid.cells !== 'string' || grid.cells.length !== spec.files * spec.ranks) return null;
  const margin = spec.points ? POINT_MARGIN : SQUARE_MARGIN;
  const width = (spec.points ? spec.files - 1 : spec.files) * CELL + 2 * margin;
  const height = (spec.points ? spec.ranks - 1 : spec.ranks) * CELL + 2 * margin;
  // Centre of the piece at column `col`, row `row` (row 0 is the top rank).
  const cx = (col: number) => margin + (spec.points ? col : col + 0.5) * CELL;
  const cy = (row: number) => margin + (spec.points ? row : row + 0.5) * CELL;
  const chess = grid.shape === 'chess';

  const parts: string[] = [
    `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">`,
    `<rect class="study-thumbnail__wood" x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="2"/>`,
    spec.points ? pointGrid(grid.shape, spec.files, spec.ranks) : squareGrid(grid.shape, spec),
  ];
  for (let row = 0; row < spec.ranks; row += 1) {
    for (let col = 0; col < spec.files; col += 1) {
      const disc = discSvg(grid.cells.charAt(row * spec.files + col), cx(col), cy(row), chess);
      if (disc) parts.push(disc);
    }
  }
  parts.push('</svg>');
  return { svg: parts.join(''), shape: grid.shape, width, height };
}

function discSvg(cell: string, x: number, y: number, chess: boolean): string | null {
  const at = `cx="${x}" cy="${y}"`;
  switch (cell) {
    case 'r':
      return `<circle class="study-thumbnail__${chess ? 'white' : 'red'}" ${at} r="${DISC_R}"/>`;
    case 'b':
      return `<circle class="study-thumbnail__black" ${at} r="${DISC_R}"/>`;
    case 'R':
      return `<circle class="study-thumbnail__down study-thumbnail__down--red" ${at} r="${DISC_R - 0.6}"/>`;
    case 'B':
      return `<circle class="study-thumbnail__down study-thumbnail__down--black" ${at} r="${DISC_R - 0.6}"/>`;
    case '?':
      return `<circle class="study-thumbnail__down" ${at} r="${DISC_R - 0.6}"/>`;
    case 'd':
      return `<circle class="study-thumbnail__duck" ${at} r="${DISC_R}"/>`;
    default:
      return null;
  }
}

/** Lines through the points; xiangqi adds its river gap and both palaces. */
function pointGrid(shape: StudyPreviewShape, files: number, ranks: number): string {
  const px = (file: number) => POINT_MARGIN + file * CELL;
  const py = (row: number) => POINT_MARGIN + row * CELL;
  const d: string[] = [];
  for (let row = 0; row < ranks; row += 1) d.push(`M${px(0)} ${py(row)}H${px(files - 1)}`);
  for (let file = 0; file < files; file += 1) {
    if (shape === 'xiangqi' && file > 0 && file < files - 1) {
      d.push(`M${px(file)} ${py(0)}V${py(4)}M${px(file)} ${py(5)}V${py(9)}`);
    } else {
      d.push(`M${px(file)} ${py(0)}V${py(ranks - 1)}`);
    }
  }
  if (shape === 'xiangqi') {
    d.push(`M${px(3)} ${py(0)}L${px(5)} ${py(2)}M${px(5)} ${py(0)}L${px(3)} ${py(2)}`);
    d.push(`M${px(3)} ${py(7)}L${px(5)} ${py(9)}M${px(5)} ${py(7)}L${px(3)} ${py(9)}`);
  }
  return `<path class="study-thumbnail__grid" d="${d.join('')}" fill="none" stroke-width="0.6"/>`;
}

/** Cell lines for a square board; chess shades its dark squares, jungle its
 *  two rivers (files b-c and e-f across the middle three ranks). */
function squareGrid(shape: StudyPreviewShape, spec: { files: number; ranks: number }): string {
  const x = (col: number) => SQUARE_MARGIN + col * CELL;
  const y = (row: number) => SQUARE_MARGIN + row * CELL;
  const fills: string[] = [];
  if (shape === 'chess') {
    for (let row = 0; row < spec.ranks; row += 1) {
      for (let col = 0; col < spec.files; col += 1) {
        if ((row + col) % 2 === 1) fills.push(`M${x(col)} ${y(row)}h${CELL}v${CELL}h-${CELL}z`);
      }
    }
  }
  if (shape === 'jungle') {
    for (const col of [1, 4])
      fills.push(`M${x(col)} ${y(3)}h${2 * CELL}v${3 * CELL}h-${2 * CELL}z`);
  }
  const lines: string[] = [];
  if (shape !== 'chess') {
    for (let row = 1; row < spec.ranks; row += 1) lines.push(`M${x(0)} ${y(row)}H${x(spec.files)}`);
    for (let col = 1; col < spec.files; col += 1) lines.push(`M${x(col)} ${y(0)}V${y(spec.ranks)}`);
  }
  const fillClass = shape === 'jungle' ? 'study-thumbnail__water' : 'study-thumbnail__dark-square';
  return [
    fills.length ? `<path class="${fillClass}" d="${fills.join('')}"/>` : '',
    lines.length
      ? `<path class="study-thumbnail__grid" d="${lines.join('')}" fill="none" stroke-width="0.6"/>`
      : '',
  ].join('');
}
