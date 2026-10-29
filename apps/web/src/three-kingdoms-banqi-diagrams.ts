// Three Kingdoms banqi (三國暗棋) rules-page diagrams, in the banqi page's idiom
// (banqi-rules-diagrams.ts): every rule drawn on a board, with the board's own
// move hints, a dot for a point the selected piece can move to and a ring for a
// piece it can capture. Each diagram asks the kernel
// (getThreeKingdomsBanqiLegalMoves) for the marks and throws if they differ
// from what the diagram means to show, so a wrong picture fails the build.
//
// The board differs from banqi's in one way that matters: pieces stand on the
// 45 INTERSECTIONS of a 9x5 line grid, as in xiangqi, not in the 32 cells.
// Everything else is borrowed: the wood, grid, jade backs, selection and hint
// colours come from live-banqi-board.css, and the pieces from the active
// xiangqi piece set. The local-playtest room board
// (renderThreeKingdomsBanqiLiveBoardSvg, at the bottom) draws through the same
// helpers.

import {
  ALL_THREE_KINGDOMS_BANQI_SQUARES,
  type BanqiPieceRole,
  getThreeKingdomsBanqiLegalMoves,
  THREE_KINGDOMS_BANQI_POINTS,
  THREE_KINGDOMS_BANQI_SETUP_SQUARES,
  type ThreeKingdomsBanqiSquare,
  type ThreeKingdomsBanqiState,
} from '@mistboard/game';
import { activeXiangqiPieceSet } from './articles/diagrams.js';
import { glideSvgPiece, pieceAnimationDurationMs } from './board-anim.js';
import {
  animateBoardLastMoveArrival,
  BOARD_LASTMOVE_OVER_GROUP_ATTRS,
  type BoardLastMovePiece,
  boardLastMoveMarkersSvg,
  boardLastMovePiece,
} from './board-lastmove.js';
import './board-lastmove.css';
import { boardCornerRadius } from './board-metrics.js';
import './live-banqi-board.css';
import './three-kingdoms-banqi-board.css';
import {
  BANQI_PIECE_SHAPE,
  banqiFaceDownRadius,
  banqiPieceDrawSize,
  banqiTile3dBox,
  banqiTile3dEnabled,
  banqiTile3dMarkup,
  flipBanqiFamilyReveal,
  flipBanqiTile3dReveal,
} from './live-banqi-render.js';
import { BANQI_PIECE_3D, piece3dLook, round2 } from './piece-3d.js';
import {
  renderXiangqiPieceGlyphed,
  xiangqiBanqiBackMarks,
  xiangqiPieceShadowEnabled,
  xiangqiPieceShadowMarks,
} from './xiangqi-piece-sets.js';

type Square = ThreeKingdomsBanqiSquare;

const FILES = 'abcdefghi';
const SPAN_X = 8; // gaps between the 9 vertical lines
const SPAN_Y = 4; // gaps between the 5 horizontal lines
const CELL = 64;
// A piece on an edge point reaches half its width past the line, so the frame
// holds that plus a few units of wood.
const PIECE_SIZE = banqiPieceDrawSize(CELL);
const MARGIN = Math.ceil(PIECE_SIZE / 2) + 6;
const WIDTH = MARGIN * 2 + SPAN_X * CELL;
const HEIGHT = MARGIN * 2 + SPAN_Y * CELL;
const PIECE_EDGE_R = (CELL * 0.92) / 2;
const HINT_DOT_R = 10;
const SELECTION_R = CELL / 2;

function point(square: Square): { x: number; y: number } {
  const file = FILES.indexOf(square[0]);
  const rank = Number(square[1]);
  return { x: MARGIN + file * CELL, y: MARGIN + (SPAN_Y - (rank - 1)) * CELL };
}

function gridLines(): string {
  const parts: string[] = [];
  for (let r = 0; r <= SPAN_Y; r += 1) {
    const y = MARGIN + r * CELL;
    parts.push(`<line x1="${MARGIN}" y1="${y}" x2="${MARGIN + SPAN_X * CELL}" y2="${y}"/>`);
  }
  for (let f = 0; f <= SPAN_X; f += 1) {
    const x = MARGIN + f * CELL;
    parts.push(`<line x1="${x}" y1="${MARGIN}" x2="${x}" y2="${MARGIN + SPAN_Y * CELL}"/>`);
  }
  return parts.join('');
}

// The banqi room's face-down tile (live-banqi-render.ts faceDownDisc), centred
// on a point instead of a cell.
function faceDown(cx: number, cy: number): string {
  const marks = xiangqiBanqiBackMarks(activeXiangqiPieceSet);
  const shadowOn = xiangqiPieceShadowEnabled();
  if (marks) {
    const shadow = shadowOn ? xiangqiPieceShadowMarks(45) : '';
    const overflow = shadow ? ' overflow="visible"' : '';
    return `<g class="banqi-back"><svg x="${cx - PIECE_SIZE / 2}" y="${cy - PIECE_SIZE / 2}" width="${PIECE_SIZE}" height="${PIECE_SIZE}"${overflow} viewBox="0 0 100 100">${shadow}${marks}</svg></g>`;
  }
  const r = banqiFaceDownRadius(PIECE_SIZE);
  const shadow = shadowOn ? xiangqiPieceShadowMarks(r + 1, cx, cy, PIECE_SIZE) : '';
  return `<g class="banqi-back">${shadow}<circle cx="${cx}" cy="${cy}" r="${r}"/></g>`;
}

/** A point's content in a diagram: a revealed piece, or a face-down tile. */
export type TkDiagramEntry = { color: 'red' | 'black'; role: BanqiPieceRole } | 'down';
export type TkDiagramBoard = Partial<Record<Square, TkDiagramEntry>>;

function renderBoard(
  id: string,
  board: TkDiagramBoard,
  selected?: Square,
  targets: readonly Square[] = [],
): string {
  // 3D tiles (the reader's setting, on by default): the same tile as the room's,
  // disc and rim centred on the point and sized to the gap.
  const tile3d = banqiTile3dEnabled();
  const pieces = ALL_THREE_KINGDOMS_BANQI_SQUARES.map((square) => {
    const entry = board[square];
    if (!entry) return '';
    const { x, y } = point(square);
    if (tile3d) {
      return banqiTile3dMarkup({ x, y }, entry === 'down' ? null : entry, activeXiangqiPieceSet);
    }
    return entry === 'down'
      ? faceDown(x, y)
      : renderXiangqiPieceGlyphed(entry, activeXiangqiPieceSet, {
          ariaLabel: `${entry.color} ${entry.role}`,
          className: 'banqi-piece',
          shrouded: false,
          x: x - PIECE_SIZE / 2,
          y: y - PIECE_SIZE / 2,
          size: PIECE_SIZE,
          shape: BANQI_PIECE_SHAPE,
        });
  }).join('');
  const selection = selected
    ? (({ x, y }) => `<circle class="banqi-selection" cx="${x}" cy="${y}" r="${SELECTION_R}"/>`)(
        point(selected),
      )
    : '';
  const hints = targets
    .map((to) => {
      const { x, y } = point(to);
      return board[to]
        ? `<circle class="banqi-hint-capture" cx="${x}" cy="${y}" r="${PIECE_EDGE_R}"/>`
        : `<circle class="banqi-hint" cx="${x}" cy="${y}" r="${HINT_DOT_R}"/>`;
    })
    .join('');
  const svg = `<svg data-tk-banqi-diagram="${id}" class="banqi-board" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Three Kingdoms banqi board">
    <rect class="banqi-board-bg" x="0" y="0" width="${WIDTH}" height="${HEIGHT}" rx="${boardCornerRadius(WIDTH)}"/>
    <g class="banqi-grid">${gridLines()}</g>
    ${selection}${pieces}${hints}
  </svg>`;
  return responsive(svg, WIDTH);
}

function responsive(svg: string, maxWidth: number): string {
  return svg
    .trim()
    .replace(
      '<svg ',
      `<svg width="100%" style="max-width:${maxWidth}px;height:auto;display:block;margin:0 auto" `,
    );
}

// The kernel wants a colour and role under a face-down tile; a diagram does not
// care, since a face-down tile blocks and refuses capture whatever it hides.
const HIDDEN_FILLER = { color: 'black', role: 'soldier', faceDown: true } as const;

function diagramState(board: TkDiagramBoard, toMove: 'red' | 'black'): ThreeKingdomsBanqiState {
  const kernelBoard: ThreeKingdomsBanqiState['board'] = {};
  for (const square of ALL_THREE_KINGDOMS_BANQI_SQUARES) {
    const entry = board[square];
    if (!entry) continue;
    kernelBoard[square] = entry === 'down' ? { ...HIDDEN_FILLER } : { ...entry, faceDown: false };
  }
  // Red ink is bound to the red seat, which moves on even plies.
  return {
    id: 'diagram',
    board: kernelBoard,
    status: { type: 'playing', turn: toMove },
    ply: toMove === 'red' ? 0 : 1,
    moveNumber: 1,
    firstColor: 'red',
    scores: { red: 0, black: 0 },
    noProgressClock: 0,
    captures: [],
    repCounts: {},
  };
}

/** One position, one piece selected, every legal destination marked. `expect`
 *  lists the points the diagram means to show; the render throws if the kernel
 *  disagrees. */
export function tkMoveDiagram(opts: {
  id: string;
  board: TkDiagramBoard;
  from: Square;
  expect: readonly Square[];
}): () => string {
  return () => {
    const piece = opts.board[opts.from];
    if (!piece || piece === 'down')
      throw new Error(`three kingdoms diagram ${opts.id}: nothing to move on ${opts.from}`);
    const state = diagramState(opts.board, piece.color);
    const targets = getThreeKingdomsBanqiLegalMoves(state)
      .filter((m) => m.from === opts.from && m.to !== m.from)
      .map((m) => m.to)
      .sort();
    const expected = [...opts.expect].sort();
    if (targets.join(' ') !== expected.join(' ')) {
      throw new Error(
        `three kingdoms diagram ${opts.id}: kernel allows ${opts.from} -> [${targets.join(' ')}], diagram expects [${expected.join(' ')}]`,
      );
    }
    return renderBoard(opts.id, opts.board, opts.from, targets);
  };
}

const down = (squares: readonly Square[]): TkDiagramBoard =>
  Object.fromEntries(squares.map((s) => [s, 'down'])) as TkDiagramBoard;

// ── Setup ────────────────────────────────────────────────────────────────────

/** The deal: four face-down blocks of eight, middle column and row empty. */
export const TK_SETUP = (): string =>
  renderBoard('setup', down(THREE_KINGDOMS_BANQI_SETUP_SQUARES));

/** Card art: the deal with one tile turned up, like banqi's card. */
export const TK_THUMBNAIL = (): string =>
  renderBoard('thumbnail', {
    ...down(THREE_KINGDOMS_BANQI_SETUP_SQUARES.filter((s) => s !== 'c2')),
    c2: { color: 'red', role: 'horse' },
  });

// ── Points ───────────────────────────────────────────────────────────────────

const POINTS_ORDER: Array<{ role: BanqiPieceRole; label: string }> = [
  { role: 'general', label: 'General' },
  { role: 'chariot', label: 'Chariot' },
  { role: 'horse', label: 'Horse' },
  { role: 'cannon', label: 'Cannon' },
  { role: 'elephant', label: 'Elephant' },
  { role: 'advisor', label: 'Advisor' },
  { role: 'soldier', label: 'Soldier' },
];

/** Red row, black row, name and points under each: banqi's ladder, scored. */
export const TK_POINTS = (): string => {
  const slot = 80;
  const token = 50;
  const redCy = 6 + token / 2;
  const blackCy = redCy + 56;
  const labelY = blackCy + token / 2 + 17;
  const pointsY = labelY + 17;
  const width = POINTS_ORDER.length * slot;
  const height = pointsY + 8;
  const cells = POINTS_ORDER.map(({ role, label }, i) => {
    const cx = i * slot + slot / 2;
    const piece = (color: 'red' | 'black', cy: number) =>
      renderXiangqiPieceGlyphed({ color, role }, activeXiangqiPieceSet, {
        x: cx - token / 2,
        y: cy - token / 2,
        size: token,
      });
    return [
      piece('red', redCy),
      piece('black', blackCy),
      `<text x="${cx}" y="${labelY}" font-size="12" fill="currentColor" text-anchor="middle" font-weight="600">${label}</text>`,
      `<text x="${cx}" y="${pointsY}" font-size="13" fill="currentColor" text-anchor="middle" font-weight="700">${THREE_KINGDOMS_BANQI_POINTS[role]}</text>`,
    ].join('');
  }).join('');
  const svg = `<svg class="banqi-rank-ladder" viewBox="0 0 ${width} ${height}" role="img" xmlns="http://www.w3.org/2000/svg" aria-label="The Three Kingdoms banqi pieces and their points">${cells}</svg>`;
  return responsive(svg, 600);
};

// ── Moves ────────────────────────────────────────────────────────────────────

// The chariot slides until something stops it: the face-down tile blocks and
// cannot be taken, the black horse can be.
export const TK_CHARIOT = tkMoveDiagram({
  id: 'chariot',
  board: {
    c3: { color: 'red', role: 'chariot' },
    ...down(['f3']),
    c5: { color: 'black', role: 'horse' },
  },
  from: 'c3',
  expect: ['a3', 'b3', 'd3', 'e3', 'c1', 'c2', 'c4', 'c5'],
});

// The general slides like a chariot: no palace, no single step. The face-down
// tile stops it; the black cannon can be taken.
export const TK_GENERAL = tkMoveDiagram({
  id: 'general',
  board: {
    g2: { color: 'red', role: 'general' },
    ...down(['d2']),
    g4: { color: 'black', role: 'cannon' },
  },
  from: 'g2',
  expect: ['e2', 'f2', 'h2', 'i2', 'g1', 'g3', 'g4'],
});

// The cannon jumps exactly one piece to capture, and a face-down tile is a
// screen like any other.
export const TK_CANNON = tkMoveDiagram({
  id: 'cannon',
  board: {
    b3: { color: 'red', role: 'cannon' },
    ...down(['e3']),
    h3: { color: 'black', role: 'general' },
    b4: { color: 'black', role: 'soldier' },
  },
  from: 'b3',
  expect: ['a3', 'c3', 'd3', 'h3', 'b1', 'b2'],
});

// The horse is never blocked: every leg point is occupied, and it still
// reaches all eight points.
export const TK_HORSE = tkMoveDiagram({
  id: 'horse',
  board: {
    e3: { color: 'red', role: 'horse' },
    ...down(['e4', 'e2', 'd3']),
    f3: { color: 'red', role: 'soldier' },
    g4: { color: 'black', role: 'chariot' },
  },
  from: 'e3',
  expect: ['d1', 'f1', 'c2', 'g2', 'c4', 'g4', 'd5', 'f5'],
});

// The elephant jumps two points diagonally over anything, across the middle
// row; the face-down tile on its far point is not a destination.
export const TK_ELEPHANT = tkMoveDiagram({
  id: 'elephant',
  board: {
    e3: { color: 'red', role: 'elephant' },
    ...down(['d4', 'f2', 'g1']),
    f4: { color: 'black', role: 'advisor' },
  },
  from: 'e3',
  expect: ['c1', 'c5', 'g5'],
});

// The soldier steps one point in any of four directions, backward included.
export const TK_SOLDIER = tkMoveDiagram({
  id: 'soldier',
  board: {
    e3: { color: 'red', role: 'soldier' },
    e4: { color: 'black', role: 'chariot' },
  },
  from: 'e3',
  expect: ['d3', 'f3', 'e2', 'e4'],
});

// No rank order: the advisor takes the general.
export const TK_ADVISOR_TAKES_GENERAL = tkMoveDiagram({
  id: 'advisor-general',
  board: {
    e3: { color: 'red', role: 'advisor' },
    f4: { color: 'black', role: 'general' },
    ...down(['d2']),
  },
  from: 'e3',
  expect: ['f4', 'd4', 'f2'],
});

// ── Live room board (local playtest, #628) ───────────────────────────────────

/** Banqi's glide on this board's points: the piece that settled on `move.to`
 *  slides in from `move.from` (with `reverse`, back onto `move.from`) and the
 *  last-move tint fades in as it lands. A flip travels nowhere: no-op, as in
 *  banqi. Call after the render that drew the final position. */
export function animateThreeKingdomsBanqiBoardMove(
  host: HTMLElement,
  move: { from: Square; to: Square },
  opts: { reverse?: boolean } = {},
): void {
  if (move.from === move.to) return;
  const duration = pieceAnimationDurationMs();
  if (duration <= 0) return;
  const settle = opts.reverse ? move.from : move.to;
  const slot = host.querySelector(`[data-piece-square="${settle}"]`);
  if (!slot) return;
  const from = point(opts.reverse ? move.to : move.from);
  const to = point(settle);
  glideSvgPiece(slot, from.x - to.x, from.y - to.y, duration);
  // The gold band rides the piece in, as on xiangqi and jieqi. A reverse step
  // draws the prior move's marks elsewhere, so nothing follows that glide.
  if (!opts.reverse) animateBoardLastMoveArrival(host, from, to, duration);
}

/** Turn a live-flipped tile over (banqi's turn-over, on the point grid). The
 *  flip's mark in the flipper's ink (the flat ring, or a 3D tile's edge) turns
 *  up with the face, never before it. */
export function animateThreeKingdomsBanqiReveal(
  host: HTMLElement,
  square: Square,
  opts: { tile3d?: boolean } = {},
): boolean {
  const faceMark =
    host.querySelector('.tk-flip-ring') ?? host.querySelector('.xq-live-lastmove-ring');
  if (opts.tile3d ?? banqiTile3dEnabled()) {
    return flipBanqiTile3dReveal(host, square, point, activeXiangqiPieceSet, { faceMark });
  }
  return flipBanqiFamilyReveal(host, square, point, faceDown, undefined, faceMark);
}

/** The piece the last-move mark hugs on a 3D tile: the raised disc, so the mark
 *  is the tile's edge (board-lastmove.ts boardLastMoveEdgeSvg), as on xiangqi's
 *  3D pieces (piece-3d.ts xiangqiPiece3dMarkPiece). */
function tile3dMarkPiece(): BoardLastMovePiece {
  const box = banqiTile3dBox(CELL);
  const look = piece3dLook(activeXiangqiPieceSet, box, BANQI_PIECE_3D);
  return { box, outer: (look.radius * 100) / box, lift: round2(look.depth / 2) };
}

/** The live room's board geometry, for drag-ghost sizing. */
export const TK_LIVE_BOARD_VIEW = { width: WIDTH, height: HEIGHT, cell: CELL, files: 9 } as const;

export type TkLiveBoardEntry =
  | { color: 'red' | 'black'; role: BanqiPieceRole; faceDown: false }
  | { faceDown: true };

/** The room's board: the diagram board plus a `[data-square]` hit target on
 *  every point (board-drag.ts and the click handler read it), xiangqi's
 *  last-move marks, and the lifted piece hidden while dragged. */
export function renderThreeKingdomsBanqiLiveBoardSvg(
  board: Partial<Record<Square, TkLiveBoardEntry>>,
  opts: {
    selected: Square | null;
    targets: readonly Square[];
    draggingFrom: Square | null;
    lastMove: { from: Square; to: Square } | null;
    /** The ink of the seat that made `lastMove`. */
    lastMoveInk?: 'red' | 'black' | null;
    /** 3D tiles; unset reads the reader's setting (banqiTile3dEnabled). */
    tile3d?: boolean;
  },
): string {
  // Pieces sit on points, so the marks are xiangqi's and jieqi's: a pale wash
  // where the piece left and a gold band around the piece that landed; a flip
  // in place gets the band alone (Brian, 2026-10-28: "draw the last move
  // golden ring just like... Xiangqi and jieqi"). Was banqi's cell wash in the
  // mover's ink, which board_lastmove_two_grammars kept for cell boards.
  // A flip's band takes the flipper's ink instead of gold: the tile turned up
  // says nothing about who turned it (Brian, 2026-10-28: "only color the
  // flips"). The first flip binds its flipper to the colour turned up, so every
  // flip has an ink; gold stays only if a caller has none to give. A 3D
  // tile's edge band takes the mover's ink on a plain move too (Brian,
  // 2026-10-29: "color the edge of the moved piece either red or black"); the
  // flat ring stays gold for moves.
  // 3D tiles follow the reader's Pieces-menu setting, as banqi's room does; the
  // mark on a 3D tile is its edge, drawn over the pieces.
  const tile3d = opts.tile3d ?? banqiTile3dEnabled();
  const flip = opts.lastMove !== null && opts.lastMove.from === opts.lastMove.to;
  const ink = opts.lastMove ? (opts.lastMoveInk ?? null) : null;
  const markPiece = tile3d
    ? tile3dMarkPiece()
    : boardLastMovePiece(PIECE_SIZE, activeXiangqiPieceSet);
  const marks = (layer: 'under' | 'over'): string => {
    if (!opts.lastMove) return '';
    const svg = boardLastMoveMarkersSvg(
      { from: flip ? null : point(opts.lastMove.from), to: point(opts.lastMove.to) },
      PIECE_SIZE,
      layer,
      markPiece,
    );
    return ink
      ? svg.replace(/class="xq-live-lastmove-ring( xq-live-lastmove-edge)?"/, (whole, edge = '') =>
          flip || edge
            ? `class="xq-live-lastmove-ring${edge} tk-flip-ring tk-flip-ring--${ink}"`
            : whole,
        )
      : svg;
  };
  const marksOver = marks('over');
  const pieces = ALL_THREE_KINGDOMS_BANQI_SQUARES.map((square) => {
    const entry = board[square];
    if (!entry || square === opts.draggingFrom) return '';
    const { x, y } = point(square);
    if (tile3d) {
      const markup = banqiTile3dMarkup(
        { x, y },
        entry.faceDown ? null : entry,
        activeXiangqiPieceSet,
      );
      return `<g data-piece-square="${square}">${markup}</g>`;
    }
    const inner = entry.faceDown
      ? faceDown(x, y)
      : renderXiangqiPieceGlyphed(entry, activeXiangqiPieceSet, {
          ariaLabel: `${entry.color} ${entry.role}`,
          className: 'banqi-piece',
          shrouded: false,
          x: x - PIECE_SIZE / 2,
          y: y - PIECE_SIZE / 2,
          size: PIECE_SIZE,
          shape: BANQI_PIECE_SHAPE,
        });
    return `<g data-piece-square="${square}">${inner}</g>`;
  }).join('');
  const selection = opts.selected
    ? (({ x, y }) => `<circle class="banqi-selection" cx="${x}" cy="${y}" r="${SELECTION_R}"/>`)(
        point(opts.selected),
      )
    : '';
  const hints = opts.targets
    .map((to) => {
      const { x, y } = point(to);
      return board[to]
        ? `<circle class="banqi-hint-capture" cx="${x}" cy="${y}" r="${PIECE_EDGE_R}"/>`
        : `<circle class="banqi-hint" cx="${x}" cy="${y}" r="${HINT_DOT_R}"/>`;
    })
    .join('');
  const half = CELL / 2;
  const hits = ALL_THREE_KINGDOMS_BANQI_SQUARES.map((square) => {
    const { x, y } = point(square);
    const target = opts.targets.includes(square) ? ' banqi-hit--target' : '';
    return `<g data-square="${square}" class="banqi-hit${target}"><rect x="${x - half}" y="${y - half}" width="${CELL}" height="${CELL}"/></g>`;
  }).join('');
  return `<svg class="banqi-board" width="100%" style="height:auto;display:block" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Three Kingdoms banqi board">
    <rect class="banqi-board-bg" x="0" y="0" width="${WIDTH}" height="${HEIGHT}" rx="${boardCornerRadius(WIDTH)}"/>
    <g class="banqi-grid">${gridLines()}</g>
    ${marks('under')}${selection}${pieces}${marksOver ? `<g ${BOARD_LASTMOVE_OVER_GROUP_ATTRS}>${marksOver}</g>` : ''}${hints}${hits}
  </svg>`;
}
