/**
 * Puzzle-board adapter for Fortress Xiangqi: its own 7x8 corner-palace board
 * with crazyhouse-style pockets flanking it (opponent's above, the solver's
 * own below). Parallels the Mini/Drop-Mini click/drag/drop handlers, but over
 * the Fortress player view; moves are submitted through the same
 * variant-agnostic ctx.submitMove path.
 */

import {
  applyFortressXiangqiMove,
  FORTRESS_DROP_ROLES,
  FORTRESS_XIANGQI_SPEC_ID,
  type FortressXiangqiColor,
  type FortressXiangqiDropRole,
  type FortressXiangqiGameState,
  type FortressXiangqiMove,
  type FortressXiangqiPlayerView,
  type FortressXiangqiSquare,
  getFortressXiangqiPlayerView,
} from '@mistboard/game';
import '../drop-mini-xiangqi.css';
import {
  animateFortressXiangqiBoardMove,
  FORTRESS_XIANGQI_PIECE_PX,
  fortressXiangqiPieceGhostSvg,
  installFortressXiangqiBoardStyles,
  renderFortressXiangqiBoardSvg,
} from '../fortress-xiangqi-render.js';
import {
  fillFortressXiangqiReserve,
  fortressXiangqiBoardMoves,
  fortressXiangqiDropTargets,
  fortressXiangqiMoveLabel,
} from '../fortress-xiangqi-view.js';
import { t } from '../i18n/catalog.js';
import { installBoardDrag } from '../variant-tenant/board-drag.js';
import { installHandDrag } from '../variant-tenant/hand-drag.js';
import {
  activeTurn,
  dropRoleLabel,
  isReplayLive,
  type PuzzleBoardAdapter,
  type PuzzleBoardContext,
  type PuzzleDetail,
  type PuzzleMove,
  type PuzzleSession,
} from './adapter.js';

function paintBoard(board: HTMLElement, ctx: PuzzleBoardContext): void {
  const { session } = ctx;
  const perspective = fortressPerspective(session);
  const view = getFortressXiangqiPlayerView(
    ctx.displayState as FortressXiangqiGameState,
    perspective,
  );
  const boardTarget = renderFortressPuzzleShell(board, ctx, view);
  boardTarget.innerHTML = renderFortressXiangqiBoardSvg(view, perspective, {
    interactive: true,
    selectedSquare: session.selectedSquare as FortressXiangqiSquare | null,
    targets: fortressHighlightTargets(session, view),
    draggingFrom: session.draggingFrom as FortressXiangqiSquare | null,
  });
  installBoardDrag({
    board: boardTarget,
    ghostSizePx: FORTRESS_XIANGQI_PIECE_PX,
    onSquareClick: (square) => {
      if (!isReplayLive(session)) return;
      void handleFortressBoardClick(ctx, square as FortressXiangqiSquare);
    },
    canDragFrom: (square) => canDragFortressPiece(session, square as FortressXiangqiSquare),
    ghostHtml: (square) => {
      const piece = view.board[square as FortressXiangqiSquare];
      return piece ? fortressXiangqiPieceGhostSvg(piece) : null;
    },
    onDragStart: (from) => {
      session.selectedSquare = from as FortressXiangqiSquare;
      session.selectedDrop = null;
      session.draggingFrom = from as FortressXiangqiSquare;
      ctx.renderSession();
    },
    onDrop: (from, to) => {
      void handleFortressBoardDrop(
        ctx,
        from as FortressXiangqiSquare,
        (to as FortressXiangqiSquare | null) ?? null,
      );
    },
  });
}

function renderFortressPuzzleShell(
  host: HTMLElement,
  ctx: PuzzleBoardContext,
  view: FortressXiangqiPlayerView,
): HTMLElement {
  const shell = document.createElement('div');
  // puzzle-fortress-shell narrows the shell for the taller 7x8 board so both
  // pockets stay in view (the drop shell is tuned for the square 7x7 board).
  shell.className =
    'puzzle-board-shell puzzle-fortress-shell board-shell drop-mini-reserve-container';
  // Crazyhouse-style pockets flanking the board: opponent's above, the solver's
  // own directly below. Dedicated puzzle-pocket styling (not the capture strip,
  // whose fixed height + overflow:hidden clipped the taller drop chips).
  const topReserve = document.createElement('div');
  topReserve.className = 'puzzle-pocket puzzle-pocket--opponent puzzle-board-reserve';
  topReserve.setAttribute('aria-label', 'Opponent reserve');
  const boardSurface = document.createElement('div');
  boardSurface.className = 'puzzle-board-surface';
  const bottomReserve = document.createElement('div');
  bottomReserve.className = 'puzzle-pocket puzzle-pocket--own puzzle-board-reserve';
  bottomReserve.setAttribute('aria-label', 'Your reserve');

  const bottom = view.perspective;
  const top = bottom === 'red' ? 'black' : 'red';
  fillFortressPuzzleReserve(topReserve, ctx, view, top, false);
  fillFortressPuzzleReserve(bottomReserve, ctx, view, bottom, true);

  shell.append(topReserve, boardSurface, bottomReserve);
  host.append(shell);
  return boardSurface;
}

function fillFortressPuzzleReserve(
  reserve: HTMLElement,
  ctx: PuzzleBoardContext,
  view: FortressXiangqiPlayerView,
  color: FortressXiangqiColor,
  isBottom: boolean,
): void {
  const { session } = ctx;
  const canPlay =
    isBottom &&
    color === activeTurn(session) &&
    session.state.status.type === 'playing' &&
    isReplayLive(session) &&
    !session.submitting;
  fillFortressXiangqiReserve(reserve, view, color, {
    interactive: canPlay,
    selectedRole: canPlay ? (session.selectedDrop as FortressXiangqiDropRole | null) : null,
    onSelect: (role) => {
      if (!canPlay) return;
      session.selectedDrop = session.selectedDrop === role ? null : role;
      session.selectedSquare = null;
      session.feedback = { kind: 'neutral', text: `${dropRoleLabel(role)} selected.` };
      ctx.renderSession();
    },
  });
  installHandDrag({
    hand: reserve,
    ghostSizePx: FORTRESS_XIANGQI_PIECE_PX,
    isRole: isFortressDropRole,
    canDragRole: (role) => canPlay && (view.hands[color][role] ?? 0) > 0,
    ghostHtml: (role) => fortressXiangqiPieceGhostSvg({ color, role }),
    onDragStart: (role) => {
      if (!canPlay) return;
      session.selectedDrop = role;
      session.selectedSquare = null;
      session.draggingFrom = null;
      session.feedback = { kind: 'neutral', text: `${dropRoleLabel(role)} selected.` };
      ctx.renderSession();
    },
    onDrop: (role, to) => {
      void handleFortressReserveDrop(ctx, role, (to as FortressXiangqiSquare | null) ?? null);
    },
  });
}

function fortressPerspective(session: PuzzleSession): FortressXiangqiColor {
  return session.puzzle.sideToMove ?? 'red';
}

function fortressLiveView(session: PuzzleSession): FortressXiangqiPlayerView {
  return getFortressXiangqiPlayerView(
    session.state as FortressXiangqiGameState,
    fortressPerspective(session),
  );
}

function fortressHighlightTargets(
  session: PuzzleSession,
  view: FortressXiangqiPlayerView,
): FortressXiangqiSquare[] {
  if (!isReplayLive(session)) return [];
  if (session.selectedDrop) {
    return fortressXiangqiDropTargets(view, session.selectedDrop as FortressXiangqiDropRole);
  }
  if (!session.selectedSquare) return [];
  return fortressXiangqiBoardMoves(view, session.selectedSquare as FortressXiangqiSquare).map(
    (move) => move.to,
  );
}

function fortressIsSelectable(
  session: PuzzleSession,
  view: FortressXiangqiPlayerView,
  square: FortressXiangqiSquare,
): boolean {
  const piece = view.board[square];
  return (
    !!piece &&
    piece.color === activeTurn(session) &&
    fortressXiangqiBoardMoves(view, square).length > 0
  );
}

function canDragFortressPiece(session: PuzzleSession, square: FortressXiangqiSquare): boolean {
  if (
    session.submitting ||
    session.revealed ||
    session.state.status.type !== 'playing' ||
    !isReplayLive(session)
  ) {
    return false;
  }
  return fortressIsSelectable(session, fortressLiveView(session), square);
}

async function handleFortressBoardClick(
  ctx: PuzzleBoardContext,
  square: FortressXiangqiSquare,
): Promise<void> {
  const { session } = ctx;
  if (
    session.submitting ||
    session.revealed ||
    session.state.status.type !== 'playing' ||
    !isReplayLive(session)
  ) {
    return;
  }
  const view = fortressLiveView(session);
  if (session.selectedDrop) {
    const role = session.selectedDrop as FortressXiangqiDropRole;
    if (fortressXiangqiDropTargets(view, role).includes(square)) {
      await ctx.submitMove({ drop: role, to: square });
      return;
    }
    session.selectedDrop = null;
    session.feedback = { kind: 'neutral', text: 'Reserve cleared.' };
    ctx.renderSession();
    return;
  }

  if (session.selectedSquare) {
    const move = fortressXiangqiBoardMoves(
      view,
      session.selectedSquare as FortressXiangqiSquare,
    ).find((candidate) => candidate.to === square);
    if (move) {
      await ctx.submitMove(move);
      return;
    }
  }

  if (fortressIsSelectable(session, view, square)) {
    session.selectedSquare = square;
    session.selectedDrop = null;
    session.feedback = { kind: 'neutral', text: `${square} selected.` };
  } else {
    session.selectedSquare = null;
    session.selectedDrop = null;
    session.feedback = { kind: 'neutral', text: t('puzzle.findBestMove') };
  }
  ctx.renderSession();
}

async function handleFortressBoardDrop(
  ctx: PuzzleBoardContext,
  from: FortressXiangqiSquare,
  to: FortressXiangqiSquare | null,
): Promise<void> {
  const { session } = ctx;
  session.draggingFrom = null;
  if (
    session.submitting ||
    session.state.status.type !== 'playing' ||
    !to ||
    !isReplayLive(session)
  ) {
    session.selectedSquare = null;
    session.selectedDrop = null;
    ctx.renderSession();
    return;
  }
  const move = fortressXiangqiBoardMoves(fortressLiveView(session), from).find(
    (candidate) => candidate.to === to,
  );
  if (move) {
    await ctx.submitMove(move);
    return;
  }
  session.selectedSquare = null;
  session.selectedDrop = null;
  session.feedback = { kind: 'neutral', text: t('puzzle.findBestMove') };
  ctx.renderSession();
}

async function handleFortressReserveDrop(
  ctx: PuzzleBoardContext,
  role: FortressXiangqiDropRole,
  to: FortressXiangqiSquare | null,
): Promise<void> {
  const { session } = ctx;
  session.draggingFrom = null;
  session.selectedSquare = null;
  session.selectedDrop = null;
  if (
    session.submitting ||
    session.state.status.type !== 'playing' ||
    !to ||
    !isReplayLive(session)
  ) {
    ctx.renderSession();
    return;
  }
  if (fortressXiangqiDropTargets(fortressLiveView(session), role).includes(to)) {
    await ctx.submitMove({ drop: role, to });
    return;
  }
  session.feedback = { kind: 'neutral', text: t('puzzle.findBestMove') };
  ctx.renderSession();
}

function isFortressDropRole(value: string): value is FortressXiangqiDropRole {
  return (FORTRESS_DROP_ROLES as readonly string[]).includes(value);
}

export const fortressXiangqiPuzzleAdapter: PuzzleBoardAdapter = {
  variant: FORTRESS_XIANGQI_SPEC_ID,
  labelKey: 'variant.fortressXiangqi.name',
  markerId: 'fortress-xiangqi',
  installStyles: installFortressXiangqiBoardStyles,
  paintBoard,
  animateMove: (board, session, move, opts) => {
    const host = board.querySelector<HTMLElement>('.puzzle-board-surface') ?? board;
    animateFortressXiangqiBoardMove(
      host,
      move as { from: FortressXiangqiSquare; to: FortressXiangqiSquare },
      fortressPerspective(session),
      opts,
    );
  },
  applyMove: (state, move) =>
    applyFortressXiangqiMove(state as FortressXiangqiGameState, move as FortressXiangqiMove),
  moveLabel: (move: PuzzleMove) => fortressXiangqiMoveLabel(move as FortressXiangqiMove),
  sideIconSvg: (puzzle: PuzzleDetail) =>
    fortressXiangqiPieceGhostSvg({ color: puzzle.sideToMove ?? 'red', role: 'general' }),
};
