// Inline board diagrams for the Duck Xiangqi rules article.
//
// The board furniture, piece glyphs and marker vocabulary come from the shared
// xiangqi article-diagram toolkit (articles/diagrams.ts), so these figures read
// as siblings of the Xiangqi and Jieqi pages and follow the reader's board
// layout and piece-set pickers. Only the duck is drawn here, as an overlay
// above the pieces: it belongs to neither side, so it is deliberately not a
// piece the piece layer knows about.
//
// Every dot and cross is computed through the real kernel
// (duckXiangqiMovesFrom, duckXiangqiDuckDestinations), never hand-listed. A
// rules change that touches blocking or the facing rule redraws these figures
// instead of leaving them quietly wrong. Where a figure shows a subset (the
// cannon's own file), it is filtered from the kernel's answer rather than
// retyped, and the crosses are a diff of the kernel with and without the duck.

import {
  createInitialDuckXiangqiState,
  type DuckXiangqiBoard,
  type DuckXiangqiSquare,
  duckXiangqiDuckDestinations,
  duckXiangqiGeneralsFace,
  duckXiangqiMovesFrom,
  type XiangqiPiece,
  type XiangqiSquare,
} from '@mistboard/game';
import {
  activeXiangqiPieceSet,
  XQ_BOARD_H,
  XQ_BOARD_W,
  xqBoardSvg,
  xqCoord,
  xqPieceSize,
  xqPoint,
  xqSvg,
  xqVisionDemoState,
} from './articles/diagrams.js';
import { duckPieceMarks } from './xiangqi-piece-sets.js';

// Same pair canvas the Jieqi figures use, so two-board rows on this page line
// up with two-board rows everywhere else in the xiangqi family.
const PAIR_W = XQ_BOARD_W * 2 + 28;
const PAIR_GAP_X = XQ_BOARD_W + 28;
const FIGURE_H = XQ_BOARD_H + 52;
// xqBoardSvg draws its board at y + 28, under the label. An overlay has to use
// the same offset or the duck lands 28px above the point it is standing on.
const BOARD_Y_OFFSET = 28;

type Dot = { square: XiangqiSquare; blocked?: boolean; capture?: boolean };

function state(id: string, board: DuckXiangqiBoard) {
  return xqVisionDemoState(id, board as unknown as Partial<Record<XiangqiSquare, XiangqiPiece>>);
}

function dots(squares: readonly DuckXiangqiSquare[]): Dot[] {
  return squares.map((square) => ({ square: square as XiangqiSquare }));
}

/** The destinations the duck takes away: kernel targets without it, minus with. */
function blockedByDuck(
  board: DuckXiangqiBoard,
  duck: DuckXiangqiSquare,
  from: DuckXiangqiSquare,
): Dot[] {
  const reachable = new Set(duckXiangqiMovesFrom(board, duck, from));
  return duckXiangqiMovesFrom(board, undefined, from)
    .filter((square) => !reachable.has(square))
    .map((square) => ({ square: square as XiangqiSquare, blocked: true }));
}

/**
 * The duck token, drawn above the pieces so it never reads as either seat's
 * material, which is the one thing a shared blocker must not be mistaken for.
 *
 * This is the SAME art the live board and every piece set use
 * (`duckPieceMarks`), not a local drawing: the marks are authored in the same
 * 100-unit piece box as every disc here, so the duck follows the reader's
 * piece-set picker exactly as the pieces around it do. It used to be a 🦆 emoji
 * on a flat yellow circle, which ignored the picker and did not match the duck
 * a reader meets the moment they open a game.
 */
function duckOverlay(square: DuckXiangqiSquare, x0: number, y0: number): string {
  const { file, rank } = xqCoord(square as XiangqiSquare);
  const { x, y } = xqPoint(file, rank, 'red', x0, y0 + BOARD_Y_OFFSET);
  const size = xqPieceSize();
  return [
    `<g aria-label="duck">`,
    `<g transform="translate(${x - size / 2},${y - size / 2}) scale(${size / 100})">`,
    duckPieceMarks(activeXiangqiPieceSet),
    `</g>`,
    `</g>`,
  ].join('');
}

// ── Starting position ───────────────────────────────────────────────────────

// The standard xiangqi array, and no duck: it starts off the board and enters
// as the second half of Red's first turn. Doubles as the article thumbnail.
const START_BOARD = createInitialDuckXiangqiState('duck-rules-start').board;

export const DUCK_XIANGQI_START_BOARD = () =>
  xqSvg(
    XQ_BOARD_W,
    FIGURE_H,
    xqBoardSvg({
      state: state('duck-rules-start', START_BOARD),
      x: 0,
      y: 0,
      label: 'STARTING POSITION, NO DUCK YET',
      perspective: 'red',
    }),
    'xq-article-svg--hero',
  );

export const DUCK_XIANGQI_THUMBNAIL = () =>
  xqSvg(
    XQ_BOARD_W,
    FIGURE_H,
    xqBoardSvg({
      state: state('duck-rules-thumb', START_BOARD),
      x: 0,
      y: 0,
      label: 'DUCK XIANGQI',
      perspective: 'red',
      overlay: duckOverlay('e5', 0, 0),
    }),
  );

// ── One turn, two actions ───────────────────────────────────────────────────

// The ENGINE's own first choice from the opening array, not a hand-picked move:
// `b1c3,c3c8`, depth 11, from the patched Fairy-Stockfish build. The UCI token
// carries both halves of the turn, and the duck half's "from" is a redundant
// echo of the piece's destination, so this is horse b1 to c3, then the duck to
// c8. Worth showing over a tidy opening move that stays near home: the engine
// parks the duck in Black's half on move one, which demonstrates the placement
// rule instead of only asserting it.
const TURN_AFTER_MOVE: DuckXiangqiBoard = (() => {
  const board = { ...START_BOARD };
  const horse = board.b1;
  delete board.b1;
  if (horse) board.c3 = horse;
  return board;
})();

export const DUCK_XIANGQI_TURN_PAIR = () =>
  xqSvg(
    PAIR_W,
    FIGURE_H,
    [
      xqBoardSvg({
        state: state('duck-rules-turn-move', START_BOARD),
        x: 0,
        y: 0,
        label: 'FIRST: A LEGAL XIANGQI MOVE',
        perspective: 'red',
        arrows: [{ from: 'b1' as XiangqiSquare, to: 'c3' as XiangqiSquare }],
      }),
      xqBoardSvg({
        state: state('duck-rules-turn-duck', TURN_AFTER_MOVE),
        x: PAIR_GAP_X,
        y: 0,
        label: 'THEN: THE DUCK',
        perspective: 'red',
        overlay: duckOverlay('c8', PAIR_GAP_X, 0),
      }),
    ].join(''),
  );

// ── The duck blocks like a piece ────────────────────────────────────────────

const HORSE_BOARD: DuckXiangqiBoard = { e5: { color: 'red', role: 'horse' } };

export const DUCK_XIANGQI_HORSE_PAIR = () =>
  xqSvg(
    PAIR_W,
    FIGURE_H,
    [
      xqBoardSvg({
        state: state('duck-rules-horse-open', HORSE_BOARD),
        x: 0,
        y: 0,
        label: 'HORSE, OPEN',
        perspective: 'red',
        dots: dots(duckXiangqiMovesFrom(HORSE_BOARD, undefined, 'e5')),
      }),
      xqBoardSvg({
        state: state('duck-rules-horse-blocked', HORSE_BOARD),
        x: PAIR_GAP_X,
        y: 0,
        label: 'HORSE, LEG BLOCKED',
        perspective: 'red',
        dots: [
          ...dots(duckXiangqiMovesFrom(HORSE_BOARD, 'e6', 'e5')),
          ...blockedByDuck(HORSE_BOARD, 'e6', 'e5'),
        ],
        overlay: duckOverlay('e6', PAIR_GAP_X, 0),
      }),
    ].join(''),
  );

const CANNON_BOARD: DuckXiangqiBoard = {
  e3: { color: 'red', role: 'cannon' },
  e8: { color: 'black', role: 'chariot' },
};

// The cannon's own file only. Sideways moves are the ordinary xiangqi picture
// and would bury the point; the filter runs over the kernel's answer, so the
// squares shown are still the kernel's and never a hand-drawn set.
function fileEOnly(squares: readonly DuckXiangqiSquare[]): DuckXiangqiSquare[] {
  return squares.filter((square) => square.startsWith('e'));
}

export const DUCK_XIANGQI_CANNON_SCREEN = () => {
  const targets = fileEOnly(duckXiangqiMovesFrom(CANNON_BOARD, 'e6', 'e3'));
  return xqSvg(
    XQ_BOARD_W,
    FIGURE_H,
    xqBoardSvg({
      state: state('duck-rules-cannon', CANNON_BOARD),
      x: 0,
      y: 0,
      label: 'THE DUCK IS A SCREEN',
      perspective: 'red',
      dots: targets.map((square) => ({
        square: square as XiangqiSquare,
        capture: CANNON_BOARD[square] !== undefined,
      })),
      overlay: duckOverlay('e6', 0, 0),
    }),
  );
};

// ── The generals may face ───────────────────────────────────────────────────

// Nothing stands on file e but the duck, so the duck is the only reason Red
// still has a general, and it has to move every turn.
//
// REDRAWN 2026-09-10 with D5. The dots used to be the duck's LEGAL placements,
// because the kernel confined it to this segment. Every empty point is legal
// now, so dotting the legal set would paint 86 marks and say nothing. The dots
// are the placements that do not LOSE: the ones that leave the generals still
// blocked from each other. Filtered from the kernel's own answer with the
// kernel's own threat predicate, never hand-listed, so this figure follows the
// rule if the rule moves again.
const FACING_BOARD: DuckXiangqiBoard = {
  e2: { color: 'red', role: 'general' },
  e9: { color: 'black', role: 'general' },
  a4: { color: 'red', role: 'soldier' },
};

/** The board the illustrated turn produces, before the duck lands. */
const FACING_AFTER_MOVE: DuckXiangqiBoard = (() => {
  const board = { ...FACING_BOARD };
  const soldier = board.a4;
  delete board.a4;
  if (soldier) board.a5 = soldier;
  return board;
})();

export const DUCK_XIANGQI_FACING_PIN = () =>
  xqSvg(
    XQ_BOARD_W,
    FIGURE_H,
    xqBoardSvg({
      state: state('duck-rules-facing', FACING_BOARD),
      x: 0,
      y: 0,
      label: 'THE ONLY PLACEMENTS THAT SURVIVE',
      perspective: 'red',
      dots: dots(
        duckXiangqiDuckDestinations(FACING_BOARD, 'e5', 'a4', 'a5').filter(
          (square) => !duckXiangqiGeneralsFace(FACING_AFTER_MOVE, square),
        ),
      ),
      overlay: duckOverlay('e5', 0, 0),
    }),
  );
