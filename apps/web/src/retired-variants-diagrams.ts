// Board diagrams for the article on taking Fortress and Atomic Xiangqi back
// to the drawing board.
//
// The Fortress figure is the drop mate that ends an engine self-play game,
// replayed move by move through the Fortress kernel: every move must be legal,
// the last must be a soldier drop, and the kernel must call the result
// checkmate. The guard the arrow claims for the horse is checked too.
//
// The Atomic figure is a four-board strip of the chariot/cannon shuffle under
// the lab's four-point design kernel, in which a cannon's capture explodes like
// any other; the card thumbnail is its board (b), with the cannon's shot. Both
// are drawn with the site's diagram toolkit so they follow the reader's piece
// set, and every claim the article makes about them is asserted at load.

import {
  applyFortressXiangqiMove,
  createInitialFortressXiangqiState,
  createXiangqiRuleKernel,
  type FortressXiangqiBoard,
  type FortressXiangqiGameState,
  type FortressXiangqiSquare,
  fsfUciToFortressXiangqiMove,
  getFortressXiangqiPlayerView,
  isFortressXiangqiDropMove,
  isFortressXiangqiLegalMove,
  type XiangqiBoard,
  type XiangqiMove,
  type XiangqiRuleConfig,
  type XiangqiRuleState,
  type XiangqiSquare,
} from '@mistboard/game';
import {
  XQ_BOARD_H,
  XQ_BOARD_W,
  xqBoardSvg,
  xqCoord,
  xqHalfBoardThumbnailSvg,
  xqPieceSize,
  xqPoint,
  xqSvg,
  xqVisionDemoState,
} from './articles/diagrams.js';
import { BOARD_CORNER_RATIO } from './board-metrics.js';
import {
  installFortressXiangqiBoardStyles,
  renderFortressXiangqiBoardSvg,
} from './fortress-xiangqi-render.js';

// The four-point design rules from the Atomic Xiangqi lab (the generator's
// `kernel`): orthogonal blast, soldiers immune, facing rule on, perpetual check
// loses, and a cannon shot that explodes like any capture.
const FOUR_POINT_RULES: XiangqiRuleConfig = {
  facing: 'file',
  stalemate: 'loss',
  progressClock: 60,
  repetition: 'perpetualCheckLoses',
  blast: { shape: 'orthogonal', immune: ['soldier'], palaceContained: false },
};
const fourPoint = createXiangqiRuleKernel(FOUR_POINT_RULES);

function play(state: XiangqiRuleState, uci: string): XiangqiRuleState {
  const move = fourPoint.fromUci(state, uci);
  if (!move || !fourPoint.isLegal(state, move))
    throw new Error(`retired-variants diagram: ${uci} should be legal under the four-point rules`);
  return fourPoint.apply(state, move);
}

/** Points a move empties besides its origin: the blast, as the kernel applies it. */
function emptiedBy(before: XiangqiBoard, after: XiangqiBoard, move: XiangqiMove): XiangqiSquare[] {
  return (Object.keys(before) as XiangqiSquare[]).filter(
    (square) => square !== move.from && after[square] === undefined,
  );
}

// xqBoardSvg draws its board at y + 28, under the label.
const BOARD_Y_OFFSET = 28;

/** Amber rings on cleared points, the mark the Atomic Xiangqi pages use. */
function blastRings(squares: readonly XiangqiSquare[], x0: number, y0: number): string {
  const size = xqPieceSize();
  return squares
    .map((square) => {
      const { file, rank } = xqCoord(square);
      const { x, y } = xqPoint(file, rank, 'red', x0, y0 + BOARD_Y_OFFSET);
      return `<circle class="xq-marker--blast" cx="${x}" cy="${y}" r="${size / 2 + 2}" fill="rgba(217, 154, 30, 0.28)" stroke="#d99a1e" stroke-width="3" stroke-opacity="0.55"/>`;
    })
    .join('');
}

// ── Atomic: the shuffle the first rules could not escape ─────────────────────
// Same four-point kernel, cannon shots exploding. Black has closed its palace
// with its own pieces (horse on e9, elephant on e8 blocking that horse's legs),
// so the general cannot step out and nothing but the cannon can cover the
// advisor files. Red's chariot threatens from d2; the cannon blocks on d6 and,
// over the chariot, threatens d1; the chariot hops to f2; the cannon follows to
// f6. Asserted below: every move is legal; at each chariot threat every other
// Black move lets the chariot take the advisor and blow up the general; (d) is
// (b) with the d and f files swapped, and two more moves bring back (b) itself;
// every move of the cycle threatens the enemy general; and the kernel, with
// perpetual check losing, still calls the loop a draw by repetition.
const SHUFFLE_SETUP = [
  'i1i2',
  'b10c8',
  'b1c3',
  'c8e9',
  'h1g3',
  'c10e8',
  'c1e3',
  'h10g8',
  'a1a2',
  'b8b6',
] as const;
let shuffle = fourPoint.initial('retired-shuffle');
for (const uci of SHUFFLE_SETUP) shuffle = play(shuffle, uci);
const SHUFFLE_A = play(shuffle, 'i2d2');
const SHUFFLE_B = play(SHUFFLE_A, 'b6d6');
const SHUFFLE_C = play(SHUFFLE_B, 'd2f2');
const SHUFFLE_D = play(SHUFFLE_C, 'd6f6');

/** Black's only move that does not lose on the spot is `block`; every other
 *  move lets the chariot on `chariot` take the advisor on `advisor`. */
function assertOnlyBlock(
  state: XiangqiRuleState,
  block: string,
  chariot: XiangqiSquare,
  advisor: XiangqiSquare,
) {
  for (const move of fourPoint.legalMoves(state)) {
    const uci = fourPoint.toUci(move);
    const after = fourPoint.apply(state, move);
    const take = fourPoint.fromUci(after, `${chariot}${advisor}`);
    const won =
      after.status.type === 'playing' && take && fourPoint.isLegal(after, take)
        ? fourPoint.apply(after, take).status
        : null;
    const loses = won?.type === 'finished' && won.winner === 'red';
    if (uci === block && loses)
      throw new Error(`retired-variants diagram: ${block} should hold off R${chariot}x${advisor}`);
    if (uci !== block && !loses)
      throw new Error(`retired-variants diagram: ${uci} should lose to R${chariot}x${advisor}`);
  }
}
// The threat in (a) is real: with Black to move skipped, Rxd10 is a legal
// capture down an open file and it ends the game. (The parry figure this strip
// replaced labelled a threat the cannon was already blocking.)
const threatInA = fourPoint.parseFen(
  fourPoint.fen(SHUFFLE_A).replace(' b ', ' w '),
  'retired-shuffle-a-threat',
);
const rxd10 = threatInA && fourPoint.fromUci(threatInA, 'd2d10');
if (!threatInA || !rxd10 || !fourPoint.isLegal(threatInA, rxd10))
  throw new Error('retired-variants diagram: in (a) Rxd10 should be a legal capture');
const afterRxd10 = fourPoint.apply(threatInA, rxd10).status;
if (afterRxd10.type !== 'finished' || afterRxd10.winner !== 'red')
  throw new Error('retired-variants diagram: in (a) Rxd10 should blow up the black general');
assertOnlyBlock(SHUFFLE_A, 'b6d6', 'd2', 'd10');
assertOnlyBlock(SHUFFLE_C, 'd6f6', 'f2', 'f10');

const swapDF = (square: string) =>
  square.startsWith('d')
    ? `f${square.slice(1)}`
    : square.startsWith('f')
      ? `d${square.slice(1)}`
      : square;
const placement = (board: XiangqiBoard) =>
  (Object.entries(board) as Array<[string, { color: string; role: string } | undefined]>)
    .filter(([, piece]) => piece)
    .map(([square, piece]) => `${square}:${piece?.color}${piece?.role}`)
    .sort()
    .join(' ');
const mirroredB = Object.fromEntries(
  Object.entries(SHUFFLE_B.board).map(([square, piece]) => [swapDF(square), piece]),
) as XiangqiBoard;
if (placement(SHUFFLE_D.board) !== placement(mirroredB))
  throw new Error('retired-variants diagram: (d) should be (b) with the d and f files swapped');
const shuffleBack = play(play(SHUFFLE_D, 'f2d2'), 'f6d6');
if (placement(shuffleBack.board) !== placement(SHUFFLE_B.board))
  throw new Error('retired-variants diagram: Rd2 Cd6 should bring back (b)');
// The repetition rule at its strongest: the one Atomic launched with, where a
// threat to blow up the general counts as check. Replay the line under it and
// loop until the kernel calls the game. Every move of the cycle is a "check",
// by both sides, so perpetual check names no loser and the loop is a draw.
const lethal = createXiangqiRuleKernel({ ...FOUR_POINT_RULES, repetitionCheck: 'lethal' });
let looped = lethal.initial('retired-shuffle-lethal');
const loopLine = [...SHUFFLE_SETUP, 'i2d2', 'b6d6'];
for (let i = 0; looped.status.type === 'playing' && i < 40; i += 1) {
  const uci = loopLine[i] ?? ['d2f2', 'd6f6', 'f2d2', 'f6d6'][(i - loopLine.length) % 4] ?? '';
  const move = lethal.fromUci(looped, uci);
  if (!move || !lethal.isLegal(looped, move))
    throw new Error(`retired-variants diagram: ${uci} should be legal in the shuffle`);
  looped = lethal.apply(looped, move);
}
if (!looped.history.slice(SHUFFLE_SETUP.length + 1).every((entry) => entry.check))
  throw new Error(
    'retired-variants diagram: every move of the shuffle should threaten the general',
  );
if (
  looped.status.type !== 'finished' ||
  looped.status.winner !== null ||
  looped.status.reason !== 'repetition'
)
  throw new Error('retired-variants diagram: the shuffle should end drawn by repetition');

const STRIP_H = XQ_BOARD_H + 8;
function stripBoard(id: string, board: XiangqiBoard, arrow: XiangqiMove): string {
  return xqSvg(
    XQ_BOARD_W,
    STRIP_H,
    xqBoardSvg({
      state: xqVisionDemoState(id, board),
      x: 0,
      y: 0,
      label: '',
      boardOffset: 4,
      perspective: 'red',
      arrows: [arrow],
    }),
  );
}

export const RETIRED_ATOMIC_SHUFFLE = [
  () => stripBoard('retired-shuffle-a', SHUFFLE_A.board, { from: 'd2', to: 'd10' }),
  () => stripBoard('retired-shuffle-b', SHUFFLE_B.board, { from: 'd6', to: 'd1' }),
  () => stripBoard('retired-shuffle-c', SHUFFLE_C.board, { from: 'f2', to: 'f10' }),
  () => stripBoard('retired-shuffle-d', SHUFFLE_D.board, { from: 'f6', to: 'f1' }),
] as const;

// Card thumbnail: Red's half of board (b), through the shared half-board crop.
// The cannon on d6 threatens to fire over the chariot onto d1; the arrow comes
// in from off the top edge and the points that shot would clear are ringed.
// The shot is played from (b) with Black to move, so the rings are a diff of
// the kernel's own result and the shot must win.
const SHOT: XiangqiMove = { from: 'd6', to: 'd1' };
const shotFrom = fourPoint.parseFen(fourPoint.fen(SHUFFLE_B).replace(' w ', ' b '), 'retired-shot');
if (!shotFrom) throw new Error('retired-variants diagram: (b) with Black to move should parse');
const shotState = play(shotFrom, 'd6d1');
const SHOT_GONE = emptiedBy(SHUFFLE_B.board, shotState.board, SHOT);
for (const square of ['d1', 'd2', 'e1'] as const) {
  if (!SHOT_GONE.includes(square))
    throw new Error(`retired-variants diagram: Cxd1 should remove ${square}`);
}
if (shotState.status.type !== 'finished' || shotState.status.winner !== 'black')
  throw new Error('retired-variants diagram: Cxd1 should end the game for Black');

export const RETIRED_VARIANTS_THUMBNAIL = () =>
  xqHalfBoardThumbnailSvg({
    state: xqVisionDemoState('retired-thumb', SHUFFLE_B.board),
    half: 'bottom',
    perspective: 'red',
    arrows: [SHOT],
    overlay: blastRings(SHOT_GONE, 0, 0),
    ariaLabel: 'Atomic Xiangqi: a cannon threatening to fire over the chariot onto d1',
  });

// ── Fortress: a drop mate from an engine game ────────────────────────────────
// A Fairy-Stockfish self-play game (depth 16, from a random book opening)
// under the rules the site last ran: river-gated soldiers, the
// Treasure kept on its own half. Black gives up a chariot on a2 so that Red's
// own chariot takes it and walls in the general on a1, then drops a soldier on
// b1. The horse on c3 guards b1, so the general cannot take it, and a2 is its
// own piece: mate, with most of both armies still on the board. The figure
// replays the whole game through the Fortress kernel, so every move is legal
// under those rules and the kernel itself calls the end. The moves are in the
// engine's notation, ten to a line.
const ENGINE_GAME = [
  'a2a3 d7d6 d1f3 c8c7 e1e4 c7c5 e4f4 d8f6 f3d1 c5b5',
  'd1b3 b8d7 d2d3 a8c8 f1d2 c8c3 d2f3 c3d3 a1a2 P@e3',
  'g1e1 b5e5 e1d1 d3d1 b3d1 e3f3 f2f3 N@c3 b1a1 e5a5',
  'R@c2 a5a2 b2b3 a2g2 c2g2 Q@d8 C@a8 P@a4 a8a4 R@b1',
  'a1a2 b1c1 f4g4 A@g6 g2d2 c1d1 d2d1 c3d1 R@d2 d6d5',
  'a4f4 R@b1 g4g3 d7c5 P@c4 c5d7 a3a4 d5d4 d2d4 d1c3',
  'g3c3 b1b3 N@d1 P@b2 d1b2 b3c3 d4d2 c3f3 f4d4 P@b3',
  'a4a5 d7e5 P@d5 b3b2 d2b2 e5d3 b2d2 C@f2 P@c2 f2c2',
  'd4d8 f6d8 P@c3 c2c4 Q@b2 C@f2 P@e4 P@b3 a2a1 b3b2',
  'd2b2 d3c1 c3c4 f2f1 C@b1 f3a3 P@a2 c1d3 b1b7 N@c3',
  'b2c2 a3a2 c2a2 P@b1',
]
  .join(' ')
  .split(' ');
const DROP_MATE_SQUARE: FortressXiangqiSquare = 'b1';
let dropMateAfter = createInitialFortressXiangqiState('retired-drop-mate');
for (const [ply, uci] of ENGINE_GAME.entries()) {
  const move = fsfUciToFortressXiangqiMove(uci);
  if (!move || !isFortressXiangqiLegalMove(dropMateAfter, move))
    throw new Error(`retired-variants diagram: engine move ${ply + 1} (${uci}) is not legal`);
  dropMateAfter = applyFortressXiangqiMove(dropMateAfter, move);
  if (ply < ENGINE_GAME.length - 1 && dropMateAfter.status.type !== 'playing')
    throw new Error(`retired-variants diagram: the game ended early, at move ${ply + 1}`);
}
const lastMove = fsfUciToFortressXiangqiMove(ENGINE_GAME[ENGINE_GAME.length - 1] ?? '');
if (!lastMove || !isFortressXiangqiDropMove(lastMove) || lastMove.to !== DROP_MATE_SQUARE)
  throw new Error('retired-variants diagram: the last move should be the soldier drop on b1');
if (
  dropMateAfter.status.type !== 'finished' ||
  dropMateAfter.status.winner !== 'black' ||
  dropMateAfter.status.reason !== 'checkmate'
)
  throw new Error('retired-variants diagram: P@b1 should checkmate Red');
// The caption's claims: the board is still busy, the general is on a1 with its
// own chariot on a2, and the horse on c3 is what guards b1: lift it off the
// final board and the general may take the soldier.
if (Object.keys(dropMateAfter.board).length < 14)
  throw new Error('retired-variants diagram: the mate should come with 14 or more pieces on');
const at = (square: FortressXiangqiSquare) => dropMateAfter.board[square];
if (
  at('a1')?.role !== 'general' ||
  at('a1')?.color !== 'red' ||
  at('a2')?.role !== 'chariot' ||
  at('a2')?.color !== 'red' ||
  at('c3')?.role !== 'horse' ||
  at('c3')?.color !== 'black'
)
  throw new Error('retired-variants diagram: expected the general a1, chariot a2, horse c3');
const withoutHorse: FortressXiangqiGameState = {
  ...dropMateAfter,
  board: Object.fromEntries(
    Object.entries(dropMateAfter.board).filter(([square]) => square !== 'c3'),
  ) as FortressXiangqiBoard,
  status: { type: 'playing', turn: 'red' },
};
if (!isFortressXiangqiLegalMove(withoutHorse, { from: 'a1', to: DROP_MATE_SQUARE }))
  throw new Error('retired-variants diagram: without the c3 horse, Kxb1 should be legal');

export const RETIRED_FORTRESS_DROP_MATE = () => {
  installFortressXiangqiBoardStyles();
  const svg = renderFortressXiangqiBoardSvg(
    getFortressXiangqiPlayerView(dropMateAfter, 'red'),
    'red',
    {
      coordinates: false,
      arrows: [{ from: 'c3', to: DROP_MATE_SQUARE }],
      markers: [{ square: DROP_MATE_SQUARE, kind: 'circle', className: 'xq-shape--green' }],
    },
  );
  // The live board's class rule is width:100%; an article figure caps itself.
  // The renderer leaves corner rounding to its host (the live board clips it),
  // so the figure rounds itself on the shared curve: BOARD_CORNER_RATIO of the
  // width on both axes, written as a percentage of each side.
  const [, , vbW = 1, vbH = 1] = (/viewBox="([^"]+)"/.exec(svg)?.[1] ?? '0 0 1 1')
    .trim()
    .split(/\s+/)
    .map(Number);
  const rx = (BOARD_CORNER_RATIO * 100).toFixed(2);
  const ry = ((BOARD_CORNER_RATIO * 100 * vbW) / vbH).toFixed(2);
  return svg.replace(
    '<svg ',
    `<svg width="100%" style="max-width:420px;height:auto;display:block;margin:0 auto;overflow:hidden;border-radius:${rx}% / ${ry}%" `,
  );
};

/** The final position, for the article test. */
export const RETIRED_FORTRESS_DROP_MATE_STATE: FortressXiangqiGameState = dropMateAfter;
