// Inline board diagrams for the Crazyhouse Xiangqi rules article.
//
// Drawn with the shared xiangqi article-diagram toolkit (articles/diagrams.ts),
// so they read as siblings of the Xiangqi primer and follow the reader's board
// layout and piece-set pickers. Where the hands matter, they are drawn with the
// board (xqBoardWithHandsSvg): the side at the top of the board above it, the
// side at the bottom below it, as the live room draws its pockets.
//
// Every position, target, drop point and hand comes from the game kernel
// (packages/game/src/variants-crazyhouse-xiangqi.ts), never a hand-written
// list: a rules change redraws these figures, and a figure whose caption the
// kernel no longer supports throws instead of rendering a lie. The crossed
// points are pedagogy (where the piece would go if the river or the eye did
// not stop it), derived as the geometric step minus the kernel's answer.

import {
  applyCrazyhouseXiangqiMove,
  type CrazyhouseXiangqiBoard,
  type CrazyhouseXiangqiColor,
  type CrazyhouseXiangqiDropRole,
  type CrazyhouseXiangqiGameState,
  type CrazyhouseXiangqiHands,
  type CrazyhouseXiangqiSquare,
  crazyhouseXiangqiDropRegion,
  crazyhouseXiangqiMoveFromUci,
  createInitialCrazyhouseXiangqiState,
  getCrazyhouseXiangqiLegalDrops,
  getCrazyhouseXiangqiLegalMovesFrom,
  isCrazyhouseXiangqiDropMove,
  isCrazyhouseXiangqiGeneralInCheck,
  isCrazyhouseXiangqiLegalMove,
  parseCrazyhouseXiangqiFen,
  type XiangqiSquare,
} from '@mistboard/game';
import {
  XQ_BOARD_H,
  XQ_BOARD_W,
  type XqHandStrip,
  xqBoardSvg,
  xqBoardWithHandsHeight,
  xqBoardWithHandsSvg,
  xqDots,
  xqSvg,
  xqVisionDemoState,
} from './articles/diagrams.js';
import { CRAZYHOUSE_XIANGQI_SAMPLE_GAME_MOVES } from './crazyhouse-xiangqi-sample-game.js';
import { CRAZYHOUSE_XIANGQI_POCKET_ORDER } from './crazyhouse-xiangqi-view.js';

const PAIR_GAP = 28;
const PAIR_W = XQ_BOARD_W * 2 + PAIR_GAP;
const SINGLE_H = XQ_BOARD_H + 52;

function fail(message: string): never {
  throw new Error(`crazyhouse-xiangqi rules diagram: ${message}`);
}

function fromFen(fen: string): CrazyhouseXiangqiGameState {
  const parsed = parseCrazyhouseXiangqiFen(fen, 'chx-rules-diagram');
  if (!parsed.ok) fail(parsed.error);
  return parsed.state;
}

function demo(id: string, board: CrazyhouseXiangqiBoard) {
  return xqVisionDemoState(id, board);
}

function play(state: CrazyhouseXiangqiGameState, uci: string): CrazyhouseXiangqiGameState {
  const move = crazyhouseXiangqiMoveFromUci(uci);
  if (!move || !isCrazyhouseXiangqiLegalMove(state, move)) fail(`${uci} is not legal here`);
  return applyCrazyhouseXiangqiMove(state, move);
}

const rankOf = (square: string) => Number(square.slice(1));

const sameSquares = (a: readonly string[], b: readonly string[]) =>
  [...a].sort().join() === [...b].sort().join();

/** One side's hand in the live pocket's order, as a strip for the board. */
function strip(hands: CrazyhouseXiangqiHands, color: CrazyhouseXiangqiColor): XqHandStrip {
  return {
    color,
    entries: CRAZYHOUSE_XIANGQI_POCKET_ORDER.map((role) => ({
      role,
      count: hands[color][role] ?? 0,
    })),
  };
}

type Marks = {
  dots?: Array<{ square: XiangqiSquare; blocked?: boolean; capture?: boolean }>;
  arrows?: Array<{ from: XiangqiSquare; to: XiangqiSquare }>;
};

/** A position with both hands, Red at the bottom. */
function positionWithHands(
  id: string,
  state: CrazyhouseXiangqiGameState,
  label: string,
  x: number,
  marks: Marks = {},
): string {
  return xqBoardWithHandsSvg({
    state: demo(id, state.board),
    x,
    y: 0,
    label,
    perspective: 'red',
    top: strip(state.hands, 'black'),
    bottom: strip(state.hands, 'red'),
    ...marks,
  });
}

const BOTH_HANDS_H = xqBoardWithHandsHeight({
  top: { color: 'black', entries: [] },
  bottom: { color: 'red', entries: [] },
});

/** A ring around the point a piece was just dropped on. */
const dropRing = (square: XiangqiSquare) => [{ square, capture: true }];

// ── The intro: how the sample game ends ─────────────────────────────────────

/** The sample game's last position: Red's soldier, dropped on e9, mates. */
function sampleGameEnd(): CrazyhouseXiangqiGameState {
  let state = createInitialCrazyhouseXiangqiState('chx-rules-sample');
  for (const token of CRAZYHOUSE_XIANGQI_SAMPLE_GAME_MOVES.split(' ')) state = play(state, token);
  const last = state.lastMove;
  if (
    state.status.type !== 'finished' ||
    state.status.winner !== 'red' ||
    state.status.reason !== 'checkmate' ||
    !last ||
    !isCrazyhouseXiangqiDropMove(last) ||
    last.drop !== 'soldier' ||
    last.to !== 'e9'
  ) {
    fail('the sample game no longer ends with a soldier dropped on e9 for mate');
  }
  return state;
}

export const CRAZYHOUSE_XIANGQI_INTRO_BOARD = () =>
  xqSvg(
    XQ_BOARD_W,
    BOTH_HANDS_H,
    positionWithHands('chx-rules-intro', sampleGameEnd(), 'MATE WITH A DROPPED SOLDIER', 0, {
      dots: dropRing('e9'),
    }),
  );

// ── The start ───────────────────────────────────────────────────────────────

const START = createInitialCrazyhouseXiangqiState('chx-rules-start');

/** The kernel's start: xiangqi without its advisors and elephants, which wait in hand. */
export const CRAZYHOUSE_XIANGQI_START_BOARD = () => {
  for (const color of ['red', 'black'] as const) {
    const hand = START.hands[color];
    const held = Object.entries(hand).filter(([, count]) => (count ?? 0) > 0);
    if (hand.advisor !== 2 || hand.elephant !== 2 || held.length !== 2) {
      fail('a hand at the start is no longer two advisors and two elephants');
    }
  }
  if (Object.values(START.board).some((p) => p?.role === 'advisor' || p?.role === 'elephant')) {
    fail('an advisor or elephant starts on the board');
  }
  return xqSvg(
    XQ_BOARD_W,
    BOTH_HANDS_H,
    positionWithHands('chx-rules-start', START, 'START: ADVISORS AND ELEPHANTS IN HAND', 0),
    'xq-article-svg--hero',
  );
};

// ── A turn is a move or a drop ──────────────────────────────────────────────

/** Red's first turn both ways: the cannon to e3, or an elephant dropped on e3. */
export const CRAZYHOUSE_XIANGQI_TURN_PAIR = () => {
  const moved = play(START, 'h3e3');
  const dropped = play(START, 'B@e3');
  if (dropped.hands.red.elephant !== 1 || moved.hands.red.elephant !== 2) {
    fail('a drop no longer takes the piece out of the hand');
  }
  return xqSvg(
    PAIR_W,
    BOTH_HANDS_H,
    [
      positionWithHands('chx-rules-turn-move', moved, 'A MOVE', 0, {
        arrows: [{ from: 'h3', to: 'e3' }],
      }),
      positionWithHands('chx-rules-turn-drop', dropped, 'A DROP', XQ_BOARD_W + PAIR_GAP, {
        dots: dropRing('e3'),
      }),
    ].join(''),
  );
};

// ── Captured pieces join your hand ──────────────────────────────────────────

// Red's chariot on c3 takes Black's horse on c7. Red already holds a soldier
// and Black a cannon, so the figure shows a hand growing, not appearing.
const CAPTURE_BEFORE = fromFen('3k5/9/9/2n6/9/9/9/2R6/9/4K4[Pc] w - - 0 1');

export const CRAZYHOUSE_XIANGQI_CAPTURE_PAIR = () => {
  const after = play(CAPTURE_BEFORE, 'c3c7');
  if (
    after.hands.red.horse !== 1 ||
    after.hands.red.soldier !== 1 ||
    after.hands.black.cannon !== 1 ||
    after.board.c7?.role !== 'chariot'
  ) {
    fail('a captured horse no longer joins the capturer’s hand');
  }
  return xqSvg(
    PAIR_W,
    BOTH_HANDS_H,
    [
      positionWithHands('chx-rules-capture-before', CAPTURE_BEFORE, 'BEFORE THE CAPTURE', 0, {
        arrows: [{ from: 'c3', to: 'c7' }],
      }),
      positionWithHands(
        'chx-rules-capture-after',
        after,
        'AFTER: A RED HORSE IN HAND',
        XQ_BOARD_W + PAIR_GAP,
      ),
    ].join(''),
  );
};

// ── Where each piece may drop ───────────────────────────────────────────────

const DROP_LETTER: Record<CrazyhouseXiangqiDropRole, string> = {
  chariot: 'R',
  horse: 'N',
  elephant: 'B',
  advisor: 'A',
  cannon: 'C',
  soldier: 'P',
};

/**
 * The drop region for `role`, from the kernel's region rule, cross-checked
 * against its move generator: with only the two generals on the board (d1 and
 * f10, off each other's file, so no drop is refused for opening a line), the
 * legal drops are exactly the region less the generals' points.
 */
function dropZone(role: CrazyhouseXiangqiDropRole): CrazyhouseXiangqiSquare[] {
  const region = crazyhouseXiangqiDropRegion(role, 'red');
  const state = fromFen(`5k3/9/9/9/9/9/9/9/9/3K5[${DROP_LETTER[role]}] w - - 0 1`);
  const legal = getCrazyhouseXiangqiLegalDrops(state, role).map((move) => move.to);
  const expected = region.filter((sq) => sq !== 'd1' && sq !== 'f10');
  if (!sameSquares(legal, expected))
    fail(`the ${role} drop region disagrees with the move generator`);
  return region;
}

function zoneBoard(
  roles: readonly CrazyhouseXiangqiDropRole[],
  label: string,
  points: CrazyhouseXiangqiSquare[],
): string {
  return xqSvg(
    XQ_BOARD_W,
    xqBoardWithHandsHeight({ top: { color: 'red', entries: [] } }),
    xqBoardWithHandsSvg({
      state: demo(`chx-rules-zone-${roles[0]}`, {}),
      x: 0,
      y: 0,
      label,
      perspective: 'red',
      // The pieces this region belongs to, over their board.
      top: { color: 'red', entries: roles.map((role) => ({ role, count: 1 })) },
      dots: xqDots(points),
    }),
  );
}

/** Advisor and elephant: every point of your own half, 45 points. */
export const CRAZYHOUSE_XIANGQI_ZONE_OWN_HALF = () => {
  const points = dropZone('advisor');
  if (!sameSquares(points, dropZone('elephant'))) fail('advisor and elephant regions differ');
  if (points.length !== 45 || points.some((sq) => rankOf(sq) > 5)) {
    fail(`own-half region is ${points.length} points`);
  }
  return zoneBoard(['advisor', 'elephant'], 'YOUR OWN HALF', points);
};

/** Chariot, horse and cannon: all 90 points. */
export const CRAZYHOUSE_XIANGQI_ZONE_ANYWHERE = () => {
  const points = dropZone('chariot');
  if (!sameSquares(points, dropZone('horse')) || !sameSquares(points, dropZone('cannon'))) {
    fail('chariot, horse and cannon regions differ');
  }
  if (points.length !== 90) fail(`free region is ${points.length} points`);
  return zoneBoard(['chariot', 'horse', 'cannon'], 'ANY EMPTY POINT', points);
};

/** Soldier: its ten home points (five files, two ranks) and all 45 across the river. */
export const CRAZYHOUSE_XIANGQI_ZONE_SOLDIER = () => {
  const points = dropZone('soldier');
  const home = points.filter((sq) => rankOf(sq) <= 5);
  const across = points.filter((sq) => rankOf(sq) >= 6);
  const homeFiles = [...new Set(home.map((sq) => sq[0]))].sort().join('');
  const homeRanks = [...new Set(home.map(rankOf))].sort().join();
  if (home.length !== 10 || across.length !== 45 || homeFiles !== 'acegi' || homeRanks !== '4,5') {
    fail(`soldier region is ${home.length} home + ${across.length} across`);
  }
  return zoneBoard(['soldier'], 'HOME POINTS AND OVER THE RIVER', points);
};

// ── A drop may give check ───────────────────────────────────────────────────

// Black's general on e10, Red's on d1, off its file. Left: Red drops a horse
// on d8, which attacks e10 over an empty leg. Right: Red's cannon on e3 has no
// screen on the e-file until Red drops a soldier on e6.
const CHECK_HORSE = fromFen('4k4/9/9/9/9/9/9/9/9/3K5[N] w - - 0 1');
const CHECK_SCREEN = fromFen('4k4/9/9/9/9/9/9/4C4/9/3K5[P] w - - 0 1');

function dropCheckPanel(
  before: CrazyhouseXiangqiGameState,
  uci: string,
  attacker: XiangqiSquare,
  label: string,
  x: number,
): string {
  if (isCrazyhouseXiangqiGeneralInCheck(before.board, 'black')) fail(`${label}: check before`);
  const after = play(before, uci);
  if (!isCrazyhouseXiangqiGeneralInCheck(after.board, 'black')) fail(`${label}: ${uci} no check`);
  const to = uci.slice(2) as XiangqiSquare;
  return xqBoardSvg({
    state: demo(`chx-rules-check-${to}`, after.board),
    x,
    y: 0,
    label,
    perspective: 'red',
    dots: dropRing(to),
    arrows: [{ from: attacker, to: 'e10' }],
  });
}

export const CRAZYHOUSE_XIANGQI_DROP_CHECK_PAIR = () =>
  xqSvg(
    PAIR_W,
    SINGLE_H,
    [
      dropCheckPanel(CHECK_HORSE, 'N@d8', 'd8', 'A DROP THAT CHECKS', 0),
      dropCheckPanel(CHECK_SCREEN, 'P@e6', 'e3', 'A DROP THAT SCREENS', XQ_BOARD_W + PAIR_GAP),
    ].join(''),
  );

// ── Advisors and elephants on their own half ────────────────────────────────

const DIAGONAL_1 = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;
const DIAGONAL_2 = DIAGONAL_1.map(([df, dr]) => [df * 2, dr * 2] as const);

function targetsOf(state: CrazyhouseXiangqiGameState, from: XiangqiSquare): XiangqiSquare[] {
  return getCrazyhouseXiangqiLegalMovesFrom(state, from).map((move) => move.to);
}

function geometric(from: XiangqiSquare, steps: readonly (readonly [number, number])[]) {
  const file = from.charCodeAt(0) - 97;
  const rank = rankOf(from);
  return steps
    .map(([df, dr]) => [file + df, rank + dr] as const)
    .filter(([f, r]) => f >= 0 && f <= 8 && r >= 1 && r <= 10)
    .map(([f, r]) => `${String.fromCharCode(97 + f)}${r}` as XiangqiSquare);
}

/** One piece's move diagram: dots where it may go, crosses where it is stopped. */
function piecePanel(
  state: CrazyhouseXiangqiGameState,
  from: XiangqiSquare,
  steps: readonly (readonly [number, number])[],
  label: string,
  x: number,
  shown: readonly XiangqiSquare[] = [from],
): { svg: string; targets: XiangqiSquare[]; crossed: XiangqiSquare[] } {
  const targets = targetsOf(state, from);
  const crossed = geometric(from, steps).filter((square) => !targets.includes(square));
  const board: CrazyhouseXiangqiBoard = {};
  for (const square of shown) board[square] = state.board[square]!;
  const svg = xqBoardSvg({
    state: demo(`chx-rules-${from}-${shown.length}`, board),
    x,
    y: 0,
    label,
    perspective: 'red',
    dots: [...xqDots(targets), ...crossed.map((square) => ({ square, blocked: true }))],
  });
  return { svg, targets, crossed };
}

/**
 * Generals on d10 and e1 (off each other's file, and off every point these
 * figures' pieces could reach) plus up to two red pieces, as a FEN with empty
 * hands, so a piece's targets are its own geometry alone.
 */
function withGenerals(pieces: ReadonlyArray<readonly [XiangqiSquare, string]>): string {
  const rows: string[][] = Array.from({ length: 10 }, () => Array<string>(9).fill(''));
  for (const [square, letter] of [['d10', 'k'] as const, ['e1', 'K'] as const, ...pieces]) {
    rows[10 - rankOf(square)]![square.charCodeAt(0) - 97] = letter;
  }
  const placement = rows
    .map((row) => {
      let out = '';
      let run = 0;
      for (const cell of row) {
        if (!cell) {
          run += 1;
          continue;
        }
        out += (run || '') + cell;
        run = 0;
      }
      return out + (run || '');
    })
    .join('/');
  return `${placement}[] w - - 0 1`;
}

/** An advisor outside the palace (c2) and one on the river bank (e5). */
export const CRAZYHOUSE_XIANGQI_ADVISOR_PAIR = () => {
  const out = piecePanel(
    fromFen(withGenerals([['c2', 'A']])),
    'c2',
    DIAGONAL_1,
    'ADVISOR OUTSIDE THE PALACE',
    0,
  );
  const bank = piecePanel(
    fromFen(withGenerals([['e5', 'A']])),
    'e5',
    DIAGONAL_1,
    'ADVISOR ON THE RIVER BANK',
    XQ_BOARD_W + PAIR_GAP,
  );
  if (!sameSquares(out.targets, ['b1', 'b3', 'd1', 'd3']) || out.crossed.length !== 0) {
    fail('the advisor on c2 no longer steps to all four diagonals');
  }
  if (!sameSquares(bank.targets, ['d4', 'f4']) || !sameSquares(bank.crossed, ['d6', 'f6'])) {
    fail('the river no longer alone stops the advisor on e5');
  }
  return xqSvg(PAIR_W, SINGLE_H, out.svg + bank.svg);
};

/**
 * Every point an elephant standing on `start` can ever walk to. From c1 it is
 * the seven points a xiangqi elephant can ever stand on. Walked through the
 * kernel's own two-point diagonal step, so it is not a remembered list.
 */
function elephantCircuit(start: XiangqiSquare): Set<XiangqiSquare> {
  const seen = new Set<XiangqiSquare>([start]);
  const queue: XiangqiSquare[] = [start];
  while (queue.length > 0) {
    const from = queue.shift()!;
    for (const to of targetsOf(fromFen(withGenerals([[from, 'B']])), from)) {
      if (!seen.has(to)) {
        seen.add(to);
        queue.push(to);
      }
    }
  }
  return seen;
}

/** An elephant dropped on d3, off the seven points, and the same with its eye filled. */
export const CRAZYHOUSE_XIANGQI_ELEPHANT_PAIR = () => {
  const circuit = elephantCircuit('c1');
  if (circuit.size !== 7) fail(`the xiangqi elephant circuit is ${circuit.size} points`);
  // "Never gets back onto them": nothing an elephant on d3 can walk to is one
  // of the seven.
  if ([...elephantCircuit('d3')].some((sq) => circuit.has(sq))) {
    fail('an elephant dropped on d3 can walk back onto the xiangqi circuit');
  }
  const left = piecePanel(
    fromFen(withGenerals([['d3', 'B']])),
    'd3',
    DIAGONAL_2,
    'ELEPHANT OFF ITS OLD POINTS',
    0,
  );
  const right = piecePanel(
    fromFen(
      withGenerals([
        ['d3', 'B'],
        ['e4', 'P'],
      ]),
    ),
    'd3',
    DIAGONAL_2,
    'EYE BLOCKED',
    XQ_BOARD_W + PAIR_GAP,
    ['d3', 'e4'],
  );
  if (!sameSquares(left.targets, ['b1', 'b5', 'f1', 'f5']) || left.crossed.length !== 0) {
    fail('the elephant on d3 no longer reaches all four points');
  }
  if ([...left.targets, 'd3' as const].some((sq) => circuit.has(sq))) {
    fail('the elephant on d3 touches the xiangqi circuit');
  }
  if (!sameSquares(right.targets, ['b1', 'b5', 'f1']) || !sameSquares(right.crossed, ['f5'])) {
    fail('the eye on e4 no longer stops the step to f5 alone');
  }
  return xqSvg(PAIR_W, SINGLE_H, left.svg + right.svg);
};
