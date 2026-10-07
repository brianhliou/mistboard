// The two board figures in "One Duck Xiangqi move is worth two xiangqi moves"
// (articles/content/duck-xiangqi-game-tree.ts), and its index card.
//
// Drawn with the shared xiangqi diagram toolkit (articles/diagrams.ts), so they
// follow the reader's piece set, board layout and board theme the way every
// other xiangqi figure on the site does. They used to be static SVGs from
// scripts/duck-tree-figures.mjs, which could not.
//
// Every mark is the kernel's answer, never a hand-typed list: the points are
// the duck destinations getDuckXiangqiLegalTurns offers after red's cannon
// h3-e3, and each point's number is black's no-duck reply set minus the
// replies left with the duck there. duck-xiangqi-tree-diagrams.test.ts pins
// the result to the numbers the article's prose quotes (45 replies, 58 points,
// 30 that change black, e8 takes 8), so a rules change fails a test instead of
// quietly redrawing a figure that contradicts its paragraph.

import {
  applyDuckXiangqiTurn,
  createInitialDuckXiangqiState,
  type DuckXiangqiBoard,
  type DuckXiangqiSquare,
  getDuckXiangqiLegalPieceMoves,
  getDuckXiangqiLegalTurns,
  type XiangqiPiece,
  type XiangqiSquare,
} from '@mistboard/game';
import {
  XQ_BOARD_H,
  XQ_BOARD_W,
  xqArrowLayer,
  xqBoardGrid,
  xqCoord,
  xqPieceSize,
  xqPiecesLayer,
  xqPoint,
  xqSvg,
  xqVisionDemoState,
} from './articles/diagrams.js';

/** One point the duck can land on after h3-e3, scored against black's replies. */
export type DuckTreePoint = {
  square: DuckXiangqiSquare;
  /** Black replies that exist with no duck and are gone with the duck here. */
  removed: number;
  /** Black replies that exist only with the duck here (it screens a cannon). */
  added: number;
};

export type DuckTreeMarks = {
  board: DuckXiangqiBoard;
  /** Black's legal replies after h3-e3 on the same board with no duck. */
  baseReplies: number;
  points: DuckTreePoint[];
};

const MOVE = { from: 'h3', to: 'e3' } as const;

let cached: DuckTreeMarks | null = null;

/** The h3-e3 board and every duck placement's effect on black, from the kernel. */
export function duckTreeH3e3Marks(): DuckTreeMarks {
  if (cached) return cached;
  const start = createInitialDuckXiangqiState('duck-tree-start');
  const turns = getDuckXiangqiLegalTurns(start).filter(
    (turn) => turn.from === MOVE.from && turn.to === MOVE.to && turn.duckTo,
  );
  if (turns.length === 0) throw new Error('h3e3 is not a legal first move');
  const key = (move: { from: string; to: string }) => `${move.from}${move.to}`;
  const after = applyDuckXiangqiTurn(start, turns[0]!);
  const base = getDuckXiangqiLegalPieceMoves({ ...after, duck: undefined }).map(key);
  const baseSet = new Set(base);
  const points = turns.map((turn) => {
    const withDuck = new Set(
      getDuckXiangqiLegalPieceMoves(applyDuckXiangqiTurn(start, turn)).map(key),
    );
    return {
      square: turn.duckTo as DuckXiangqiSquare,
      removed: base.filter((reply) => !withDuck.has(reply)).length,
      added: [...withDuck].filter((reply) => !baseSet.has(reply)).length,
    };
  });
  cached = { board: after.board, baseReplies: base.length, points };
  return cached;
}

// The duck's own yellow, for "a point the duck could land on"; the article's
// orange for "the duck takes replies away"; a quiet grey for "changes nothing".
// Fixed colours, not theme tokens: every board theme is a light surface, and
// the legend has to name the same colour the board shows.
const DUCK_YELLOW = '#f2c230';
const MARK_INK = '#2b2118';
const REMOVED_ORANGE = '#c8650f';
const NO_EFFECT_GREY = '#8f8a80';

const HEAD_LINE = 15;
const HEAD_TOP = 14;
const LEGEND_LINE = 13;
const LEGEND_GAP = 16;
const LEGEND_TEXT_X = 22;

type Mode = 'all' | 'matter';

// Line breaks are set by hand: a single board is 284 units wide, and SVG text
// does not wrap.
const COPY: Record<
  Mode,
  { heading: string[]; legend: Array<{ mark: 'duck' | 'removed' | 'none'; lines: string[] }> }
> = {
  all: {
    heading: ['After cannon h3 to e3, the duck can land', 'on any of these 58 points'],
    legend: [
      {
        mark: 'duck',
        lines: ['A point the duck can land on. Each one', 'is a different position.'],
      },
    ],
  },
  matter: {
    heading: ['Only 30 of those 58 points change', 'what black can play'],
    legend: [
      {
        mark: 'removed',
        lines: ['A duck here takes this many of black’s', '45 replies away'],
      },
      { mark: 'none', lines: ['A duck here changes nothing for black'] },
    ],
  },
};

const escapeXml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Disc radius for a point that takes `removed` replies away: bigger takes more. */
function removedRadius(removed: number): number {
  return xqPieceSize() * (0.2 + 0.035 * removed);
}

function duckDot(x: number, y: number, r = xqPieceSize() * 0.18): string {
  return `<circle class="duck-tree-mark" data-mark="duck" cx="${x}" cy="${y}" r="${r}" fill="${DUCK_YELLOW}" stroke="${MARK_INK}" stroke-width="1"/>`;
}

function noEffectDot(x: number, y: number, r = xqPieceSize() * 0.1): string {
  return `<circle class="duck-tree-mark" data-mark="none" cx="${x}" cy="${y}" r="${r}" fill="${NO_EFFECT_GREY}" opacity="0.8"/>`;
}

function removedDisc(x: number, y: number, removed: number, r = removedRadius(removed)): string {
  return [
    `<g class="duck-tree-mark" data-mark="removed" data-removed="${removed}">`,
    `<circle cx="${x}" cy="${y}" r="${r}" fill="${REMOVED_ORANGE}" stroke="#ffffff" stroke-width="1"/>`,
    `<text x="${x}" y="${y}" dominant-baseline="central" text-anchor="middle" font-family="system-ui, sans-serif" font-size="${xqPieceSize() * 0.36}" font-weight="800" fill="#ffffff">${removed}</text>`,
    `</g>`,
  ].join('');
}

function pointMarks(mode: Mode, x0: number, boardY: number): string {
  const { points } = duckTreeH3e3Marks();
  return points
    .map((point) => {
      const { file, rank } = xqCoord(point.square as XiangqiSquare);
      const { x, y } = xqPoint(file, rank, 'red', x0, boardY);
      const mark =
        mode === 'all'
          ? duckDot(x, y)
          : point.removed > 0 || point.added > 0
            ? removedDisc(x, y, point.removed)
            : noEffectDot(x, y);
      return `<g data-point="${point.square}">${mark}</g>`;
    })
    .join('');
}

function legendSvg(mode: Mode, top: number): { svg: string; height: number } {
  const parts: string[] = [];
  let y = top;
  for (const row of COPY[mode].legend) {
    const markY = y;
    const markX = 9;
    parts.push(
      row.mark === 'duck'
        ? duckDot(markX, markY, 6)
        : row.mark === 'removed'
          ? removedDisc(markX, markY, 4, 8)
          : noEffectDot(markX, markY, 3.5),
    );
    row.lines.forEach((line, index) => {
      parts.push(
        `<text x="${LEGEND_TEXT_X}" y="${y + index * LEGEND_LINE}" dominant-baseline="central" font-family="system-ui, sans-serif" font-size="11" class="xq-diagram-outside-text">${escapeXml(line)}</text>`,
      );
    });
    y += row.lines.length * LEGEND_LINE + 8;
  }
  return { svg: `<g class="duck-tree-legend">${parts.join('')}</g>`, height: y - top };
}

// The board, its pieces, the h3-e3 arrow and the point marks, with the board's
// top edge at `boardY`. Both the article figures and the index card draw this;
// only the figures add a heading and a legend around it.
function boardLayers(mode: Mode, boardY: number): string {
  const { board } = duckTreeH3e3Marks();
  const state = xqVisionDemoState(
    `duck-tree-${mode}`,
    board as unknown as Partial<Record<XiangqiSquare, XiangqiPiece>>,
  );
  return [
    xqBoardGrid(0, boardY, 'red'),
    xqPiecesLayer(state, null, 0, boardY, 'red'),
    xqArrowLayer(
      [{ from: MOVE.from as XiangqiSquare, to: MOVE.to as XiangqiSquare }],
      0,
      boardY,
      'red',
    ),
    pointMarks(mode, 0, boardY),
  ].join('');
}

/**
 * One of the two figures: the board after h3-e3 with a mark on every point the
 * duck can land on. `all` gives every point the duck's yellow; `matter` numbers
 * the points that change black's replies and greys the rest.
 *
 * `alt` is the figure's <title>, not an aria-label: the zh pages swap SVG
 * <text> and <title> nodes by their English text (localizeSvgMarkup in
 * articles.ts), and an attribute would stay English.
 */
export function duckTreeBoardSvg(mode: Mode, alt: string): string {
  const copy = COPY[mode];
  const headHeight = HEAD_TOP + copy.heading.length * HEAD_LINE - 4;
  const boardY = headHeight;
  const heading = copy.heading
    .map(
      (line, index) =>
        `<text x="${XQ_BOARD_W / 2}" y="${HEAD_TOP + index * HEAD_LINE}" font-family="system-ui, sans-serif" font-size="12.5" font-weight="700" class="xq-diagram-title" text-anchor="middle">${escapeXml(line)}</text>`,
    )
    .join('');
  const legend = legendSvg(mode, boardY + XQ_BOARD_H + LEGEND_GAP);
  const body = [heading, boardLayers(mode, boardY), legend.svg].join('');
  const height = boardY + XQ_BOARD_H + LEGEND_GAP + legend.height - 4;
  return xqSvg(XQ_BOARD_W, height, body).replace(
    /^<svg\b[^>]*>/,
    (open) => `${open}<title>${escapeXml(alt)}</title>`,
  );
}

/**
 * The index card: the `matter` board alone, with no heading, legend or title,
 * framed like the other full-board xiangqi cards (XQ_RULES_PRIMER_THUMBNAIL).
 * The only text is the disc numerals. A render thunk on the card re-runs this
 * on a piece-set change, so the card follows the reader's pieces.
 */
export function duckTreeThumbnailSvg(): string {
  // aria-hidden: the card's title names it, and its 30 numerals would
  // otherwise be read out as part of the card link ("1 1 2 2 3 ...").
  return xqSvg(XQ_BOARD_W, XQ_BOARD_H, boardLayers('matter', 0)).replace(
    'role="img"',
    'aria-hidden="true"',
  );
}
