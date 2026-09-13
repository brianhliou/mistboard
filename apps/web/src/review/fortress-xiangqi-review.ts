// Fortress Xiangqi review surface: the fortress presentation bundle over the
// generic tree-review controller (mountTreeReview). Fortress is perfect-information,
// so the tree reconstructs every position (including drops) from the move list.
//
// SLICE 2 (this file): interactive BOARD moves + branching tree + CLIENT CEVAL
// engine (Fairy-Stockfish 'fortressxiangqi' — ceval loads the custom
// fortress-xiangqi.ini). The eval gauge + engine panel + Share FEN are live; the
// engine reads the tree's FSF move list (startpos + moves), so no server round-trip.
// Board-move PV arrows are live. A drop has no origin square, so its destination
// marker remains a separate slice. Drop reserves are DISPLAYED (see `material`
// below — the pocket is position, not decoration); the drop GESTURE is still
// absent, so drops replay in the mainline but cannot be played from the rail.

import {
  type FortressXiangqiColor,
  type FortressXiangqiGameState,
  type FortressXiangqiMove,
  type FortressXiangqiPlayerView,
  fortressXiangqiEngineFen,
  fsfUciToFortressXiangqiMove,
  getFortressXiangqiPlayerView,
  isFortressXiangqiDropMove,
} from '@mistboard/game';
// The reserve rows below reuse the shared drop pocket styling; the review family
// does not otherwise pull it in, so the study path rendered zero-height rows
// until this import existed.
import '../drop-reserve.css';
import { createFortressXiangqiInteractiveBoard } from '../fortress-xiangqi-board.js';
import {
  animateFortressXiangqiBoardMove,
  type FortressXiangqiBoardArrow,
  type FortressXiangqiBoardMarker,
  FXQ_GEO,
} from '../fortress-xiangqi-render.js';
import { fillFortressXiangqiReserve, fortressXiangqiMoveLabel } from '../fortress-xiangqi-view.js';
import { xiangqiAppearanceChangedEvent } from '../theme.js';
import { xiangqiBoardAspect } from '../xiangqi-board-aspect.js';
import { xiangqiNotationChangedEvent } from '../xiangqi-notation.js';
import {
  bestMoveArrowWithParser,
  bestMoveMarkerWithParser,
  engineArrowsFromLinesWithParser,
  engineMarkersFromLinesWithParser,
} from './engine/engine-arrows.js';
import { fortressXiangqiTreeAdapter } from './fortress-xiangqi-tree-adapter.js';
import type { NodeShape } from './game-tree.js';
import {
  mountTreeReview,
  type TreePresentation,
  type TreeReviewConfig,
  type TreeReviewHandle,
} from './tree-review.js';

// Fairy-Stockfish fortress UCI back to our readable label for the PV lines (board
// 'a1b2' → 'a1-b2', drop 'Q@e5' → the treasure-drop label); fall back to the raw
// UCI if a PV token does not parse.
function formatFortressEngineMove(uci: string): string {
  const move = fsfUciToFortressXiangqiMove(uci);
  return move ? fortressXiangqiMoveLabel(move) : uci;
}

function parseFortressBoardMove(
  uci: string,
): { from?: FortressXiangqiBoardArrow['from']; to: FortressXiangqiBoardArrow['to'] } | null {
  const move = fsfUciToFortressXiangqiMove(uci);
  if (!move) return null;
  return isFortressXiangqiDropMove(move) ? { to: move.to } : move;
}

/** Config for a Fortress Xiangqi review mount. */
export type FortressXiangqiReviewConfig = TreeReviewConfig<
  FortressXiangqiMove,
  FortressXiangqiGameState
>;

/** Handle returned by mountFortressXiangqiReview: snapshot the tree to persist it. */
export type FortressXiangqiReviewHandle = TreeReviewHandle;

const fortressPresentation: TreePresentation<
  FortressXiangqiMove,
  FortressXiangqiGameState,
  FortressXiangqiPlayerView,
  FortressXiangqiColor,
  FortressXiangqiBoardArrow,
  FortressXiangqiBoardMarker
> = {
  adapter: fortressXiangqiTreeAdapter,
  engine: {
    panelVariant: 'fortressxiangqi',
    fen: fortressXiangqiEngineFen,
    formatPvMove: formatFortressEngineMove,
    moveFromEngineUci: fsfUciToFortressXiangqiMove,
    engineArrowsFromLines: (lines) =>
      engineArrowsFromLinesWithParser(lines, parseFortressBoardMove),
    engineMarkersFromLines: (lines) =>
      engineMarkersFromLinesWithParser(lines, parseFortressBoardMove),
    bestMoveArrow: (best) => bestMoveArrowWithParser(best, parseFortressBoardMove),
    bestMoveMarker: (best) => bestMoveMarkerWithParser(best, parseFortressBoardMove),
  },
  boardHostClassName: 'fortress-xiangqi-postgame-board fortress-xiangqi-live-board',
  boardWrapClassName: 'dxq-postgame__board-wrap review-board-host',
  defaultBoardAriaLabel: 'Fortress Xiangqi board',
  boardAspect: () => xiangqiBoardAspect(FXQ_GEO),
  // Both events matter now that coordinates are drawn ON the board: a notation
  // change relabels them, and toggling them changes the board's geometry. Before
  // that, this surface needed neither -- its pieces pick up their set via CSS --
  // which is why /analysis/{variant} ignored every appearance change until 2026-08-27.
  appearanceEvent: xiangqiAppearanceChangedEvent,
  labelsEvent: xiangqiNotationChangedEvent,
  boardCols: 7,
  perspective: (flipped) => (flipped ? 'black' : 'red'),
  seatFor: (view) => (view.status.type === 'playing' ? view.status.turn : null),
  createBoard: (opts) => createFortressXiangqiInteractiveBoard(opts),
  // Only board moves glide; a drop has no origin square, so it renders discretely.
  animateMove: (boardEl, move, perspective, opts) => {
    if (!isFortressXiangqiDropMove(move)) {
      animateFortressXiangqiBoardMove(boardEl, move, perspective, opts);
    }
  },
  shapeToArrow: (s: NodeShape): FortressXiangqiBoardArrow => ({
    from: s.orig as FortressXiangqiBoardArrow['from'],
    to: (s.dest ?? s.orig) as FortressXiangqiBoardArrow['to'],
    className: `xq-arrow--draw xq-shape--${s.brush}`,
  }),
  shapeToMarker: (s: NodeShape): FortressXiangqiBoardMarker => ({
    square: s.orig as FortressXiangqiBoardMarker['square'],
    kind: 'circle',
    className: `xq-shape--${s.brush}`,
  }),
  // Judgment badge on the square the move landed on, so the board states the
  // same verdict the move list does (lila pins its glyphs the same way). A drop
  // has no `from`, but it still HAS a destination, so both union members work.
  moveGlyphMarker: (move: FortressXiangqiMove, glyph): FortressXiangqiBoardMarker => ({
    square: move.to,
    kind: 'glyph',
    text: glyph.text,
    className: `xq-marker--${glyph.tone}`,
  }),
  // Drop reserves ARE rendered on review / analysis / study, unlike the captured
  // material rows the rest of the review family suppresses (#166). The distinction
  // is not taste: in a drop variant the reserve is part of the POSITION, not a
  // record of what has been taken. You cannot read a fortress position without
  // knowing what is droppable, so an absent reserve hides board state the same way
  // a missing rank would. It is also why this renders the pocket itself rather
  // than #166's material DIFF — an imbalance number cannot say what you hold.
  //
  // The reflow that got the material rows removed is handled in CSS, not here:
  // .drop-mini-reserve-strip pins its band height for :empty too, so an empty
  // pocket keeps its footprint and the first capture does not shove the rail.
  //
  // Fortress is perfect information, so ONE projection carries both seats'
  // pockets and the rows never depend on whose turn it is. rootTruth is unused
  // for the same reason: a pocket is absolute, not a diff against the root.
  material: (hosts) => (truth, _rootTruth, flipped) => {
    // The board puts perspective(flipped) at the bottom; reserves follow it, so
    // this matches the live room (bottom = your pocket, top = the opponent's).
    const bottom: FortressXiangqiColor = flipped ? 'black' : 'red';
    const top: FortressXiangqiColor = bottom === 'red' ? 'black' : 'red';
    const view = getFortressXiangqiPlayerView(truth, bottom);
    // allRoles: the rail draws every droppable role and ghosts the empty ones,
    // the way lichess draws a crazyhouse pocket. Held-only rows read as blank
    // space for most of a game and shift as the pocket changes; a fixed set of
    // slots states what CAN be dropped and keeps each piece in the same place.
    fillFortressXiangqiReserve(hosts.top, view, top, { allRoles: true });
    fillFortressXiangqiReserve(hosts.bottom, view, bottom, { allRoles: true });
  },
};

export function mountFortressXiangqiReview(
  root: HTMLElement,
  config: FortressXiangqiReviewConfig,
): FortressXiangqiReviewHandle {
  return mountTreeReview(root, fortressPresentation, config);
}
