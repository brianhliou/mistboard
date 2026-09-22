// Banqi rules-page diagrams, in the jungle page's idiom: the ladder as a plain
// row of pieces, and every rule shown on the real board renderer
// (renderBanqiBoardSvg, the one the room, watch and review pages draw; its
// stylesheet comes along as live-banqi-board.css) with the board's own move hints — a dot for a square the selected piece can move to,
// a ring for a piece it can capture. A rule the kernel would not allow cannot
// be drawn: each diagram asks getBanqiLegalMovesFrom for the marks, so the
// picture and the engine agree by construction.

import {
  ALL_BANQI_SQUARES,
  type BanqiGameState,
  type BanqiMove,
  type BanqiPieceRole,
  type BanqiSquare,
  getBanqiLegalMovesFrom,
  getBanqiPlayerView,
} from '@mistboard/game';
import { activeXiangqiPieceSet } from './articles/diagrams.js';
import './live-banqi-board.css';
import { renderBanqiBoardSvg } from './live-banqi-render.js';
import { renderXiangqiPieceGlyphed } from './xiangqi-piece-sets.js';

function responsive(svg: string, maxWidth: number): string {
  return svg
    .trim()
    .replace(
      '<svg ',
      `<svg width="100%" style="max-width:${maxWidth}px;height:auto;display:block;margin:0 auto" `,
    );
}

// The room draws the board at its native 568 units; the diagrams do the same, so
// the selection tint, the dots and the capture rings are the size a player sees.
const FULL_WIDTH = 568;

/** Tag the SVG with the diagram id. The board's presentation comes from
 *  live-banqi-board.css, imported above, so the prerendered page styles it. */
function withStyle(svg: string, id: string): string {
  return svg.trim().replace('<svg ', `<svg data-banqi-diagram="${id}" `);
}

/** A square's content in a diagram: a revealed piece, or a face-down tile. */
export type BanqiDiagramEntry = { color: 'red' | 'black'; role: BanqiPieceRole } | 'down';
export type BanqiDiagramBoard = Partial<Record<BanqiSquare, BanqiDiagramEntry>>;

// The kernel wants a colour and role under a face-down tile; a diagram does not
// know or care what is under one, because a face-down tile blocks movement and
// refuses capture whatever it hides. The filler never reaches the drawing.
const HIDDEN_FILLER = { color: 'black', role: 'soldier', faceDown: true } as const;

function diagramState(board: BanqiDiagramBoard, toMove: 'red' | 'black'): BanqiGameState {
  const kernelBoard: BanqiGameState['board'] = {};
  for (const square of ALL_BANQI_SQUARES) {
    const entry = board[square];
    if (!entry) continue;
    kernelBoard[square] =
      entry === 'down'
        ? { ...HIDDEN_FILLER }
        : { color: entry.color, role: entry.role, faceDown: false };
  }
  // Red ink is bound to the red seat and moves on even plies; black on odd.
  return {
    id: 'diagram',
    board: kernelBoard,
    status: { type: 'playing', turn: toMove },
    ply: toMove === 'red' ? 0 : 1,
    firstColor: 'red',
    moveNumber: 1,
    noProgressClock: 0,
    repCounts: {},
    captures: [],
  };
}

/**
 * One position, one piece selected, every legal destination marked by the
 * board itself. `expect` lists the squares the diagram is meant to show as
 * targets; the render throws if the kernel disagrees, so a wrong diagram fails
 * the build instead of teaching a wrong rule.
 */
export function banqiMoveDiagram(opts: {
  id: string;
  board: BanqiDiagramBoard;
  from: BanqiSquare;
  expect: readonly BanqiSquare[];
  arrowTo?: BanqiSquare;
  maxWidth?: number;
}): () => string {
  return () => {
    const piece = opts.board[opts.from];
    if (!piece || piece === 'down')
      throw new Error(`banqi diagram ${opts.id}: nothing to move on ${opts.from}`);
    const state = diagramState(opts.board, piece.color);
    const moves: BanqiMove[] = getBanqiLegalMovesFrom(state, opts.from).filter(
      (m) => m.to !== m.from,
    );
    const targets = moves.map((m) => m.to).sort();
    const expected = [...opts.expect].sort();
    if (targets.join(' ') !== expected.join(' ')) {
      throw new Error(
        `banqi diagram ${opts.id}: kernel allows ${opts.from} -> [${targets.join(' ')}], diagram expects [${expected.join(' ')}]`,
      );
    }
    const view = getBanqiPlayerView(state, piece.color);
    const svg = renderBanqiBoardSvg(view, piece.color, {
      selectedSquare: opts.from,
      legalMoves: moves,
      pieceSet: activeXiangqiPieceSet,
      arrows: opts.arrowTo
        ? [{ from: opts.from, to: opts.arrowTo, color: '#1f6f5b', opacity: 0.88, width: 9 }]
        : [],
    });
    return responsive(withStyle(svg, opts.id), opts.maxWidth ?? FULL_WIDTH);
  };
}

/** A position with nothing selected: the setup, or a board to look at. */
export function banqiPositionDiagram(opts: {
  id: string;
  board: BanqiDiagramBoard;
  /** The tile just flipped, tinted the way the room tints a last move. */
  flipped?: BanqiSquare;
  maxWidth?: number;
}): () => string {
  return () => {
    const state = diagramState(opts.board, 'red');
    if (opts.flipped) {
      state.lastMove = { from: opts.flipped, to: opts.flipped };
      state.ply = 1;
    }
    const view = getBanqiPlayerView(state, 'red');
    const svg = renderBanqiBoardSvg(view, 'red', { pieceSet: activeXiangqiPieceSet });
    return responsive(withStyle(svg, opts.id), opts.maxWidth ?? FULL_WIDTH);
  };
}

// ── The ladder ───────────────────────────────────────────────────────────────

const LADDER: Array<{ role: BanqiPieceRole; label: string }> = [
  { role: 'general', label: 'General' },
  { role: 'advisor', label: 'Advisor' },
  { role: 'elephant', label: 'Elephant' },
  { role: 'chariot', label: 'Chariot' },
  { role: 'horse', label: 'Horse' },
  { role: 'cannon', label: 'Cannon' },
  { role: 'soldier', label: 'Soldier' },
];

/** Red row, black row, names under: the jungle page's ladder, with banqi's
 *  pieces. The cannon sits where it ranks as a target; the caption says the
 *  rest. No panel, no HIGH/LOW: left-to-right already reads strongest first. */
export const BANQI_RANK_LADDER = (): string => {
  const slot = 80;
  const token = 50;
  const topPad = 6;
  const redCy = topPad + token / 2;
  const blackCy = redCy + 56;
  const labelY = blackCy + token / 2 + 17;
  const width = LADDER.length * slot;
  const height = labelY + 8;
  const cells = LADDER.map(({ role, label }, i) => {
    const cx = i * slot + slot / 2;
    return [
      renderXiangqiPieceGlyphed({ color: 'red', role }, activeXiangqiPieceSet, {
        x: cx - token / 2,
        y: redCy - token / 2,
        size: token,
      }),
      renderXiangqiPieceGlyphed({ color: 'black', role }, activeXiangqiPieceSet, {
        x: cx - token / 2,
        y: blackCy - token / 2,
        size: token,
      }),
      `<text x="${cx}" y="${labelY}" font-size="12" fill="currentColor" text-anchor="middle" font-weight="600">${label}</text>`,
    ].join('');
  }).join('');
  const svg = `<svg class="banqi-rank-ladder" viewBox="0 0 ${width} ${height}" role="img" xmlns="http://www.w3.org/2000/svg" aria-label="The red and black banqi pieces in rank order, strongest to weakest">${cells}</svg>`;
  return responsive(svg, 600);
};

// ── Positions ────────────────────────────────────────────────────────────────

/** Every tile face-down: the board before the first flip. */
export const BANQI_SETUP: () => string = banqiPositionDiagram({
  id: 'setup',
  board: Object.fromEntries(ALL_BANQI_SQUARES.map((s) => [s, 'down'])) as BanqiDiagramBoard,
});

const down = (squares: readonly BanqiSquare[]): BanqiDiagramBoard =>
  Object.fromEntries(squares.map((s) => [s, 'down'])) as BanqiDiagramBoard;

/** The first flip: one tile turned up red, so the player who flipped it is red
 *  for the game and the opponent is black. The tint is the room's last-move mark. */
export const BANQI_FIRST_FLIP: () => string = banqiPositionDiagram({
  id: 'first-flip',
  board: {
    ...down(ALL_BANQI_SQUARES.filter((s) => s !== 'd2')),
    d2: { color: 'red', role: 'horse' },
  },
  flipped: 'd2',
});

// A move: one square in four directions, onto empty squares only; the
// face-down tile beside it is not a destination.
export const BANQI_STEP = banqiMoveDiagram({
  id: 'step',
  board: { ...down(['c3']), c2: { color: 'red', role: 'horse' } },
  from: 'c2',
  expect: ['b2', 'd2', 'c1'],
});

// Capture by rank: the horse may take the black soldier and the black horse
// (equal rank), not the black chariot above it. The empty square is a plain move.
export const BANQI_RANK_CAPTURE = banqiMoveDiagram({
  id: 'rank-capture',
  board: {
    d2: { color: 'red', role: 'horse' },
    c2: { color: 'black', role: 'soldier' },
    e2: { color: 'black', role: 'horse' },
    d3: { color: 'black', role: 'chariot' },
  },
  from: 'd2',
  expect: ['c2', 'e2', 'd1'],
});

// The exception at the ends of the ladder: the soldier takes the general.
export const BANQI_SOLDIER_TAKES_GENERAL = banqiMoveDiagram({
  id: 'soldier-general',
  board: {
    d2: { color: 'red', role: 'soldier' },
    e2: { color: 'black', role: 'general' },
    c2: { color: 'black', role: 'horse' },
  },
  from: 'd2',
  expect: ['e2', 'd1', 'd3'],
});

// …and the general cannot take the soldier back.
export const BANQI_GENERAL_CANNOT_TAKE_SOLDIER = banqiMoveDiagram({
  id: 'general-soldier',
  board: {
    e2: { color: 'black', role: 'general' },
    d2: { color: 'red', role: 'soldier' },
    f2: { color: 'red', role: 'advisor' },
  },
  from: 'e2',
  expect: ['f2', 'e1', 'e3'],
});

// The cannon: a screen one square away, the target beyond it. It can also
// step to the empty squares beside it like any piece.
export const BANQI_CANNON_SCREEN = banqiMoveDiagram({
  id: 'cannon-screen',
  board: {
    b2: { color: 'red', role: 'cannon' },
    ...down(['d2']),
    g2: { color: 'black', role: 'general' },
  },
  from: 'b2',
  expect: ['g2', 'a2', 'c2', 'b1', 'b3'],
  arrowTo: 'g2',
});

// No screen, no capture: the adjacent black chariot is not a target, and
// neither is the piece two squares away with nothing between.
export const BANQI_CANNON_NO_SCREEN = banqiMoveDiagram({
  id: 'cannon-no-screen',
  board: {
    b2: { color: 'red', role: 'cannon' },
    c2: { color: 'black', role: 'chariot' },
    b4: { color: 'black', role: 'horse' },
  },
  from: 'b2',
  expect: ['a2', 'b1', 'b3'],
});

// The screen may be anything: here a friendly piece, and the cannon still
// captures beyond it; the face-down tile past the general is not a target.
export const BANQI_CANNON_FRIENDLY_SCREEN = banqiMoveDiagram({
  id: 'cannon-friendly-screen',
  board: {
    b2: { color: 'red', role: 'cannon' },
    d2: { color: 'red', role: 'soldier' },
    f2: { color: 'black', role: 'elephant' },
    ...down(['h2']),
  },
  from: 'b2',
  expect: ['f2', 'a2', 'c2', 'b1', 'b3'],
  arrowTo: 'f2',
});

// The cannon as a target: the horse may take it, the soldier may not.
export const BANQI_CANNON_AS_TARGET = banqiMoveDiagram({
  id: 'cannon-target',
  board: {
    d2: { color: 'black', role: 'horse' },
    e2: { color: 'red', role: 'cannon' },
    c2: { color: 'red', role: 'chariot' },
  },
  from: 'd2',
  expect: ['e2', 'd1', 'd3'],
});

export const BANQI_SOLDIER_CANNOT_TAKE_CANNON = banqiMoveDiagram({
  id: 'soldier-cannon',
  board: {
    d2: { color: 'black', role: 'soldier' },
    e2: { color: 'red', role: 'cannon' },
    c2: { color: 'red', role: 'soldier' },
  },
  from: 'd2',
  expect: ['c2', 'd1', 'd3'],
});
