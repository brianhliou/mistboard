/**
 * Puzzle-board adapter for Jungle (Dou Shou Qi): its own 7x9 board with no
 * reserve/hand (no drops), so it paints straight onto the board host, simpler
 * than the fortress path. Mirrors the live-jungle drag wiring.
 */

import {
  applyJungleMove,
  getJunglePlayerView,
  JUNGLE_SPEC_ID,
  type JungleColor,
  type JungleGameState,
  type JungleMove,
  type JunglePlayerView,
  type JungleSquare,
} from '@mistboard/game';
import {
  animateJungleBoardMove,
  JUNGLE_BOARD_VIEW,
  junglePieceGhostSvg,
  renderJungleBoardSvg,
} from '../jungle-render.js';
import { installBoardDrag } from '../variant-tenant/board-drag.js';
import {
  activeTurn,
  isReplayLive,
  type PuzzleBoardAdapter,
  type PuzzleBoardContext,
  type PuzzleDetail,
  type PuzzleMove,
  type PuzzleSession,
} from './adapter.js';
import { puzzlePrompt } from './prompt.js';

function paintBoard(board: HTMLElement, ctx: PuzzleBoardContext): void {
  const { session } = ctx;
  const perspective = junglePerspective(session);
  const view = getJunglePlayerView(ctx.displayState as JungleGameState, perspective);
  board.innerHTML = renderJungleBoardSvg(view.board, {
    perspective,
    interactive: true,
    selected: session.selectedSquare as JungleSquare | null,
    targets: jungleHighlightTargets(session, view),
    draggingFrom: session.draggingFrom as JungleSquare | null,
    lastMove: view.lastMove ?? null,
  });
  installBoardDrag({
    board,
    // The board scales above its SVG units, so size the ghost to the on-screen cell.
    ghostSizePx: () => {
      const width = board.getBoundingClientRect().width;
      return width > 0 ? width / JUNGLE_BOARD_VIEW.files : JUNGLE_BOARD_VIEW.cell;
    },
    onSquareClick: (square) => {
      if (!isReplayLive(session)) return;
      void handleJungleBoardClick(ctx, square as JungleSquare);
    },
    canDragFrom: (square) => canDragJunglePiece(session, square as JungleSquare),
    ghostHtml: (square) => {
      const piece = view.board[square as JungleSquare];
      return piece ? junglePieceGhostSvg(piece) : null;
    },
    onDragStart: (from) => {
      session.selectedSquare = from as JungleSquare;
      session.selectedDrop = null;
      session.draggingFrom = from as JungleSquare;
      ctx.renderSession();
    },
    onDrop: (from, to) => {
      void handleJungleBoardDrop(ctx, from as JungleSquare, (to as JungleSquare | null) ?? null);
    },
  });
}

function junglePerspective(session: PuzzleSession): JungleColor {
  return session.puzzle.sideToMove ?? 'red';
}

function jungleLiveView(session: PuzzleSession): JunglePlayerView {
  return getJunglePlayerView(session.state as JungleGameState, junglePerspective(session));
}

function jungleMovesFrom(view: JunglePlayerView, from: JungleSquare): JungleMove[] {
  return view.legalMoves.filter((move) => move.from === from);
}

function jungleHighlightTargets(session: PuzzleSession, view: JunglePlayerView): JungleSquare[] {
  if (!isReplayLive(session) || !session.selectedSquare) return [];
  return jungleMovesFrom(view, session.selectedSquare as JungleSquare).map((move) => move.to);
}

function jungleIsSelectable(
  session: PuzzleSession,
  view: JunglePlayerView,
  square: JungleSquare,
): boolean {
  const piece = view.board[square];
  return !!piece && piece.color === activeTurn(session) && jungleMovesFrom(view, square).length > 0;
}

function canDragJunglePiece(session: PuzzleSession, square: JungleSquare): boolean {
  if (
    session.submitting ||
    session.revealed ||
    session.state.status.type !== 'playing' ||
    !isReplayLive(session)
  ) {
    return false;
  }
  return jungleIsSelectable(session, jungleLiveView(session), square);
}

async function handleJungleBoardClick(
  ctx: PuzzleBoardContext,
  square: JungleSquare,
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
  const view = jungleLiveView(session);
  if (session.selectedSquare) {
    const move = jungleMovesFrom(view, session.selectedSquare as JungleSquare).find(
      (candidate) => candidate.to === square,
    );
    if (move) {
      await ctx.submitMove(move);
      return;
    }
  }
  if (jungleIsSelectable(session, view, square)) {
    session.selectedSquare = square;
    session.selectedDrop = null;
    session.feedback = { kind: 'neutral', text: `${square} selected.` };
  } else {
    session.selectedSquare = null;
    session.selectedDrop = null;
    session.feedback = { kind: 'neutral', text: puzzlePrompt(session.puzzle) };
  }
  ctx.renderSession();
}

async function handleJungleBoardDrop(
  ctx: PuzzleBoardContext,
  from: JungleSquare,
  to: JungleSquare | null,
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
  const move = jungleMovesFrom(jungleLiveView(session), from).find(
    (candidate) => candidate.to === to,
  );
  if (move) {
    await ctx.submitMove(move);
    return;
  }
  session.selectedSquare = null;
  session.selectedDrop = null;
  session.feedback = { kind: 'neutral', text: puzzlePrompt(session.puzzle) };
  ctx.renderSession();
}

export const junglePuzzleAdapter: PuzzleBoardAdapter = {
  variant: JUNGLE_SPEC_ID,
  labelKey: 'variant.jungle.name',
  markerId: 'jungle',
  paintBoard,
  animateMove: (board, session, move, opts) => {
    animateJungleBoardMove(
      board,
      move as { from: JungleSquare; to: JungleSquare },
      junglePerspective(session),
      opts,
    );
  },
  applyMove: (state, move) => applyJungleMove(state as JungleGameState, move as JungleMove),
  moveLabel: (move: PuzzleMove) => ('drop' in move ? `@${move.to}` : `${move.from}-${move.to}`),
  // Jungle has no general; the elephant (top rank) stands in as the side icon.
  sideIconSvg: (puzzle: PuzzleDetail) =>
    junglePieceGhostSvg({ color: puzzle.sideToMove ?? 'red', role: 'elephant' }),
};
