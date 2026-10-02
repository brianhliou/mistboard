// Inline board diagrams for the Crazyhouse Xiangqi rules article.
//
// Drawn with the shared xiangqi article-diagram toolkit (articles/diagrams.ts),
// so they read as siblings of the Xiangqi primer and follow the reader's board
// layout and piece-set pickers. Every position, target and drop point comes
// from the game kernel (createInitialCrazyhouseXiangqiState,
// getCrazyhouseXiangqiLegalMovesFrom, getCrazyhouseXiangqiLegalDrops), never a
// hand-written list: a rules change redraws these figures, and a figure whose
// caption the kernel no longer supports throws instead of rendering a lie.
// The crossed points are pedagogy (where the piece would go if the river did
// not stop it), derived as the geometric step minus the kernel's answer.

import {
  type CrazyhouseXiangqiBoard,
  type CrazyhouseXiangqiDropRole,
  type CrazyhouseXiangqiGameState,
  createInitialCrazyhouseXiangqiState,
  getCrazyhouseXiangqiLegalDrops,
  getCrazyhouseXiangqiLegalMovesFrom,
  parseCrazyhouseXiangqiFen,
  type XiangqiSquare,
} from '@mistboard/game';
import {
  XQ_BOARD_H,
  XQ_BOARD_W,
  xqBoardSvg,
  xqDots,
  xqSvg,
  xqVisionDemoState,
} from './articles/diagrams.js';

const PAIR_GAP = 28;

function fromFen(fen: string): CrazyhouseXiangqiGameState {
  const parsed = parseCrazyhouseXiangqiFen(fen, 'chx-rules-diagram');
  if (!parsed.ok) throw new Error(`crazyhouse-xiangqi rules diagram: ${parsed.error}`);
  return parsed.state;
}

function demo(id: string, board: CrazyhouseXiangqiBoard) {
  return xqVisionDemoState(id, board);
}

const rankOf = (square: string) => Number(square.slice(1));

// ── The start ───────────────────────────────────────────────────────────────

const START = createInitialCrazyhouseXiangqiState('chx-rules-start');

/** The kernel's start: xiangqi without its advisors and elephants, which wait in hand. */
export const CRAZYHOUSE_XIANGQI_START_BOARD = () =>
  xqSvg(
    XQ_BOARD_W,
    XQ_BOARD_H + 52,
    xqBoardSvg({
      state: demo('chx-rules-start', START.board),
      x: 0,
      y: 0,
      label: 'START: ADVISORS AND ELEPHANTS IN HAND',
      perspective: 'red',
    }),
    'xq-article-svg--hero',
  );

/**
 * Every point where Red may drop an advisor (or an elephant) at the start:
 * each empty point of Red's half, none across the river.
 */
export const CRAZYHOUSE_XIANGQI_DROP_REGION_BOARD = () => {
  const drops = (role: CrazyhouseXiangqiDropRole) =>
    getCrazyhouseXiangqiLegalDrops(START, role)
      .map((move) => move.to)
      .sort();
  const advisor = drops('advisor');
  if (advisor.join() !== drops('elephant').join() || advisor.some((sq) => rankOf(sq) > 5)) {
    throw new Error('crazyhouse-xiangqi rules diagram: advisor and elephant drops left Red’s half');
  }
  return xqSvg(
    XQ_BOARD_W,
    XQ_BOARD_H + 52,
    xqBoardSvg({
      state: demo('chx-rules-drops', START.board),
      x: 0,
      y: 0,
      label: 'WHERE AN ADVISOR OR ELEPHANT MAY DROP',
      perspective: 'red',
      dots: xqDots(advisor),
    }),
  );
};

// ── Advisors and elephants on the river bank ────────────────────────────────

// A red advisor on e5 and a red elephant on c5, both on the river bank, with
// the generals out of the way (d1 and f10, off each other's file).
const BANK_FEN = '5k3/9/9/9/9/2B1A4/9/9/9/3K5[] w - - 0 1';
const BANK = fromFen(BANK_FEN);

function riverPanel(
  from: XiangqiSquare,
  steps: readonly (readonly [number, number])[],
  label: string,
  x: number,
): string {
  const targets = getCrazyhouseXiangqiLegalMovesFrom(BANK, from).map((move) => move.to);
  const file = from.charCodeAt(0) - 97;
  const rank = rankOf(from);
  const geometric = steps
    .map(([df, dr]) => [file + df, rank + dr] as const)
    .filter(([f, r]) => f >= 0 && f <= 8 && r >= 1 && r <= 10)
    .map(([f, r]) => `${String.fromCharCode(97 + f)}${r}` as XiangqiSquare);
  const crossed = geometric.filter((square) => !targets.includes(square));
  if (targets.some((square) => rankOf(square) > 5) || crossed.some((sq) => rankOf(sq) <= 5)) {
    throw new Error(`crazyhouse-xiangqi rules diagram: ${from} is not stopped by the river alone`);
  }
  return xqBoardSvg({
    state: demo(`chx-rules-${from}`, { [from]: BANK.board[from]! }),
    x,
    y: 0,
    label,
    perspective: 'red',
    dots: [...xqDots(targets), ...crossed.map((square) => ({ square, blocked: true }))],
  });
}

const DIAGONAL_1 = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;
const DIAGONAL_2 = DIAGONAL_1.map(([df, dr]) => [df * 2, dr * 2] as const);

/** Advisor one diagonal step, elephant two, anywhere on the own half; the river stops both. */
export const CRAZYHOUSE_XIANGQI_RIVER_PAIR = () =>
  xqSvg(
    XQ_BOARD_W * 2 + PAIR_GAP,
    XQ_BOARD_H + 52,
    [
      riverPanel('e5', DIAGONAL_1, 'ADVISOR', 0),
      riverPanel('c5', DIAGONAL_2, 'ELEPHANT', XQ_BOARD_W + PAIR_GAP),
    ].join(''),
  );
