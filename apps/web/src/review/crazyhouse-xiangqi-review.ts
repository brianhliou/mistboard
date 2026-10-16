// Crazyhouse Xiangqi review surface: the crazyhouse presentation bundle over the
// generic tree-review controller (mountTreeReview), the surface Fortress and
// Atomic Xiangqi have. Perfect information on the standard 9x10 board, so the
// tree rebuilds every position, drops included, from the move list.
//
// What this variant adds to the standard xiangqi board:
//   - BOTH POCKETS at every ply, in the rail above and below the moves (the
//     `material` hook), drawn as the same lichess pocket the live room shows.
//     In a drop variant the hand is part of the position: a board without it
//     does not say what can land next.
//   - a DROP as the last move is ringed on the point it landed on (a drop has
//     no origin, so the from/to pair has nothing to draw).
//
// The client engine is the shared Fairy-Stockfish core (engine/ceval.ts) with
// crazyhouse-xiangqi.ini written into it at load: stock options only, and the
// core matched the native engine at every parity-fixture position. Positions
// are fed as UCI from the start (positionMode 'moves'); the tree adapter's UCI
// is already Fairy-Stockfish's (board `a1a2`, drop `P@e5`), so a drop in a PV
// lands as a ring on its point rather than an arrow.
//
// Both moves and drops are playable from any node, as in the live room: tap
// a piece in the side to move's pocket and then a marked point, or drag it
// out of the pocket onto the board (hand-drag.ts, touch included). The drop
// selection is per mount, shared by the board and the two pocket hosts.

import {
  type CrazyhouseXiangqiColor,
  type CrazyhouseXiangqiDropRole,
  type CrazyhouseXiangqiGameState,
  type CrazyhouseXiangqiMove,
  type CrazyhouseXiangqiPlayerView,
  type CrazyhouseXiangqiSquare,
  crazyhouseXiangqiFen,
  crazyhouseXiangqiMoveFromUci,
  getCrazyhouseXiangqiPlayerView,
  isCrazyhouseXiangqiDropMove,
} from '@mistboard/game';
// ORDER MATTERS: live-xiangqi.css draws the board; the pocket rules ride on it.
import '../live-xiangqi.css';
import '../drop-reserve.css';
import {
  crazyhouseXiangqiBoardView,
  crazyhouseXiangqiDropTargets,
  crazyhouseXiangqiLastDrop,
  crazyhouseXiangqiMoveLabel,
  fillCrazyhouseXiangqiReserve,
  isCrazyhouseXiangqiDropRole,
} from '../crazyhouse-xiangqi-view.js';
import { xiangqiAppearanceChangedEvent } from '../theme.js';
import { installHandDrag } from '../variant-tenant/hand-drag.js';
import {
  animateXiangqiBoardMove,
  createXiangqiInteractiveBoard,
  isXiangqiColor,
  LIVE_BOARD_GEO,
  XIANGQI_PIECE_SIZE,
  type XiangqiBoardArrow,
  type XiangqiBoardMarker,
  type XiangqiInteractiveBoard,
  xiangqiPieceGhostSvg,
} from '../xiangqi-board.js';
import { xiangqiBoardAspect } from '../xiangqi-board-aspect.js';
import { xiangqiNotationChangedEvent } from '../xiangqi-notation.js';
import { crazyhouseXiangqiTreeAdapter } from './crazyhouse-xiangqi-tree-adapter.js';
import {
  bestMoveArrowWithParser,
  bestMoveMarkerWithParser,
  engineArrowsFromLinesWithParser,
  engineMarkersFromLinesWithParser,
} from './engine/engine-arrows.js';
import type { NodeShape } from './game-tree.js';
import {
  mountTreeReview,
  type TreeBoardFactoryOptions,
  type TreeBoardHandle,
  type TreePresentation,
  type TreeReviewConfig,
  type TreeReviewHandle,
} from './tree-review.js';

export type CrazyhouseXiangqiReviewConfig = TreeReviewConfig<
  CrazyhouseXiangqiMove,
  CrazyhouseXiangqiGameState
>;
export type CrazyhouseXiangqiReviewHandle = TreeReviewHandle;

type CrazyhouseBoardHandle = TreeBoardHandle<
  CrazyhouseXiangqiPlayerView,
  CrazyhouseXiangqiColor,
  XiangqiBoardArrow,
  XiangqiBoardMarker
>;

type ReviewBoardOptions = TreeBoardFactoryOptions<
  CrazyhouseXiangqiMove,
  CrazyhouseXiangqiPlayerView,
  CrazyhouseXiangqiColor
>;

/**
 * One mount's drop input: the hand piece selected in a pocket, shared by the
 * board (drop targets, the click that lands it) and the two pocket hosts
 * (which side's tiles are buttons, tap to select, drag onto the board). The
 * tree controller builds the board and the pockets separately, so both reach
 * the selection through this object.
 */
export function createCrazyhouseXiangqiDropInput() {
  let selectedRole: CrazyhouseXiangqiDropRole | null = null;
  let boardOpts: ReviewBoardOptions | null = null;
  let inner: XiangqiInteractiveBoard | null = null;
  let lastDrop: CrazyhouseXiangqiSquare | null = null;
  let pockets: { top: HTMLElement; bottom: HTMLElement } | null = null;
  let shownTruth: CrazyhouseXiangqiGameState | null = null;
  let flipped = false;

  /** The view drops are legal in, or null when this board takes no input. */
  const playableView = (): CrazyhouseXiangqiPlayerView | null => {
    if (!boardOpts?.enabled()) return null;
    const view = boardOpts.getInteractionView();
    if (view?.status.type !== 'playing') return null;
    return boardOpts.seatFor(view) === view.status.turn ? view : null;
  };
  /** The side whose hand may drop now (the side to move), else null. */
  const mover = (): CrazyhouseXiangqiColor | null => {
    const view = playableView();
    return view?.status.type === 'playing' ? view.status.turn : null;
  };
  const boardView = (view: CrazyhouseXiangqiPlayerView | null) =>
    view ? crazyhouseXiangqiBoardView(view) : null;

  function repaintBoard(): void {
    if (!inner || !boardOpts) return;
    inner.render(boardView(boardOpts.getInteractionView()), boardOpts.getPerspective());
  }

  function repaintPockets(): void {
    if (!pockets || !shownTruth) return;
    const bottom: CrazyhouseXiangqiColor = flipped ? 'black' : 'red';
    const top: CrazyhouseXiangqiColor = bottom === 'red' ? 'black' : 'red';
    const view = getCrazyhouseXiangqiPlayerView(shownTruth, bottom);
    const turn = mover();
    for (const [host, owner] of [
      [pockets.top, top],
      [pockets.bottom, bottom],
    ] as const) {
      fillCrazyhouseXiangqiReserve(host, view, owner, {
        pocket: true,
        interactive: turn === owner,
        selectedRole: turn === owner ? selectedRole : null,
        onSelect: (role) => select(selectedRole === role ? null : role),
      });
    }
  }

  function select(role: CrazyhouseXiangqiDropRole | null): void {
    selectedRole = role;
    // A hand piece and a board piece are never both lifted.
    inner?.clearSelection();
    repaintBoard();
    repaintPockets();
  }

  function dropTargets(): CrazyhouseXiangqiSquare[] {
    const view = playableView();
    return view ? crazyhouseXiangqiDropTargets(view, selectedRole) : [];
  }

  /** Land `role` on `to` when legal; true when the drop was played. */
  function play(role: CrazyhouseXiangqiDropRole, to: CrazyhouseXiangqiSquare): boolean {
    const view = playableView();
    if (!view || !boardOpts) return false;
    if (!crazyhouseXiangqiDropTargets(view, role).includes(to)) return false;
    selectedRole = null;
    boardOpts.onMove({ drop: role, to }, view);
    return true;
  }

  function canDragRole(owner: string | undefined, role: CrazyhouseXiangqiDropRole): boolean {
    const turn = mover();
    const view = playableView();
    return !!view && turn !== null && owner === turn && (view.hands[turn][role] ?? 0) > 0;
  }

  /** The standard interactive board, fed the board half of the crazyhouse
   *  view (crazyhouseXiangqiBoardView drops the drop moves from legalMoves; a
   *  drop lastMove becomes the landing ring via `lastDropSquare`), plus the
   *  drop targets and the click that lands a selected hand piece. */
  function createBoard(opts: ReviewBoardOptions): CrazyhouseBoardHandle {
    boardOpts = opts;
    inner = createXiangqiInteractiveBoard({
      board: opts.board,
      getInteractionView: () => boardView(opts.getInteractionView()),
      getPerspective: () => opts.getPerspective(),
      seatFor: () => {
        const view = opts.getInteractionView();
        return view ? opts.seatFor(view) : null;
      },
      enabled: () => opts.enabled(),
      onMove: (move) => {
        const view = opts.getInteractionView();
        if (view) opts.onMove(move, view);
      },
      lastDropSquare: () => lastDrop,
      dropTargets,
      takeSquareClick: (square) => {
        if (!selectedRole) return false;
        if (play(selectedRole, square as CrazyhouseXiangqiSquare)) return true;
        // A click off the targets puts the hand piece back and reads as a
        // board click (it may select a piece), as in the live room.
        selectedRole = null;
        repaintPockets();
        return false;
      },
      onPieceDragStart: () => {
        if (!selectedRole) return;
        selectedRole = null;
        repaintPockets();
      },
      ...(opts.onDrawShape
        ? {
            onDrawShape: (
              orig: CrazyhouseXiangqiSquare,
              dest: CrazyhouseXiangqiSquare | null,
              drawOpts,
            ) => opts.onDrawShape?.(orig, dest, drawOpts),
          }
        : {}),
    });
    return {
      // The controller renders on every navigation: a new position drops any
      // half-made drop selection.
      render: (view, perspective) => {
        selectedRole = null;
        lastDrop = view ? crazyhouseXiangqiLastDrop(view) : null;
        inner?.render(boardView(view), perspective);
      },
      setArrows: (arrows) => inner?.setArrows(arrows),
      setMarkers: (markers) => inner?.setMarkers(markers),
    };
  }

  /** Both pockets at every ply, the side to move's playable. Perfect
   *  information, so one projection carries both hands; the bottom pocket
   *  follows the board's bottom seat, as the live room puts your own hand
   *  under the board. */
  function material(hosts: { top: HTMLElement; bottom: HTMLElement }) {
    pockets = hosts;
    for (const host of [hosts.top, hosts.bottom]) {
      installHandDrag({
        hand: host,
        ghostSizePx: XIANGQI_PIECE_SIZE,
        isRole: isCrazyhouseXiangqiDropRole,
        canDragRole: (role) => canDragRole(host.dataset.hand, role),
        ghostHtml: (role) => {
          const owner = host.dataset.hand;
          return isXiangqiColor(owner) ? xiangqiPieceGhostSvg({ color: owner, role }) : null;
        },
        onDragStart: (role) => select(role),
        onDrop: (role, to) => {
          if (to && play(role, to as CrazyhouseXiangqiSquare)) return;
          select(null);
        },
      });
    }
    return (
      truth: CrazyhouseXiangqiGameState,
      _rootTruth: CrazyhouseXiangqiGameState,
      nextFlipped: boolean,
    ): void => {
      shownTruth = truth;
      flipped = nextFlipped;
      repaintPockets();
    };
  }

  return {
    createBoard,
    material,
    /** The hand piece currently lifted (tests). */
    selectedRole: () => selectedRole,
  };
}

/** Engine UCI as a board overlay: a board move is an arrow, a drop (no
 *  origin) a ring on the point it lands on. */
function parseCrazyhouseEngineMove(
  uci: string,
): { from?: CrazyhouseXiangqiSquare; to: CrazyhouseXiangqiSquare } | null {
  const move = crazyhouseXiangqiMoveFromUci(uci);
  if (!move) return null;
  return isCrazyhouseXiangqiDropMove(move) ? { to: move.to } : move;
}

/** A PV move in the room's own notation (`b1-c3`, `N@e5`). */
function formatCrazyhouseEngineMove(uci: string): string {
  const move = crazyhouseXiangqiMoveFromUci(uci);
  return move ? crazyhouseXiangqiMoveLabel(move) : uci;
}

function crazyhouseXiangqiPresentation(): TreePresentation<
  CrazyhouseXiangqiMove,
  CrazyhouseXiangqiGameState,
  CrazyhouseXiangqiPlayerView,
  CrazyhouseXiangqiColor,
  XiangqiBoardArrow,
  XiangqiBoardMarker
> {
  const drops = createCrazyhouseXiangqiDropInput();
  return {
    adapter: crazyhouseXiangqiTreeAdapter,
    engine: {
      panelVariant: 'crazyhousexiangqi',
      fen: (truth) => crazyhouseXiangqiFen(truth),
      // A mated or stalemated position has nothing to search; the engine would
      // sit on "thinking".
      canEvaluatePosition: (truth) => truth.status.type === 'playing',
      formatPvMove: formatCrazyhouseEngineMove,
      engineArrowsFromLines: (lines) =>
        engineArrowsFromLinesWithParser(lines, parseCrazyhouseEngineMove),
      engineMarkersFromLines: (lines) =>
        engineMarkersFromLinesWithParser(lines, parseCrazyhouseEngineMove),
      bestMoveArrow: (best) => bestMoveArrowWithParser(best, parseCrazyhouseEngineMove),
      bestMoveMarker: (best) => bestMoveMarkerWithParser(best, parseCrazyhouseEngineMove),
    },
    // The Share card's FEN box: Fairy-Stockfish's crazyhousexiangqi spelling,
    // pocket in brackets, so the position can be pasted into an engine.
    fen: (truth) => crazyhouseXiangqiFen(truth),
    boardHostClassName: 'dxq-postgame__board xiangqi-live-board',
    boardWrapClassName: 'dxq-postgame__board-wrap review-board-host',
    defaultBoardAriaLabel: 'Crazyhouse Xiangqi board',
    boardAspect: () => xiangqiBoardAspect(LIVE_BOARD_GEO),
    appearanceEvent: xiangqiAppearanceChangedEvent,
    labelsEvent: xiangqiNotationChangedEvent,
    boardCols: 9,
    perspective: (flipped) => (flipped ? 'black' : 'red'),
    seatFor: (view) => (view.status.type === 'playing' ? view.status.turn : null),
    createBoard: (opts) => drops.createBoard(opts),
    // Only board moves glide; a drop has no origin square, so it simply lands.
    animateMove: (boardEl, move, perspective, opts) => {
      if (!isCrazyhouseXiangqiDropMove(move)) {
        animateXiangqiBoardMove(boardEl, move, perspective, opts);
      }
    },
    shapeToArrow: (s: NodeShape): XiangqiBoardArrow => ({
      from: s.orig as CrazyhouseXiangqiSquare,
      to: (s.dest ?? s.orig) as CrazyhouseXiangqiSquare,
      className: `xq-arrow--draw xq-shape--${s.brush}`,
    }),
    shapeToMarker: (s: NodeShape): XiangqiBoardMarker => ({
      square: s.orig as CrazyhouseXiangqiSquare,
      kind: 'circle',
      className: `xq-shape--${s.brush}`,
    }),
    // A drop has no `from`, but it has a destination, so both union members
    // carry the badge to the point they landed on.
    moveGlyphMarker: (move: CrazyhouseXiangqiMove, glyph): XiangqiBoardMarker => ({
      square: move.to,
      kind: 'glyph',
      text: glyph.text,
      className: `xq-marker--${glyph.tone}`,
    }),
    // Both pockets at every ply, the side to move's playable (the drop input).
    material: (hosts) => drops.material(hosts),
  };
}

export function mountCrazyhouseXiangqiReview(
  root: HTMLElement,
  config: CrazyhouseXiangqiReviewConfig,
): CrazyhouseXiangqiReviewHandle {
  return mountTreeReview(root, crazyhouseXiangqiPresentation(), config);
}
