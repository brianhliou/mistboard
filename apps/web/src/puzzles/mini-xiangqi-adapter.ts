/**
 * Puzzle-board adapter for Mini Xiangqi: the 7x7 mini renderer painted straight
 * onto the board host, with click and drag wired through the shared puzzle
 * session.
 */

import {
  applyMiniXiangqiOpenMove,
  getMiniXiangqiOpenPlayerView,
  MINI_XIANGQI_SPEC_ID,
  type MiniXiangqiGameState,
  type MiniXiangqiMove,
  type MiniXiangqiSquare,
} from '@mistboard/game';
import { t } from '../i18n/catalog.js';
import {
  animateMiniXiangqiBoardMove,
  installMiniXiangqiBoardStyles,
  MINI_XIANGQI_PIECE_PX,
  miniXiangqiPieceGhostSvg,
  renderMiniXiangqiBoardSvg,
} from '../live-mini-xiangqi-render.js';
import { installBoardDrag } from '../variant-tenant/board-drag.js';
import {
  activeTurn,
  isReplayLive,
  type PuzzleBoardAdapter,
  type PuzzleBoardContext,
  type PuzzleDetail,
  type PuzzleMove,
  type PuzzleSession,
  type PuzzleState,
} from './adapter.js';

function paintBoard(board: HTMLElement, ctx: PuzzleBoardContext): void {
  const { session } = ctx;
  const boardView = puzzleView(session, ctx.displayState);
  const legalMoves = highlightedBoardMoves(session);
  board.innerHTML = renderMiniXiangqiBoardSvg(boardView, boardView.perspective, {
    interactive: true,
    showFog: false,
    selectedSquare: session.selectedSquare as MiniXiangqiSquare | null,
    legalMoves,
    draggingFrom: session.draggingFrom as MiniXiangqiSquare | null,
  });
  installBoardDrag({
    board,
    ghostSizePx: MINI_XIANGQI_PIECE_PX,
    onSquareClick: (square) => {
      if (!isReplayLive(session)) return;
      void handleBoardClick(ctx, square as MiniXiangqiSquare);
    },
    canDragFrom: (square) => canDragBoardPiece(session, square as MiniXiangqiSquare),
    ghostHtml: (square) => {
      const entry = boardView.board[square as MiniXiangqiSquare];
      if (entry?.shrouded !== false) return null;
      return miniXiangqiPieceGhostSvg(entry.piece);
    },
    onDragStart: (from) => {
      session.selectedSquare = from as MiniXiangqiSquare;
      session.selectedDrop = null;
      session.draggingFrom = from as MiniXiangqiSquare;
      ctx.renderSession();
    },
    onDrop: (from, to) => {
      void handleBoardDrop(
        ctx,
        from as MiniXiangqiSquare,
        (to as MiniXiangqiSquare | null) ?? null,
      );
    },
  });
}

async function handleBoardClick(ctx: PuzzleBoardContext, square: MiniXiangqiSquare): Promise<void> {
  const { session } = ctx;
  if (
    session.submitting ||
    session.revealed ||
    session.state.status.type !== 'playing' ||
    !isReplayLive(session)
  ) {
    return;
  }

  if (session.selectedSquare) {
    const move = boardMovesFor(session, session.selectedSquare as MiniXiangqiSquare).find(
      (m) => m.to === square,
    );
    if (move) {
      await ctx.submitMove(move);
      return;
    }
  }

  if (isSelectablePiece(session, square)) {
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

async function handleBoardDrop(
  ctx: PuzzleBoardContext,
  from: MiniXiangqiSquare,
  to: MiniXiangqiSquare | null,
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

  const move = boardMovesFor(session, from).find((candidate) => candidate.to === to);
  if (move) {
    await ctx.submitMove(move);
    return;
  }

  session.selectedSquare = null;
  session.selectedDrop = null;
  session.feedback = { kind: 'neutral', text: t('puzzle.findBestMove') };
  ctx.renderSession();
}

function puzzleView(
  session: PuzzleSession,
  state: PuzzleState = session.state,
): ReturnType<typeof getMiniXiangqiOpenPlayerView> {
  const turn = session.puzzle.sideToMove ?? activeTurn(session);
  return getMiniXiangqiOpenPlayerView(state as MiniXiangqiGameState, turn);
}

function highlightedBoardMoves(session: PuzzleSession): MiniXiangqiMove[] {
  if (!isReplayLive(session)) return [];
  if (!session.selectedSquare) return [];
  return boardMovesFor(session, session.selectedSquare as MiniXiangqiSquare);
}

function boardMovesFor(session: PuzzleSession, from: MiniXiangqiSquare): MiniXiangqiMove[] {
  return puzzleView(session).legalMoves.filter((move) => move.from === from);
}

function isSelectablePiece(session: PuzzleSession, square: MiniXiangqiSquare): boolean {
  const entry = puzzleView(session).board[square];
  return entry?.shrouded === false && entry.piece.color === activeTurn(session);
}

function canDragBoardPiece(session: PuzzleSession, square: MiniXiangqiSquare): boolean {
  return (
    !session.submitting &&
    session.state.status.type === 'playing' &&
    isReplayLive(session) &&
    isSelectablePiece(session, square)
  );
}

function animateMove(
  board: HTMLElement,
  session: PuzzleSession,
  move: { from: string; to: string },
  opts: { reverse?: boolean },
): void {
  animateMiniXiangqiBoardMove(
    board,
    move as { from: MiniXiangqiSquare; to: MiniXiangqiSquare },
    session.puzzle.sideToMove ?? activeTurn(session),
    opts,
  );
}

function moveLabel(move: PuzzleMove): string {
  if ('drop' in move) return `${String(move.drop)}@${move.to}`;
  return `${move.from}-${move.to}`;
}

function sideIconSvg(puzzle: PuzzleDetail): string {
  return miniXiangqiPieceGhostSvg({ color: puzzle.sideToMove ?? 'red', role: 'general' });
}

export const miniXiangqiPuzzleAdapter: PuzzleBoardAdapter = {
  variant: MINI_XIANGQI_SPEC_ID,
  labelKey: 'variant.miniXiangqi.name',
  markerId: 'mini-xiangqi',
  installStyles: installMiniXiangqiBoardStyles,
  paintBoard,
  animateMove,
  applyMove: (state, move) =>
    applyMiniXiangqiOpenMove(state as MiniXiangqiGameState, move as MiniXiangqiMove),
  moveLabel,
  sideIconSvg,
};
