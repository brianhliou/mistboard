// Inline board diagrams for the Atomic Xiangqi rules article.
//
// The board furniture, piece glyphs and marker vocabulary come from the shared
// xiangqi article-diagram toolkit (articles/diagrams.ts), so these figures read
// as siblings of the Xiangqi and Duck pages and follow the reader's board
// layout and piece-set pickers. The one mark of this page's own is the amber
// ring on a point an explosion cleared, the same mark the live board draws.
//
// Every "after" board and every ring is computed through the real kernel
// (atomicXiangqiBoardAfterMove, isAtomicXiangqiLegalMove), never hand-listed.
// A rules change that touches the blast shape, the soldier immunity or the
// cannon shot redraws these figures instead of leaving them quietly wrong.

import {
  type AtomicXiangqiBoard,
  type AtomicXiangqiMove,
  type AtomicXiangqiSquare,
  atomicXiangqiBoardAfterMove,
  atomicXiangqiStateFromFen,
  isAtomicXiangqiGeneralInCheck,
  isAtomicXiangqiLegalMove,
  type XiangqiSquare,
} from '@mistboard/game';
import {
  XQ_BOARD_H,
  XQ_BOARD_W,
  XQ_CELL,
  xqBoardSvg,
  xqCoord,
  xqPieceSize,
  xqPoint,
  xqSvg,
  xqVisionDemoState,
} from './articles/diagrams.js';

const PAIR_W = XQ_BOARD_W * 2 + 28;
const PAIR_GAP_X = XQ_BOARD_W + 28;
const FIGURE_H = XQ_BOARD_H + 34;
// xqBoardSvg draws its board at y + 28, under the label.
const BOARD_Y_OFFSET = 28;

function boardFromFen(id: string, fen: string): AtomicXiangqiBoard {
  const state = atomicXiangqiStateFromFen(fen, id);
  if (!state) throw new Error(`atomic-xiangqi rules diagram: bad FEN ${fen}`);
  return state.board;
}

function state(id: string, board: AtomicXiangqiBoard) {
  return xqVisionDemoState(id, board);
}

/** Amber rings on cleared points, the live board's aftermath mark. */
function blastRings(squares: readonly AtomicXiangqiSquare[], x0: number, y0: number): string {
  const size = xqPieceSize();
  return squares
    .map((square) => {
      const { file, rank } = xqCoord(square as XiangqiSquare);
      const { x, y } = xqPoint(file, rank, 'red', x0, y0 + BOARD_Y_OFFSET);
      return `<circle class="xq-marker--blast" cx="${x}" cy="${y}" r="${size / 2 + 2}" fill="rgba(217, 154, 30, 0.28)" stroke="#d99a1e" stroke-width="3" stroke-opacity="0.55"/>`;
    })
    .join('');
}

/** The points a capture on `move.to` would clear, read off the kernel. */
function blastOf(board: AtomicXiangqiBoard, move: AtomicXiangqiMove): AtomicXiangqiSquare[] {
  return atomicXiangqiBoardAfterMove(board, move).blast.map((victim) => victim.square);
}

function pair(
  id: string,
  before: { board: AtomicXiangqiBoard; label: string; move: AtomicXiangqiMove },
  afterLabel: string,
): string {
  const { board: after, blast } = atomicXiangqiBoardAfterMove(before.board, before.move);
  const cleared = blast.map((victim) => victim.square);
  return xqSvg(
    PAIR_W,
    FIGURE_H,
    xqBoardSvg({
      state: state(`${id}-before`, before.board),
      x: 0,
      y: 0,
      label: before.label,
      perspective: 'red',
      arrows: [{ from: before.move.from as XiangqiSquare, to: before.move.to as XiangqiSquare }],
      overlay: blastRings(cleared, 0, 0),
    }) +
      xqBoardSvg({
        state: state(`${id}-after`, after),
        x: PAIR_GAP_X,
        y: 0,
        label: afterLabel,
        perspective: 'red',
        overlay: blastRings(cleared, PAIR_GAP_X, 0),
      }),
  );
}

// ── A capture is an explosion ───────────────────────────────────────────────

// The plain case. Red's chariot on e3 takes the black horse on e6, with a
// black chariot on d6 and a black cannon on f6 beside it: all four go. Red's
// general stands on d1 so the emptied e-file does not make the capture a
// facing-generals illegality.
const BLAST_FEN = '4k4/9/9/9/3rnc3/9/9/4R4/9/3K5 w - - 0 1';
const BLAST_BOARD = boardFromFen('atomic-rules-blast', BLAST_FEN);
const BLAST_MOVE: AtomicXiangqiMove = { from: 'e3', to: 'e6' };

export const ATOMIC_XIANGQI_BLAST_PAIR = () =>
  pair(
    'atomic-rules-blast',
    { board: BLAST_BOARD, label: 'CHARIOT TAKES THE HORSE', move: BLAST_MOVE },
    'AFTER THE EXPLOSION',
  );

// Soldiers survive. Red's chariot on e2 takes the black horse on e5. Beside
// it: black soldiers on d5 and e6, and a black cannon on f5. The cannon goes,
// the soldiers stay.
const SOLDIER_FEN = '4k4/9/9/9/4p4/3pnc3/9/9/4R4/3K5 w - - 0 1';
const SOLDIER_BOARD = boardFromFen('atomic-rules-soldier', SOLDIER_FEN);
const SOLDIER_MOVE: AtomicXiangqiMove = { from: 'e2', to: 'e5' };

export const ATOMIC_XIANGQI_SOLDIER_PAIR = () =>
  pair(
    'atomic-rules-soldier',
    { board: SOLDIER_BOARD, label: 'CHARIOT TAKES THE HORSE', move: SOLDIER_MOVE },
    'THE SOLDIERS STAY',
  );

// ── The cannon shot ─────────────────────────────────────────────────────────

// Red's cannon on e2 fires over its own soldier on e4 and takes the black
// horse on e7. The black chariot on d7 and cannon on f7 beside it are not
// touched, and the screen is not touched.
const SHOT_FEN = '4k4/9/9/3rnc3/9/9/4P4/9/4C4/4K4 w - - 0 1';
const SHOT_BOARD = boardFromFen('atomic-rules-shot', SHOT_FEN);
const SHOT_MOVE: AtomicXiangqiMove = { from: 'e2', to: 'e7' };

export const ATOMIC_XIANGQI_SHOT_PAIR = () =>
  pair(
    'atomic-rules-shot',
    { board: SHOT_BOARD, label: 'CANNON TAKES THE HORSE', move: SHOT_MOVE },
    'ONLY THE TWO OF THEM',
  );

// ── Your general, and theirs ────────────────────────────────────────────────

// Red's chariot on d9 may take the black advisor on d10: the blast reaches the
// general on e10 and the game ends. Red's chariot on f2 may NOT take the black
// horse on f1: that blast would reach Red's own general on e1. Both verdicts
// come from the kernel's legality, and the figure would go blank on a kernel
// that disagreed.
const GENERALS_FEN = '3ak4/3R5/9/9/9/9/9/9/5R3/4Kn3 w - - 0 1';
const GENERALS_BOARD = boardFromFen('atomic-rules-generals', GENERALS_FEN);
const WIN_MOVE: AtomicXiangqiMove = { from: 'd9', to: 'd10' };
const SELF_MOVE: AtomicXiangqiMove = { from: 'f2', to: 'f1' };

export const ATOMIC_XIANGQI_GENERALS = () => {
  const generalsState = atomicXiangqiStateFromFen(GENERALS_FEN, 'atomic-rules-generals');
  if (!generalsState) throw new Error('atomic-xiangqi rules diagram: bad generals FEN');
  const winLegal = isAtomicXiangqiLegalMove(generalsState, WIN_MOVE);
  const selfLegal = isAtomicXiangqiLegalMove(generalsState, SELF_MOVE);
  if (!winLegal || selfLegal) return '';
  return xqSvg(
    PAIR_W,
    FIGURE_H,
    xqBoardSvg({
      state: state('atomic-rules-generals', GENERALS_BOARD),
      x: PAIR_GAP_X / 2,
      y: 0,
      label: 'ONE CAPTURE WINS, THE OTHER IS NOT A MOVE',
      perspective: 'red',
      arrows: [
        { from: WIN_MOVE.from as XiangqiSquare, to: WIN_MOVE.to as XiangqiSquare },
        { from: SELF_MOVE.from as XiangqiSquare, to: SELF_MOVE.to as XiangqiSquare },
      ],
      dots: [{ square: SELF_MOVE.to as XiangqiSquare, blocked: true }],
      overlay: blastRings(blastOf(GENERALS_BOARD, WIN_MOVE), PAIR_GAP_X / 2, 0),
    }),
  );
};

// ── Check, here ─────────────────────────────────────────────────────────────

// A red chariot on d9 bearing on the black advisor on d10. Nothing attacks the
// general on e10, and it is in check: taking the advisor blows it up. The
// figure is drawn only if the kernel agrees.
const CHECK_FEN = '3ak4/3R5/9/9/9/9/4P4/9/9/4K4 b - - 0 1';
const CHECK_BOARD = boardFromFen('atomic-rules-check', CHECK_FEN);

export const ATOMIC_XIANGQI_CHECK = () => {
  if (!isAtomicXiangqiGeneralInCheck(CHECK_BOARD, 'black')) return '';
  return xqSvg(
    PAIR_W,
    FIGURE_H,
    xqBoardSvg({
      state: state('atomic-rules-check', CHECK_BOARD),
      x: PAIR_GAP_X / 2,
      y: 0,
      label: 'BLACK IS IN CHECK',
      perspective: 'red',
      arrows: [{ from: 'd9' as XiangqiSquare, to: 'd10' as XiangqiSquare }],
      overlay: blastRings(blastOf(CHECK_BOARD, { from: 'd9', to: 'd10' }), PAIR_GAP_X / 2, 0),
    }),
  );
};

// ── Card thumbnail ──────────────────────────────────────────────────────────

// A window onto the aftermath of the first figure: the cleared points and the
// soldier that survived, cropped to the middle of the board so the card shows
// an explosion rather than a grid of specks. 16:10 to match the card media box.
const THUMB_ASPECT = 16 / 10;

export const ATOMIC_XIANGQI_THUMBNAIL = () => {
  const { board: after, blast } = atomicXiangqiBoardAfterMove(BLAST_BOARD, BLAST_MOVE);
  const boardY = BOARD_Y_OFFSET;
  const centre = xqPoint(4, 6, 'red', 0, boardY);
  const w = XQ_CELL * 5.2;
  const h = w / THUMB_ASPECT;
  const left = centre.x - w / 2;
  const top = centre.y - h / 2;
  const board = xqBoardSvg({
    state: state('atomic-card', after),
    x: 0,
    y: 0,
    label: '',
    perspective: 'red',
    overlay: blastRings(
      blast.map((victim) => victim.square),
      0,
      0,
    ),
  });
  return `<svg class="xq-article-svg" viewBox="${left} ${top} ${w} ${h}" role="img" aria-label="Atomic Xiangqi" xmlns="http://www.w3.org/2000/svg"><rect class="xq-diagram-bg" x="${left}" y="${top}" width="${w}" height="${h}"/>${board}</svg>`;
};

// ── The cork ────────────────────────────────────────────────────────────────

// From the two-million-node best-play game, ply 32. Black's general is on f10
// and Red's chariot on f3 wants the file; Black's cannon on f4 stands directly
// in front of it. Under the cannon-shot rule the cannon threatens nothing back
// (its shot would take one piece, and the chariot is not on the far side of a
// screen), so the block is quiet: the new chariot-against-cannon idea.
const CORK_FEN = 'r1ba1kbn1/2R1a4/2r6/p3p1p1p/9/3N2P2/Pc2Pc2P/BC3R3/4A4/4KABN1 w - - 10 17';
const CORK_BOARD = boardFromFen('atomic-rules-cork', CORK_FEN);

export const ATOMIC_XIANGQI_CORK = () =>
  xqSvg(
    PAIR_W,
    FIGURE_H,
    xqBoardSvg({
      state: state('atomic-rules-cork', CORK_BOARD),
      x: PAIR_GAP_X / 2,
      y: 0,
      label: 'THE CORK: A CANNON IN FRONT OF THE CHARIOT',
      perspective: 'red',
      arrows: [{ from: 'f3' as XiangqiSquare, to: 'f10' as XiangqiSquare }],
      dots: [{ square: 'f4' as XiangqiSquare, blocked: true }],
    }),
  );
