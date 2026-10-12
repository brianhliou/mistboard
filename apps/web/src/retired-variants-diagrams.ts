// Board diagrams for the article on taking Fortress and Atomic Xiangqi back
// to the drawing board.
//
// The Fortress figure is the corner-palace drop mate, built through the
// Fortress kernel: the position before the drop must be legal with Red not in
// check, the soldier drop must be legal, and the kernel must call the result
// checkmate. The squares the arrows claim the horse covers are checked too.
//
// The parry figure is the one scripts/gen-atomic-diagrams.mts draws for the
// variant-lab write-up ("3. The parry"): the same position, reached by the same
// three moves, under the same four-point design kernel, in which a cannon's
// capture explodes like any other. It is drawn here with the site's diagram
// toolkit so it follows the reader's piece set, and the blast squares are a
// diff of the board before and after the kernel applies the shot, never
// hand-listed. Every claim the article's caption makes is asserted at load.

import {
  applyFortressXiangqiMove,
  createXiangqiRuleKernel,
  type FortressXiangqiBoard,
  type FortressXiangqiGameState,
  type FortressXiangqiSquare,
  getFortressXiangqiLegalMoves,
  getFortressXiangqiPlayerView,
  isFortressXiangqiDropMove,
  isFortressXiangqiGeneralInCheck,
  isFortressXiangqiLegalMove,
  type XiangqiBoard,
  type XiangqiMove,
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
import {
  installFortressXiangqiBoardStyles,
  renderFortressXiangqiBoardSvg,
} from './fortress-xiangqi-render.js';

// The four-point design rules from the Atomic Xiangqi lab (the generator's
// `kernel`): orthogonal blast, soldiers immune, facing rule on, perpetual check
// loses, and a cannon shot that explodes like any capture.
const fourPoint = createXiangqiRuleKernel({
  facing: 'file',
  stalemate: 'loss',
  progressClock: 60,
  repetition: 'perpetualCheckLoses',
  blast: { shape: 'orthogonal', immune: ['soldier'], palaceContained: false },
});

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

// 1. Ra2 Cd8 2. Rd2: Red's chariot on d2 threatens Rxd10, which would explode
// the advisor and the general beside it. Black is to move.
let rush = fourPoint.initial('retired-parry');
for (const uci of ['a1a2', 'b8d8', 'a2d2']) rush = play(rush, uci);
const PARRY_BOARD = rush.board;
const THREAT: XiangqiMove = { from: 'd2', to: 'd10' };
const SHOT: XiangqiMove = { from: 'd8', to: 'd1' };
if (rush.status.type !== 'playing' || rush.status.turn !== 'black')
  throw new Error('retired-variants diagram: Black should be to move after 2. Rd2');
const shotState = play(rush, 'd8d1');
const SHOT_GONE = emptiedBy(PARRY_BOARD, shotState.board, SHOT);
for (const square of ['d1', 'd2', 'e1'] as const) {
  if (!SHOT_GONE.includes(square))
    throw new Error(`retired-variants diagram: Cxd1 should remove ${square}`);
}
if (shotState.status.type !== 'finished' || shotState.status.winner !== 'black')
  throw new Error('retired-variants diagram: Cxd1 should end the game for Black');

const PAIR_W = XQ_BOARD_W * 2 + 28;
const PAIR_GAP_X = XQ_BOARD_W + 28;
const FIGURE_H = XQ_BOARD_H + 34;
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

export const RETIRED_ATOMIC_PARRY = () =>
  xqSvg(
    PAIR_W,
    FIGURE_H,
    xqBoardSvg({
      state: xqVisionDemoState('retired-parry-threat', PARRY_BOARD),
      x: 0,
      y: 0,
      label: '2. Rd2 THREATENS Rxd10',
      perspective: 'red',
      arrows: [THREAT],
    }) +
      xqBoardSvg({
        state: xqVisionDemoState('retired-parry-shot', PARRY_BOARD),
        x: PAIR_GAP_X,
        y: 0,
        label: '2...Cxd1 GETS THERE FIRST',
        perspective: 'red',
        arrows: [SHOT],
        overlay: blastRings(SHOT_GONE, PAIR_GAP_X, 0),
      }),
  );

// Card thumbnail: Red's half of the board at the moment of the shot, through
// the shared half-board crop, with the arrow coming in from the black cannon
// off the top edge and the four points the blast clears ringed.
export const RETIRED_VARIANTS_THUMBNAIL = () =>
  xqHalfBoardThumbnailSvg({
    state: xqVisionDemoState('retired-thumb', PARRY_BOARD),
    half: 'bottom',
    perspective: 'red',
    arrows: [SHOT],
    overlay: blastRings(SHOT_GONE, 0, 0),
    ariaLabel: 'Atomic Xiangqi: a cannon shot through the chariot onto d1',
  });

/** The squares the four-point shot clears, for the article test. */
export const RETIRED_ATOMIC_PARRY_CLEARED: readonly XiangqiSquare[] = SHOT_GONE;

// ── Fortress: the corner-palace drop mate ────────────────────────────────────
// Red's general sits in its corner palace on a1. A black horse on c3 covers
// both of its flight points, a2 and b1, and a soldier from Black's hand dropped
// on a2 gives check from a point the general cannot take.
const DROP_MATE_BEFORE: FortressXiangqiBoard = {
  a1: { color: 'red', role: 'general' },
  c3: { color: 'black', role: 'horse' },
  g8: { color: 'black', role: 'general' },
};
const DROP_MATE_DROP = { drop: 'soldier', to: 'a2' } as const;
const dropMateStart: FortressXiangqiGameState = {
  id: 'retired-drop-mate',
  board: DROP_MATE_BEFORE,
  hands: { red: {}, black: { soldier: 1 } },
  status: { type: 'playing', turn: 'black' },
  moveNumber: 1,
  positionCounts: {},
};
if (isFortressXiangqiGeneralInCheck(dropMateStart, 'red'))
  throw new Error('retired-variants diagram: Red should not be in check before the drop');
if (!isFortressXiangqiLegalMove(dropMateStart, DROP_MATE_DROP))
  throw new Error('retired-variants diagram: the soldier drop on a2 should be legal');
// The horse alone covers both flight points: with Red to move and no soldier
// yet, neither a2 nor b1 is a legal step for the general.
const horseCovers: FortressXiangqiSquare[] = ['a2', 'b1'];
const redSteps = getFortressXiangqiLegalMoves({
  ...dropMateStart,
  status: { type: 'playing', turn: 'red' },
})
  .filter((move) => !isFortressXiangqiDropMove(move))
  .map((move) => move.to);
for (const square of horseCovers) {
  if (redSteps.includes(square))
    throw new Error(`retired-variants diagram: the c3 horse should cover ${square}`);
}
const dropMateAfter = applyFortressXiangqiMove(dropMateStart, DROP_MATE_DROP);
if (
  dropMateAfter.status.type !== 'finished' ||
  dropMateAfter.status.winner !== 'black' ||
  dropMateAfter.status.reason !== 'checkmate'
)
  throw new Error('retired-variants diagram: P@a2 should checkmate Red');

export const RETIRED_FORTRESS_DROP_MATE = () => {
  installFortressXiangqiBoardStyles();
  const svg = renderFortressXiangqiBoardSvg(
    getFortressXiangqiPlayerView(dropMateAfter, 'red'),
    'red',
    {
      coordinates: false,
      arrows: horseCovers.map((to) => ({ from: 'c3' as const, to })),
      markers: [{ square: 'a2', kind: 'circle', className: 'xq-shape--green' }],
    },
  );
  // The live board's class rule is width:100%; an article figure caps itself.
  return svg.replace(
    '<svg ',
    '<svg width="100%" style="max-width:420px;height:auto;display:block;margin:0 auto" ',
  );
};

/** The final position, for the article test. */
export const RETIRED_FORTRESS_DROP_MATE_STATE: FortressXiangqiGameState = dropMateAfter;
