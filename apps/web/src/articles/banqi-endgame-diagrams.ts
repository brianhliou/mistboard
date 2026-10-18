// Boards for the chariot-and-horse banqi endgame article. Every position is a
// FEN read by the kernel, so the figures use the same move generator as the
// game. banqi-endgame-diagrams.test.ts reads the shipped tablebase
// (apps/web/public/tablebase/banqi) and asserts what each caption says.
import {
  applyBanqiMove,
  BANQI_STUDY_MOVE_OPTIONS,
  type BanqiGameState,
  type BanqiMove,
  type BanqiSquare,
  getBanqiPlayerView,
  parseBanqiFen,
} from '@mistboard/game';
import {
  BANQI_BOARD_H,
  BANQI_BOARD_W,
  BANQI_ENGINE_THUMB_H,
  BANQI_CELL,
  BANQI_ENGINE_THUMB_Y,
  banqiArrow,
  banqiBoardGrid,
  banqiCellCenter,
  banqiPiecesFromView,
  xqSvg,
} from './diagrams.js';
import { BANQI_PIECE_REACH } from '../live-banqi-render.js';

const TITLE_H = 28;

// Red (chariot h3, horse c1, soldier b2) against black (chariot h1, horse a2),
// red to move: red's longest win in this material, 67 plies.
export const ENDGAME_ROOT_FEN = '8/7R/hS6/2H4r r - 0 1';

// The fastest win, best play for both sides (the tablebase's first row at each
// ply; the test checks every move against the table). Same line as the study.
export const ENDGAME_LINE = parseLine(`
  c1c2 h1g1 h3g3 g1f1 g3f3 f1e1 f3e3 e1d1 e3d3 d1c1 d3c3 c1b1 c3b3 b1c1
  b3a3 a2a1 c2c3 a1b1 a3a2 c1c2 a2a1 b1c1 a1b1 c1d1 c3d3 d1e1 d3e3 e1f1
  e3f3 f1g1 f3g3 g1h1 g3h3 c2d2 b1c1 d2e2 c1d1 e2f2 d1e1 f2g2 e1f1 g2h2
  f1g1 h2h3 g1h1 h3g3 h1g1 g3f3 g1f1 f3e3 f1e1 e3d3 e1d1 d3c3 d1d2 c3b3
  b2c2 b3c3 c2c1 c3b3 d2c2 b3a3 c2b2 a3a4 b2b3 a4b4 b3b4`);

function parseLine(text: string): BanqiMove[] {
  return text
    .trim()
    .split(/\s+/)
    .map((token) => ({ from: token.slice(0, 2) as BanqiSquare, to: token.slice(2, 4) as BanqiSquare }));
}

export function endgameState(fen: string): BanqiGameState {
  const parsed = parseBanqiFen(fen);
  if (!parsed.ok) throw new Error(`banqi endgame figure: ${parsed.error}`);
  return parsed.state;
}

/** The position after `plies` moves of `line` from `fen`, with the 40-ply
 *  clock off (the clock would end the main line at ply 40). */
export function endgameStateAt(fen: string, line: readonly BanqiMove[], plies: number): BanqiGameState {
  let state = endgameState(fen);
  for (const move of line.slice(0, plies)) state = applyBanqiMove(state, move, BANQI_STUDY_MOVE_OPTIONS);
  return state;
}

function cell(square: BanqiSquare): { col: number; row: number } {
  return { col: square.charCodeAt(0) - 97, row: 4 - Number(square[1]) };
}

function title(text: string): string {
  return `<text x="${BANQI_BOARD_W / 2}" y="14" font-family="system-ui, sans-serif" font-size="13" font-weight="700" class="xq-diagram-title" text-anchor="middle">${text}</text>`;
}

function arrow(from: BanqiSquare, to: BanqiSquare, y0: number, id: string): string {
  return banqiArrow(cell(from), cell(to), 0, y0, id, 14);
}

// The steps between two pieces as one solid arrow along the squares between
// them: it leaves the edge of the first piece's disc and its tip stops on the
// edge of the last one's.
const DISC_R = (BANQI_CELL * BANQI_PIECE_REACH) / 2;
const PATH_STROKE = 6;
// The marker's tip runs (3 - 2.05) stroke widths past the line's end.
const PATH_TIP = (3 - 2.05) * PATH_STROKE;

function pathArrow(squares: readonly BanqiSquare[], y0: number, id: string): string {
  const points = squares.map((square) => {
    const { col, row } = cell(square);
    return banqiCellCenter(col, row, 0, y0);
  });
  const toward = (from: { x: number; y: number }, to: { x: number; y: number }, by: number) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    return { x: from.x + (dx / length) * by, y: from.y + (dy / length) * by };
  };
  const last = points.length - 1;
  points[0] = toward(points[0]!, points[1]!, DISC_R);
  points[last] = toward(points[last]!, points[last - 1]!, DISC_R + PATH_TIP);
  return [
    `<defs><marker id="${id}" markerWidth="4" markerHeight="4" refX="2.05" refY="2" orient="auto" overflow="visible" markerUnits="strokeWidth"><path d="M0,0 V4 L3,2 Z" fill="#15781B"/></marker></defs>`,
    `<polyline points="${points.map(({ x, y }) => `${x},${y}`).join(' ')}" fill="none" stroke="#15781B" stroke-width="${PATH_STROKE}" stroke-linejoin="round" opacity="0.85" marker-end="url(#${id})"/>`,
  ].join('');
}

function figure(state: BanqiGameState, heading: string, overlay = ''): string {
  return xqSvg(
    BANQI_BOARD_W,
    BANQI_BOARD_H + TITLE_H,
    [
      title(heading),
      banqiBoardGrid(0, TITLE_H),
      banqiPiecesFromView(getBanqiPlayerView(state, 'red'), 0, TITLE_H),
      overlay,
    ].join(''),
  );
}

// ── 1. Two chariots alone ───────────────────────────────────────────────────
// Black to move in both: four steps apart (c2 to f3) black loses, three apart (c2
// to e3) black wins.
export const PARITY_EVEN_FEN = '8/5R2/2r5/8 b - 0 1';
export const PARITY_ODD_FEN = '8/4R3/2r5/8 b - 0 1';

// The squares each arrow walks, black's chariot to red's.
export const PARITY_EVEN_PATH: BanqiSquare[] = ['c2', 'd2', 'e2', 'f2', 'f3'];
export const PARITY_ODD_PATH: BanqiSquare[] = ['c2', 'd2', 'e2', 'e3'];

export const BANQI_ENDGAME_PARITY_EVEN = () =>
  figure(
    endgameState(PARITY_EVEN_FEN),
    'FOUR STEPS APART: BLACK LOSES',
    pathArrow(PARITY_EVEN_PATH, TITLE_H, 'bq-endgame-even'),
  );

export const BANQI_ENDGAME_PARITY_ODD = () =>
  figure(endgameState(PARITY_ODD_FEN), 'THREE STEPS APART: BLACK WINS', pathArrow(PARITY_ODD_PATH, TITLE_H, 'bq-endgame-odd'));

// ── 2. The position ─────────────────────────────────────────────────────────
export const BANQI_ENDGAME_ROOT = () => figure(endgameState(ENDGAME_ROOT_FEN), 'RED TO MOVE AND WIN');

// Card art: the position, full board, with the line's first move (c1-c2).
export const BANQI_ENDGAME_THUMBNAIL = () =>
  xqSvg(
    BANQI_BOARD_W,
    BANQI_ENGINE_THUMB_H,
    [
      banqiBoardGrid(0, BANQI_ENGINE_THUMB_Y),
      banqiPiecesFromView(getBanqiPlayerView(endgameState(ENDGAME_ROOT_FEN), 'red'), 0, BANQI_ENGINE_THUMB_Y),
      arrow('c1', 'c2', BANQI_ENGINE_THUMB_Y, 'bq-endgame-thumb'),
    ].join(''),
  );
