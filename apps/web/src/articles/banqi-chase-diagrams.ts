// Boards for the perpetual-chase article. Two are real games replayed through
// the kernel from their stored deals (content/banqi-chase-games.ts); the
// four-square cycle is a constructed position, built on the kernel's own state
// so its moves are checked by the same move generator. banqi-chase-diagrams.test.ts
// replays every move a figure draws and asserts what its caption says.
import {
  applyBanqiMove,
  type BanqiBoard,
  type BanqiGameState,
  type BanqiMove,
  type BanqiPlayerView,
  type BanqiSquare,
  createInitialBanqiState,
  getBanqiPlayerView,
} from '@mistboard/game';
import { BANQI_CHASE_DRAW_GAME, BANQI_CHASE_HERD_GAME } from './content/banqi-chase-games.js';
import {
  BANQI_BOARD_H,
  BANQI_BOARD_W,
  BANQI_ENGINE_THUMB_H,
  BANQI_ENGINE_THUMB_Y,
  banqiArrow,
  banqiBoardGrid,
  banqiCellCenter,
  banqiPiecesFromView,
  banqiReplayViewAt,
  xqSvg,
} from './diagrams.js';

const TITLE_H = 28;

function cell(square: BanqiSquare): { col: number; row: number } {
  return { col: square.charCodeAt(0) - 97, row: 4 - Number(square[1]) };
}

function title(text: string): string {
  return `<text x="${BANQI_BOARD_W / 2}" y="14" font-family="system-ui, sans-serif" font-size="13" font-weight="700" class="xq-diagram-title" text-anchor="middle">${text}</text>`;
}

function arrow(from: BanqiSquare, to: BanqiSquare, y0: number, id: string): string {
  return banqiArrow(cell(from), cell(to), 0, y0, id, 14);
}

// A fleeing piece's route as one dashed line through the squares it used, with
// a ring on the square it ended on.
function route(squares: BanqiSquare[], y0: number): string {
  const points = squares.map((square) => {
    const { col, row } = cell(square);
    const { x, y } = banqiCellCenter(col, row, 0, y0);
    return `${x},${y}`;
  });
  const last = cell(squares[squares.length - 1]!);
  const end = banqiCellCenter(last.col, last.row, 0, y0);
  return [
    `<polyline points="${points.join(' ')}" fill="none" stroke="var(--site-accent, #b8434e)" stroke-width="4" stroke-dasharray="7 6" stroke-linecap="round" stroke-linejoin="round" opacity="0.7"/>`,
    `<circle cx="${end.x}" cy="${end.y}" r="23" fill="none" stroke="var(--site-accent, #b8434e)" stroke-width="3"/>`,
  ].join('');
}

function figure(view: BanqiPlayerView, heading: string, overlay: string): string {
  return xqSvg(
    BANQI_BOARD_W,
    BANQI_BOARD_H + TITLE_H,
    [
      title(heading),
      banqiBoardGrid(0, TITLE_H),
      banqiPiecesFromView(view, 0, TITLE_H),
      overlay,
    ].join(''),
  );
}

// ── 1. Back and forth (real: 2026-09-16, repetition draw at ply 88) ──────────
// After 80 actions the bot's flip on g2 has turned up a red advisor beside the
// human's black chariot on g1. The chariot's only empty neighbour is f1 (e1 and
// h1 hold its own soldiers), so the two pieces shuttle g1-f1 / g2-f2.
export const CHASE_DRAW_VIEW_PLY = 80;

export const CHASE_DRAW_LAST_PLY = CHASE_DRAW_VIEW_PLY + 8;

// One step-through frame: the board, with the move that led to it drawn as an
// arrow (none on the opening frame).
function frame(view: BanqiPlayerView, move: BanqiMove | null, id: string): string {
  return xqSvg(
    BANQI_BOARD_W,
    BANQI_BOARD_H,
    [
      banqiBoardGrid(0, 0),
      banqiPiecesFromView(view, 0, 0),
      move ? arrow(move.from, move.to, 0, id) : '',
    ].join(''),
  );
}

function drawGameMove(ply: number): BanqiMove {
  const token = BANQI_CHASE_DRAW_GAME.moves.trim().split(/\s+/)[ply]!;
  return { from: token.slice(0, 2) as BanqiSquare, to: token.slice(2, 4) as BanqiSquare };
}

// Frame k is the board after CHASE_DRAW_VIEW_PLY + k actions. Only the opening
// and the last move carry a note; the moves between speak for themselves. The
// claims (only square, third time, forbidden) are asserted in the test.
const CHASE_DRAW_NARRATIVES = [
  'The bot has just flipped g2 and turned up a red advisor beside the player’s black chariot. A chariot can’t take an advisor, which outranks it, and e1 and h1 hold its own soldiers, so f1 is its only free square.',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  'The advisor’s fourth chase brings the position round a third time, and under plain threefold repetition the game is drawn. Under Mistboard’s rule this move is forbidden, so the advisor would have to play something else.',
];

export const BANQI_CHASE_BACK_AND_FORTH_STEPS = CHASE_DRAW_NARRATIVES.map((narrative, k) => {
  const move = k === 0 ? null : drawGameMove(CHASE_DRAW_VIEW_PLY + k - 1);
  return {
    svg: () =>
      frame(
        banqiReplayViewAt(BANQI_CHASE_DRAW_GAME.deal, BANQI_CHASE_DRAW_GAME.moves, CHASE_DRAW_VIEW_PLY + k),
        move,
        `bq-chase-draw-${k}`,
      ),
    move: move ? `${move.from}-${move.to}` : undefined,
    narrative,
  };
});

// ── 2. Round four squares (constructed) ─────────────────────────────────────
// A black advisor chases a red chariot round the a1-a2-b2-b1 corner. Face-down
// tiles on a3, b3, c2 and c1 close every other exit, so each of the chariot's
// moves is its only safe one, as in the real game above. Eight plies bring the
// board back to the start.
export const CHASE_CYCLE_MOVES: BanqiMove[] = [
  { from: 'a2', to: 'b2' },
  { from: 'a1', to: 'a2' },
  { from: 'b2', to: 'b1' },
  { from: 'a2', to: 'b2' },
  { from: 'b1', to: 'a1' },
  { from: 'b2', to: 'b1' },
  { from: 'a1', to: 'a2' },
  { from: 'b1', to: 'a1' },
];

export function chaseCycleStart(): BanqiGameState {
  const state = createInitialBanqiState('banqi-chase-cycle');
  const board: BanqiBoard = {
    a2: { color: 'red', role: 'chariot', faceDown: false },
    a1: { color: 'black', role: 'advisor', faceDown: false },
    a3: { color: 'black', role: 'soldier', faceDown: true },
    b3: { color: 'red', role: 'horse', faceDown: true },
    c2: { color: 'black', role: 'cannon', faceDown: true },
    c1: { color: 'red', role: 'soldier', faceDown: true },
    f4: { color: 'red', role: 'general', faceDown: false },
    h2: { color: 'black', role: 'general', faceDown: false },
    e3: { color: 'black', role: 'elephant', faceDown: false },
    g4: { color: 'red', role: 'elephant', faceDown: false },
  };
  // Red seat plays red ink and is to move: the advisor has just arrived on a1.
  return { ...state, board, firstColor: 'red', ply: 40, moveNumber: 21 };
}

const CHASE_CYCLE_NARRATIVES = [
  'The black advisor on a1 attacks the red chariot on a2. Face-down tiles on a3, b3, c2 and c1 close its other exits.',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  'The advisor’s fourth chase brings the board back where it started. Each lap repeats every position, so under plain threefold repetition the game is drawn early in the third lap. Under Mistboard’s rule, the chase move that would make a position appear for the third time is forbidden.',
];

export const BANQI_CHASE_CYCLE_STEPS = CHASE_CYCLE_NARRATIVES.map((narrative, k) => {
  const move = k === 0 ? null : CHASE_CYCLE_MOVES[k - 1]!;
  return {
    svg: () => {
      let state = chaseCycleStart();
      for (const step of CHASE_CYCLE_MOVES.slice(0, k)) state = applyBanqiMove(state, step);
      return frame(getBanqiPlayerView(state, 'red'), move, `bq-chase-cycle-${k}`);
    },
    move: move ? `${move.from}-${move.to}` : undefined,
    narrative,
  };
});

// ── 3. A herding chase that wins a piece (real: 2026-09-30) ─────────────────
// After 176 actions the human's black general on b4 starts after the bot's red
// advisor on b2. The general moves at plies 176, 178, 180, 182 and 184; the
// advisor runs c2, d2, d3, e3, f3, and the human's other advisor takes it from
// f2 at ply 186.
export const CHASE_HERD_START_PLY = 176;
export const CHASE_HERD_END_PLY = 186;
export const CHASE_HERD_ROUTE: BanqiSquare[] = ['b2', 'c2', 'd2', 'd3', 'e3', 'f3'];

export const BANQI_CHASE_HERD_START = () =>
  figure(
    banqiReplayViewAt(BANQI_CHASE_HERD_GAME.deal, BANQI_CHASE_HERD_GAME.moves, CHASE_HERD_START_PLY),
    'THE ADVISOR RUNS FIVE TIMES',
    route(CHASE_HERD_ROUTE, TITLE_H),
  );

export const BANQI_CHASE_HERD_END = () =>
  figure(
    banqiReplayViewAt(BANQI_CHASE_HERD_GAME.deal, BANQI_CHASE_HERD_GAME.moves, CHASE_HERD_END_PLY),
    'THE OTHER ADVISOR TAKES IT',
    arrow('f2', 'f3', TITLE_H, 'bq-chase-herd-take'),
  );

// Card art: the back-and-forth position from the real game, full board.
export const BANQI_CHASE_THUMBNAIL = () =>
  xqSvg(
    BANQI_BOARD_W,
    BANQI_ENGINE_THUMB_H,
    [
      banqiBoardGrid(0, BANQI_ENGINE_THUMB_Y),
      banqiPiecesFromView(
        banqiReplayViewAt(
          BANQI_CHASE_DRAW_GAME.deal,
          BANQI_CHASE_DRAW_GAME.moves,
          CHASE_DRAW_VIEW_PLY,
        ),
        0,
        BANQI_ENGINE_THUMB_Y,
      ),
      arrow('g1', 'f1', BANQI_ENGINE_THUMB_Y, 'bq-chase-thumb-r'),
      arrow('g2', 'f2', BANQI_ENGINE_THUMB_Y, 'bq-chase-thumb-a'),
    ].join(''),
  );
